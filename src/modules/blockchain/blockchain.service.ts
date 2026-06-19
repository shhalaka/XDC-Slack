import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { RpcClient, TransactionReceipt, TransactionInfo } from './rpc-client';

export interface BalanceResult {
  address: string;
  balanceWei: string;
  balanceFormatted: string;
  symbol: string;
  decimals: number;
}

export interface GasEstimateResult {
  gasLimit: string;
  gasPrice: string;
  estimatedCostWei: string;
  estimatedCostFormatted: string;
}

export interface TransactionResult {
  txHash: string;
  from: string;
  to: string;
  value: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string;
  gasUsed?: string;
}

export interface TransactionDetails {
  hash: string;
  blockNumber: string | null;
  blockHash: string | null;
  from: string;
  to: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  gasUsed: string | null;
  nonce: number;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: string | null;
}

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly tokenAddress: string;
  private readonly tokenDecimals: number;
  private readonly tokenSymbol: string;
  private readonly nativeCurrency: string;
  private readonly chainId: number;

  constructor(
    private rpcClient: RpcClient,
    private configService: ConfigService,
  ) {
    this.tokenAddress = this.configService.get<string>('token.address', '');
    this.tokenDecimals = this.configService.get<number>('token.decimals', 18);
    this.tokenSymbol = this.configService.get<string>('token.symbol', 'TXDC');
    this.nativeCurrency = this.configService.get<string>('token.nativeCurrency', 'TXDC');
    this.chainId = this.configService.get<number>('rpc.chainId', 8888);
  }

  async getNativeBalance(address: string): Promise<BalanceResult> {
    const balanceWei = await this.rpcClient.getBalance(address);
    const balanceFormatted = ethers.formatEther(balanceWei);

    return {
      address,
      balanceWei,
      balanceFormatted,
      symbol: this.nativeCurrency,
      decimals: 18,
    };
  }

  async getTokenBalance(address: string): Promise<BalanceResult> {
    if (!this.tokenAddress) {
      return this.getNativeBalance(address);
    }

    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ];

    const iface = new ethers.Interface(erc20Abi);
    const data = iface.encodeFunctionData('balanceOf', [address]);

    const result = await this.rpcClient.callContract(this.tokenAddress, data);
    const [balance] = iface.decodeFunctionResult('balanceOf', result);

    const balanceFormatted = ethers.formatUnits(balance, this.tokenDecimals);

    return {
      address,
      balanceWei: balance.toString(),
      balanceFormatted,
      symbol: this.tokenSymbol,
      decimals: this.tokenDecimals,
    };
  }

  async getBalance(address: string): Promise<BalanceResult> {
    return this.tokenAddress
      ? this.getTokenBalance(address)
      : this.getNativeBalance(address);
  }

  async estimateGas(
    from: string,
    to: string,
    value: string,
  ): Promise<GasEstimateResult> {
    const hexValue = ethers.toBeHex(ethers.parseEther(value));

    const [gasLimit, gasPrice] = await Promise.all([
      this.rpcClient.estimateGas(from, to, hexValue),
      this.rpcClient.getGasPrice(),
    ]);

    const gasLimitBigInt = BigInt(gasLimit);
    const gasPriceBigInt = BigInt(gasPrice);
    const estimatedCost = gasLimitBigInt * gasPriceBigInt;

    return {
      gasLimit: gasLimitBigInt.toString(),
      gasPrice: gasPriceBigInt.toString(),
      estimatedCostWei: estimatedCost.toString(),
      estimatedCostFormatted: ethers.formatEther(estimatedCost.toString()),
    };
  }

  async sendTransaction(
    signedTx: string,
  ): Promise<{ txHash: string }> {
    const txHash = await this.rpcClient.sendRawTransaction(signedTx);
    this.logger.log(`Transaction broadcast: ${txHash}`);
    return { txHash };
  }

  async getTransactionStatus(txHash: string): Promise<TransactionDetails> {
    const [receipt, txInfo] = await Promise.all([
      this.rpcClient.getTransactionReceipt(txHash).catch(() => null),
      this.rpcClient.getTransactionByHash(txHash),
    ]);

    let blockTimestamp: string | null = null;
    if (receipt && receipt.blockNumber) {
      try {
        const block = await this.rpcClient.getBlockByNumber(receipt.blockNumber);
        blockTimestamp = block.timestamp;
      } catch {
        this.logger.warn(`Could not fetch block timestamp for ${receipt.blockNumber}`);
      }
    }

    let status: 'pending' | 'confirmed' | 'failed';
    if (!receipt) {
      status = txInfo ? 'pending' : 'failed';
    } else {
      status = receipt.status === '0x1' ? 'confirmed' : 'failed';
    }

    return {
      hash: txHash,
      blockNumber: receipt?.blockNumber || txInfo?.blockNumber || null,
      blockHash: receipt?.blockHash || txInfo?.blockHash || null,
      from: txInfo?.from || '',
      to: txInfo?.to || '',
      value: txInfo?.value || '0x0',
      gasLimit: txInfo?.gas || '0x0',
      gasPrice: txInfo?.gasPrice || '0x0',
      gasUsed: receipt?.gasUsed || null,
      nonce: txInfo ? parseInt(txInfo.nonce, 16) : 0,
      status,
      timestamp: blockTimestamp,
    };
  }

  async getBlockNumber(): Promise<number> {
    const hex = await this.rpcClient.getBlockNumber();
    return parseInt(hex, 16);
  }

  async getTransactionCount(address: string, blockTag: string = 'pending'): Promise<number> {
    const hex = await this.rpcClient.getTransactionCount(address, blockTag);
    return parseInt(hex, 16);
  }

  async getChainId(): Promise<number> {
    return this.rpcClient.chainId();
  }
}
