# Browser relay scenario fixture cloud adapter

This dormant adapter supplies the second-identity boundary required by the
[`browser-relay-scenario-fixture`](../browser-relay-scenario-fixture/) controller.
It supplements the primary-identity fixture cloud adapter; it never expands that
adapter's fixed UID or Home scope.

Given one explicitly injected ephemeral operator OAuth session and an injected
HTTP implementation, it can:

1. look up only the fixed replacement synthetic Firebase UID and prove it
   absent;
2. fetch the exact staging Firebase Web configuration once;
3. use keyless IAM `signJwt` for one identity-bootstrap custom token;
4. exchange that token to create the replacement identity, bind its ID token to
   the fixed UID with one authenticated account lookup, then discard the ID and
   refresh tokens;
5. sign one distinct Chromium page custom token; and
6. validate and delete only the fixed synthetic replacement profile, then prove
   it absent without retrying an uncertain deletion.

The adapter accepts at most two signatures, six administrative identity
inventories and one token-binding read. Signatures must complete within a
20-minute window; cleanup can still run afterward. HTTP responses are streamed
under a 64 KiB ceiling. Lifecycle operations cannot overlap, and starting
cleanup permanently closes page-token issuance. It has no ambient credential discovery, service
account key, CLI, IAM mutation, Firestore access or persistent credential. Raw
responses and tokens are never part of its closed outputs.

The [custom-token exchange response](https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithCustomToken)
does not guarantee a `localId` field. The adapter checks any supplied `localId`,
but relies on the authenticated [account lookup](https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup)
to bind the returned token to the synthetic UID. An exchange reporting an
existing user never authorizes its deletion.
If preparation fails before the creation exchange is dispatched, cleanup can
confirm absence but cannot delete an identity appearing in the meantime.

This source package grants no mutation or execution authority by itself. It has
not contacted Google or Firebase, and it remains disconnected from the live
operation. The offline Playwright bridge is present, but the Chromium BFCache
capability and independent-observer gates remain open.

Validate it with:

```sh
node infrastructure/staging/browser-relay-scenario-fixture-cloud/guard.mjs \
  infrastructure/staging/browser-relay-scenario-fixture-cloud
```
