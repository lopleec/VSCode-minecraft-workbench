// VS Code's GTK settings belong to its own window, not to Minecraft's window backend.
export function gameEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  backend = 'auto',
): NodeJS.ProcessEnv {
  const env = { ...source };
  if (platform !== 'linux') return env;
  for (const name of [
    'GDK_BACKEND',
    'GTK_PATH',
    'GTK_EXE_PREFIX',
    'GTK_IM_MODULE_FILE',
    'GDK_PIXBUF_MODULE_FILE',
    'GDK_PIXBUF_MODULEDIR',
    'GIO_MODULE_DIR',
    'GSETTINGS_SCHEMA_DIR',
    'XDG_CONFIG_DIRS',
    'XDG_DATA_DIRS',
    'LOCPATH',
  ]) {
    const original = source[`${name}_VSCODE_SNAP_ORIG`];
    if (original === undefined) continue;
    if (!original || original === "''") delete env[name];
    else env[name] = original;
  }
  const wayland = !!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland';
  const x11 = env.SDL_VIDEO_DRIVER === 'x11' || env.SDL_VIDEODRIVER === 'x11';
  if (wayland && !x11 && env.GDK_BACKEND?.trim().toLowerCase() === 'x11') delete env.GDK_BACKEND;
  if (backend === 'x11' || backend === 'wayland') {
    env.SDL_VIDEO_DRIVER = backend;
    env.SDL_VIDEODRIVER = backend;
    env.GDK_BACKEND = backend;
    env.XDG_SESSION_TYPE = backend;
    if (backend === 'x11') delete env.WAYLAND_DISPLAY;
  }
  return env;
}
