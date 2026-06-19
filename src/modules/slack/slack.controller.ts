import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SlackSignatureGuard } from '../../common/guards/slack-signature.guard';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { SlackService } from './slack.service';
import { SlackCommandHandler } from './slack.commands';
import { TransactionService } from '../transaction/transaction.service';

@Controller('slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(
    private slackService: SlackService,
    private commandHandler: SlackCommandHandler,
    private transactionService: TransactionService,
  ) {}

  @Post('commands')
  @SkipTransform()
  @UseGuards(SlackSignatureGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async handleSlashCommand(@Body() body: Record<string, string>) {
    this.logger.log(
      `Slash command: ${body.command} ${body.text} from user ${body.user_id}`,
    );

    const result = await this.commandHandler.handle({
      command: body.command,
      text: body.text || '',
      user_id: body.user_id,
      user_name: body.user_name,
      team_id: body.team_id,
      channel_id: body.channel_id,
      response_url: body.response_url,
      trigger_id: body.trigger_id,
    });

    return {
      response_type: result.response_type || 'ephemeral',
      text: result.text || '',
      blocks: result.blocks || [],
    };
  }

  @Post('interactions')
  @SkipTransform()
  @UseGuards(SlackSignatureGuard)
  async handleInteractions(@Body() body: Record<string, unknown>) {
    const payload =
      typeof body.payload === 'string' ? JSON.parse(body.payload as string) : body.payload;

    this.logger.log(
      `Interaction: ${payload.type} — action: ${payload.actions?.[0]?.action_id}`,
    );

    if (payload.type === 'block_actions') {
      const action = payload.actions?.[0];
      if (!action) return { ok: false };

      const actionId = action.action_id as string;
      const transactionId = action.value as string;
      const user = payload.user as { id: string; username: string };
      const responseUrl = payload.response_url as string;

      // Process asynchronously — acknowledge interaction immediately
      if (actionId.startsWith('tx_approve_')) {
        this.handleApproval(responseUrl, transactionId, user.id).catch((err) =>
          this.logger.error(`Approval handler failed: ${err.message}`),
        );
      } else if (actionId.startsWith('tx_cancel_')) {
        this.handleCancellation(responseUrl, transactionId, user.id).catch((err) =>
          this.logger.error(`Cancellation handler failed: ${err.message}`),
        );
      }
    }

    return { ok: true };
  }

  private async handleApproval(
    responseUrl: string,
    transactionId: string,
    slackId: string,
  ): Promise<void> {
    try {
      const result = await this.transactionService.confirm({
        transactionId,
        slackId,
        approved: true,
      });

      if (result.status === 'broadcast') {
        await this.slackService.respondToInteraction(responseUrl, {
          text: `✅ Transaction broadcasted: ${result.txHash}`,
          blocks: SlackService.buildTransactionResultBlocks(
            result.senderIdentity || '',
            result.receiverIdentity || '',
            result.amount || '0',
            'TXDC',
            result.txHash,
            result.status,
          ),
        });
      } else {
        await this.slackService.respondToInteraction(responseUrl, {
          text: '❌ Transaction failed',
          blocks: SlackService.buildErrorBlocks('Transaction failed during broadcast.'),
        });
      }
    } catch (error) {
      this.logger.error(`Approval failed: ${(error as Error).message}`);
      await this.slackService.respondToInteraction(responseUrl, {
        text: '❌ Transaction failed',
        blocks: SlackService.buildErrorBlocks((error as Error).message),
      }).catch((e) => this.logger.error(`Failed to send error response: ${e.message}`));
    }
  }

  private async handleCancellation(
    responseUrl: string,
    transactionId: string,
    slackId: string,
  ): Promise<void> {
    try {
      const result = await this.transactionService.confirm({
        transactionId,
        slackId,
        approved: false,
      });

      await this.slackService.respondToInteraction(responseUrl, {
        text: 'Transaction cancelled',
        blocks: SlackService.buildTransactionResultBlocks(
          result.senderIdentity || '',
          result.receiverIdentity || '',
          result.amount || '0',
          'TXDC',
          '',
          'rejected',
        ),
      });
    } catch (error) {
      this.logger.error(`Cancellation failed: ${(error as Error).message}`);
      await this.slackService.respondToInteraction(responseUrl, {
        text: '❌ Error',
        blocks: SlackService.buildErrorBlocks((error as Error).message),
      }).catch((e) => this.logger.error(`Failed to send error response: ${e.message}`));
    }
  }

  @Post('events')
  @SkipTransform()
  @UseGuards(SlackSignatureGuard)
  async handleEvents(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const event = body.event as Record<string, unknown> | undefined;

    if (body.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    if (event) {
      this.logger.log(`Slack event: ${event.type}`);
    }

    return { ok: true };
  }

  @Post('oauth/callback')
  @SkipTransform()
  async handleOAuthCallback(@Req() req: Request) {
    this.logger.log('OAuth callback received');
    return { ok: true };
  }
}
