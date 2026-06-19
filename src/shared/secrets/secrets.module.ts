import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SecretsService } from './secrets.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
