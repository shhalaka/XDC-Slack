import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from '../../src/modules/blockchain/blockchain.service';
import { RpcClient } from '../../src/modules/blockchain/rpc-client';

describe('BlockchainService', () => {
  let service: BlockchainService;
  let rpcClient: Record<string, jest.Mock>;

  const mockConfig = (key: string) => {
    const config: Record<string, unknown> = {
      'token.address': '',
      'token.decimals': 18,
      'token.symbol': 'TXDC',
      'token.nativeCurrency': 'TXDC',
      'rpc.chainId': 8888,
    };
    return config[key];
  };

  beforeEach(async () => {
    rpcClient = {
      getBalance: jest.fn(),
      getTransactionCount: jest.fn(),
      sendRawTransaction: jest.fn(),
      getTransactionReceipt: jest.fn(),
      getTransactionByHash: jest.fn(),
      getBlockNumber: jest.fn(),
      estimateGas: jest.fn(),
      getGasPrice: jest.fn(),
      chainId: jest.fn(),
      callContract: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: RpcClient, useValue: rpcClient },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(mockConfig) },
        },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
  });

  describe('getNativeBalance', () => {
    it('should return formatted balance', async () => {
      rpcClient.getBalance.mockResolvedValue('0xDE0B6B3A7640000');

      const result = await service.getNativeBalance('0x1234');
      expect(result.balanceFormatted).toBe('1.0');
      expect(result.symbol).toBe('TXDC');
      expect(result.address).toBe('0x1234');
    });
  });

  describe('getTransactionCount', () => {
    it('should return parsed nonce', async () => {
      rpcClient.getTransactionCount.mockResolvedValue('0x5');

      const result = await service.getTransactionCount('0x1234');
      expect(result).toBe(5);
    });
  });

  describe('getBlockNumber', () => {
    it('should return current block number', async () => {
      rpcClient.getBlockNumber.mockResolvedValue('0x10');

      const result = await service.getBlockNumber();
      expect(result).toBe(16);
    });
  });

  describe('getChainId', () => {
    it('should return chain ID', async () => {
      rpcClient.chainId.mockResolvedValue(8888);

      const result = await service.getChainId();
      expect(result).toBe(8888);
    });
  });
});
