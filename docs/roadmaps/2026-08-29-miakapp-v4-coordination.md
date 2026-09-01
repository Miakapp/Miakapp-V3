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

## 3. Corrections required before implementation

The architecture direction is approved, but the original design document is
not yet an implementation-ready shared contract. The following corrections are
blocking.

### 3.1 Relay trust

The relay is **platform-untrusted**: it receives no platform signing key,
Firebase credential, Home Key, or push credential. It is not blind to home data.
Because it terminates WSS, stores the plaintext state, and applies routing and
allowlists, a home must trust the selected relay operator for confidentiality
and correct enforcement.

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
| `Miakapp-Server` | Go relay and protocol-conformance implementation; no platform secrets or product business logic |
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

### D. Component platform vertical slice

Deliverables:

1. trusted React semantic-tree renderer plus the RFC 0002 opaque Worker broker;
2. minimal versioned component bridge and React authoring adapter;
3. immutable upload followed by atomic pointer publication;
4. content verification, rollback, loading/error states, and cache behavior;
5. starter design system with accessible controls and explicit pending,
   accepted, applied, failed, stale, and outcome-unknown states;
6. malicious-bundle tests proving the absence of Firebase tokens, host storage,
   service-worker registration, arbitrary host DOM access, and undeclared APIs.

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
Suite provides neither service; real App Check enforcement, FCM
acceptance/delivery remain open gates.

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
7. **local deterministic matrix complete; relay/staging rows open** — emulator-
   first tests cover rules and Functions, synthetic push, component publication,
   bounded admission/audit, retry, ambiguous outcomes and reconciliation;
   production service integration, network faults, relay token refresh and
   staging admission evidence remain open.

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
8. **In progress 2026-09-01** — the emulator implementation now covers closed FID
   registration, grants and semantic sends with synthetic App Check/FCM evidence,
   plus local component publication/read-back, immutable releases, reconciliation,
   concurrent CAS, quarantine and rollback, and fixed-slot audit/rate/cost
   admission. Its deterministic application/dependency fault matrix is now
   explicit and executable. A closed, credential-free staging manifest now fixes
   the isolated target, initial resource/IAM/cost posture and teardown inventory
   without creating a project or enabling deployment. Next implement the missing
   production adapters, obtain explicit location/billing approval, and only then
   convert the reviewed intent into a deployable plan that closes the
   relay-integration and staging-only RFC 0004 Section 18 gates.

## 9. Evidence that would change this plan

The plan should be simplified if the product becomes a private single-home tool
rather than a public multi-tenant product. It should become more restrictive if
third-party bundles or runtime agents can be installed without a home owner's
explicit approval.

The Node-RED migration adapter may be dropped only after replayable evidence
shows that the reference installation can move safely without it. Component
sandboxing may be relaxed only if home bundles are reclassified as audited
first-party Miakapp releases, not merely code produced for a tenant.

Overall confidence in this sequencing, protocol 1.0 wire format, component runtime
architecture selection, coordinator/migration API boundary and control-plane
contract is **high** after cross-language conformance, the cross-browser hostile
subset and the bounded contract corpora. Confidence in complete runtime
conformance, the real Node-RED adapter, production push delivery, the React
adapter and production Firebase artifact delivery remains **medium** until their
vertical slices exercise the accepted contracts end to end. Confidence in the
now-executed owner/Home-Key/access-token, synthetic push and component-publication
emulator paths is **high within their documented local boundaries**, but it is
not production or staging evidence.
