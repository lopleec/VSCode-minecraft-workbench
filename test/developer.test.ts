import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { Developer, validPackage, projectSettings } from '../src/developer';
import { Store } from '../src/store';
import { Network } from '../src/network';
import { Java } from '../src/java';

test('Java package names reject keywords and invalid segments', () => {
  for (const value of ['com.example.my_mod', 'org.sample.client'])
    assert.equal(validPackage(value), true);
  for (const value of [
    'com.class.mod',
    'com..mod',
    'com.Example.mod',
    'com.1mod',
    'com._.foo',
    '../x',
  ])
    assert.equal(validPackage(value), false);
});
test('official-style project templates receive metadata, Java packages and entrypoints', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-project-'));
  const store = new Store(path.join(root, 'storage'), () => {});
  const zip = new AdmZip();
  zip.addFile(
    'template/gradle.properties',
    Buffer.from('minecraft_version=1.21.1\ngroup=com.example\nmod_id=modid\n'),
  );
  zip.addFile('template/build.gradle', Buffer.from('group = project.group\n'));
  zip.addFile('template/settings.gradle', Buffer.from('pluginManagement {}\n'));
  zip.addFile('template/gradle/wrapper/gradle-wrapper.jar', Buffer.from('wrapper-fixture'));
  zip.addFile(
    'template/src/main/java/com/example/ExampleMod.java',
    Buffer.from(
      'package com.example;\n@EventBusSubscriber(modid = "modid")\npublic class ExampleMod { public static final String MOD_ID = "modid"; }',
    ),
  );
  zip.addFile(
    'template/src/main/resources/fabric.mod.json',
    Buffer.from(
      JSON.stringify({
        id: 'modid',
        name: 'Example Mod',
        authors: ['Example'],
        contact: { homepage: 'https://example.com' },
        entrypoints: { main: ['com.example.ExampleMod'] },
      }),
    ),
  );
  zip.addFile(
    'template/src/main/resources/modid.mixins.json',
    Buffer.from('{"package":"com.example.mixin"}'),
  );
  zip.addFile('template/src/main/resources/assets/modid/icon.png', Buffer.from('icon'));
  const net = {
    download: async (_url: string, target: string) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      zip.writeZip(target);
    },
  } as unknown as Network;
  const dev = new Developer(store, net, {} as Java);
  try {
    const project = await dev.create(
      {
        name: '1.21.1',
        minecraft: '1.21.1',
        loader: 'fabric',
        url: 'https://example.com/template.zip',
      },
      { name: 'Demo Mod', modId: 'demo_mod', packageName: 'org.sample.demo', parent: root },
      new AbortController().signal,
    );
    const source = await fs.readFile(
      path.join(project.directory, 'src/main/java/org/sample/demo/ExampleMod.java'),
      'utf8',
    );
    assert.match(source, /package org\.sample\.demo;/);
    assert.match(source, /"demo_mod"/);
    assert.match(source, /@EventBusSubscriber\(modid = "demo_mod"\)/);
    const metadata = JSON.parse(
      await fs.readFile(path.join(project.directory, 'src/main/resources/fabric.mod.json'), 'utf8'),
    );
    assert.equal(metadata.id, 'demo_mod');
    assert.equal(metadata.name, 'Demo Mod');
    assert.equal(metadata.entrypoints.main[0], 'org.sample.demo.ExampleMod');
    assert.deepEqual(metadata.authors, []);
    assert.deepEqual(metadata.contact, {});
    assert.equal(
      JSON.parse(
        await fs.readFile(
          path.join(project.directory, 'src/main/resources/demo_mod.mixins.json'),
          'utf8',
        ),
      ).package,
      'org.sample.demo.mixin',
    );
    await fs.access(path.join(project.directory, 'src/main/resources/assets/demo_mod/icon.png'));
    assert.equal(store.state.projects[0].id, project.id);
    await assert.rejects(
      dev.create(
        { name: '', minecraft: '1.21.1', loader: 'fabric', url: '' },
        { name: 'Demo', modId: 'demo_mod', packageName: 'org.sample.demo', parent: root },
        new AbortController().signal,
      ),
      /exists/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('build Java follows Loom artifact metadata and invalidates when the tool version changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-build-java-'));
  const store = new Store(path.join(root, 'store'), () => {});
  const project = {
    id: 'test',
    name: 'Test',
    modId: 'test',
    directory: root,
    packageName: 'com.example.test',
    loader: 'fabric' as const,
    minecraft: '1.21.1',
  };
  store.state.projects.push(project);
  const net = {
    text: async () =>
      '<snapshotVersion><extension>module</extension><value>1.19-20261022</value></snapshotVersion>',
    json: async (url: string) => ({
      variants: [{ attributes: { 'org.gradle.jvm.version': url.includes('1.19') ? 25 : 21 } }],
    }),
  } as unknown as Network;
  const dev = new Developer(store, net, {} as Java);
  try {
    await fs.writeFile(path.join(root, 'gradle.properties'), 'loom_version=1.19-SNAPSHOT');
    assert.equal(await dev.requiredJava(project), 25);
    await fs.writeFile(path.join(root, 'gradle.properties'), 'loom_version=1.10.5');
    assert.equal(await dev.requiredJava(project), 21);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('official template catalogs retain snapshot branches and prerelease MDKs', async () => {
  const network = {
    json: async (url: string) =>
      url.includes('fabric-example-mod')
        ? ['1.21.1', '26.4-snapshot-5', '1.21-pre1', 'main'].map((name) => ({
            name,
            commit: { sha: 'revision' },
          }))
        : ['MDK-1.21.1-ModDevGradle', 'MDK-26.4-beta-ModDevGradle', 'Other'].map((name) => ({
            name,
            default_branch: 'main',
          })),
  } as unknown as Network;
  const developer = new Developer({} as Store, network, {} as Java);
  const fabric = await developer.templates('fabric');
  assert.ok(fabric.some((t) => t.minecraft === '26.4-snapshot-5'));
  assert.ok(fabric.some((t) => t.minecraft === '1.21-pre1'));
  assert.ok(!fabric.some((t) => t.minecraft === 'main'));
  assert.ok((await developer.templates('neoforge')).some((t) => t.minecraft === '26.4-beta'));
});

test('re-importing a Gradle project refreshes metadata and retains its registration and settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-project-refresh-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const dev = new Developer(store, {} as Network, {} as Java);
  try {
    await fs.mkdir(path.join(root, 'gradle/wrapper'), { recursive: true });
    await fs.writeFile(path.join(root, 'gradle/wrapper/gradle-wrapper.jar'), 'wrapper');
    await fs.writeFile(
      path.join(root, 'gradle.properties'),
      'mod_name=Before\nminecraft_version=1.20.1\nneo_version=20.1.1',
    );
    const first = await dev.import(root);
    first.java = '/project/jdk/bin/java';
    first.debugPort = 5010;
    await fs.writeFile(
      path.join(root, 'gradle.properties'),
      'mod_name=After\nminecraft_version=1.21.1\nneo_version=21.1.1',
    );
    const second = await dev.import(root + path.sep + '.');
    assert.equal(second.id, first.id);
    assert.equal(second.name, 'After');
    assert.equal(second.minecraft, '1.21.1');
    assert.equal(second.java, '/project/jdk/bin/java');
    assert.equal(second.debugPort, 5010);
    assert.equal(store.state.projects.length, 1);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('projects without gradle.properties can be imported without forcing a future Java version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-gradle-metadata-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const dev = new Developer(store, {} as Network, {} as Java);
  try {
    await fs.mkdir(path.join(root, 'gradle/wrapper'), { recursive: true });
    await fs.writeFile(path.join(root, 'gradle/wrapper/gradle-wrapper.jar'), 'wrapper');
    await fs.writeFile(
      path.join(root, 'gradle/wrapper/gradle-wrapper.properties'),
      'distributionUrl=https://services.gradle.org/distributions/gradle-8.13-bin.zip',
    );
    await fs.writeFile(
      path.join(root, 'build.gradle.kts'),
      'plugins { id("net.neoforged.moddev") version "2.0.0" }',
    );
    const project = await dev.import(root);
    assert.equal(project.loader, 'neoforge');
    assert.equal(await dev.requiredJava(project), 17);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Gradle preparation honors project Java and debug settings, and stops duplicate tasks', async () => {
  const vscode = require('vscode');
  const original = { ...vscode, workspace: { ...vscode.workspace } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-gradle-run-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const project = {
    id: 'mod',
    name: 'Mod',
    modId: 'mod',
    minecraft: '1.21.1',
    loader: 'forge' as const,
    packageName: 'com.example.mod',
    directory: root,
    java: path.join(root, 'bin/java'),
    debugPort: 5017,
    gradleArgs: ['--offline', '--stacktrace'],
  };
  const tasks: any[] = [],
    executions: any[] = [];
  const selected: string[] = [],
    attached: any[] = [];
  let stopped = 0;
  vscode.ProcessExecution = class {
    constructor(
      public process: string,
      public args: string[],
      public options: unknown,
    ) {}
  };
  vscode.Task = class {
    presentationOptions = {};
    constructor(
      public definition: unknown,
      _scope: unknown,
      public name: string,
      _source: unknown,
      public execution: unknown,
    ) {}
  };
  vscode.TaskScope = { Workspace: 2 };
  vscode.TaskRevealKind = { Always: 1 };
  vscode.TaskPanelKind = { Dedicated: 2 };
  vscode.TaskGroup = { Build: {} };
  vscode.tasks = {
    taskExecutions: executions,
    executeTask: async (task: unknown) => {
      tasks.push(task);
    },
  };
  vscode.extensions = { getExtension: () => ({}) };
  vscode.debug = {
    startDebugging: async (_folder: unknown, value: unknown) => {
      attached.push(value);
      return true;
    },
  };
  vscode.workspace.getConfiguration = () => ({
    get: (key: string, fallback: unknown) =>
      key === 'javaPath' ? '/global/jdk/bin/java' : key === 'debugPort' ? 5099 : fallback,
  });
  vscode.workspace.getWorkspaceFolder = () => undefined;
  const java = {
    ensure: async (_major: number, _signal: AbortSignal, _report: unknown, preferred: string) => {
      selected.push(preferred);
      return { path: project.java, major: 21 };
    },
  } as unknown as Java;
  const dev = new Developer(store, {} as Network, java);
  try {
    await fs.mkdir(path.join(root, 'bin'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'),
      'compiler',
    );
    await fs.writeFile(path.join(root, 'gradle.properties'), 'minecraft_version=1.21.1');
    await dev.run(project, 'debug');
    assert.deepEqual(selected, [project.java]);
    const args = tasks[0].execution.args;
    assert.ok(args.includes('runClient') && args.includes('--offline'));
    const init = await fs.readFile(args[args.indexOf('--init-script') + 1], 'utf8');
    assert.match(init, /address=127\.0\.0\.1:5017/);
    assert.ok(!args.includes('--debug-jvm'));
    await dev.attach(project);
    assert.equal(attached[0].port, 5017);
    executions.push({
      task: tasks[0],
      terminate: () => {
        stopped++;
      },
    });
    await assert.rejects(dev.run(project, 'build'), /Stop this project/);
    await assert.rejects(
      dev.configure(project, { java: '', debugPort: 0, gradleArgs: [] }),
      /Stop this project/,
    );
    dev.stop(project);
    assert.equal(stopped, 1);
    executions.length = 0;
    await dev.configure(project, { java: '', debugPort: 0, gradleArgs: [] });
    assert.equal(project.java, undefined);
    await dev.attach(project);
    assert.equal(attached[1].port, 5099);
    assert.throws(
      () => projectSettings({ java: '', debugPort: 70000, gradleArgs: [] }),
      /debug port/,
    );
    assert.throws(
      () => projectSettings({ java: '', gradleArgs: ['build\nrunClient'] }),
      /Gradle arguments/,
    );
  } finally {
    for (const key of Object.keys(vscode)) if (!(key in original)) delete vscode[key];
    Object.assign(vscode, original);
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stopping a project cancels JDK preparation, starts no Gradle process and allows retry', async () => {
  const vscode = require('vscode');
  const originalTasks = vscode.tasks;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-project-cancel-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const project = {
    id: 'cancel',
    name: 'Cancel',
    modId: 'cancel',
    minecraft: '1.21.1',
    loader: 'forge' as const,
    packageName: 'com.example.cancel',
    directory: root,
  };
  let ready!: () => void;
  const preparing = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let attempts = 0,
    processes = 0;
  vscode.tasks = {
    taskExecutions: [],
    executeTask: async () => {
      processes++;
      return { terminate() {} };
    },
  };
  const java = {
    ensure: async (_major: number, signal: AbortSignal) => {
      if (++attempts > 1) return { path: path.join(root, 'bin/java'), major: 21 };
      ready();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  } as unknown as Java;
  const developer = new Developer(store, {} as Network, java);
  try {
    await fs.mkdir(path.join(root, 'bin'));
    await fs.writeFile(
      path.join(root, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'),
      'compiler',
    );
    const run = developer.run(project, 'runClient');
    const cancelled = assert.rejects(run, { name: 'AbortError' });
    await preparing;
    assert.equal(developer.status(project).status, 'preparing');
    developer.stop(project);
    await cancelled;
    assert.equal(processes, 0);
    assert.equal(developer.status(project).status, 'idle');
    await developer.run(project, 'build');
    assert.equal(processes, 1);
  } finally {
    vscode.tasks = originalTasks;
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
