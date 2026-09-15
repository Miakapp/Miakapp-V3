# RFC 0007 — Coordinator-qualified names

Date: 2026-09-13

Status: **draft proposal, not accepted**

Target: Miakapp 4

Amends: RFC 0001 (wire protocol). Independent of RFC 0006, which it makes
cheaper.

## 1. Proposal

Every state path, event topic and function name a client sees is prefixed with
the name of the coordinator that owns it:

```
salon.climate.temperature        instead of   climate.temperature
salon.lighting.set                             lighting.set
garage.door.opened                             door.opened
```

The prefix is not decoration. It is the ownership record, the routing table and
the collision-avoidance mechanism, all of which the relay currently maintains as
separate state.

## 2. RFC 0001 already says this is the intent

Section 9, on coordinator generations, closes with:

> Multiple names provide namespace sharding, not concurrent authority over the
> same actuator.

That is exactly this proposal, stated as intent and left to convention. Today
nothing enforces the sharding, so the relay must handle the case where two
coordinators claim the same name. This RFC makes the stated intent structural.

## 3. What it deletes from the relay

The relay currently maintains ownership tables — `topicOwners[topic]`, and the
equivalents for state paths and function routes — and a transactional protocol
built on top of them. From RFC 0001 §7.5:

> The relay acquires the home-scoped activation lock and revalidates the
> complete staged transaction against the current epoch, authorization policy,
> ownership tables, aggregate limits and the full post-activation user views.
> **This final validation is mandatory even when every slice was valid when
> first staged: another coordinator may have activated a colliding name in the
> meantime.**

And §7.4:

> Topic ownership is exclusive; a collision rejects the complete declaration.

Qualified names remove the premise of all of it:

| Today | With qualified names |
| --- | --- |
| Ownership tables for paths, topics and functions | The name **is** the owner |
| Collision detection, error `4409` | Collisions are unrepresentable |
| Home-scoped activation lock, staged revalidation, "two colliding concurrent transactions can both stage" | A declaration transaction is local to one coordinator's subtree |
| Routing a user call to the owning coordinator via a registry | Split on the first dotted segment |
| Union of grants across coordinators | Grants are disjoint by construction |

The five-slice staging protocol does not disappear — a coordinator's own
declaration must still activate atomically — but it stops being **cross-**
coordinator. The home-scoped lock becomes a coordinator-scoped one, and the
mandatory final revalidation against other coordinators' activity has no reason
to exist.

This is the answer to "can we delete the reconciliation work". Yes, and more of
it than the word reconciliation suggests: what goes is an ownership registry, a
collision protocol and a distributed lock.

## 4. What it does not delete

Being explicit, so the relay is not imagined smaller than it will be. Unchanged:

- per-user ACL enforcement for state paths and event topics;
- authenticated, non-spoofable caller metadata on every user-originated call;
- subscription lifecycle, call deadlines, cancellation and terminal states;
- queue limits, slow-consumer shedding, backpressure;
- generations, the 30-second disconnect grace and eviction on re-authentication;
- the dictionary mechanism and its 16,384-path home budget.

## 5. Three things that have to be specified

### 5.1 A coordinator name must be a single dotted segment

RFC 0001 constrains state paths, event topics and function names to 1..256 UTF-8
bytes with no control characters, no `*`, no leading or trailing dot and no
empty dotted segment. It places **no comparable constraint on a coordinator
name**, which is only required to be unique within a home.

A name containing a dot, or empty, would make the qualified name ambiguous or
invalid. Coordinator names must therefore become a closed charset — one dotted
segment, no `.`, no `*`, bounded length — and that is a breaking change to
`HELLO`'s coordinator context. Miakapp 4 is already a breaking release, so the
cost is a validation rule, not a migration path.

### 5.2 Qualification happens once, in the SDK, never in transit

The tempting design is to let coordinators declare short names and have whoever
terminates the user session add the prefix. **Do not do this.** It puts a name
transformation in the relay, and the direct coordinator path of RFC 0006 would
have to implement the same transformation identically — reintroducing, as a
correctness risk, exactly the work this RFC removes.

Instead the qualified name is the wire name. `miakapi` qualifies at its single
declaration boundary, so an author still writes `climate.temperature` in
`CoordinatorConfiguration` and the coordinator declares `salon.climate.temperature`.
ACL patterns are qualified by the same boundary. Nothing downstream ever
rewrites a name: the relay routes, the client concatenates.

### 5.3 Renaming a coordinator is a migration

Because the prefix is part of every name, a rename changes every path, topic and
function a client sees, every ACL pattern, and the `requires` list in any
published component pointer that names them. A rename is already disruptive
today — a new name is a new namespace with its own generation — but this makes
the blast radius explicit and larger. It should be documented as a migration,
not offered as a settings field.

## 6. Consequences worth accepting deliberately

**A user grant can no longer span coordinators in one pattern.** Patterns allow
an exact name or a trailing `.*`; a leading wildcard is forbidden. So "everything
in this home" becomes one pattern per coordinator rather than `*`. That is more
verbose and more honest: a blanket cross-coordinator grant should be written out.

**A component's requirements name their coordinator.** `requires.call` becomes
`["salon.lighting.set"]`. This is an improvement — a component declares which
coordinator it depends on, and a missing coordinator becomes a legible staging
failure rather than a silently absent path. It also means a published artifact
is bound to a coordinator name, which is the second reason renames are migrations.

**Names get longer.** The 256-byte limit is unaffected in practice, and the
16,384-path home dictionary budget counts paths, not bytes.

**The interface must group by coordinator, or hide it well.** A household does
not think in coordinators. `salon.` and `garage.` prefixes are an implementation
fact leaking into names the user may see. The host should render the grouping,
not the prefix.

## 7. Why this composes with RFC 0006

RFC 0006 moves cross-coordinator aggregation from the relay into the client.
That is only cheap if merging is trivial, and merging is only trivial if name
spaces are disjoint. With qualified names the client's merge is concatenation,
and — more importantly — **partial failure becomes expressible**. When the
garage coordinator is unreachable, everything under `garage.` is stale and
everything else is live, and the client can say so precisely because the prefix
identifies the subtree.

Without qualified names, a partially stale unioned map has no honest
presentation. This RFC is what makes RFC 0006's per-coordinator staleness a
property of the data rather than bookkeeping the client has to maintain.

The two are still separable. This one stands alone: it simplifies the relay
today, whether or not local-first ever ships.

## 8. Open questions

- Exact coordinator-name charset and length bound.
- Does `miakapi` reject an unqualified name at the declaration boundary, or
  qualify it silently? Silent qualification is friendlier; rejection makes the
  wire name visible in the source, which matters when debugging an ACL.
- Is there a reserved prefix for home-level names that belong to no coordinator —
  `miakapp.join` is currently unqualified and reserved. It probably stays
  reserved and unqualified, but that must be stated rather than assumed.
- What happens to a component pointer whose `requires` names a coordinator that
  no longer exists? Staging failure is the honest answer, but the failure needs
  a message that names the missing coordinator.
