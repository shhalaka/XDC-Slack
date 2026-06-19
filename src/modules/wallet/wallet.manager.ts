import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as CryptoJS from 'crypto-js';

export interface WalletData {
  address: string;
  privateKey: string;
  publicKey: string;
}

@Injectable()
export class WalletManager {
  private readonly logger = new Logger(WalletManager.name);
  private readonly encryptionKey: string;

  constructor(private configService: ConfigService) {
    this.encryptionKey = this.configService.get<string>('wallet.encryptionKey', '');
    if (!this.encryptionKey) {
      this.logger.warn(
        'WALLET_ENCRYPTION_KEY not set. Wallet encryption is disabled (dev mode only).',
      );
    }
  }

  generateWallet(): WalletData {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      publicKey: wallet.publicKey,
    };
  }

  encryptPrivateKey(privateKey: string): string {
    if (!this.encryptionKey) {
      this.logger.warn('Storing private key without encryption (dev mode)');
      return privateKey;
    }
    return CryptoJS.AES.encrypt(privateKey, this.encryptionKey).toString();
  }

  decryptPrivateKey(encryptedKey: string): string {
    if (!this.encryptionKey) {
      return encryptedKey;
    }
    const bytes = CryptoJS.AES.decrypt(encryptedKey, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  async signTransaction(
    privateKey: string,
    tx: {
      to: string;
      value: string;
      gasLimit: string;
      gasPrice: string;
      nonce: number;
      chainId: number;
    },
  ): Promise<string> {
    const wallet = new ethers.Wallet(privateKey);

    const unsignedTx = {
      to: tx.to,
      value: ethers.parseEther(tx.value),
      gasLimit: BigInt(tx.gasLimit),
      gasPrice: BigInt(tx.gasPrice),
      nonce: tx.nonce,
      chainId: tx.chainId,
      type: 0,
    };

    const signedTx = await wallet.signTransaction(unsignedTx);
    return signedTx;
  }
}
