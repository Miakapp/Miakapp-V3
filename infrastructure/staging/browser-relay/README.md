# Staging browser-relay acceptance plan

This directory freezes the rebased reviewable plan for live browser, relay,
signing-key and rollback acceptance. It contains no Terraform, deployer,
invocation wrapper, credential or result. Reading or validating it authorizes no
cloud mutation. The committed state is
`edge_profile_source_converged_reviewed_not_deployed`, all `LIVE-*` cases are
pending and the canonical staging manifest still records private control-plane
ingress.

Run the credential-free validator from the repository root:

```sh
node infrastructure/staging/browser-relay/guard.mjs \
  infrastructure/staging/browser-relay
node infrastructure/staging/browser-relay/validate.mjs \
  infrastructure/staging/browser-relay/plan.json
```

Both commands are also part of `npm run test:staging-manifest`.

## Why this is a separate plan

The completed `auth-probe/` gate proved live Firebase ID-token and Admin
custom-provider App Check verification, KMS signing and two relay audiences
without creating a relay or exposing the Function. It did not exercise a Web
App Check provider, a browser WebSocket, a real relay process, managed key
retirement or rollback.

The later consumed `browser-attestation/` operation separately obtained one
fresh Web App Check provider token in the default system browser. That closes
the standalone provider prerequisite, but it did not exchange a browser user
credential, open a relay WebSocket or execute the negative controls in
`LIVE-02`.

The browser WebSocket API cannot attach a Cloud Run IAM bearer header. A live
browser therefore cannot connect to an IAM-only relay. This plan selects a
short, separately reviewed public-network window with application-layer
authentication instead of pretending the existing private topology can run the
case. Public access is limited to the isolated staging project and is removed by
the same acceptance sequence.

## Selected topology

| Surface | During the bounded window | Authentication and limit |
|---|---|---|
| Browser artifact | inert static runner at the existing staging Hosting origin | no credential in the artifact, URL, storage, trace, HAR or video |
| Control plane | existing provider `run.app` endpoint, temporarily `ALLOW_ALL` | exact CORS; Firebase ID and Web App Check on the exchange; 0..1 instance |
| Relay A / B | two digest-pinned Cloud Run services with public `/ping` and `/ws` | exact Origin and `miakapp` subprotocol; audience-bound token in `HELLO`; 0..1 instance each |
| Runner | local, operator-started Playwright process | three launches maximum; credentials passed only as in-memory page arguments |

The provider endpoints avoid an external load balancer, Cloud Armor, VPC
connector, Cloud NAT, App Engine region selection and staging DNS dependency.
They are staging identifiers, not production endpoint choices. Any later custom
domain rollout remains a separately observed production-exit gate.

Cloud Run treats an open WebSocket as a long-running request and bills the
instance while the socket is open. The plan therefore permits one acceptance
execution, at most two relay services, one instance per service, a 900-second
socket timeout and a 1,200-second public window. The planned upper bound is EUR
1 without assuming a free tier, below the separately authorized EUR 5 monthly
increment. That is an operational stop threshold, not a provider-enforced hard
spend cap. See Google's current
[WebSocket guidance](https://cloud.google.com/run/docs/triggering/websockets),
[request-based billing description](https://cloud.google.com/run/docs/configuring/billing-settings)
and [Cloud Run pricing](https://cloud.google.com/run/pricing).

The intended Web provider is reCAPTCHA Enterprise with only the staging Hosting
domain. The matrix allows at most 16 assessments. Google currently documents a
free allowance for the first 10,000 monthly reCAPTCHA assessments, but the plan
does not rely on that allowance. See the
[Firebase Web App Check provider guide](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
and [reCAPTCHA billing](https://cloud.google.com/recaptcha/docs/billing-information).

## Preconditions

Revision 7 was rebased from an independent read-only observation on
2026-09-05T19:49:07.829Z. It verified `control-plane-00010-vop`, private ingress,
zero unauthenticated invokers, two enabled and published signing versions with
version 1 current for the rehearsal entry, a registered reCAPTCHA Enterprise provider, the prior real
browser token result, zero enforcement records, zero debug tokens, zero Firebase
Auth users, zero application fixture collections, zero relay services and an
HTTP 404 runner route. Firestore contained only ten bounded admission/audit
documents across its three expected technical collections; no Home or user
collection existed.

The immutable cross-repository pins, two-key runtime, readable provider,
standalone real-browser token observation, guarded rotation entry and bounded
edge-profile source support are therefore present today. The new source accepts
only the exact staging direct `run.app` issuer and exact Hosting `web.app` origin
as an atomic pair; mixed or foreign provider domains fail closed. The deployed
runtime remains on the canonical issuer/origin pair, so this source deployment
did not open an edge or authorize a live request. The entry plan changed only
the Function and its
deployment guard in place, retained both published keys, source, build, IAM,
private ingress and scale, and made no live request. Its one-shot wrappers are
retired. The complete authenticated browser case remains part of `LIVE-02`.
Before any public transition, the remaining work must provide:

1. a digest-bound and reversible control-plane ingress transition;
2. two digest-pinned relay services using a keyless no-role identity;
3. a three-engine runner that emits closed semantic counters only;
4. allow-listed metric and billing observations; and
5. a rollback plan that is rendered and checked before the live window opens.

The adjacent [`browser-relay-edge/`](../browser-relay-edge/) package now
implements and tests the dormant transition state machine. It selects the edge
runtime while private, opens ingress before adding the public IAM member, and
rolls back IAM before ingress and runtime. It has no CLI or authorization path.
`EDGE-01` therefore remains open until a later digest-bound orchestrator adds
the single-use claim and requires all other live preconditions.

The currently deployed runtime document publishes both signing keys with
version 1 current and version 2 retained. This completes the rehearsal entry
and the platform support
for the routine 60-second prepublication and 330-second retiring-key retention
contract. The guarded
`signing-overlap/` package now freezes the one-shot second-version creation and
subsequent 60/330-second rollout. Version 2 converged after one direct KMS
request, both coordination claims remain durable and its one-shot entrypoints
are retired. The schema-2 bridge, shape migration and two-key prepublication
were deployed privately through revision `control-plane-00007-deb`; the later
activation converged on revision `control-plane-00008-saz` without changing
source, build, IAM, ingress or scale and made no live request. `SIGNING-01` is
now satisfied. The separate reversible configuration-only entry then converged
to `control-plane-00009-kur`, reselecting version 1 without creating a third KMS
version. `ROTATION-ENTRY-01` is satisfied. Version 2 stays published throughout;
the matrix activates it on the live socket and retires version 1 only after the
complete lease bound. Schema support or the local two-key fixture alone is not
live overlap evidence.

Merge commit `ba4fc9caed566fa39fc66371192fb1821b4232ff` then deployed the
bounded staging edge-profile source as private revision
`control-plane-00010-vop`. Deterministic source SHA-256
`3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e`
was applied by exact saved plan SHA-256
`346dd483045090c31e6bf7da715bfb2d71a3c4672a85aa16aa92992058a71393`.
It preserved the canonical runtime SHA-256, private ingress, IAM and scale and
made no Function request. `EDGE-01` remains open until the separate ingress,
runtime-profile, IAM and rollback operations are digest-bound and preflighted.

## Matrix and evidence boundary

`plan.json` defines `LIVE-01` through `LIVE-12` in dependency order. Together
they cover inventory, real browser attestation, CORS and admission, initial
Chromium state/call flow, same-socket reauthentication across signing-key
activation, no-overlap relay handoff, hostile identity/audience controls,
disconnect and uncertain outcomes, visibility/bfcache/sign-out, Firefox and
WebKit teardown, old-key retirement, and final rollback/cost inventory.

Every case may run once. A future result may contain only stable outcome
classes, bounded counts, durations, public key IDs and revision IDs. It must not
contain an email, raw Firebase UID, token, request or response body, Home
traffic, execution identifier, trace context, HAR, video or WebSocket frame.
The plan's `evidence.state` remains `absent` until a separate exact result
contract validates such an artifact.

## Rollback baseline

Rollback removes the runner route first, stops the browser and coordinator
without replaying physical calls, removes public relay traffic and services,
restores the control plane to internal-only ingress with zero unauthenticated
invokers, deletes every synthetic fixture and temporary grant, and requires
zero-change plans. A prior KMS version is disabled only after its public JWK has
served the full 330-second retirement interval; it is not destroyed. Miakapp 3,
production projects and real Home data are outside this plan.
