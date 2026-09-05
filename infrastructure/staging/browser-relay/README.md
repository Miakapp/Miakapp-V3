# Staging browser-relay acceptance plan

This directory freezes the first reviewable plan for live browser, relay,
signing-key and rollback acceptance. It contains no Terraform, deployer,
invocation wrapper, credential or result. Reading or validating it authorizes no
cloud mutation. The committed state is `reviewed_not_deployed`, all `LIVE-*`
cases are pending and the canonical staging manifest still records private
control-plane ingress.

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

The immutable cross-repository pins and the readable registered reCAPTCHA
Enterprise App Check provider are satisfied today. Browser attestation itself
remains a live acceptance case. Before any public transition, separate reviewed
implementation must still provide:

1. a production runtime configuration that publishes one active and one
   retiring signing key while selecting exactly one KMS signer;
2. a digest-bound and reversible control-plane ingress transition;
3. two digest-pinned relay services using a keyless no-role identity;
4. a three-engine runner that emits closed semantic counters only;
5. allow-listed metric and billing observations; and
6. a rollback plan that is rendered and checked before the live window opens.

The currently deployed runtime document publishes one signing key,
which makes the routine 60-second prepublication and 330-second retiring-key
retention contract impossible to rehearse honestly. The guarded
`signing-overlap/` package now freezes the one-shot second-version creation and
subsequent 60/330-second rollout, but no signing-key mutation has yet run. The
schema-2 bridge and its
single-key runtime migration are now deployed privately in revision
`control-plane-00006-wid`; the migration changed no effective key and made no
live request. `SIGNING-01` remains open until a separate guard creates and
prepublishes the second key, observes the overlap interval, switches the signer
and retains the prior public key for the complete lease bound. Schema support
or the local two-key fixture is not live overlap evidence.

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
