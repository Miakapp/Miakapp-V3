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
  fakes, not native async Firebase cleanup; its high-level Playwright BFCache
  path remains blocked, while the separate native driver below closes that
  offline proof without adding live runner wiring.
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
  closes one interleaved runner result. This primitive itself contains no claim
  or live adapter; scheduling and the graph-level claim binding are supplied by
  separate dormant packages below.
- [`../infrastructure/staging/browser-relay-case-scheduler/`](../infrastructure/staging/browser-relay-case-scheduler/)
  — dormant case scheduler that runs the exact 11-stage `LIVE-02..LIVE-11`
  topology, attenuates all 67 page/source projections to their owning case,
  awaits browser start and page/browser/global closure, and returns only the
  closed runner result. Its concrete Chromium adapter is the separate dormant
  package below, and the secondary page paths are composed by the following
  layered adapter. This package contains no claim or live authority; the complete
  graph is claim-bound by the later operation case adapter.
- [`../infrastructure/staging/browser-relay-chromium-case-adapter/`](../infrastructure/staging/browser-relay-chromium-case-adapter/)
  — dormant source-only composition of a ready-only four-method fixture facade, native
  two-page Chromium scenario and fixed case scheduler. It maps all 18 page
  projections and 11 fixture controls onto their exact `LIVE-04..LIVE-09`
  stages, holds fact 12 until `LIVE-09` before BFCache work can begin, delegates
  every independent source and secondary browser, and aborts and drains the
  scenario plus delegated work before one global close. Its offline integration closes all 40
  runner assertions without granting fixture lifecycle, cloud, Hosting,
  operation or live-execution authority.
- [`../infrastructure/staging/browser-relay-secondary-case-adapter/`](../infrastructure/staging/browser-relay-secondary-case-adapter/)
  — dormant source-only layer that composes the unchanged Playwright bridge for
  real offline Firefox and WebKit pages beneath the Chromium adapter. It
  validates each complete page fact before projecting only the five semantic
  fields into `LIVE-10`, preserves the evidence session as envelope and receipt
  owner, proves both page closures and closes the same 40-assertion schedule.
  Genuine live page providers and source acquisition, process isolation and
  every live/cloud authority remain absent from this layer; the complete graph's
  claim binding is supplied separately.
- [`../infrastructure/staging/browser-relay-independent-case-adapter/`](../infrastructure/staging/browser-relay-independent-case-adapter/)
  — dormant source-only layer that fills the final scheduler adapter slot with
  seven source-owned observer capabilities and one browser-lifecycle owner. It
  derives source kind and sequence, projects observations only, preserves
  concurrent cross-source acquisition and closes all 43 independent facts plus
  the complete 40-assertion schedule offline. The adjacent transport and
  authenticated-capability reader layers now supply the acquisition protocols,
  and concrete ephemeral-session authority adapters plus trusted-client session
  producers are sibling layers. Live clients/page/browser providers, process isolation and every live/cloud
  authority remain absent here, while graph-level claim binding is separate.
- [`../infrastructure/staging/browser-relay-source-transports/`](../infrastructure/staging/browser-relay-source-transports/)
  — dormant genuine transport layer for the seven independent sources. It pulls
  the exact 22 stages and 43 observations from trusted source-specific readers,
  requires explicit EOF, awaits downstream backpressure, binds provider and
  reader identities to one operation/stage, drains bounded late settlements and
  poisons every protocol violation permanently. Its adjacent reader package now
  supplies compatible dormant providers, followed by concrete
  session-to-authority adapters and trusted-client session producers. Concrete
  network clients, credential acquisition, case-adapter wiring,
  dedicated-process IPC and live/cloud authority remain absent.
- [`../infrastructure/staging/browser-relay-authenticated-source-readers/`](../infrastructure/staging/browser-relay-authenticated-source-readers/)
  — dormant reader/provider protocol for seven injected,
  already-authenticated source capabilities. Each capability is attenuated to
  its canonical fact kinds; one bounded operation capability and absolute
  expiry bind all 22 stages, and all 43 sanitized observations are semantically
  validated before crossing the provider boundary. The package accepts and
  retains no raw credential or source material and performs no network or cloud
  I/O. Its concrete session-to-authority adapters and dormant trusted-client
  session producers are implemented separately; concrete client acquisition,
  case wiring, IPC and live authority remain absent.
- [`../infrastructure/staging/browser-relay-source-authority-adapters/`](../infrastructure/staging/browser-relay-source-authority-adapters/)
  — dormant concrete bridge from seven explicit ephemeral source sessions to
  the exact 32 kind-specific authority methods. It fixes every staging source
  scope, binds one opaque operation capability on first use, revalidates the
  canonical 22-stage/43-observation order, bounds read and public-close wrappers,
  sanitizes cancellation, validates every projected observation and releases a
  session only after its started callbacks settle. Dormant session producers are
  now present; network/credential clients, transport-to-case wiring,
  browser-process IPC and live execution are intentionally absent.
- [`../infrastructure/staging/browser-relay-source-session-producers/`](../infrastructure/staging/browser-relay-source-session-producers/)
  — dormant trusted-client bridge that creates the exact seven fixed-scope
  sessions from seven explicit frozen `{ observe, close }` clients. It enforces
  canonical dispatch, sanitized cancellation, independent semantic validation,
  shared poison, started-callback drain and terminal client release without an
  inner timeout race. Its adjacent fixed-target clients are now implemented,
  while credential discovery, network transport, operation/case wiring, browser
  ownership, process IPC and live authority remain absent.
- [`../infrastructure/staging/browser-relay-source-clients/`](../infrastructure/staging/browser-relay-source-clients/)
  — dormant seven-source acquisition boundary over explicit ephemeral
  authorities. Each canonical call receives one immutable staging target and a
  fresh non-serializable request capability; only an identity-bound exact receipt
  can return one independently validated observation. Proxy protocol records are
  rejected before traps, active calls are aborted at their shared absolute
  expiry, and descendant authority jobs cannot reenter peer clients. This is a
  trusted same-process boundary, not hard isolation for pre-existing async
  resources. The package forbids ambient credentials, consuming App Check
  verification, delayed-metric inference, built-in network access, case wiring
  and live execution.
- [`../infrastructure/staging/browser-relay-chromium-scenario/`](../infrastructure/staging/browser-relay-chromium-scenario/)
  — dormant two-page Chromium driver that owns the complete 18-fact page
  scenario and closes the existing receipt producer offline. Its pinned CDP
  restore requires trusted persisted page events plus an exact browser-level
  `BackForwardCacheRestore`; current and latched diagnostics plus active
  trace/HAR/video/logger capture are rejected before private input, and a
  protocol lease blocks or latches reviewed observer transitions until page
  cleanup. This is explicitly a trusted, exclusively owned Playwright-process
  harness, not a same-realm sandbox: the injected providers, page navigation,
  content/init scripts and quiescent connection are trusted. Untrusted live
  wiring requires dedicated-process browser ownership and validated narrow IPC.
  Within that boundary, a main-frame instrumentation lease keeps ordinary
  Playwright test listeners off the private argument path and bypasses
  caller-owned page wrappers. The production path
  additionally records exact Page/Frame/channel identities while the pinned
  factories create them and locks the trusted evaluation channel, ChannelOwner
  helpers and connection transport callback; forged prototypes, channels,
  protocol methods and transport hooks fail before
  token acquisition. Cleanup bypasses caller-owned close methods and accepts a
  close only after native state plus Page/Frame connection removal agree.
  Its awaited five-field projection port is now consumed by the dormant case
  adapter above. Live source acquisition and execution authority remain absent.
- [`../infrastructure/staging/browser-relay-playwright-bridge/`](../infrastructure/staging/browser-relay-playwright-bridge/)
  — dormant fail-closed Playwright page-to-receipt bridge with lazy private
  input acquisition and owned page cleanup; real Firefox and WebKit engines
  close exact page receipts offline, while this legacy path intentionally keeps
  Chromium blocked before page or private-input acquisition by pinned
  Playwright's high-level BFCache limitation.
- [`../infrastructure/staging/browser-relay-page-receipt/`](../infrastructure/staging/browser-relay-page-receipt/)
  — dormant browser-owned receipt producer that reduces exact cumulative page,
  state, call and native lifecycle facts without accepting assertion booleans;
  revision 2 is digest-bound to the adjacent bridge and combines with every
  independent source offline. The standalone driver and case adapter now close
  its full Chromium input through the scheduler; genuine live cross-source
  acquisition remains open.
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
- [`../infrastructure/staging/browser-relay-operation-case-adapter/`](../infrastructure/staging/browser-relay-operation-case-adapter/)
  — dormant composition root that binds the unchanged single-use operation to
  the complete three-browser schedule behind one canonical durable claim. It
  forwards only the edge abort signal and exposes no claim lineage, provider,
  cloud authority or live execution path.
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
bundle uses a small bundle-revision-3 canonical index and six fixed, size- and
digest-bound fragments, with browser-relay scenario, reader-boundary and
operations evidence separated physically, while assembling the current
revision-102 semantic object. It
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
restoration remains `blocked_by_pinned_playwright` in the high-level bridge, and
simulated trusted persisted unit events are not native BFCache proof. A separate
pinned-CDP driver now owns two Chromium pages, drives all 18 facts into the real
receipt producer and accepts restoration only when trusted persisted page
events agree with an exact browser-level `BackForwardCacheRestore`. Its full
Chromium smoke also proves that an active trace is rejected before token
acquisition and that an unawaited trace-chunk transition cannot reach a
  token-bearing page action. It also installs a real Playwright instrumentation
  listener and proves that the listener receives no token within the explicitly
  trusted, exclusively owned process boundary. The injected providers and page
  content are not an adversarial same-realm confidentiality boundary. The same smoke rejects
forged Frame prototypes, replacement channels, injected channel evaluation
methods, ChannelOwner/transport shadows and a caller-owned no-op close before
private input is requested, while still proving native page closure. The smoke
remains offline: these checks provide no
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
close, abort or failure. A separate dormant scheduler now composes
that production session into 11 fixed stages: Chromium `LIVE-02..LIVE-09`,
Firefox then WebKit for `LIVE-10`, and Chromium `LIVE-11`. Its non-serializable
case scopes admit exactly the 67 reviewed projections, and it awaits explicit
browser start, page/browser close and global adapter close boundaries before
returning only the closed result. It remains unwired and gives no live authority.
The original three-input fixture remains byte-exact. A separate scenario
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
still fails closed in that legacy bridge before page or private-input
acquisition because pinned Playwright cannot prove native persisted BFCache
restoration. The dedicated Chromium driver closes the complete page scenario
and BFCache automation gap offline without weakening that blocker. Its native
witness records Chromium's visible `pagehide` dispatch, later trusted hidden
transition and visible `pageshow` separately, under the reviewed Hosting
`no-store` and security-header policy. The layered case adapters now compose all
three complete page scenarios and seven deterministic independent-source
observers into the scheduler/session offline. A separate dormant boundary
implements the seven genuine source transport protocols, an adjacent dormant
boundary turns seven injected, already-authenticated, kind-attenuated
capabilities into their exact compatible providers, and a third boundary now
  adapts seven fixed-scope ephemeral sessions into those capabilities. A fourth
  dormant boundary creates the sessions from explicit trusted clients while
  accepting no credential field or raw source material; client closures remain
  captured only until actual terminal settlement. None is wired to those
  observer slots. Another dormant composition root binds the complete
schedule to the unchanged operation after one canonical durable claim and
forwards only the exact edge abort signal. None of these packages grants Hosting
publication or live authority; concrete live source clients, live page/browser
providers, dedicated-process IPC, case-adapter transport wiring and fixture
lifecycle wiring must close before the one allowed live matrix can execute.

Repository-specific implementation plans must link back to these documents and
must not redefine a shared contract locally.

## Public-repository rule

Everything under `docs/` is public. Never include production inventory,
household names, user counts, device identifiers, credentials, private hostnames,
or exports from a real home. Production characterization belongs in a local,
gitignored `.context/` directory.
