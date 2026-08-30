# Miakapp coordinator contract

This repository-local conformance package makes the public coordinator and temporary
migration-adapter boundary from [RFC 0003](../docs/rfcs/0003-coordinator-sdk-and-migration.md)
executable before either implementation repository adopts it.

It is a contract kit, not the `miakapi` SDK, a relay client, a Node-RED node, or a
production migration tool. Passing its self-tests proves that the corpus and
runner are internally consistent. A future implementation conforms only after it
is installed as the subject and passes the same scenarios.

## Contents

- `src/api.ts` compiles the normative TypeScript surface used by `miakapi@4`.
- `fixtures/v1/scenarios.json` records stimulus-indexed lifecycle checkpoints and
  promise identities, final declaration handoff, per-slice revision snapshots,
  declaration-promise settlements, reconciliation, operation idempotency keys,
  call-handle terminals, presence and shadow-safety traces.
- `src/contract.ts` validates closed and bounded fixture shapes and rejects unsafe
  retries (including keyed calls), invented readiness, partial or contaminated
  declaration snapshots, lost lifecycle/declaration promises, post-terminal call
  output, or misrouted effects.
- `src/replay.ts` drives any coordinator contract subject with ordered, abortable,
  deadline-bounded stimuli and reports the first exact divergence.
- `src/migration.ts` adapts the existing public synthetic-home replay boundary to
  an effect recorder and a state-publication recorder.
- `test/` proves corpus integrity, replay behavior, fail-closed effects and the
  compiled Node package boundary.

Active timer, listener and iterator counts are deliberately `not_asserted` where
the public contract does not prescribe an implementation architecture. Socket
ownership remains bounded to one managed connection through both a final count and
a scenario high-water mark, and every stopped scenario requires numeric zero for
all owned resource classes.

## Shadow boundary

The public harness exposes no live device or push sink. In `observe`, state
publication fails. In `shadow_state`, state may reach the supplied beta publisher
but callable action paths are outside the mode. In `recorded_action`, device
commands and notification intents must pass through the bounded recorder.

This capability shape catches accidental calls through injected dependencies. It
cannot make arbitrary Node-RED code safe merely by naming it a dry run. A
production-shaped action comparison still requires a terminable process boundary
and structural replacement of every downstream effect adapter.

## Synthetic replay

`createMigrationReplayHarness` wraps a `MigrationAdapterSubject` as the generic
`ReplaySubject` already consumed by `synthetic-home`. In publishing modes, the
wrapper takes final state from the bounded state recorder; it also overwrites the
adapter's claimed commands and notification intents with effect-recorder evidence.
An adapter therefore cannot self-attest either published state or effects.
Each reset creates fresh write-only capability façades. They are revoked before
the observation checkpoint, on abort or failure, and before the next reset, so a
late asynchronous write cannot alter compared evidence or contaminate another
scenario.

Only hand-authored synthetic material belongs in public tests. Do not add an
exported flow, context store, credential, log, real identifier, host, topology,
schedule, notification message or mechanically transformed production artifact.

## Run

From the repository root:

```sh
npm run test:coordinator-contract
```

Or directly:

```sh
./coordinator-contract/check.sh
```

The check builds the synthetic-home dependency, then runs strict type checking,
Bun tests, a declaration build, a Node 22 package-boundary smoke test and the
external-subject CLI smoke test.

## External subjects

Until this contract is released as a package, MiakAPI and the migration adapter
consume it by checking out the full Miakapp-V3 repository at an immutable commit
SHA and recording that SHA in their own dependency lock or CI configuration.
They export a subject factory from a built ESM file:

```js
export async function createCoordinatorContractSubject() {
  return { reset, dispatch, observe };
}
```

The pinned checkout then runs:

```sh
./coordinator-contract/check-external.sh /absolute/path/to/subject.mjs
```

External-subject execution is POSIX-only. On Windows, the Node checker exits
before spawning either the trusted runner or the subject worker. Windows cannot
guarantee runner-owned subtree cleanup when the checker is terminated unless the
processes are contained in a native Job Object, which this portable package does
not install.

The command builds both local contract packages and replays the versioned corpus
against that external module. Consumers never track `main` implicitly. A fixture
schema or public SDK major change requires an explicit pin update; during a major
migration, consumers run the old and new pinned contract checks in parallel until
the old compatibility target is retired.

The checker starts a dedicated trusted runner process, and that runner imports and
executes the subject in a separate untrusted worker process. Only the trusted
runner owns the authenticated checker IPC channel and its completion credential;
the subject worker receives token-free length-prefixed request and response pipes
instead. Worker frames have strict byte, count and closed-message-shape limits
before an observation reaches contract validation. The parent watchdog
force-terminates synchronous hangs during import, factory creation, reset, dispatch
or observation, as well as an overlong complete run.
`MIAKAPP_CONTRACT_STAGE_TIMEOUT_MS` and
`MIAKAPP_CONTRACT_TOTAL_TIMEOUT_MS` may lower or raise the documented bounded
defaults within their enforced maxima. Subject stdout and stderr are also bounded.
After a bounded kill grace, the parent releases its worker pipes and IPC channel,
so even an inherited descriptor cannot pin the checker indefinitely. A descendant
that deliberately detaches from the worker process group is outside cleanup;
external subjects must not spawn such descendants.
Runner completion is authenticated with a supervisor-created per-process token
that never enters the subject process. An early clean exit or a subject-spoofed
worker message is never conformance.
This boundary bounds the checker, but it is not an OS sandbox and cannot revoke
ambient network, filesystem or process capabilities held by the subject.
