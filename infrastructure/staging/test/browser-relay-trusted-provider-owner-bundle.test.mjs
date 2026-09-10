import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  buildBrowserRelayTrustedProviderOwnerBundle,
} from '../browser-relay-trusted-provider-owner/bundle.mjs';
import {
  materializeTrustedProviderOwnerBundle,
} from '../browser-relay-trusted-provider-process/owner-bundle.mjs';

const MAGIC_BYTES = 8;
const HEADER_BYTES = 12;

function manifest(bytes) {
  assert.equal(bytes.subarray(0, MAGIC_BYTES).toString('ascii'), 'MIAKOWN1');
  const length = bytes.readUInt32BE(MAGIC_BYTES);
  return JSON.parse(bytes.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8'));
}

function bootstrap() {
  const authority = Object.freeze(Object.assign(Object.create(null), {
    async consume(callback) {
      const bytes = Buffer.alloc(32, 0xa5);
      try {
        return await callback(bytes);
      } finally {
        bytes.fill(0);
      }
    },
  }));
  return Object.freeze(Object.assign(Object.create(null), { authority }));
}

test('builds one byte-identical complete dependency-bearing owner artifact', () => {
  const first = buildBrowserRelayTrustedProviderOwnerBundle();
  const second = buildBrowserRelayTrustedProviderOwnerBundle();
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(
    first.file_count,
    first.repository_file_count + first.playwright_file_count + 1,
  );
  assert.equal(first.repository_file_count, 204);
  assert.equal(first.playwright_file_count, 13);
  assert.equal(first.module_file_count, 87);
  assert.equal(first.file_count, 218);
  assert.ok(first.file_count < 512);
  assert.ok(first.bytes.byteLength < 32 * 1024 * 1024);
  const decoded = manifest(first.bytes);
  assert.equal(decoded.entry_path, first.entry_path);
  assert.equal(decoded.files.length, first.file_count);
  const paths = decoded.files.map(({ path }) => path);
  assert.ok(paths.includes(first.entry_path));
  assert.ok(paths.includes('node_modules/playwright-core/package.json'));
  assert.ok(paths.includes('node_modules/playwright-core/browsers.json'));
  assert.ok(paths.includes('node_modules/playwright-core/LICENSE'));
  assert.ok(paths.includes('node_modules/playwright-core/lib/utilsBundle.js.LICENSE'));
  assert.ok(paths.includes('node_modules/playwright-core/types/protocol.d.ts'));
  assert.ok(paths.includes('node_modules/playwright-core/types/types.d.ts'));
  assert.equal(paths.includes('node_modules/playwright-core/README.md'), false);
  assert.equal(paths.includes('node_modules/playwright-core/cli.js'), false);
  assert.equal(paths.some((path) => path.includes('/lib/tools/')), false);
  assert.equal(paths.some((path) => path.includes('/bin/reinstall_')), false);
  assert.ok(paths.includes(
    'infrastructure/staging/browser-relay-trusted-provider-owner/module-allowlist.json',
  ));
  assert.equal(paths.includes(
    'infrastructure/staging/browser-relay-trusted-provider-owner/testing.mjs',
  ), false);
  assert.deepEqual(
    paths.filter((path) => /^infrastructure\/.*\/README\.md$/u.test(path)),
    ['infrastructure/staging/browser-relay-edge/README.md'],
  );
  assert.deepEqual(paths.filter((path) => /\.(?:tf|hcl|tfrc)$/u.test(path)), [
    'infrastructure/staging/browser-relay-services/.terraform.lock.hcl',
    'infrastructure/staging/browser-relay-services/foundation.tf',
    'infrastructure/staging/browser-relay-services/locals.tf',
    'infrastructure/staging/browser-relay-services/main.tf',
    'infrastructure/staging/browser-relay-services/outputs.tf',
    'infrastructure/staging/browser-relay-services/providers.tf',
    'infrastructure/staging/browser-relay-services/terraform-cli.tfrc',
    'infrastructure/staging/browser-relay-services/variables.tf',
    'infrastructure/staging/browser-relay-services/versions.tf',
  ]);
  assert.equal(paths.some((path) => /(?:^|\/)key-apply\.mjs$/u.test(path)), false);
  assert.equal(paths.includes(
    'infrastructure/staging/browser-relay-operation-case-adapter/testing.mjs',
  ), true);
  assert.equal(paths.some((path) => path.includes('/test/browser-relay-trusted-provider-owner')),
    false);
  assert.equal(paths.some((path) => /(?:\.app\/|chrome-mac|firefox\/firefox|pw_run\.sh)/u.test(path)),
    false);
});

test('materializes an inert owner whose only module export and public fields are exact', async (t) => {
  const bundle = buildBrowserRelayTrustedProviderOwnerBundle();
  const artifactRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'miakapp-owner-artifact-')));
  const workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'miakapp-owner-workspace-')));
  chmodSync(artifactRoot, 0o700);
  chmodSync(workspace, 0o700);
  t.after(() => rmSync(artifactRoot, { force: true, recursive: true }));
  t.after(() => rmSync(workspace, { force: true, recursive: true }));
  const artifactPath = join(artifactRoot, 'owner.bundle');
  writeFileSync(artifactPath, bundle.bytes, { mode: 0o600 });
  const materialized = materializeTrustedProviderOwnerBundle({
    owner_bundle_path: artifactPath,
    owner_bundle_sha256: bundle.sha256,
    owner_workspace_path: workspace,
  });
  assert.equal(materialized.file_count, bundle.file_count);
  const module = await import(materialized.entry_url);
  const moduleAllowlist = JSON.parse(readFileSync(join(
    workspace,
    'infrastructure/staging/browser-relay-trusted-provider-owner/module-allowlist.json',
  ), 'utf8'));
  assert.equal(
    moduleAllowlist.schema,
    'miakapp.browser-relay-trusted-provider-owner-module-allowlist/1',
  );
  assert.equal(moduleAllowlist.modules.length, bundle.module_file_count);
  assert.equal(moduleAllowlist.modules.some((path) => (
    path.includes('/test/')
    || path.endsWith('/testing.mjs')
    || path === 'infrastructure/staging/browser-relay-edge/cloud.mjs'
    || /\.(?:tf|hcl|tfrc)$/u.test(path)
    || (path.endsWith('/guard.mjs')
      && path !== 'infrastructure/staging/browser-relay-edge/guard.mjs')
  )), false);
  assert.deepEqual(Object.keys(module), ['createBrowserRelayTrustedProviderOwner']);
  const owner = module.createBrowserRelayTrustedProviderOwner(bootstrap());
  assert.equal(Object.getPrototypeOf(owner), null);
  assert.deepEqual(Object.keys(owner), ['execute', 'close']);
  await assert.rejects(
    import(pathToFileURL(join(
      workspace,
      'infrastructure/staging/browser-relay-operation-case-adapter/testing.mjs',
    )).href),
    /module graph rejected/u,
  );
  await owner.close();
  assert.equal(pathToFileURL(workspace).protocol, 'file:');
});
