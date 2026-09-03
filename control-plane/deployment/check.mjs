import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildProductionArchive } from './package.mjs';

const directory = mkdtempSync(join(tmpdir(), 'miakapp-control-plane-package-check-'));
try {
  const first = buildProductionArchive(join(directory, 'first.zip'), { compile: false });
  const second = buildProductionArchive(join(directory, 'second.zip'), { compile: false });
  const firstBytes = readFileSync(first.archive_path);
  const secondBytes = readFileSync(second.archive_path);
  if (!firstBytes.equals(secondBytes)
    || first.archive_sha256 !== second.archive_sha256
    || first.archive_sha256 !== createHash('sha256').update(firstBytes).digest('hex')
    || first.entrypoint !== 'controlPlane'
    || first.module !== 'lib/production-entrypoint.js'
    || first.files.includes('lib/index.js')
    || first.files.includes('lib/config.js')
    || !first.files.includes('lib/production-entrypoint.js')) {
    throw new Error('Production package reproducibility or isolation check failed');
  }
  process.stdout.write(`Production package check passed (${first.files.length} files, ${first.archive_sha256}).\n`);
} finally {
  rmSync(directory, { force: true, recursive: true });
}
