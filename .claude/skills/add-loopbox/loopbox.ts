import { anyApi } from 'convex/api';
import { ConvexClient } from 'convex/browser';

import { logger } from '../logger.js';
import { Channel } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

const CONVEX_URL = 'https://bright-dove-738.eu-west-1.convex.cloud';
const TOKEN = 'nanoclaw-secret-2024';
const AGENT_ID = 'kh7bmtgyv59bddgydbrwhkzdbd83f8nq';

interface LoopboxTask {
  taskId: string;
  taskName: string;
  lastMessage: string;
  chat: Array<{ sender: string; message: string }>;
}

export class LoopboxChannel implements Channel {
  name = 'loopbox';
  private client: ConvexClient;
  private inProgress = new Set<string>();
  private connected = false;
  private opts: ChannelOpts;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
    this.client = new ConvexClient(CONVEX_URL);
  }

  async connect(): Promise<void> {
    this.connected = true;

    this.client.onUpdate(
      anyApi.nanoclaw.getPendingMessages,
      { token: TOKEN },
      async (tasks: LoopboxTask[]) => {
        for (const task of tasks) {
          if (this.inProgress.has(task.taskId)) continue;
          this.inProgress.add(task.taskId);

          const jid = `loopbox:${task.taskId}`;
          this.ensureGroupRegistered(jid, task.taskName, task.taskId);

          // Build full chat history as context so the agent has prior turns
          const history = task.chat
            .map((m) => {
              const role = m.sender === AGENT_ID ? 'Assistant' : 'User';
              return `${role}: ${m.message}`;
            })
            .join('\n');

          this.opts.onMessage(jid, {
            id: task.taskId,
            chat_jid: jid,
            sender: 'user',
            sender_name: 'User',
            content: history,
            timestamp: new Date().toISOString(),
            is_from_me: false,
            is_bot_message: false,
          });
        }
      },
    );

    logger.info('Loopbox channel connected');
  }

  private ensureGroupRegistered(
    jid: string,
    taskName: string,
    taskId: string,
  ): void {
    const groups = this.opts.registeredGroups();
    if (groups[jid]) return;

    // Convex IDs are alphanumeric — first 16 chars give a short, unique folder name
    const folder = `loopbox_${taskId.slice(0, 16)}`;

    this.opts.registerGroup(jid, {
      name: taskName,
      folder,
      trigger: '',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    });

    logger.info({ jid, folder, taskName }, 'Loopbox task group registered');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const taskId = jid.replace('loopbox:', '');
    try {
      await this.client.mutation(anyApi.nanoclaw.respondToTask, {
        token: TOKEN,
        taskId,
        message: text,
      });
      logger.info({ taskId, length: text.length }, 'Loopbox reply sent');
    } catch (err) {
      logger.error({ err, taskId }, 'Failed to send Loopbox reply');
    } finally {
      this.inProgress.delete(taskId);
    }
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('loopbox:');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client.close();
  }
}

registerChannel('loopbox', (opts: ChannelOpts) => new LoopboxChannel(opts));
