import { lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ALLOWED_FILES = Object.freeze([
  'README.md',
  'apply.sh',
  'github-policy.json',
  'guard.mjs',
  'inspect-plan.sh',
  'plan.sh',
  'staging-terraform.yml',
  'summarize-plan.mjs',
  'validate-policy.mjs',
]);

export function validateAutomationRoot(rootUrl) {
  const entries = readdirSync(rootUrl, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...ALLOWED_FILES].sort())) {
    throw new Error('Automation root must contain only the reviewed blueprint inventory');
  }
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, rootUrl);
    if (!entry.isFile() || entry.isSymbolicLink() || lstatSync(entryUrl).isSymbolicLink()) {
      throw new Error(`Automation entry ${entry.name} must be a regular non-symlink file`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootPath = process.argv[2];
  if (process.argv.length !== 3 || rootPath === undefined) {
    console.error('Usage: node guard.mjs <automation-root>');
    process.exitCode = 2;
  } else {
    const rootUrl = pathToFileURL(rootPath.endsWith('/') ? rootPath : `${rootPath}/`);
    validateAutomationRoot(rootUrl);
  }
}
