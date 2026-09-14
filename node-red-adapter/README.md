# Node-RED runtime adapter harness

Workstream B deliverables 4 and 5. Runs the **real** Node-RED runtime with the
**real** published MiakAPI v3 node, so claims about v3 behaviour come from
observation instead of from reading its source.

Every other characterization corpus in this repository models v3. This one
executes it.

## What is real, and what is not

| Component | In this harness |
| --- | --- |
| Node-RED | real, 5.0.7, its flow loader, persistence and message router |
| `node-red-contrib-miakapi` | real, 3.0.31, exactly as published to npm |
| The `miakapi` cloud SDK | replaced by a recording stand-in |

The substitution is the reason the harness exists. `initMiakapi` opens a live
connection to the MiakAPI coordinator while the node is being instantiated:

```js
HOME = Miakapi(config.home, config.coordID, config.coordSecret);
```

A harness that left the SDK in place would reach a production service from CI.
So the SDK — and only the SDK — is swapped at the `require('miakapi')`
boundary, leaving the node's own logic under test. `src/sdk-recorder.mjs`
implements exactly the SDK surface the node touches at 3.0.31 and throws on
anything outside it, so a future version that leans on more of the client fails
loudly rather than quietly exercising a stub that no longer resembles the real
thing.

The harness opens no network sockets. The fixture's MQTT broker is set to
`autoConnect: false` for that reason.

## Running it

```bash
./check.sh                      # npm ci + the full suite
npm test                        # the suite alone
npm run capture                 # write a real runtime export to captured/
npm run rehearse                # destroy an environment and restore it, timed
```

Node ≥ 22.9. The dependency tree is pinned by `package-lock.json`; this
directory uses npm rather than bun because its subject is a Node runtime.

## What it establishes

Findings, each pinned by a test:

- **`coordSecret` is stored in cleartext in `flows.json`.** Observed, not
  inferred. `initMiakapi` lists the secret in `defaults` and registers no
  credentials schema, so Node-RED writes **no `flows_cred.json` at all** and the
  coordinator secret sits in the flow file — in every backup, archive and git
  remote that file reaches.
- **A full deploy is persisted verbatim.** Node-RED 5 writes back exactly what
  it was given, in the same order, injecting no node defaults. Hand-authored
  fixtures are therefore structurally faithful stand-ins for runtime exports.
  That was previously an assumption; it is now checkable.
- **`allowedGroups: []` allows everyone.** The v3 handler sets `allowed = true`
  whenever no group is listed. The fixture puts this on a door lock so the stake
  is visible: a guest opens it.
- **The coordinator sees one consumer per event.** `initMiakapi` subscribes once
  per event type and fans out to nodes through its own module-scope handler
  list, however many nodes are listening. So an export without an `initMiakapi`
  node has action nodes that can never fire, and the coordinator cannot tell
  from its side which input ids are actually bound.
- **Falsy readings are committed as `''`.** `commitVariables` ends every value
  with `|| ''`, so a temperature of `0`, a contact of `false` and an empty count
  all arrive at the coordinator as an empty string. This is the most likely
  source of silent divergence when v4 replays v3 state.
- **Every commit sends the whole variable set**, not a delta: the node
  accumulates into one module-scope object and assigns all of it each time.

## Producing a real export

`npm run capture` deploys the synthetic house into a real runtime and saves the
file that runtime persisted, to `captured/` (untracked). Use it to test any
tool that parses `flows.json` against the shape Node-RED actually writes rather
than against a fixture the same author wrote.

Checked against the v4 CLI on the captured export:

```
14 nodes, 1 flow, 1 broker, 3 state paths, 2 actions — 2 findings to settle before migrating
  critical: A coordinator secret is stored in cleartext in this export; ...
  critical: Action serrure-entree lists no group, so every signed-in user may invoke it; ...
```

## One house per process

`miakapi.js` keeps `HOME` and its event handlers in module scope, so a second
deploy in the same process inherits the first one's handlers. `startHouse()`
refuses a second call, and isolation comes from `node --test` running each test
file in its own process. One scenario per file.

## Restore rehearsal

`npm run rehearse` builds a real environment, archives it at three scopes,
destroys it, restores each archive into a path that did not exist, boots it in a
fresh process and compares it against the house that was lost. It runs in CI as
`test/restore-rehearsal.test.mjs`.

Full write-up in [`RESTORE-REHEARSAL.md`](./RESTORE-REHEARSAL.md). The short
version:

- `flows.json` alone restores the house, in **0.4 s** from a 1 KiB archive.
- **Archiving `node_modules` breaks the restore.** A partial npm tree shadows
  the working installation, nothing registers, and Node-RED does not crash —
  `start()` resolves, the flows load, and the runtime waits for types that never
  arrive. A supervisor sees a healthy service with no house behind it.
- A restore that forgets the process environment loses an `env`-typed state path
  silently: the key is set to `undefined` and vanishes in serialisation.
- Time-to-process is not time-to-state. The outgoing variable set starts empty
  on every boot, so state is complete only once every commit node has fired.

## Deliberately not covered

- **No real house.** The fixture is synthetic. No production export or private
  value is part of this corpus, by the same rule as `synthetic-home/`.
- **No live coordinator.** The SDK is recorded, so wire-level behaviour belongs
  to `coordinator-contract/`, not here.
- **No editor.** Flows are deployed through `RED.runtime.flows.setFlows`, the
  same runtime call the admin API makes for a full deploy. Editor-side code in
  `miakapi.html` — the group list widget, the variable table — is not exercised.
