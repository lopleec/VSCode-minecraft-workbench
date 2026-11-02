import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { extensionVersion } from './build-info';
import { redact } from './files';
import { t } from './config';

type ExportMode = 'sanitized' | 'original';

export function diagnosticData(value: unknown, mode: ExportMode = 'sanitized'): unknown {
  if (typeof value === 'string') {
    const text = redact(value);
    return mode === 'original'
      ? text
      : text
          .split(os.homedir())
          .join('<home>')
          .replace(/([A-Za-z]:\\+Users\\+)[^\\\r\n]+/g, '$1<user>')
          .replace(/(\/(?:Users|home)\/)[^/\s"']+/g, '$1<user>')
          .replace(/((?:--username|--uuid)["']?\s*,\s*["'])[^"']+/gi, '$1[redacted]')
          .replace(/((?:--username|--uuid)\s+)[^\s"']+/gi, '$1[redacted]');
  }
  if (Array.isArray(value)) return value.map((item) => diagnosticData(item, mode));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /token|password|secret|authorization|cookie/i.test(key) ||
      (mode === 'sanitized' && /^(accountName|userName|playerName|profileId|uuid)$/i.test(key))
        ? '[redacted]'
        : diagnosticData(item, mode),
    ]),
  );
}

export class Diagnostics implements vscode.Disposable {
  private pending = Promise.resolve();
  private readonly lines: string[] = [];
  private bytes = 0;
  private fileBytes = 0;
  private failed?: string;
  private closed = false;
  constructor(private readonly directory?: string) {
    if (directory)
      this.pending = fs
        .mkdir(directory, { recursive: true })
        .then(async () => {
          this.fileBytes = await fs.stat(path.join(directory, 'launcher.log')).then(
            (stat) => stat.size,
            (error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error;
              return 0;
            },
          );
        })
        .catch((error) => {
          this.failed = String(error);
        });
  }

  channel(output: vscode.LogOutputChannel): vscode.LogOutputChannel {
    const methods = new Set(['trace', 'debug', 'info', 'warn', 'error', 'append', 'appendLine']);
    return new Proxy({} as vscode.LogOutputChannel, {
      get: (_target, key) => {
        const value = Reflect.get(output, key, output);
        if (typeof value !== 'function') return value;
        if (methods.has(String(key)))
          return (...args: unknown[]) => {
            this.record(
              String(key),
              args
                .map((item) => (item instanceof Error ? item.stack || item.message : String(item)))
                .join(' '),
            );
            return value.apply(output, args);
          };
        return value.bind(output);
      },
    });
  }

  record(level: string, message: string) {
    if (this.closed) return;
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${redact(message)}\n`;
    this.lines.push(line);
    this.bytes += Buffer.byteLength(line);
    while (this.bytes > 8 * 1024 ** 2 && this.lines.length > 1)
      this.bytes -= Buffer.byteLength(this.lines.shift()!);
    if (!this.directory) return;
    this.pending = this.pending
      .then(async () => {
        if (this.failed) return;
        if (this.fileBytes + Buffer.byteLength(line) > 8 * 1024 ** 2) {
          await fs.rm(path.join(this.directory!, 'launcher.4.log'), { force: true });
          for (let n = 3; n >= 0; n--) {
            const from = path.join(this.directory!, n ? `launcher.${n}.log` : 'launcher.log');
            await fs
              .rename(from, path.join(this.directory!, `launcher.${n + 1}.log`))
              .catch((error) => {
                if (error.code !== 'ENOENT') throw error;
              });
          }
          this.fileBytes = 0;
        }
        await fs.appendFile(path.join(this.directory!, 'launcher.log'), line, {
          encoding: 'utf8',
          mode: 0o600,
        });
        this.fileBytes += Buffer.byteLength(line);
      })
      .catch((error) => {
        this.failed = String(error);
      });
  }

  async archive(snapshot: unknown, mode: ExportMode = 'sanitized'): Promise<Buffer> {
    await this.pending;
    const zip = new AdmZip();
    const environment = {
      generatedAt: new Date().toISOString(),
      exportMode: mode,
      extensionVersion,
      vscodeVersion: vscode.version,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      osVersion: os.version(),
      memoryMiB: {
        total: Math.round(os.totalmem() / 1024 ** 2),
        free: Math.round(os.freemem() / 1024 ** 2),
      },
      javaEnvironment: diagnosticData(
        Object.fromEntries(
          [
            'JAVA_TOOL_OPTIONS',
            'JDK_JAVA_OPTIONS',
            '_JAVA_OPTIONS',
            'JAVA_HOME',
            'JDK_HOME',
            'DISPLAY',
            'WAYLAND_DISPLAY',
            'XDG_SESSION_TYPE',
          ]
            .filter((key) => process.env[key] !== undefined)
            .map((key) => [key, process.env[key]]),
        ),
        mode,
      ),
    };
    const clean = (text: string) => diagnosticData(text, mode) as string;
    zip.addFile(
      'report.txt',
      Buffer.from(
        clean(
          [
            'Minecraft Workbench diagnostic report',
            '',
            '[Environment]',
            JSON.stringify(environment, null, 2),
            '',
            '[Configuration and current state]',
            JSON.stringify(diagnosticData(snapshot, mode), null, 2),
            '',
            '[Log collection]',
            'Launcher output includes request traces, download stages, Java selection, launch arguments, process IDs and exit details.',
            'Original game, native task and external-tool output is preserved in its original language.',
            'VS Code task terminal text is not exposed by the stable extension API. Task commands, process IDs and exit states are recorded.',
            'Up to five 8 MiB launcher log segments are retained. SecretStorage is never read for this export.',
            mode === 'sanitized'
              ? 'Sanitized export: home directories, usernames and player identifiers are masked.'
              : 'Original export: local paths and player identifiers are retained. Sign-in tokens and passwords are still excluded.',
            this.failed
              ? `Disk log warning: ${this.failed}. The in-memory tail is included.`
              : 'Log collection completed.',
          ].join('\n'),
        ),
        'utf8',
      ),
    );
    let collected = false;
    if (this.directory)
      for (const name of [
        'launcher.4.log',
        'launcher.3.log',
        'launcher.2.log',
        'launcher.1.log',
        'launcher.log',
      ]) {
        const text = await fs
          .readFile(path.join(this.directory, name), 'utf8')
          .catch(() => undefined);
        if (text !== undefined) {
          zip.addFile(name, Buffer.from(clean(text)));
          collected = true;
        }
      }
    if (!collected || this.failed)
      zip.addFile('launcher-memory.log', Buffer.from(clean(this.lines.join(''))));
    return zip.toBuffer();
  }

  async export(snapshot: unknown) {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: t('Sanitized (recommended)', '脱敏版（推荐）'),
          description: t(
            'Hide home directories and player identifiers.',
            '隐藏用户目录和玩家身份信息。',
          ),
          mode: 'sanitized' as const,
        },
        {
          label: t('Original', '原始版'),
          description: t(
            'Keep local paths and player identifiers. Credentials are excluded.',
            '保留本地路径和玩家身份信息，不包含登录凭据。',
          ),
          mode: 'original' as const,
        },
      ],
      { title: t('Export launcher logs', '导出启动器日志') },
    );
    if (!choice) return;
    const target = await vscode.window.showSaveDialog({
      title: t('Export launcher logs', '导出启动器日志'),
      defaultUri: vscode.Uri.file(
        path.join(
          os.homedir(),
          `minecraft-workbench-diagnostics-${choice.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        ),
      ),
      filters: { 'Diagnostic archive': ['zip'] },
    });
    if (!target) return;
    const data = await this.archive(snapshot, choice.mode);
    await vscode.workspace.fs.writeFile(target, data);
    void vscode.window.showInformationMessage(t('Launcher logs exported.', '启动器日志已导出。'));
  }

  async flush() {
    await this.pending;
  }
  dispose() {
    this.closed = true;
  }
}
