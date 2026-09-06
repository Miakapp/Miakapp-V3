# Miakapp 4 — Cross-repository roadmap

Date: 2026-08-29

Status: active coordination plan

Target: Miakapp 4

## 1. Product outcome

Miakapp turns a general-purpose coding agent into the engineer of a home. The
agent discovers existing infrastructure, builds or adapts a local coordinator,
creates a polished React interface, tests its work, and keeps the resulting
system understandable and repairable.

The product is not the Go relay, the wire codec, or an integration catalogue.
Those are supporting infrastructure. The product is the contract and tooling
that let an agent build an experimental home without requiring the user to be a
home-automation developer.

The initial audience is people who value experimentation and tailored
interfaces over reproducing a catalogue of prebuilt integrations. Existing
Node-RED, Home Assistant, Zigbee2MQTT, MQTT, and custom hardware installations
are starting points, not competitors that must be replaced on day one.

## 2. Confirmed direction

- The release is Miakapp 4, a deliberate breaking successor to Miakapp 3 rather
  than an in-place compatibility release.
- Firebase Auth remains the human identity root.
- A local coordinator owns home-specific application logic, membership,
  invitations, permissions, variables, events, and functions.
- MiakAPI remains the coordinator SDK and gains a CLI suitable for coding agents.
- `miakapp-server` becomes a generic real-time relay with no Firebase or platform
  secret.
- The web app becomes a React host capable of running a home-authored React UI.
- Components are compiled before publication and distributed as immutable,
  content-addressed artifacts.
- Firebase Functions form the privileged platform control plane for Home Key
  exchange and push delivery.
- Platform-side relations, groups, pages, invitations, and coordinator secrets
  are removed after migration.
- The official Miakapp 4 service does not permanently carry the v3 protocol.
- A central Miakapp Git service is deferred. Agents may manage their own Git
  repositories; the publication API must leave room for a later mirror.
- An embedded in-app agent is deferred until the external coding-agent workflow
  is proven.

## 3. Corrections incorporated into implementation

The original proposal required the corrections below. They are now accepted
constraints and remain blocking invariants for every implementation and staging
rollout.

### 3.1 Relay trust

The relay's production target is **platform-untrusted**: it receives no platform
signing key, persistent Firebase service credential, Home Key, or push
credential. It is not blind to home data. Because it terminates WSS, stores the
plaintext state, and applies routing and allowlists, a home must trust the
selected relay operator for confidentiality and correct enforcement. The
historical Firebase-direct trusted-relay alpha also received a transient user ID
token and therefore blocked arbitrary relay selection. RFC 0005's audience-bound
path now removes that project-wide bearer from the relay in local implementation;
broad relay selection still requires the corresponding staging gate.

End-to-end encryption through a blind relay is a separate future design. Until
then, documentation and product claims must not imply that self-hosting the
relay provides end-to-end confidentiality.

### 3.2 Home component isolation

A dynamically imported module runs with the privileges of the Miakapp origin.
A hash proves identity, not safety. Home-authored bundles must therefore not be
imported directly into the authenticated host application.

RFC 0002 closes the design gate. The default Miakapp 4 runtime uses a hidden broker on
a separate site under an opaque sandbox origin and deny-by-default CSP. The
broker parses the verified self-contained Worker program, starts it behind a
fixed confinement prelude in a terminable Dedicated Worker, retains the host
capability port, and forwards only bounded semantic UI or named operations.
The trusted React host renders the tree in its own DOM. An adversarial Chromium,
Firefox and WebKit harness exercises the security-critical architecture subset;
the complete production boundary remains the exit gate of workstream D.

### 3.3 Authorization beyond variables

Firebase proves who opened the connection. It does not decide whether that
person may open a gate, subscribe to an event, invoke a function, install a
bundle, or receive another user's data.

- The relay enforces coordinator-declared visibility for state and event topics.
- The relay attaches authenticated, non-spoofable caller metadata to every
  user-originated call and event.
- The coordinator authorizes every application operation.
- Calls from an unenrolled user are denied except for the reserved enrollment
  operation.
- Revocation and reauthentication have explicit, tested time bounds.

### 3.4 Protocol semantics

WebSocket and MessagePack provide transport and value encoding only. The wire
contract must additionally define:

- connection epochs, roles, capabilities, and version negotiation;
- exact frame layouts and cross-language golden vectors;
- snapshot and patch revisions;
- call identity, deadlines, cancellation, terminal states, and outcome-unknown
  behavior after disconnect;
- idempotency and retry rules for physical side effects;
- event authorization and subscription lifecycle;
- queue, frame, container, nesting, and cardinality limits;
- slow-consumer shedding and reconnect backoff;
- mixed-version behavior and reserved identifiers.

Correctness is established before path-dictionary or framing micro-optimisation.
Optimisations stay only when realistic benchmarks demonstrate a material gain.

### 3.5 Migration boundary

The cloud platform may have a final hard cutover, but the real home-automation
behavior must first be characterized and exercised against the Miakapp 4 stack.

The existing Node-RED package may be deprecated as a public product while a
Miakapp 4-compatible adapter remains available as a migration bridge. This preserves
the working installation as an oracle and rollback target without contaminating
the production relay with a permanent legacy protocol.

## 4. Repository responsibilities

| Repository | Miakapp 4 responsibility |
|---|---|
| `Miakapp-V3` | Canonical ecosystem docs, React platform shell, component host, Firebase rules/configuration, and web onboarding |
| `Miakapp-Server` | Go relay and protocol-conformance implementation; no persistent platform secrets or product business logic |
| `MiakAPI` | TypeScript/Bun SDK, browser protocol client where shareable, CLI, coordinator template, and protocol fixtures tooling |
| `node-red-contrib-MiakAPI` | Migration adapter and deprecation/onboarding path; no new product-specific business logic |
| `Colmon-Cloud` | Deployment and private migration validation for the reference installation; never the source of public platform contracts |
| Future agent-pack repository | Skills, MCP/tools, home repository conventions, discovery, safety guidance, and evaluation fixtures |

No implementation repository may invent a frame, claim, permission, component
API, or migration rule that is absent from the canonical contract.

## 5. Workstreams

### A. Shared contracts

Deliverables:

1. **complete** — protocol RFC and golden binary fixtures;
2. **complete** — principal and capability model;
3. **complete** — component runtime/bridge specification and architecture proof;
4. **complete** — platform control-plane specification for Home Keys, publishing, and push;
5. **complete** — migration and rollback specification;
6. **complete** — synthetic-home conformance fixture.
7. **complete** — public coordinator SDK and migration-adapter contract.

Exit gate: independent Go and TypeScript parsers pass the same fixtures, and the
trust model contains no component described as less trusted than its actual
privileges permit.

Contract status (2026-08-31): RFC 0001 and the shared valid/invalid corpus pass
independent Go and TypeScript implementations; RFC 0002 is accepted and its
architecture subset passes the three-engine hostile harness; the public
synthetic-home corpus passes its contract, replay and privacy checks; RFC 0003
defines the public coordinator surface and fail-closed migration adapter, backed
by an API-level corpus, bounded replay/evidence recorders and an external-subject
CLI consumed from an immutable repository commit. RFC 0004 defines the remaining
platform principals and control-plane authority and is backed by deterministic
signed vectors, independent TypeScript and Go verifiers, and a bounded behavioral
model. The shared-contract workstream is closed; real implementation and
operational migration exit gates remain in workstreams B through G.

### B. Existing-system characterization

Deliverables:

1. **complete** — sanitized synthetic inventory of variable paths, action shapes,
   notification fields and coordinator lifecycle behavior;
2. **complete** — replayable synthetic equivalents of representative behavior;
3. **complete** — shared coordinator/migration subject and effect-recorder
   harness;
4. a Node-RED runtime adapter test harness;
5. a timed restore rehearsal for the local coordinator environment;
6. an explicit list of behavior intentionally preserved versus fixed.

Exit gate: the Miakapp 4 implementation can be compared against a deterministic oracle
without accessing private production data in CI.

Characterization status (2026-08-30): `synthetic-home/` contains a hand-authored
fictional inventory and ten independent scenarios covering bootstrap, persisted
context, sensor automation, authorization, concurrent action, climate, energy,
notification, reconnect and outcome-unknown behavior. Its closed schemas, causal
command provenance, bounded deterministic replay, independent final-state
comparison, divergence and privacy guards remain the behavior oracle.
`coordinator-contract/` adds fourteen API/migration traces, a generic SDK subject,
recorder-owned state and leased effects, stimulus-indexed lifecycle/errors,
terminal declaration-promise evidence, atomic-declaration rollback and causal
call-handle checks, plus compiled Node 22 and authenticated process-bounded
external-subject execution. No production export or private value is part of
either corpus. The actual Node-RED runtime harness, restore rehearsal and
deployment-specific
preserved-versus-fixed list remain open, so the workstream is not complete.

### C. Relay and SDK vertical slice

Deliver one narrow path before the complete protocol:

1. Home Key exchange in the emulator;
2. one coordinator and one authenticated browser;
3. state snapshot plus one patch;
4. one authorized call with a result;
5. disconnect, reauthentication, bounded queues, and resynchronization;
6. Go/TypeScript conformance and fault-injection tests.

Exit gate: no silent state divergence or duplicate test side effect across the
defined disconnect matrix.

Implementation status (2026-09-04): the real TypeScript SDK and Go relay pass
their independent conformance suites. One pinned cross-repository gate drives a
synthetic owner through Firebase Auth and Firestore, creates a Home Key through
the real control-plane router, exchanges it through MiakAPI, and binds both
`HELLO` and scheduled `REAUTH` in the relay's production verifier. The observed
session stayed in generation 1 with one principal and no reconnect while
`REAUTH` changed to a prepublished future signing key. A separate fake-clock
instance of the same production cache proves one shared refresh for 32
concurrent future-key tokens, the ten-second random-`kid` abuse bound,
conditional expiry revalidation, fail-closed outage handling and bounded
recovery. This authentication gate is pinned by Miakapp-V3 merge
[`259173c`](https://github.com/Miakapp/Miakapp-V3/commit/259173ca730f0763710b7c99afa163ba26e70bb2)
and Miakapp-Server merge
[`25efc19`](https://github.com/Miakapp/Miakapp-Server/commit/25efc195dbd913a9e9e486db4cc7de1d836e9058).
It exercises initial publication, overlap and activation; retiring-key removal
is not part of this local runtime.

A narrow reciprocal gate first replaced the Node user double with the public
`miakapi/browser` client in real Chromium. Its historical baseline pins MiakAPI
merge
[`5c26eaa`](https://github.com/Miakapp/MiakAPI/commit/5c26eaa830015d94f53bf05fbbb0f5ebda6d290f)
and Miakapp-Server merge
[`da49e8b`](https://github.com/Miakapp/Miakapp-Server/commit/da49e8bf6b1bd03acaabd225ab5e96a61dd5dd91),
then proves enrollment, initial snapshot, one patch, call/result and a second
successful call after the original user lease expires, still on one WebSocket
with no reconnect.

The current complete local gate pins the V3 two-relay fixture at
[`f9509c4`](https://github.com/Miakapp/Miakapp-V3/commit/f9509c41ef1c0389623d31419372e6430a2313d9),
MiakAPI at
[`a798a74`](https://github.com/Miakapp/MiakAPI/commit/a798a746847ba3d5c16128a08b33353269e770a4)
and Miakapp-Server at
[`df10674`](https://github.com/Miakapp/Miakapp-Server/commit/df10674e034f30eec80760f5ec94bc108cff026f).
The relay pin now also enforces finite process-wide connection, attempt,
tracked-peer, Home and aggregate queue budgets before a public staging service
can be rendered.
It drives an Auth-emulator identity and signed synthetic App Check token through
the real exchange and exact `relay:user` verification, then changes the
authoritative Home route. The browser recovers state and calls on the second
real relay with one route-changing credential exchange, no source credential on
WebSocket and never more than one active socket. This closes the audience-bound
local credential gate. A separate bounded private staging probe now closes live
Firebase Auth/App Check verification, KMS-backed signing, relay-audience
rotation and cleanup on the deployed control plane. Browser-provider attestation
is complete and two exact-audience relay services are private-ready. The complete
disconnect matrix, public-window orchestration, monitoring, rollback and broader
staging acceptance remain open, so this workstream is not complete.

### D. Component platform vertical slice

Deliverables:

1. **host and broker foundations complete; lifecycle integration open** — trusted
   React semantic-tree renderer plus the RFC 0002 opaque Worker broker;
2. minimal versioned component bridge and React authoring adapter;
3. immutable upload followed by atomic pointer publication;
4. content verification, rollback, loading/error states, and cache behavior;
5. starter design system with accessible controls and explicit pending,
   accepted, applied, failed, stale, and outcome-unknown states;
6. malicious-bundle tests proving the absence of Firebase tokens, host storage,
   service-worker registration, arbitrary host DOM access, and undeclared APIs.

Implementation status (2026-09-05): the active web entry point is now a React 19
trusted-host shell. Its renderer revalidates every tree through the shared ABI 1
contract and maps only the twelve closed semantic node types to host-owned React
controls. Tests prove structured interaction handoff, capability-gated media and
fail-closed rejection of arbitrary properties before render. A local preview
adapter makes the product shell inspectable without Firebase, relay or home
credentials, and the legacy V3 Vue/Auth/service-worker application is no longer
part of the build. The opaque broker remains proven in its separate three-engine
hostile harness; wiring its lifecycle, immutable Firebase artifact delivery and
the real `miakapi/browser` adapter into this shell remains open.

Exit gate: a deliberately hostile bundle is contained by browser-enforced
boundaries, not by instructions or conventions.

### E. Platform control plane

Implementation status (2026-09-01): RFC 0004 and `control-plane-contract/` are
accepted. The isolated `control-plane/` package now proves the first
owner-to-access-token slice through local Auth, Functions and Firestore. Separate
Firestore and Storage client contexts prove the initial Rules boundary. It
covers the Section 5–7 home/Home Key/exchange path, but it does not close the
complete Section 18 emulator or staging gates. A second local slice now covers a
closed Firebase Installation ID (FID) proof-of-possession flow, bounded
destination/grant registries and semantic push authorization. Its App Check
verifier and FCM transport are strictly synthetic because the Local Emulator
Suite provides neither service. The bounded private staging user-relay probe
separately validates Admin custom-provider App Check enforcement, but browser
attestation and FCM acceptance/delivery remain open gates.

A third local slice now implements component upload capabilities, private
Storage read-back, marker-gated immutable release delivery, reconciliation,
concurrent pointer CAS, quarantine and rollback. It is local Emulator evidence,
not proof of production Storage IAM/CORS/lifecycle policy or Functions ingress
behavior.

A fourth local slice now enforces fixed-window rate and byte budgets through a
fixed-size Firestore slot table and records redacted outcomes in a fixed-size
audit ring. It proves atomic concurrent saturation, window reset, independent
dimensions, bounded 429 responses, request-ID correlation and no additional
signature after exchange denial. Trusted source attribution, edge admission,
alerting and capacity/cost calibration remain staging gates.

A fifth local slice consolidates dependency exceptions, transaction callback
replay, ambiguous commits, post-effect push/Storage failures, component
reconciliation, activation CAS and audit-finalization failures in the executable
[`control-plane/FAULT-MATRIX.md`](../../control-plane/FAULT-MATRIX.md). It closes
the deterministic application-level fault rows without claiming production
network or managed-service behavior.

A sixth offline slice now provides a closed staging/production runtime parser,
standard Firebase Admin App Check verification, FID-targeted FCM transport,
production Storage binding and an explicit dependency-injected composition root.
It rejects emulator and credential-file environments and is not imported by the
Firebase Emulator Function entry point. Its tests use only injected clients and
never contact staging. The billing-linked `miakapp-v4-staging` project has a
complete 37-resource bootstrap and 33-resource foundation in Paris
(`europe-west9`): private state and component buckets, runtime/planner/deployer
identities, the declared APIs, deletion-protected Firestore with three active
TTL fields, a software Ed25519 key, five Secret Manager containers and exact
resource IAM. Guarded activation then registered exactly one Firebase Web app
and one enabled initial version in each secret container. It has no App Engine
application or public ingress. One scale-to-zero Gen 2 Function and its backing
Cloud Run service are now active with internal-only ingress. An unscheduled
private Workflow returned the exact discovery document after two controlled
failures, without opening public ingress or making an application mutation.
Credential-free checks validate all six Terraform roots with mock providers.

The one-shot protected recovery is complete and its active workflow is removed.
PR #30 configuration commit
`ee457535a64355cd8133410d9c8c43f039608928` applied a 35-no-op/two-update plan
that changed only both recovery WIF providers from enabled to disabled; the pool,
service accounts and IAM roles remain. Current bootstrap state is serial 42 and
a follow-up plan reports no changes. This closes the reviewed GitHub OIDC
exchange route but does not disprove impersonation by another administrator.
All real staging rows remain open; the bounded private discovery gate is now
closed but does not satisfy a managed-service row by itself.

A seventh local-only activation-contract slice binds runtime and KMS references
to Paris, loads one bounded duplicate-key-safe non-secret configuration value,
and formalizes `initialize`, `prepare`, `activate` and `retire`
configuration-reference transitions for the five pinned Secret Manager
keyrings. The pure validator does not create, enable, disable or destroy cloud
secret versions. Instance initialization is single-flight and failures latch
behind a fixed non-cacheable `503`. A private, scale-to-zero Gen 2 staging entry
point now exists as reviewable source with no Function secret mounts. It is
absent from the emulator codebase and enabled only by the separate deterministic
production package; the workload Terraform root selects internal-only ingress.
The runtime configuration, initial secret versions and Firebase registration are
materialized. Private discovery and the Admin custom-provider App Check policy
are validated; browser-provider attestation and all `STAGE-*` observations
remain open.

An eighth activation-material slice adds the exact staging runtime-document
builder and a commit/plan-digest-bound two-phase executor. It permits only one
Firebase Web app and one initial 32-byte version in each of the five existing
secret containers, reconciles ambiguous writes against a private resumable
seed, and records no secret bytes in Git, logs, arguments, environment variables
or Terraform state. The guarded operation completed from merge commit
`101e4231d452423bafa2ae1efd051e51faeff3c8`; its exact plan replay reconciled
without mutation and its private seed was deleted. Digest-pinned non-secret
result and runtime evidence are committed. Independent inventory confirms no
Function, Cloud Run service, App Engine application or ingress. Every
`STAGE-*` observation therefore remains open.

A ninth slice deploys the private boundary without making a request. A
deterministic source archive selects only the production module graph. A third,
workload-only Terraform state now owns exactly fifteen resources: private source
and image storage, dedicated keyless build and probe identities, a source-read
grant conditioned to Google's regional Function bucket, a scale-to-zero
internal-only Gen 2 Function, and a custom runtime role containing only
`cloudmessaging.messages.create`. The first build exposed the missing conditional
source read; an exact two-create/one-in-place-update recovery completed it with
zero deletes. Output reconciliation and a fresh full plan changed no resource.
Independent inventory verified the active revision, copied source bytes, private
IAM and zero user-managed keys across all three workload identities. Public
ingress remained forbidden; one bounded private synthetic invocation was the
next gate.

A tenth staging slice deploys and consumes that isolated invocation path. One
unscheduled, argument-free Workflow uses the keyless probe identity for a fixed
OIDC-authenticated discovery request through internal ingress, with no schedule
or retry. Two pinned executions returned controlled `503` responses. After two
saved-plan source corrections that changed no IAM, ingress, network, scaling or
runtime document, the single permitted recovery execution returned HTTP 200 and
the exact discovery document. This proves the production initialization path
loaded all five secret values and validated the KMS public key; it does not
validate Firebase Auth, App Check, FCM or an application mutation. The committed
allow-listed evidence contains no execution UUID, trace context, raw headers,
stack or diagnostic payload, and both invocation entry points now fail closed.

An eleventh staging slice initializes Firebase Authentication with every
end-user provider disabled, then consumes it through a separate one-shot probe.
One no-email synthetic custom-token identity reached the internal-only Function:
the missing-App-Check control returned `401 invalid_app_check_token`, while two
requests carrying a real Admin custom-provider App Check token returned HTTP
200. This proves the backend verifier and explicit reusable-token policy, not
browser attestation. The identity was deleted and independently verified absent;
the Workflow and both temporary IAM bindings were retired. Only closed,
digest-pinned result and retirement summaries are public.

A twelfth staging slice deploys the merged audience-bound user-relay exchange
as source-only revision `control-plane-00004-yis`. Its saved plan replaced only
the deterministic source object and updated the Function and deployment guard
in place. The plan converged to zero changes; independent inventory verified
the copied source, internal-only ingress, scale 0..1, zero public invokers and
zero user-managed keys without making a request. The earlier discovery and Auth/
App Check probes remain historical evidence for revision
`control-plane-00003-hum`.

A thirteenth staging slice executes and retires the bounded live user-relay
probe against exact then-current revision `control-plane-00004-yis`. Its single
Workflow execution observes `401 invalid_firebase_token`,
`401 invalid_app_check_token` and `404 home_not_found`, then receives two
distinct five-minute Ed25519 credentials while rotating the authoritative
private Home from relay A to relay B. The internal verifier validates both
signatures, claims and changed audiences. The no-email synthetic user and
private Home are deleted and independently absent, the public `homes` path
stays absent, and retirement removes the Workflow, verifier and four temporary
bindings. All nine one-shot roles are disabled and unassigned; no recurring
compute remains. Digest-pinned public evidence contains no token, execution ID
or raw diagnostic.

A fourteenth staging slice deploys the bounded signing-key overlap bridge as
source-only revision `control-plane-00005-biq`. The exact saved plan again
changes only the deterministic source object, Function and deployment guard,
then converges to zero changes. Independent inventory verifies the copied
source, internal-only ingress, scale 0..1, zero public invokers and zero
user-managed keys without making a request. The deployed source preserves the
live schema-1, single-key runtime and accepts a closed schema 2 with one selected
KMS signer and at most two KMS-validated published keys. Runtime-document
migration and live overlap evidence were separate gates at that boundary.

A fifteenth staging slice applies the single-key runtime shape migration as
revision `control-plane-00006-wid`. Exact plan SHA-256
`f9531f2ccde649b9f4b27d63b9c2228812d7deb5101515d1572d81851ad30560`
contains only two in-place updates and preserves the source object, copied
source bytes, IAM, ingress, identities and scale. It converges to schema 2 with
one selected and published key, and independent inventory makes no Function
request. This closes the shape migration without claiming live key overlap.

A sixteenth staging slice prepublishes KMS versions 1 and 2 while retaining
version 1 as the selected signer. Exact plan SHA-256
`0ff816d86e0b391da341703744663d4d0efb2a5478c4e17fed2c7b23ca5e2e24`
updates only the Function and deployment guard in place and preserves source,
IAM, ingress, identities and scale. It converges to revision
`control-plane-00007-deb` without a Function request. A seventeenth staging
slice later selected version 2 while retaining version 1 and converged to
historical revision `control-plane-00008-saz`. Its exact plan again changed only
the Function and deployment guard, preserved source, IAM, internal-only ingress,
identities and scale, and made no Function request. An eighteenth staging slice
then converged the browser-relay rehearsal entry on historical revision
`control-plane-00009-kur`, reselecting version 1 while version 2 remained
published. Its exact plan again changed only those two resources, preserved the
same safety boundary and made no Function request. A nineteenth source-only
slice deployed the bounded staging edge profile to current private revision
`control-plane-00010-vop` while leaving the canonical profile, IAM, ingress and
scale active and making no Function request. Version-1 retirement remains
a separate live-matrix gate after the complete 330-second lease bound.

Deliverables:

1. owner bootstrap and Home Key lifecycle;
2. short-lived audience-bound access tokens and JWKS/key rotation;
3. user reauthentication semantics;
4. **local synthetic slice complete; staging open** — push-recipient
   authorization and user consent, including FID proof, grants and semantic send;
5. **local emulator slice complete; staging open** — bundle publishing
   authorization, read-back, release finalization and pointer activation;
6. **local emulator slice complete; staging open** — per-home quotas, fixed-
   window rate/byte limits, redacted audit records, and bounded
   security-operation write/effect costs;
7. **local deterministic matrix and relay-auth activation/overlap path complete;
   broader relay/staging rows open** — emulator-first tests cover Rules and Functions,
   synthetic push, component publication, bounded admission/audit, retry,
   ambiguous outcomes and reconciliation. A pinned cross-repository gate now
   covers real Home Key and browser-user exchanges, SDK `HELLO`, key-changing
   scheduled `REAUTH`, and the relay's production verifier. Its
   deterministic cache probe covers concurrent refresh coalescing,
   cache-expiry recovery, unknown-`kid` abuse limits and an unavailable JWKS.
   Real Chromium additionally proves exact audience/Home/user/role binding and a
   no-overlap authoritative route handoff across two relays. Live managed-service
   rotation and retiring-key removal, the complete disconnect matrix, network
   faults and staging admission evidence remain open.

Exit gate: a compromised relay cannot obtain a Home Key or platform credential,
and a Home Key cannot exercise capabilities outside its declared scopes.

### F. Agent experience

Deliverables:

1. installable pack for Codex and Claude Code;
2. repository knowledge file and versioned home contract;
3. discovery workflow for existing hosts, brokers, flows, devices, and services;
4. CLI/MCP tools for homes, components, releases, coordinator state, and tests;
5. synthetic-home evaluations and regression scenarios;
6. approval policy for security-sensitive or physically consequential actions;
7. deployment, rollback, and repair workflow.

Exit gate: a fresh agent can connect an existing synthetic installation and
produce a usable, accessible component without undocumented human intervention.

### G. Migration and launch

Deliverables:

1. a beta stack isolated from v3 production data and routes;
2. a Node-RED migration adapter capable of shadow publication without actuation;
3. state and UI comparison reports;
4. backup plus timed restore rehearsal;
5. one-home canary with explicit rollback criteria;
6. final data/rules/server/SDK/web deployment runbook;
7. public deprecation messaging and acquisition path in the legacy Node-RED
   package.

Exit gate: the canary meets correctness and availability criteria for a sustained
period, and rollback has been rehearsed rather than merely documented.

## 6. Milestones and dependency order

```text
M0  Contract reset
    A shared contracts + B characterization
              │
              ├──────────────┐
              ▼              ▼
M1  C relay/SDK slice    D component slice
              │              │
              └──────┬───────┘
                     ▼
M2             E control plane
                     │
                     ▼
M3             F agent experience
                     │
                     ▼
M4             G beta + shadow
                     │
                     ▼
M5             canary + cutover
```

Implementation may run in parallel only after the shared contract required by
both branches has passed its gate. Parallelism must shorten execution, not move
architectural decisions into separate repositories.

## 7. Decisions deliberately deferred

- central Git hosting;
- end-to-end encryption through a blind relay;
- session replay across relay restarts;
- active-active redundancy for the same physical actuator;
- embedded in-app agent;
- third-party component marketplace;
- general-purpose plugin execution inside the coordinator;
- replacing every existing Node-RED flow;
- multi-region relay deployment before measured demand.

The protocol may reserve room for a deferred feature, but no deferred feature
may add implementation complexity to the first vertical slice without a testable
current consumer.

## 8. Immediate action list

1. **Done** — amend the ecosystem design with the corrected relay and component
   trust boundaries.
2. **Done** — write and execute the protocol RFC before writing the Go server.
3. **Done** — define RFC 0002, select its opaque Worker broker and semantic UI
   architecture, and exercise the critical boundary subset in Chromium, Firefox
   and WebKit before choosing the React adapter or Storage URL mechanism.
4. **Done** — extract a sanitized synthetic-home fixture from behavior classes
   observed in the reference installation without copying production material.
5. **Done** — design the MiakAPI public surface and the migration adapter together
   in RFC 0003 and its executable contract harness.
6. **Done** — design Home Key bootstrap, signing, revocation, scopes, push
   authorization and bundle publication as one control-plane pass in RFC 0004,
   with cross-language and behavioral conformance evidence.
7. **Done 2026-09-01** — implement the first owner-to-access-token vertical
   slice in isolated local Firebase Auth, Functions and Firestore emulators,
   including separate Firestore/Storage client Rules and independent token
   verification.
8. **In progress 2026-09-04** — the emulator implementation covers closed FID
   registration, grants and semantic sends with synthetic App Check/FCM evidence,
   plus local component publication/read-back, immutable releases, reconciliation,
   concurrent CAS, quarantine and rollback, and fixed-slot audit/rate/cost
   admission. Its deterministic application/dependency fault matrix is explicit
   and executable. An inactive offline production composition binds the real SDK
   seams without importing or deploying them. The isolated, billing-linked Paris
   staging project now has a reconciled 37-resource bootstrap and complete
   33-resource foundation: private state and component buckets, separate keyless
   identities, the declared APIs, deletion-protected Firestore with three active
   TTL fields, a software Ed25519 key, five Secret Manager containers, and exact
   resource-scoped runtime IAM. Guarded activation registered exactly one
   Firebase Web app and enabled version `1` in each of those containers. It has
   no App Engine application or public ingress. A scale-to-zero Gen 2 Function
   and its Cloud Run service are active with internal-only ingress; exact source
   and IAM deployment inventory made no request. The already-live planner quota
   member was adopted through an import-only Terraform plan without changing
   project IAM; its serial-41
   generation remains historical evidence. The one-shot protected recovery
   completed, GitHub workflow `349440747` was disabled manually, its active
   source was removed, and its cloud-plan/apply activation flags and scripts fail
   closed. Both recovery WIF providers were then disabled through PR #30 commit
   `ee457535a64355cd8133410d9c8c43f039608928`; the enabled pool, service accounts
   and IAM roles remain. Current 37-resource bootstrap state is serial 42 and both
   roots plan to zero changes. The reviewed GitHub OIDC exchange is closed, but
   other administrator impersonation is not disproved. The production runtime
   document and initial secret lifecycle are now materialized and digest-pinned.
   The first Function build failed on Google's copied-source permission; a
   bounded recovery completed it in place, followed by output reconciliation and
   a zero-change plan. Two no-retry private discovery failures were followed by
   one exact HTTP 200 response from the corrected source, with no application
   mutation. Firebase Authentication is initialized in staging with its exact
   closed, no-provider baseline. A separately gated Auth/App Check probe consumed
   that state and validated a real Firebase ID token, an Admin custom-provider
   App Check token, the explicit V1 reusable-token policy and synthetic-user
   cleanup. Its temporary Workflow and IAM bindings are removed, and its
   sanitized evidence is digest-pinned. A pinned local cross-repository gate now
   carries a real emulator-created Home Key through the production-shaped HTTP
   exchange, MiakAPI `HELLO` and key-changing scheduled `REAUTH`, and the relay's
   production verifier without reconnecting. An isolated instance of that same
   cache closes the local concurrent-refresh, expiry, unknown-`kid`, outage and
   recovery matrix. This runtime stops after overlap and activation; retiring-key
   removal remains untested. A separate pinned gate now runs the real public
   browser client in Chromium and closes its narrow snapshot, patch, call and
   same-socket post-lease reauthentication path. The complete audience-bound
   local gate now adds an Auth-emulator user, signed synthetic App Check source,
   exact control-plane exchange, local relay verification and a no-overlap
   authoritative handoff across two real relays. The merged exchange source is
   accepted on private staging revision `control-plane-00004-yis`; one bounded
   live probe has now validated the three negative controls, both signed token
   exchanges, authoritative relay rotation and complete two-fixture cleanup.
   Its Workflow, verifier and temporary grants are retired. The bounded
   signing-key overlap bridge is active privately, its single-key schema-2
   migration is complete, and versions 1 and 2 are now prepublished on revision
   `control-plane-00007-deb` with version 1 current. Version 2 was selected on
   historical revision `control-plane-00008-saz`; the guarded browser-relay
   rehearsal entry then reselected version 1 on historical revision
   `control-plane-00009-kur` while version 2 remained published, with unchanged
   source, IAM, internal-only ingress and scale and without a live request. The
   bounded edge-profile source is now deployed privately as
   `control-plane-00010-vop`, but the canonical profile remains active.
   Retiring-key removal and secret
   rotation, source/edge admission,
   monitoring, migration rehearsal and real staging fault evidence remain
   required before closing relay-integration and staging-only RFC 0004 Section
   18 gates.
9. **Done 2026-09-04** — define the trusted browser client in RFC 0005, ship the
   isolated `miakapi/browser` entry point, and replace the relay's Node user
   double with real Chromium evidence for snapshot, patch, call/result and
   completed same-socket reauthentication after the original lease expires.
10. **Done 2026-09-04** — replace the Firebase-direct relay credential with an
    audience/home/user/role-bound short lease, pin the real exchange and verifier,
    and prove a serialized two-relay routing handoff in Chromium.
11. **Done 2026-09-05** — execute the bounded private user-relay exchange probe
    against the deployed merged control plane, verify both audience-bound
    credentials and retire every temporary capability and synthetic fixture.
12. **Done 2026-09-05** — replace the active V3 Vue entry point with the first
    React trusted-host shell, a closed ABI 1 semantic renderer, an explicitly
    offline interactive adapter, fail-closed tests and a dedicated web CI gate.
13. **Design, live-baseline rebase and rotation entry done 2026-09-06** — freeze the separate live relay, browser,
    signing-key and rollback acceptance matrix as a digest-pinned closed plan.
    It selects a reversible provider-endpoint topology, scale and invocation
    ceilings, twelve pending semantic cases and a deterministic cleanup state;
   it contains no deployer and claims no live acceptance evidence. Revision 9
   independently rebases the plan on `control-plane-00010-vop`, two published
    signing keys with version 1 current for the rehearsal, completed browser App
    Check attestation, zero Firebase Auth users, zero application fixture
   collections and two generation-2 private-ready relays with exact audiences,
   512 MiB, scale 0..1 and no public IAM. Its guarded rotation-entry and relay
   prerequisites are converged, the bounded staging edge profile is present in
   source but not selected, and the consumed one-shot tooling is retired. The
   historical revision-8 plan remains byte-exact for the relay-image build pin.
   A separately pinned dormant runner now launches Chromium, Firefox and WebKit
   sequentially in a real offline CI smoke, uses ephemeral contexts and exposes
   only closed semantic counters. Its profile records zero live runs and grants
   no Hosting, cloud mutation or public-ingress authority. Revision 10 pins the
   merged runner profile and closes `RUNNER-01`; byte-exact revision 9 remains
   the runner package's historical input.
14. **In progress 2026-09-05** — the control-plane source now retains legacy
    single-key runtime compatibility while accepting a closed schema 2 with one
    selected KMS signer and at most two KMS-validated published public keys. Its
    merge, private source deployment and guarded single-key schema migration are
    complete on revision `control-plane-00006-wid`, with unchanged effective
    key and source bytes. The reCAPTCHA Enterprise API and exactly one
    domain-restricted score key are live and converged, with an atomic private
    GCS claim preventing concurrent independent bundles from repeating
    creation. Their consumed entrypoints are retired and sanitized evidence is
    committed. The separate non-deletable App Check registration then converged
    on its first exact saved-plan apply. Its two additional atomic global claims
    and direct-cloud sandwiches bound the operation and provider-PATCH boundary;
    the exact provider now has a one-hour TTL and default 0.5 minimum score while
    enforcement and debug tokens remain absent.
    No recovery ran. Registration and unused recovery entrypoints are retired,
    and sanitized state/claim evidence is committed. A second software Ed25519
    signing version then converged after the first and only guarded direct REST
    request. Its two atomic claims remain durable, its one-shot entrypoints are
    retired. Both public keys are now prepublished on revision
    `control-plane-00007-deb` with version 1 current, unchanged source bytes,
    private ingress and scale 0..1. Version 2 was selected on historical revision
    `control-plane-00008-saz`; the guarded configuration-only rehearsal entry
    then reselected version 1 on historical revision `control-plane-00009-kur`
    while version 2 stayed published, with the same source, ingress and scale.
    Its one-shot tooling is retired. The bounded staging edge-profile source is
    now current on private revision `control-plane-00010-vop`; it rejects mixed
    issuer/origin pairs, and the canonical profile remains active. A dormant,
    non-CLI edge state machine now enforces public-last transition,
    private-first rollback, a 900-second callback ceiling, a 1,200-second public
    ceiling and IAM-independent emergency ingress closure. A separate dormant
    Terraform root now freezes the two relay services, their private-bootstrap,
    private-ready, public-window and absent states, public-last IAM dependency,
    scale-to-zero profile and matching process admission limits. Its immutable
    image digest and private-ready state have converged through three retained
    claims, with no public invoker, and all one-shot entrypoints are retired.
    A separate closed monitoring contract fixes the only permitted metric,
    budget and closed-counter observations. One read-only preflight from its
    merged implementation observed the exact private boundary and existing
    budget without mutation or acceptance execution; plan revision 11 pins its
    closed result and marks monitoring satisfied. The separate post-merge
    rollback preflight then observed all ten canonical-private target facts and
    a four-resource Terraform no-change plan without mutation or acceptance.
    Plan revision 12 pins that sanitized result and marks rollback satisfied. A
    dormant single-use orchestrator now binds both state machines
    and the merged three-engine runner to a distinct retained generation-zero
    claim, rechecks the private baseline after claiming and requires a private
    postflight. It has no live authority or entrypoint. Its read-only post-merge
    preflight proved the global claim absent and the full private rollback target
    converged, with no mutation or acceptance execution. Plan revision
    13 archives the exact revision-12 input, pins that sanitized result and
    closes the edge prerequisite. The exact single-use live-operation envelope
    is now implemented as a dormant in-process composition: it opens the two
    relays last, validates one closed matrix result, removes the runner and
    sessions before restoring private relays, then deletes fixtures only after
    the control plane is canonical-private. It has no cloud adapter or live
    authority. Its closed read-only preflight ran once from exact merged commit
    `ae21e4922d3f70fffe9218cd975f180faca486f0` and proved the claim absent plus
    the complete private, empty and Terraform-converged baseline with zero
    mutation or acceptance. Plan revision 14 preserves revision 13 byte for
    byte and pins that result. The exact page-host foundation now uses
    memory-only Firebase Auth, real App Check and a digest-pinned MiakAPI bundle;
    its deterministic artifact is loaded without network access in Chromium,
    Firefox and WebKit by a dedicated CI gate. Plan revision 15 preserves
    revision 14 byte-for-byte and pins that merged page profile and proof. It
    remains deliberately not runner-compatible and has no publisher or live
    authority. The next source-only increment added the independent fixed
    synthetic-Home controller. It proves every fixture domain absent before
    granting cleanup authority, configures one exact MiakAPI coordinator,
    issues one non-reusable in-memory custom token per browser, supports the
    reviewed relay rotation and requires coordinator-first verified cleanup.
    It has no cloud transport or live authority. Its separate Google/Firebase
    adapter is now implemented behind an explicit ephemeral-session and pinned
    MiakAPI-factory boundary. Four keyless JWT signatures and the three fixed
    control-plane writes are single-use; cleanup validates the exact ownership
    cluster and key registry, deletes Firestore atomically with per-document
    update-time preconditions, removes the synthetic Firebase UID last and
    requires independent absence. It remains dormant, has no CLI or binding
    authority and has made no live request. The pinned MiakAPI Node factory
    binding is now also present: its reproducible single-file bundle exposes
    exactly one provider and coordinator construction, forces the Home Key
    exchange through the injected transport and starts no session. The
    independent closed aggregator is now present as well: every assertion,
    counter and public identifier has one exact source owner and 18 ordered
    single-use receipts reduce to the existing engine schema without retaining
    raw evidence. The first source observer is now implemented as a closed
    browser-page receipt producer: 18 exact Chromium facts cover renewal,
    handoff, reconnect, persisted lifecycle, teardown and identity replacement,
    while Firefox and WebKit each require three. It admits no assertion
    booleans and retains no raw fact. The immutable original fixture still has
    three private page inputs, but a separate closed scenario fixture now
    supplies the fourth from a second genuine synthetic Firebase identity,
    extends the unique coordinator's state access to both identities and
    requires both cleanup domains to reach absence. The separate dormant
    replacement-identity cloud adapter is now implemented: injected ephemeral
    credentials and transport bound two keyless signatures, token-bound
    identity verification and independently observed cleanup without mutation
    retries. Its profile records the implementation while the older
    compatibility snapshots remain unchanged; no live wiring or execution is
    present. The Chromium page budget remains 480 seconds while two live
    renewals plus scenario overhead require 600, and the page/Playwright
    scenario is not wired. Close those remaining compatibility gaps, then
    implement the independent cloud observers before executing the matrix once.
    A dormant rollback package now pins all six reverse steps, the exact private
    target and ten read-only observations, including a strict Terraform
    no-change plan. Its fresh post-merge preflight is complete and the rollback
    gate is closed. Execute
    the matrix once before
    retiring version 1 after the complete lease bound and wiring the real client
    and opaque broker into the production web shell. This reuses the existing
    keys and does not create a third KMS version.
15. **Done 2026-09-05** — obtain one fresh reCAPTCHA Enterprise-backed App
    Check token through the exact staging Hosting origin in the default macOS
    browser. The challenge-bound loopback result proved the provider call
    resolved with a bounded three-segment JWT; no token or claims left the page.
    Temporary Hosting was disabled and deleted after an 8,749 ms public window,
    the runner was independently observed as HTTP 404, and every one-shot
    execution and recovery entrypoint is retired. The complete authenticated
    browser-relay matrix remains separate and must mint fresh credentials.

## 9. Evidence that would change this plan

The plan should be simplified if the product becomes a private single-home tool
rather than a public multi-tenant product. It should become more restrictive if
third-party bundles or runtime agents can be installed without a home owner's
explicit approval.

The Node-RED migration adapter may be dropped only after replayable evidence
shows that the reference installation can move safely without it. Component
sandboxing may be relaxed only if home bundles are reclassified as audited
first-party Miakapp releases, not merely code produced for a tenant.

Overall confidence in this sequencing, protocol 1.0 wire format, component
runtime architecture selection, coordinator/migration API boundary and
control-plane contract is **high** after cross-language conformance, the
cross-browser hostile subset and the bounded contract corpora. Confidence in the
trusted browser client's narrow snapshot/patch/call/reauthentication path is
**high within its synthetic Chromium boundary**. Confidence in complete runtime
conformance, the real Node-RED adapter, production push delivery, the complete
React host/broker integration and production Firebase artifact delivery remains
**medium** until their
vertical slices exercise the accepted contracts end to end. Confidence in the
now-executed owner/Home-Key/access-token, audience-bound browser relay, synthetic
push and component-publication paths is **high within their documented local
boundaries**, but it is not production or staging evidence.
