import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ethers } from 'ethers';
import { TransactionService } from '../../src/modules/transaction/transaction.service';
import { BlockchainService } from '../../src/modules/blockchain/blockchain.service';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { WalletManager } from '../../src/modules/wallet/wallet.manager';
import { NonceManager } from '../../src/shared/nonce/nonce-manager.service';
import { User, RegistrationStatus } from '../../src/database/entities/user.entity';
import { TransactionRecord, TransactionStatus } from '../../src/database/entities/transaction-record.entity';
import { AuditLog } from '../../src/database/entities/audit-log.entity';

describe('TransactionService', () => {
  let service: TransactionService;
  let userRepo: Record<string, jest.Mock>;
  let txRepo: Record<string, jest.Mock>;
  let auditRepo: Record<string, jest.Mock>;
  let blockchainService: Record<string, jest.Mock>;
  let identityService: Record<string, jest.Mock>;
  let walletManager: Record<string, jest.Mock>;
  let nonceManager: Record<string, jest.Mock>;

  const mockSender: Partial<User> = {
    id: 'sender-uuid',
    slackId: 'U_SENDER',
    txdcName: 'alice@txdc',
    walletAddress: '0xSender111111111111111111111111111111111111',
    encryptedPrivateKey: 'encrypted-key-data',
    registrationStatus: RegistrationStatus.ACTIVE,
    dailyVolumeUsed: '0',
    dailyTransactionCount: 0,
  };

  const mockReceiver: Partial<User> = {
    id: 'receiver-uuid',
    slackId: 'U_RECEIVER',
    txdcName: 'bob@txdc',
    walletAddress: '0xReceiver222222222222222222222222222222222222',
    registrationStatus: RegistrationStatus.ACTIVE,
  };

  const mockTxRecord: Partial<TransactionRecord> = {
    id: 'tx-uuid-1',
    senderIdentity: 'alice@txdc',
    receiverIdentity: 'bob@txdc',
    senderAddress: '0xSender111111111111111111111111111111111111',
    receiverAddress: '0xReceiver222222222222222222222222222222222222',
    amount: '10',
    gasLimit: '21000',
    gasPrice: '20000000000',
    status: TransactionStatus.PENDING_CONFIRMATION,
    senderUser: mockSender as User,
    senderUserId: 'sender-uuid',
    receiverUserId: 'receiver-uuid',
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    txRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
    };
    auditRepo = { save: jest.fn() };
    blockchainService = {
      getBalance: jest.fn(),
      estimateGas: jest.fn(),
      getTransactionCount: jest.fn(),
      getChainId: jest.fn(),
      sendTransaction: jest.fn(),
      getTransactionStatus: jest.fn(),
    };
    identityService = {
      resolve: jest.fn(),
    };
    walletManager = {
      decryptPrivateKey: jest.fn(),
      signTransaction: jest.fn(),
    };
    nonceManager = {
      nextNonce: jest.fn(),
      resetNonce: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(TransactionRecord), useValue: txRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: BlockchainService, useValue: blockchainService },
        { provide: IdentityService, useValue: identityService },
        { provide: WalletManager, useValue: walletManager },
        { provide: NonceManager, useValue: nonceManager },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
  });

  describe('initiate', () => {
    it('should initiate a transaction successfully', async () => {
      userRepo.findOne.mockResolvedValue(mockSender);
      identityService.resolve.mockResolvedValue(mockReceiver);
      blockchainService.getBalance.mockResolvedValue({
        balanceFormatted: '100.0',
        symbol: 'TXDC',
      });
      blockchainService.estimateGas.mockResolvedValue({
        gasLimit: '21000',
        gasPrice: '20000000000',
        estimatedCostFormatted: '0.000042',
      });
      txRepo.create.mockReturnValue(mockTxRecord);
      txRepo.save.mockResolvedValue(mockTxRecord);

      const result = await service.initiate({
        slackId: 'U_SENDER',
        senderIdentity: 'alice@txdc',
        receiverIdentity: 'bob@txdc',
        amount: '10',
      });

      expect(result.transactionId).toBe('tx-uuid-1');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.estimatedGas).toBe('0.000042');
    });

    it('should reject if sender not registered', async () => {
      identityService.resolve.mockResolvedValue(mockSender);
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.initiate({
          slackId: 'U_UNKNOWN',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '10',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject if sender is suspended', async () => {
      identityService.resolve.mockResolvedValue(mockSender);
      userRepo.findOne.mockResolvedValue({
        ...mockSender,
        registrationStatus: 'suspended',
      });

      await expect(
        service.initiate({
          slackId: 'U_SENDER',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '10',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject if sender identity does not match', async () => {
      identityService.resolve.mockResolvedValue(mockSender);
      userRepo.findOne.mockResolvedValue(mockSender);

      await expect(
        service.initiate({
          slackId: 'U_SENDER',
          senderIdentity: 'wrong@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '10',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if receiver not found', async () => {
      identityService.resolve
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue(mockSender);

      await expect(
        service.initiate({
          slackId: 'U_SENDER',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'unknown@txdc',
          amount: '10',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject zero amount', async () => {
      userRepo.findOne.mockResolvedValue(mockSender);
      identityService.resolve.mockResolvedValue(mockReceiver);

      await expect(
        service.initiate({
          slackId: 'U_SENDER',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '0',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject insufficient balance', async () => {
      userRepo.findOne.mockResolvedValue(mockSender);
      identityService.resolve.mockResolvedValue(mockReceiver);
      blockchainService.getBalance.mockResolvedValue({
        balanceFormatted: '5.0',
        symbol: 'TXDC',
      });

      await expect(
        service.initiate({
          slackId: 'U_SENDER',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '10',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if balance insufficient to cover gas', async () => {
      userRepo.findOne.mockResolvedValue(mockSender);
      identityService.resolve.mockResolvedValue(mockReceiver);
      blockchainService.getBalance.mockResolvedValue({
        balanceFormatted: '10.00001',
        symbol: 'TXDC',
      });
      blockchainService.estimateGas.mockResolvedValue({
        estimatedCostFormatted: '0.0001',
      });

      await expect(
        service.initiate({
          slackId: 'U_SENDER',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '10',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirm', () => {
    it('should approve and broadcast a transaction', async () => {
      const tx = { ...mockTxRecord, status: TransactionStatus.PENDING_CONFIRMATION };
      txRepo.findOne.mockResolvedValue(tx);
      walletManager.decryptPrivateKey.mockReturnValue('0xPRIVATE_KEY');
      nonceManager.nextNonce.mockResolvedValue(5);
      blockchainService.getChainId.mockResolvedValue(8888);
      walletManager.signTransaction.mockResolvedValue('0xSIGNED_TX_HEX');
      blockchainService.sendTransaction.mockResolvedValue({ txHash: '0xTX_HASH' });
      txRepo.save.mockResolvedValue(tx);

      const result = await service.confirm({
        transactionId: 'tx-uuid-1',
        slackId: 'U_SENDER',
        approved: true,
      });

      expect(result.txHash).toBe('0xTX_HASH');
      expect(result.status).toBe('broadcast');
    });

    it('should reject a transaction when user cancels', async () => {
      const tx = { ...mockTxRecord, status: TransactionStatus.PENDING_CONFIRMATION };
      txRepo.findOne.mockResolvedValue(tx);
      txRepo.save.mockResolvedValue(tx);

      const result = await service.confirm({
        transactionId: 'tx-uuid-1',
        slackId: 'U_SENDER',
        approved: false,
      });

      expect(result.status).toBe('rejected');
    });

    it('should reject if transaction not found', async () => {
      txRepo.findOne.mockResolvedValue(null);

      await expect(
        service.confirm({
          transactionId: 'unknown',
          slackId: 'U_SENDER',
          approved: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject if transaction already processed', async () => {
      txRepo.findOne.mockResolvedValue({
        ...mockTxRecord,
        status: TransactionStatus.CONFIRMED,
      });

      await expect(
        service.confirm({
          transactionId: 'tx-uuid-1',
          slackId: 'U_SENDER',
          approved: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject if wrong user tries to confirm', async () => {
      txRepo.findOne.mockResolvedValue({
        ...mockTxRecord,
        status: TransactionStatus.PENDING_CONFIRMATION,
      });

      await expect(
        service.confirm({
          transactionId: 'tx-uuid-1',
          slackId: 'U_WRONG_USER',
          approved: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle signing failure gracefully', async () => {
      const tx = { ...mockTxRecord, status: TransactionStatus.PENDING_CONFIRMATION };
      txRepo.findOne.mockResolvedValue(tx);
      walletManager.decryptPrivateKey.mockReturnValue('0xPRIVATE_KEY');
      nonceManager.nextNonce.mockResolvedValue(5);
      blockchainService.getChainId.mockResolvedValue(8888);
      walletManager.signTransaction.mockImplementation(() => {
        throw new Error('signing failed');
      });
      txRepo.save.mockResolvedValue(tx);

      await expect(
        service.confirm({
          transactionId: 'tx-uuid-1',
          slackId: 'U_SENDER',
          approved: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTransaction', () => {
    it('should return transaction from database if found', async () => {
      const tx = {
        ...mockTxRecord,
        txHash: '0xTX_HASH',
        status: TransactionStatus.CONFIRMED,
        blockNumber: '100',
      };
      txRepo.findOne.mockResolvedValue(tx);

      const result = await service.getTransaction('0xTX_HASH');
      expect(result.txHash).toBe('0xTX_HASH');
      expect(result.blockNumber).toBe('100');
    });

    it('should fetch from blockchain if not in database', async () => {
      txRepo.findOne.mockResolvedValue(null);
      blockchainService.getTransactionStatus.mockResolvedValue({
        hash: '0xTX_HASH',
        from: '0xFrom',
        to: '0xTo',
        value: ethers.parseEther('5').toString(),
        status: 'confirmed',
        blockNumber: '0x64',
        gasUsed: '21000',
        gasPrice: '20000000000',
        gasLimit: '21000',
        nonce: 3,
        timestamp: '1234567890',
      });

      const result = await service.getTransaction('0xTX_HASH');
      expect(result.txHash).toBe('0xTX_HASH');
      expect(result.amount).toBe('5.0');
      expect(result.senderAddress).toBe('0xFrom');
    });
  });

  describe('getHistory', () => {
    it('should return transaction history for an identity', async () => {
      identityService.resolve.mockResolvedValue(mockReceiver);
      const txs = [
        { ...mockTxRecord, id: 'tx-1', createdAt: new Date() },
        { ...mockTxRecord, id: 'tx-2', senderIdentity: 'bob@txdc', receiverIdentity: 'alice@txdc', createdAt: new Date() },
      ];
      txRepo.findAndCount.mockResolvedValue([txs, 2]);

      const result = await service.getHistory('bob@txdc');
      expect(result.total).toBe(2);
      expect(result.transactions).toHaveLength(2);
    });

    it('should throw if identity not found', async () => {
      identityService.resolve.mockResolvedValue(null);

      await expect(
        service.getHistory('unknown@txdc'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
