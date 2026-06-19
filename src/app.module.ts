import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { User } from './database/entities/user.entity';
import { TransactionRecord } from './database/entities/transaction-record.entity';
import { AuditLog } from './database/entities/audit-log.entity';
import { SlackModule } from './modules/slack/slack.module';
import { IdentityModule } from './modules/identity/identity.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SecretsModule } from './shared/secrets/secrets.module';
import { NonceModule } from './shared/nonce/nonce.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('RATE_LIMIT_TTL_MS', 60000),
            limit: config.get<number>('RATE_LIMIT_MAX_REQUESTS', 30),
          },
        ],
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
        entities: [User, TransactionRecord, AuditLog],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: config.get<string>('NODE_ENV') === 'development',
        ssl: config.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    BlockchainModule,
    IdentityModule,
    WalletModule,
    TransactionModule,
    SlackModule,
    MonitoringModule,
    SecretsModule,
    NonceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
