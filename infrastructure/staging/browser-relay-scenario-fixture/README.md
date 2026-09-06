# Browser relay scenario fixture

This source-only package extends the immutable single-Home fixture controller
for the complete browser-relay acceptance scenario. It keeps the original
controller and Google/Firebase adapter pinned, while requiring an independently
observed second synthetic Firebase identity.

The controller yields exactly four non-reusable in-memory page inputs, in this
order:

1. Chromium with the primary identity;
2. Chromium with the replacement identity;
3. Firefox with the primary identity; and
4. WebKit with the primary identity.

The underlying MiakAPI coordinator is still unique. Its reviewed state-access
configuration is extended from the primary synthetic UID to both exact
synthetic UIDs, but the replacement identity is not permitted to exercise the
fixture function. This gives the later page/Playwright bridge a genuine identity
tuple transition rather than treating a refreshed token as a new identity.

Both identity domains must be observed absent before mutation. Cleanup stops the
coordinator first, attempts both independently bounded cleanup domains, and then
requires both identities plus the original Home ownership cluster to be absent.
Unknown replacement-identity creation outcomes therefore enter cleanup instead
of being retried.

This package deliberately does **not** implement the replacement Google/Firebase
transport yet. That adapter, the 600-second page scenario, Playwright bridge,
independent cloud observers, Hosting publication and live execution remain
closed. The profile grants no cloud mutation, public ingress or live authority.

Validate it with:

```sh
node infrastructure/staging/browser-relay-scenario-fixture/guard.mjs \
  infrastructure/staging/browser-relay-scenario-fixture
```
