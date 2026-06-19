import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { RpcClient } from '../blockchain/rpc-client';
import { SecretsService } from '../../shared/secrets/secrets.service';

export interface IIdentityResolver {
  resolve(txdcName: string): Promise<string | null>;
  register(txdcName: string, address: string): Promise<string>;
  transfer(txdcName: string, newOwner: string): Promise<string>;
  reverseResolve(address: string): Promise<string | null>;
  isRegistered(txdcName: string): Promise<boolean>;
}

const REGISTRY_ABI = [
  'function resolve(string name) view returns (address)',
  'function resolve(bytes32 nameHash) view returns (address)',
  'function registerByRegistrar(string name, address owner) returns (bool)',
  'function transfer(string name, address newOwner)',
  'function reverseResolve(address addr) view returns (string)',
  'function isRegistered(string name) view returns (bool)',
  'function ownerOfName(string name) view returns (address)',
];

@Injectable()
export class IdentityResolver implements IIdentityResolver {
  private readonly logger = new Logger(IdentityResolver.name);
  private readonly iface: ethers.Interface;
  private registrarWallet: ethers.Wallet | null = null;
  private registrarWalletPromise: Promise<ethers.Wallet> | null = null;

  constructor(
    private configService: ConfigService,
    private rpcClient: RpcClient,
    private secretsService: SecretsService,
  ) {
    this.iface = new ethers.Interface(REGISTRY_ABI);
  }

  private get registryAddress(): string {
    return this.configService.get<string>('identityRegistry.address', '');
  }

  private get rpcUrl(): string {
    return this.configService.get<string>('rpc.url', 'http://localhost:8545');
  }

  private get isOnChain(): boolean {
    return !!this.registryAddress;
  }

  private get provider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(this.rpcUrl);
  }

  private async getRegistrarWallet(): Promise<ethers.Wallet> {
    if (this.registrarWallet) return this.registrarWallet;

    if (!this.registrarWalletPromise) {
      this.registrarWalletPromise = this.secretsService.getRegistrarPrivateKey().then((key) => {
        const wallet = new ethers.Wallet(key, this.provider);
        this.registrarWallet = wallet;
        return wallet;
      });
    }

    return this.registrarWalletPromise;
  }

  private stripSuffix(name: string): string {
    return name.replace(/@txdc$/i, '').toLowerCase();
  }

  async resolve(txdcName: string): Promise<string | null> {
    if (!this.isOnChain) return null;

    const name = this.stripSuffix(txdcName);
    const data = this.iface.encodeFunctionData('resolve(string)', [name]);

    try {
      const result = await this.rpcClient.callContract(this.registryAddress, data);
      const [address] = this.iface.decodeFunctionResult('resolve(string)', result);
      const addr = address as string;
      return addr === ethers.ZeroAddress ? null : addr;
    } catch (error) {
      this.logger.warn(`On-chain resolve failed for ${txdcName}: ${(error as Error).message}`);
      return null;
    }
  }

  async register(txdcName: string, address: string): Promise<string> {
    if (!this.isOnChain) throw new Error('IdentityRegistry not configured');

    const name = this.stripSuffix(txdcName);
    this.logger.log(`Registering on-chain: ${name} → ${address}`);

    const registrar = await this.getRegistrarWallet();
    const data = this.iface.encodeFunctionData('registerByRegistrar(string,address)', [name, address]);
    const tx = await registrar.sendTransaction({
      to: this.registryAddress,
      data,
    });

    const receipt = await tx.wait();
    this.logger.log(`On-chain register tx: ${tx.hash} (block ${receipt!.blockNumber})`);
    return tx.hash;
  }

  async transfer(txdcName: string, newOwner: string): Promise<string> {
    if (!this.isOnChain) throw new Error('IdentityRegistry not configured');

    const name = this.stripSuffix(txdcName);
    this.logger.log(`Transferring on-chain: ${name} → ${newOwner}`);

    const registrar = await this.getRegistrarWallet();
    const data = this.iface.encodeFunctionData('transfer(string,address)', [name, newOwner]);
    const tx = await registrar.sendTransaction({
      to: this.registryAddress,
      data,
    });

    const receipt = await tx.wait();
    this.logger.log(`On-chain transfer tx: ${tx.hash} (block ${receipt!.blockNumber})`);
    return tx.hash;
  }

  async reverseResolve(address: string): Promise<string | null> {
    if (!this.isOnChain) return null;

    const data = this.iface.encodeFunctionData('reverseResolve(address)', [address]);

    try {
      const result = await this.rpcClient.callContract(this.registryAddress, data);
      const [name] = this.iface.decodeFunctionResult('reverseResolve(address)', result);
      const resolved = name as string;
      return resolved || null;
    } catch (error) {
      this.logger.warn(`On-chain reverseResolve failed for ${address}: ${(error as Error).message}`);
      return null;
    }
  }

  async isRegistered(txdcName: string): Promise<boolean> {
    const address = await this.resolve(txdcName);
    return address !== null;
  }

  async ownerOf(txdcName: string): Promise<string | null> {
    return this.resolve(txdcName);
  }
}
