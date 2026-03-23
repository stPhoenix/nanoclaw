import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, MAX_CONCURRENT_CONTAINERS } from './config.js';
import { logger } from './logger.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface ContainerSlot {
  active: boolean;
  idleWaiting: boolean;
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
}

interface GroupState {
  message: ContainerSlot;
  task: ContainerSlot;
  runningTaskId: string | null;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  retryCount: number;
}

function newSlot(): ContainerSlot {
  return {
    active: false,
    idleWaiting: false,
    process: null,
    containerName: null,
    groupFolder: null,
  };
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        message: newSlot(),
        task: newSlot(),
        runningTaskId: null,
        pendingMessages: false,
        pendingTasks: [],
        retryCount: 0,
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    if (state.message.active) {
      state.pendingMessages = true;
      logger.debug({ groupJid }, 'Message container active, message queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages').catch((err) =>
      logger.error({ groupJid, err }, 'Unhandled error in runForGroup'),
    );
  }

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Prevent double-queuing: check both pending and currently-running task
    if (state.runningTaskId === taskId) {
      logger.debug({ groupJid, taskId }, 'Task already running, skipping');
      return;
    }
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.task.active) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      logger.debug({ groupJid, taskId }, 'Task container active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, taskId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(groupJid, { id: taskId, groupJid, fn }).catch((err) =>
      logger.error({ groupJid, taskId, err }, 'Unhandled error in runTask'),
    );
  }

  registerProcess(
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder?: string,
    isTask?: boolean,
  ): void {
    const state = this.getGroup(groupJid);
    const slot = isTask ? state.task : state.message;
    slot.process = proc;
    slot.containerName = containerName;
    if (groupFolder) slot.groupFolder = groupFolder;
  }

  /**
   * Mark the container as idle-waiting (finished work, waiting for IPC input).
   */
  notifyIdle(groupJid: string, isTask?: boolean): void {
    const state = this.getGroup(groupJid);
    const slot = isTask ? state.task : state.message;
    slot.idleWaiting = true;
  }

  /**
   * Send a follow-up message to the active message container via IPC file.
   * Returns true if the message was written, false if no active message container.
   */
  sendMessage(groupJid: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.message.active || !state.message.groupFolder) return false;
    state.message.idleWaiting = false; // Agent is about to receive work, no longer idle

    const inputDir = path.join(
      DATA_DIR,
      'ipc',
      state.message.groupFolder,
      'input',
    );
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal a container to wind down by writing a close sentinel.
   */
  closeStdin(groupJid: string, isTask?: boolean): void {
    const state = this.getGroup(groupJid);
    const slot = isTask ? state.task : state.message;
    if (!slot.active || !slot.groupFolder) return;

    const inputDir = path.join(DATA_DIR, 'ipc', slot.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch {
      // ignore
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupJid);
    state.message.active = true;
    state.message.idleWaiting = false;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug(
      { groupJid, reason, activeCount: this.activeCount },
      'Starting message container for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(groupJid, state);
        }
      }
    } catch (err) {
      logger.error({ groupJid, err }, 'Error processing messages for group');
      this.scheduleRetry(groupJid, state);
    } finally {
      state.message.active = false;
      state.message.process = null;
      state.message.containerName = null;
      state.message.groupFolder = null;
      this.activeCount--;
      this.drainGroup(groupJid, 'message');
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.task.active = true;
    state.task.idleWaiting = false;
    state.runningTaskId = task.id;
    this.activeCount++;

    logger.debug(
      { groupJid, taskId: task.id, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, err }, 'Error running task');
    } finally {
      state.task.active = false;
      state.runningTaskId = null;
      state.task.process = null;
      state.task.containerName = null;
      state.task.groupFolder = null;
      this.activeCount--;
      this.drainGroup(groupJid, 'task');
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupJid, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupJid, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupJid);
      }
    }, delayMs);
  }

  private drainGroup(groupJid: string, track: 'message' | 'task'): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    if (track === 'task') {
      // Drain pending tasks
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(groupJid, task).catch((err) =>
          logger.error(
            { groupJid, taskId: task.id, err },
            'Unhandled error in runTask (drain)',
          ),
        );
        return;
      }
    }

    if (track === 'message') {
      // Drain pending messages
      if (state.pendingMessages) {
        this.runForGroup(groupJid, 'drain').catch((err) =>
          logger.error(
            { groupJid, err },
            'Unhandled error in runForGroup (drain)',
          ),
        );
        return;
      }
    }

    // Nothing pending for this track; check if other groups are waiting for a slot
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS
    ) {
      const nextJid = this.waitingGroups.shift()!;
      const state = this.getGroup(nextJid);

      // Drain tasks
      if (state.pendingTasks.length > 0 && !state.task.active) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task).catch((err) =>
          logger.error(
            { groupJid: nextJid, taskId: task.id, err },
            'Unhandled error in runTask (waiting)',
          ),
        );
      }

      // Drain messages (independently)
      if (
        state.pendingMessages &&
        !state.message.active &&
        this.activeCount < MAX_CONCURRENT_CONTAINERS
      ) {
        this.runForGroup(nextJid, 'drain').catch((err) =>
          logger.error(
            { groupJid: nextJid, err },
            'Unhandled error in runForGroup (waiting)',
          ),
        );
      }
    }
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    const activeContainers: string[] = [];
    for (const [_jid, state] of this.groups) {
      for (const slot of [state.message, state.task]) {
        if (slot.process && !slot.process.killed && slot.containerName) {
          activeContainers.push(slot.containerName);
        }
      }
    }

    logger.info(
      { activeCount: this.activeCount, detachedContainers: activeContainers },
      'GroupQueue shutting down (containers detached, not killed)',
    );
  }
}
