import { Module, Global } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { RpcClient } from './rpc-client';

@Global()
@Module({
  providers: [BlockchainService, RpcClient],
  exports: [BlockchainService, RpcClient],
})
export class BlockchainModule {}
