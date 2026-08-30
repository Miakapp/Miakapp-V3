# Miakapp component-runtime contract

This directory is the executable architectural proof for
[`RFC 0002`](../docs/rfcs/0002-component-runtime.md).

## What the reference harness proves

The authenticated host never executes home code. It transfers verified bytes to
a fixed broker in a hidden cross-site iframe with an opaque sandbox origin and a
deny-by-default CSP. The broker verifies and parses the bytes again, runs a fixed
confinement prelude, and starts the guest in a separate lexical scope inside a
classic Dedicated Worker. It
retains the host capability port, validates and bounds guest messages, and
forwards only a semantic UI tree or named operations. A prelude-owned watchdog
can terminate a Worker whose event loop stops responding.
The trusted host validates the tree again and renders native DOM controls without
HTML, CSS, URL, or property-bag injection.

The browser corpus runs the same broker and headers in Chromium, Firefox, and
WebKit. It includes valid, tampered, declaration-shadowing, egress,
invalid-tree, sparse-array, undeclared-capability, duplicate-load, lifecycle,
message-flood, and pre/post-activation infinite-loop bundles. Tests observe
actual probe requests; rejected promises or CSP console messages are not treated
as sufficient evidence.

## Layout

- `src/contract.ts` defines the framework-neutral pointer, capability, envelope,
  and semantic-tree validators.
- `src/artifact.ts` implements bounded fetch and exact SHA-256 verification.
- `src/runtime-broker.ts` is the fixed opaque broker used by the proof.
- `src/host-harness.ts` is a trusted host and safe semantic renderer for tests.
- `fixtures/` contains auditable home-bundle inputs, including hostile bundles.
- `test/contract.test.ts` covers schemas, limits, and byte verification.
- `test/runtime.spec.ts` exercises the real browser boundary.

This is an architectural boundary subset, not the production React host,
Firebase artifact-delivery path, generated-component SDK, dual-release activator,
or complete RFC conformance suite. It supports the architecture selection and
leaves those production concerns behind the accepted ABI and explicit exit gate.

## Run

Install Bun 1.2.23 and the pinned Playwright browsers once:

```sh
cd component-runtime
bun install --frozen-lockfile
bunx playwright install chromium firefox webkit
```

Then run the complete contract:

```sh
./check.sh
```

Unit and browser checks can be run separately:

```sh
cd component-runtime
bun run typecheck
bun run test:unit
bun run test:browser
```

## Boundary

Passing this harness demonstrates the selected browser primitives and the tested
protocol subset. A production implementation still has to fetch real Firebase
artifacts, use the exact production headers and attributes, connect to RFC 0001
sessions, enforce publisher authorization, stage and atomically swap two
releases, reconcile the full React design system, handle visibility/BFCache, and
pass every conformance item in RFC 0002 Section 18.
