# RFC 0002: Component Runtime and Capability Bridge

- **Status:** Accepted
- **Date:** 2026-08-30
- **Owners:** Miakapp platform and web host
- **Related:** [RFC 0001: Wire Protocol](./0001-wire-protocol.md)
- **Reference harness:** architectural boundary subset; not a conforming
  production implementation

## 1. Abstract

Miakapp 3.5 lets a home publish one generated user-interface bundle. That bundle
is home-authored and platform-untrusted: it may receive data and invoke operations
that the current home deliberately grants, but it must not inherit the authority
of the authenticated Miakapp application.

This RFC defines the browser boundary, immutable artifact contract, capability
bridge, framework-neutral UI ABI, activation and rollback lifecycle, and hostile
browser tests. The selected architecture is:

1. the authenticated host fetches and verifies an immutable bundle;
2. a hidden, cross-site iframe runs a fixed broker under an opaque sandbox origin;
3. the broker verifies and parses the bytes, then starts the bundle as a classic
   Dedicated Worker behind a fixed confinement prelude;
4. the Worker can communicate only with the broker;
5. the broker validates and bounds messages before forwarding them to the host;
6. the trusted host renders semantic UI nodes into its own DOM.

The home bundle never executes in the host realm and never receives a DOM,
Firebase credential, Home Key, raw WebSocket, arbitrary URL, host storage, or
service-worker capability. React is an authoring adapter above the UI ABI; it is
not part of the security boundary.

## 2. Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** are to be interpreted as described in RFC 2119 and RFC 8174.

An implementation conforms only when its supported browser matrix passes the
hostile tests in Section 18 with the production-equivalent sandbox attributes,
response headers, CSP, broker build, and host validators. User-agent sniffing or
instructions to generated code are not security controls.

## 3. Scope and non-goals

This RFC owns:

- the trust boundary between the authenticated host and a home bundle;
- the pointer and single-file artifact formats;
- fetch, byte limits, integrity, cache, publication, activation, and rollback;
- the host-to-broker and broker-to-Worker protocols;
- the framework-neutral semantic UI tree;
- state, event, call, and media-presentation capabilities;
- revocation, lifecycle, failure, accessibility, and resource limits;
- the minimum adversarial browser corpus.

This RFC does not select a source repository, bundler, JSX transform, React
adapter, Firebase upload credential, or publisher user interface. It does not
define the platform control-plane authorization used to publish a pointer. It
also does not make the relay confidential; the relay trust boundary remains the
one documented in the ecosystem design.

Arbitrary React DOM, arbitrary HTML or CSS, arbitrary npm widgets, arbitrary
network access, inline third-party frames, and browser-side compilation are not
part of ABI 1.

## 4. Trust and threat model

### 4.1 Principals

| Principal | Trust | Authority |
| --- | --- | --- |
| Browser and operating system | trusted boundary | origin, sandbox, CSP, process and Worker enforcement |
| Authenticated Miakapp host | platform-trusted | Firebase session, relay session, verified cache, rendering, user-facing recovery |
| Runtime broker | platform-trusted and immutable | Worker creation, message validation, rate limiting, termination |
| Home bundle | platform-untrusted, home-authored | only the state and named capabilities explicitly granted to this instance |
| Relay and coordinator | as defined by RFC 0001 | authoritative session descriptors and home operations |
| Artifact pointer | authenticated platform data | binds home, generation, requirements, URL, size, and digest |

The broker and semantic renderer are part of the trusted computing base. Their
source, build, headers, and validators MUST be platform-owned and versioned.

Pointers, requirements, and artifact bytes are not confidentiality boundaries.
Read policy SHOULD minimize unnecessary disclosure, but artifacts MUST contain
no secret and runtime security MUST hold even when another authenticated user
obtains their bytes.

### 4.2 Protected assets

The runtime protects:

- Firebase tokens and authenticated Firebase APIs;
- the Home Key and platform signing material;
- host DOM, globals, cookies, storage, caches, and service workers;
- raw relay connections and protocol frames;
- another home's state, effectful capabilities, and trusted cache entries;
- undeclared browser APIs, network destinations, and presentation surfaces;
- host availability from a Worker that can be terminated or a broker frame that
  can be destroyed.

### 4.3 Explicit disclosure boundary

Every value delivered to the home Worker is disclosed to that home bundle. The
bundle can encode such a value in the arguments of an otherwise authorized call
or event. The runtime cannot infer the semantic sensitivity of arbitrary values.

The host and relay MUST therefore filter state and capabilities before delivery.
Secrets that the home bundle is not allowed to disclose MUST NOT be sent to it.
The sandbox is not a data-loss-prevention engine for data intentionally granted
to the home.

### 4.4 Out-of-scope failures

This boundary does not survive a compromised browser, operating system,
authenticated host, broker build, or trusted renderer. Browser site/process
isolation is defense in depth and is not a portable availability guarantee. A
malicious Worker can still consume memory before a watchdog terminates it. An
already accepted home call cannot be undone by removing the UI.

## 5. Architecture

```text
authenticated Miakapp host (trusted origin and DOM)
  |
  | one-time window handshake: source + nonce
  | private MessagePort; bounded broker ABI
  v
hidden runtime iframe (separate site, opaque origin, fixed trusted broker)
  |
  | Worker object; bounded guest ABI; no host port transfer
  v
home bundle (self-contained classic Dedicated Worker program, untrusted)
```

The trusted host renders the UI tree. The sandbox iframe is not a visual surface
and MUST be hidden from assistive technology and sequential focus. The guest has
no `Window` or `Document`; it cannot navigate, create DOM resource channels, or
read the rendered UI.

The broker MUST retain the host `MessagePort`. It MUST NOT transfer that port, a
Firebase token, a relay handle, or any server credential to the Worker. Guest
requests cross two independent validators: broker-side before they leave the
sandbox site and host-side before they use platform authority.

## 6. Runtime site and browser policy

### 6.1 Site separation

The broker document MUST be hosted on a site whose registrable domain is distinct
from the authenticated Miakapp site, or on a Public Suffix List boundary that
gives the runtime its own site. A sibling such as `sandbox.miakapp.com` is a
different origin but is still same-site and is insufficient for the intended
defense in depth.

The runtime site MUST:

- never set or consume authentication cookies;
- never host user accounts or other credentialed applications;
- never register a service worker;
- serve only immutable, platform-owned runtime releases;
- reject framing by origins other than the configured Miakapp hosts;
- expose no CORS API and no artifact download endpoint.

`credentialless` MAY be added when supported, but it MUST NOT be the only
no-credential control because unsupported browsers ignore it.

### 6.2 Iframe construction

The host MUST set all security attributes before inserting the iframe:

```html
<iframe
  aria-hidden="true"
  tabindex="-1"
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
  allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'; bluetooth 'none'; clipboard-read 'none'; clipboard-write 'none'"
></iframe>
```

No other sandbox token is allowed in ABI 1. In particular, the host MUST NOT add
`allow-same-origin`, forms, popups, downloads, modals, presentation, storage
access, or top-navigation tokens. Changing the attribute after insertion is not
a supported reconfiguration mechanism; the host destroys and recreates the
instance instead.

The runtime URL is a build-time platform constant. A cryptographically random
instance nonce is placed in its URL fragment so it is not sent in the HTTP
request. Home-controlled input MUST NOT affect the runtime URL.
Production runtime documents MUST use content- or version-addressed URLs before
being served with `immutable` caching.

### 6.3 Required response headers

Every runtime response MUST include an equivalent of:

```http
Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'sha256-<broker>'; script-src-attr 'none'; style-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; connect-src 'none'; worker-src blob:; child-src blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors https://miakapp.com
Permissions-Policy: camera=(), microphone=(), geolocation=(), display-capture=(), fullscreen=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=(), clipboard-write=()
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cache-Control: public, max-age=31536000, immutable
```

The exact host allowlist and broker hash vary by release. `frame-ancestors` and
`sandbox` MUST be response directives, not meta-only policy. Multiple policies
MAY further restrict the document. Unknown Permissions Policy directives are
only defense in depth; sandbox, CSP, Worker separation, and the capability bridge
remain the baseline.

The broker document MUST contain no external script, stylesheet, image, font,
frame, or media dependency. Its one inline module is authorized by its exact CSP
hash. It MUST NOT contain a relative URL or `<base>` element.

The Blob Worker MUST inherit the broker document's CSP in every supported
browser. A browser/version that fails this conformance test is unsupported and
MUST fail closed; the implementation MUST NOT add `connect-src`, general
`script-src`, or `allow-same-origin` to make it work.

## 7. Component pointer and artifact

### 7.1 Pointer schema

Firestore document `components/{homeID}` contains exactly one pointer:

```json
{
  "schema": "miakapp.component-pointer/1",
  "home_id": "home_01J...",
  "generation": 42,
  "release": "2026-08-30.1",
  "abi": "miakapp.component/1",
  "url": "https://control.example/v1/components/<digest>.js",
  "sha256": "base64url-without-padding",
  "size": 348210,
  "requires": {
    "state_read": ["global.temperature", "heating.*"],
    "event_subscribe": ["alarm.changed"],
    "event_publish": ["ui.preference.changed"],
    "call": ["lighting.set", "alarm.arm"],
    "presentation": ["media.front_door"]
  }
}
```

The reserved `.*` suffix in state, event, and call requirements denotes an RFC
0001 dotted-prefix grant. Exact names otherwise use RFC 0001 dotted-name
validation. Any other use of `*` is forbidden. ABI 1 presentation requirements
are exact `media.*`-namespace handles; wildcard presentation grants are
forbidden so each host-owned surface is explicitly enumerated.

The host MUST reject the pointer unless:

- the schema and ABI are exact supported strings;
- `home_id` equals the enrolled home and the Firestore document ID;
- `generation` is a positive safe integer and is not below the highest accepted
  generation for this home;
- `release` is non-empty UTF-8 of at most 64 bytes;
- `url` is HTTPS, contains no user information, query or fragment, and matches
  the configured artifact origin and path prefix;
- `sha256` is a 32-byte SHA-256 digest encoded as unpadded base64url;
- `size` is a positive integer no larger than 2,097,152 decoded bytes;
- each requirement list is duplicate-free, bounded, and syntactically valid;
- there are no unknown fields.

The authenticated pointer is the authority for metadata in ABI 1. Artifact
signatures or supply-chain attestations MAY be added by the control plane, but do
not make a bundle safe and do not replace any runtime control in this RFC.

### 7.2 Artifact format

The artifact is exactly one valid UTF-8, self-contained classic Dedicated Worker
program. All framework code and dependencies are bundled into those bytes. The
artifact MUST NOT contain:

- static imports, exports, or dynamic `import()` expressions;
- secondary chunks, import maps, or network-loaded assets;
- a `sourceMappingURL` or publicly reachable source map;
- an archive, decompression step, browser-side JSX compiler, or eval requirement.

The publisher SHOULD reject these constructs before upload. After byte
verification, the broker MUST decode with fatal UTF-8 handling and parse the
entire program as Script source using its pinned platform-owned parser. It rejects
syntax errors, module syntax, dynamic import expressions, source-map directives,
and excessive lexical or AST complexity before Worker construction. The parser
aborts during tokenization after 100,000 lexical tokens instead of first building
an attacker-sized AST. This runtime parse is mandatory: Chromium can emit a
dynamic-import request before reporting its CSP rejection.

The artifact object name MUST contain its digest and MUST be immutable. CSP still
blocks string compilation and network APIs, but it is not the only import
control.

The finalized artifact URL is token-free and may be publicly cacheable. Published
artifacts therefore contain no credential, private home state, source map or
other confidentiality-sensitive material. Upload staging remains private; the
control plane promotes only bytes that passed delivery-path verification.

The runtime evaluates the verified program inside a fixed nested lexical scope.
Artifact code MUST use `self` for Worker-global APIs and MUST NOT depend on
top-level `var` or function declarations becoming properties of the Worker
global. This separation is security-critical: declarations in one classic
Script are instantiated before its first statement, so raw concatenation would
let guest declarations shadow prelude bindings.

### 7.3 Fetch and verification

Only the trusted host fetches the artifact URL. The request uses the equivalent
of:

```js
fetch(url, {
  credentials: "omit",
  cache: "no-store",
  redirect: "error",
  mode: "cors",
  referrerPolicy: "no-referrer",
  signal,
});
```

The host MUST reject non-2xx responses, redirects, a final URL outside the
allowlist, or an invalid content type. `Content-Length` is advisory and MUST NOT
be compared directly with decoded size: it can describe a content-coded body
while cross-origin CORS hides `Content-Encoding`. The host counts decoded bytes
while consuming the response and aborts immediately above `size` or the global
limit.

The SHA-256 digest covers the exact decoded response bytes that contain the guest
program. Verification occurs before UTF-8 decoding, parsing, caching as trusted,
or execution. The observed size MUST exactly equal `size` and the digest MUST
equal `sha256` using a constant-time byte comparison where available. The
platform runtime version separately identifies the fixed confinement prelude
prepended at execution.

A service worker or intermediary may replace a response despite `no-store`; the
size and digest checks remain mandatory. The host transfers the already verified
`ArrayBuffer`, never the Storage URL or download token, to the broker. The broker
independently checks size and digest before constructing the Blob.

## 8. Publication, cache, activation, and rollback

### 8.1 Publication ordering

The privileged publisher MUST:

1. build a single-file artifact and requirements manifest;
2. calculate its decoded byte size and SHA-256 digest;
3. upload it under a content-addressed immutable name;
4. read it back through the delivery path and verify size and digest;
5. compare-and-set the pointer using the current generation;
6. publish a strictly greater generation.

An upload without a pointer is an orphan eligible for later garbage collection.
A pointer MUST never reference an object that has not passed step 4. Concurrent
publishers resolve through the generation precondition, not last-write-wins.

### 8.2 Verified cache

The host MAY retain artifact bytes in trusted IndexedDB or Cache Storage indexed
by `(home_id, sha256)`. It MUST verify size and digest again before every
execution. URL or release name alone is never a cache key. The sandbox site owns
no persistent cache.

The highest accepted generation and last-known-good digest are host data. They
SHOULD also be recoverable from an authenticated platform record because browser
storage can be cleared or evicted. Offline execution MAY use only a previously
verified last-known-good artifact and MUST present a trusted stale/offline state;
no call capability exists before relay enrollment.

### 8.3 Staged activation

A new generation starts in **staging** with state input and rendering enabled but
with event publication and calls disabled. It becomes **active** only after:

- the broker and Worker complete their versioned handshakes;
- the Worker emits a valid initial tree within the deadline;
- the host renders that tree successfully;
- the relay session still grants every required capability.

The old active instance remains available while the new one stages. Activation
is atomic: the host increments the instance epoch, revokes the old broker, swaps
the rendered tree, then enables effects for the new instance. Two instances MUST
NOT hold effectful capability at the same time.

### 8.4 Rollback and quarantine

Rollback republishes a previous verified digest under a new, greater generation.
Generation never decreases. Automatic fallback is limited to the last-known-good
artifact and occurs only before the failed candidate received effectful
capabilities.

After activation, a crash returns to trusted host error UI. Automatic rollback
after effects have begun risks repeating actions and MUST require an explicit
release policy. A platform digest quarantine overrides pointers and caches.

## 9. Handshake and lifecycle

### 9.1 States

```text
absent -> fetching -> verified -> broker_starting -> worker_starting
       -> staging -> active -> suspended -> active
       -> revoking -> terminated

any pre-active state -> failed
active/suspended      -> failed -> terminated
```

State changes are host-owned and observable in trusted UI. `iframe.onload` is not
readiness; only the protocol handshake establishes readiness.

### 9.2 Window bootstrap

The broker reads the random nonce from its fragment and sends exactly one window
message:

```json
{
  "type": "miakapp.runtime.ready",
  "runtime": "1",
  "nonce": "<instance nonce>"
}
```

The host accepts it only when:

- `event.source === iframe.contentWindow`;
- the nonce and runtime version exactly match this pending instance;
- the object contains exactly the expected fields;
- no previous ready message was accepted;
- the readiness deadline has not expired.

The sandboxed document's serialized `event.origin` is `"null"`; that value MUST
NOT be treated as an identity. The host transfers one end of a new
`MessageChannel` using `targetOrigin: "*"`, then removes its global message
listener. Possession of the port is the capability.

Unexpected iframe navigation, a second load, channel loss, nonce replay, or a
second ready message terminates the instance and requires a new iframe, nonce,
port, and epoch.

### 9.3 Worker bootstrap

The host sends the verified bytes, pointer identity, effective capability grant,
initial filtered state, locale, theme tokens, and staging flag to the broker. The
artifact bytes are the only transferable allowed during load.

After revalidation and syntax validation, the broker prepends a fixed trusted
prelude. Before any guest statement runs, the prelude irreversibly shadows the
Worker's ambient `fetch`, WebSocket, EventSource, `importScripts`, nested Worker,
BroadcastChannel, IndexedDB, Cache Storage, service-worker, Beacon, WebRTC and
WebTransport entry points. Failure to remove or shadow any required entry point
terminates the candidate before guest execution.

The prelude also installs a private heartbeat listener using captured native
functions. The guest bytes follow inside a fixed arrow-function scope, so their
hoisted declarations cannot affect prelude name resolution. The scope markers
are platform runtime bytes, not artifact bytes.

The broker then creates:

```js
new Worker(URL.createObjectURL(
  new Blob([
    fixedConfinementPrelude,
    fixedGuestScopePrefix,
    artifactBytes,
    fixedGuestScopeSuffix,
  ], {
    type: "text/javascript",
  }),
), { type: "classic", name: boundedDebugName });
```

The Blob URL is revoked after Worker construction has completed or during
teardown, according to tested browser behavior. The broker binds messages to the
specific `Worker` object. It rejects every transferred port or unexpected
transferable from the guest.

The guest emits `guest.ready` with ABI 1 before the boot deadline. Only then does
the broker send `guest.boot`. The guest cannot select its home, instance, grant,
epoch, or staging mode.

`runtime.load` is a one-shot state transition set synchronously before digest
verification begins. A second load is fatal. Teardown invalidates an in-progress
verification, and every asynchronous continuation checks that token before it
may allocate a Blob URL or Worker.

### 9.4 Suspension and restoration

On `visibilitychange` to hidden, the host suspends heartbeats and effectful UI
interactions and informs the broker. On visibility restoration,
`pageshow.persisted`, or BFCache restoration, the host creates a new epoch and
reauthorizes the relay session before reenabling effects. Messages from an older
epoch are rejected.

The implementation MUST NOT depend on unload, pagehide, or guest cleanup. Mobile
browsers may terminate the page without delivering them.

### 9.5 Teardown

The host and broker independently make teardown idempotent:

1. mark the instance closed and reject new messages;
2. increment/revoke the host epoch;
3. abort fetches and host operations;
4. disable subscriptions and effectful capabilities;
5. reject pending calls with the most accurate RFC 0001-derived outcome;
6. close ports and remove listeners;
7. terminate the Worker and its descendants;
8. remove the iframe and revoke Blob URLs;
9. release cached in-memory bytes and renderer state.

Queued messages, network requests already made by trusted capabilities, and
server effects already accepted cannot be recalled.

## 10. Bridge envelope and limits

Every post-bootstrap host/broker message has exactly:

```ts
interface Envelope<T> {
  v: 1;
  instance: string;
  epoch: number;
  seq: number;
  kind: string;
  payload: T;
}
```

`instance` is an unguessable per-mount identifier. `epoch` is a positive safe
integer chosen by the host. Sequence numbers start at one in each direction and
increase by one without gaps. A duplicate, gap, stale epoch, unknown kind,
unknown field, invalid structured value, unexpected transferable, or invalid
payload terminates the candidate before activation and revokes an active guest.

Allowed structured values are null, booleans, finite numbers, strings, byte
arrays, dense canonical lists, and plain string-keyed records. Lists contain
exactly the indexed enumerable keys `0..length-1`; holes and named properties are
forbidden. Functions, symbols, DOM objects,
ports, shared memory, accessors, custom prototypes, and the keys `__proto__`,
`prototype`, and `constructor` are forbidden. Validators use iterative traversal
and account for the entire object graph.

ABI 1 limits are:

| Resource | Limit |
| --- | ---: |
| decoded artifact | 2,097,152 bytes |
| program lexical tokens | 100,000 |
| program AST members | 250,000 |
| broker/host envelope after canonical accounting | 524,288 bytes |
| UI nodes | 1,024 |
| UI depth | 32 |
| aggregate UI text | 262,144 UTF-8 bytes |
| one text or label | 8,192 UTF-8 bytes |
| one input value | 16,384 UTF-8 bytes |
| select options | 100 |
| one structured list | 4,096 items |
| one structured value graph | 16,384 members |
| outstanding calls | 32 |
| relative call deadline | 300,000 ms |
| outstanding stream credit per call | 32 |
| guest messages | 120 per rolling second |
| committed renders | 30 per rolling second |
| Worker boot and first render | 3 seconds each while visible |
| foreground Worker heartbeat | every 1 second; terminate after 3 misses |
| foreground broker heartbeat | every 5 seconds; terminate after 3 misses |

The broker reconstructs a bounded canonical object before forwarding it to the
host. The host validates it again. Browser structured clone may allocate before
validation; the separate site, terminable Worker, rate limit, frame destruction,
and global tab safeguards are mitigations, not a hard memory quota.

## 11. Capability grant

The effective grant is the intersection of:

1. requirements in the authenticated pointer;
2. permissions in the current relay enrollment/session descriptor;
3. platform presentation policy for this user and device.

Missing required capability fails staging in trusted UI. The bundle cannot
request or discover capabilities outside the pointer. Every operation is checked
again against the current grant by the broker and the authority-owning host or
relay. Names use exact or `.*` dotted-prefix matching from RFC 0001; glob and
substring matching are forbidden.

A grant change increments the epoch and restarts the Worker. ABI 1 does not try
to retract selected values from a running JavaScript heap.

## 12. Guest ABI

### 12.1 Directional messages

The guest-to-broker kinds are:

| Kind | Purpose |
| --- | --- |
| `guest.ready` | declare exact ABI support |
| `ui.render` | commit one complete semantic tree |
| `event.subscribe` / `event.unsubscribe` | manage granted event topics |
| `event.publish` | publish a granted at-most-once event |
| `call.start` | start a granted RFC 0001 call |
| `call.credit` | grant stream credit |
| `call.cancel` | request cooperative cancellation |
| `log.write` | bounded local development diagnostic; never production telemetry |

The broker-to-guest kinds are:

| Kind | Purpose |
| --- | --- |
| `guest.boot` | immutable identity, grant, locale, theme, staging mode |
| `state.snapshot` | authoritative filtered RFC 0001 state and revision |
| `state.patch` | ordered revisioned changes |
| `state.stale` | patches paused; wait for a fresh snapshot |
| `event.message` | one live at-most-once event |
| `call.accepted` | authorized and queued, not applied |
| `call.chunk` | credit-controlled stream item |
| `call.result` | terminal success |
| `call.error` | terminal known failure |
| `call.outcome_unknown` | terminal delivery uncertainty |
| `ui.interaction` | trusted renderer interaction tied to a render revision |
| `lifecycle.suspend` / `lifecycle.resume` / `lifecycle.dispose` | host lifecycle |

`runtime.probe` and `runtime.pong` are reserved broker/prelude control messages,
not SDK capabilities. The prelude acknowledges a challenge through a captured
native `postMessage`; a missing or mismatched acknowledgement terminates the
Worker. Guest SDKs MUST ignore reserved runtime messages.

Message payloads mirror RFC 0001 semantics rather than inventing stronger
guarantees. In particular, `call.accepted` is not success, events are live and
at-most-once, cancellation is cooperative, and a disconnect after dispatch can
end as `outcome_unknown`.

### 12.2 State

The host sends only the effective `state_read` projection. A Worker receives an
authoritative snapshot before patches. Patch revisions must be contiguous; a gap
causes `state.stale`, suppresses further patches, and requests a fresh snapshot
from the relay. The guest SDK MUST expose stale state explicitly and MUST NOT
pretend cached values are current.

Bridge patches use the exact shape below. Every path is rechecked against the
effective grant before the broker forwards a reconstructed object.

```ts
interface StatePatch {
  base_revision: number;
  revision: number;
  mutations: Array<
    | { path: string; op: "set"; value: StructuredValue }
    | { path: string; op: "delete" }
  >;
}
```

### 12.3 Calls and events

Operation IDs are unique within an instance epoch. The host owns deadlines,
in-flight limits, caller metadata, idempotency metadata, and mapping to RFC 0001.
The bundle never supplies authenticated caller fields.

The broker rejects an operation ID already in flight, a thirty-third outstanding
call, a deadline above 300,000 ms, credit above 32, and credit or cancellation
for an unknown operation. Accepted, chunk, result, error, and outcome-unknown
messages are correlated to that table; terminal messages remove the entry. An
event is delivered only while its exact or prefix-granted topic is currently
subscribed.

Staged, suspended, stale-epoch, and revoked instances cannot publish events or
start calls. A user interaction does not automatically authorize a call; relay
ACLs and any platform confirmation policy remain authoritative.

## 13. Semantic UI ABI

### 13.1 Framework independence

The security ABI is a complete immutable tree, not DOM mutations and not React
elements. A React adapter MAY implement JSX, components, hooks, and reconciliation
inside the Worker, then emit a tree at commit. The adapter and React version can
change without changing ABI 1.

The host maps the validated tree to trusted React design-system components. The
guest cannot provide component constructors, HTML, CSS, class names, style text,
DOM property bags, ARIA property bags, or event-handler source.

### 13.2 Node envelope

Every node has exactly:

```ts
interface UiNode {
  id: string;
  type: UiNodeType;
  props: Record<string, AllowedValue>;
  children?: UiNode[];
}
```

IDs match `[A-Za-z][A-Za-z0-9._:-]{0,63}` and are unique within the tree. The root
is one `screen`. Container and leaf shapes are exact; unknown types, properties,
or children are rejected.

ABI 1 defines these semantic types:

| Type | Required purpose and bounded properties |
| --- | --- |
| `screen` | accessible page title; container children |
| `stack` | vertical/horizontal layout, semantic gap and alignment tokens |
| `grid` | bounded column count and semantic gap tokens |
| `section` | heading and optional description; container children |
| `text` | text content and semantic tone/emphasis tokens |
| `status` | label plus `idle`, `pending`, `accepted`, `applied`, `failed`, `stale`, or `outcome_unknown` |
| `button` | accessible label, semantic variant, disabled/pending, handler ID |
| `toggle` | accessible label, boolean value, disabled/pending, handler ID |
| `input` | label, string value, input kind, maximum length, handler ID |
| `select` | label, selected scalar value, bounded literal options, handler ID |
| `progress` | label and finite bounded value |
| `media` | accessible label and a granted opaque presentation handle |

Layout, spacing, color, typography, icon, and status values come from closed
design-token enums. No ABI 1 property accepts a URL. Images, camera feeds, HLS,
and WebRTC surfaces are selected by exact opaque media handles, never strings
chosen by the Worker. External navigation and downloads are not part of ABI 1.

### 13.3 Rendering and interaction

The host renderer MUST use trusted component constructors, `textContent`, and
explicit safe DOM properties. It MUST NOT use `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `srcdoc`, dynamic style text, `eval`, or a generic property
spread from a guest object.

Each accepted tree increments `render_revision`. Interactions contain only the
instance, epoch, render revision, node ID, event kind, and a type-specific bounded
value produced by the trusted control. The broker rejects an interaction for an
old render, missing node, wrong event kind, disabled control, or unknown handler.

Full-tree commits are intentional in ABI 1. They make validation and atomic
rendering auditable. The SDK may coalesce commits; the broker enforces the render
rate and the host reconciles by stable node ID. An incremental mutation protocol
requires a future ABI.

## 14. Presentation and media

The guest has no general URL opener. One home bundle models internal screens in
its own state and semantic tree. ABI 1 exposes no navigation, toast, dialog,
notification, clipboard, download, or external-link message. Any future typed
host service needs an exact payload and consent model in a new ABI.

`media` nodes name a granted opaque handle. The trusted host resolves the handle
to a platform/coordinator-approved descriptor and owns the resulting iframe,
video, HLS, or WebRTC surface outside the sandbox broker. Worker-controlled data
MUST NOT be concatenated into its URL. The host applies its own sandbox,
Permissions Policy, origin allowlist, stop control, visibility lifecycle, and
resource quotas to that surface.

ABI 1 requires a host-owned modal or dedicated presentation surface. Inline
compositing MAY be added only after cross-browser layout, focus, autoplay, and
teardown tests. Camera or microphone capture is a separate privileged profile and
is not granted to the component Worker or broker iframe.

## 15. Accessibility and trusted UX

Because semantic nodes render in the host document, the host owns native
semantics, focus order, keyboard handling, reduced motion, contrast, text scaling,
locale, and announcements. Required labels are validated before rendering.

Loading, incompatibility, crash, stale state, quarantine, and rollback UI is
always host-owned. The bundle cannot imitate or replace Firebase login,
enrollment, permission, confirmation, or recovery chrome. The host MUST keep a
reachable stop/reload control outside the generated tree.

The hidden broker frame has no interactive descendants, is `aria-hidden`, and is
removed from sequential focus. This use of `tabindex=-1` MUST NOT be copied to a
visual component iframe.

## 16. Errors and observability

The host records release, digest, generation, ABI, runtime version, browser
family, lifecycle state, stable error code, and coarse resource counters. It MUST
NOT log Firebase tokens, Home Keys, arbitrary state values, call arguments, or
download tokens.

Guest exception text and `log.write` content are untrusted data. Production
telemetry MUST discard them; a local developer surface MAY display a bounded
message only when it cannot be persisted or uploaded.

Stable local codes include:

| Code | Meaning |
| --- | --- |
| `pointer_invalid` | pointer schema, home, generation, URL, or requirement failure |
| `artifact_fetch_failed` | network, HTTP status, body availability, or media-type failure |
| `artifact_too_large` | declared or observed decoded size exceeds policy |
| `artifact_size_mismatch` | observed size differs from pointer |
| `artifact_hash_mismatch` | verified digest differs from pointer |
| `artifact_program_invalid` | decoded program violates the classic Worker profile |
| `runtime_handshake_failed` | source, nonce, version, navigation, or timeout failure |
| `worker_boot_failed` | Worker construction, CSP, ABI, or ready timeout failure |
| `bridge_protocol_violation` | envelope, sequence, schema, transferable, or rate failure |
| `capability_denied` | request is outside the current effective grant |
| `render_invalid` | semantic tree or interaction is invalid |
| `runtime_unresponsive` | heartbeat, Worker, or broker availability failure |
| `release_quarantined` | digest is denied by platform policy |

Detailed diagnostics are available only to authorized owners/developers. User UI
uses stable, actionable language and preserves the distinction between failed,
stale, and outcome unknown.

## 17. Compatibility and evolution

Pointer schema, component ABI, runtime protocol, and wire protocol versions are
separate. Compatibility is explicit; there is no best-effort interpretation of
unknown fields or kinds.

A runtime release MAY support multiple component ABIs. The pointer selects one.
Unsupported ABI fails before artifact execution and retains the last-known-good
release. New node types, properties, or bridge messages require a new ABI unless
the existing schema explicitly marks the extension optional.

CI MUST exercise current Playwright Chromium, Firefox, and WebKit. Production
browser support follows the application's documented matrix, but a browser joins
that matrix only after the exact production broker passes the hostile corpus.

## 18. Required conformance and hostile tests

The executable harness MUST prove, in every supported engine:

1. a valid bundle can render, receive filtered state, and invoke one granted call;
2. bytes with the wrong size or digest never start a Worker;
3. the guest cannot observe host DOM, globals, cookies, local/session storage,
   IndexedDB, Cache Storage, service workers, Firebase credentials, or another
   home's data;
4. fetch, XHR, WebSocket, EventSource, dynamic import, subworkers, Beacon-style
   APIs, WebRTC, and other undeclared egress do not reach the probe server;
5. raw HTML, URLs, unknown nodes/properties, prototype keys, duplicate IDs,
   excessive depth, excessive nodes, and stale interactions are rejected;
6. an undeclared state, event, call, or media handle is rejected by both
   broker and host;
7. nonce replay, wrong source, wrong version, stale epoch, duplicate/gapped
   sequence, transferred port, and post-navigation messages fail closed;
8. a message/render flood terminates the Worker without forwarding an unbounded
   queue to the host;
9. an infinite loop is terminated by the broker watchdog while trusted host UI
   remains responsive;
10. staging cannot produce calls and activation never gives two releases
    concurrent effectful authority;
11. reload, BFCache simulation, visibility suspension, teardown, and rollback
    create a new epoch and reject old messages;
12. required controls render with accessible names and every operation state has
    a distinct semantic representation.

Tests MUST observe actual network requests, not only rejected JavaScript promises.
CSP console messages alone are not evidence. A release cannot replace these tests
with jsdom or a single browser engine.

The repository reference harness intentionally proves a boundary subset: byte
integrity, classic-program parsing, prelude confinement (including declaration
shadowing), semantic rendering, selected capability/state checks, staging and
suspension denial, port rejection, canonical array/message limits, Worker
watchdogs, and teardown in Chromium, Firefox, and WebKit. It does not yet claim
the complete matrix above, Firebase delivery, dual-instance activation,
BFCache/visibility restoration, keyed React reconciliation, or production SDK
conformance. Those remain exit criteria for the component-platform vertical
slice.

## 19. Security claims

On a conforming browser and uncompromised trusted host/runtime, Miakapp may claim:

- home code does not execute in the authenticated host realm;
- home code receives no DOM, platform credential, raw socket, arbitrary network,
  origin storage, or service-worker authority;
- only validated semantic UI and named granted operations cross into the host;
- the running artifact bytes match the authenticated pointer;
- a busy Worker can be terminated and its broker frame can be destroyed.

Miakapp MUST NOT claim:

- that granted home data cannot be disclosed back to the home coordinator;
- that browser process, memory, CPU, GPU, or clone allocation is hard-quota
  isolated;
- that a content hash or signature proves generated code is safe;
- that accepted calls can be undone on teardown;
- end-to-end confidentiality from the selected relay;
- arbitrary React DOM compatibility.

## 20. Rejected alternatives

### Direct same-realm import

Rejected. It grants the bundle the authenticated origin, DOM, storage, Firebase
globals, service worker, and raw application authority.

### Opaque iframe executing the bundle's DOM

Rejected as the default. It protects the parent origin but permits self-navigation
and therefore at least one egress request, has no hard termination or queue
control, complicates focus/accessibility, and makes every permitted resource type
an exfiltration channel.

### Dedicated cookieless iframe origin with React DOM

Deferred as a separately named **audited DOM profile**. It has the best web
ecosystem compatibility and may be appropriate if bundles become reviewed
first-party releases. It does not satisfy ABI 1's no-arbitrary-network or
hostile-bundle guarantees.

### Same-origin Worker

Rejected. A normal Worker has fetch, storage, cache, and origin authority even
without a DOM.

### SES or ShadowRealm in the host

Rejected as the primary boundary. Same-agent confinement lacks hard termination
and memory isolation, adds a large security-sensitive dependency, and can conflict
with library assumptions. ShadowRealm is not intended as a hostile-code sandbox.

### QuickJS/Wasm virtual machine

Deferred. It can provide a smaller guest authority surface and explicit memory or
instruction policies, but adds runtime size, performance cost, compatibility
work, and a second JavaScript implementation. It becomes justified if the threat
model changes from home-authored/platform-untrusted to third-party/home-hostile.

### Declarative pages without JavaScript

Rejected for the product goal. It is simpler to audit but cannot provide the
local stateful composition expected from generated applications without creating
another bespoke expression language.

## 21. References

- [WHATWG HTML sandboxing](https://html.spec.whatwg.org/multipage/browsers.html#sandboxing)
- [WHATWG channel messaging](https://html.spec.whatwg.org/multipage/web-messaging.html#channel-messaging)
- [Content Security Policy Level 3](https://w3c.github.io/webappsec-csp/)
- [Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/)
- [Service Workers](https://w3c.github.io/ServiceWorker/)
- [Securely hosting user data](https://web.dev/articles/securely-hosting-user-data)
- [Shopify remote rendering](https://shopify.engineering/remote-rendering-ui-extensibility)
- [Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/)
- [The Update Framework](https://theupdateframework.github.io/specification/latest/)
