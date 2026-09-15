# Timed restore rehearsal — local coordinator environment

Workstream B, deliverable 5.

This is a rehearsal, not a procedure: every statement below was produced by
running `node bin/restore-rehearsal.mjs`, which destroys a real Node-RED
environment and brings it back. The rehearsal runs in CI as
`test/restore-rehearsal.test.mjs`, so the findings cannot quietly stop being
true.

## What is being restored

"Local coordinator environment" is the Node-RED installation that runs the
house. It is not the MiakAPI coordinator service, which is the far side of the
connection and restores nothing on its own.

It has two layers, and they come back by different routes:

| Layer | Contents | How it is recovered |
| --- | --- | --- |
| installation | Node-RED 5.0.7, `node-red-contrib-miakapi@3.0.31`, their dependencies | reinstalled from `package-lock.json`; derivable, so not backed up |
| user directory | `flows.json` and the runtime's own files | restored from the archive; irreplaceable |

The rehearsal restores the second onto the first, which is the order an operator
works in after losing a machine: rebuild the box, then restore the house.

## The environment, as the runtime leaves it

Observed after one full deploy of `fixtures/synthetic-house.flows.json`.

| Path | Size | In a backup | What it is |
| --- | --- | --- | --- |
| `flows.json` | 2.4 KiB | required | the house, and for this package the coordinator credentials in cleartext |
| `flows_cred.json` | absent | required in general | this package registers no credentials schema, so Node-RED writes no such file |
| `package.json` | 120 B | harmless | Node-RED's project scaffold; carries **no dependencies**, so it names no installed node package |
| `.config.nodes.json` | 18 KiB | harmless | the only local record of what is installed and at which version; holds absolute paths, rewritten on boot |
| `.config.runtime.json` | 40 B | harmless | the runtime instance id |
| `lib/` | 0 B | harmless | editor library |
| `node_modules/` | — | **harmful** | see below |

Two consequences fall out of that table before anything is restored.

The environment does not record its own dependencies. `package.json` is
Node-RED's untouched scaffold with no `dependencies` key, so nothing in the user
directory tells a future operator to install `node-red-contrib-miakapi@3.0.31`.
Only `.config.nodes.json` carries the name and version, as a cache the runtime
rewrites rather than as a manifest anyone maintains.

The backup is a secret. `coordSecret` sits in cleartext in `flows.json`
(characterized in `PRESERVED-VS-FIXED.md`), and there is no encrypted credentials
file to separate. Any copy of this archive is a copy of the house's coordinator
credentials, so it needs the handling of a credential and not of a config file.

## Measured run

Machine: 8 cores, Node v22.23.2, Linux 6.8.0. Times vary; the ratios do not.

| Step | Elapsed |
| --- | --- |
| archive `flows.json` (1 KiB) | 2.2 ms |
| archive user directory without `node_modules` (2.4 KiB) | 2.2 ms |
| destroy the environment | 0.7 ms |
| unpack | 1.7 ms |
| boot to a house answering the coordinator | 350 ms |
| **restore, end to end** | **0.4 s** |

Add the time to rebuild the installation, which the rehearsal does not measure
because it is an `npm ci` against a lockfile and depends entirely on the network
and cache, not on the house.

The number worth quoting to an operator is therefore: **once the box is
rebuilt, the house is back in under a second, and the archive is a kilobyte.**
That is the whole reason to state it — nobody will skip a backup this cheap for
cost reasons, so a missing backup here is never an economic decision.

## What the rehearsal found

### 1. `flows.json` alone is enough, and the rest of the user directory changes nothing

The restored house was indistinguishable from the one destroyed across every
field the rehearsal compares: registered node types, the coordinator connection
and its credentials, which nodes delivered which messages, the push notification
that the lock fires, the committed variable set, the persisted flow digest and
the deployed node ids.

Restoring the rest of the user directory as well produced the identical result.
`.config.nodes.json` is a cache: it came back with absolute paths pointing at
the destroyed directory, and the runtime rewrote them on boot without complaint.

### 2. Archiving `node_modules` destroys the restore instead of protecting it

This is the finding that inverts the intuition, and it is why this is a
rehearsal rather than a runbook. The cautious backup — the one that takes
everything, on the reasoning that more is safer — is the only one that failed.

A partial copy of an npm tree shadows the working installation. Node-RED logs it
plainly and then carries on:

```
Module: node-red-contrib-miakapi 3.0.31 <restored userDir>/node_modules/node-red-contrib-miakapi
! Module: node-red-contrib-miakapi 3.0.31 <installation>/node_modules/... *ignored due to local copy*
[warn] [node-red-contrib-miakapi/miakapi] Error: Cannot find module 'jsonata'
```

The archived package directory contains the package and none of its
dependencies, because in the live environment those resolve from the parent tree
that the archive did not include. The local copy wins, cannot load, and all nine
node types fail to register.

Cause confirmed by repair rather than by reading the message: copying `jsonata`
alone into the restored `node_modules` brought the same environment back with
nine registered types and a byte-identical commit.

**The dangerous half is the failure mode, not the failure.** Node-RED does not
crash. `RED.start()` resolves, the flow revision loads, the runtime reports
`Waiting for missing types to be registered` and settles into a state where it
holds the flows and instantiates nothing. There is no non-zero exit, no thrown
error and nothing a process supervisor would restart. An operator watching the
machine sees a healthy service. The house is simply not there — no automation
runs, no action is honoured, and the coordinator sees a client that never
connects.

The rehearsal only detects it because it waits for the nodes to exist and gives
up. That is the check a restore procedure needs: **after restoring, assert that
the expected node types are registered.** Service liveness proves nothing here.

### 3. A restore that forgets the process environment loses a state path in silence

`commitVariables` supports values of type `env`, read from `process.env` at
commit time with no fallback. Nothing in the user directory records that the
house needs those variables, so a restore onto a bare shell is easy to do.

Restored without `HOUSE_VERSION`, the house booted, connected, honoured both
user actions and sent the lock notification. One thing changed: the variable set
the coordinator received went from three paths to two.

The mechanism is worth stating exactly, because it produces no error at any
layer. `variables['systeme.version']` is assigned `undefined`; the key is
present in the object the node built, and disappears when the set is serialised
on the way to the coordinator. Combined with the characterized behavior that
every commit sends the whole set rather than a delta, a coordinator treating a
commit as the house's complete state has been told that path no longer exists.

So the environment variables a house reads are part of the environment to be
restored, and no file in the user directory lists them.

### 4. Restoring the process is not restoring the house

The 0.4 s above is time-to-process. Time-to-state is a different quantity, and
the runtime never reports it.

The v3 node keeps its outgoing variable set in a module level object that starts
empty on every boot, and each `commitVariables` node writes only its own paths
before the whole set is sent. Measured in `test/state-recovery.test.mjs` with two
independent commit nodes: after a restart, the first commit carries only the
paths of the node that happened to fire first. The other path is absent — not
stale, not null, absent.

State is therefore complete only once **every** commit node has fired at least
once, which is bounded below by the slowest trigger in the house. A boiler that
reports every fifteen minutes sets the recovery time for its own path, and a
node that only fires on an event may not report until that event happens.

For the migration this matters twice over: a v4 comparison run started too soon
after a v3 restart reads an oracle that is still filling in, and the divergence
it records is an artifact of the restart rather than a difference between the
implementations.

## Restore procedure this rehearsal supports

1. Rebuild the installation from `package-lock.json`. Do not restore it.
2. Restore `flows.json` and, if the installation has credential-bearing nodes,
   `flows_cred.json` with the key that encrypted it. Nothing else is needed.
3. Do not restore `node_modules`. If an archive contains it, exclude it on
   extraction.
4. Restore the process environment the house reads. Nothing in the user
   directory lists it; it has to be recorded separately.
5. Start the runtime, then **assert the expected node types are registered.** A
   started process is not evidence of a restored house.
6. Treat state as recovered only once every commit path has been seen at the
   coordinator, not when the process comes up.

Steps 3, 4 and 5 exist because the rehearsal produced the failures they prevent.

## Limits

The house is the synthetic fixture, not a real installation. Its shape is
faithful — Node-RED persists a deploy verbatim, which is what makes a
hand-authored fixture a structurally honest stand-in — but a real house has more
node packages, and every additional package widens finding 2.

The installation layer is rebuilt from a lockfile that this repository owns. A
real installation of the reference house was not available, so the claim that
rebuilding it is straightforward is untested there; if it is a hand-assembled
machine with globally installed packages and no lockfile, that layer is the
long pole and this rehearsal does not measure it.

The rehearsal restores onto the same machine. It does not cover moving to
different hardware, a different Node major or a different architecture.
