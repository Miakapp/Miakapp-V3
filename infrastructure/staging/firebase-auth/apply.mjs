import {
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  FIREBASE_AUTH_CONFIG_NAME,
  PROJECT_ID,
  PROJECT_NUMBER,
  assertSafeWorkloadEnvironment,
  canonicalJson,
  readFirebaseAuthPlanMetadata,
  readPrivateFile,
  sha256,
  validateFirebaseAuthApplyAuthorization,
  verifiedOperatorEmail,
  verifyExactMain,
  writePrivateFile,
} from './contract.mjs';
import {
  createTerraformData,
  firebaseAuthRoot,
  privateBundle,
  repositoryRoot,
  run,
  terraformEnvironment,
  validateStagingManifest,
  validateToolchain,
} from './cli.mjs';
import { validateFirebaseAuthRoot } from './guard.mjs';
import { readAndValidateFirebaseAuthPlan } from './validate-plan.mjs';

const APPLY_AUTHORIZATION = 'MIAKAPP_STAGING_FIREBASE_AUTH_APPLY_AUTHORIZATION';
process.umask(0o077);

export function validateFirebaseAuthResult(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Firebase Auth Terraform output is invalid');
  }
  const expected = {
    schema: 'miakapp.staging-firebase-auth/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    config_name: FIREBASE_AUTH_CONFIG_NAME,
    anonymous_sign_in: false,
    email_sign_in: false,
    phone_sign_in: false,
    duplicate_emails: false,
    user_signup_disabled: false,
    user_deletion_disabled: false,
    anonymous_user_autodelete: true,
    multi_tenant: false,
    mfa: 'DISABLED',
    request_logging: false,
  };
  if (!isDeepStrictEqual(value, expected)) {
    throw new Error('Firebase Auth Terraform output does not match the reviewed closed baseline');
  }
  return Object.freeze(value);
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    throw new Error(`Usage: ${APPLY_AUTHORIZATION}=... ./apply.sh <private-bundle>`);
  }
  assertSafeWorkloadEnvironment(process.env, APPLY_AUTHORIZATION);
  validateFirebaseAuthRoot(new URL('./', import.meta.url));
  validateToolchain();
  validateStagingManifest();
  const bundle = privateBundle(process.argv[2]);
  const { value: metadata } = readFirebaseAuthPlanMetadata(join(bundle, 'metadata.json'));
  verifyExactMain(repositoryRoot, metadata.repository_commit);
  verifiedOperatorEmail(repositoryRoot);

  const planPath = join(bundle, 'firebase-auth.tfplan');
  const planJsonPath = join(bundle, 'firebase-auth.tfplan.json');
  const planBytes = readPrivateFile(planPath);
  const planJsonBytes = readPrivateFile(planJsonPath, 16 * 1024 * 1024);
  if (sha256(planBytes) !== metadata.terraform_plan_sha256
    || sha256(planJsonBytes) !== metadata.terraform_plan_json_sha256) {
    throw new Error('Firebase Auth bundle digest verification failed');
  }
  validateFirebaseAuthApplyAuthorization(
    process.env[APPLY_AUTHORIZATION],
    planBytes,
    metadata.repository_commit,
  );
  const summary = readAndValidateFirebaseAuthPlan(planJsonPath);
  if (!isDeepStrictEqual(summary, metadata.summary)) {
    throw new Error('Firebase Auth metadata summary no longer matches the reviewed plan');
  }

  const terraformData = createTerraformData(bundle, 'apply');
  const environment = terraformEnvironment(terraformData);
  let mutationAttempted = false;
  try {
    run('terraform', ['init', '-reconfigure', '-input=false', '-lockfile=readonly', '-no-color'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'apply-init',
    });
    const shown = run('terraform', ['show', '-json', planPath], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'apply-show',
    });
    if (sha256(Buffer.from(shown.stdout)) !== metadata.terraform_plan_json_sha256) {
      throw new Error('Terraform Firebase Auth plan no longer renders to the reviewed JSON');
    }

    mutationAttempted = true;
    const applied = run('terraform', [
      'apply', '-input=false', '-auto-approve', '-no-color', planPath,
    ], {
      env: environment,
      allowedStatuses: [0, 1],
      description: 'terraform-apply',
    });
    const applyFailed = applied.status !== 0;
    if (applyFailed) {
      const bytes = Buffer.concat([
        Buffer.from(applied.stdout ?? ''),
        Buffer.from(applied.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'apply-failure.log'),
        bytes.length === 0 ? Buffer.from('Apply failed without diagnostics\n') : bytes,
      );
    }

    const convergence = run('terraform', [
      'plan',
      '-input=false',
      '-lock-timeout=5m',
      '-no-color',
      '-detailed-exitcode',
    ], {
      env: environment,
      allowedStatuses: [0, 1, 2],
      description: 'terraform-convergence',
    });
    if (convergence.status !== 0) {
      const bytes = Buffer.concat([
        Buffer.from(convergence.stdout ?? ''),
        Buffer.from(convergence.stderr ?? ''),
      ]);
      writePrivateFile(
        join(bundle, 'convergence-failure.log'),
        bytes.length === 0 ? Buffer.from('Convergence failed without diagnostics\n') : bytes,
      );
      throw new Error(applyFailed
        ? 'Firebase Auth apply failed and live initialization state is uncertain'
        : 'Firebase Auth apply completed but the follow-up plan is not empty');
    }

    const output = run('terraform', ['output', '-json', 'staging_firebase_auth'], {
      env: environment,
      diagnosticDirectory: bundle,
      description: 'terraform-output',
    });
    let result;
    try {
      result = validateFirebaseAuthResult(JSON.parse(Buffer.from(output.stdout).toString('utf8')));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Firebase Auth Terraform output is invalid JSON');
      throw error;
    }
    const resultPath = join(bundle, 'result.json');
    writePrivateFile(resultPath, Buffer.from(canonicalJson(result), 'utf8'), 0o400);
    chmodSync(planPath, 0o400);
    verifyExactMain(repositoryRoot, metadata.repository_commit);
    process.stdout.write([
      applyFailed
        ? 'The provider returned an error after the exact Firebase Auth baseline converged.'
        : 'The exact non-deletable Firebase Auth initialization plan was applied and converged.',
      `Private result: ${resultPath}`,
      'Sign-in providers: 0; public endpoints created: 0; persistent credentials created: 0.',
      '',
    ].join('\n'));
  } catch (error) {
    if (mutationAttempted) {
      throw new Error([
        error instanceof Error ? error.message : 'Firebase Auth initialization failed.',
        'The service may already be initialized and cannot be deleted; private diagnostics and state were preserved.',
        'Use recovery-plan.sh to inventory and adopt only the exact existing staging configuration.',
      ].join(' '));
    }
    throw error;
  } finally {
    rmSync(terraformData, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Firebase Auth apply failed');
    process.exitCode = 1;
  });
}
