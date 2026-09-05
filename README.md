# Miakapp

Miakapp V4 is an agent-native, privacy-conscious home interface. The repository currently contains the browser host, shared protocol contracts, component runtime, synthetic home, control plane, and reproducible staging infrastructure.

The browser app is an interactive product preview. It deliberately makes no cloud, relay, or real-home connection yet. Its UI is nevertheless rendered through the production `miakapp.component/1` semantic contract: untrusted components cannot inject HTML, CSS, URLs, or credentials into the trusted host.

## Run the browser host

Requirements: Node.js 22.22 or newer and Bun 1.2.23.

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:5173>. Preview interactions are local and reset on refresh.

## Validate browser changes

```sh
bun run check:web
```

This runs ESLint, TypeScript, Vitest, and a production Vite build. The protocol and infrastructure packages have their own checks exposed through the root `package.json`.

The root Firebase alias intentionally remains the untouched Miakapp V3 production project for staging-policy verification. The V4 preview has no hosting target or deploy command; do not run `firebase deploy` from this repository.

## Repository map

- `src/` — React trusted-host shell and closed semantic renderer
- `component-runtime/` — component ABI, broker, and hostile browser corpus
- `protocol/` — cross-language wire protocol
- `coordinator-contract/` — coordinator SDK conformance contract
- `control-plane/` — Firebase control-plane implementation and emulator slice
- `control-plane-contract/` — shared control-plane contract
- `synthetic-home/` — deterministic home fixture
- `infrastructure/` — Terraform and staging safety gates
- `docs/` — RFCs, operating guides, architecture, and roadmap

See [`docs/README.md`](docs/README.md) for the documentation index and current implementation status.
