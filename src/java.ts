import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { x as untar } from 'tar';
import { Network } from './network';
import { Store } from './store';
import { JavaRuntime } from './models';
import { exists, extractZip } from './files';
import { waitFor } from './abort';

const exec = promisify(execFile);
export async function inspectJava(java: string): Promise<JavaRuntime> {
  const { stdout, stderr } = await exec(java, ['-XshowSettings:properties', '-version'], {
    timeout: 10000,
    windowsHide: true,
  });
  const text = stdout + stderr;
  const version =
    /java\.version\s*=\s*(\S+)/.exec(text)?.[1] || /version "([^"]+)"/.exec(text)?.[1];
  if (!version) throw new Error('Cannot determine Java version');
  const major = Number(
    version.startsWith('1.') ? version.split('.')[1] : version.split(/[.\-+]/)[0],
  );
  let home = /java\.home\s*=\s*(.+)/.exec(text)?.[1]?.trim();
  if (
    home &&
    path.basename(home) === 'jre' &&
    (await exists(
      path.join(home, '..', 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'),
    ))
  )
    home = path.dirname(home);
  return {
    path: home ? path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : java,
    version,
    major,
    architecture: /os\.arch\s*=\s*(\S+)/.exec(text)?.[1] || 'unknown',
  };
}
export class Java {
  private readonly preparing = new Map<number, Promise<JavaRuntime>>();
  private readonly downloads = new Map<number, Promise<void>>();
  constructor(
    private readonly store: Store,
    private readonly net: Network,
  ) {}
  async detect() {
    const candidates = new Set<string>(['java', ...this.store.state.java.map((j) => j.path)]);
    if (process.env.JAVA_HOME)
      candidates.add(
        path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
      );
    const roots = [
      path.join(this.store.root, 'java'),
      path.join(os.homedir(), '.jdks'),
      '/Library/Java/JavaVirtualMachines',
      '/usr/lib/jvm',
      ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
        .filter(Boolean)
        .map((p) => path.join(p!, 'Eclipse Adoptium')),
    ];
    for (const root of roots) {
      for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const folder = path.join(root, entry.name);
        candidates.add(
          path.join(folder, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
        );
        candidates.add(path.join(folder, 'Contents', 'Home', 'bin', 'java'));
      }
    }
    const found = await Promise.all(
      [...candidates].map((candidate) => inspectJava(candidate).catch(() => undefined)),
    );
    this.store.state.java = [
      ...new Map(found.filter((j): j is JavaRuntime => !!j).map((j) => [j.path, j])).values(),
    ].sort((a, b) => b.major - a.major);
    await this.store.save();
    return this.store.state.java;
  }
  async select(major: number, preferred?: string): Promise<JavaRuntime> {
    if (preferred) {
      const runtime = await inspectJava(preferred);
      if (runtime.major < major)
        throw new Error(`Java ${major}+ required; selected Java ${runtime.major}`);
      return runtime;
    }
    let runtime = this.store.state.java.find((j) => j.major === major);
    if (!runtime) {
      await this.detect();
      runtime = this.store.state.java.find((j) => j.major === major);
    }
    if (!runtime)
      throw new Error(
        `Java ${major} required. Use Java → Download JDK or configure a Java executable.`,
      );
    return runtime;
  }
  async ensure(
    major: number,
    signal: AbortSignal,
    report: (text: string) => void,
    preferred?: string,
  ) {
    if (preferred) return this.select(major, preferred);
    const pending = this.preparing.get(major);
    if (pending) {
      await waitFor(pending, signal);
      signal.throwIfAborted();
      return this.select(major);
    }
    const prepare = (async () => {
      await this.detect();
      if (!this.store.state.java.some((j) => j.major === major)) {
        report(`Eclipse Temurin ${major}`);
        await this.download(major, signal, report);
      }
      return this.select(major);
    })();
    this.preparing.set(major, prepare);
    try {
      return await prepare;
    } finally {
      this.preparing.delete(major);
    }
  }
  async download(
    major: number,
    signal: AbortSignal,
    report: (text: string) => void,
  ): Promise<void> {
    const pending = this.downloads.get(major);
    if (pending) {
      await waitFor(pending, signal);
      signal.throwIfAborted();
      return;
    }
    const work = this.downloadRuntime(major, signal, report);
    this.downloads.set(major, work);
    try {
      await work;
    } finally {
      this.downloads.delete(major);
    }
  }
  private async downloadRuntime(
    major: number,
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    const platform = (
      { darwin: 'mac', win32: 'windows', linux: 'linux' } as Record<string, string>
    )[process.platform];
    const arch = ({ x64: 'x64', arm64: 'aarch64', arm: 'arm' } as Record<string, string>)[
      process.arch
    ];
    if (!platform || !arch) throw new Error('Unsupported JDK platform');
    const binaries = await this.net.json<
      { binary: { package: { link: string; checksum: string; name: string } } }[]
    >(
      `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jdk&os=${platform}`,
      { signal, kind: 'java' },
    );
    const pkg = binaries[0]?.binary.package;
    if (!pkg) throw new Error('No matching JDK found');
    const archive = path.join(
      this.store.root,
      'cache',
      `jdk-${major}-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}`,
    );
    await this.net.download(pkg.link, archive, {
      hash: pkg.checksum,
      algorithm: 'sha256',
      signal,
      kind: 'java',
      progress: (n, total) =>
        report(`${Math.round(n / 1024 ** 2)} / ${Math.round(total / 1024 ** 2)} MB`),
    });
    const home = path.join(this.store.root, 'java', `temurin-${major}-${platform}-${arch}`);
    if (await exists(home)) {
      await inspectJava(
        path.join(
          home,
          ...(platform === 'mac' ? ['Contents', 'Home'] : []),
          'bin',
          platform === 'windows' ? 'java.exe' : 'java',
        ),
      );
      await this.detect();
      return;
    }
    const stage = home + '.extracting';
    await fs.rm(stage, { recursive: true, force: true });
    await fs.mkdir(stage, { recursive: true });
    try {
      if (platform === 'windows') await extractZip(archive, stage, 1);
      else await untar({ file: archive, cwd: stage, strip: 1, strict: true });
      const java = path.join(
        stage,
        ...(platform === 'mac' ? ['Contents', 'Home'] : []),
        'bin',
        platform === 'windows' ? 'java.exe' : 'java',
      );
      await inspectJava(java);
      signal.throwIfAborted();
      await fs.rename(stage, home);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
    await this.detect();
  }
}
