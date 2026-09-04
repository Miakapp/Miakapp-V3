# Audience-bound browser relay credential rollout

Date: 2026-09-04

Status: contract and local control-plane implementation; dependent runtime and
staging evidence pending

## Purpose and safety boundary

This runbook rolls out RFC 0004's five-minute `relay:user` credential from the
control plane through MiakAPI to Miakapp-Server. It is deliberately staged so no
relay receives a Firebase ID token or App Check token and no browser can pair a
signed token with a caller-selected relay URL.

Issuance proves only that Firebase Auth and App Check verified the request and
that the requested Home exists. It does **not** enroll the user, prove Home
ownership or create platform membership. The coordinator remains authoritative
for enrollment and permissions.

Use only synthetic Homes and identities until the complete staging gate passes.
Do not record request headers, response bodies, browser traces, HAR files or
WebSocket frames: each can retain a bearer credential. This procedure does not
open public ingress, change Miakapp 3, create production resources or claim
end-to-end encryption.

## Dependency and merge order

Land and deploy in this order:

1. Miakapp V3 shared TypeScript/Go contract, fixture vectors, control-plane
   exchange and RFC amendments;
2. MiakAPI credential provider and dynamic relay handoff;
3. Miakapp-Server local `relay:user` verification through the control-plane
   JWKS cache;
4. Miakapp V3 reciprocal CI pins, staging package and sanitized evidence; and
5. the merged staging revisions, never an unmerged working tree.

The contract change lands first so both dependent repositories can pin one
immutable version. Do not enable the browser path while a relay still expects a
Firebase role-1 token, or enable the new relay verifier while the browser can
still send Firebase source tokens to WebSocket.

## Local validation

From clean checkouts with the pinned toolchains, run:

```sh
cd /absolute/path/to/Miakapp-V3
./control-plane-contract/check.sh
./control-plane/check.sh
npm run test:staging-manifest
```

Then run each dependent repository's complete gate:

```sh
cd /absolute/path/to/MiakAPI
bun install --frozen-lockfile
bun run check

cd /absolute/path/to/Miakapp-Server
go vet ./...
go test -race ./...
./scripts/check-control-plane-integration.sh /absolute/path/to/Miakapp-V3
./scripts/check-platform-integration.sh /absolute/path/to/Miakapp-V3 /absolute/path/to/MiakAPI
```

Finally build the exact MiakAPI browser fixture and run the relay-owned
cross-repository integration as documented in
[`../operations/2026-09-04-browser-relay-integration.md`](../operations/2026-09-04-browser-relay-integration.md).
The replacement evidence must additionally prove:

- Firebase-shaped and App Check source tokens reach only the HTTPS fixture;
- only a valid `relay:user` Miakapp token enters `HELLO` and `REAUTH`;
- token audience, returned relay URL and actual socket endpoint are identical;
- Home, UID, role and optional verified email come only from verified claims;
- a relay routing change opens one replacement socket without sending the new
  token to the old relay or performing a duplicate exchange; and
- no source or relay token appears in the semantic evidence artifact.

The Firebase Emulator Suite has no App Check emulator. Its signed synthetic App
Check seam proves request binding and failure behavior, not live attestation.

## Staging plan and cost review

Before a staging mutation, build the deterministic production package from the
merged Miakapp V3 commit and create a fresh guarded workload update plan. Inspect
the rendered plan and require all of the following:

- one deterministic source-object replacement and one in-place Function update;
- no new service, database, secret, KMS key, identity, public invoker, network
  edge, minimum instance or scaling increase;
- `minInstances=0`, `maxInstances=1`, internal-only ingress and the existing
  runtime service account;
- the same five secret versions, signing key and non-secret runtime document;
  and
- zero deletes or replacements of identity-bearing resources.

The expected infrastructure delta is zero. Runtime usage adds, per successful
credential exchange, Firebase Auth/App Check verification, one admission/audit
transaction, one private Home read and one KMS signature. At a five-minute lease
this is at most twelve successful renewals per continuously active browser hour,
before reconnects, and remains guarded by 32 exchanges/UID/minute and 128/source/
minute plus global ceilings. Do not run a stress test. Compare the plan and
measured staging operations against the authorized monthly cost envelope before
apply.

Use only the current digest-bound wrappers under
[`../../infrastructure/staging/workload/`](../../infrastructure/staging/workload/).
Historical authorization strings and private plan directories are consumed
evidence, not replay instructions. Generate the exact authorization from the
fresh reviewed plan, apply once, then require a zero-change plan and independent
source/revision inventory.

## Staging acceptance

Keep the control plane private while testing the HTTP exchange through a bounded,
unscheduled internal probe. Use one synthetic Firebase user, one real staging
App Check token and one synthetic Home. Delete the user and retire temporary
probe capability after the run. The closed matrix is:

1. no App Check token: `401 invalid_app_check_token`, no Home read or signing;
2. invalid Firebase token: `401 invalid_firebase_token`, no Home read or signing;
3. missing Home: `404 home_not_found`, no token;
4. existing Home and unenrolled user: `200` with one private credential;
5. independently verify exact issuer, audience, Home, UID, `relay:user`, role,
   expiry and forbidden-claim absence from the published JWKS;
6. rotate the synthetic Home's selected relay and prove the next credential
   changes both audience and returned URL while the prior token remains bounded
   to its old audience; and
7. exercise one initial browser session, same-relay reauthentication and
   relay-change handoff through the merged MiakAPI and Miakapp-Server revisions.

Each live case runs once unless its contract explicitly requires a second lease.
Record only closed semantic outcomes, revision IDs, counts, durations and public
key identifiers. Never persist a token, email, raw UID, request/response body,
execution identifier, trace context or Home traffic.

## Monitoring

During the bounded acceptance window, inspect only allow-listed metrics:

- exchange requests by stable outcome class;
- `429` counts for source and UID budgets;
- KMS signing count and latency;
- Function instance count, execution time and error class;
- relay JWKS refresh count, cache outcome and authentication result; and
- browser credential requests, routing handoffs, reconnects and successful
  reauthentication as counters without endpoint or identity values.

Stop the rollout if signing or invocation volume exceeds the test matrix, a
source token reaches a relay, a credential appears in diagnostics, a relay
accepts the wrong audience/Home/profile, or projected incremental cost exceeds
the approved boundary.

## Rollback

Retain the previously active control-plane Function revision, relay deployment
and browser artifact until the acceptance window closes. Rollback is ordered:

1. stop serving the new browser artifact so no new audience-bound session begins;
2. drain or close new browser sessions without replaying calls;
3. route the relay deployment back to the last known-good revision;
4. route the private control-plane service back to its retained known-good
   revision using a fresh guarded in-place plan; and
5. verify zero unexpected traffic and a zero-change infrastructure plan.

Do not delete the signing key or remove its JWK during ordinary rollback. Publish
a new key for at least 60 seconds before first use, and retain an old public JWK
for at least 330 seconds after its last issued five-minute token. Emergency key
compromise follows RFC 0004's separate six-minute residual-authority bound.

Rollback never writes Miakapp 3, imports user data, converts enrollment or
silently falls back to sending Firebase tokens over WebSocket. If the three
runtime layers cannot remain profile-compatible, disable the browser path until
they can.
