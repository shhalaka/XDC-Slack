import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import axios from 'axios';

export interface SlackMessage {
  text?: string;
  blocks?: unknown[];
  ephemeral?: boolean;
  channel?: string;
  user?: string;
}

/**
 * Slack Block Kit builder — all responses use rich blocks for production UX.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly client: WebClient;

  constructor(private configService: ConfigService) {
    const token = configService.get<string>('slack.botToken', '');
    this.client = new WebClient(token);
  }

  getClient(): WebClient {
    return this.client;
  }

  async postEphemeral(channel: string, user: string, message: SlackMessage) {
    try {
      await this.client.chat.postEphemeral({
        channel,
        user,
        text: message.text || '',
        blocks: message.blocks as any[],
      });
    } catch (error) {
      this.logger.error(`Failed to send ephemeral message: ${(error as Error).message}`);
    }
  }

  async postMessage(channel: string, message: SlackMessage) {
    try {
      await this.client.chat.postMessage({
        channel,
        text: message.text || '',
        blocks: message.blocks as any[],
      });
    } catch (error) {
      this.logger.error(`Failed to post message: ${(error as Error).message}`);
    }
  }

  async updateMessage(channel: string, ts: string, message: SlackMessage) {
    try {
      await this.client.chat.update({
        channel,
        ts,
        text: message.text || '',
        blocks: message.blocks as any[],
      });
    } catch (error) {
      this.logger.error(`Failed to update message: ${(error as Error).message}`);
    }
  }

  async respondToInteraction(responseUrl: string, message: SlackMessage): Promise<void> {
    try {
      await axios.post(responseUrl, {
        text: message.text || '',
        blocks: message.blocks || [],
        replace_original: true,
      });
    } catch (error) {
      this.logger.error(`Failed to respond to interaction: ${(error as Error).message}`);
    }
  }

  static buildWelcomeBlocks(): unknown[] {
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚀 Welcome to TXDC Assistant', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Send blockchain payments using human-readable identities like *`alice@txdc`*.\n\n' +
                '_Think UPI, but on the blockchain._',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Available Commands:*\n\n' +
                '• `/txdc register <name>@txdc` — Register your blockchain identity\n' +
                '• `/txdc wallet` — View your wallet and balance\n' +
                '• `/txdc balance <name>@txdc` — Check someone\'s balance\n' +
                '• `/txdc send <from> <to> <amount>` — Send TXDC\n' +
                '• `/txdc transaction <hash>` — Track a transaction\n' +
                '• `/txdc history <name>@txdc` — View transaction history\n' +
                '• `/txdc help` — Show this message',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'TXDC Assistant v1.0.0 | Secure blockchain payments via Slack',
          },
        ],
      },
    ];
  }

  static buildWalletBlocks(
    address: string,
    balance: string,
    symbol: string,
    chainName: string,
    blockNumber: number,
    txdcName: string,
  ): unknown[] {
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: '👛 Your Wallet', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Identity:*\n${txdcName}` },
          { type: 'mrkdwn', text: `*Balance:*\n${balance} ${symbol}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Address:*\n\`${address.slice(0, 10)}...${address.slice(-6)}\`` },
          { type: 'mrkdwn', text: `*Network:*\n${chainName}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Block #${blockNumber} | Full address: \`${address}\``,
          },
        ],
      },
    ];
  }

  static buildTransactionConfirmBlocks(
    fromIdentity: string,
    toIdentity: string,
    amount: string,
    symbol: string,
    estimatedGas: string,
    transactionId: string,
  ): unknown[] {
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⚠️ Confirm Transaction', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Please review and confirm the transaction details below:',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*From:*\n${fromIdentity}` },
          { type: 'mrkdwn', text: `*To:*\n${toIdentity}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Amount:*\n${amount} ${symbol}` },
          { type: 'mrkdwn', text: `*Est. Gas:*\n${estimatedGas} ${symbol}` },
        ],
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve', emoji: true },
            style: 'primary',
            action_id: `tx_approve_${transactionId}`,
            value: transactionId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Cancel', emoji: true },
            style: 'danger',
            action_id: `tx_cancel_${transactionId}`,
            value: transactionId,
          },
        ],
      },
    ];
  }

  static buildTransactionResultBlocks(
    fromIdentity: string,
    toIdentity: string,
    amount: string,
    symbol: string,
    txHash: string,
    status: string,
  ): unknown[] {
    const isRejected = status === 'rejected';
    const isSuccess = !isRejected && (status === 'broadcast' || status === 'confirmed');

    let headerText: string;
    let statusText: string;
    if (isSuccess) {
      headerText = '✅ Transaction Successful';
      statusText = status === 'broadcast' ? '✅ Broadcasted' : '✅ Confirmed';
    } else if (isRejected) {
      headerText = '❌ Transaction Cancelled';
      statusText = '❌ Cancelled';
    } else {
      headerText = '❌ Transaction Failed';
      statusText = '❌ Failed';
    }

    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: headerText, emoji: true },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*From:*\n${fromIdentity}` },
          { type: 'mrkdwn', text: `*To:*\n${toIdentity}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Amount:*\n${amount} ${symbol}` },
          { type: 'mrkdwn', text: `*Status:*\n${statusText}` },
        ],
      },
    ];

    if (txHash) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Transaction Hash:*\n\`${txHash}\``,
        },
      });
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Track: /txdc transaction ${txHash.slice(0, 10)}...`,
          },
        ],
      });
    }

    return blocks;
  }

  static buildBalanceBlocks(
    txdcName: string,
    address: string,
    balance: string,
    symbol: string,
  ): unknown[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💰 *${txdcName}* balance: *${balance} ${symbol}*`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Address: \`${address}\``,
          },
        ],
      },
    ];
  }

  static buildTransactionDetailBlocks(
    details: {
      hash: string;
      status: string;
      from: string;
      to: string;
      value: string;
      symbol: string;
      blockNumber?: string;
      gasUsed?: string;
      timestamp?: string;
    },
  ): unknown[] {
    const statusEmoji =
      details.status === 'confirmed'
        ? '✅'
        : details.status === 'pending'
          ? '⏳'
          : '❌';

    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${statusEmoji} Transaction Details`, emoji: true },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Status:*\n${details.status}` },
          { type: 'mrkdwn', text: `*Amount:*\n${details.value} ${details.symbol}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*From:*\n\`${details.from}\`` },
          { type: 'mrkdwn', text: `*To:*\n\`${details.to}\`` },
        ],
      },
    ];

    if (details.blockNumber) {
      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Block:*\n${details.blockNumber}` },
          { type: 'mrkdwn', text: details.gasUsed ? `*Gas Used:*\n${details.gasUsed}` : '*Gas Used:*\n—' },
        ],
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Hash: \`${details.hash}\``,
        },
      ],
    });

    return blocks;
  }

  static buildHistoryBlocks(
    txdcName: string,
    transactions: Array<{
      amount: string;
      senderIdentity: string;
      receiverIdentity: string;
      status: string;
      createdAt: string;
      txHash?: string;
    }>,
    total: number,
  ): unknown[] {
    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📜 Transaction History: ${txdcName}`, emoji: true },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Showing ${transactions.length} of ${total} transactions`,
          },
        ],
      },
      { type: 'divider' },
    ];

    for (const tx of transactions.slice(0, 10)) {
      const isSender = tx.senderIdentity === txdcName.toLowerCase();
      const prefix = isSender ? '↗️ Sent' : '↙️ Received';
      const other = isSender ? tx.receiverIdentity : tx.senderIdentity;
      const statusEmoji =
        tx.status === 'confirmed' ? '✅' : tx.status === 'pending' ? '⏳' : '❌';
      const date = new Date(tx.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${prefix} *${tx.amount}* TXDC ${statusEmoji}\n${isSender ? 'To' : 'From'}: ${other} • ${date}`,
        },
      } as never);
    }

    if (transactions.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No transactions found.',
        },
      } as never);
    }

    return blocks;
  }

  static buildErrorBlocks(errorMessage: string): unknown[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠️ *Error:*\n${errorMessage}`,
        },
      },
    ];
  }
}
