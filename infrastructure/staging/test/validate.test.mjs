import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  StagingManifestError,
  validateFirebaseRc,
  validateStagingManifest,
} from '../validate.mjs';

const manifestFixture = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const firebaseRcFixture = JSON.parse(readFileSync(new URL('../../../.firebaserc', import.meta.url), 'utf8'));

function manifest() {
  return structuredClone(manifestFixture);
}

function firebaseRc() {
  return structuredClone(firebaseRcFixture);
}

function rejects(mutator, pattern) {
  const candidate = manifest();
  mutator(candidate);
  assert.throws(
    () => validateStagingManifest(candidate),
    (error) => error instanceof StagingManifestError && pattern.test(error.message),
  );
}

test('accepts the committed planning-only staging intent and legacy Firebase default', () => {
  const validated = validateStagingManifest(manifest());
  assert.equal(validated.project.project_id, 'miakapp-v4-staging');
  assert.equal(
    validated.evidence.production_security_boundary,
    '../../control-plane/test/unit/cloud-security.test.ts',
  );
  assert.equal(validateFirebaseRc(firebaseRc()).projects.default, 'miakapp-3');
});

test('rejects unknown fields including embedded secret material', () => {
  rejects((candidate) => {
    candidate.security.secrets[0].value = 'must-never-enter-the-manifest';
  }, /security\.secrets\[0\] must contain exactly/);
  rejects((candidate) => {
    candidate.unreviewed = true;
  }, /manifest must contain exactly/);
});

test('rejects legacy, production, and demo project targets', () => {
  for (const target of ['miakapp-3', 'miakapp-v4', 'demo-miakapp-v4', 'demo-unreviewed']) {
    rejects((candidate) => {
      candidate.project.project_id = target;
    }, /project\.project_id/);
  }
});

test('rejects every cloud-action authorization bit', () => {
  for (const field of [
    'creation_authorized',
    'billing_link_authorized',
    'deployment_authorized',
    'public_ingress_authorized',
  ]) {
    rejects((candidate) => {
      candidate.project[field] = true;
    }, new RegExp(`project\\.${field}`));
  }
  rejects((candidate) => {
    candidate.readiness.cloud_actions_enabled = true;
  }, /readiness\.cloud_actions_enabled/);
});

test('requires explicit targeting and forbids a staging Firebase alias', () => {
  rejects((candidate) => {
    candidate.project.explicit_project_required = false;
  }, /project\.explicit_project_required/);
  rejects((candidate) => {
    candidate.project.firebase_alias_allowed = true;
  }, /project\.firebase_alias_allowed/);

  const aliased = firebaseRc();
  aliased.projects.staging = 'miakapp-v4-staging';
  assert.throws(() => validateFirebaseRc(aliased), StagingManifestError);
});

test('keeps the root Firebase default on untouched legacy production', () => {
  const candidate = firebaseRc();
  candidate.projects.default = 'miakapp-v4-staging';
  assert.throws(
    () => validateFirebaseRc(candidate),
    /\.firebaserc\.projects\.default must equal "miakapp-3"/,
  );
});

test('rejects location drift before the immutable regional choice is reviewed', () => {
  for (const field of ['primary', 'functions', 'firestore', 'storage', 'kms']) {
    rejects((candidate) => {
      candidate.locations[field] = 'eur3';
    }, new RegExp(`locations\\.${field}`));
  }
  rejects((candidate) => {
    candidate.locations.immutable_choice_reviewed = true;
  }, /locations\.immutable_choice_reviewed/);
});

test('enforces scale-to-zero, one maximum instance, and private ingress', () => {
  rejects((candidate) => {
    candidate.runtime.minimum_instances = 1;
  }, /runtime\.minimum_instances/);
  rejects((candidate) => {
    candidate.runtime.maximum_instances = 2;
  }, /runtime\.maximum_instances/);
  rejects((candidate) => {
    candidate.runtime.allow_unauthenticated = true;
  }, /runtime\.allow_unauthenticated/);
  rejects((candidate) => {
    candidate.runtime.ingress = 'all';
  }, /runtime\.ingress/);
});

test('rejects public, default-bucket, retained, or cross-origin Storage drift', () => {
  rejects((candidate) => {
    candidate.data.storage.firebase_default_bucket = true;
  }, /data\.storage\.firebase_default_bucket/);
  rejects((candidate) => {
    candidate.data.storage.public_read = true;
  }, /data\.storage\.public_read/);
  rejects((candidate) => {
    candidate.data.storage.cors_origins = ['https://app.miakapp.com'];
  }, /data\.storage\.cors_origins/);
  rejects((candidate) => {
    candidate.data.storage.soft_delete_days = 7;
  }, /data\.storage\.soft_delete_days/);
  rejects((candidate) => {
    candidate.data.storage.retention_policy_locked = true;
  }, /data\.storage\.retention_policy_locked/);
});

test('keeps KMS manual, software-backed, and explicitly non-deletable', () => {
  rejects((candidate) => {
    candidate.security.kms.automatic_rotation = true;
  }, /security\.kms\.automatic_rotation/);
  rejects((candidate) => {
    candidate.security.kms.protection_level = 'HSM';
  }, /security\.kms\.protection_level/);
  rejects((candidate) => {
    candidate.security.kms.key_ring_deletion_supported = true;
  }, /security\.kms\.key_ring_deletion_supported/);
});

test('rejects broad IAM substitution and premature resolution of FCM access', () => {
  rejects((candidate) => {
    candidate.security.iam.resource_bindings[0].access = 'roles/owner';
  }, /security\.iam\.resource_bindings\[0\]\.access/);
  rejects((candidate) => {
    candidate.security.iam.broad_project_roles_forbidden = false;
  }, /security\.iam\.broad_project_roles_forbidden/);
  rejects((candidate) => {
    candidate.security.iam.unresolved_permissions = [];
  }, /security\.iam\.unresolved_permissions/);
});

test('rejects fixed-cost services and budget safety drift', () => {
  for (const field of Object.keys(manifestFixture.cost.fixed_cost_services)) {
    rejects((candidate) => {
      candidate.cost.fixed_cost_services[field] = true;
    }, new RegExp(`cost\\.fixed_cost_services\\.${field}`));
  }
  rejects((candidate) => {
    candidate.cost.billing_account = 'billingAccounts/secret';
  }, /cost\.billing_account/);
  rejects((candidate) => {
    candidate.cost.free_tier_assumed = true;
  }, /cost\.free_tier_assumed/);
});

test('requires every production blocker and staging evidence row', () => {
  rejects((candidate) => {
    candidate.readiness.required_blockers.pop();
  }, /readiness\.required_blockers/);
  rejects((candidate) => {
    candidate.evidence.staging_rows.shift();
  }, /evidence\.staging_rows/);
});

test('forbids CI credentials and automated teardown', () => {
  rejects((candidate) => {
    candidate.evidence.cloud_credentials_required = true;
  }, /evidence\.cloud_credentials_required/);
  rejects((candidate) => {
    candidate.evidence.ci_may_authenticate = true;
  }, /evidence\.ci_may_authenticate/);
  rejects((candidate) => {
    candidate.teardown.automated = true;
  }, /teardown\.automated/);
  rejects((candidate) => {
    candidate.teardown.manual_project_id_confirmation = false;
  }, /teardown\.manual_project_id_confirmation/);
});
