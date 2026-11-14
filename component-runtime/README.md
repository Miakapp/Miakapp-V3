# Miakapp house app runtime

A home's interface is a whole application (`miakapp.app/1`): one self-contained
JavaScript file that owns its document. The shell runs it in a visible iframe
served from a dedicated sandbox site, with an opaque origin and no network, and
talks to it over one message port. See
[`docs/specs/2026-10-03-house-app-abi.md`](../docs/specs/2026-10-03-house-app-abi.md).

## Layout

- `src/contract.ts` — the release pointer, capability requirements and bounded
  structured values.
- `src/artifact.ts`, `src/artifact-cache.ts` — bounded fetch, exact SHA-256
  verification and the content-addressed IndexedDB copy.
- `src/release-state.ts` — the anti-rollback floor and last-known-good pointer.
- `src/app-contract.ts`, `src/app-document.ts`, `src/app-bootstrap.ts`,
  `src/app-host.ts` — the frame protocol, the `/app.html` document and its
  headers, the bootstrap that loads the release inside it, and the host half
  the shell mounts.
- `src/sandbox-document.ts`, `scripts/build-sandbox.ts` — the sandbox site build.
- `fixtures/` — house apps used by the browser tests.

## Run

```sh
cd component-runtime
bun install --frozen-lockfile
bunx playwright install chromium
./check.sh
```

## Deploy the sandbox site

```sh
MIAKAPP_SANDBOX_ORIGIN=https://<sandbox-site> \
MIAKAPP_HOST_ORIGIN=https://<shell-site> \
MIAKAPP_SANDBOX_SITE=<firebase-hosting-site> \
  bun run build:sandbox
firebase deploy --only hosting --config dist-sandbox/firebase.json
```
