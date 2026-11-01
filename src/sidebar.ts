import * as vscode from 'vscode';
import { t } from './config';
import type { Item, Section, View } from './views';

export const sidebarTitles: Record<Section, [string, string]> = {
  home: ['Workbench', '工作台'],
  instances: ['Instances', '实例'],
  projects: ['Projects', '项目'],
  servers: ['Servers', '服务端'],
  content: ['Content', '内容'],
  accounts: ['Accounts', '账户'],
  java: ['Java', 'Java'],
  downloads: ['Tasks', '任务'],
};

export class Sidebar implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly entries = (Object.keys(sidebarTitles) as Section[]).map((section) => {
    let resolve!: (provider?: View) => void;
    const ready = new Promise<View | undefined>((done) => (resolve = done));
    const changed = new vscode.EventEmitter<Item | undefined>();
    const tree = vscode.window.createTreeView(`minecraftWorkbench.${section}`, {
      treeDataProvider: {
        onDidChangeTreeData: changed.event,
        getTreeItem: (item: Item) => item,
        getChildren: async (parent?: Item) => (await ready)?.getChildren(parent) ?? [],
      },
      showCollapseAll: section === 'instances' || section === 'content',
    });
    tree.title = t(...sidebarTitles[section]);
    this.subscriptions.push(changed, tree);
    return { section, tree, resolve, changed, provider: undefined as View | undefined };
  });

  initialize(factory: (section: Section) => View) {
    for (const entry of this.entries) {
      const provider = factory(entry.section);
      entry.provider = provider;
      this.subscriptions.push(
        provider,
        provider.onDidChangeTreeData(() => entry.changed.fire(undefined)),
      );
      entry.resolve(provider);
    }
  }

  refresh() {
    for (const { section, tree, provider } of this.entries) {
      tree.title = t(...sidebarTitles[section]);
      provider?.refresh();
    }
  }

  fail(message: string) {
    for (const { tree, resolve } of this.entries) {
      tree.message = message;
      resolve();
    }
  }

  dispose() {
    for (const entry of this.entries) entry.resolve();
    for (const subscription of this.subscriptions.splice(0).reverse()) subscription.dispose();
  }
}
