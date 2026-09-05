# Staging signing-key overlap gate

This directory records the converged creation of the second software Ed25519
key version used to rehearse bounded signing-key overlap in
`miakapp-v4-staging`. The exact sanitized result is committed as
[`result.json`](result.json); it contains only the public JWK and immutable
coordination receipts. No credential, raw state or private bundle is committed.
The creation did not change the control-plane runtime, ingress, IAM or
Terraform state.

The Cloud KMS API assigns key-version IDs sequentially and exposes no caller
request ID for version creation. A blind retry could therefore create version
3. The apply driver uses exactly one direct REST `POST` so no CLI or client
library can add an implicit retry. It first creates a durable gate claim and,
after revalidating the complete baseline, creates a second durable attempt claim
immediately before the single allowed KMS invocation. Both objects use the GCS
`ifGenerationMatch=0` precondition and are never deleted by the driver.

The boundary is monotone:

- before the gate claim, no staging mutation has been authorized by a bundle;
- after the gate claim but before the attempt claim, a separately reviewed
  recovery may safely resume after proving the original process is gone;
- after the attempt claim, the KMS creation must never be retried. Recovery may
  only adopt an independently observed exact version 2 or stop on ambiguity.

## Retired one-shot sequence

Version 2 converged after the first and only direct KMS request on
2026-09-05. Both planning and apply entrypoints are now permanently retired and
fail before validating the environment, invoking a tool or reading cloud state.
The commands below are retained only as historical documentation and must not
be run.

From the exact merged `origin/main` commit, create a private read-only plan:

```sh
MIAKAPP_STAGING_SIGNING_KEY_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/signing-overlap/key-plan.sh /absolute/private/parent
```

The planner prints a bundle path and an exact authorization token. The apply
command accepts only that bundle, token, repository commit and live baseline:

```sh
MIAKAPP_STAGING_SIGNING_KEY_APPLY_AUTHORIZATION='create-second-signing-key-version:...' \
  ./infrastructure/staging/signing-overlap/key-apply.sh /absolute/private/bundle
```

Do not retry an apply bundle after it writes its local mutation marker. Do not
delete either global claim. If the process stops after mutation begins, inspect
the private diagnostics and build a fresh, separately reviewed recovery from
the two pinned claims and authoritative KMS inventory.

The committed result contains the public JWK for version 2 and no credential.
A later reviewed workload change prepublished versions 1 and 2 while version 1
remained current on revision `control-plane-00007-deb`. After 51 minutes and
44.897 seconds, a second guarded change selected version 2 on revision
`control-plane-00008-saz` while retaining version 1. Version 1 must remain
published for at least the complete 330-second token lease bound.

One additional active software Cloud KMS version is currently priced at USD
0.06/month; key administration operations are free. No free tier is assumed.
See the official [Cloud KMS pricing](https://cloud.google.com/security/products/security-key-management).
