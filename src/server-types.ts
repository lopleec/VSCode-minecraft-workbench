import type { ServerEngine } from './models';

export const serverEngines: {
  id: ServerEngine;
  name: string;
  content?: 'mod' | 'plugin';
  manual?: boolean;
}[] = [
  { id: 'vanilla', name: 'Vanilla' },
  { id: 'paper', name: 'Paper', content: 'plugin' },
  { id: 'purpur', name: 'Purpur', content: 'plugin' },
  { id: 'folia', name: 'Folia', content: 'plugin' },
  { id: 'spigot', name: 'Spigot', content: 'plugin', manual: true },
  { id: 'bukkit', name: 'Bukkit', content: 'plugin', manual: true },
  { id: 'fabric', name: 'Fabric', content: 'mod' },
  { id: 'quilt', name: 'Quilt', content: 'mod' },
  { id: 'forge', name: 'Forge', content: 'mod' },
  { id: 'neoforge', name: 'NeoForge', content: 'mod' },
  { id: 'velocity', name: 'Velocity', content: 'plugin' },
  { id: 'custom', name: 'Custom JAR', manual: true },
];
export const serverContent = (engine: string) =>
  serverEngines.find((entry) => entry.id === engine)?.content;
export const manualServer = (engine: string) =>
  serverEngines.some((entry) => entry.id === engine && entry.manual);
