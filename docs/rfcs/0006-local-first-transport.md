# RFC 0006 — Local-first transport

Date: 2026-09-13

Status: **draft proposal, not accepted**

Target: Miakapp 4

Depends on: RFC 0001 (wire protocol), RFC 0004 (control plane), RFC 0005
(browser client SDK)

## 1. Goal

A device on the same network as a home's coordinators talks to them directly.
The relay stays the path for everything else. When the home's internet link is
cut, the house remains operable from inside it.

This is worth doing for three reasons, in order of how much they matter:

1. **Availability.** A home automation system that stops working because a fibre
   was cut in the street is not a home automation system.
2. **Latency.** A LAN round trip replaces a round trip to a cloud region.
3. **Confidentiality.** A direct session is the only configuration in which the
   relay operator does not see the home's traffic. Roadmap §3.1 is explicit that
   self-hosting the relay is not end-to-end encryption; a direct session is a
   narrower and more honest claim, and it holds only while the session is direct.

## 2. Invariants this proposal must not break

- **Coordinators never talk to each other.** Aggregation across coordinators is
  the client's job, not a mesh.
- **Partial local reachability is the normal case, not an error.** Two
  coordinators reachable on the LAN and one only through the relay is a
  supported, unremarkable state.
- **The coordinator remains the only membership and authorization authority**
  (roadmap §3.3). Nothing here moves authorization to the client.
- **The relay stays platform-untrusted** and gains no new secret.
- **No product claim of end-to-end confidentiality** for the relay path.

## 3. The change in one sentence

Today the relay is the aggregator: one user socket fans out to N coordinators,
and `WELCOME` carries the union. Local-first makes the **client** the
aggregator, holding one session per coordinator, each over whichever transport
is currently best.

Everything else in this document follows from that sentence.

## 4. Four decisions

### 4.1 Identity: the coordinator verifies the same kind of token the relay does

The relay already verifies the browser's credential **without contacting
Firebase on the hot path**: RFC 0004 §11.3 pins the control-plane issuer, an
exact audience, and a bounded JWKS cache. That is ordinary offline JWS
verification, and a TypeScript coordinator can do it with the same rules.

Two gaps:

- **Audience.** The user token's audience is derived from
  `controlHomes/{homeId}.relay_url`, and §11.2 requires the browser to use that
  token only with that URL. A direct session needs a distinct audience. Proposal:
  the control plane issues a second profile bound to a **coordinator identity**,
  not a URL — LAN addresses move, coordinator identity does not.
- **Offline issuance.** The lease is five minutes and the issuer is a Firebase
  Function. A feature whose purpose is surviving the cloud being unreachable
  cannot depend on the cloud to start a session.

### 4.2 Offline credentials: device-bound, coordinator-issued, provisioned while online

While the internet is up and the user is already authenticated through the
normal relay path, each coordinator issues that user a **local session
certificate** for this device, delivered over the authenticated relay session.

The browser generates a non-extractable `ECDSA P-256` key pair via WebCrypto and
stores the `CryptoKey` in IndexedDB. The coordinator signs a short certificate
over the public key, the user ID and an expiry. Offline, the client proves
possession of the private key; the coordinator verifies its own signature. No
platform dependency, no bearer token at rest.

Why this shape:

- The coordinator is already the membership authority, so no new trust root is
  introduced and **revocation is local and immediate**.
- A non-extractable key is not exfiltrable by XSS, unlike a stored bearer token.
  RFC 0004 §11.3 forbids persisting relay tokens in browser storage; this is a
  different credential class and needs its own explicit rule rather than an
  exception to that one.
- Re-issued on every successful online session, so the practical exposure window
  is the time since the device last saw the home, not the certificate lifetime.

Open: certificate lifetime, and whether an unenrolled user may hold one at all.

### 4.3 Transport: this is the hard part, and it is not a detail

The web app is served over HTTPS. A browser refuses `ws://192.168.1.x` from an
HTTPS page as mixed content, and `wss://192.168.1.x` requires a certificate
valid for that name. There is no way around this from page JavaScript.

Two workable answers:

**(A) Public DNS name pointing at a private address, with a real certificate.**
`<coordinator-id>.local.miakapp.app` resolves to the coordinator's LAN address;
the coordinator holds a Let's Encrypt certificate obtained through DNS-01, with
the platform delegating or brokering the challenge. This is the proven path:
Plex (`*.plex.direct`), Home Assistant Cloud and UniFi all ship variants of it.

Its honest limitation: **resolving a public name needs a resolver.** With the
WAN link physically cut and no cached DNS answer, the name does not resolve, and
a browser cannot be told to skip resolution. That is exactly the scenario in the
goal statement, so (A) alone does not fully deliver it. Closing the gap means a
resolver that survives the outage — the coordinator answering for its own name
on the LAN, or a documented router DNS entry. That has to be designed, not
assumed.

**(B) WebRTC data channel.** DTLS with a self-signed certificate is legitimate
here, so there is no PKI and no mixed-content problem. The cost is signalling:
ICE parameters must be exchanged. On a single subnet no STUN or TURN is needed,
and host candidates plus the DTLS fingerprint can be cached from the last online
session, which makes a fully offline start possible. More engineering, fewer
external dependencies, and it does not need DNS at all.

**Recommendation: ship (A) first, design the session layer so (B) can replace
the transport without touching anything above it.** Do not advertise
"works with the internet cut" until the resolver question is answered.

### 4.4 Discovery: the relay publishes candidates, the client caches and races

While online, each coordinator reports its reachable local endpoints through the
relay; the client caches them per coordinator. On connect, the client races the
cached direct endpoints against the relay path with a short budget and keeps the
first that completes a handshake. An outage therefore uses the last known good
candidates rather than discovering anything.

Browsers cannot do mDNS, so there is no zero-configuration first contact. The
first ever session for a device is necessarily online. That is acceptable: a
home that has never been reached cannot be trusted offline either.

## 5. What this costs

**Each coordinator must implement the server side of RFC 0001 for direct
sessions.** Not a subset: `HELLO`/`WELCOME`, token verification, visibility
enforcement for state and event topics, non-spoofable caller metadata, the
subscription lifecycle, call deadlines, cancellation and outcome-unknown,
backpressure and slow-consumer shedding, and the frame limits.

Today that exists once, in Go, in `miakapp-server` — about 8,300 lines. Answering
the question directly: **MiakAPI should not embed the Go relay.** It should grow
a TypeScript RFC 0001 endpoint. Two implementations of one protocol is a real
cost and should be stated as such.

What makes it tractable rather than reckless is that the protocol work is
already done for exactly this reason: `protocol/` holds cross-language golden
vectors, and `coordinator-contract/` already exercises a coordinator against the
contract. A second implementation is **verifiable against the same vectors**
instead of being a good-faith guess. If those vectors are not currently
sufficient to certify a fresh implementation, making them sufficient is the
first task of this workstream, before any transport code is written.

**What moves out of the relay** is cross-coordinator aggregation — the union of
state dictionaries, snapshots and grants. What does **not** move is the relay
itself: remote access, the coordinator that is not locally reachable, push, and
candidate publication all still need it. Local-first narrows `miakapp-server`'s
role; it does not retire it.

## 6. Consequences above the transport

- **Per-coordinator epochs, revisions and staleness.** A single global
  "connected" indicator stops being meaningful. The UI must be able to say that
  one part of the home is stale while the rest is live. RFC 0002 already took
  this position for component state, and the same honesty applies here.
- **Exactly one active session per coordinator.** If a coordinator is reachable
  both directly and through the relay, the client picks one and never merges two
  streams for the same coordinator: that would duplicate events and corrupt
  revision continuity. Switching transport starts a new epoch and requires a
  fresh snapshot.
- **Cross-coordinator operations stay non-atomic.** RFC 0001 §7.5 already says
  changing several coordinators is not one transaction. Client-side aggregation
  makes that visible rather than introducing it.
- **Name collisions across coordinators** become the client's problem to resolve
  and display, since no relay arbitrates the union any more.

## 7. Staging

1. **Certify the protocol vectors** as sufficient to validate an independent
   RFC 0001 server implementation. Blocking; everything else depends on it.
2. **Coordinator endpoint over loopback**, no TLS, no discovery. Proves the
   TypeScript server against the vectors and the coordinator-contract suite.
3. **Client session manager**: one session per coordinator, client-side
   aggregation, per-coordinator staleness, single-session rule. Ships over the
   relay only, with no behaviour change for users.
4. **Local credentials** (§4.2), still over the relay.
5. **Transport (A)** with certificate issuance and candidate publication.
6. **Offline resolver**, and only then the availability claim.

Steps 2 and 3 carry most of the risk and neither needs a single new network
path. Step 3 is worth doing on its own merits even if local-first were dropped.

## 8. Open questions

- Does the platform run a DNS zone for `local.miakapp.app`, and who operates the
  ACME brokering? This is an ongoing operational commitment, not a one-off.
- Local session certificate lifetime, and revocation propagation when the device
  is offline and the user's access was withdrawn.
- May an unenrolled user hold a local certificate, or is `miakapp.join` online-only?
- Does a self-hosted relay deployment get the same DNS and certificate service,
  or is local-first a platform-hosted feature?
- What happens to push during an outage? Nothing in this document addresses it,
  and a home that is locally operable but silently missing alerts is a worse
  failure than one that is visibly offline.
