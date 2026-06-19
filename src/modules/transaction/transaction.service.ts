import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ethers } from 'ethers';
import { Cron, CronExpression } from '@nestjs/schedule';
import { User } from '../../database/entities/user.entity';
import {
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../../database/entities/transaction-record.entity';
import { AuditLog, AuditAction } from '../../database/entities/audit-log.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { IdentityService } from '../identity/identity.service';
import { WalletManager } from '../wallet/wallet.manager';
import { NonceManager } from '../../shared/nonce/nonce-manager.service';

export interface SendTransactionDto {
  slackId: string;
  senderIdentity: string;
  receiverIdentity: string;
  amount: string;
  memo?: string;
}

export interface ConfirmTransactionDto {
  transactionId: string;
  slackId: string;
  approved: boolean;
}

export interface TransactionHistoryItem {
  id: string;
  txHash: string | null;
  senderIdentity: string;
  receiverIdentity: string;
  amount: string;
  status: TransactionStatus;
  type: TransactionType;
  blockNumber: string | null;
  createdAt: Date;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(TransactionRecord)
    private txRepository: Repository<TransactionRecord>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private blockchainService: BlockchainService,
    private identityService: IdentityService,
    private walletManager: WalletManager,
    private nonceManager: NonceManager,
  ) {}

  async initiate(
    dto: SendTransactionDto,
  ): Promise<{ transactionId: string; requiresConfirmation: boolean; estimatedGas?: string }> {
    const senderIdentityRecord = await this.identityService.resolve(dto.senderIdentity);
    if (!senderIdentityRecord) {
      throw new NotFoundException(
        `Sender identity ${dto.senderIdentity} not found. Please register using /txdc register.`,
      );
    }

    const sender = await this.userRepository.findOne({ where: { slackId: dto.slackId } });
    if (!sender) {
      throw new NotFoundException(
        'Your Slack account is not linked to any identity. Please register using /txdc register.',
      );
    }

    if (sender.registrationStatus !== 'active') {
      throw new ConflictException('Your account is suspended. Contact support.');
    }

    if (sender.txdcName !== dto.senderIdentity.toLowerCase()) {
      throw new BadRequestException(
        `You are not the owner of ${dto.senderIdentity}. Your identity is ${sender.txdcName}.`,
      );
    }

    const receiver = await this.identityService.resolve(dto.receiverIdentity);
    if (!receiver) {
      throw new NotFoundException(`Receiver identity ${dto.receiverIdentity} not found.`);
    }

    const amount = ethers.parseEther(dto.amount);
    if (amount <= 0n) {
      throw new BadRequestException('Amount must be greater than 0.');
    }

    const senderBalance = await this.blockchainService.getBalance(sender.walletAddress);
    const balanceWei = ethers.parseEther(senderBalance.balanceFormatted);
    if (balanceWei < amount) {
      throw new BadRequestException(
        `Insufficient balance. You have ${senderBalance.balanceFormatted} ${senderBalance.symbol}, trying to send ${dto.amount} ${senderBalance.symbol}.`,
      );
    }

    const gasEstimate = await this.blockchainService.estimateGas(
      sender.walletAddress,
      receiver.walletAddress,
      dto.amount,
    );

    const totalCost = amount + ethers.parseEther(gasEstimate.estimatedCostFormatted);
    if (balanceWei < totalCost) {
      throw new BadRequestException(
        `Insufficient balance for transaction + gas. Need ${ethers.formatEther(totalCost)} ${senderBalance.symbol}, have ${senderBalance.balanceFormatted} ${senderBalance.symbol}.`,
      );
    }

    const tx = this.txRepository.create({
      senderIdentity: dto.senderIdentity.toLowerCase(),
      receiverIdentity: dto.receiverIdentity.toLowerCase(),
      senderAddress: sender.walletAddress,
      receiverAddress: receiver.walletAddress,
      amount: dto.amount,
      gasLimit: gasEstimate.gasLimit,
      gasPrice: gasEstimate.gasPrice,
      status: TransactionStatus.PENDING_CONFIRMATION,
      type: TransactionType.TRANSFER,
      senderUserId: sender.id,
      receiverUserId: receiver.id,
      metadata: dto.memo ? { memo: dto.memo } : undefined,
    });

    const saved = await this.txRepository.save(tx);

    await this.auditLogRepository.save({
      action: AuditAction.TRANSACTION_INITIATED,
      slackId: dto.slackId,
      entityType: 'transaction',
      entityId: saved.id,
      details: {
        from: dto.senderIdentity,
        to: dto.receiverIdentity,
        amount: dto.amount,
        gasEstimate: gasEstimate.estimatedCostFormatted,
      },
      success: true,
    });

    this.logger.log(
      `Transaction initiated: ${dto.senderIdentity} → ${dto.receiverIdentity}: ${dto.amount} TXDC (id: ${saved.id})`,
    );

    return {
      transactionId: saved.id,
      requiresConfirmation: true,
      estimatedGas: gasEstimate.estimatedCostFormatted,
    };
  }

  async confirm(dto: ConfirmTransactionDto): Promise<{
    txHash: string;
    status: string;
    senderIdentity?: string;
    receiverIdentity?: string;
    amount?: string;
  }> {
    const tx = await this.txRepository.findOne({
      where: { id: dto.transactionId },
      relations: ['senderUser'],
    });

    if (!tx) {
      throw new NotFoundException(`Transaction ${dto.transactionId} not found.`);
    }

    if (tx.status !== TransactionStatus.PENDING_CONFIRMATION) {
      throw new ConflictException(
        `Transaction is already ${tx.status}. Cannot confirm again.`,
      );
    }

    if (tx.senderUser?.slackId !== dto.slackId) {
      throw new BadRequestException('Only the sender can confirm this transaction.');
    }

    if (!dto.approved) {
      tx.status = TransactionStatus.REJECTED;
      await this.txRepository.save(tx);

      await this.auditLogRepository.save({
        action: AuditAction.TRANSACTION_REJECTED,
        slackId: dto.slackId,
        entityType: 'transaction',
        entityId: tx.id,
        details: { reason: 'User rejected confirmation' },
        success: true,
      });

      return {
        txHash: '',
        status: 'rejected',
        senderIdentity: tx.senderIdentity,
        receiverIdentity: tx.receiverIdentity,
        amount: tx.amount,
      };
    }

    const encryptedKey = tx.senderUser?.encryptedPrivateKey;
    if (!encryptedKey) {
      tx.status = TransactionStatus.FAILED;
      tx.errorMessage = 'Sender wallet key not available';
      await this.txRepository.save(tx);
      throw new BadRequestException('Sender wallet is not configured for direct signing.');
    }

    try {
      const privateKey = this.walletManager.decryptPrivateKey(encryptedKey);

      const [nonce, chainId] = await Promise.all([
        this.nonceManager.nextNonce(tx.senderAddress),
        this.blockchainService.getChainId(),
      ]);

      const signedTx = await this.walletManager.signTransaction(privateKey, {
        to: tx.receiverAddress,
        value: tx.amount,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        nonce,
        chainId,
      });

      const result = await this.blockchainService.sendTransaction(signedTx);

      tx.txHash = result.txHash;
      tx.nonce = nonce;
      tx.signedTransaction = signedTx;
      tx.status = TransactionStatus.PENDING;
      await this.txRepository.save(tx);

      await this.auditLogRepository.save({
        action: AuditAction.TRANSACTION_CONFIRMED,
        slackId: dto.slackId,
        entityType: 'transaction',
        entityId: tx.id,
        details: { txHash: result.txHash },
        success: true,
      });

      this.logger.log(
        `Transaction broadcast: ${tx.txHash} (${tx.senderIdentity} → ${tx.receiverIdentity}: ${tx.amount} TXDC)`,
      );

      return {
        txHash: result.txHash,
        status: 'broadcast',
        senderIdentity: tx.senderIdentity,
        receiverIdentity: tx.receiverIdentity,
        amount: tx.amount,
      };
    } catch (error) {
      tx.status = TransactionStatus.FAILED;
      tx.errorMessage = (error as Error).message;
      await this.txRepository.save(tx);

      // Reset the nonce so the next attempt re-fetches from on-chain
      await this.nonceManager.resetNonce(tx.senderAddress).catch(() => {});

      await this.auditLogRepository.save({
        action: AuditAction.TRANSACTION_FAILED,
        slackId: dto.slackId,
        entityType: 'transaction',
        entityId: tx.id,
        details: { error: (error as Error).message },
        success: false,
      });

      throw new BadRequestException(`Transaction failed: ${(error as Error).message}`);
    }
  }

  async getTransaction(txHash: string): Promise<TransactionRecord> {
    const txRecord = await this.txRepository.findOne({ where: { txHash } });
    if (txRecord) {
      return txRecord;
    }

    const txDetails = await this.blockchainService.getTransactionStatus(txHash);

    return {
      txHash: txDetails.hash,
      senderIdentity: '',
      receiverIdentity: '',
      senderAddress: txDetails.from,
      receiverAddress: txDetails.to,
      amount: ethers.formatEther(txDetails.value),
      status: txDetails.status === 'confirmed'
        ? TransactionStatus.CONFIRMED
        : txDetails.status === 'failed'
          ? TransactionStatus.FAILED
          : TransactionStatus.PENDING,
      blockNumber: txDetails.blockNumber,
      gasUsed: txDetails.gasUsed,
      gasPrice: txDetails.gasPrice,
      gasLimit: txDetails.gasLimit,
      nonce: txDetails.nonce,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TransactionRecord;
  }

  async getHistory(
    txdcName: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ transactions: TransactionHistoryItem[]; total: number }> {
    const user = await this.identityService.resolve(txdcName);
    if (!user) {
      throw new NotFoundException(`Identity ${txdcName} not found.`);
    }

    const [transactions, total] = await this.txRepository.findAndCount({
      where: [
        { senderIdentity: txdcName.toLowerCase() },
        { receiverIdentity: txdcName.toLowerCase() },
      ],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        txHash: tx.txHash,
        senderIdentity: tx.senderIdentity,
        receiverIdentity: tx.receiverIdentity,
        amount: tx.amount,
        status: tx.status,
        type: tx.type,
        blockNumber: tx.blockNumber,
        createdAt: tx.createdAt,
      })),
      total,
    };
  }

  async updateTransactionStatus(
    txHash: string,
    blockNumber?: string,
    status?: TransactionStatus,
  ): Promise<void> {
    const tx = await this.txRepository.findOne({ where: { txHash } });
    if (!tx) return;

    if (status) tx.status = status;
    if (blockNumber) tx.blockNumber = blockNumber;

    await this.txRepository.save(tx);
  }

  @Cron('*/12 * * * * *')
  async pollPendingTransactions(): Promise<void> {
    const txs = await this.txRepository.find({
      where: { status: TransactionStatus.PENDING },
      take: 50,
    });

    for (const tx of txs) {
      if (!tx.txHash) continue;

      try {
        const currentBlock = await this.blockchainService.getBlockNumber();
        const details = await this.blockchainService.getTransactionStatus(tx.txHash);

        if (details.status === 'confirmed') {
          const txBlock = details.blockNumber ? parseInt(details.blockNumber, 16) : 0;
          const confirmations = currentBlock - txBlock;

          tx.blockNumber = details.blockNumber || '';
          tx.confirmationBlocks = Math.max(0, confirmations);
          tx.gasUsed = details.gasUsed || '';

          if (confirmations >= tx.requiredConfirmations) {
            tx.status = TransactionStatus.CONFIRMED;
            this.logger.log(
              `Transaction confirmed: ${tx.txHash} (${tx.senderIdentity} → ${tx.receiverIdentity}, ${confirmations} confirmations)`,
            );
          }
        } else if (details.status === 'failed') {
          tx.status = TransactionStatus.FAILED;
          tx.errorMessage = 'Transaction reverted on-chain';
          this.logger.warn(`Transaction failed on-chain: ${tx.txHash}`);
        } else if (details.blockNumber) {
          // tx was mined but no receipt yet — still pending
          const txBlock = parseInt(details.blockNumber, 16);
          const confirmations = currentBlock - txBlock;
          tx.confirmationBlocks = Math.max(0, confirmations);

          if (confirmations > 50) {
            tx.status = TransactionStatus.FAILED;
            tx.errorMessage = 'Mined but no receipt after 50 blocks — assumed dropped';
            this.logger.warn(`Transaction stalled: ${tx.txHash}`);
          }
        } else {
          // No receipt and no tx info — not seen by the node for a long time
          const age = Math.floor(
            (Date.now() - tx.createdAt.getTime()) / 1000,
          );
          if (age > 600) {
            tx.status = TransactionStatus.FAILED;
            tx.errorMessage = 'Transaction not seen by network after 10 minutes';
            this.logger.warn(`Transaction expired: ${tx.txHash}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Error polling tx ${tx.txHash}: ${(error as Error).message}`);
      }

      await this.txRepository.save(tx);
    }
  }
}
