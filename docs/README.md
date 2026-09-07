# Miakapp 4 documentation

Miakapp 4 is an ecosystem-wide rebuild. This repository is the canonical
home for the shared architecture and delivery roadmap even though the work is
implemented across several repositories.

## Documents

- [`specs/2026-08-29-miakapp-v4-design.md`](specs/2026-08-29-miakapp-v4-design.md)
  — approved product and architecture direction. The operational migration
  procedure retains an explicit gate before cutover.
- [`rfcs/0001-wire-protocol.md`](rfcs/0001-wire-protocol.md) — accepted protocol
  1.0 byte contract, state and call semantics, limits and compatibility rules.
- [`rfcs/0002-component-runtime.md`](rfcs/0002-component-runtime.md) — accepted
  browser boundary, immutable artifact, capability bridge, semantic UI ABI, and
  release lifecycle.
- [`rfcs/0003-coordinator-sdk-and-migration.md`](rfcs/0003-coordinator-sdk-and-migration.md)
  — accepted public coordinator API, retry and lifecycle semantics, temporary
  Node-RED boundary, fail-closed shadow modes, and comparison contract.
- [`rfcs/0004-platform-control-plane.md`](rfcs/0004-platform-control-plane.md)
  — accepted owner bootstrap, Home Key, resource-specific token, JWKS, Firebase
  source identity, audience-bound browser exchange, push-consent and
  component-publication contract.
- [`rfcs/0005-browser-client-sdk.md`](rfcs/0005-browser-client-sdk.md) — accepted
  trusted-host browser lifecycle, immutable state, calls, reauthentication and
  cleanup contract; its audience-bound SDK/relay path now has pinned local
  two-relay evidence and a bounded control-plane staging probe while live relay
  and host integration remain gated.
- [`roadmaps/2026-08-29-miakapp-v4-coordination.md`](roadmaps/2026-08-29-miakapp-v4-coordination.md)
  — cross-repository sequence, ownership, acceptance gates, and deferred work.
- [`operations/2026-09-01-miakapp-v4-environments.md`](operations/2026-09-01-miakapp-v4-environments.md)
  — accepted local/staging/production isolation, cost posture, migration boundary,
  the historical staging-activation decision, and current gates before broader
  staging or any production use.
- [`operations/2026-09-04-browser-relay-integration.md`](operations/2026-09-04-browser-relay-integration.md)
  — pinned, synthetic real-Chromium reproduction and privacy-safe evidence
  procedure for the public browser client and Go relay.
- [`runbooks/user-relay-credentials.md`](runbooks/user-relay-credentials.md)
  — dependency order, privacy-safe validation, staging cost gate, monitoring and
  rollback for audience-bound browser relay credentials.
- [`../infrastructure/staging/browser-relay/`](../infrastructure/staging/browser-relay/)
  — digest-pinned closed plan for the live browser, two-relay, signing-key and
  rollback matrix; rebased against the current private two-key/App Check and
  private-ready two-relay state but not deployed, with every live case pending.
- [`../infrastructure/staging/browser-relay-runner/`](../infrastructure/staging/browser-relay-runner/)
  — dormant operator-local Chromium, Firefox and WebKit driver with ephemeral
  contexts, in-memory private input and a strictly closed counter-only result;
  its real three-engine offline CI smoke is implementation evidence only.
- [`../infrastructure/staging/browser-relay-page/`](../infrastructure/staging/browser-relay-page/)
  — dormant memory-only Firebase Auth, real App Check and digest-pinned MiakAPI
  revision-3 page host with serialized native lifecycle, typed call outcomes and
  a 600-second Chromium budget; its two-file artifact is loaded in all three
  engines by an offline CI gate. Native non-persisted terminal fencing and
  separately explicit cleanup before replacement are proven using offline
  fakes, not native async Firebase cleanup; native persisted BFCache remains
  blocked by pinned Playwright, and live runner wiring remains absent.
- [`../infrastructure/staging/browser-relay-fixture/`](../infrastructure/staging/browser-relay-fixture/)
  — dormant single-fixture lifecycle controller with absence-gated creation and
  deletion, an exact synthetic MiakAPI coordinator, one fresh in-memory custom
  token per browser, guarded relay rotation and verified coordinator-first
  cleanup; live execution remains separate.
- [`../infrastructure/staging/browser-relay-fixture-cloud/`](../infrastructure/staging/browser-relay-fixture-cloud/)
  — dormant injected Google/Firebase adapter for that controller, with bounded
  IAM custom-token signing, exact control-plane writes, preconditioned atomic
  Firestore cleanup and administrative deletion of only the fixed synthetic
  UID; it has no CLI, ambient credentials or live authority.
- [`../infrastructure/staging/browser-relay-fixture-miakapi/`](../infrastructure/staging/browser-relay-fixture-miakapi/)
  — dormant reproducible Node binding to the exact MiakAPI commit; its
  single-use factories force the Home Key exchange through the injected HTTP
  transport and construct the synthetic coordinator without starting it.
- [`../infrastructure/staging/browser-relay-aggregator/`](../infrastructure/staging/browser-relay-aggregator/)
  — dormant single-use evidence aggregator assigning every runner assertion,
  counter and public identifier to one exact browser or independent cloud
  source; invalid, missing, duplicated or out-of-order receipts fail closed.
- [`../infrastructure/staging/browser-relay-independent-observers/`](../infrastructure/staging/browser-relay-independent-observers/)
  — dormant closed producers for all 15 non-page receipts; exact source facts,
  common-clock browser windows and revision/signing lineage combine offline
  with the page receipts into one closed runner result, while authenticated
  live acquisition remains absent.
- [`../infrastructure/staging/browser-relay-evidence-session/`](../infrastructure/staging/browser-relay-evidence-session/)
  — dormant operation-local capability that owns one monotonic epoch and issues
  browser/source-attenuated ports. Callers provide projections only; the session
  derives fact ownership, order and time, revokes on every terminal path and
  closes one interleaved runner result. Durable-claim binding, scheduling and
  live adapters remain absent.
- [`../infrastructure/staging/browser-relay-playwright-bridge/`](../infrastructure/staging/browser-relay-playwright-bridge/)
  — dormant fail-closed Playwright page-to-receipt bridge with lazy private
  input acquisition and owned page cleanup; real Firefox and WebKit engines
  close exact page receipts offline, while Chromium remains blocked before
  page or private-input acquisition by pinned Playwright's BFCache limitation.
- [`../infrastructure/staging/browser-relay-page-receipt/`](../infrastructure/staging/browser-relay-page-receipt/)
  — dormant browser-owned receipt producer that reduces exact cumulative page,
  state, call and native lifecycle facts without accepting assertion booleans;
  revision 2 is digest-bound to the adjacent bridge and combines with every
  independent source offline, while the complete live Chromium scenario remains open.
- [`../infrastructure/staging/browser-relay-scenario-fixture/`](../infrastructure/staging/browser-relay-scenario-fixture/)
  — dormant composition around the immutable fixture that supplies four exact
  page inputs across two genuine synthetic Firebase identities, extends the one
  coordinator's state access, and requires coordinator-first cleanup of both
  identity domains; original fixture capacity limits remain explicit and its
  replacement transport is supplied by the separate adapter.
- [`../infrastructure/staging/browser-relay-scenario-fixture-cloud/`](../infrastructure/staging/browser-relay-scenario-fixture-cloud/)
  — dormant replacement-identity Google/Firebase adapter with injected transport,
  bounded keyless signing, token-bound identity verification and independently
  observed cleanup; it closes the implementation gap without live wiring.
- [`../infrastructure/staging/browser-relay-monitoring/`](../infrastructure/staging/browser-relay-monitoring/)
  — allow-listed read-only monitoring contract whose post-merge preflight pins
  six metric surfaces, the existing EUR 10 budget and the private boundary.
- [`../infrastructure/staging/browser-relay-rollback/`](../infrastructure/staging/browser-relay-rollback/)
  — dormant six-step rollback and closed-target preflight contract whose
  post-merge read-only evidence verifies the private converged target.
- [`../infrastructure/staging/browser-relay-orchestrator/`](../infrastructure/staging/browser-relay-orchestrator/)
  — dormant single-use composition boundary with a retained generation-zero
  claim, post-claim baseline check, bounded edge window and mandatory private
  postflight; preflighted but not executed live.
- [`../infrastructure/staging/browser-relay-operation/`](../infrastructure/staging/browser-relay-operation/)
  — dormant full-operation envelope fixing the public-last relay transition and
  two-level cleanup order around the edge orchestrator; its post-merge
  read-only preflight succeeded, but no live adapter or execution authority is
  present.
- [`../infrastructure/staging/browser-relay-services/`](../infrastructure/staging/browser-relay-services/)
  — applied four-phase Terraform model holding two private-ready, scale-to-zero
  relays with immutable image selection, finite process admission and public-last
  IAM; all consumed operator entrypoints are retired.
- [`../infrastructure/staging/`](../infrastructure/staging/)
  — closed staging intent, digest-pinned live evidence, credential-free policy
  validator and teardown rehearsal. Cloud mutation remains behind separate
  explicit gates; reading the documents grants no deployment authority.

RFC 0001 is backed by independent Go and TypeScript implementations and shared
binary fixtures under [`../protocol/`](../protocol/). RFC 0002's architecture
selection is backed by a deliberately bounded, three-engine hostile browser
corpus under [`../component-runtime/`](../component-runtime/); complete
production conformance remains an exit gate for the component-platform vertical
slice. RFC 0003 is backed by the API-level corpus, bounded replay runner,
synthetic-home adapter and effect recorder under [`../coordinator-contract/`](../coordinator-contract/);
the real MiakAPI implementation now passes that contract while the Node-RED
runtime adapter remains open. RFC 0004 is backed by deterministic signed
vectors, independent TypeScript and Go verifiers, and a bounded behavioral model
under [`../control-plane-contract/`](../control-plane-contract/). Its first
owner-to-access-token implementation slice runs through Auth, Functions and
Firestore under [`../control-plane/`](../control-plane/). The same isolated
package now contains synthetic push and local component-publication vertical
slices; the latter drives private staging, server read-back, marker-gated public
delivery and pointer CAS through the Functions, Storage and Firestore emulators.
Structural adapter tests separately prove create-only generation-precondition
wiring because the Storage Emulator does not enforce that production
precondition. Separate client contexts prove the public-pointer and private
Storage/private-record Rules boundaries. Bounded admission and the deterministic
application/dependency fault matrix are now local gates under
[`../control-plane/FAULT-MATRIX.md`](../control-plane/FAULT-MATRIX.md). Live
network and managed-service rows remain implementation gates. A pinned local
cross-repository path now proves real Home Key exchange, SDK `HELLO` and
scheduled key-changing `REAUTH`, and relay production verification without
reconnecting. Its deterministic cache probe covers 32-way refresh coalescing,
unknown-`kid` abuse bounds, conditional expiry, fail-closed JWKS outage and
bounded recovery. It covers signing-key overlap and activation, not managed
retiring-key removal. A narrow reciprocal gate runs the public
`miakapi/browser` client in real Chromium against the Go relay and proves
snapshot, patch, call/result and completed post-lease reauthentication on one
WebSocket. The complete pinned platform gate additionally drives an
Auth-emulator identity and signed synthetic App Check token through the real
HTTPS exchange, exact `relay:user` verification, signing-key rotation and a
no-overlap authoritative handoff across two real relays. It uses synthetic
credentials and exact loopback Origins. One bounded private staging probe now
also proves live Firebase Auth/App Check enforcement, KMS-backed user-relay signing,
audience rotation and cleanup on the deployed control plane. The complete
standalone provider-attestation prerequisite was later closed when the default
system browser obtained one real reCAPTCHA Enterprise-backed App Check token
and the temporary Hosting route was retired. Two digest-pinned, scale-to-zero
relay services are now private-ready with exact assigned audiences and no
public IAM member. The complete disconnect matrix, authenticated browser-relay
flow, public ingress and broader staging acceptance remain open. A separately
pinned runner implementation now launches all three planned engines in an
offline CI smoke while collecting no browser diagnostics or credentials. The
current plan pins that merged implementation. A dormant monitoring contract
strictly allow-lists six read-only metric surfaces, the existing staging budget
shape and every runtime stop counter. One closed preflight from the merged
implementation observed those surfaces at the exact private boundary without a
cloud mutation, public-ingress change or acceptance execution. Plan revision 11
pins its result and closes `MONITORING-01`. The separate rollback package pins
the complete six-step reverse transition, ten closed-target observations and a
strict Terraform no-change shape. Its post-merge preflight observed the exact
private target without mutation or acceptance execution. Plan revision 12 pins
that sanitized result and closes `ROLLBACK-01`. A new dormant orchestrator now
implements the remaining edge composition boundary: separate exact
authorization precedes a globally serialized claim, the private baseline is
checked on both sides of claim acquisition, and one bounded edge window must
finish with a canonical-private postflight. Its profile authorizes nothing. A
post-merge read-only preflight proved the claim absent and the full rollback
target private and Terraform-converged without creating a claim or making a
cloud mutation. Plan revision 13 pins that sanitized result and closes
`EDGE-01`. The complete operation envelope then passed its own exact-commit
read-only preflight: the operation claim was absent, the edge and both relays
were private, the temporary route and application data were absent, and
Terraform had no change. Plan revision 14 pins that closed result; every
`LIVE-*` row remains pending. Plan revision 15 preserves revision 14
byte-for-byte and pins the merged revision-2 page profile plus its independent
three-engine offline CI proof. The archived `profile-v2.json` preserves that
claim, while current page revision 3 pins unchanged plan 15. The staging manifest
bundle uses a small canonical index and four fixed, size- and digest-bound
fragments while assembling the current revision-92 semantic object. It
retains the byte-exact earlier zero-relay plan used
by the image build, revision 9 used by the runner, revision 10 used by
monitoring, revision 11 used by rollback and revision 12 used by the
orchestrator preflight, revision 13 used by the operation preflight and revision
14 used by the page-host proof. It
pins the serial-4 private-ready result and rebases the current acceptance plan
on matching fresh live inventories. The state transition,
intended cost, exposure and rollback boundary remain reviewable without
pretending that a public edge or live browser matrix already exists.
The current page host now implements serialized native lifecycle and typed call
outcomes, returning only bounded browser observations through separate unchanged
safe-observation and new lifecycle schemas. Its Chromium budget is 600 seconds;
the 720-second three-engine total leaves 180 seconds for callback cleanup and
300 seconds for edge rollback within the unchanged public ceiling. The pinned
browser smoke proves the dormant artifact and explicit terminal cleanup before
sequential replacement using offline fakes. The later trusted non-persisted
native pagehide proves synchronous terminal fencing and zero active sockets;
IndexedDB is blocked while stopping or restored after stopped. It does not
prove completion of asynchronous Firebase cleanup.
Playwright 1.62.1 explicitly does not support BFCache testing: native persisted
restoration remains `blocked_by_pinned_playwright`, and simulated trusted
persisted unit events are not native BFCache proof. These checks provide no
cloud, publication or live acceptance. The separate closed aggregator assigns
all browser
and cloud assertions, counters and public identifiers to non-overlapping source
owners. The first source producer now derives the complete `browser_page`
receipt from 18 ordered Chromium facts and three facts in each secondary
browser, including scheduled renewal intervals, serialized handoff, persisted
page lifecycle and a fresh identity generation. A separate independent-source
package now closes the other 15 receipt producers from 43 ordered App Check,
Hosting, control-plane, relay, coordinator, KMS and Firestore facts. It accepts
no assertion maps, raw cloud responses, private identifiers or credentials, and the
18 receipt classes reduce offline to all 40 runner assertions. Both producer
boundaries retain no raw fact. A separate dormant evidence session now gives
all 18 sources one opaque operation-local capability and monotonic epoch. Its
attenuated ports accept projections only, derive envelopes and timing, enforce
Firefox then WebKit between Chromium LIVE-09 and LIVE-11, and revoke/clear on
close, abort or failure. It is not yet bound to the durable orchestrator claim,
the live operation or source adapters. The original three-input fixture remains
byte-exact. A separate scenario
fixture now supplies the required fourth input from a second exact synthetic
Firebase identity and grants both identities state access through the same
coordinator. A separate dormant Google/Firebase adapter now implements that
replacement identity's bounded cloud lifecycle, including token-bound identity
verification and independently observed cleanup. The original fixture limits
remain explicit, while current dependency pins and timing capacity follow page
revision 3. The replacement adapter resolves only the second-identity cloud
implementation gap and has not been live wired or executed. The separate
Playwright bridge now proves the real offline Firefox and WebKit
page-to-receipt transport with lazy private inputs and owned cleanup. Chromium
still fails closed before page or private-input acquisition because pinned
Playwright cannot prove native persisted BFCache restoration. None of these
packages grants Hosting publication or live authority; the complete Chromium
scenario, a BFCache-capable automation path, live source adapters and
aggregator wiring must close before the one allowed live matrix can execute.

Repository-specific implementation plans must link back to these documents and
must not redefine a shared contract locally.

## Public-repository rule

Everything under `docs/` is public. Never include production inventory,
household names, user counts, device identifiers, credentials, private hostnames,
or exports from a real home. Production characterization belongs in a local,
gitignored `.context/` directory.
