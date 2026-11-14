# Miakapp control plane

Identity, homes, Home Keys, agent pairing, push, artifact publication and
admission budgets ([RFC 0004](../docs/rfcs/0004-platform-control-plane.md)).

It runs self-hosted: `src/self-hosted-server.ts` is the entrypoint, built with
`tsc -p tsconfig.build.json` (or the `Dockerfile`). Firebase Auth, App Check and
Firestore stay on the free tier. The staging deployment is described in
[`../infrastructure/dac/`](../infrastructure/dac/).

## Check

Requires Bun 1.2.23, Node.js 22.12+ and Java 21 (Firestore emulator).

```sh
./control-plane/check.sh
```
