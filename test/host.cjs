const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
exports.run = async function () {
  const extension = vscode.extensions.getExtension('Lopleec.minecraft-workbench');
  assert.ok(extension, 'Extension is installed in the development host');
  const api = await extension.activate();
  assert.ok(api?.store, 'Extension activates successfully');
  if (!api.consent.accepted) {
    assert.equal(api.workbench.snapshot().page, 'agreements');
    await assert.rejects(
      api.workbench.handle('launcher.gameVersions', {}),
      /Accept the agreements/,
    );
    await vscode.commands.executeCommand('minecraftWorkbench.launch');
    assert.equal(api.workbench.snapshot().page, 'agreements');
  }
  await api.workbench.handle('consent.accept', {
    version: api.consent.snapshot().version,
    minecraftEula: true,
    workbenchTerms: true,
  });
  assert.equal(api.consent.accepted, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of extension.packageJSON.contributes.commands)
    assert.ok(commands.includes(command.command), command.command);
  await api.java.detect();
  assert.ok(api.store.state.java.length > 0, 'Local Java detection succeeds');
  await api.accounts.offline('WorkbenchTest');
  assert.equal(api.store.state.accounts[0].name, 'WorkbenchTest');
  assert.equal(api.store.state.accounts[0].kind, 'offline');
  assert.ok(!JSON.stringify(api.store.state).includes('accessToken'));
  const manifest = await api.minecraft.manifest();
  assert.ok(manifest.versions.some((v) => v.id === '1.21.1'));
  for (const loader of ['fabric', 'quilt', 'forge', 'neoforge']) {
    const versions = await api.minecraft.loaders(loader, '1.21.1');
    assert.ok(versions.length > 0, `${loader} versions are discovered`);
    console.log(`${loader}: ${versions[0]}`);
  }
  const results = await api.content.search('Sodium', 'mod', {
    minecraft: '1.21.1',
    loader: 'fabric',
  });
  assert.ok(results.hits.length > 0, 'Modrinth search succeeds');
  const templates = await api.developer.templates('fabric');
  assert.ok(templates.length > 0, 'Official Fabric template branches are discovered');
  const neo = await api.developer.templates('neoforge');
  assert.ok(neo.length > 0, 'NeoForge MDKs are discovered');
  const existing = api.store.state.instances.find((i) => i.id === 'host-test');
  const targetLoader = process.env.MW_TEST_LOADER || 'fabric';
  const targetVersion =
    targetLoader === 'fabric'
      ? '0.16.10'
      : (await api.minecraft.loaders(targetLoader, '1.21.1'))[0];
  const fixture = {
    ...existing,
    id: 'host-test',
    name: 'Minecraft 1.21.1',
    minecraft: '1.21.1',
    loader: targetLoader,
    loaderVersion: targetVersion,
    installed: existing?.loader === targetLoader ? existing.installed : false,
    createdAt: new Date().toISOString(),
    directory: path.join(api.store.root, 'instances', 'host-test'),
  };
  await fs.mkdir(fixture.directory, { recursive: true });
  api.store.state.instances = api.store.state.instances.filter((i) => i.id !== fixture.id);
  api.store.state.instances.push(fixture);
  api.store.state.selectedInstance = fixture.id;
  await api.store.save();
  if (process.env.MW_LIVE_INSTALL === '1') {
    await api.minecraft.install(fixture);
    assert.equal(fixture.installed, true);
    console.log(`${targetLoader} Minecraft installation completed`);
  }
  if (process.env.MW_LIVE_LAUNCH === '1') {
    await api.minecraft.start(fixture);
    const game = api.minecraft.running.get(fixture.id);
    assert.ok(game, 'Minecraft process started');
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Minecraft startup timed out')), 90000);
        game.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Minecraft exited early: ${code}`));
        });
        game.stdout.on('data', (data) => {
          if (/Sound engine started|Created:.*atlas/.test(data.toString())) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      console.log('Minecraft offline launch reached graphics and sound initialization');
    } finally {
      await api.minecraft.stop(fixture);
    }
  }
  await vscode.commands.executeCommand('workbench.view.extension.minecraftWorkbench');
  await fs.writeFile(
    path.join(api.store.root, 'host-test-result.json'),
    JSON.stringify({
      commands: extension.packageJSON.contributes.commands.length,
      java: api.store.state.java.length,
      manifest: manifest.versions.length,
      search: results.hits.length,
      templates: templates.length,
      neoTemplates: neo.length,
      installed: fixture.installed || false,
    }),
  );
  console.log('Minecraft Workbench extension-host tests passed');
};
