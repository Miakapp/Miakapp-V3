import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_FILES = Object.freeze([
  'README.md',
  'apply.mjs',
  'apply.sh',
  'artifact.mjs',
  'browser.mjs',
  'claim.mjs',
  'contract.mjs',
  'guard.mjs',
  'hosting.mjs',
  'index.html',
  'inventory.mjs',
  'plan.mjs',
  'plan.sh',
  'preflight-evidence.mjs',
  'preflight-result.json',
  'recovery-apply.mjs',
  'recovery-apply.sh',
  'recovery-plan.mjs',
  'recovery-plan.sh',
  'recovery.mjs',
  'runner.mjs',
]);

function exactNames(actual, expected, description) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${description} must contain only the reviewed browser-attestation inventory`);
  }
}

export function validateBrowserAttestationRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()
    || lstatSync(new URL(entry.name, rootUrl)).isSymbolicLink()
    || !entry.isFile())) {
    throw new Error('Browser-attestation root may contain regular files only');
  }
  exactNames(entries.map(({ name }) => name), REQUIRED_FILES, 'Browser-attestation root');
  for (const name of REQUIRED_FILES) {
    const executable = (lstatSync(new URL(name, rootUrl)).mode & 0o111) !== 0;
    if (name.endsWith('.sh') !== executable) {
      throw new Error(`${name} executable mode does not match the reviewed browser-attestation inventory`);
    }
  }
  const index = readFileSync(new URL('index.html', rootUrl), 'utf8');
  const runner = readFileSync(new URL('runner.mjs', rootUrl), 'utf8');
  const combined = `${index}\n${runner}`;
  if (!index.includes('<script type="module" src="/runner.mjs"></script>')
    || !runner.includes('__MIAKAPP_FIREBASE_CONFIG__')
    || !runner.includes('__MIAKAPP_RECAPTCHA_SITE_KEY__')
    || /miakapp-3|demo-miakapp-v4|projects\/miakapp-v4(?:\/|\b)/u.test(combined)
    || /AIza[0-9A-Za-z_-]{20,}|-----BEGIN|\bya29\.|\beyJ[A-Za-z0-9_-]{8,}\./u.test(combined)) {
    throw new Error('Browser-attestation source contains a target, public key or credential literal');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-attestation-root>');
    process.exitCode = 2;
  } else {
    validateBrowserAttestationRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
  }
}
