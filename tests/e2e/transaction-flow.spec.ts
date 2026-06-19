import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestAppModule } from '../../test/test-app.module';
import { BlockchainService } from '../../src/modules/blockchain/blockchain.service';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { TransactionService } from '../../src/modules/transaction/transaction.service';
import { SlackSignatureGuard } from '../../src/common/guards/slack-signature.guard';

/**
 * End-to-End Test: TXDC Transaction Flow
 *
 * Spins up the full NestJS application with mocked blockchain/wallet
 * dependencies and validates the HTTP API layer end-to-end.
 */
describe('TXDC Transaction Flow (E2E)', () => {
  let app: INestApplication;

  const mockBlockchainService = {
    getBalance: jest.fn().mockResolvedValue({
      address: '0xSender',
      balanceWei: '100000000000000000000',
      balanceFormatted: '100.0',
      symbol: 'TXDC',
      decimals: 18,
    }),
    estimateGas: jest.fn().mockResolvedValue({
      gasLimit: '21000',
      gasPrice: '20000000000',
      estimatedCostWei: '420000000000000',
      estimatedCostFormatted: '0.00042',
    }),
    getTransactionCount: jest.fn().mockResolvedValue(5),
    getChainId: jest.fn().mockResolvedValue(8888),
    sendTransaction: jest.fn().mockResolvedValue({ txHash: '0xE2E_TX_HASH' }),
    getTransactionStatus: jest.fn().mockResolvedValue({
      hash: '0xE2E_TX_HASH',
      blockNumber: '0x64',
      status: 'confirmed',
      from: '0xSender',
      to: '0xReceiver',
      value: '10000000000000000000',
      gasUsed: '21000',
      gasPrice: '20000000000',
      gasLimit: '21000',
      nonce: 5,
    }),
    getBlockNumber: jest.fn().mockResolvedValue(100),
  };

  const mockWalletService = {
    createWallet: jest.fn().mockResolvedValue({
      address: '0xNewWallet',
      encryptedKey: 'encrypted-key',
    }),
    getWalletInfo: jest.fn().mockResolvedValue({
      address: '0xSender',
      balance: {
        address: '0xSender',
        balanceWei: '100000000000000000000',
        balanceFormatted: '100.0',
        symbol: 'TXDC',
        decimals: 18,
      },
      network: {
        chainId: 8888,
        name: 'TXDC Private Network',
        blockNumber: 100,
      },
      owner: {
        slackId: 'U_ALICE',
        txdcName: 'alice@txdc',
      },
    }),
    getBalanceByIdentity: jest.fn().mockResolvedValue({
      address: '0xBob',
      balanceWei: '50000000000000000000',
      balanceFormatted: '50.0',
      symbol: 'TXDC',
      decimals: 18,
    }),
  };

  const mockIdentityService = {
    register: jest.fn().mockResolvedValue({
      slackId: 'U_ALICE',
      txdcName: 'alice@txdc',
      walletAddress: '0xNewWallet',
      role: 'user',
      status: 'active',
      createdAt: new Date(),
    }),
    getBySlack: jest.fn().mockResolvedValue(null),
    resolve: jest.fn().mockResolvedValue({
      id: 'receiver-uuid',
      slackId: 'U_BOB',
      txdcName: 'bob@txdc',
      walletAddress: '0xReceiver',
      registrationStatus: 'active',
    }),
  };

  const mockTransactionService = {
    initiate: jest.fn().mockResolvedValue({
      transactionId: 'e2e-tx-uuid',
      requiresConfirmation: true,
      estimatedGas: '0.00042',
    }),
    confirm: jest.fn().mockResolvedValue({
      txHash: '0xE2E_TX_HASH',
      status: 'broadcast',
    }),
    getTransaction: jest.fn().mockResolvedValue({
      txHash: '0xE2E_TX_HASH',
      senderIdentity: 'alice@txdc',
      receiverIdentity: 'bob@txdc',
      senderAddress: '0xSender',
      receiverAddress: '0xReceiver',
      amount: '10',
      status: 'confirmed',
      blockNumber: '100',
      gasUsed: '21000',
      gasPrice: '20000000000',
      gasLimit: '21000',
      nonce: 5,
      createdAt: new Date(),
    }),
    getHistory: jest.fn().mockResolvedValue({
      transactions: [
        {
          id: 'tx-1',
          txHash: '0xE2E_TX_HASH',
          senderIdentity: 'alice@txdc',
          receiverIdentity: 'bob@txdc',
          amount: '10',
          status: 'confirmed',
          type: 'transfer',
          blockNumber: '100',
          createdAt: new Date(),
        },
      ],
      total: 1,
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(BlockchainService)
      .useValue(mockBlockchainService)
      .overrideProvider(WalletService)
      .useValue(mockWalletService)
      .overrideProvider(IdentityService)
      .useValue(mockIdentityService)
      .overrideProvider(TransactionService)
      .useValue(mockTransactionService)
      .overrideGuard(SlackSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health endpoint', () => {
    it('GET /api/v1/health should return 200', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });
  });

  describe('Slack commands', () => {
    it('POST /api/v1/slack/commands with register should succeed', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'register alice@txdc',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      // SlackSignatureGuard is overridden to always pass
      expect(response.status).toBe(201);
      expect(response.body).toBeDefined();
    });

    it('POST /api/v1/slack/commands with wallet should return wallet info', async () => {
      // We override getBySlack to return a user for this test
      mockIdentityService.getBySlack.mockResolvedValueOnce({
        slackId: 'U_ALICE',
        txdcName: 'alice@txdc',
        walletAddress: '0xSender',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'wallet',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      expect(response.status).toBe(201);
    });

    it('POST /api/v1/slack/commands with balance should return balance', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'balance bob@txdc',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      expect(response.status).toBe(201);
    });

    it('POST /api/v1/slack/commands with send should initiate transaction', async () => {
      // For send, getBySlack returns the user
      mockIdentityService.getBySlack.mockResolvedValueOnce({
        slackId: 'U_ALICE',
        txdcName: 'alice@txdc',
        walletAddress: '0xSender',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'send alice@txdc bob@txdc 10',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      expect(response.status).toBe(201);
    });

    it('POST /api/v1/slack/commands with transaction should return details', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'transaction 0xE2E_TX_HASH',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      expect(response.status).toBe(201);
    });

    it('POST /api/v1/slack/commands with history should return transactions', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'history alice@txdc',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      expect(response.status).toBe(201);
    });

    it('POST /api/v1/slack/commands with help should return help blocks', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/slack/commands')
        .send({
          command: '/txdc',
          text: 'help',
          user_id: 'U_ALICE',
          user_name: 'alice',
          team_id: 'T_TEST',
          channel_id: 'C_TEST',
          response_url: 'https://hooks.slack.com/test',
          trigger_id: 'trigger_123',
        });

      expect(response.status).toBe(201);
      expect(response.body.blocks).toBeDefined();
    });
  });

  describe('Health readiness and liveness', () => {
    it('GET /api/v1/health/readiness should return ready', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/readiness',
      );
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
    });

    it('GET /api/v1/health/liveness should return alive', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/liveness',
      );
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });
  });
});
