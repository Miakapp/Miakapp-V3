import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildBrowserRelayTrustedProviderOwnerBundle,
} from '../browser-relay-trusted-provider-owner/bundle.mjs';
import {
  StagingBrowserRelayTrustedProviderProcessError,
} from '../browser-relay-trusted-provider-process/contract.mjs';
import {
  createBrowserRelayTrustedProviderProcess,
} from '../browser-relay-trusted-provider-process/process.mjs';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'miakapp-complete-owner-proof-')));
chmodSync(root, 0o700);
let ownerProcess;

try {
  const bundle = buildBrowserRelayTrustedProviderOwnerBundle();
  const path = join(root, 'owner.bundle');
  writeFileSync(path, bundle.bytes, { mode: 0o600 });
  ownerProcess = createBrowserRelayTrustedProviderProcess({
    owner_bundle_path: path,
    owner_bundle_sha256: bundle.sha256,
    ready_timeout_milliseconds: 60_000,
    operation_timeout_milliseconds: 900_000,
    cancellation_grace_milliseconds: 5_000,
  });
  const result = await ownerProcess.execute();
  assert.equal(result.schema, 'miakapp.staging-browser-relay-operation-result/1');
  assert.equal(result.state, 'completed_once_fully_clean');
  assert.equal(result.matrix_executions, 1);
  assert.equal(result.browser_invocations, 3);
  assert.equal(result.window_result.matrix_result.assertions_passed, 40);
  assert.equal(result.window_result.matrix_result.assertions_failed, 0);
  assert.equal(result.credentials_retained, false);
  assert.equal(result.raw_cloud_responses_retained, false);
  assert.equal(result.browser_diagnostics_retained, false);
  await ownerProcess.close();
  ownerProcess = createBrowserRelayTrustedProviderProcess({
    owner_bundle_path: path,
    owner_bundle_sha256: bundle.sha256,
    ready_timeout_milliseconds: 60_000,
    operation_timeout_milliseconds: 900_000,
    cancellation_grace_milliseconds: 5_000,
  });
  const controller = new AbortController();
  const operation = ownerProcess.execute({ signal: controller.signal });
  const cancellation = assert.rejects(operation, (error) => (
    error instanceof StagingBrowserRelayTrustedProviderProcessError
    && error.code === 'aborted'
    && !error.message.includes('private abort reason')
  ));
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  controller.abort(new Error('private abort reason'));
  await cancellation;
  await ownerProcess.close();
  process.stdout.write(
    'chromium+firefox+webkit: one complete offline owner graph and one active cancellation closed through their processes.\n',
  );
} catch {
  try { await ownerProcess?.close(); } catch {}
  process.stderr.write('Complete offline trusted-provider owner browser proof failed closed.\n');
  process.exitCode = 1;
} finally {
  rmSync(root, { force: true, recursive: true });
}
