export interface McpOperation {
  name: string;
  method: string;
  description: string;
  properties?: Record<string, unknown>;
  required?: string[];
  readOnly?: boolean;
  destructive?: boolean;
}
const str = (description: string) => ({ type: 'string', description });
const choice = (values: string[], description?: string) => ({
  type: 'string',
  enum: values,
  description,
});
const bool = { type: 'boolean' };
const id = str('ID from workbench_state.');
const instanceId = { instanceId: id };
const serverId = { serverId: id };
const kind = choice(['mod', 'plugin', 'modpack', 'resourcepack', 'shader']);
const target = { ...instanceId, ...serverId, kind };
export const mcpOperations: McpOperation[] = [
  {
    name: 'terracotta_status',
    method: 'terracotta.status',
    description: 'Read cached Terracotta Beta status. Does not enable, download or start it.',
    readOnly: true,
  },
  {
    name: 'terracotta_connect',
    method: 'terracotta.connect',
    description:
      'Connect the installed official Terracotta component. Requires its setting enabled and notices accepted manually in VS Code.',
  },
  {
    name: 'terracotta_download',
    method: 'terracotta.download',
    description:
      'Download a checksum-verified official Terracotta component. Requires separate user consent in VS Code first.',
  },
  {
    name: 'terracotta_create_room',
    method: 'terracotta.host',
    description:
      'Share an existing Minecraft LAN world through Terracotta. The player must open their world to LAN first.',
  },
  {
    name: 'terracotta_join_room',
    method: 'terracotta.join',
    description: 'Join an invited Terracotta room. Requires the Beta setting and manual consent.',
    properties: { code: str('U/XXXX-XXXX-XXXX-XXXX room code') },
    required: ['code'],
  },
  {
    name: 'terracotta_leave_room',
    method: 'terracotta.leave',
    description: 'Leave the current Terracotta room.',
  },
  {
    name: 'terracotta_launch',
    method: 'terracotta.launch',
    description:
      'Launch a selected client instance into the joined room using a temporary loopback address. Does not change its saved server setting.',
    properties: instanceId,
    required: ['instanceId'],
  },
  {
    name: 'world_import',
    method: 'launcher.importWorld',
    description:
      'Open a native picker to import Java Edition world folders or ZIPs. Existing worlds are kept; name collisions create separate worlds.',
    properties: instanceId,
    required: ['instanceId'],
  },
  {
    name: 'world_export',
    method: 'launcher.exportWorld',
    description: 'Open native world selection and save a standard Java Edition world ZIP.',
    properties: instanceId,
    required: ['instanceId'],
  },
  {
    name: 'instance_scan',
    method: 'launcher.scanInstances',
    description:
      'Scan a Minecraft/HMCL/PCL root, Prism/MultiMC instances folder, Modrinth profile folder, or ZIP export. Returns import candidate keys without reading accounts or tokens.',
    properties: { source: str('Absolute source path') },
    required: ['source'],
  },
  {
    name: 'instance_import',
    method: 'launcher.importInstance',
    description:
      'Import a candidate from the latest instance_scan. link manages the existing files; copy creates a Prism/MultiMC instance. Archives must be copied. Existing player worlds, mods and configuration are preserved.',
    properties: {
      key: str('Candidate key from instance_scan'),
      name: str('Instance name'),
      mode: choice(['link', 'copy']),
      root: str('Optional shared Minecraft directory'),
    },
    required: ['key', 'name', 'mode'],
  },
  {
    name: 'account_external_sign_in',
    method: 'launcher.authlibSignIn',
    description:
      'Open native authlib-injector sign-in and profile selection. The user must confirm the resolved provider address and risk notice in VS Code before entering credentials. Cancellation returns false. Credentials are never returned over MCP.',
    properties: { server: str('Optional HTTPS authentication API root or ALI discovery URL') },
  },
  {
    name: 'workbench_state',
    method: 'ready',
    description:
      'List instances, servers, accounts (without tokens), projects, Java runtimes, selected mode and background tasks.',
    readOnly: true,
  },
  {
    name: 'workbench_mode',
    method: 'mode',
    description: 'Switch between launcher, developer and server modes.',
    properties: { mode: choice(['launcher', 'developer', 'server']) },
    required: ['mode'],
  },
  {
    name: 'workbench_settings',
    method: 'settings.read',
    description:
      'Read available settings, defaults, allowed values and current values. Credentials are redacted.',
    readOnly: true,
  },
  {
    name: 'workbench_update_settings',
    method: 'settings.update',
    description: 'Update a global extension setting using a key and value from workbench_settings.',
    properties: { key: str('Setting key without minecraftWorkbench prefix.'), value: {} },
    required: ['key', 'value'],
  },
  {
    name: 'workbench_language',
    method: 'action',
    description:
      'Open the native extension language selector. Agreement page language remains independent.',
    properties: { action: { const: 'language' } },
    required: ['action'],
  },
  {
    name: 'minecraft_versions',
    method: 'launcher.gameVersions',
    description: 'Get all Minecraft versions including snapshots and historical versions.',
    properties: { force: bool },
    readOnly: true,
  },
  {
    name: 'minecraft_loaders',
    method: 'launcher.loaderVersions',
    description: 'List compatible mod loader versions.',
    properties: {
      loader: choice(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
      minecraft: str('Minecraft version'),
    },
    required: ['loader', 'minecraft'],
    readOnly: true,
  },
  {
    name: 'instance_create_or_change_version',
    method: 'launcher.saveSetup',
    description:
      'Create an isolated client instance or change its Minecraft/loader version. Memory is configured separately. Set edit=true and instanceId to change an existing instance.',
    properties: {
      ...instanceId,
      edit: bool,
      install: bool,
      value: {
        type: 'object',
        properties: {
          name: str('Instance name'),
          minecraft: str('Minecraft version'),
          loader: choice(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
          loaderVersion: str('Loader version'),
          parentDirectory: str(
            'Absolute shared Minecraft directory; omit for the standard system path',
          ),
        },
        required: ['name', 'minecraft', 'loader'],
      },
    },
    required: ['value'],
  },
  {
    name: 'instance_select',
    method: 'selectInstance',
    description: 'Select a client instance.',
    properties: instanceId,
    required: ['instanceId'],
  },
  {
    name: 'instance_save_settings',
    method: 'saveInstance',
    description:
      'Save client name, java path, accountId, minMemory/maxMemory (MB), gc (default/g1/zgc), jvmArgs and gameArgs arrays, resolution {width,height,fullscreen}, server address, backupBeforeLaunch. Omit memory fields for global automatic memory.',
    properties: { ...instanceId, value: { type: 'object' } },
    required: ['instanceId', 'value'],
  },
  {
    name: 'instance_action',
    method: 'action',
    description:
      'Launch/stop/install, configure, duplicate, delete (confirmation), move, open directory/log, import/export .mrpack or files, check updates/conflicts, manage backups or open native management pages. Import/export prompts for file paths in VS Code.',
    properties: {
      ...instanceId,
      kind,
      action: choice([
        'launch',
        'stop',
        'install',
        'configure',
        'clone',
        'delete',
        'directory',
        'move',
        'log',
        'backups',
        'importContent',
        'exportPack',
        'exportNative',
        'importPack',
        'importInstance',
        'updates',
        'conflicts',
        'settings',
        'addAccount',
        'detectJava',
        'downloadJava',
        'output',
        'importProject',
      ]),
    },
    required: ['action'],
  },
  {
    name: 'content_search',
    method: 'search',
    description:
      'Browse or search Modrinth with icons/descriptions. Empty query lists popular projects. Supply serverId for server plugins/mods or instanceId for client content.',
    properties: {
      ...target,
      query: str('Search text or empty string'),
      order: choice(['downloads', 'relevance', 'follows', 'newest', 'updated']),
      compatible: bool,
      offset: { type: 'integer', minimum: 0 },
    },
    readOnly: true,
  },
  {
    name: 'content_project',
    method: 'project',
    description: 'Read project description, license, links and icon.',
    properties: { projectId: id },
    required: ['projectId'],
    readOnly: true,
  },
  {
    name: 'content_versions',
    method: 'versions',
    description:
      'List all project versions, optionally filtered by game, loader, channel, query or compatibility. Paginated in groups of 30.',
    properties: {
      ...target,
      projectId: id,
      game: str('Minecraft version'),
      loader: str('Loader'),
      channel: choice(['release', 'beta', 'all']),
      query: str('Version filter'),
      compatible: bool,
      offset: { type: 'integer', minimum: 0 },
    },
    required: ['projectId'],
    readOnly: true,
  },
  {
    name: 'content_plan',
    method: 'plan',
    description:
      'Resolve required/optional dependencies and conflicts before installing a Modrinth version.',
    properties: { ...target, versionId: id, optional: bool },
    required: ['versionId'],
    readOnly: true,
  },
  {
    name: 'content_install',
    method: 'install',
    description:
      'Install a Modrinth version and its required dependencies. Refuses incompatible content and running targets. Modpack installation opens instance setup.',
    properties: {
      ...target,
      versionId: id,
      optional: bool,
      filename: str('Optional filename from version files'),
    },
    required: ['versionId'],
  },
  {
    name: 'content_installed',
    method: 'installedMetadata',
    description: 'List installed files with enable state, metadata and icons.',
    properties: target,
    readOnly: true,
  },
  {
    name: 'content_change',
    method: 'content.change',
    description:
      'Enable, disable or remove client content (removal prompts in VS Code). For servers use server_content.',
    properties: {
      ...target,
      action: choice(['toggle', 'remove']),
      file: str('Exact installed filename'),
    },
    required: ['action', 'file', 'kind'],
    destructive: true,
  },
  {
    name: 'account_add_offline',
    method: 'launcher.offlineAccount',
    description: 'Add an offline account with a valid player name.',
    properties: { name: str('3–16 ASCII letters, digits, underscores') },
    required: ['name'],
  },
  {
    name: 'account_set_client_id',
    method: 'launcher.clientId',
    description:
      'Configure a user-supplied Microsoft OAuth Client ID, or empty to use offline accounts.',
    properties: { value: str('OAuth application Client ID') },
    required: ['value'],
  },
  {
    name: 'account_sign_in',
    method: 'launcher.signIn',
    description: 'Start interactive Microsoft sign-in in VS Code. Tokens stay in SecretStorage.',
  },
  {
    name: 'account_action',
    method: 'launcher.accountAction',
    description:
      'Switch account, refresh credentials or remove an account with confirmation. Never returns tokens.',
    properties: { id, action: choice(['use', 'refresh', 'remove']) },
    required: ['id', 'action'],
  },
  {
    name: 'java_action',
    method: 'launcher.javaAction',
    description:
      'Detect, add, choose default or reveal a Java runtime. Add with no path opens a picker.',
    properties: {
      action: choice(['detect', 'add', 'default', 'reveal']),
      path: str('Java executable path'),
    },
    required: ['action'],
  },
  {
    name: 'java_download',
    method: 'launcher.downloadJava',
    description: 'Download a matching Eclipse Temurin JDK for the host OS/architecture.',
    properties: { major: { type: 'integer', minimum: 8, maximum: 99 } },
    required: ['major'],
  },
  {
    name: 'task_action',
    method: 'launcher.jobAction',
    description: 'Cancel/retry a task or show output.',
    properties: { id, action: choice(['cancel', 'retry', 'output']) },
    required: ['id', 'action'],
  },
  {
    name: 'world_backups',
    method: 'launcher.backups',
    description: 'List client world backups.',
    properties: instanceId,
    readOnly: true,
  },
  {
    name: 'world_backup_action',
    method: 'launcher.backupAction',
    description: 'Create/open/restore client backups. Restore confirms and backs up current saves.',
    properties: { ...instanceId, id, action: choice(['create', 'open', 'restore']) },
    required: ['action'],
  },
  {
    name: 'project_templates',
    method: 'launcher.projectTemplates',
    description: 'List official Fabric, Forge or NeoForge development templates.',
    properties: {
      loader: choice(['fabric', 'forge', 'neoforge']),
      minecraft: str('Required for Forge'),
    },
    required: ['loader'],
    readOnly: true,
  },
  {
    name: 'project_create',
    method: 'launcher.createProject',
    description:
      'Create an official mod project. Package name is user supplied, e.g. com.example.modid.',
    properties: {
      loader: choice(['fabric', 'forge', 'neoforge']),
      minecraft: str('Minecraft version'),
      template: str('Exact template name'),
      name: str('Project name'),
      modId: str('Mod ID'),
      packageName: str('Java package name'),
      parent: str('Absolute project parent directory'),
      open: bool,
    },
    required: ['loader', 'template', 'name', 'modId', 'packageName', 'parent'],
  },
  {
    name: 'project_action',
    method: 'launcher.projectAction',
    description:
      'Open/build/clean/runClient/debug/attach/generate sources/reveal artifacts/remove a project registration. Gradle actions use VS Code Tasks.',
    properties: {
      id,
      action: choice([
        'open',
        'build',
        'clean',
        'runClient',
        'debug',
        'attach',
        'sources',
        'artifacts',
        'remove',
      ]),
    },
    required: ['id', 'action'],
  },
  {
    name: 'server_catalog',
    method: 'server.catalog',
    description:
      'Get versions for Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge, Velocity or custom JAR.',
    properties: {
      engine: choice([
        'vanilla',
        'paper',
        'purpur',
        'folia',
        'fabric',
        'quilt',
        'forge',
        'neoforge',
        'velocity',
        'custom',
      ]),
    },
    required: ['engine'],
    readOnly: true,
  },
  {
    name: 'server_builds',
    method: 'server.builds',
    description: 'List exact server builds/loader versions and stable flags.',
    properties: { engine: str('Server engine'), version: str('Version from server_catalog') },
    required: ['engine', 'version'],
    readOnly: true,
  },
  {
    name: 'server_create',
    method: 'server.create',
    description:
      'Create an isolated server. install=true prepares it; start=true installs and starts it. Missing JDK is downloaded automatically. First start requires the user to accept the EULA in VS Code.',
    properties: {
      value: {
        type: 'object',
        properties: {
          name: str('Server name'),
          engine: str('Server engine'),
          version: str('Version from catalog'),
          minecraft: str('Content compatibility game version for Velocity'),
          build: str('Exact build; omit to choose latest stable'),
          parent: str('Absolute parent directory; omit for default'),
        },
        required: ['name', 'engine', 'version'],
      },
      install: bool,
      start: bool,
    },
    required: ['value'],
  },
  {
    name: 'server_action',
    method: 'server.action',
    description:
      'Select/start/stop/restart/install/repair/change version, open console/config/directory, import custom JAR/content, remove server registration. Force stop and version changes require native confirmation.',
    properties: {
      ...serverId,
      action: choice([
        'select',
        'start',
        'stop',
        'restart',
        'forceStop',
        'install',
        'version',
        'log',
        'directory',
        'config',
        'importJar',
        'importContent',
        'delete',
      ]),
    },
    required: ['serverId', 'action'],
  },
  {
    name: 'server_logs',
    method: 'server.logs',
    description: 'Read bounded recent server console lines and process status.',
    properties: { ...serverId, limit: { type: 'integer', minimum: 1, maximum: 1000 } },
    required: ['serverId'],
    readOnly: true,
  },
  {
    name: 'server_command',
    method: 'server.command',
    description:
      'Send one Minecraft console command. No shell execution. Commands can change permissions/worlds; request only changes the user authorized.',
    properties: { ...serverId, command: str('Single server command without a leading slash') },
    required: ['serverId', 'command'],
    destructive: true,
  },
  {
    name: 'server_properties',
    method: 'server.properties',
    description:
      'Read editable gameplay/network properties. Passwords and RCON credentials are excluded.',
    properties: serverId,
    required: ['serverId'],
    readOnly: true,
  },
  {
    name: 'server_save_settings',
    method: 'server.save',
    description:
      'Save server name/java/javaMajor/minMemory/maxMemory/jvmArgs plus gameplay properties. Property values are strings. Available keys are returned by server_properties. Server must be stopped.',
    properties: {
      ...serverId,
      value: { type: 'object' },
      properties: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['serverId', 'value'],
  },
  {
    name: 'server_content',
    method: 'server.content',
    description:
      'List/check updates/conflicts, toggle/remove/update installed server mods or plugins. Mutation requires a stopped server.',
    properties: {
      ...serverId,
      action: choice(['list', 'updates', 'conflicts', 'toggle', 'remove', 'update']),
      file: str('Installed filename'),
      kind: choice(['mod', 'plugin']),
    },
    required: ['serverId', 'action'],
  },
  {
    name: 'server_backups',
    method: 'server.backups',
    description: 'List server world backups.',
    properties: serverId,
    required: ['serverId'],
    readOnly: true,
  },
  {
    name: 'server_backup',
    method: 'server.backup',
    description: 'Back up worlds of a stopped server.',
    properties: serverId,
    required: ['serverId'],
  },
  {
    name: 'server_restore',
    method: 'server.restore',
    description:
      'Restore a server backup, with confirmation and backup of current worlds. Server must be stopped.',
    properties: { ...serverId, id },
    required: ['serverId', 'id'],
    destructive: true,
  },
  {
    name: 'workbench_command',
    method: 'native.command',
    description:
      'Open native UI for functions needing user interaction, including proxy credentials, import/export, language, documentation and storage. Only allowlisted Minecraft Workbench commands are supported.',
    properties: {
      command: choice([
        'mode',
        'terracotta',
        'createInstance',
        'importInstance',
        'selectInstance',
        'launch',
        'stop',
        'install',
        'configureInstance',
        'deleteInstance',
        'openInstance',
        'gameLog',
        'exportInstance',
        'addAccount',
        'selectAccount',
        'removeAccount',
        'detectJava',
        'addJava',
        'downloadJava',
        'javaActions',
        'search',
        'browse',
        'installed',
        'language',
        'cloneInstance',
        'exportPack',
        'importContent',
        'importPack',
        'checkUpdates',
        'conflicts',
        'backups',
        'createProject',
        'importProject',
        'projectActions',
        'jobActions',
        'refreshManifest',
        'refresh',
        'settings',
        'output',
        'openStorage',
        'proxyCredentials',
        'curseforgeKey',
        'help',
        'agreements',
        'checkExtensionUpdates',
        'manageInstances',
        'manageAccounts',
        'manageJava',
        'manageTasks',
        'showView',
        'manageProjects',
        'manageServers',
        'createServer',
        'serverActions',
        'startServer',
        'stopServer',
        'inspectInstance',
        'mcp',
        'mcpCopy',
        'registerMcp',
        'unregisterMcp',
      ]),
    },
    required: ['command'],
  },
];
