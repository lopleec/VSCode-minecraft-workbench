import type { ConsentStatus } from '../consent';
import type { TerracottaStatus } from '../terracotta';
import type {
  Account,
  Content,
  Instance,
  JavaRuntime,
  ModVersion,
  Project,
  ServerProfile,
  Mode,
} from '../models';
import type { ModProject, ProjectKind, SearchOrder, InstallPlan } from '../modrinth';

export const workbenchPages = [
  'agreements',
  'discover',
  'installed',
  'instance',
  'instances',
  'create',
  'import',
  'version',
  'accounts',
  'java',
  'downloads',
  'backups',
  'projects',
  'multiplayer',
  'servers',
  'serverCreate',
  'server',
] as const;
export type WorkbenchPage = (typeof workbenchPages)[number];
export interface Preferences {
  order: SearchOrder;
  pageSize: number;
  compatibleOnly: boolean;
  channel: 'release' | 'beta' | 'all';
  icons: boolean;
  density: string;
  optional: boolean;
}
export interface Bootstrap {
  consent: ConsentStatus;
  locale: 'en' | 'zh-cn';
  page: WorkbenchPage;
  kind: ProjectKind;
  instances: Instance[];
  selectedInstance?: string;
  accounts: Account[];
  selectedAccount?: string;
  projects: Project[];
  mode: Mode;
  servers: ServerProfile[];
  selectedServer?: string;
  serverStatus: Record<string, string>;
  mcpEnabled: boolean;
  terracotta?: TerracottaStatus;
  java: JavaRuntime[];
  running: string[];
  instanceStatus: Record<string, 'running' | 'starting' | 'installing' | 'stopped'>;
  preferences: Preferences;
  defaults: {
    minMemory: number;
    maxMemory: number;
    memory: {
      totalMemory: number;
      percentage: number;
      minMemory: number;
      maxMemory: number;
      automaticMinimum: boolean;
      automaticMaximum: boolean;
    };
    gc: string;
    width: number;
    height: number;
    fullscreen: boolean;
    backup: boolean;
    gameDirectory: string;
    instanceDirectory: string;
    gameLanguage: string;
    projectDirectory: string;
    javaPath: string;
    clientId: string;
    autoOpenProject: boolean;
    serverDirectory: string;
  };
  jobs: { id: string; label: string; status: string; detail?: string }[];
}
export interface InstalledEntry extends Content {
  title?: string;
  description?: string;
  icon?: string;
  versionName?: string;
}
export interface VersionsPage {
  versions: ModVersion[];
  total: number;
  games: string[];
  loaders: string[];
}
export interface ProjectDetail {
  project: ModProject;
}
export interface PlanResult {
  version: ModVersion;
  plan: InstallPlan;
  optionalNames: { id: string; name: string }[];
}
export interface BrowserHit {
  project_id: string;
  title: string;
  description: string;
  slug: string;
  downloads: number;
  icon_url?: string;
  author?: string;
}
export interface SearchPage {
  hits: BrowserHit[];
  total_hits: number;
}
export interface ViewRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}
