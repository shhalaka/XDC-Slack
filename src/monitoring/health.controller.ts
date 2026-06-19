import { Controller, Get, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startTime = Date.now();

  @Get()
  check() {
    return {
      status: 'healthy',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  @Get('readiness')
  readiness() {
    return { status: 'ready' };
  }

  @Get('liveness')
  liveness() {
    return { status: 'alive' };
  }
}
