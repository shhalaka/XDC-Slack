import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { WalletService } from './wallet.service';
import { WalletManager } from './wallet.manager';

@Module({
  imports: [TypeOrmModule.forFeature([User, AuditLog])],
  providers: [WalletService, WalletManager],
  exports: [WalletService, WalletManager],
})
export class WalletModule {}
