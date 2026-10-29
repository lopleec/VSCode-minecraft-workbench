import { ContentKind, ContentTarget, ModVersion } from './models';

export type ProjectKind = ContentKind | 'modpack';
export type SearchOrder = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';
export interface SearchOptions {
  order?: SearchOrder;
  limit?: number;
  signal?: AbortSignal;
}
export interface ModProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url?: string;
  downloads: number;
  followers: number;
  categories: string[];
  game_versions: string[];
  loaders: string[];
  project_type: ProjectKind;
  server_side?: string;
  license?: { id: string; name: string };
  source_url?: string;
  issues_url?: string;
  wiki_url?: string;
}
export interface InstallPlanEntry {
  version: ModVersion;
  kind: ContentKind;
  action: 'install' | 'update' | 'enable' | 'installed';
  required: boolean;
}
export interface InstallPlan {
  entries: InstallPlanEntry[];
  optional: string[];
  conflicts: string[];
}
export interface ContentInstallOptions {
  includeOptional?: boolean;
  filename?: string;
}
export function contentLoaders(target: ContentTarget, kind: ProjectKind): string[] {
  if (kind === 'plugin') {
    return (
      (
        {
          paper: ['paper', 'spigot', 'bukkit'],
          purpur: ['purpur', 'paper', 'spigot', 'bukkit'],
          folia: ['folia'],
          velocity: ['velocity'],
        } as Record<string, string[]>
      )[target.loader] || []
    );
  }
  return kind === 'mod' ? [target.loader] : [];
}
export function compatible(
  version: ModVersion,
  instance: ContentTarget,
  kind: ProjectKind,
): boolean {
  return (
    version.game_versions.includes(instance.minecraft) &&
    (!['mod', 'plugin'].includes(kind) ||
      contentLoaders(instance, kind).some((l) => version.loaders.includes(l)))
  );
}
export function contentFile(version: ModVersion, name?: string) {
  const file = name
    ? version.files.find((f) => f.filename === name)
    : version.files.find((f) => f.primary) || version.files[0];
  if (!file) throw new Error('Content file not found');
  return file;
}
