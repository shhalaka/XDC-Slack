import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { IdentityService } from './identity.service';
import { IdentityResolver } from './identity.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([User, AuditLog])],
  providers: [IdentityService, IdentityResolver],
  exports: [IdentityService, IdentityResolver],
})
export class IdentityModule {}
