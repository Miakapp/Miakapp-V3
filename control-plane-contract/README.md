# Miakapp control-plane contract

This directory contains the executable evidence for
[RFC 0004](../docs/rfcs/0004-platform-control-plane.md). It is a public,
synthetic contract; it is not a deployed Firebase control plane.

The shared fixtures cover:

- Home Key format and verifier derivation;
- resource-specific Miakapp access-token profiles;
- the separate Firebase user-token profile;
- issuer, audience, scope, role and coordinator binding;
- clocked signing-key prepublication, overlap and retirement;
- owner bootstrap, signed `auth_time` freshness and uniform Home Key revocation;
- short-lived resource-token use instead of direct Home Key use;
- challenge-proved push destinations, user-consented grants, exact admission
  ceilings, and bounded Home Key and grant-history compaction; and
- complete component upload-capability/publisher binding, delivery-path read-back,
  generation compare-and-set, quarantine and rollback to a prior verified digest.

TypeScript validates the complete fixture and replays the behavioral scenarios.
Behavioral owner operations resolve their actor and authentication time from the
shared, cryptographically verified Firebase vectors. A scenario's
`verified_app_id` represents the trusted result of server-side App Check
verification; it is never a client-supplied production field. Publication
delivery evidence is derived from the exact `artifact_source` bytes, including
digest, size and classic-worker syntax. Publication `binding_id` values are
harness evidence: they commit to the complete stored tuple and are not an
additional production HTTP field.
Go independently verifies the same signed JWT vectors. Neither implementation
imports validation logic from the other.

## Synthetic cryptographic material

`fixtures/v1/access-tokens.json` deliberately contains private test keys so both
languages can reproduce deterministic signatures. They are marked
`test_only_do_not_use` and are valid only for `.test` hosts and a `demo-*`
Firebase project. Loading those keys in a production control plane is forbidden.

No production Home Key, token, host, Firebase UID, push destination or household
data belongs in this directory.

## Run

Requirements: Bun 1.2.23, Node.js 22.22 or newer and Go 1.26.6.

```sh
./control-plane-contract/check.sh
```

Passing this harness closes the shared contract gate. It does not prove Cloud
KMS, IAM, Secret Manager, FCM, Firebase Rules, ingress limits or production
deployment behavior. Those remain requirements of the emulator and staging
vertical slices.
