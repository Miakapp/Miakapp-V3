# Audience-bound browser relay credential rollout

Date: 2026-09-04

Status: local audience-bound control-plane, SDK and relay evidence complete;
private staging exchange accepted, live browser-relay plan rebased but not deployed

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
change Miakapp 3, create production resources or claim end-to-end encryption.
The completed private probe and the reviewed plan opened no ingress; the future
live phase includes only the plan's separately guarded temporary window.

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

The local implementation dependency chain is now immutable:

- Miakapp V3 contract and control plane:
  [`cc3bcd7`](https://github.com/Miakapp/Miakapp-V3/commit/cc3bcd70fdb4b058f990ca2607693a2043faebaf);
- Miakapp V3 two-relay fixture prerequisite:
  [`f9509c4`](https://github.com/Miakapp/Miakapp-V3/commit/f9509c41ef1c0389623d31419372e6430a2313d9);
- MiakAPI credential acquisition and serialized relay replacement:
  [`a798a74`](https://github.com/Miakapp/MiakAPI/commit/a798a746847ba3d5c16128a08b33353269e770a4);
- Miakapp-Server audience-bound verifier and full platform fixture:
  [`9a7e33d`](https://github.com/Miakapp/Miakapp-Server/commit/9a7e33de3a684b6cd9e82231db7c9af8bf41a0a1).

The reciprocal V3 workflow checks out the last two commits exactly and verifies
that the relay pins the `cc3bcd7` Go contract pseudo-version. Changing any pin is
a new evidence event and requires this complete gate again.

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
./scripts/check-miakapi-integration.sh /absolute/path/to/MiakAPI
```

The first relay-owned browser gate above is the complete audience-bound path;
the second is a deliberately narrower transport regression documented in
[`../operations/2026-09-04-browser-relay-integration.md`](../operations/2026-09-04-browser-relay-integration.md).
The complete evidence must prove:

- Firebase-shaped and App Check source tokens reach only the HTTPS fixture;
- only a valid `relay:user` Miakapp token enters `HELLO` and `REAUTH`;
- token audience, returned relay URL and actual socket endpoint are identical;
- Home, UID, role and optional verified email come only from verified claims;
- a relay routing change opens one replacement socket without sending the new
  token to the old relay or performing a duplicate exchange; and
- no source or relay token appears in the semantic evidence artifact.

The pinned complete gate creates one Auth-emulator user, a signed synthetic App
Check token, one Home and two real relay instances. It performs `initial` and
same-relay `reauth`, changes the authoritative Home route, then performs a
single-credential handoff to the second relay. Chromium observes state `21`
before and `24` after the handoff, completes three calls, opens two WebSockets in
sequence, and never has more than one active WebSocket. Both relays verify one
coordinator and one user identity, the source-credential presence flag remains
false, and exactly three user-exchange posts cover `initial`, `reauth` and the
route-changing `reauth`. The gate also retains the prior signing-key rotation,
32-way JWKS refresh coalescing, outage and bounded-recovery evidence.

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

The expected infrastructure delta for the control-plane source update is zero.
Runtime usage adds, per successful credential exchange, Firebase Auth/App Check
verification, one admission/audit transaction, one private Home read and one KMS
signature. With the default five-minute lease and renewal 30 seconds before
expiry, steady state is 13⅓ renewals per continuously active browser hour;
budget conservatively for at most 14 renewals in any rolling hour, plus the
initial exchange when a session starts and any bounded reconnects. Admission
remains guarded by 32 exchanges/UID/minute and 128/source/minute plus global
ceilings. Do not run a stress test. Compare the plan and measured staging
operations against the authorized monthly cost envelope before apply.

Use only the current digest-bound wrappers under
[`../../infrastructure/staging/workload/`](../../infrastructure/staging/workload/).
Historical authorization strings and private plan directories are consumed
evidence, not replay instructions. Generate the exact authorization from the
fresh reviewed plan, apply once, then require a zero-change plan and independent
source/revision inventory.

The audience-bound source-only phase completed at merge commit
`022f10e2dc15f32a8a6679b38ce7f1a04582e450`: deterministic source SHA-256
`6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e`
was deployed on revision `control-plane-00004-yis`. The exact plan changed only
the source object, Function and deployment guard, then converged to zero changes.
Independent inventory made no Function request and retained internal-only
ingress, scale 0..1, zero public invokers and zero user-managed keys. This is
deployment evidence, not acceptance evidence for the exchange route.

The subsequent bounded-overlap bridge is now merged and deployed privately at
commit `9f217da102b394734adba7ccef3f8f70d0317306`, source SHA-256
`d1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8`
and historical revision `control-plane-00005-biq`. It added closed schema-2
parsing and validation while preserving the then-active schema-1 runtime. A
separate exact two-update plan subsequently migrated that single-key document
to schema 2 on revision `control-plane-00006-wid`, without replacing source,
changing IAM/ingress/scale or making a Function request. A later exact plan
prepublished versions 1 and 2 with version 1 current as revision
`control-plane-00007-deb`, again without a source, IAM, ingress or scale change
or a Function request. A later exact plan selected version 2 while retaining
version 1 and converged to historical revision `control-plane-00008-saz`, again
without changing source, build, IAM, internal-only ingress or scale and without
making a Function request. The guarded browser-relay rehearsal entry then
reselected version 1 on historical revision `control-plane-00009-kur` while both
keys remained published, preserving the same boundary and making no Function
request. Retiring version 1 remains a separate gate after the complete lease
bound.

The later source-only deployment produced current private revision
`control-plane-00010-vop`. It adds a staging-only edge profile whose exact
direct `run.app` issuer and Hosting `web.app` origin must be selected together;
the canonical pair remains active, ingress remains internal-only and no live
request was made.

The bounded acceptance implementation, with zero persistent delta to the
control-plane workload, IAM and topology, lives under
[`../../infrastructure/staging/auth-probe/`](../../infrastructure/staging/auth-probe/).
It used an unscheduled Workflow for internal transport and a separate
internal-only scale-to-zero verifier to validate both Ed25519 credentials
without publishing token material. Two attempted generations retired without
invocation after compile failures. Generation 3 then ran exactly once, passed
three negative controls and two signed exchanges across a relay rotation, and
retired successfully. The fixed private Home and no-email Firebase user are
deleted and independently absent. The Workflow, verifier and four temporary
least-privilege IAM bindings are absent. The root intentionally retains the
enabled Cloud Asset API, nine disabled and unassigned custom roles across three
one-shot generations, and one keyless no-role verifier identity. During the
run, project inheritance meant the verifier was not Workflow-only; inventory
pinned the acknowledged five-principal inherited set and rejected additional
service-level bindings.

Recovery is split when its inventory precondition is unavailable: Cloud Asset is
enabled and imported by an API-only authorization, then the operator must render
a fresh complete recovery. A soft-deleted probe role is not restored
automatically. Cloud Asset IAM-policy results are eventually consistent and
cannot authorize a safe undelete, so this exceptional case fails closed for
manual investigation.

The current staging inventory contains neither a browser runner nor two relay
endpoints. The separate, digest-pinned
[`browser-relay/plan.json`](../../infrastructure/staging/browser-relay/plan.json)
now rebases the private `control-plane-00010-vop`, two-key/version-1-entry and completed browser
App Check state and reviews the required topology, cost and rollback shape:

- two canonical TLS relay endpoints running the pinned merged Miakapp-Server;
- one bounded, unscheduled runner using the pinned browser artifact;
- a maximum twenty-minute public-network window because the browser WebSocket
  API cannot authenticate a Cloud Run IAM handshake, with exact Origin and
  application-layer authentication on every credential-bearing path;
- zero minimum instances or otherwise ephemeral execution, hard scaling and
invocation ceilings, and an estimated incremental cost below the authorized
monthly envelope; and
- deterministic teardown plus retained revision and semantic evidence.

The selected staging profile uses the existing Hosting `web.app` origin and
temporary direct `run.app` endpoints. It adds no App Engine application,
external load balancer, Cloud Armor policy, VPC connector, Cloud NAT or custom
DNS dependency. Both relays remain scale 0..1 under a keyless identity with no
runtime role; the local runner is unscheduled and may launch three times. One
acceptance execution is allowed, with a EUR 1 projected stop threshold that does
not assume a free tier.

The rotation rehearsal reuses KMS versions 1 and 2. Its separate guarded
configuration-only entry transition has selected version 1 while both public
keys remain published; the live socket then observes activation of version 2. No
third version is created. Version 1 remains published for the complete
330-second post-issuance bound before it is removed and disabled, never
destroyed.

This is design evidence only. All twelve `LIVE-*` rows remain pending and the
plan contains no deployment or invocation entrypoint. Runtime multi-key
publication, Web App Check provider registration and the rotation entry are
satisfied; the reversible edge and relay roots, runner, metric checks and a
preflighted rollback remain explicit open preconditions. Any relay or runner is
a non-zero infrastructure delta and MUST
NOT be hidden in the control-plane Function update plan.

## Staging acceptance

The control-plane phase completed through one bounded, unscheduled internal
probe while ingress remained private. It used one synthetic Firebase user, one
genuine staging Admin custom-provider App Check token and one synthetic Home,
then deleted both fixtures and retired all temporary probe capability. The
successful result covers:

1. no App Check token: `401 invalid_app_check_token`, no Home read or signing;
2. invalid Firebase token: `401 invalid_firebase_token`, no Home read or signing;
3. missing Home: `404 home_not_found`, no token;
4. existing Home and unenrolled user: `200` with one private credential;
5. independently verify exact issuer, audience, Home, UID, `relay:user`, role,
   expiry and forbidden-claim absence from the published JWKS;
6. rotate the synthetic Home's selected relay and prove the next credential
   changes both audience and returned URL while the prior token remains bounded
   to its old audience.

Only after every precondition in the reviewed relay/runner plan passes its cost,
identity and rollback checks, complete the staging browser phase:

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
