import { Injectable, Logger } from '@nestjs/common';
import { SlackService } from './slack.service';
import { IdentityService } from '../identity/identity.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionService } from '../transaction/transaction.service';
import { BlockchainService } from '../blockchain/blockchain.service';

export interface SlashCommandPayload {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  team_id: string;
  channel_id: string;
  response_url: string;
  trigger_id: string;
}

export interface SlashCommandResult {
  text?: string;
  blocks?: unknown[];
  response_type?: 'ephemeral' | 'in_channel';
}

@Injectable()
export class SlackCommandHandler {
  private readonly logger = new Logger(SlackCommandHandler.name);

  constructor(
    private slackService: SlackService,
    private identityService: IdentityService,
    private walletService: WalletService,
    private transactionService: TransactionService,
    private blockchainService: BlockchainService,
  ) {}

  async handle(payload: SlashCommandPayload): Promise<SlashCommandResult> {
    const { text, user_id } = payload;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || 'help';

    this.logger.log(`Command: /txdc ${text} (user: ${user_id})`);

    try {
      switch (subcommand) {
        case 'register':
          return await this.handleRegister(payload, args);
        case 'wallet':
          return await this.handleWallet(payload);
        case 'balance':
          return await this.handleBalance(payload, args);
        case 'send':
          return await this.handleSend(payload, args);
        case 'transaction':
        case 'tx':
          return await this.handleTransaction(payload, args);
        case 'history':
          return await this.handleHistory(payload, args);
        case 'help':
          return this.handleHelp();
        default:
          return {
            blocks: SlackService.buildErrorBlocks(
              `Unknown command "${subcommand}". Use \`/txdc help\` to see available commands.`,
            ),
          };
      }
    } catch (error) {
      this.logger.error(`Command failed: /txdc ${text} — ${(error as Error).message}`);
      return {
        blocks: SlackService.buildErrorBlocks(
          error instanceof Error ? error.message : 'An unexpected error occurred.',
        ),
      };
    }
  }

  private async handleRegister(
    payload: SlashCommandPayload,
    args: string[],
  ): Promise<SlashCommandResult> {
    if (args.length < 2) {
      return {
        blocks: SlackService.buildErrorBlocks(
          'Usage: `/txdc register <name>@txdc`\nExample: `/txdc register alice@txdc`',
        ),
      };
    }

    const txdcName = args[1].toLowerCase();
    const existing = await this.identityService.getBySlack(payload.user_id);

    if (existing) {
      return {
        blocks: SlackService.buildErrorBlocks(
          `You are already registered as ${existing.txdcName} (wallet: ${existing.walletAddress}).\n` +
          `Use \`/txdc update\` to change your identity or wallet.`,
        ),
      };
    }

    const wallet = await this.walletService.createWallet(payload.user_id);

    const identity = await this.identityService.register({
      slackId: payload.user_id,
      slackTeamId: payload.team_id,
      txdcName,
      walletAddress: wallet.address,
      encryptedPrivateKey: wallet.encryptedKey,
    });

    return {
      response_type: 'in_channel',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🎉 Identity Registered!', emoji: true },
        },
        { type: 'divider' },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*TXDC Name:*\n${identity.txdcName}` },
            { type: 'mrkdwn', text: `*Wallet Address:*\n\`${identity.walletAddress}\`` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Your wallet has been created and securely encrypted. ' +
                  'Use `/txdc wallet` to check your balance.',
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: '⚠️ Store your recovery phrase securely. This is the last time you\'ll see it.' },
          ],
        },
      ],
    };
  }

  private async handleWallet(
    payload: SlashCommandPayload,
  ): Promise<SlashCommandResult> {
    const info = await this.walletService.getWalletInfo(payload.user_id);

    return {
      blocks: SlackService.buildWalletBlocks(
        info.address,
        info.balance.balanceFormatted,
        info.balance.symbol,
        info.network.name,
        info.network.blockNumber,
        info.owner.txdcName,
      ),
    };
  }

  private async handleBalance(
    payload: SlashCommandPayload,
    args: string[],
  ): Promise<SlashCommandResult> {
    if (args.length < 2) {
      return {
        blocks: SlackService.buildErrorBlocks(
          'Usage: `/txdc balance <name>@txdc`\nExample: `/txdc balance alice@txdc`',
        ),
      };
    }

    const txdcName = args[1].toLowerCase();
    const balance = await this.walletService.getBalanceByIdentity(txdcName);

    return {
      blocks: SlackService.buildBalanceBlocks(
        txdcName,
        balance.address,
        balance.balanceFormatted,
        balance.symbol,
      ),
    };
  }

  private async handleSend(
    payload: SlashCommandPayload,
    args: string[],
  ): Promise<SlashCommandResult> {
    if (args.length < 4) {
      return {
        blocks: SlackService.buildErrorBlocks(
          'Usage: `/txdc send <from>@txdc <to>@txdc <amount>`\n' +
          'Example: `/txdc send alice@txdc bob@txdc 10`',
        ),
      };
    }

    const senderIdentity = args[1].toLowerCase();
    const receiverIdentity = args[2].toLowerCase();
    const amount = args[3];

    const result = await this.transactionService.initiate({
      slackId: payload.user_id,
      senderIdentity,
      receiverIdentity,
      amount,
    });

    return {
      blocks: SlackService.buildTransactionConfirmBlocks(
        senderIdentity,
        receiverIdentity,
        amount,
        'TXDC',
        result.estimatedGas || '0',
        result.transactionId,
      ),
    };
  }

  private async handleTransaction(
    payload: SlashCommandPayload,
    args: string[],
  ): Promise<SlashCommandResult> {
    if (args.length < 2) {
      return {
        blocks: SlackService.buildErrorBlocks(
          'Usage: `/txdc transaction <txhash>`\nExample: `/txdc transaction 0x52b0...`',
        ),
      };
    }

    const txHash = args[1];
    const tx = await this.transactionService.getTransaction(txHash);
    const symbol = 'TXDC';

    return {
      blocks: SlackService.buildTransactionDetailBlocks({
        hash: tx.txHash || txHash,
        status: tx.status,
        from: tx.senderAddress || tx.senderIdentity,
        to: tx.receiverAddress || tx.receiverIdentity,
        value: tx.amount,
        symbol,
        blockNumber: tx.blockNumber || undefined,
        gasUsed: tx.gasUsed || undefined,
      }),
    };
  }

  private async handleHistory(
    payload: SlashCommandPayload,
    args: string[],
  ): Promise<SlashCommandResult> {
    if (args.length < 2) {
      return {
        blocks: SlackService.buildErrorBlocks(
          'Usage: `/txdc history <name>@txdc`\nExample: `/txdc history alice@txdc`',
        ),
      };
    }

    const txdcName = args[1].toLowerCase();
    const { transactions, total } = await this.transactionService.getHistory(txdcName);

    return {
      blocks: SlackService.buildHistoryBlocks(
        txdcName,
        transactions.map((tx) => ({
          amount: tx.amount,
          senderIdentity: tx.senderIdentity,
          receiverIdentity: tx.receiverIdentity,
          status: tx.status,
          createdAt: tx.createdAt.toISOString(),
          txHash: tx.txHash || undefined,
        })),
        total,
      ),
    };
  }

  private handleHelp(): SlashCommandResult {
    return {
      blocks: SlackService.buildWelcomeBlocks(),
    };
  }
}
