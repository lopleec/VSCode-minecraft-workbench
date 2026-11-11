import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gameEnvironment } from '../src/game-environment';

test('Wayland games do not inherit an X11-only GTK override from VS Code', () => {
  const source = {
    DISPLAY: ':1',
    WAYLAND_DISPLAY: 'wayland-0',
    XDG_SESSION_TYPE: 'wayland',
    GDK_BACKEND: 'x11',
    JAVA_HOME: '/jdk',
  };
  const env = gameEnvironment(source, 'linux');
  assert.equal(env.GDK_BACKEND, undefined);
  assert.equal(env.WAYLAND_DISPLAY, 'wayland-0');
  assert.equal(env.DISPLAY, ':1');
  assert.equal(env.JAVA_HOME, '/jdk');
  assert.equal(source.GDK_BACKEND, 'x11', 'The extension host environment must not change');
  const child = execFileSync(
    process.execPath,
    [
      '-e',
      'process.stdout.write(JSON.stringify({gtk:process.env.GDK_BACKEND,wayland:process.env.WAYLAND_DISPLAY}))',
    ],
    { env: { ...process.env, ...env, GDK_BACKEND: env.GDK_BACKEND }, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(child), { wayland: 'wayland-0' });
});

test('Snap GTK paths are restored from saved originals, including unset values', () => {
  const env = gameEnvironment(
    {
      GTK_PATH: '/snap/code/gtk',
      GTK_PATH_VSCODE_SNAP_ORIG: "''",
      GDK_BACKEND: 'x11',
      GDK_BACKEND_VSCODE_SNAP_ORIG: 'wayland,x11',
      GIO_MODULE_DIR: '/snap/code/modules',
      GIO_MODULE_DIR_VSCODE_SNAP_ORIG: '/system/modules',
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
    },
    'linux',
  );
  assert.equal(env.GTK_PATH, undefined);
  assert.equal(env.GDK_BACKEND, 'wayland,x11');
  assert.equal(env.GIO_MODULE_DIR, '/system/modules');
});

test('X11 sessions, explicit SDL backends and non-Linux launches retain their intended environment', () => {
  const x11 = { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11', GDK_BACKEND: 'x11' };
  assert.deepEqual(gameEnvironment(x11, 'linux'), x11);
  const forced = { ...x11, WAYLAND_DISPLAY: 'wayland-1', SDL_VIDEO_DRIVER: 'x11' };
  assert.equal(gameEnvironment(forced, 'linux').GDK_BACKEND, 'x11');
  for (const platform of ['win32', 'darwin'] as const)
    assert.deepEqual(gameEnvironment(forced, platform), forced);
  const compatible = gameEnvironment({ ...forced, SDL_VIDEO_DRIVER: 'wayland' }, 'linux', 'x11');
  assert.equal(compatible.SDL_VIDEO_DRIVER, 'x11');
  assert.equal(compatible.SDL_VIDEODRIVER, 'x11');
  assert.equal(compatible.WAYLAND_DISPLAY, undefined);
  assert.equal(compatible.XDG_SESSION_TYPE, 'x11');
  assert.equal(gameEnvironment(x11, 'linux', 'wayland').GDK_BACKEND, 'wayland');
});
