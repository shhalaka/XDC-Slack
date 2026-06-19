import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { AuditLog, AuditAction } from '../../database/entities/audit-log.entity';
import { BlockchainService, BalanceResult } from '../blockchain/blockchain.service';
import { WalletManager } from './wallet.manager';

export interface WalletInfo {
  address: string;
  balance: BalanceResult;
  network: {
    chainId: number;
    name: string;
    blockNumber: number;
  };
  owner: {
    slackId: string;
    txdcName: string;
  };
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private blockchainService: BlockchainService,
    private walletManager: WalletManager,
  ) {}

  async getWalletInfo(slackId: string): Promise<WalletInfo> {
    const user = await this.userRepository.findOne({ where: { slackId } });
    if (!user) {
      throw new NotFoundException(
        'No wallet found. Please register first using /txdc register <name>@txdc',
      );
    }

    const [balance, chainId, blockNumber] = await Promise.all([
      this.blockchainService.getBalance(user.walletAddress),
      this.blockchainService.getChainId(),
      this.blockchainService.getBlockNumber(),
    ]);

    const chainNames: Record<number, string> = {
      1: 'Ethereum Mainnet',
      5: 'Goerli Testnet',
      11155111: 'Sepolia Testnet',
      8888: 'TXDC Private Network',
    };

    return {
      address: user.walletAddress,
      balance,
      network: {
        chainId,
        name: chainNames[chainId] || `Chain ID ${chainId}`,
        blockNumber,
      },
      owner: {
        slackId: user.slackId,
        txdcName: user.txdcName,
      },
    };
  }

  async getBalanceByIdentity(txdcName: string): Promise<BalanceResult> {
    const user = await this.userRepository.findOne({
      where: { txdcName: txdcName.toLowerCase() },
    });

    if (!user) {
      throw new NotFoundException(`Identity ${txdcName} not found`);
    }

    return this.blockchainService.getBalance(user.walletAddress);
  }

  async createWallet(slackId: string): Promise<{ address: string; encryptedKey: string }> {
    const wallet = this.walletManager.generateWallet();
    const encryptedKey = this.walletManager.encryptPrivateKey(wallet.privateKey);

    await this.auditLogRepository.save({
      action: AuditAction.WALLET_CREATED,
      slackId,
      entityType: 'wallet',
      details: { address: wallet.address },
      success: true,
    });

    return {
      address: wallet.address,
      encryptedKey,
    };
  }
}
