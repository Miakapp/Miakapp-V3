import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RELAY_IMAGE_FILES = Object.freeze([
  'README.md',
  'apply.mjs',
  'apply.sh',
  'claim.mjs',
  'cloud.mjs',
  'contract.mjs',
  'guard.mjs',
  'inventory.mjs',
  'plan.mjs',
  'plan.sh',
  'profile-v1.json',
  'profile.json',
  'result-v1.json',
  'result-v2.json',
  'result.mjs',
  'source.mjs',
]);

function exactNames(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('Relay image root must contain only the reviewed file inventory');
  }
}

export function validateRelayImageRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  exactNames(entries.map(({ name }) => name), RELAY_IMAGE_FILES);
  for (const entry of entries) {
    const url = new URL(entry.name, rootUrl);
    const stat = lstatSync(url);
    if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Relay image entry ${entry.name} must be a regular file`);
    }
    const executable = (stat.mode & 0o111) !== 0;
    if (entry.name.endsWith('.sh') !== executable) {
      throw new Error(`Relay image entry ${entry.name} executable mode differs from the reviewed inventory`);
    }
  }

  const combined = RELAY_IMAGE_FILES
    .filter((name) => name !== 'guard.mjs'
      && (name.endsWith('.mjs') || name.endsWith('.sh')))
    .map((name) => readFileSync(new URL(name, rootUrl), 'utf8'))
    .join('\n');
  const claim = readFileSync(new URL('claim.mjs', rootUrl), 'utf8');
  const contract = readFileSync(new URL('contract.mjs', rootUrl), 'utf8');
  const result = readFileSync(new URL('result.mjs', rootUrl), 'utf8');
  const consumedEntrypoints = ['apply.mjs', 'plan.mjs']
    .map((name) => readFileSync(new URL(name, rootUrl), 'utf8'));
  const storageUploadEndpoints = combined.match(/upload\/storage\/v1/gu) ?? [];
  if (/gcloud[\s\S]{0,80}(?:builds submit|run deploy)|allUsers|allAuthenticatedUsers/u.test(combined)
    || /['"]miakapp-(?:3|v4)['"]/u.test(combined)
    || storageUploadEndpoints.length !== 1
    || !claim.includes("url.searchParams.set('ifGenerationMatch', '0')")
    || !contract.includes('requestedVerifyOption: profile.build.requested_verify_option')
    || !contract.includes('images: Object.freeze([profile.image.tag_reference])')
    || !combined.includes('validateFinalRelayImageInventory')
    || !combined.includes('relayImageSourceReceipt')
    || !result.includes('validateRelayImageV2Result')
    || consumedEntrypoints.some((source) => (
      !source.includes('export const RELAY_IMAGE_OPERATION_CONSUMED = true')
        || !source.includes('if (RELAY_IMAGE_OPERATION_CONSUMED)')
    ))) {
    throw new Error('Relay image source differs from the reviewed one-shot private boundary');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <browser-relay-image-root>');
    process.exitCode = 2;
  } else {
    try {
      validateRelayImageRoot(pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Relay image root is invalid');
      process.exitCode = 1;
    }
  }
}
