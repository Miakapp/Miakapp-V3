# Miakapp protocol conformance

This directory contains the executable contract for
[`RFC 0001`](../docs/rfcs/0001-wire-protocol.md).

## Layout

- `fixtures/v1/frames.json` is the language-neutral source of valid binary
  frames, malformed inputs and semantic failures.
- `typescript/` contains the Bun/TypeScript implementation using
  `@msgpack/msgpack` 3.1.3 after a bounded canonical preflight scan.
- `go/` contains an independent Go implementation using
  `vmihailenco/msgpack/v5` 5.4.1 after its own preflight scan.

Both encoders are independent and must reproduce every fixture byte-for-byte.
Both decoders reject the same invalid corpus before returning an application
frame. The Go decoder normalizes every accepted integer width to `int64`; the
wire profile guarantees that every integer fits exactly.

## Run

From the repository root:

```sh
npm run test:protocol
```

Or directly:

```sh
./protocol/check.sh
```

The normal check runs TypeScript type checking and tests, verifies Go formatting,
and runs all Go tests. The Go fuzz target can be exercised separately:

```sh
cd protocol/go
go test -run '^$' -fuzz '^FuzzDecodeFrame$' -fuzztime=30s
```

## Boundary

This is a codec and frame-shape harness, not the production relay or SDK. It
closes the byte-contract gate. Connection direction, authentication, ownership,
queueing and disconnect behavior remain integration responsibilities and are
tested again in the relay/SDK vertical slice.
