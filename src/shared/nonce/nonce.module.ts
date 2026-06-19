import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NonceManager } from './nonce-manager.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [NonceManager],
  exports: [NonceManager],
})
export class NonceModule {}
