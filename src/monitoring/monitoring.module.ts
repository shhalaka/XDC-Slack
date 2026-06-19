import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AppLogger } from './logger';

@Module({
  controllers: [HealthController],
  providers: [AppLogger],
  exports: [AppLogger],
})
export class MonitoringModule {}
