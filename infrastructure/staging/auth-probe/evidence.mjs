import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const RESULT_SHA256 = '62734e6418e44cef68c60fc686a456643a908098c1fff6f8d52505dbfe9c01ce';
const RETIREMENT_SHA256 = 'b2f3977b83bee7e8427a5a90a04e3c3ab04b28fcb8fcfa26a9c449fef4de42ac';
const MAXIMUM_EVIDENCE_BYTES = 16 * 1024;
const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
const TRACE_CONTEXT = /\b[0-9a-f]{32}(?:\/[0-9a-f]+)?(?:;o=[01])?\b/iu;
const CREDENTIAL = /(?:AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+)/u;
const FORBIDDEN_FIELDS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'diagnostic',
  'errorcontext',
  'executionid',
  'executionname',
  'headers',
  'idtoken',
  'refreshtoken',
  'secret',
  'secretvalue',
  'stack',
  'stacktrace',
  'trace',
  'tracecontext',
  'traceid',
]);

function reject(message) {
  throw new Error(`Staging user-relay evidence ${message}`);
}

function expectedResult() {
  return JSON.parse(String.raw`{
  "schema": "miakapp.staging-user-relay-probe-result/1",
  "project_id": "miakapp-v4-staging",
  "project_number": "1072737219170",
  "region": "europe-west9",
  "observed_at": "2026-09-05T02:00:51.901Z",
  "repository_commit": "3f90549156148496702edfa657d5dd5c6394a32f",
  "workflow": {
    "name": "projects/miakapp-v4-staging/locations/europe-west9/workflows/miakapp-user-relay-probe",
    "revision": "000001-34e",
    "service_account": "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com",
    "source_sha256": "b77c484f3ffb8a81fb4bf5bebfecc420ab33604e99559518fc354a4e0dcc4d56",
    "call_log_level": "LOG_NONE",
    "execution_history_level": "EXECUTION_HISTORY_BASIC",
    "scheduled_triggers": 0
  },
  "verifier": {
    "service_name": "miakapp-user-relay-verifier",
    "service_uri": "https://miakapp-user-relay-verifier-1072737219170.europe-west9.run.app",
    "revision": "miakapp-user-relay-verifier-00001-tqn",
    "identity": "miakapp-staging-verifier@miakapp-v4-staging.iam.gserviceaccount.com",
    "image": "europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp--v4--staging__europe--west9__control--plane@sha256:a650ae228afd9443e1bf0090b5b1e6e9203d08d8de5e24a894701d82a5db4503",
    "source_sha256": "495d3d0526dc948c1bc70344769a4589b3cc3ccce415d221c983c312aa0ef735",
    "ingress": "internal-only",
    "public_invokers": 0,
    "service_level_invoker_bindings": 1,
    "workflow_only": false,
    "inherited_invocation": {
      "permission": "run.routes.invoke",
      "workflow_only": false,
      "project_level_principals": 5,
      "owner_users": 1,
      "default_service_accounts": 2,
      "managed_service_agents": 2,
      "roles": [
        {
          "role": "roles/cloudfunctions.standardServiceAgent",
          "principals": 1
        },
        {
          "role": "roles/editor",
          "principals": 2
        },
        {
          "role": "roles/owner",
          "principals": 1
        },
        {
          "role": "roles/run.serviceAgent",
          "principals": 1
        }
      ]
    },
    "user_managed_keys": 0
  },
  "execution": {
    "state": "SUCCEEDED",
    "workflow_revision": "000001-34e",
    "duration_milliseconds": 10786,
    "count_before": 0,
    "count_after": 1
  },
  "request": {
    "method": "POST",
    "negative_controls": 3,
    "path": "/v1/user-relay-tokens:exchange",
    "product_requests": 5,
    "retries": 0,
    "successful_exchanges": 2
  },
  "responses": {
    "first_exchange": {
      "relay_url": "wss://relay-a.probe.invalid/ws",
      "status": 200
    },
    "invalid_firebase": {
      "code": "invalid_firebase_token",
      "status": 401
    },
    "missing_app_check": {
      "code": "invalid_app_check_token",
      "status": 401
    },
    "missing_home": {
      "code": "home_not_found",
      "status": 404
    },
    "second_exchange": {
      "relay_url": "wss://relay-b.probe.invalid/ws",
      "status": 200
    }
  },
  "firebase_auth": {
    "synthetic_user_absence_verified": true,
    "synthetic_user_created": true,
    "synthetic_user_deleted": true,
    "token_source": "execution-scoped-custom-token",
    "verified_email_present": false,
    "workflow_absence_verified": true,
    "independent_absence_verified": true
  },
  "app_check": {
    "firebase_app_id": "1:1072737219170:web:5053ca93bf25d7373cd73b",
    "replay_accepted": true,
    "token_consumption": false,
    "token_source": "admin-custom-provider",
    "browser_provider_attestation_validated": false
  },
  "firestore": {
    "collection": "controlHomes",
    "owner_matches_authenticated_user": false,
    "public_home_written": false,
    "relay_rotated": true,
    "synthetic_home_absence_verified": true,
    "synthetic_home_created": true,
    "synthetic_home_deleted": true,
    "independent_absence_verified": true
  },
  "metadata": {
    "discovery_valid": true,
    "jwks_valid": true
  },
  "tokens": {
    "algorithm": "EdDSA",
    "audiences_changed": true,
    "client_id_present": false,
    "coordinator_present": false,
    "distinct_jti": true,
    "distinct_tokens": true,
    "key_id": "staging-access-token-v1",
    "role": "user",
    "scope": "relay:user",
    "signatures_valid": true,
    "ttl_seconds": 300,
    "type": "at+jwt",
    "verified_email_present": false
  },
  "workload": {
    "deployment_commit": "022f10e2dc15f32a8a6679b38ce7f1a04582e450",
    "source_sha256": "6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e",
    "function_revision": "control-plane-00004-yis",
    "expected_function_revision": "control-plane-00004-yis",
    "function_uri": "https://control-plane-aczhngqraq-od.a.run.app",
    "ingress": "ALLOW_INTERNAL_ONLY",
    "unauthenticated_invokers": 0,
    "probe_user_managed_keys": 0
  }
}`);
}

function expectedRetirement() {
  return JSON.parse(String.raw`{
  "schema": "miakapp.staging-user-relay-probe-retirement/1",
  "project_id": "miakapp-v4-staging",
  "project_number": "1072737219170",
  "region": "europe-west9",
  "cloud_asset_api": true,
  "custom_roles": {
    "firebase": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayAuthProbe3",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZassbffPE=",
      "permissions": [
        "firebase.clients.get",
        "firebaseappcheck.tokens.mint",
        "firebaseauth.users.get",
        "serviceusage.services.use"
      ]
    },
    "firestore": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayFirestore3",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZassbhSP4=",
      "permissions": [
        "datastore.entities.create",
        "datastore.entities.delete",
        "datastore.entities.get",
        "datastore.entities.update"
      ]
    },
    "signer": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelaySigner3",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZassafNR4=",
      "permissions": [
        "iam.serviceAccounts.getOpenIdToken",
        "iam.serviceAccounts.signJwt"
      ]
    },
    "retired_firebase": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingAuthProbe",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZasbWxrRM=",
      "permissions": [
        "firebase.clients.get",
        "firebaseappcheck.tokens.mint",
        "firebaseauth.users.get",
        "serviceusage.services.use"
      ]
    },
    "retired_firestore": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingProbeFirestore",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZasbW63qM=",
      "permissions": [
        "datastore.entities.create",
        "datastore.entities.delete",
        "datastore.entities.get",
        "datastore.entities.update"
      ]
    },
    "retired_signer": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingProbeSigner",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZasbV9yQ4=",
      "permissions": [
        "iam.serviceAccounts.getOpenIdToken",
        "iam.serviceAccounts.signJwt"
      ]
    },
    "retired_2_firebase": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayAuthProbe2",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZasiHpiuY=",
      "permissions": [
        "firebase.clients.get",
        "firebaseappcheck.tokens.mint",
        "firebaseauth.users.get",
        "serviceusage.services.use"
      ]
    },
    "retired_2_firestore": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayFirestore2",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZasiHrgv0=",
      "permissions": [
        "datastore.entities.create",
        "datastore.entities.delete",
        "datastore.entities.get",
        "datastore.entities.update"
      ]
    },
    "retired_2_signer": {
      "name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelaySigner2",
      "stage": "DISABLED",
      "deleted": false,
      "etag": "BwZasiHAFXE=",
      "permissions": [
        "iam.serviceAccounts.getOpenIdToken",
        "iam.serviceAccounts.signJwt"
      ]
    }
  },
  "custom_role_bindings": {
    "google_project_iam_custom_role.auth_probe_generation_3": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayAuthProbe3",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_firestore_generation_3": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayFirestore3",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_signer_generation_3": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelaySigner3",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_generation_1": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingAuthProbe",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_firestore_generation_1": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingProbeFirestore",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_signer_generation_1": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingProbeSigner",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_generation_2": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayAuthProbe2",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_firestore_generation_2": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayFirestore2",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    },
    "google_project_iam_custom_role.auth_probe_signer_generation_2": {
      "role_name": "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelaySigner2",
      "direct_binding_present": false,
      "indexed_binding_present": false,
      "resource": null,
      "asset_type": null,
      "authoritative": false
    }
  },
  "probe_identity": {
    "email": "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com",
    "disabled": false,
    "user_managed_keys": 0
  },
  "verifier_identity": {
    "email": "miakapp-staging-verifier@miakapp-v4-staging.iam.gserviceaccount.com",
    "disabled": false,
    "user_managed_keys": 0,
    "project_roles": 0,
    "all_resource_roles": 0,
    "resource_policy_inventory": true
  },
  "workflow_present": false,
  "verifier_service_present": false,
  "temporary_bindings_present": false,
  "recurring_compute": false
}`);
}

function rejectPrivateMaterial(value, path = 'evidence') {
  if (typeof value === 'string') {
    if (UUID.test(value) || TRACE_CONTEXT.test(value) || CREDENTIAL.test(value)) {
      reject(`${path} contains a private execution, trace or credential value`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectPrivateMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELDS.has(key.replace(/[_-]/gu, '').toLowerCase())) {
        reject(`${path}.${key} is a private telemetry or credential field`);
      }
      rejectPrivateMaterial(entry, `${path}.${key}`);
    }
  }
}

function readExactJson(path, expectedDigest) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > MAXIMUM_EVIDENCE_BYTES) {
    reject('must be a bounded regular file');
  }
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) {
    reject('digest does not match the live result');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return reject('is not valid JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes.toString('utf8')) {
    reject('is not in exact canonical JSON form');
  }
  return value;
}

export function validateAuthProbeEvidenceValues(result, retirement) {
  rejectPrivateMaterial(result, 'result');
  rejectPrivateMaterial(retirement, 'retirement');
  if (!isDeepStrictEqual(result, expectedResult())) reject('result fields have drifted');
  if (!isDeepStrictEqual(retirement, expectedRetirement())) reject('retirement fields have drifted');
  if (result.project_id !== retirement.project_id
    || result.project_number !== retirement.project_number
    || result.region !== retirement.region) {
    reject('result and retirement target different environments');
  }
  return Object.freeze({ result, retirement });
}

export function validateAuthProbeEvidence(resultPath, retirementPath) {
  return validateAuthProbeEvidenceValues(
    readExactJson(resultPath, RESULT_SHA256),
    readExactJson(retirementPath, RETIREMENT_SHA256),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    console.error('Usage: node evidence.mjs <result.json> <retirement.json>');
    process.exitCode = 2;
  } else {
    try {
      const { result } = validateAuthProbeEvidence(process.argv[2], process.argv[3]);
      console.log([
        `Validated ${result.schema} for ${result.project_id}.`,
        'One bounded execution proved audience-bound user-relay exchange and token verification; both synthetic fixtures and every temporary capability were removed.',
      ].join(' '));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Staging user-relay evidence is invalid');
      process.exitCode = 1;
    }
  }
}
