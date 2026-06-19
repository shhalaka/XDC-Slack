import { Module } from '@nestjs/common';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { SlackCommandHandler } from './slack.commands';
import { IdentityModule } from '../identity/identity.module';
import { WalletModule } from '../wallet/wallet.module';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [IdentityModule, WalletModule, TransactionModule],
  controllers: [SlackController],
  providers: [SlackService, SlackCommandHandler],
  exports: [SlackService],
})
export class SlackModule {}
