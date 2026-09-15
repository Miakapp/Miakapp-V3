# Preserved versus fixed — the v3 Node-RED deployment

Workstream B deliverable 6, for the one installation that currently needs an
adapter: the v3 Node-RED house.

RFC 0003 §18 holds the design-level version of this list, written by reading the
v3 source. Since PR #175 that table is deliberately runtime-agnostic: it says
"source-system callback" and "ordinary configuration" where it used to name
Node-RED. Runtime specifics therefore belong here rather than in the RFC, and
this file is the deployment-specific half of the pair.

Every row is backed by one of two kinds of evidence:

- **observed** — a test in this harness, which runs Node-RED 5.0.7 with
  `node-red-contrib-miakapi@3.0.31` exactly as published;
- **read** — a line in that published package, cited by file and line, pinned by
  `package-lock.json`.

Nothing here is inferred from the v4 model. Where v3's behavior has no migration
decision yet, the row says so instead of inventing one; those rows are collected
in [Open decisions](#open-decisions) and belong to the product owner.

## Preserved

| v3 behavior | Evidence | Miakapp 4 |
|---|---|---|
| The coordinator connection is started by the house and re-established after a drop | read: `miakapi/main.js:121,127`; observed: `notification-and-lifecycle` reconnect test | preserved, with an explicit lifecycle and RFC 0001 full-jitter backoff (RFC 0003 §6) |
| A complete variable view is enough to initialize a client | observed: `variable-commit` full-set test | preserved as declared state plus an authoritative user snapshot (RFC 0003 §7) |
| A notification names its recipients and carries title, body, image, tag | read: `node-red-contrib-miakapi/miakapi.js:194-197`; observed: `notification-and-lifecycle` adminOnly test | intent preserved; delivery waits on the control-plane push-grant contract (RFC 0003 §18) |
| User actions carry element id, type, name and value | read: `miakapi/main.js:94-101` | translated for the comparison window, then fixed as named calls with an authenticated principal (RFC 0003 §14.3) |

## Fixed

| v3 behavior | Evidence | Miakapp 4 |
|---|---|---|
| `coordSecret` is persisted in cleartext, because the node registers no credentials schema and Node-RED therefore writes no `flows_cred.json` at all | observed: `runtime-persistence`, three tests | credential storage and a Home Key token provider (RFC 0003 §5) |
| `allowedGroups: []` allows everyone | observed: `user-action-authorization` empty-list test; read: `miakapi.js:156-160` | **inverted**: an empty explicit ACL is an enrolled user with *no* visibility (RFC 0003 §14.3). See [the inversion](#the-inversion-that-needs-a-migration-check) |
| Group filtering happens only in a Node-RED callback, after the coordinator has already delivered the action | observed: same file; read: `miakapi.js:152-168` | relay metadata plus final coordinator authorization are mandatory (RFC 0003 §18) |
| Every commit sends the whole variable set, never a delta | observed: `variable-commit` full-set test | complete declaration for ownership, then atomic named mutations (RFC 0003 §8) |
| Reconnect is a flat one-second retry with no jitter | read: `miakapi/main.js:121,127` | RFC 0001 full-jitter exponential backoff |
| `HOME`, `variables` and `handlers` live in module scope, one house per Node-RED process | read: `miakapi.js:5-16` | RFC 0003 §14.2: no module-global home, mutable state object or handler registry may be shared between adapter instances |
| Handlers are only ever appended; the package registers no `close` handler for any node type | observed: `redeploy-accumulation`, six tests | idempotent unsubscribe and shutdown cleanup (RFC 0003 §18); RFC 0003 §19 requires an adapter to close cleanly across restarts and redeploys. The measured cost is larger than §18 implies — see [redeploy amplification](#redeploy-amplification-is-quadratic) |
| `npm test` is a manual live script that needs `miakapiCredentials.json` and connects to a real coordinator | read: `miakapi/package.json` `test: node test`, `miakapi/test.js:1-8` | isolated deterministic contract tests |

## Newly observed, not yet in RFC 0003 §18

These come from executing v3 rather than reading it. Each one changes what a
migration has to do.

### Falsy readings are destroyed at the source

`commitVariables` ends every value with `|| ''`:

```js
variables[path] = jsonata(value || '""').evaluate(contexts) || '';   // miakapi.js:81
```

Observed in `variable-commit`: a sensor reading of `0` is committed as `''`. So
are `false`, `null` and an empty counter. The same pattern is on notification
`title`, `body` and `image` (`miakapi.js:194-196`).

This is not a translation problem, and RFC 0003 §14.3's deterministic path
mapping does not solve it. The loss happens **inside v3, before any adapter sees
the data**. In the persisted state, a thermostat reading `0`, a boolean `false`
and a genuinely empty string are the same three bytes. No migration can
distinguish them after the fact.

Consequences for the comparison window: a v4 implementation that correctly
carries `0` as the RFC 0001 integer `0` will **diverge from the v3 oracle by
design**, on every falsy reading. That divergence is v4 being right. The
comparison harness has to be told, or every such reading reports as a fault.

This row has no migration decision yet. See [Open decisions](#open-decisions).

### The inversion that needs a migration check

v3: `allowedGroups: []` means *everyone may act*.
v4: an empty explicit ACL means *nobody may see* (RFC 0003 §14.3).

Same empty list, opposite meaning, and no shape change to make the flip
visible. A mechanical translation that carries the empty list across turns a
door open to the whole house into a door open to no one — or, if the direction
of the mapping is reversed by mistake, silently publishes a permissive rule as a
restrictive one.

The fixture puts this on `serrure-entree`, the front door, deliberately.

### An unresolvable principal fails open on exactly the wrong node

The SDK does not hand the node the uid from the wire. It resolves it first:

```js
user: thisHome.users.find((u) => u.id === data.user),   // main.js:293
```

`thisHome.users` starts empty (`main.js:238`) and is only populated when a
USERLIST packet arrives (`main.js:273`). Any action arriving before that first
USERLIST — on startup, or during the jitter-free one-second reconnect loop —
reaches the node with `user: undefined`.

Observed in `unknown-user-action`, and the two failure modes are not the same:

- a node that **lists groups** dereferences the missing user while deciding, so
  it throws before `node.send` and emits nothing;
- a node with an **empty** `allowedGroups` short-circuits to `allowed = true`,
  calls `node.send({ userAction })`, and only then throws while building its
  status badge (`miakapi.js:163`).

So losing a principal's identity blocks the guarded action and lets the
unguarded one through, effect first. Both end in an uncaught `TypeError`, so
neither is distinguishable from the other by its error alone. In this fixture
the unguarded node is the lock.

Also worth stating plainly: the throw is not contained. `initMiakapi` dispatches
with `handlers.userAction.filter(...).forEach(...)` and `forEach` has no error
boundary, so the first handler that throws ends dispatch for that action. A
second node bound to the same input id never runs, and logs nothing of its own.

Miakapp 4 requirement, not yet written in an RFC: an unresolvable principal MUST
deny, and MUST deny before any effect.

### Redeploy amplification is quadratic

RFC 0003 §18 has "callbacks append forever". Measured, it is worse than append.

Two things accumulate on a full redeploy, because nothing is ever removed:

1. one coordinator client per deploy — `initMiakapi` calls `Miakapi(...)` in its
   constructor (`miakapi.js:25`) and the package has no `close` handler, so the
   previous client is overwritten in module scope while still holding its
   socket;
2. one `handlers.userAction` entry per action node per deploy
   (`miakapi.js:152`), whose closure captures the node object from the
   generation that was destroyed.

Delivery walks both lists, so the effect multiplies rather than adds. Observed
in `redeploy-accumulation`: one press of one button produces **1, then 4, then
9** downstream messages after the first, second and third deploy. After *n*
deploys a single press runs the flow *n²* times.

Two properties make this hard to see from outside:

- every duplicate reports the **same node id**, because the stale closures hold
  node objects from the same flow. It does not look like extra nodes; it looks
  like one node firing repeatedly.
- the coordinator sees the client count grow linearly and **cannot see the
  handler list at all** — it lives inside the node package and never crosses the
  connection. The multiplier is diagnosable only from inside the Node-RED
  process.

For the reference installation this is the most likely explanation available so
far for repeated commands after a busy editing session, and it resets only when
the Node-RED process restarts. It is stated here as a mechanism with a measured
growth law, not as a diagnosis of any particular incident: no production log has
been examined.

## Audit of RFC 0003 §18

Executing v3 found one row that is wrong about v3 itself.

> | application ping every five seconds | removed; RFC 6455 control frames own liveness |

The v3 client never sends an application ping. There is **no `setInterval`
anywhere** in either `miakapi@3.0.31` or `node-red-contrib-miakapi@3.0.31`. The
client is the *responder*: it receives `\x30` PING and answers `\x40`
(`main.js:60-62`). Whatever five-second cadence exists is the coordinator's.

This matters beyond wording. Replacing an application ping with RFC 6455 control
frames is a **coordinator-side** change, and a v3 client pointed at a v4 relay
would sit waiting for a `\x30` that never arrives. The row as written suggests
the client is the thing to change; it is not.

Every other §18 row checked out. Three are accurate but understate the
mechanism, and this file gives the sharper version: the cleartext secret (no
credentials schema at all, so no `flows_cred.json` exists), the appended
callbacks (quadratic, plus a leaked client per deploy), and the group filtering
(also fails open on an unresolvable user).

## Open decisions

These need a product decision. They are listed, not answered.

1. **Falsy coercion.** Does the comparison window treat v3's `''` and v4's `0` /
   `false` as equivalent, or as divergence? Equivalence hides real faults in
   that class; divergence reports every falsy reading in the house as a fault.
   A third option is to declare the affected paths per installation and compare
   only the rest.
2. **Whether any v3 state is trusted at cutover**, given that falsy readings are
   unrecoverable at the source. Re-reading live devices after cutover avoids
   importing the ambiguity, at the cost of a gap.
3. **The empty-ACL inversion.** Whether a mechanical translation is allowed to
   carry an empty `allowedGroups` at all, or whether every action with an empty
   list must be resolved by a human before cutover. There is no safe default:
   both directions are wrong for some houses.
4. **Notification field coercion.** `title`, `body` and `image` take the same
   `|| ''` treatment. Whether an empty title is preserved or rejected at the v4
   boundary is unsettled.

## Running the evidence

```sh
cd node-red-adapter && ./check.sh
```

28 tests, from a clean `npm ci`. No network sockets are opened: the `miakapi`
cloud SDK is replaced at the `require` boundary by the recorder, and the
fixture's MQTT broker is `autoConnect: false`.
