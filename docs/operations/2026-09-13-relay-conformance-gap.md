# Can a second RFC 0001 server be certified today?

Date: 2026-09-13

Status: findings. This is step 1 of RFC 0006 §7, which blocks everything else in
that proposal.

## The question

RFC 0006 proposes that each coordinator can terminate a user session directly,
which means a second implementation of RFC 0001's **server** side, in TypeScript,
beside the Go relay. That is only a sane thing to build if the second
implementation can be shown to behave like the first. So: what can a fresh
server implementation be certified against today?

## RFC 0001 answers its own question

Section 14 lists seven conformance items and then says where each is covered:

> 1. encodes every valid shared fixture to the exact expected bytes;
> 2. decodes those bytes to the expected semantic frame;
> 3. rejects every invalid shared fixture with the expected error class;
> 4. applies the preflight limits before MessagePack container allocation;
> 5. passes malformed-input fuzzing without panic, hang or unbounded allocation;
> 6. enforces direction and connection-state rules in its session layer;
> 7. produces the documented state/call outcomes under disconnect fault tests.
>
> The shared codec harness covers items 1 through 5. **Relay and SDK integration
> tests cover items 6 and 7.**

Items 1–5 are shared. Items 6 and 7 — the session layer and behaviour under
fault, which is exactly what distinguishes a server from a codec — are delegated
to each implementation's own tests. A second implementation therefore has
nothing to be certified against for precisely the two items that matter to it.

## What exists, measured

**`protocol/` — the shared codec harness. Genuinely portable.**

`fixtures/v1/frames.json` holds 52 valid frames covering every opcode, 40
invalid-wire inputs and 22 invalid-semantic inputs. Two independent
implementations — TypeScript on `@msgpack/msgpack`, Go on `vmihailenco/msgpack`
— must reproduce every fixture byte-for-byte and reject the same corpus, and the
Go side adds `FuzzDecodeFrame`. This covers items 1–5 and does it well. The
relay consumes the same module as a pinned dependency, so it is not a parallel
copy.

**`coordinator-contract/` — not relevant to this question.** Its own README is
explicit: "a contract kit, not the `miakapi` SDK, **a relay client**, a Node-RED
node, or a production migration tool." It makes RFC 0003's coordinator-facing
SDK boundary executable, which is a different surface.

**`Miakapp-Server/internal/relay/*_test.go` — 31 tests, 1,679 lines.** This is
where items 6 and 7 actually live, and the coverage is serious:

```
TestDeclarationCollisionNeverPublishesAStagedPrefix
TestConcurrentCollidingActivationsHaveExactlyOneWinner
TestCoordinatorDisconnectGraceRetainsThenAtomicallyPurgesState
TestCoordinatorReplacementTerminatesInflightCallsAndFencesEffects
TestReauthenticationCannotChangePrincipal
TestLateCallResultRemainsDiscardedBeyondThePreviousWindow
TestProtectedQueueEntryEvictsOnlyDroppableStreamData
TestAggregateOutboundQueueBudgetIsSharedAcrossConnections
…
```

The whole suite runs in 6 seconds.

## The finding that changes the shape of the work

**Those tests are already black-box over a real WebSocket.** They stand up the
server with `httptest.NewServer`, dial it with `websocket.Dial`, send real
`HELLO` frames and assert on received opcodes:

```go
_, httpServer := newTestServer(t, nil)
first := connectPeer(t, httpServer)
first.send(t, hello(auth.RoleCoordinator, "coordinator-token", []any{"automation"}))
first.receive(t, protocol.OpcodeWelcome)
first.receive(t, protocol.OpcodePresenceSnapshot)
```

Nothing here reaches into internal types. Each test *is* a sequence of frames in
and expected frames out — which is to say, **the scenarios are portable in
principle and only the encoding is not.** They are Go source, not data.

So the work is not "design a relay conformance suite". It is **extract the
corpus that already exists**, exactly as `protocol/fixtures/v1/frames.json` did
for the codec, and write a runner that drives any implementation over a socket.
The Go relay becomes the first subject and validates the extraction by
continuing to pass; a TypeScript endpoint becomes the second.

That is a far smaller and more credible undertaking than inventing the
behavioural corpus from the RFC text, and it carries the reviewed judgement
already embedded in those 31 tests instead of re-deriving it.

## Two things a shared corpus needs that the codec corpus did not

1. **A test-mode authentication contract.** The tests use `fixtureVerifier{}`
   and tokens like `"coordinator-token"`. A shared corpus must define how any
   implementation accepts the same fixture credentials without weakening its
   production verifier.
2. **A declared configuration profile per scenario.** `newTestServer(t, mutate
   func(*config.Config))` lets a test tune limits — admission ceilings, queue
   budgets. The corpus has to state the profile a scenario assumes, rather than
   depend on one implementation's config struct.

Neither is hard. Both have to be decided before the first scenario is written,
because retrofitting them means rewriting the corpus.

## Gaps found in the relay's own suite

Worth recording separately, because they hold whether or not RFC 0006 proceeds.
These are indications from targeted searching, not a line-by-line audit:

- **`codeUnexpectedFrame` (1002) appears to be untested.** The implementation
  raises it in at least four places — `state.go`, `declarations.go`, `home.go` —
  and no test file references the constant. That is RFC §14 item 6, the item the
  RFC explicitly delegates to relay integration tests. If a test exercises it, it
  does so indirectly through a close code.
- **`GOAWAY` and draining appear untested.** Both live in `connection.go`; no
  test names either, and §12's close sequence is normative.
- **Version negotiation appears thin.** §6 requires the relay to choose the
  highest minor in the client's inclusive range and to answer
  `UNSUPPORTED_VERSION` when there is no overlap. Searching finds one mention of
  the error and none of the range logic.

A precise per-requirement audit is the first task of the extraction, and these
three are where I would start.

## Verdict on RFC 0006 step 1

**The vectors are not sufficient, and the reason is encoding rather than
absence.** A fresh RFC 0001 server can today be certified as a codec and as
nothing else. The behavioural knowledge exists, is good, and is trapped in one
language.

Step 1 of RFC 0006 §7 should therefore read: extract the 31 relay scenarios into
a language-neutral corpus with a runner, close the three gaps above, and
re-certify the Go relay against the result. Until that is done, a second server
implementation would be a good-faith guess, which is not an acceptable thing to
put in someone's house.

It is also worth doing on its own merits. Today the relay is correct because it
was written carefully, not because a portable suite demonstrates it.
