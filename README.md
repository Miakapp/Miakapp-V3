# Miakapp

Miakapp V4 is an agent-native, privacy-conscious home interface. The repository currently contains the browser host, shared protocol contracts, component runtime, synthetic home, control plane, and reproducible staging infrastructure.

The browser app is an interactive product preview by default and a staging client
when explicitly built in live mode. Its UI is rendered through the production
`miakapp.component/1` semantic contract: untrusted components cannot inject
HTML, CSS, URLs, or credentials into the trusted host.

The latest `main` preview is published at
<https://miakapp.github.io/Miakapp-V3/>. It uses fictional local data and is safe
to explore without an account or Home connection.

## Run the browser host

Requirements: Node.js 22.22 or newer and Bun 1.2.23.

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:5173>. Preview interactions are local and reset on refresh.

The browser host has two explicit modes:

- no `VITE_MIAKAPP_MODE` (default) — fictional, local-only product preview;
- `VITE_MIAKAPP_MODE=live` — Firebase Auth + App Check → control plane →
  selected relay → Bun coordinator through `miakapi/browser`.

The live host presents each physical call as an accessible state machine:
pending, coordinator-accepted, applied, failed, or outcome unknown. A stale relay
snapshot is shown explicitly and disables physical controls instead of rendering
its values as current.

The committed `.env.staging` contains only the public Firebase web identity,
public App Check site key, and non-secret staging routes. Use
`.env.staging.example` when adapting the host to another environment. Home Keys
and relay access tokens must never be added to a Vite environment variable or
browser bundle.

The V4 staging host has a separate Firebase configuration so the legacy root
hosting target cannot be selected accidentally. A deployment additionally
requires an exact confirmation:

```sh
MIAKAPP_STAGING_DEPLOY_CONFIRMATION=deploy-browser-host:miakapp-v4-staging \
  ./scripts/deploy-staging.sh
```

## Start and stop the staging home

The staging home is not free to leave running, and the reason is not the
obvious one. Measured on 2026-09-14:

| Service | minimum | billable seconds |
| --- | --- | --- |
| `miakapp-staging-coordinator` | 1 | 86 321 (~24 h) |
| `miakapp-staging-relay-a` | 0 | 86 307 (~24 h) |
| `miakapp-staging-relay-b` | 0 | 0 |
| `control-plane` | 0 | 242 |

The coordinator is billed because its minimum pins one instance. The relay is
billed because the coordinator holds an outbound WebSocket to it, and Cloud Run
bills an instance with an open connection as active whatever its minimum says.
Two vCPU-days for one idle home. `relay-b` is configured identically and costs
nothing, which is what identifies the socket rather than the configuration as
the cause — reading `min = 0` and concluding "free" is the mistake this table
exists to prevent.

So the staging home is a session, not a deployment:

```sh
bun scripts/staging-home.ts status

MIAKAPP_STAGING_HOME_CONFIRMATION=start-billing:miakapp-v4-staging \
  bun scripts/staging-home.ts up --apply
# ... run the session ...
bun scripts/staging-home.ts down --apply
```

`up` and `down` print the exact request and change nothing without `--apply`.
`status` is read-only and reports the live instance count next to the minimum,
because those two disagree whenever a socket is open. Starting needs an explicit
confirmation and stopping does not: a wrong `down` costs a restart, a wrong `up`
bills silently until somebody notices.

## Validate browser changes

```sh
bun run check:web
```

This runs ESLint, TypeScript, Vitest, and a production Vite build. The protocol and infrastructure packages have their own checks exposed through the root `package.json`.

The root Firebase alias intentionally remains the untouched Miakapp V3
production project for staging-policy verification. The fictional public
preview is deployed only through the GitHub Pages workflow. Deploy the live V4
host only through the guarded staging script above; do not run a bare
`firebase deploy` from this repository.

## Repository map

- `src/` — React trusted-host shell and closed semantic renderer
- `component-runtime/` — component ABI, broker, and hostile browser corpus
- `protocol/` — cross-language wire protocol
- `coordinator-contract/` — coordinator SDK conformance contract
- `control-plane/` — Firebase control-plane implementation and emulator slice
- `control-plane-contract/` — shared control-plane contract
- `synthetic-home/` — deterministic home fixture
- `node-red-adapter/` — the published v3 node under a real Node-RED runtime
- `infrastructure/` — Terraform and staging safety gates
- `docs/` — RFCs, operating guides, architecture, and roadmap

See [`docs/README.md`](docs/README.md) for the documentation index and current implementation status.
