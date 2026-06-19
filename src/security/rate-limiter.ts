import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);
  private store = new Map<string, RateLimitEntry>();
  private readonly defaultTtl: number;
  private readonly defaultMaxRequests: number;

  constructor(private configService: ConfigService) {
    this.defaultTtl = this.configService.get<number>('rateLimit.ttlMs', 60000);
    this.defaultMaxRequests = this.configService.get<number>(
      'rateLimit.maxRequests',
      30,
    );
  }

  check(key: string, maxRequests?: number, ttlMs?: number): boolean {
    const limit = maxRequests || this.defaultMaxRequests;
    const ttl = ttlMs || this.defaultTtl;
    const now = Date.now();

    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + ttl });
      return true;
    }

    if (entry.count >= limit) {
      this.logger.warn(`Rate limit exceeded for key: ${key}`);
      return false;
    }

    entry.count++;
    return true;
  }

  getRemaining(key: string, maxRequests?: number): number {
    const limit = maxRequests || this.defaultMaxRequests;
    const entry = this.store.get(key);
    if (!entry) return limit;
    return Math.max(0, limit - entry.count);
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}
