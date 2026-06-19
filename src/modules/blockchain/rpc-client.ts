import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

export interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export interface BlockInfo {
  number: string;
  hash: string;
  timestamp: string;
  transactions: string[];
}

export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  from: string;
  to: string;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  status: string;
  logs: unknown[];
}

export interface TransactionInfo {
  hash: string;
  blockNumber: string;
  blockHash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  input: string;
  nonce: string;
}

@Injectable()
export class RpcClient {
  private readonly logger = new Logger(RpcClient.name);
  private readonly clients: AxiosInstance[];
  private readonly wsUrl: string;
  private readonly networkChainId: number;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryDelayMs: number;
  private requestId = 1;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('rpc.url', 'http://localhost:8545');
    const fallbackUrls = this.configService.get<string[]>('rpc.fallbackUrls', []);
    this.wsUrl = this.configService.get<string>('rpc.wsUrl', 'ws://localhost:8546');
    this.networkChainId = this.configService.get<number>('rpc.chainId', 8888);
    this.timeoutMs = this.configService.get<number>('rpc.timeoutMs', 30000);
    this.retryCount = this.configService.get<number>('rpc.retryCount', 3);
    this.retryDelayMs = this.configService.get<number>('rpc.retryDelayMs', 1000);

    const urls = [rpcUrl, ...fallbackUrls];
    this.clients = urls.map((url) =>
      axios.create({
        baseURL: url,
        timeout: this.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    this.logger.log(`RPC Client initialized with ${this.clients.length} node(s)`);
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      for (const [index, client] of this.clients.entries()) {
        try {
          const request: RpcRequest = {
            jsonrpc: '2.0',
            id: this.requestId++,
            method,
            params,
          };

          const startTime = Date.now();
          const response = await client.post<RpcResponse<T>>('/', request);
          const latency = Date.now() - startTime;

          this.logger.debug(`RPC ${method} on node[${index}] - ${latency}ms`);

          if (response.data.error) {
            throw new Error(
              `RPC Error [${response.data.error.code}]: ${response.data.error.message}`,
            );
          }

          if (response.data.result === undefined || response.data.result === null) {
            throw new Error(`RPC returned null/undefined for method ${method}`);
          }

          return response.data.result as T;
        } catch (error) {
          lastError = error as Error;
          this.logger.warn(
            `RPC call failed on node[${index}] attempt[${attempt}]: ${(error as Error).message}`,
          );
        }
      }

      if (attempt < this.retryCount - 1) {
        await this.delay(this.retryDelayMs * (attempt + 1));
      }
    }

    throw new Error(`All RPC nodes failed after ${this.retryCount} retries: ${lastError?.message}`);
  }

  async getBalance(address: string, blockTag: string = 'latest'): Promise<string> {
    return this.call<string>('eth_getBalance', [address, blockTag]);
  }

  async getTransactionCount(address: string, blockTag: string = 'pending'): Promise<string> {
    return this.call<string>('eth_getTransactionCount', [address, blockTag]);
  }

  async sendRawTransaction(signedTx: string): Promise<string> {
    return this.call<string>('eth_sendRawTransaction', [signedTx]);
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt> {
    return this.call<TransactionReceipt>('eth_getTransactionReceipt', [txHash]);
  }

  async getTransactionByHash(txHash: string): Promise<TransactionInfo> {
    return this.call<TransactionInfo>('eth_getTransactionByHash', [txHash]);
  }

  async getBlockNumber(): Promise<string> {
    return this.call<string>('eth_blockNumber', []);
  }

  async getBlockByNumber(blockNumber: string, full: boolean = false): Promise<BlockInfo> {
    return this.call<BlockInfo>('eth_getBlockByNumber', [blockNumber, full]);
  }

  async estimateGas(
    from: string,
    to: string,
    value: string,
    data: string = '0x',
  ): Promise<string> {
    return this.call<string>('eth_estimateGas', [
      { from, to, value, data },
    ]);
  }

  async getGasPrice(): Promise<string> {
    return this.call<string>('eth_gasPrice', []);
  }

  async chainId(): Promise<number> {
    return this.call<number>('eth_chainId', []);
  }

  async callContract(
    contractAddress: string,
    data: string,
    blockTag: string = 'latest',
  ): Promise<string> {
    return this.call<string>('eth_call', [
      { to: contractAddress, data },
      blockTag,
    ]);
  }

  async getLogs(
    fromBlock: string,
    toBlock: string,
    address?: string,
    topics?: string[],
  ): Promise<unknown[]> {
    const params: Record<string, unknown> = { fromBlock, toBlock };
    if (address) params.address = address;
    if (topics) params.topics = topics;
    return this.call<unknown[]>('eth_getLogs', [params]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
