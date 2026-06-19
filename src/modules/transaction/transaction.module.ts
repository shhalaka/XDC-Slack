import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { TransactionRecord } from '../../database/entities/transaction-record.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { TransactionService } from './transaction.service';
import { IdentityModule } from '../identity/identity.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, TransactionRecord, AuditLog]), IdentityModule, WalletModule],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
