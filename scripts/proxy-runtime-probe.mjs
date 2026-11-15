import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { connect } from 'node:net';
import { WebSocketFactory } from '/opt/desktop-commander-sandbox/node_modules/@supabase/realtime-js/dist/main/index.js';

const targetPort = 18443;
const proxyPort = 18480;
const targetHost = 'proxy-probe.invalid';
const targetAuthority = `${targetHost}:${targetPort}`;
const openSockets = new Set();
let tunnelCount = 0;
let fetchReachedTarget = false;
let webSocketReachedTarget = false;

function track(socket) {
  openSockets.add(socket);
  socket.once('close', () => openSockets.delete(socket));
  return socket;
}

const target = createServer({
  key: readFileSync('/probe/key.pem'),
  cert: readFileSync('/probe/cert.pem'),
}, (req, res) => {
  if (req.url !== '/probe') {
    res.writeHead(404).end();
    return;
  }
  fetchReachedTarget = true;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ synthetic: true }));
});

target.on('upgrade', (req, socket) => {
  if (req.url !== '/socket') {
    socket.destroy();
    return;
  }
  webSocketReachedTarget = true;
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.on('data', (chunk) => {
    if ((chunk[0] & 0x0f) === 0x08) socket.end(Buffer.from([0x88, 0x00]));
  });
});

const proxy = createHttpServer((_req, res) => {
  res.writeHead(405).end('This synthetic proxy only accepts CONNECT.');
});

proxy.on('connect', (req, clientSocket, head) => {
  if (req.url !== targetAuthority) {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  tunnelCount += 1;
  const upstream = track(connect(targetPort, '127.0.0.1'));
  track(clientSocket);
  upstream.once('connect', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  clientSocket.on('error', () => upstream.destroy());
  upstream.on('error', () => clientSocket.destroy());
});

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function close(server) {
  server.closeAllConnections?.();
  for (const socket of openSockets) socket.destroy();
  await new Promise((resolve) => server.close(() => resolve()));
}

try {
  assert.equal(process.version, 'v22.21.0', 'The probe requires the fixed Node image version.');
  assert.equal(process.env.NODE_USE_ENV_PROXY, '1', 'Environment proxy support must be enabled before Node starts.');
  assert.equal(process.env.HTTPS_PROXY, `http://127.0.0.1:${proxyPort}`);
  assert.equal(process.env.NO_PROXY, '');
  const UpstreamWebSocket = WebSocketFactory.getWebSocketConstructor();
  assert.equal(UpstreamWebSocket, globalThis.WebSocket, 'Pinned Supabase Realtime must select Node global WebSocket.');
  await listen(target, targetPort);
  await listen(proxy, proxyPort);

  const response = await fetch(`https://${targetAuthority}/probe`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { synthetic: true });

  const socket = new UpstreamWebSocket(`wss://${targetAuthority}/socket`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic WebSocket handshake timed out.')), 5000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Synthetic WebSocket handshake failed.'));
    }, { once: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic WebSocket close timed out.')), 3000);
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.close();
  });

  assert.equal(fetchReachedTarget, true);
  assert.equal(webSocketReachedTarget, true);
  assert.equal(tunnelCount, 2);
  console.log('PASS: fetch and global WebSocket both used the synthetic HTTPS CONNECT proxy.');
} finally {
  await close(proxy);
  await close(target);
}
