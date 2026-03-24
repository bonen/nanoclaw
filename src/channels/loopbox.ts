import { anyApi } from 'convex/server';
import { ConvexClient } from 'convex/browser';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { Channel } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

const DEFAULT_CONVEX_URL = 'https://convex.loopbox.one';

interface LoopboxTask {
  _id: string;
  name: string;
  context: string;
  details?: string | null;
  labels?: Array<{ id: string; name: string; color: string }>;
  assignmentMessage?: string | null;
  formAction?: Record<string, unknown> | null;
}

export class LoopboxChannel implements Channel {
  name = 'loopbox';
  private client: ConvexClient;
  private inProgress = new Set<string>();
  private connected = false;
  private opts: ChannelOpts;

  constructor(
    opts: ChannelOpts,
    private token: string,
    convexUrl: string,
  ) {
    this.opts = opts;
    this.client = new ConvexClient(convexUrl);
  }

  async connect(): Promise<void> {
    this.connected = true;

    this.client.onUpdate(
      anyApi.agents.getAssignedTasks,
      { token: this.token },
      async (tasks: LoopboxTask[]) => {
        for (const task of tasks) {
          if (this.inProgress.has(task._id)) continue;
          this.inProgress.add(task._id);

          const jid = `loopbox:${task._id}`;
          const timestamp = new Date().toISOString();
          this.opts.onChatMetadata(jid, timestamp, task.name, 'loopbox', false);
          this.ensureGroupRegistered(jid, task.name, task._id);

          this.opts.onMessage(jid, {
            id: task._id,
            chat_jid: jid,
            sender: 'user',
            sender_name: 'User',
            content: task.context,
            timestamp,
            is_from_me: false,
            is_bot_message: false,
          });
        }
      },
    );

    // Register IPC action handlers for container agents
    this.opts.registerAction(
      'loopbox_update_task',
      async (sourceGroup, _isMain, payload) => {
        const { loopboxTaskId, message, details, labelIds, reassignToUserId } =
          payload as {
            loopboxTaskId?: string;
            message?: string;
            details?: string;
            labelIds?: string[];
            reassignToUserId?: string;
          };
        if (!loopboxTaskId) return;

        // Auth: only the loopbox group that owns this task
        if (sourceGroup !== `loopbox_${loopboxTaskId.slice(0, 16)}`) {
          logger.warn(
            { sourceGroup, loopboxTaskId },
            'Unauthorized loopbox_update_task blocked',
          );
          return;
        }

        try {
          const updates: Record<string, unknown> = {
            token: this.token,
            taskId: loopboxTaskId,
          };
          if (message !== undefined) updates.message = message;
          if (details !== undefined) updates.details = details;
          if (labelIds !== undefined) updates.labelIds = labelIds;
          if (reassignToUserId !== undefined)
            updates.reassignToUserId = reassignToUserId;

          await this.client.mutation(anyApi.agents.updateTask, updates);
          this.inProgress.delete(loopboxTaskId);
          logger.info({ loopboxTaskId }, 'Loopbox task updated via IPC');
        } catch (err) {
          logger.error({ err, loopboxTaskId }, 'Failed to update Loopbox task');
        }
      },
    );

    this.opts.registerAction(
      'loopbox_create_task',
      async (_sourceGroup, _isMain, payload) => {
        const { name, description } = payload as {
          name?: string;
          description?: string;
        };
        if (!name) return;

        try {
          await this.client.mutation(anyApi.channels.addTaskViaToken, {
            token: this.token,
            name,
            ...(description ? { description } : {}),
          });
          logger.info({ name }, 'Loopbox task created via IPC');
        } catch (err) {
          logger.error({ err, name }, 'Failed to create Loopbox task');
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
      await this.client.mutation(anyApi.agents.submitWork, {
        token: this.token,
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

registerChannel('loopbox', (opts: ChannelOpts) => {
  const { LOOPBOX_TOKEN, LOOPBOX_URL } = readEnvFile([
    'LOOPBOX_TOKEN',
    'LOOPBOX_URL',
  ]);
  if (!LOOPBOX_TOKEN) return null;
  return new LoopboxChannel(
    opts,
    LOOPBOX_TOKEN,
    LOOPBOX_URL || DEFAULT_CONVEX_URL,
  );
});
