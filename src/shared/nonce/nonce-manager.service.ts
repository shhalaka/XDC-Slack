import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RpcClient } from '../../modules/blockchain/rpc-client';

@Injectable()
export class NonceManager implements OnModuleDestroy {
  private readonly logger = new Logger(NonceManager.name);
  private readonly redis: Redis | null = null;
  private readonly useRedis: boolean;
  private localNonces = new Map<string, number>();

  constructor(
    private configService: ConfigService,
    private rpcClient: RpcClient,
  ) {
    const redisUrl = this.configService.get<string>('redis.url', '');
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 50, 500)),
          lazyConnect: true,
        });
        this.redis.connect().catch(() => {
          this.logger.warn('Redis connection failed — falling back to local nonce tracking');
        });
        this.useRedis = true;
      } catch {
        this.logger.warn('Failed to create Redis client — falling back to local nonce tracking');
        this.useRedis = false;
      }
    } else {
      this.useRedis = false;
      this.logger.warn('No REDIS_URL configured — using in-memory nonce tracking (resets on restart)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
    }
  }

  async nextNonce(address: string): Promise<number> {
    const onChainNonce = await this.rpcClient.getTransactionCount(address, 'pending');
    const onChainNonceNum = parseInt(onChainNonce, 16);

    let baseNonce: number;
    if (this.useRedis && this.redis) {
      try {
        const redisKey = `nonce:${address.toLowerCase()}`;
        const stored = await this.redis.get(redisKey);
        const storedNum = stored ? parseInt(stored, 10) : -1;
        baseNonce = Math.max(onChainNonceNum, storedNum);
        await this.redis.set(redisKey, (baseNonce + 1).toString());
        this.logger.debug(`Nonce ${baseNonce} for ${address} (on-chain: ${onChainNonceNum}, stored: ${storedNum})`);
        return baseNonce;
      } catch (error) {
        this.logger.warn(`Redis nonce fetch failed: ${(error as Error).message} — using local fallback`);
      }
    }

    const storedNum = this.localNonces.get(address.toLowerCase()) ?? -1;
    baseNonce = Math.max(onChainNonceNum, storedNum);
    this.localNonces.set(address.toLowerCase(), baseNonce + 1);
    this.logger.debug(`Nonce ${baseNonce} for ${address} (local fallback, on-chain: ${onChainNonceNum})`);
    return baseNonce;
  }

  async resetNonce(address: string): Promise<void> {
    const addr = address.toLowerCase();
    if (this.useRedis && this.redis) {
      try {
        await this.redis.del(`nonce:${addr}`);
      } catch {}
    }
    this.localNonces.delete(addr);
  }
}
