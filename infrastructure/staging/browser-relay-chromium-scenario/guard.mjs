import console from 'node:console';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_FILES = Object.freeze([
  'README.md',
  'away.html',
  'contract.mjs',
  'guard.mjs',
  'internal.mjs',
  'profile.json',
  'scenario.mjs',
  'testing.mjs',
]);
const STATIC_IMPORTS = Object.freeze({
  'contract.mjs': Object.freeze([
    '../browser-relay-aggregator/contract.mjs',
    '../browser-relay-case-scheduler/contract.mjs',
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-page/contract.mjs',
    '../browser-relay-playwright-bridge/contract.mjs',
    '../browser-relay-scenario-fixture/contract.mjs',
    'node:crypto',
    'node:fs',
    'node:util',
  ]),
  'internal.mjs': Object.freeze([
    '../browser-relay-page-receipt/contract.mjs',
    '../browser-relay-page-receipt/producer.mjs',
    '../browser-relay-page/contract.mjs',
    '../browser-relay-runner/driver.mjs',
    './contract.mjs',
    'node:events',
    'node:process',
    'node:util',
    'playwright-core/lib/coreBundle',
    'playwright-core/lib/utilsBundle',
  ]),
  'scenario.mjs': Object.freeze([
    './contract.mjs',
    './internal.mjs',
    'node:util',
  ]),
  'testing.mjs': Object.freeze([
    './contract.mjs',
    './internal.mjs',
    'node:util',
  ]),
});

function reject(message) {
  throw new Error(message);
}

function validateStaticImports(name, source) {
  const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(imports) !== JSON.stringify([...STATIC_IMPORTS[name]].sort())
    || /\b(?:from|import|require)\s*\/[*/]/u.test(source)
    || /\bimport\s*['"]/u.test(source)
    || /\bimport\s*\(/u.test(source)
    || /\brequire\s*\(/u.test(source)) {
    reject(`${name} imports differ from the reviewed source-only allowlist`);
  }
}

export function validateBrowserRelayChromiumScenarioRoot(rootUrl) {
  const root = lstatSync(rootUrl);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    reject('Browser-relay Chromium scenario root must be one real directory');
  }
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (JSON.stringify(entries.map(({ name }) => name).sort())
    !== JSON.stringify([...ROOT_FILES].sort())) {
    reject('Browser-relay Chromium scenario root differs from the reviewed inventory');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    reject('Browser-relay Chromium scenario entries must be regular files');
  }
  for (const name of ROOT_FILES) {
    const entry = lstatSync(new URL(name, rootUrl));
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) !== 0) {
      reject(`${name} must be a non-executable regular file`);
    }
  }
  const contract = readFileSync(new URL('contract.mjs', rootUrl), 'utf8');
  const internal = readFileSync(new URL('internal.mjs', rootUrl), 'utf8');
  const scenario = readFileSync(new URL('scenario.mjs', rootUrl), 'utf8');
  const testing = readFileSync(new URL('testing.mjs', rootUrl), 'utf8');
  validateStaticImports('contract.mjs', contract);
  validateStaticImports('internal.mjs', internal);
  validateStaticImports('scenario.mjs', scenario);
  validateStaticImports('testing.mjs', testing);
  for (const required of [
    "createBrowserRelayPageReceiptProducer('chromium')",
    'validatePlaywrightDiagnosticEnvironment()',
    "control('same_relay_reauthenticated')",
    "control('relay_handoff_stale')",
    'sendCdp(',
    "'Page.enable'",
    "'Page.getFrameTree'",
    "'Page.getNavigationHistory'",
    "'Page.navigateToHistoryEntry'",
    "'Runtime.evaluate'",
    'addCdpListener(',
    "'Page.frameNavigated'",
    "'Page.backForwardCacheNotUsed'",
    'removeCdpListener(',
    "event?.isTrusted !== true",
    "event.persisted !== true",
    'dispatch_visibility_state: dispatchVisibilityState',
    'completed_visibility_state: visibilityState',
    "enumerable: false",
    'await detachCdp(',
    'await closeOwnedPage(first)',
    'const second = await acquirePage(2)',
    'producer.close()',
    'producer.abort()',
    "const debug = env.DEBUG ?? ''",
    "debug.trim() !== ''",
    'env.PWDEBUG !== undefined',
    'env.DEBUG_FILE !== undefined',
    'playwrightDebug.namespaces',
    'Reflect.ownKeys(playwrightDebug.inspectOpts)',
    'playwrightCoreUtils.debugMode()',
    'validatePlaywrightCaptureBoundary(page, captureLeases)',
    'installPlaywrightCaptureLease',
    'installPlaywrightInstrumentationLease',
    'evaluateWithPlaywrightInstrumentationLease',
    'PRIVATE_PLAYWRIGHT_INSTRUMENTATION',
    'validateNoPendingPlaywrightCapture',
    "type === 'Tracing'",
    'SENSITIVE_PENDING_PROTOCOL_METHODS',
    "'Browser.newBrowserCDPSession'",
    "'BrowserContext.newCDPSession'",
    "'Frame.goto'",
    "'sendMessageToServer'",
    "'_mainFrame'",
    "'_instrumentation'",
    "'_isTracing'",
    "'_tracingCount'",
    "'_harRecorders'",
    "'recordVideo'",
    'TRUSTED_PLAYWRIGHT_RUNTIME.pageMethods.video',
    'installPlaywrightPageFactoryLease',
    'releasePlaywrightPageFactoryLease',
    'installPlaywrightNetworkObserverLease',
    'validatePlaywrightNetworkObserverLease',
    'NETWORK_OBSERVER_EVENTS',
    'NETWORK_SUBSCRIPTION_PROTOCOL_EVENTS',
    'installPlaywrightCdpFactoryLease',
    'installTrustedCdpRuntimeLease',
    'validateTrustedCdpRuntimeLease',
    'findTrustedCdpLease',
    'trustedLease.detachTask',
    'reviewedFrameFactory',
    'reviewedPageFactory',
    'reviewedCdpSessionFactory',
    'TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.evaluate',
    'TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.goto',
    'TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.url',
    'TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionMethods.send',
    'TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionMethods.detach',
    'TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerMethods._wrapApiCall',
    'TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerMethods._validatorToWireContext',
    'installTrustedChannelOwnerLease',
    'trustedChannelOwnerLeaseIntact',
    'TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers',
    'TRUSTED_PLAYWRIGHT_RUNTIME.onmessage',
    'PLAYWRIGHT_CORE_DEBUG_LOGGER_VALUES',
    "'onmessage'",
    "'evaluateExpression'",
    'trustedBoundary.channelClose({ reason: undefined })',
    'TRUSTED_PLAYWRIGHT_RUNTIME.pageMethods.isClosed',
    'trustedPageClosureVerified',
    'installTrustedPageCloseLease',
    'MAP_HAS.call(connectionObjects, boundary.pageGuid)',
    'runBrowserRelayChromiumScenarioInternalForTesting',
    'trackLateCleanup',
    'lateCdpSessions',
    'retryDetachLateCdp',
    'retryCloseOwnedPage',
    'trustedChromiumScenarioActive',
    'trustedChromiumScenarioPoisoned',
  ]) {
    if (!internal.includes(required)) {
      reject('Browser-relay Chromium scenario safety boundary has drifted');
    }
  }
  if (!scenario.includes('process.hrtime.bigint()')
    || scenario.includes('./testing.mjs')
    || scenario.includes('ForTesting')
    || !testing.includes('runBrowserRelayChromiumScenarioForTesting')) {
    reject('Browser-relay Chromium scenario entrypoint separation has drifted');
  }
  const guardedSource = `${contract}\n${internal}\n${scenario}\n${testing}`;
  if (/\bimport\s*\(|child_process|execSync|spawnSync|process\.(?:argv|env|stdin)|\bgcloud\b|\bterraform\b|chromium\.launch|\.goBack\(|\.goForward\(/u
    .test(guardedSource)) {
    reject('Browser-relay Chromium scenario source boundary has drifted');
  }
  if (/\bmiakapp-3\b|projects\/miakapp-v4(?:\/|\b)/u.test(guardedSource)) {
    reject('Browser-relay Chromium scenario contains a forbidden target literal');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bya29\.[A-Za-z0-9._-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
    .test(guardedSource)) {
    reject('Browser-relay Chromium scenario contains a credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-chromium-scenario-root>');
    process.exitCode = 2;
  } else {
    validateBrowserRelayChromiumScenarioRoot(
      pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`),
    );
  }
}
