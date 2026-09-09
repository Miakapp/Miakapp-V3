# Dormant trusted source composition

This package is the closed composition root between seven explicit trusted
source-provider capabilities and the existing claim-bound three-browser
operation. It creates the fixed-target source authorities, then reuses the
unchanged client, session, authority-adapter, authenticated-reader and transport
layers to fill the independent case adapter's exact `sourceObservers` slot.

Import and construction perform no provider, network, browser, cloud or
filesystem-mutation I/O. Calling `execute()` is the only path that constructs the
five-layer source chain and enters the existing operation-case runner. No live
execution is scheduled or performed by this package.

## Provider surface

The factory accepts a frozen map in this exact order:

1. `firebase_app_check`
2. `hosting`
3. `control_plane`
4. `relay`
5. `coordinator`
6. `kms`
7. `firestore`

Every provider is a distinct frozen record containing its exact `source`, exact
staging `scope`, one common absolute `expires_at_milliseconds`, its named fact
methods and `close`. The methods are:

| Source | Named methods |
|---|---|
| App Check | `provider_assessment`, `valid_verification`, `missing_token_denial`, `invalid_token_denial`, `verification_mode` |
| Hosting | `management_site_configuration`, `served_sdk_configuration` |
| Control plane | `cors_preflight`, `foreign_origin_denial`, `source_uid_admission`, `authenticated_cache_policy`, `version_2_jwk_published`, `version_1_last_issuance`, `version_2_first_issuance`, `atomic_credential_reuse`, `exchange_summary`, `version_1_jwk_retained`, `version_1_jwk_removed` |
| Relay | `version_2_existing_socket`, `wrong_audience_denial`, `wrong_home_denial`, `wrong_role_denial`, `unknown_kid_refresh`, `disconnect_reconnect_resync`, `version_2_session`, `revision_summary`, `new_session_version_2` |
| Coordinator | `physical_call_delivery` |
| KMS | `signature_summary`, `version_1_lifecycle` |
| Firestore | `authoritative_route_transition`, `operation_write_summary` |

The method name fixes both source and kind. A method receives only one frozen,
null-prototype, non-serializable `{ browser, case_id, signal }` context and must
return the canonical sanitized observation for that method. It receives no URL,
target descriptor, request capability, operation claim, header map or credential
material. A provider may close over explicit ephemeral live clients and an
operation-local evidence ledger; those remain entirely inside the trusted
provider.

The common provider expiry must be in the future and no more than 30 minutes
from construction. Provider identities are single-composition capabilities.

## Fixed-target receipt boundary

For each of the 22 canonical stage acquisitions and 43 observations, the package
independently revalidates the frozen source-client descriptor against the fixed
target map. It invokes only the named provider method for that canonical kind,
semantically validates the observation and creates the exact receipt expected by
the source client. The target and fresh non-serializable request capability are
echoed only inside that receipt; neither crosses into the provider context or
the final result.

This binding proves that a receipt belongs to the same in-process request. It
does not prove that a trusted provider's semantic claim is true. In particular,
the provider implementation remains responsible for non-consuming App Check
verification and for operation-local evidence where delayed metrics or missing
logs cannot establish an exact fact.

## Operation and lifecycle ownership

```js
const composition = createBrowserRelayTrustedSourceComposition(
  Object.freeze({
    providers,
    operation,
    matrix: Object.freeze({
      fixture,
      openChromiumPage,
      openSecondaryPage,
      prepareChromiumPhase,
      browserLifecycle,
    }),
  }),
  Object.freeze({ signal: operationAbortController.signal }),
);

const result = await composition.execute();
await composition.close();
```

`execute()` is single-use. It supplies the same linked root signal and common
expiry to every source layer, injects the exact seven transport observers into a
new complete matrix and calls the unchanged claim-bound operation. The root
signal also guards every forward operation callback and every edge transition
that could increase exposure; cleanup callbacks and edge transitions back to
canonical-private state remain available after cancellation. The operation
result is returned unchanged.

Each injected observer has one shared close promise. Scheduler cleanup and root
fallback cleanup therefore converge instead of closing an upstream provider
twice. Cleanup ownership advances after every successfully constructed source
layer, so a later factory failure closes the highest complete owner rather than
bypassing intermediate lifecycle state. Root cleanup also closes all providers
if the operation fails before the matrix is entered.

Cleanup dispatch is created before the source callback contexts exist. A
reentrant `close()` request from an operation or provider callback is rejected
immediately to avoid self-deadlock, while terminal cleanup continues through
that independent dispatch. An external `close()` does not resolve until both
source cleanup and the real operation task have settled, including post-matrix
monitoring and rollback. Every finite started callback is drained by the
existing layers before provider references are cleared. Provider errors and
secret-bearing abort reasons collapse to the package's single branded failure.

The selected lifecycle strategy is differential conformance: offline tests
compare this composition with the same five factories assembled manually. The
already reviewed lifecycle implementations remain unchanged.

Same-process providers are trusted. An uncooperative callback can ignore abort
and prevent real settlement; this package does not falsely report release or
claim hard termination. The adjacent
[`browser-relay-trusted-provider-process/`](../browser-relay-trusted-provider-process/)
package now supplies the dedicated-process ownership boundary for a future
self-contained bundle of this graph. This composition remains deliberately
unchanged and cooperative when used directly.

## Deliberately absent

This package contains no OAuth or ADC discovery, Firebase/Google client
construction, HTTP or WebSocket implementation, arbitrary endpoint, browser
launcher, child process, CLI or deployment command. It publishes no Hosting
artifact, changes no ingress or IAM policy, mutates no cloud resource and records
no live source evidence. A concrete digest-pinned owner bundle, trusted live
page/browser providers and the single bounded live matrix execution remain
separate gates.

## Offline validation

```sh
node infrastructure/staging/browser-relay-trusted-source-composition/guard.mjs \
  infrastructure/staging/browser-relay-trusted-source-composition
node --test \
  infrastructure/staging/test/browser-relay-trusted-source-composition.test.mjs
bun run test:staging-manifest
```
