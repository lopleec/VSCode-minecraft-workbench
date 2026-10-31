import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { t } from './config';
import { redact } from './files';
import { describeError } from './errors';
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
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: label, cancellable: true },
      async (progress, token) => {
        const cancel = token.onCancellationRequested(() =>
          job.controller.abort(new Error(t('Cancelled', '已取消'))),
        );
        let lastUpdate = 0;
        try {
          const result = await work(job.controller.signal, (message) => {
            job.detail = message;
            if (Date.now() - lastUpdate > 400) {
              progress.report({ message });
              this.changed();
              lastUpdate = Date.now();
            }
          });
          job.status = 'done';
          job.detail = undefined;
          this.output.info(label);
          return result;
        } catch (error) {
          job.status =
            job.controller.signal.aborted || (error as Error)?.name === 'AbortError'
              ? 'cancelled'
              : 'failed';
          job.detail = redact(describeError(error));
          this.output.error(`${label}: ${job.detail}`);
          throw error;
        } finally {
          cancel.dispose();
          this.trim();
          this.changed();
        }
      },
    );
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
    for (const job of this.items) if (job.status === 'running') job.controller.abort();
  }
}
