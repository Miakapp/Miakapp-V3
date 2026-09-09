import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'browser.mjs',
  'bundle.mjs',
  'check.sh',
  'contract.mjs',
  'entry.mjs',
  'guard.mjs',
  'internal.mjs',
  'operation.mjs',
  'owner.mjs',
  'page-host.mjs',
  'profile.json',
  'source-truth.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-chromium-scenario/contract.mjs',
    '../browser-relay-independent-observers/contract.mjs',
    '../browser-relay-operation-case-adapter/contract.mjs',
    '../browser-relay-operation/contract.mjs',
    '../browser-relay-page/contract.mjs',
    '../browser-relay-playwright-bridge/contract.mjs',
    '../browser-relay-source-authority-adapters/contract.mjs',
    '../browser-relay-source-transports/contract.mjs',
    '../browser-relay-trusted-provider-process/contract.mjs',
    '../browser-relay-trusted-source-composition/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'entry.mjs': Object.freeze(['node:fs', 'node:module']),
  'source-truth.mjs': Object.freeze([
    '../browser-relay-independent-observers/contract.mjs', './contract.mjs',
  ]),
  'operation.mjs': Object.freeze([
    '../browser-relay-edge/inventory.mjs',
    '../browser-relay-edge/runtime.mjs',
    '../browser-relay-orchestrator/claim.mjs',
    '../browser-relay-orchestrator/contract.mjs',
    './contract.mjs',
    'node:buffer',
    'node:util',
  ]),
  'page-host.mjs': Object.freeze([
    '../browser-relay-chromium-scenario/contract.mjs',
    '../browser-relay-page/boundary.mjs',
    '../browser-relay-page/contract.mjs',
    '../browser-relay-page/runtime.mjs',
    './contract.mjs',
    'node:buffer',
    'node:child_process',
    'node:fs',
    'node:https',
    'node:os',
    'node:path',
  ]),
  'browser.mjs': Object.freeze([
    '../browser-relay-chromium-scenario/contract.mjs',
    '../browser-relay-page/contract.mjs',
    './contract.mjs',
    './page-host.mjs',
    'node:events',
    'playwright-core',
  ]),
  'internal.mjs': Object.freeze(['./contract.mjs']),
  'owner.mjs': Object.freeze([
    '../browser-relay-trusted-source-composition/composition.mjs',
    './browser.mjs',
    './contract.mjs',
    './internal.mjs',
    './operation.mjs',
    './source-truth.mjs',
  ]),
  'testing.mjs': Object.freeze(['./internal.mjs']),
  'bundle.mjs': Object.freeze([
    '../browser-relay-trusted-provider-process/owner-bundle.mjs',
    './contract.mjs',
    'node:crypto',
    'node:fs',
    'node:path',
    'node:url',
  ]),
});
const PRODUCTION_FILES = Object.freeze([
  'browser.mjs',
  'contract.mjs',
  'entry.mjs',
  'internal.mjs',
  'operation.mjs',
  'owner.mjs',
  'page-host.mjs',
  'source-truth.mjs',
]);

function reject(message) {
  throw new Error(message);
}

function exactNames(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function staticImports(source) {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
}

function dynamicImports(source) {
  return [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)]
    .map((match) => match[1])
    .sort();
}

export async function validateBrowserRelayTrustedProviderOwnerRoot(rootUrl) {
  const root = lstatSync(rootUrl);
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (!root.isDirectory() || root.isSymbolicLink()
    || !exactNames(entries.map(({ name }) => name), ROOT_FILES)
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Trusted provider owner root differs from the reviewed inventory');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be one non-executable regular file`);
    }
  }
  const contents = Object.fromEntries(ROOT_FILES.map((name) => [
    name,
    readFileSync(new URL(name, rootUrl), 'utf8'),
  ]));
  for (const [name, expected] of Object.entries(STATIC_IMPORTS)) {
    if (!exactNames(staticImports(contents[name]), expected)
      || /^\s*import\s*['"]/mu.test(contents[name])
      || !exactNames(dynamicImports(contents[name]), name === 'entry.mjs' ? ['./owner.mjs'] : [])) {
      reject(`${name} imports differ from the reviewed static allowlist`);
    }
  }

  const production = PRODUCTION_FILES.map((name) => contents[name]).join('\n');
  for (const marker of [
    'createBrowserRelayTrustedProviderSourceTruth',
    'createBrowserRelayTrustedProviderOperation',
    'createBrowserRelayTrustedProviderBrowser',
    'createBrowserRelayTrustedSourceComposition',
    'createBrowserRelayTrustedProviderOwnerInternal',
    'activateOperation',
    'activateBrowser',
    'openChromiumPage',
    'openSecondaryPage',
    'prepareChromiumPhase',
    'browserLifecycle',
    'CONTROL_PHASE_ORDER',
    'RENEWAL_INTERVAL_MILLISECONDS',
    'delayBrowserRelayTrustedProviderOwnerTimeline',
    'TRUSTED_PROVIDER_OWNER_VERSION_TWO_PUBLICATION_MILLISECONDS',
    'SOURCE_AUTHORITY_ADAPTERS_MAXIMUM_READ_MILLISECONDS',
    'SOURCE_TRANSPORTS_READ_TIMEOUT_MILLISECONDS',
    'closeOwnedGraph',
  ]) {
    if (!production.includes(marker)) reject('Trusted provider owner graph has drifted');
  }
  if (!contents['owner.mjs'].includes(
    'export function createBrowserRelayTrustedProviderOwner()',
  )
    || contents['owner.mjs'].includes('testing.mjs')
    || contents['owner.mjs'].includes('ForTesting')
    || !contents['testing.mjs'].includes(
      'createBrowserRelayTrustedProviderOwnerForTesting',
    )) reject('Trusted provider owner production/testing separation has drifted');
  if (!contents['entry.mjs'].includes('registerHooks({')
    || !contents['entry.mjs'].includes('allowedModuleUrls.has(resolution?.url)')
    || !contents['entry.mjs'].includes("new URL('module-allowlist.json', import.meta.url)")) {
    reject('Trusted provider owner executable module allowlist has drifted');
  }

  const pageHost = contents['page-host.mjs'];
  const browserSource = contents['browser.mjs'];
  if (!pageHost.includes("execFileSync('/usr/bin/openssl'")
    || !pageHost.includes("server.listen(0, '127.0.0.1'")
    || !pageHost.includes("request.headers.host === new URL(TARGET_ORIGIN).host")
    || !pageHost.includes('env: Object.create(null)')
    || !pageHost.includes("context.route('**/*'")
    || !pageHost.includes("browser !== 'chromium'")
    || !pageHost.includes("\"connect-src 'self'\"")
    || !pageHost.includes("\"frame-src 'none'\"")
    || !pageHost.includes('EXTERNAL_REQUEST_PROBE_URL')
    || !browserSource.includes('MAP * ~NOTFOUND')
    || (browserSource.match(/--host-resolver-rules=/gu) ?? []).length !== 1
    || !browserSource.includes('externalRequestProbes')
    || !pageHost.includes('rmSync(certificateRoot, { force: true, recursive: true })')) {
    reject('Trusted provider owner loopback page boundary has drifted');
  }
  for (const name of PRODUCTION_FILES.filter((name) => name !== 'page-host.mjs')) {
    if (/node:(?:child_process|http|https|net|tls|dns)|\bexecFileSync\s*\(|\bcreateServer\s*\(/u
      .test(contents[name])) {
      reject(`${name} gained unreviewed process or socket authority`);
    }
  }
  if (/\bprocess\.(?:env|argv)|\bgcloud\b|firebase-admin|google-auth-library|@google-cloud/u
    .test(production)
    || /\b(?:eval|Function)\s*\(|\bXMLHttpRequest\b|\bEventSource\b/u.test(production)
    || /\bmiakapp-3\b|projects\/miakapp-v4(?!-staging)(?:\/|\b)/u.test(production)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
      .test(Object.values(contents).join('\n'))) {
    reject('Trusted provider owner contains ambient, live, or private authority');
  }
  if (!contents['bundle.mjs'].includes('collectRepositoryGraph')
    || !contents['bundle.mjs'].includes('collectPlaywrightRuntime')
    || !contents['bundle.mjs'].includes('PLAYWRIGHT_RUNTIME_FILES')
    || !contents['bundle.mjs'].includes("packageMetadata.version !== '1.62.1'")
    || !contents['bundle.mjs'].includes('buildTrustedProviderOwnerBundle')
    || !contents['bundle.mjs'].includes('PARENT_ONLY_FILES')
    || contents['bundle.mjs'].includes('collectPackageData')
    || contents['bundle.mjs'].includes('PACKAGE_DATA_EXTENSIONS')) {
    reject('Trusted provider owner artifact boundary has drifted');
  }

  const {
    validateBrowserRelayTrustedProviderOwnerProfile,
    validateTrustedProviderOwnerSchedule,
  } = await import('./contract.mjs');
  const { buildBrowserRelayTrustedProviderOwnerBundle } = await import('./bundle.mjs');
  const profile = validateBrowserRelayTrustedProviderOwnerProfile(rootUrl);
  validateTrustedProviderOwnerSchedule();
  const artifact = buildBrowserRelayTrustedProviderOwnerBundle();
  if (artifact.entry_path !== profile.bundle.entry_path
    || artifact.file_count > profile.bundle.maximum_files
    || artifact.bytes.byteLength > profile.bundle.maximum_bytes
    || artifact.repository_file_count !== profile.bundle.repository_files
    || artifact.playwright_file_count !== profile.bundle.playwright_files
    || artifact.file_count !== profile.bundle.repository_files
      + profile.bundle.playwright_files + profile.bundle.generated_data_files
    || artifact.module_file_count !== profile.bundle.module_files
    || profile.graph.provider_method_count !== 32
    || profile.graph.stage_count !== 22
    || profile.graph.observation_count !== 43
    || profile.graph.assertion_count !== 40
    || profile.browsers.real_browser_launch_proven_offline !== true
    || profile.browsers.browser_binary_packaged !== false
    || profile.browsers.strict_offline_content_security_policy !== true
    || profile.browsers.chromium_unmatched_hostnames_fail_resolution !== true
    || profile.browsers.external_request_probe_per_page !== true
    || profile.bundle.playwright_core_tree_included !== false
    || profile.bundle.playwright_core_runtime_subset_included !== true
    || profile.bundle.owner_testing_entry_included !== false
    || profile.bundle.dependency_validation_assets_included !== true
    || profile.bundle.unreferenced_package_files_included !== false
    || profile.bundle.module_allowlist_included !== true
    || profile.bundle.unlisted_bundle_modules_importable !== false
    || profile.bundle.validation_only_assets_importable !== false
    || profile.authority.external_network_authorized !== false
    || profile.authority.cloud_requests_authorized !== false
    || profile.authority.cloud_mutations_authorized !== false
    || profile.authority.live_execution_authorized !== false
    || profile.evidence.external_network_requests !== 0
    || profile.evidence.blocked_external_request_probes !== 4
    || profile.evidence.cloud_requests !== 0
    || profile.evidence.cloud_mutations !== 0
    || profile.evidence.live_execution_count !== 0
    || profile.evidence.incremental_monthly_cost_eur !== 0) {
    reject('Trusted provider owner profile exceeds the reviewed offline authority');
  }
  return profile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    process.stderr.write('Usage: node guard.mjs <browser-relay-trusted-provider-owner-root>\n');
    process.exitCode = 2;
  } else {
    try {
      const profile = await validateBrowserRelayTrustedProviderOwnerRoot(
        pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
      );
      process.stdout.write(
        `Validated ${profile.schema}; the complete owner remains offline-only.\n`,
      );
    } catch {
      process.stderr.write('Trusted provider owner root rejected.\n');
      process.exitCode = 1;
    }
  }
}
