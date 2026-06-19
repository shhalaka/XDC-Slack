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

      if (actionId.startsWith('tx_approve_')) {
        try {
          const result = await this.transactionService.confirm({
            transactionId,
            slackId: user.id,
            approved: true,
          });

          await this.slackService.updateMessage(
            payload.container.channel_id,
            payload.container.message_ts,
            {
              text: 'Transaction processed',
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: result.status === 'broadcast'
                      ? `✅ *Transaction broadcasted!*\nHash: \`${result.txHash}\``
                      : `❌ *Transaction failed*`,
                  },
                },
              ],
            },
          );
        } catch (error) {
          await this.slackService.postEphemeral(
            payload.container.channel_id,
            user.id,
            {
              text: `Error: ${(error as Error).message}`,
              blocks: SlackService.buildErrorBlocks((error as Error).message),
            },
          );
        }
      } else if (actionId.startsWith('tx_cancel_')) {
        await this.transactionService.confirm({
          transactionId,
          slackId: user.id,
          approved: false,
        });

        await this.slackService.updateMessage(
          payload.container.channel_id,
          payload.container.message_ts,
          {
            text: 'Transaction cancelled',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '❌ *Transaction cancelled.*',
                },
              },
            ],
          },
        );
      }
    }

    return { ok: true };
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
