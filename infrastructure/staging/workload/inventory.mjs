import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  OPERATOR_USER_SHA256,
  PROJECT_ID,
  PROJECT_NUMBER,
  REGION,
  RUNTIME_CONFIG_SHA256,
  childEnvironment,
} from './contract.mjs';

const FUNCTION_NAME = 'control-plane';
const BUILD_ACCOUNT = `miakapp-control-build@${PROJECT_ID}.iam.gserviceaccount.com`;
const RUNTIME_ACCOUNT = `miakapp-control-plane@${PROJECT_ID}.iam.gserviceaccount.com`;
const PROBE_ACCOUNT = `miakapp-staging-probe@${PROJECT_ID}.iam.gserviceaccount.com`;
const SOURCE_BUCKET = `${PROJECT_ID}-function-source-${PROJECT_NUMBER}`;
const REPOSITORY = `projects/${PROJECT_ID}/locations/${REGION}/repositories/miakapp-control-plane`;
const FCM_ROLE = `projects/${PROJECT_ID}/roles/miakapp.controlPlaneFcmSender`;
const MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024;

function reject(message) {
  throw new Error(message);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} does not match the reviewed workload`);
}

function jsonCommand(args, repositoryRoot, spawn = spawnSync) {
  const result = spawn('gcloud', [...args, '--quiet', '--format=json'], {
    cwd: repositoryRoot,
    env: childEnvironment(),
    maxBuffer: MAXIMUM_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = Buffer.from(result.stdout ?? '');
  if (result.status !== 0 || result.signal !== null || result.error !== undefined
    || stdout.byteLength === 0 || stdout.byteLength > MAXIMUM_OUTPUT_BYTES) {
    reject('Independent staging workload inventory command failed');
  }
  try {
    return JSON.parse(stdout.toString('utf8'));
  } catch {
    return reject('Independent staging workload inventory returned invalid JSON');
  }
}

function bindings(value) {
  if (!plainObject(value) || (value.bindings !== undefined && !Array.isArray(value.bindings))) {
    reject('IAM policy inventory is invalid');
  }
  return value.bindings ?? [];
}

function exactBinding(policy, role, member) {
  const matching = bindings(policy).filter((binding) => binding.role === role);
  if (matching.length !== 1
    || matching[0].condition !== undefined
    || !isDeepStrictEqual(matching[0].members, [member])) {
    reject(`IAM binding ${role} does not match the reviewed principal`);
  }
}

function exactBindingMembers(policy, role, members) {
  const matching = bindings(policy).filter((binding) => binding.role === role);
  if (matching.length !== 1
    || matching[0].condition !== undefined
    || !isDeepStrictEqual([...(matching[0].members ?? [])].sort(), [...members].sort())) {
    reject(`IAM binding ${role} does not match the reviewed principals`);
  }
}

function noPublicPrincipal(...policies) {
  for (const policy of policies) {
    for (const binding of bindings(policy)) {
      if (!Array.isArray(binding.members)
        || binding.members.some((member) => member === 'allUsers' || member === 'allAuthenticatedUsers')) {
        reject('Staging workload exposes an unauthenticated IAM principal');
      }
    }
  }
}

function account(value, email, description) {
  if (!plainObject(value)
    || value.email !== email
    || value.disabled === true
    || value.name !== `projects/${PROJECT_ID}/serviceAccounts/${email}`) {
    reject(`${description} service account is absent, disabled or foreign`);
  }
}

function userManagedKeys(value, description) {
  if (!Array.isArray(value) || value.length !== 0) {
    reject(`${description} service account has a persistent user-managed key`);
  }
}

export function observeDeployedWorkload({
  repositoryRoot,
  repositoryCommit,
  sourceArchiveSha256,
  operatorUserSha256 = OPERATOR_USER_SHA256,
  observedAt = new Date().toISOString(),
  spawn = spawnSync,
}) {
  if (!/^[0-9a-f]{64}$/u.test(operatorUserSha256)) {
    reject('Independent staging workload inventory policy is invalid');
  }
  const command = (args) => jsonCommand(args, repositoryRoot, spawn);
  const functionValue = command([
    'functions', 'describe', FUNCTION_NAME, '--v2', `--region=${REGION}`, `--project=${PROJECT_ID}`,
  ]);
  const runPolicy = command([
    'run', 'services', 'get-iam-policy', FUNCTION_NAME, `--region=${REGION}`, `--project=${PROJECT_ID}`,
  ]);
  const functionPolicy = command([
    'functions', 'get-iam-policy', FUNCTION_NAME, '--v2', `--region=${REGION}`, `--project=${PROJECT_ID}`,
  ]);
  const fcmRole = command(['iam', 'roles', 'describe', 'miakapp.controlPlaneFcmSender', `--project=${PROJECT_ID}`]);
  const buildAccount = command(['iam', 'service-accounts', 'describe', BUILD_ACCOUNT, `--project=${PROJECT_ID}`]);
  const probeAccount = command(['iam', 'service-accounts', 'describe', PROBE_ACCOUNT, `--project=${PROJECT_ID}`]);
  const buildKeys = command([
    'iam', 'service-accounts', 'keys', 'list', `--iam-account=${BUILD_ACCOUNT}`, '--managed-by=user', `--project=${PROJECT_ID}`,
  ]);
  const probeKeys = command([
    'iam', 'service-accounts', 'keys', 'list', `--iam-account=${PROBE_ACCOUNT}`, '--managed-by=user', `--project=${PROJECT_ID}`,
  ]);
  const probePolicy = command(['iam', 'service-accounts', 'get-iam-policy', PROBE_ACCOUNT, `--project=${PROJECT_ID}`]);
  const sourceBucket = command(['storage', 'buckets', 'describe', `gs://${SOURCE_BUCKET}`, `--project=${PROJECT_ID}`]);
  const sourcePolicy = command(['storage', 'buckets', 'get-iam-policy', `gs://${SOURCE_BUCKET}`]);
  const repository = command([
    'artifacts', 'repositories', 'describe', 'miakapp-control-plane', `--location=${REGION}`, `--project=${PROJECT_ID}`,
  ]);
  const repositoryPolicy = command([
    'artifacts', 'repositories', 'get-iam-policy', 'miakapp-control-plane', `--location=${REGION}`, `--project=${PROJECT_ID}`,
  ]);
  const projectPolicy = command(['projects', 'get-iam-policy', PROJECT_ID]);

  const functionResourceName = `projects/${PROJECT_ID}/locations/${REGION}/functions/${FUNCTION_NAME}`;
  if (!plainObject(functionValue)
    || functionValue.name !== functionResourceName
    || functionValue.state !== 'ACTIVE'
    || functionValue.environment !== 'GEN_2') {
    reject('Cloud Function inventory is not the exact active Gen 2 workload');
  }
  const build = functionValue.buildConfig;
  const service = functionValue.serviceConfig;
  if (!plainObject(build) || !plainObject(service)) reject('Cloud Function config inventory is incomplete');
  exact(build.runtime, 'nodejs22', 'Function runtime');
  exact(build.entryPoint, 'controlPlane', 'Function entry point');
  exact(build.dockerRepository, REPOSITORY, 'Function artifact repository');
  exact(build.serviceAccount, `projects/${PROJECT_ID}/serviceAccounts/${BUILD_ACCOUNT}`, 'Function build account');
  exact(build.source?.storageSource?.bucket, SOURCE_BUCKET, 'Function source bucket');
  exact(build.source?.storageSource?.object, `sources/${sourceArchiveSha256}.zip`, 'Function source object');
  if (!/^[1-9][0-9]*$/u.test(String(build.source?.storageSource?.generation ?? ''))) {
    reject('Function source generation is not immutable');
  }
  exact(service.serviceAccountEmail, RUNTIME_ACCOUNT, 'Function runtime account');
  exact(service.availableMemory, '256M', 'Function memory');
  exact(String(service.availableCpu), '1', 'Function CPU');
  exact(service.timeoutSeconds, 30, 'Function timeout');
  exact(service.minInstanceCount ?? 0, 0, 'Function minimum instances');
  exact(service.maxInstanceCount, 1, 'Function maximum instances');
  exact(service.maxInstanceRequestConcurrency, 16, 'Function concurrency');
  exact(service.ingressSettings, 'ALLOW_INTERNAL_ONLY', 'Function ingress');
  exact(service.allTrafficOnLatestRevision, true, 'Function traffic');
  if (typeof service.uri !== 'string' || !service.uri.startsWith('https://')) {
    reject('Function service URI is invalid');
  }
  const environment = service.environmentVariables;
  if (!plainObject(environment)) reject('Function environment inventory is missing');
  exact(Object.keys(environment).sort(), [
    'LOG_EXECUTION_ID',
    'MIAKAPP_DEPLOYMENT_COMMIT',
    'MIAKAPP_RUNTIME_CONFIG_JSON',
    'MIAKAPP_SOURCE_ARCHIVE_SHA256',
  ], 'Function environment names');
  exact(environment.MIAKAPP_DEPLOYMENT_COMMIT, repositoryCommit, 'Function deployment commit');
  exact(environment.MIAKAPP_SOURCE_ARCHIVE_SHA256, sourceArchiveSha256, 'Function source digest');
  if (createHash('sha256').update(environment.MIAKAPP_RUNTIME_CONFIG_JSON).digest('hex') !== RUNTIME_CONFIG_SHA256) {
    reject('Function runtime document differs from committed activation evidence');
  }

  exactBinding(runPolicy, 'roles/run.invoker', `serviceAccount:${PROBE_ACCOUNT}`);
  noPublicPrincipal(runPolicy, functionPolicy);
  if (!plainObject(fcmRole)
    || fcmRole.name !== FCM_ROLE
    || fcmRole.stage !== 'GA'
    || fcmRole.deleted === true
    || !isDeepStrictEqual(fcmRole.includedPermissions, ['cloudmessaging.messages.create'])) {
    reject('FCM custom role is not the exact one-permission runtime role');
  }
  account(buildAccount, BUILD_ACCOUNT, 'Build');
  account(probeAccount, PROBE_ACCOUNT, 'Probe');
  userManagedKeys(buildKeys, 'Build');
  userManagedKeys(probeKeys, 'Probe');
  exactBinding(probePolicy, 'roles/iam.serviceAccountOpenIdTokenCreator', (() => {
    const binding = bindings(probePolicy).find((candidate) => candidate.role === 'roles/iam.serviceAccountOpenIdTokenCreator');
    const member = binding?.members?.[0];
    if (typeof member !== 'string' || !member.startsWith('user:')
      || createHash('sha256').update(member.slice(5)).digest('hex') !== operatorUserSha256) {
      reject('Probe token-creator binding does not match the private operator');
    }
    return member;
  })());
  if (!plainObject(sourceBucket)
    || sourceBucket.name !== SOURCE_BUCKET
    || String(sourceBucket.location).toLowerCase() !== REGION
    || sourceBucket.default_storage_class !== 'STANDARD'
    || sourceBucket.uniform_bucket_level_access !== true
    || sourceBucket.public_access_prevention !== 'enforced') {
    reject('Function source bucket violates the reviewed private profile');
  }
  exactBinding(sourcePolicy, 'roles/storage.objectViewer', `serviceAccount:${BUILD_ACCOUNT}`);
  if (!plainObject(repository)
    || repository.name !== REPOSITORY
    || repository.format !== 'DOCKER') {
    reject('Artifact Registry repository violates the reviewed private profile');
  }
  exactBinding(repositoryPolicy, 'roles/artifactregistry.writer', `serviceAccount:${BUILD_ACCOUNT}`);
  exactBindingMembers(projectPolicy, 'roles/logging.logWriter', [
    `serviceAccount:${BUILD_ACCOUNT}`,
    `serviceAccount:${RUNTIME_ACCOUNT}`,
  ]);
  exactBinding(projectPolicy, FCM_ROLE, `serviceAccount:${RUNTIME_ACCOUNT}`);
  noPublicPrincipal(sourcePolicy, repositoryPolicy, projectPolicy);

  return Object.freeze({
    schema: 'miakapp.staging-workload-result/1',
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    region: REGION,
    observed_at: observedAt,
    repository_commit: repositoryCommit,
    source_archive_sha256: sourceArchiveSha256,
    source_generation: String(build.source.storageSource.generation),
    function: Object.freeze({
      name: functionResourceName,
      state: 'ACTIVE',
      generation: 2,
      service: service.service,
      revision: service.revision,
      uri: service.uri,
      ingress: 'ALLOW_INTERNAL_ONLY',
      unauthenticated_invokers: 0,
      minimum_instances: 0,
      maximum_instances: 1,
      concurrency: 16,
      timeout_seconds: 30,
      available_memory: '256M',
      available_cpu: '1',
    }),
    identities: Object.freeze({
      runtime: RUNTIME_ACCOUNT,
      build: BUILD_ACCOUNT,
      probe: PROBE_ACCOUNT,
      user_managed_keys: 0,
      operator_user_sha256: OPERATOR_USER_SHA256,
    }),
    iam: Object.freeze({
      probe_invoker_role: 'roles/run.invoker',
      probe_token_role: 'roles/iam.serviceAccountOpenIdTokenCreator',
      fcm_role: FCM_ROLE,
      fcm_permissions: Object.freeze(['cloudmessaging.messages.create']),
    }),
    artifacts: Object.freeze({
      source_bucket: SOURCE_BUCKET,
      source_object: `sources/${sourceArchiveSha256}.zip`,
      repository: REPOSITORY,
    }),
    runtime_config_sha256: RUNTIME_CONFIG_SHA256,
    live_request_performed: false,
  });
}
