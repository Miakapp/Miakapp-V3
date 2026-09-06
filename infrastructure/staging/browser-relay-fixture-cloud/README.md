# Browser-relay fixture cloud adapter

This directory contains the dormant Google/Firebase adapter for the single
synthetic browser-relay fixture. It implements the exact dependency boundary
expected by [`../browser-relay-fixture/`](../browser-relay-fixture/) without
providing a command, ambient credential discovery, scheduling or live execution
authority.

The adapter can be constructed only with an explicitly injected ephemeral
operator OAuth token, HTTP transport, monotonic clock and the two factories from
the pinned MiakAPI coordinator build. Constructing it performs no I/O. The first
mutation remains locked until one complete inventory cycle proves that the
fixed Firebase UID, public Home, private Home, Home Key registry and owner record
are all absent.

## Fixed mutation boundary

One adapter instance permits at most:

- one Firebase custom-auth identity creation;
- one authenticated account lookup to bind the returned ID token to the fixed
  synthetic UID;
- one Home and one `relay:coordinator` Home Key creation through the reviewed
  control-plane edge;
- four IAM `signJwt` calls: the identity bootstrap plus one distinct custom
  token for Chromium, Firefox and WebKit;
- one relay A to relay B patch;
- one atomic Firestore cleanup commit and one Firebase administrative identity
  deletion.

Every HTTP request has a 30-second timeout, a 64 KiB response ceiling, disabled
credential/caching/referrer behavior and zero mutation retries. The Web API key
is fetched from the registered Firebase Web app and retained only in memory.
The refresh token returned during identity creation is validated and discarded.
Revision 2 accepts the documented [custom-token exchange response](https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithCustomToken)
without a `localId` field. Any supplied `localId` must match, and the following
[account lookup](https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup)
must independently return the fixed UID and a synthetic profile before Home
creation. An exchange reporting an existing user cannot authorize cleanup.
Neither can a failed preparation that never dispatched a creation exchange;
cleanup may then confirm absence but never delete subsequently appeared data.
No service-account private key is read or created; JWT signing uses the IAM
Credentials [`signJwt`](https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt)
method.

## Cleanup contract

Cleanup is permitted only after the same adapter observed initial absence and
only after its coordinator wrapper reports zero active sessions. Before any
delete, it re-reads every fixed record and validates exact schemas, ownership,
labels, scopes, routes and registry cardinality. The Home Key record, index,
public Home, private Home and owner documents are deleted in one Firestore
[`commit`](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit),
with the observed `updateTime` attached to every delete as a precondition.

The Firebase UID is then removed through the project-scoped Identity Platform
[`projects.accounts.delete`](https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/delete)
method. An unknown cleanup outcome is observed but never retried by the same
adapter. Success requires a final independent zero-count observation; the
fixture controller performs another observation outside the adapter as well.

## Deliberately absent

- no CLI or executable entry point;
- no import of the global HTTP transport;
- no IAM binding changes;
- no Hosting publication or public-ingress transition;
- no vendored MiakAPI runtime yet;
- no cloud calls or live acceptance evidence.

Run `node guard.mjs infrastructure/staging/browser-relay-fixture-cloud` from the
repository root to verify the closed file and source boundary. The normal
staging validator and offline fault-matrix tests also exercise this package.
