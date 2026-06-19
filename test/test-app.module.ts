import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import configuration from '../src/config/configuration';
import { SlackController } from '../src/modules/slack/slack.controller';
import { SlackService } from '../src/modules/slack/slack.service';
import { SlackCommandHandler } from '../src/modules/slack/slack.commands';
import { HealthController } from '../src/monitoring/health.controller';
import { AppLogger } from '../src/monitoring/logger';
import { IdentityService } from '../src/modules/identity/identity.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { TransactionService } from '../src/modules/transaction/transaction.service';
import { BlockchainService } from '../src/modules/blockchain/blockchain.service';

/**
 * Test-only AppModule — lightweight, no real database or RPC connections.
 * All services that touch the DB/chain MUST be overridden via
 * Test.createTestingModule().overrideProvider() in each test suite.
 *
 * Service tokens (IdentityService, WalletService, etc.) are declared as
 * dummy providers so that overrideProvider() can replace them.
 * Without this declaration NestJS's DI cannot resolve the tokens.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      ignoreEnvFile: true,
      ignoreEnvVars: true,
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
  ],
  controllers: [SlackController, HealthController],
  providers: [
    AppLogger,
    SlackService,
    SlackCommandHandler,
    // Dummy providers — replaced by overrideProvider() in each test suite
    { provide: IdentityService, useValue: {} },
    { provide: WalletService, useValue: {} },
    { provide: TransactionService, useValue: {} },
    { provide: BlockchainService, useValue: {} },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class TestAppModule {}
