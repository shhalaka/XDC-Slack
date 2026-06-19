import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { TransactionRecord } from './entities/transaction-record.entity';
import { AuditLog } from './entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, TransactionRecord, AuditLog]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
