import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SecretsProvider {
  getRegistrarPrivateKey(): Promise<string>;
  getWalletEncryptionKey(): Promise<string>;
}

@Injectable()
export class SecretsService implements SecretsProvider {
  private readonly logger = new Logger(SecretsService.name);

  constructor(private configService: ConfigService) {
    const registrarKey = this.configService.get<string>('identityRegistry.registrarPrivateKey', '');
    const walletKey = this.configService.get<string>('wallet.encryptionKey', '');
    if (registrarKey) {
      this.logger.warn(
        'Registrar private key loaded from env. For production, use a secrets manager (Vault, AWS Secrets Manager, etc.).',
      );
    }
    if (walletKey && walletKey === 'dev-only-insecure-key') {
      this.logger.warn(
        'WALLET_ENCRYPTION_KEY is set to an insecure dev-only value. Set a strong random key for production.',
      );
    }
  }

  async getRegistrarPrivateKey(): Promise<string> {
    const key = this.configService.get<string>('identityRegistry.registrarPrivateKey', '');
    if (!key) {
      throw new Error('Registrar private key not configured');
    }
    return key;
  }

  async getWalletEncryptionKey(): Promise<string> {
    return this.configService.get<string>('wallet.encryptionKey', '');
  }
}
