# Pinned MiakAPI fixture binding

This directory contains the dormant Node binding between the synthetic
browser-relay fixture and the exact MiakAPI coordinator implementation. It does
not expose a command or start a coordinator. Its two-function surface can only
be constructed with an explicitly injected HTTP transport.

The vendored ESM bundle is generated from MiakAPI commit
`a798a746847ba3d5c16128a08b33353269e770a4` with Bun 1.2.23 and Node 22.22.0.
Its source archive, package, lock file, entry point, generated bundle and ISC
license are independently pinned by SHA-256. From that exact clean checkout the
committed bundle reproduces with:

```sh
bun install --frozen-lockfile
bun run build
bun build dist/index.js --target node --format esm --minify --sourcemap=none --outfile miakapi-node-v4.mjs
```

## Closed factory surface

`createPinnedMiakApiFixtureFactories({ fetch })` returns only:

- `createHomeKeyAccessTokenProvider`, which accepts the fixed staging exchange
  endpoint and one canonical Home Key exactly once, and always passes the
  injected transport into MiakAPI so its global fallback is unreachable;
- `createCoordinator`, which accepts only the provider returned above and the
  fixed synthetic coordinator name exactly once.

Factory construction and coordinator construction perform no network request.
The Home Key stays within the pinned provider closure and never reaches the
coordinator's WebSocket layer. Raw MiakAPI failures are collapsed at the
binding boundary.

## Deliberately absent

- no CLI, scheduler or ambient credential discovery;
- no package-registry lookup at runtime;
- no Hosting, IAM or public-ingress mutation;
- no coordinator start and no live HTTP or WebSocket request;
- no acceptance result or live-execution authority.

Run `node guard.mjs infrastructure/staging/browser-relay-fixture-miakapi` from
the repository root to verify the closed source and vendor inventory. The
normal staging validator also executes an offline provider exchange against an
in-memory transport.
