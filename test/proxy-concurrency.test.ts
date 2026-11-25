import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { SocksClient } from 'socks';
import { Network } from '../src/network';

test('HTTP and SOCKS proxy metadata requests respect the configured connection limit', async () => {
  for (const kind of ['http', 'socks5h']) {
    let active = 0,
      peak = 0;
    const sockets = new Set<Socket>();
    const origin = createServer((_request, response) => {
      peak = Math.max(peak, ++active);
      setTimeout(() => {
        active--;
        response.end('{"ok":true}');
      }, 20);
    });
    const proxy = createServer();
    proxy.on('connection', (socket) => sockets.add(socket));
    proxy.on('connect', (request, socket, head) => {
      const target = new URL('http://' + request.url);
      const upstream = connect(Number(target.port), target.hostname, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      sockets.add(upstream);
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    });
    await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const port = (origin.address() as AddressInfo).port;
    const socks = mock.method(
      SocksClient,
      'createConnection',
      async (options: Parameters<typeof SocksClient.createConnection>[0]) => {
        const socket = connect(options.destination.port, options.destination.host);
        sockets.add(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('error', reject);
        });
        return { socket } as never;
      },
    );
    const network = new Network({
      proxy: `${kind}://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
      sources: {},
      concurrency: 2,
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          network.json(`http://127.0.0.1:${port}/metadata/${i}`),
        ),
      );
      assert.ok(results.every((value) => (value as { ok: boolean }).ok));
      assert.equal(peak, 2, kind);
      if (kind === 'socks5h') assert.equal(socks.mock.callCount(), 2);
    } finally {
      await network.close();
      socks.mock.restore();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => origin.close(() => resolve())),
        new Promise<void>((resolve) => proxy.close(() => resolve())),
      ]);
    }
  }
});
