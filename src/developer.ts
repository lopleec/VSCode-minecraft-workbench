import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Network } from './network';
import { Java } from './java';
import { Store } from './store';
import { Project } from './models';
import { exists, extractZip, writeJson } from './files';
import { config, t, trusted } from './config';

export interface Template {
  name: string;
  minecraft: string;
  url: string;
  loader: Project['loader'];
}
export function properties(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^\w[\w.\-]*\s*=/.test(l))
      .map((l) => {
        const index = l.indexOf('=');
        return [l.slice(0, index).trim(), l.slice(index + 1).trim()];
      }),
  );
}
export function configureProperties(text: string, project: Project): string {
  const values: Record<string, string> = {
    mod_id: project.modId,
    mod_name: project.name,
    mod_group_id: project.packageName,
    maven_group: project.packageName,
    group: project.packageName,
    archives_base_name: project.modId,
    mod_version: '1.0.0',
    version: '1.0.0',
    mod_authors: '',
    mod_description: '',
    mod_license: 'MIT',
  };
  const present = new Set<string>();
  const lines = text.split(/\r?\n/).map((line) => {
    const key = /^([\w.\-]+)\s*=/.exec(line)?.[1];
    if (!key || values[key] === undefined) return line;
    present.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values))
    if (!present.has(key)) lines.push(`${key}=${value}`);
  return lines.join('\n');
}
export function validPackage(value: string): boolean {
  const keywords = new Set([
    'abstract',
    'assert',
    'boolean',
    'break',
    'byte',
    'case',
    'catch',
    'char',
    'class',
    'const',
    'continue',
    'default',
    'do',
    'double',
    'else',
    'enum',
    'extends',
    'final',
    'finally',
    'float',
    'for',
    'goto',
    'if',
    'implements',
    'import',
    'instanceof',
    'int',
    'interface',
    'long',
    'native',
    'new',
    'package',
    'private',
    'protected',
    'public',
    'return',
    'short',
    'static',
    'strictfp',
    'super',
    'switch',
    'synchronized',
    'this',
    'throw',
    'throws',
    'transient',
    'try',
    'void',
    'volatile',
    'while',
    'true',
    'false',
    'null',
    '_',
  ]);
  return (
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value) &&
    value.split('.').every((part) => !keywords.has(part))
  );
}
export class Developer {
  constructor(
    private readonly store: Store,
    private readonly net: Network,
    private readonly java: Java,
  ) {}
  async templates(loader: 'fabric' | 'neoforge'): Promise<Template[]> {
    if (loader === 'fabric') {
      const branches = await this.net.json<{ name: string; commit: { sha: string } }[]>(
        'https://api.github.com/repos/FabricMC/fabric-example-mod/branches?per_page=100',
      );
      return branches
        .filter((b) => /^(?:\d+\.\d+[\w.-]*|\d{2}w\d{2}[a-z])$/.test(b.name))
        .map((b) => ({
          name: b.name,
          minecraft: b.name,
          loader,
          url: `https://codeload.github.com/FabricMC/fabric-example-mod/zip/${b.commit.sha}`,
        }))
        .reverse();
    }
    const repos = await this.net.json<{ name: string; default_branch: string }[]>(
      'https://api.github.com/orgs/NeoForgeMDKs/repos?per_page=100',
    );
    return repos
      .filter((r) => /^MDK-[A-Za-z0-9._-]+-ModDevGradle$/.test(r.name))
      .map((r) => ({
        name: r.name,
        minecraft: r.name.slice(4).replace('-ModDevGradle', ''),
        loader,
        url: `https://codeload.github.com/NeoForgeMDKs/${r.name}/zip/refs/heads/${r.default_branch}`,
      }))
      .reverse();
  }
  async create(
    template: Template,
    options: { name: string; modId: string; packageName: string; parent: string },
    signal: AbortSignal,
  ): Promise<Project> {
    await trusted();
    if (!path.isAbsolute(options.parent)) throw new Error('Absolute directory path required');
    if (
      !options.name.trim() ||
      options.name.length > 100 ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(options.modId) ||
      !validPackage(options.packageName) ||
      /[\r\n\\$"']/.test(options.name)
    )
      throw new Error(t('Invalid project metadata.', '项目元数据无效。'));
    const directory = path.join(options.parent, options.modId);
    if (await exists(directory))
      throw new Error(t('The project directory already exists.', '项目目录已存在。'));
    const id = randomUUID();
    const stage = path.join(options.parent, `.minecraft-project-${id}`);
    const archive = path.join(this.store.root, 'cache', `template-${id}.zip`);
    const project: Project = {
      id,
      name: options.name,
      modId: options.modId,
      packageName: options.packageName,
      directory,
      minecraft: template.minecraft,
      loader: template.loader,
    };
    try {
      await this.net.download(template.url, archive, { signal, kind: 'project' });
      await fs.mkdir(stage, { recursive: true });
      await extractZip(archive, stage, template.loader === 'forge' ? 0 : 1, undefined, signal);
      for (const relative of ['.github', '.git', '.idea', '.vscode'])
        await fs.rm(path.join(stage, relative), { recursive: true, force: true });
      const propFile = path.join(stage, 'gradle.properties');
      const original = await fs.readFile(propFile, 'utf8');
      project.minecraft = properties(original).minecraft_version || project.minecraft;
      await fs.writeFile(propFile, configureProperties(original, project));
      const rewrite = (text: string, java: boolean) => {
        const packages = text.replace(
          /com\.example\.examplemod|net\.fabricmc\.example|com\.example/g,
          options.packageName,
        );
        return (
          java
            ? packages.replace(/"(?:examplemod|example_mod|modid)"/g, `"${options.modId}"`)
            : packages.replace(/\b(?:examplemod|example_mod|modid)\b/g, options.modId)
        ).replace(/Example Mod/g, options.name);
      };
      const walk = async (directory: string): Promise<string[]> => {
        const result: string[] = [];
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw new Error('Template contains a symbolic link');
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) result.push(...(await walk(target)));
          else result.push(target);
        }
        return result;
      };
      const files = await walk(stage);
      for (const file of files.filter(
        (f) => /\.(java|json|toml|gradle|kts|properties|mixins\.json)$/.test(f) && f !== propFile,
      )) {
        let text = rewrite(await fs.readFile(file, 'utf8'), file.endsWith('.java'));
        if (path.basename(file) === 'fabric.mod.json') {
          const json = JSON.parse(text);
          json.id = project.modId;
          json.name = project.name;
          json.authors = [];
          json.contact = {};
          json.description = '';
          text = JSON.stringify(json, null, 2) + '\n';
        }
        if (/settings\.gradle(\.kts)?$/.test(file))
          text += `\nrootProject.name = "${project.modId}"\n`;
        await fs.writeFile(file, text);
        if (file.endsWith('.java')) {
          const packageName = /^package\s+([\w.]+)\s*;/m.exec(text)?.[1];
          const match = /^(.*[/\\]src[/\\][^/\\]+[/\\]java)[/\\]/.exec(file);
          if (packageName && match) {
            const destination = path.join(match[1], ...packageName.split('.'), path.basename(file));
            if (destination !== file) {
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.rename(file, destination);
            }
          }
        }
      }
      for (const file of await walk(stage)) {
        const relative = path
          .relative(stage, file)
          .split(path.sep)
          .map((part) =>
            part.replace(/^(?:examplemod|example_mod|modid)(?=[.\-]|$)/, project.modId),
          )
          .join(path.sep);
        const destination = path.join(stage, relative);
        if (destination !== file) {
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.rename(file, destination);
        }
      }
      const wrapper = path.join(stage, 'gradle', 'wrapper', 'gradle-wrapper.jar');
      if (!(await exists(wrapper)))
        throw new Error(t('Template is missing the Gradle wrapper.', '模板缺少 Gradle Wrapper。'));
      await writeJson(path.join(stage, '.minecraft-workbench.json'), project);
      await writeJson(path.join(stage, '.vscode', 'extensions.json'), {
        recommendations: ['vscjava.vscode-java-pack', 'vscjava.vscode-gradle'],
      });
      await writeJson(path.join(stage, '.vscode', 'launch.json'), {
        version: '0.2.0',
        configurations: [
          {
            type: 'java',
            request: 'attach',
            name: 'Minecraft Client',
            hostName: '127.0.0.1',
            port: 5005,
          },
        ],
      });
      signal.throwIfAborted();
      await fs.rename(stage, directory);
      this.store.state.projects.push(project);
      await this.store.save();
      return project;
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
      await fs.rm(archive, { force: true });
    }
  }
  async import(directory: string): Promise<Project> {
    if (!(await exists(path.join(directory, 'gradle', 'wrapper', 'gradle-wrapper.jar'))))
      throw new Error('Gradle wrapper not found');
    const prop = properties(await fs.readFile(path.join(directory, 'gradle.properties'), 'utf8'));
    const loader = (await exists(
      path.join(directory, 'src', 'main', 'resources', 'fabric.mod.json'),
    ))
      ? 'fabric'
      : prop.neo_version || prop.neoforge_version
        ? 'neoforge'
        : 'forge';
    const project: Project = {
      id: randomUUID(),
      name: prop.mod_name || path.basename(directory),
      modId: prop.mod_id || path.basename(directory),
      packageName: prop.mod_group_id || prop.maven_group || prop.group || '',
      minecraft: prop.minecraft_version || '',
      loader,
      directory,
    };
    if (!this.store.state.projects.some((p) => p.directory === directory))
      this.store.state.projects.push(project);
    await this.store.save();
    return this.store.state.projects.find((p) => p.directory === directory)!;
  }
  async open(project: Project) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.directory), {
      forceNewWindow: config('openProjectsInNewWindow', true),
    });
  }
  async requiredJava(project: Project): Promise<number> {
    const major = /^1\.(\d+)(?:\.(\d+))?/.exec(project.minecraft);
    let required = major
      ? Number(major[1]) >= 20 && (Number(major[1]) > 20 || Number(major[2] || 0) >= 5)
        ? 21
        : Number(major[1]) >= 18
          ? 17
          : Number(major[1]) === 17
            ? 16
            : 8
      : 25;
    const props = properties(
      await fs.readFile(path.join(project.directory, 'gradle.properties'), 'utf8'),
    );
    const wrapper = await fs
      .readFile(path.join(project.directory, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8')
      .catch(() => '');
    const key = JSON.stringify([project.minecraft, project.loader, props.loom_version, wrapper]);
    if (project.buildJava && project.buildJavaKey === key) return project.buildJava;
    if (/gradle-(?:[89]|[1-9]\d)\./.test(wrapper)) required = Math.max(required, 17);
    if (project.loader === 'fabric' && props.loom_version) {
      const version = props.loom_version;
      const base = `https://maven.fabricmc.net/net/fabricmc/fabric-loom/${encodeURIComponent(version)}`;
      try {
        let artifact = version;
        if (version.endsWith('-SNAPSHOT')) {
          const xml = await this.net.text(`${base}/maven-metadata.xml`);
          artifact =
            [...xml.matchAll(/<snapshotVersion>([\s\S]*?)<\/snapshotVersion>/g)]
              .map((m) => m[1])
              .find((block) => /<extension>module<\/extension>/.test(block))
              ?.match(/<value>([^<]+)<\/value>/)?.[1] || version;
        }
        const metadata = await this.net.json<{
          variants: { attributes?: Record<string, unknown> }[];
        }>(`${base}/fabric-loom-${artifact}.module`);
        for (const variant of metadata.variants) {
          const value = Number(variant.attributes?.['org.gradle.jvm.version']);
          if (value > required && value < 100) required = value;
        }
      } catch {
        const [a, b] = version.split(/[.\-]/).map(Number);
        if (a > 1 || (a === 1 && b >= 19)) required = Math.max(required, 25);
      }
    }
    project.buildJava = required;
    project.buildJavaKey = key;
    await this.store.save();
    return required;
  }
  async run(project: Project, action: 'build' | 'runClient' | 'debug' | 'sources' | 'clean') {
    await trusted();
    const required = await this.requiredJava(project);
    const runtime = await this.java.select(required, config('javaPath', ''));
    if (
      !(await exists(
        path.join(path.dirname(runtime.path), process.platform === 'win32' ? 'javac.exe' : 'javac'),
      ))
    )
      throw new Error(t('Development requires a JDK, not a JRE.', '开发模式需要完整 JDK。'));
    const args = [
      '-classpath',
      path.join(project.directory, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
      'org.gradle.wrapper.GradleWrapperMain',
    ];
    if (action === 'debug') args.push('runClient', '--debug-jvm');
    else if (action === 'sources')
      args.push(
        project.loader === 'fabric'
          ? 'genSources'
          : project.loader === 'neoforge'
            ? 'createMinecraftArtifacts'
            : 'genVSCodeRuns',
      );
    else args.push(action);
    args.push('--console=plain');
    const task = new vscode.Task(
      { type: 'minecraftWorkbench', project: project.id, action },
      vscode.TaskScope.Workspace,
      `${project.name}: ${action}`,
      'Minecraft Workbench',
      new vscode.ProcessExecution(runtime.path, args, {
        cwd: project.directory,
        env: { ...process.env, JAVA_HOME: path.dirname(path.dirname(runtime.path)) },
      }),
      ['$javac'],
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
      clear: false,
    };
    task.group = action === 'build' ? vscode.TaskGroup.Build : undefined;
    await vscode.tasks.executeTask(task);
  }
  async attach(project: Project) {
    await trusted();
    if (!vscode.extensions.getExtension('vscjava.vscode-java-debug')) {
      const choice = await vscode.window.showInformationMessage(
        t(
          'Install Debugger for Java to attach to Minecraft.',
          '安装 Debugger for Java 后可连接 Minecraft 调试。',
        ),
        t('Open extension', '打开扩展'),
      );
      if (choice)
        await vscode.commands.executeCommand('extension.open', 'vscjava.vscode-java-debug');
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.directory));
    await vscode.debug.startDebugging(folder, {
      type: 'java',
      request: 'attach',
      name: `${project.name}: Minecraft`,
      hostName: '127.0.0.1',
      port: config('debugPort', 5005),
    });
  }
}
