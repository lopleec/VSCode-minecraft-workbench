import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { t } from './config';
import { redact } from './files';
import { describeError, diagnosticError } from './errors';
export interface Job {
  id: string;
  label: string;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  detail?: string;
  controller: AbortController;
  retry: () => Promise<unknown>;
}
export class Jobs implements vscode.Disposable {
  readonly items: Job[] = [];
  private readonly retries = new Map<string, Promise<unknown>>();
  private readonly nativeTasks = new Map<
    vscode.TaskExecution,
    { job: Job; started: number; processStarted: boolean }
  >();
  constructor(
    private readonly changed: () => void,
    readonly output: vscode.LogOutputChannel,
  ) {}
  async run<T>(
    label: string,
    work: (signal: AbortSignal, report: (message: string) => void) => Promise<T>,
    retry?: () => Promise<unknown>,
  ): Promise<T> {
    const job: Job = {
      id: randomUUID(),
      label,
      status: 'running',
      controller: new AbortController(),
      retry: retry || (() => this.run(label, work)),
    };
    this.items.unshift(job);
    this.trim();
    this.changed();
    const started = Date.now();
    const prefix = `[${job.id.slice(0, 8)}] ${label}`;
    this.output.info(`${prefix}: ${t('Started', '开始')}`);
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: label, cancellable: true },
      async (progress, token) => {
        const cancel = token.onCancellationRequested(() =>
          job.controller.abort(new Error(t('Cancelled', '已取消'))),
        );
        let lastUpdate = 0;
        let lastLog = 0;
        let lastMessage = '';
        let lastLogged = '';
        const log = () => {
          if (lastMessage && lastMessage !== lastLogged) {
            this.output.info(`${prefix}: ${lastMessage}`);
            lastLogged = lastMessage;
            lastLog = Date.now();
          }
        };
        try {
          const result = await work(job.controller.signal, (message) => {
            message = redact(message);
            job.detail = message;
            lastMessage = message;
            if (!/^[\d.,\s/%]+(?:MB|MiB|GB|GiB)?$/.test(message) || Date.now() - lastLog >= 2000)
              log();
            if (Date.now() - lastUpdate > 400) {
              progress.report({ message });
              this.changed();
              lastUpdate = Date.now();
            }
          });
          job.status = 'done';
          job.detail = undefined;
          log();
          this.output.info(
            `${prefix}: ${t('Completed', '完成')} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
          );
          return result;
        } catch (error) {
          job.status =
            job.controller.signal.aborted || (error as Error)?.name === 'AbortError'
              ? 'cancelled'
              : 'failed';
          job.detail = redact(describeError(error));
          log();
          const message = `${prefix}: ${job.detail} (${((Date.now() - started) / 1000).toFixed(1)}s)`;
          if (job.status === 'cancelled') this.output.info(message);
          else this.output.error(`${message}\n${diagnosticError(error)}`);
          throw error;
        } finally {
          cancel.dispose();
          this.trim();
          this.changed();
        }
      },
    );
  }
  taskStarted(execution: vscode.TaskExecution, alreadyRunning = false) {
    if (this.nativeTasks.has(execution)) return;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => execution.terminate(), { once: true });
    const job: Job = {
      id: randomUUID(),
      label: execution.task.name,
      status: 'running',
      controller,
      retry: async () => {
        await vscode.tasks.executeTask(execution.task);
      },
      detail: t(
        'Gradle output is available in the task terminal.',
        'Gradle 完整输出位于任务终端。',
      ),
    };
    this.nativeTasks.set(execution, { job, started: Date.now(), processStarted: alreadyRunning });
    this.items.unshift(job);
    this.trim();
    this.output.info(
      `[${job.id.slice(0, 8)}] ${job.label}: ${t('Started; output in task terminal', '开始，完整输出位于任务终端')}`,
    );
    this.changed();
  }
  taskProcessStarted(execution: vscode.TaskExecution, pid: number) {
    const tracked = this.nativeTasks.get(execution);
    if (!tracked) return;
    tracked.processStarted = true;
    this.output.info(`[${tracked.job.id.slice(0, 8)}] ${tracked.job.label}: PID ${pid}`);
  }
  taskStopped(execution: vscode.TaskExecution) {
    if (!this.nativeTasks.get(execution)?.processStarted) this.taskEnded(execution);
  }
  taskEnded(execution: vscode.TaskExecution, exitCode?: number) {
    const task = this.nativeTasks.get(execution);
    if (!task) return;
    this.nativeTasks.delete(execution);
    const { job, started } = task;
    job.status =
      job.controller.signal.aborted || exitCode === undefined
        ? 'cancelled'
        : exitCode === 0
          ? 'done'
          : 'failed';
    job.detail = t(`Exit code: ${exitCode ?? '—'}`, `退出代码：${exitCode ?? '—'}`);
    const message = `[${job.id.slice(0, 8)}] ${job.label}: ${job.detail} (${((Date.now() - started) / 1000).toFixed(1)}s)`;
    if (job.status === 'failed') this.output.error(message);
    else this.output.info(message);
    this.trim();
    this.changed();
  }
  private trim() {
    for (let i = this.items.length - 1; i >= 0 && this.items.length > 100; i--)
      if (this.items[i].status !== 'running') this.items.splice(i, 1);
  }
  retry(job: Job): Promise<unknown> {
    const pending = this.retries.get(job.id);
    if (pending) return pending;
    const work = Promise.resolve()
      .then(() => job.retry())
      .finally(() => this.retries.delete(job.id));
    this.retries.set(job.id, work);
    return work;
  }
  dispose() {
    const native = new Set([...this.nativeTasks.values()].map((entry) => entry.job));
    for (const job of this.items)
      if (job.status === 'running' && !native.has(job)) job.controller.abort();
    this.nativeTasks.clear();
  }
}
