import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { Network } from '../src/network';
import { MockAgent } from 'undici';
import { writeJson } from '../src/files';
import { resourceOf, sourceUrl } from '../src/sources';

test('resource routing keeps authentication and unsupported hosts official', () => {
  assert.equal(resourceOf('https://resources.download.minecraft.net/ab/abcd'), 'assets');
  assert.equal(
    sourceUrl('https://resources.download.minecraft.net/ab/abcd', { assets: 'bmclapi' }),
    'https://bmclapi2.bangbang93.com/assets/ab/abcd',
  );
  assert.equal(
    sourceUrl('https://api.minecraftservices.com/minecraft/profile', { loader: 'bmclapi' }),
    'https://api.minecraftservices.com/minecraft/profile',
  );
  assert.equal(
    sourceUrl('https://libraries.minecraft.net/a/b.jar', {
      libraries: 'https://mirror.test/maven',
    }),
    'https://mirror.test/maven/a/b.jar',
  );
  assert.throws(() =>
    sourceUrl('https://libraries.minecraft.net/a', { libraries: 'http://unsafe.test' }),
  );
});
test('download resumes, handles ignored ranges, follows redirects and validates hashes', async () => {
  const data = Buffer.from('minecraft-workbench-download-test'.repeat(1000));
  const sha1 = createHash('sha1').update(data).digest('hex');
  const seen: { route: string; range?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ route: req.url!, range: req.headers.range });
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/file' });
      res.end();
      return;
    }
    const offset =
      req.headers.range && req.url !== '/ignore'
        ? Number(/bytes=(\d+)/.exec(req.headers.range)?.[1])
        : 0;
    if (offset >= data.length) {
      res.writeHead(416);
      res.end();
      return;
    }
    res.writeHead(offset ? 206 : 200, {
      etag: '"v1"',
      'content-length': data.length - offset,
      ...(offset ? { 'content-range': `bytes ${offset}-${data.length - 1}/${data.length}` } : {}),
    });
    if (req.url === '/slow') {
      let position = offset;
      const timer = setInterval(() => {
        res.write(data.subarray(position, position + 1000));
        position += 1000;
        if (position >= data.length) {
          clearInterval(timer);
          res.end();
        }
      }, 3);
      res.once('close', () => clearInterval(timer));
      return;
    }
    res.end(data.subarray(offset));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-net-'));
  const net = new Network({ proxy: '', sources: {}, concurrency: 2 });
  try {
    for (const route of ['/file', '/ignore', '/redirect']) {
      const target = path.join(root, route.slice(1));
      await fs.writeFile(target + '.part', data.subarray(0, 150));
      await writeJson(target + '.part.json', { url: base + route, etag: '"v1"' });
      await net.download(base + route, target, { hash: sha1, size: data.length });
      assert.deepEqual(await fs.readFile(target), data);
    }
    assert.ok(seen.some((req) => req.route === '/file' && req.range === 'bytes=150-'));
    const target = path.join(root, 'complete');
    await fs.writeFile(target + '.part', data);
    await writeJson(target + '.part.json', { url: base + '/file', etag: '"v1"' });
    await net.download(base + '/file', target, { hash: sha1 });
    assert.deepEqual(await fs.readFile(target), data);
    await assert.rejects(
      net.download(base + '/file', path.join(root, 'bad'), { hash: 'f'.repeat(40) }),
      /checksum/,
    );
    await assert.rejects(fs.access(path.join(root, 'bad')));
    await net.download(base + '/file', path.join(root, 'unknown-size'), { size: -1 });
    assert.deepEqual(await fs.readFile(path.join(root, 'unknown-size')), data);
    const interrupted = path.join(root, 'interrupted');
    const controller = new AbortController();
    await assert.rejects(
      net.download(base + '/slow', interrupted, {
        hash: sha1,
        signal: controller.signal,
        progress: (bytes) => {
          if (bytes > 5000) controller.abort();
        },
      }),
    );
    assert.ok((await fs.stat(interrupted + '.part')).size > 0);
    await net.download(base + '/slow', interrupted, { hash: sha1 });
    assert.deepEqual(await fs.readFile(interrupted), data);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      net.download(base + '/file', path.join(root, 'cancel'), { signal: abort.signal }),
    );
  } finally {
    await net.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('shared cache deduplicates downloads across instances and keeps instance edits isolated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-shared-cache-'));
  const data = Buffer.from('shared minecraft client');
  const hash = createHash('sha1').update(data).digest('hex');
  let downloads = 0;
  const server = createServer((_req, res) => {
    downloads++;
    res.writeHead(200, { 'content-length': data.length });
    res.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const network = new Network({
    proxy: '',
    sources: {},
    concurrency: 4,
    retries: 0,
    cacheDirectory: path.join(root, 'cache'),
  });
  try {
    const first = path.join(root, 'one', 'client.jar'),
      second = path.join(root, 'two', 'client.jar');
    await Promise.all([
      network.download(`http://127.0.0.1:${address.port}/client`, first, {
        hash,
        size: data.length,
      }),
      network.download(`http://127.0.0.1:${address.port}/client`, second, {
        hash,
        size: data.length,
      }),
    ]);
    assert.equal(downloads, 1);
    await fs.writeFile(first, 'modified');
    assert.deepEqual(await fs.readFile(second), data);
    await network.download(
      `http://127.0.0.1:${address.port}/client`,
      path.join(root, 'three.jar'),
      { hash, size: data.length },
    );
    assert.equal(downloads, 1);
  } finally {
    await network.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('large downloads use parallel ranges and fall back when a host ignores Range', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-ranges-'));
  const data = Buffer.alloc(17 * 1024 ** 2, 7);
  const hash = createHash('sha256').update(data).digest('hex');
  let active = 0,
    maxActive = 0,
    ranges = 0;
  const server = createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'content-length': data.length,
        'accept-ranges': 'bytes',
        etag: '"test"',
      });
      res.end();
      return;
    }
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (range && req.url !== '/ignore') {
      ranges++;
      active++;
      maxActive = Math.max(active, maxActive);
      const start = Number(range[1]),
        end = Number(range[2]);
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${data.length}`,
        'content-length': end - start + 1,
      });
      setTimeout(() => {
        res.end(data.subarray(start, end + 1));
        active--;
      }, 30);
    } else {
      res.writeHead(200, { 'content-length': data.length });
      res.end(data);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const network = new Network({
    proxy: '',
    sources: {},
    concurrency: 4,
    retries: 1,
    connectionsPerFile: 4,
    chunkSize: 4 * 1024 ** 2,
  });
  try {
    await network.download(
      `http://127.0.0.1:${address.port}/ranges`,
      path.join(root, 'ranges.jar'),
      { hash, algorithm: 'sha256', size: data.length },
    );
    assert.ok(ranges >= 4);
    assert.ok(maxActive > 1);
    assert.deepEqual(await fs.readFile(path.join(root, 'ranges.jar')), data);
    await network.download(
      `http://127.0.0.1:${address.port}/ignore`,
      path.join(root, 'ignore.jar'),
      { hash, algorithm: 'sha256', size: data.length },
    );
    assert.deepEqual(await fs.readFile(path.join(root, 'ignore.jar')), data);
  } finally {
    await network.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('verified files from an older isolated runtime seed the shared cache without network', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-legacy-cache-'));
  const data = Buffer.from('existing minecraft client');
  const hash = createHash('sha1').update(data).digest('hex');
  const legacy = path.join(root, 'old', '.runtime');
  await fs.mkdir(path.join(legacy, 'versions', '1.21.4'), { recursive: true });
  await fs.writeFile(path.join(legacy, 'versions', '1.21.4', '1.21.4.jar'), data);
  const network = new Network({
    proxy: '',
    sources: {},
    concurrency: 4,
    retries: 0,
    cacheDirectory: path.join(root, 'cache'),
    runtimeRoots: () => [legacy],
  });
  try {
    const target = path.join(root, 'new', '.runtime', 'versions', '1.21.4', '1.21.4.jar');
    await network.download('http://127.0.0.1:1/unreachable', target, { hash, size: data.length });
    assert.deepEqual(await fs.readFile(target), data);
  } finally {
    await network.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('concurrent requests for one shared path serialize unchecksummed writes and redact invalid JSON responses', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-shared-path-'));
  let active = 0,
    peak = 0;
  let releaseHeld: (() => void) | undefined;
  let started: (() => void) | undefined;
  const holding = new Promise<void>((resolve) => {
    started = resolve;
  });
  const server = createServer((req, res) => {
    if (req.url === '/json') {
      res.end('private-response-token-not-json');
      return;
    }
    active++;
    peak = Math.max(peak, active);
    res.write('start');
    const finish = () => {
      res.end('end');
      active--;
    };
    if (req.url === '/held') {
      releaseHeld = finish;
      started?.();
    } else setTimeout(finish, 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const network = new Network({ proxy: '', sources: {}, concurrency: 4, retries: 0 });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const destination = path.join(root, 'shared-installer.jar');
    await Promise.all([
      network.download(url + '/file', destination),
      network.download(url + '/file', destination),
    ]);
    assert.equal(peak, 1);
    assert.equal(await fs.readFile(destination, 'utf8'), 'startend');
    assert.deepEqual(await fs.readdir(root), ['shared-installer.jar']);
    const first = network.download(url + '/held', destination);
    await holding;
    const cancelled = new AbortController();
    const second = network.download(url + '/file', destination, { signal: cancelled.signal });
    cancelled.abort();
    await assert.rejects(second, { name: 'AbortError' });
    const third = network.download(url + '/file', destination);
    releaseHeld?.();
    await Promise.all([first, third]);
    assert.equal(peak, 1);
    assert.equal(await fs.readFile(destination, 'utf8'), 'startend');
    await assert.rejects(network.json(url + '/json'), (error: Error) => {
      assert.match(error.message, /Invalid JSON response/);
      assert.doesNotMatch(error.message, /private-response-token/);
      return true;
    });
  } finally {
    await network.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('authentication discovery explicitly bypasses configured download mirrors', async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  let mirrorHits = 0;
  mock
    .get('https://auth.example.net')
    .intercept({ path: '/api/yggdrasil/' })
    .reply(200, '{"provider":true}');
  mock
    .get('https://mirror.example')
    .intercept({ path: '/api/yggdrasil/' })
    .reply(() => {
      mirrorHits++;
      return { statusCode: 200, data: '{"mirror":true}' };
    });
  const network = new Network({
    proxy: '',
    sources: { project: 'https://mirror.example' },
    concurrency: 1,
  });
  Object.assign(network, { directDispatcher: mock });
  try {
    assert.deepEqual(
      await network.json('https://auth.example.net/api/yggdrasil/', {
        redirects: false,
        bypassSources: true,
      }),
      { provider: true },
    );
    assert.equal(mirrorHits, 0);
  } finally {
    await network.close();
    await mock.close();
  }
});
