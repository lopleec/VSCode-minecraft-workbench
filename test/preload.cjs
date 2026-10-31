const Module = require('node:module');
const path = require('node:path');
const original = Module._load;
const stub = {
  window: {},
  commands: {},
  version: '1.96.0',
  ProgressLocation: { Notification: 15 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  Uri: {
    file: (file) => ({
      scheme: 'file',
      fsPath: file,
      toString: () => require('node:url').pathToFileURL(file).href,
    }),
    parse: (value) => ({ scheme: new URL(value).protocol.slice(0, -1), toString: () => value }),
    from: (value) => ({ ...value, fsPath: value.fsPath || value.path }),
  },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }), isTrusted: true },
  env: { language: 'en' },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  TreeItem: class {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  ThemeIcon: class {},
};
Module._load = function (id, ...args) {
  if (id === 'vscode') return stub;
  if (id === '@xmcl/unzip') id = path.join(__dirname, '../node_modules/@xmcl/unzip/dist/index.js');
  if (id === '@xmcl/core/utils') id = path.join(__dirname, '../src/compat/xmcl-utils.ts');
  return original.call(this, id, ...args);
};
