# Miakapp synthetic-home conformance fixture

This directory contains a deterministic, public oracle for Miakapp migration
work. It describes a deliberately fictional home and replayable behavior
classes without copying a production export, topology, identifier, value,
schedule, host name, URL, user count, device model, or automation rule.

The fixture is hand-authored from a generic behavior taxonomy. It is not an
anonymized Node-RED flow and cannot be used to reconstruct the reference
installation.

## Layout

- `fixtures/v1/manifest.json` records the format version, fixed clock, seed,
  provenance declaration, and required coverage.
- `fixtures/v1/home.json` declares fictional actors, groups, zones, devices,
  state paths, actions, notification intents, lifecycle signals, and initial
  state and persisted context.
- `fixtures/v1/scenarios.json` provides independent replay capsules with a
  starting state, stimulus, and exact expected observation.
- `src/contract.ts` validates exact, bounded fixture shapes.
- `src/corpus.ts` loads the corpus and verifies references and coverage.
- `src/replay.ts` compares any future adapter or coordinator implementation
  against the corpus without prescribing its internals. The build emits a
  Node-compatible ESM module and declarations under `dist/`.
- `src/privacy.ts` rejects common classes of material that must never enter a
  public fixture.
- `test/` proves fixture integrity, deterministic replay, divergence reporting,
  and privacy checks.

## Replay model

Every scenario is isolated. A subject receives the fictional home, a scenario
setup, a fixed clock, and one ordered stimulus list. It returns its complete
final state and context together with recorded device commands, notification
intents, lifecycle signals, and operation outcomes. The runner derives the
expected final snapshot itself, so protected unchanged paths are not
self-attested by the subject.

Every recorded command declares whether it was caused by an operation or by a
specific non-action stimulus. Action commands must use operation provenance;
denied-only action scenarios cannot contain side effects. Each asynchronous
replay hook receives an `AbortSignal` and has a five-second deadline by default.
Consumers can choose a shorter deadline or supply a parent cancellation signal.
Synchronous untrusted adapter code still belongs behind a terminable worker or
process boundary because an in-process JavaScript deadline cannot preempt it.

Device commands are records only. The fixture runner has no network, MQTT,
GPIO, Node-RED deployment, Firebase, or push-delivery integration.

## Privacy boundary

Only hand-authored synthetic material belongs here. In particular, do not add:

- exported flows, credentials, persisted context, traces, backups, or logs;
- production names, labels, paths, topics, identifiers, schedules, counts, or
  notification text;
- network addresses, coordinates, hardware identifiers, private host names, or
  tokens;
- a mechanically transformed or pseudonymized production artifact.

The automated privacy scan is defense in depth, not proof of anonymity. New
fixtures still require human review against this boundary.

## Run

From the repository root:

```sh
npm run test:synthetic-home
```

Or directly. This also compiles and executes the public package boundary with
Node 22:

```sh
./synthetic-home/check.sh
```

The package remains private while the migration adapter is still unimplemented,
but its exported boundary is compiled Node-compatible ESM rather than Bun-only
TypeScript source.

## Boundary

This corpus closes the sanitized synthetic-fixture action only. It does not yet
implement the MiakAPI 3.5 surface, the temporary Node-RED shadow adapter,
production comparison, backup/restore rehearsal, or platform push contract.
Those consumers must adapt to this replay API without importing private data.
The `concurrent_action` capsule models the deterministic busy guard observed by
a second action while an earlier operation is in flight; atomic simultaneous
dispatch belongs in the future Node-RED adapter harness.
