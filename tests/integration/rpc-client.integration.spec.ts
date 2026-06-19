import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RpcClient } from '../../src/modules/blockchain/rpc-client';

/**
 * Integration test: Geth JSON-RPC client with mocked HTTP layer.
 *
 * Validates:
 *   - Successful RPC call flow
 *   - Response parsing
 *   - Error handling for RPC-level errors
 *   - HTTP-level failures trigger retry
 *   - Fallback to secondary node
 *   - All nodes failing throws final error
 *
 * Uses jest.spyOn (not jest.mock factory) to avoid hoisting issues.
 */

describe('RpcClient (Geth JSON-RPC)', () => {
  let rpcClient: RpcClient;
  let mockPost: jest.Mock;
  let createSpy: jest.SpyInstance;

  const mockConfig = (key: string) => {
    const config: Record<string, unknown> = {
      'rpc.url': 'http://primary:8545',
      'rpc.fallbackUrls': ['http://fallback:8545'],
      'rpc.wsUrl': 'ws://localhost:8546',
      'rpc.chainId': 8888,
      'rpc.timeoutMs': 5000,
      'rpc.retryCount': 1,
      'rpc.retryDelayMs': 10,
    };
    return config[key];
  };

  beforeEach(async () => {
    mockPost = jest.fn();
    createSpy = jest.spyOn(axios, 'create').mockReturnValue({
      post: mockPost,
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
      defaults: {} as any,
      interceptors: { request: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() }, response: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() } },
      getUri: jest.fn(),
      request: jest.fn(),
    } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RpcClient,
        { provide: ConfigService, useValue: { get: jest.fn(mockConfig) } },
      ],
    }).compile();

    rpcClient = module.get<RpcClient>(RpcClient);
  });

  afterEach(() => {
    createSpy.mockRestore();
  });

  describe('call', () => {
    it('should make a successful RPC call and return the result', async () => {
      mockPost.mockResolvedValue({
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: '0xDE0B6B3A7640000',
        },
      });

      const result = await rpcClient.getBalance('0x1234');
      expect(result).toBe('0xDE0B6B3A7640000');
    });

    it('should throw on RPC-level error response', async () => {
      mockPost.mockResolvedValue({
        data: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'insufficient funds' },
        },
      });

      await expect(rpcClient.getBalance('0x1234')).rejects.toThrow(
        /insufficient funds/,
      );
    });

    it('should throw on null/undefined result', async () => {
      mockPost.mockResolvedValue({
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: null,
        },
      });

      await expect(rpcClient.getBalance('0x1234')).rejects.toThrow(
        /null\/undefined/,
      );
    });

    it('should retry on HTTP failure and succeed on second try', async () => {
      mockPost
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          data: {
            jsonrpc: '2.0',
            id: 2,
            result: '0x1',
          },
        });

      const result = await rpcClient.getBlockNumber();
      expect(result).toBe('0x1');
    });

    it('should fail after exhausting all nodes and retries', async () => {
      mockPost.mockRejectedValue(new Error('Network error'));

      await expect(rpcClient.getBlockNumber()).rejects.toThrow(
        /All RPC nodes failed/,
      );
    });

    it('should call eth_getTransactionCount with correct params', async () => {
      mockPost.mockResolvedValue({
        data: { jsonrpc: '2.0', id: 1, result: '0x5' },
      });

      const result = await rpcClient.getTransactionCount('0xabcd', 'pending');
      expect(result).toBe('0x5');

      const callArgs = mockPost.mock.calls[0][1] as any;
      expect(callArgs.method).toBe('eth_getTransactionCount');
      expect(callArgs.params).toEqual(['0xabcd', 'pending']);
    });

    it('should call eth_sendRawTransaction with correct params', async () => {
      mockPost.mockResolvedValue({
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: '0xTX_HASH',
        },
      });

      const result = await rpcClient.sendRawTransaction('0xSIGNED_TX');
      expect(result).toBe('0xTX_HASH');
    });

    it('should call eth_estimateGas and return gas limit', async () => {
      mockPost.mockResolvedValue({
        data: { jsonrpc: '2.0', id: 1, result: '0x5208' },
      });

      const result = await rpcClient.estimateGas(
        '0xFrom',
        '0xTo',
        '0xDE0B6B3A7640000',
      );
      expect(result).toBe('0x5208');
    });

    it('should call eth_call for contract queries', async () => {
      mockPost.mockResolvedValue({
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: '0x0000000000000000000000001234567890123456789012345678901234567890',
        },
      });

      const result = await rpcClient.callContract(
        '0xContract',
        '0xDATA',
        'latest',
      );
      expect(result).toContain('0x');
    });
  });
});
