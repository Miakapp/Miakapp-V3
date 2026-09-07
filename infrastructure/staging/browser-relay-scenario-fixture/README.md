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

The replacement Google/Firebase transport is now implemented separately in
[`browser-relay-scenario-fixture-cloud`](../browser-relay-scenario-fixture-cloud/).
It requires an explicitly injected ephemeral session and HTTP implementation,
and it remains disconnected from the live operation. The original one-identity
adapter's limit remains explicit; the replacement adapter's profile records
that the second-identity cloud implementation is present. Current dependency
pins follow page revision 3, whose 600-second Chromium budget resolves timing
capacity and whose native lifecycle and typed outcomes are locally implemented.
The real-browser checks prove explicit terminal cleanup before sequential
replacement using offline fakes, then non-persisted native terminal fencing.
They do not prove native completion of asynchronous Firebase cleanup.
Native persisted BFCache restoration remains blocked by pinned Playwright
1.62.1, which explicitly does not support that testing; simulated persisted
unit events are not native proof. The Playwright bridge now closes real
browser-page receipts for the Firefox and WebKit triples and returns a distinct
pre-input Chromium blocker. The complete Chromium page scenario, a
BFCache-capable automation path, independent live source adapters and
aggregator wiring remain open.
Neither package grants cloud mutation, Hosting publication, public ingress or
live execution authority.

Validate it with:

```sh
node infrastructure/staging/browser-relay-scenario-fixture/guard.mjs \
  infrastructure/staging/browser-relay-scenario-fixture
```
