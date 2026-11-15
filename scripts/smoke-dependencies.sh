#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE="ghcr.io/xinnie-live/desktop-commander-sandbox:$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
docker run --rm -i --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 10001:10001 \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,uid=10001,gid=10001 \
  --workdir /opt/desktop-commander-sandbox --entrypoint node "$IMAGE" --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const forge = require('node-forge');
const glob = require('glob');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

// Exercise the exact CSR operations used by MQTT enrollment, with fresh synthetic keys.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const key = forge.pki.privateKeyFromPem(keys.privateKey);
const csr = forge.pki.createCertificationRequest();
csr.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
csr.setSubject([{ name: 'commonName', value: 'dc-device-synthetic' }]);
csr.sign(key, forge.md.sha256.create());
const parsed = forge.pki.certificationRequestFromPem(forge.pki.certificationRequestToPem(csr));
assert.equal(parsed.verify(), true);
assert.equal(parsed.subject.getField('CN').value, 'dc-device-synthetic');
const smallKey = Buffer.alloc(32); smallKey[0] = 1;
const smallSignature = Buffer.alloc(64); smallSignature[0] = 1;
assert.equal(forge.pki.ed25519.verify({ message: Buffer.alloc(0), signature: smallSignature, publicKey: smallKey }), false);

const folder = await mkdtemp('/tmp/dcs-deps-');
try {
  await mkdir(`${folder}/nested`);
  await writeFile(`${folder}/a.txt`, 'synthetic');
  await writeFile(`${folder}/nested/b.txt`, 'synthetic');
  await writeFile(`${folder}/nested/c.json`, '{}');
  assert.deepEqual((await glob.glob('**/*.txt', { cwd: folder, nodir: true })).sort(), ['a.txt', 'nested/b.txt']);
  assert.deepEqual(glob.globSync('**/*.{txt,json}', { cwd: folder, ignore: 'nested/**' }), ['a.txt']);
  await assert.rejects(glob.glob('**/*', { cwd: folder, signal: AbortSignal.abort() }), { name: 'AbortError' });
} finally { await rm(folder, { recursive: true, force: true }); }

const app = new Hono();
app.get('/synthetic', c => c.json({ ok: true }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
try {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/synthetic`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
console.log('PASS patched dependencies: RSA CSR round-trip; small-order signature rejected; glob matching/cancellation; Hono HTTP adapter. No cloud connection.');
NODE
