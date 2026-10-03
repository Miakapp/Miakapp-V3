# Whole-house applications — `miakapp.app/1`

Status: implemented in the browser shell, sandbox site build and control plane
(2026-10-03). Publishing still needs the CLI changes listed at the end, and the
server-side gaps listed under "Not yet end to end".

## Why

`miakapp.component/1` lets a home describe a semantic tree that Miakapp draws
with its own controls. That keeps a home inside a closed catalogue: it cannot
choose its layout, styles, navigation or libraries. `miakapp.app/1` lets a home
ship its own application instead, while the resident's account, other homes and
the Miakapp controls stay out of its reach.

## What a house application is

One self-contained JavaScript file (≤ 2 MiB), published like a component
release: same upload, digest, finalization, activation, rollback and
anti-rollback floor, with `abi: "miakapp.app/1"`.

- It is loaded as a **classic script** (the control plane parses releases with
  `sourceType: "script"` and refuses `import()`). Bundle it as an IIFE; any
  framework or library a bundler can inline works (React, Preact, Vue, Svelte,
  Lit, charts, CSS-in-JS, WebAssembly, Web Workers from `blob:`).
- It owns `document`: build any DOM, inject `<style>`, use inline styles, hash
  or in-memory routing, forms, animations.
- Assets must be inside the bundle (`data:` / `blob:` images, fonts, media).
- It reaches the home only through `window.miakapp`.

## `window.miakapp`

```ts
interface Miakapp {
  readonly abi: 'miakapp.app/1';
  readonly release: string;
  readonly home: { readonly id: string; readonly name: string };
  readonly locale: string;                     // resident's language, e.g. "fr"
  readonly theme: 'system' | 'light' | 'dark'; // resident's preference
  onThemeChange(listener: (theme: string) => void): () => void;

  readonly state: {
    get(path: string): unknown;                // granted paths only
    values(): Readonly<Record<string, unknown>>;
    readonly revision: number;
    readonly stale: boolean;                   // show it; never present stale values as current
    subscribe(listener: (state: { values; revision; stale }) => void): () => void;
  };
  readonly can: { read(path: string): boolean; call(name: string): boolean };

  /** Rejects with `miakapp.CallError` whose `code` is one of
   *  denied | unavailable | failed | outcome_unknown | timeout | busy.
   *  Never retried by Miakapp: on outcome_unknown, wait for the next state. */
  call(name: string, args?: unknown, options?: { timeoutMs?: number }): Promise<unknown>;

  /** Optional: lift the loading screen earlier. Otherwise it lifts once the
   *  script has run. */
  ready(): void;
  readonly CallError: new (code: string) => Error & { code: string };
}
```

The grant is the release's own `requires.state_read` and `requires.call`
(optionally narrowed by a deployment policy). Undeclared state never reaches the
frame and undeclared calls are refused before leaving the shell. The coordinator
still decides, per resident, whether each call is allowed.

## What the shell guarantees the resident

- **Consent first.** On a first visit the shell explains that the home's
  interface is made by whoever runs the home and waits for "Open the home".
  Before that, nothing of the interface is requested: no pointer read, no
  artifact, no frame. Agreement is stored per home and per notice version
  (`HOUSE_CONSENT_VERSION`); "Not now" loads nothing and offers the other homes;
  agreement can be withdrawn in settings.
- **A permanent Miakapp bar** outside the frame: switch home, favorites,
  personal settings (appearance, consent, restart). Available before consent,
  after refusal, while loading, after a crash or a hang. From inside the home,
  `Alt + Shift + M` moves focus to it.
- **Isolation.** The frame is `sandbox="allow-scripts allow-forms"` from a
  dedicated sandbox origin (opaque origin: no cookies, storage, or access to the
  shell or other homes), with `connect-src 'none'`, no popups, no top
  navigation, no fullscreen or powerful features, and `frame-ancestors` pinned
  to the shell. A frame that navigates away, breaks protocol, crashes while
  booting or stops answering heartbeats is removed and replaced by the shell's
  own screen with a restart.

## Building and deploying the sandbox site

`bun run build:sandbox` now emits `app.html` beside `sandbox.html`, with one
header rule each in the generated `firebase.json`; `bun run verify:sandbox`
re-derives both script hashes from the served bytes and checks the app policy
(opaque origin, closed network, framer).

Recommended on the shell's own response headers: `frame-src <sandbox origin>`
(plus whatever Firebase Auth and App Check frames need). Browser tests show it
also stops a house from navigating its frame elsewhere *before* any request
leaves; without it the shell still detects the navigation and removes the
frame, but only after the request.

## Not yet end to end

- The pointer read (`GET /v1/homes/{id}/component-pointer`) is owner-only and
  requires a sign-in younger than 600 s. Residents cannot load a house UI, and
  an owner sees "unavailable" ten minutes after signing in. Needs a
  resident-readable pointer route (membership-checked, no recent-auth).
- `POST /v1/user-relay-tokens:exchange` does not check membership in the
  control plane. Cross-home isolation of *state and calls* therefore rests on
  the relay/coordinator; it must be verified or added server-side.
- The CLI (`miakapp publish`) still sends `miakapp.component/1`; it needs an
  `app` project shape (see below).
- Browsers without out-of-process frames (some mobile engines) run the house in
  the shell's process: a house stuck in an infinite loop freezes the tab and the
  watchdog cannot run. Desktop Chromium was verified to isolate it.
- Opaque-origin frames have no persistent storage; a house that needs
  preferences must keep them in home state.

## Required CLI / SDK changes (other repository)

- `miakapp.yaml`: `app: { artifact, release, requires: { state_read, call } }`
  (event and presentation lists empty), published with `abi: "miakapp.app/1"`.
- A template `templates/home/app/` (IIFE bundle, `window.miakapp` types,
  stale/pending/outcome-unknown handling) and an `@miakapp/app` type package.
- `miakapp docs` / agent pack: present `app` as the default for a resident UI,
  `component` for minimal semantic screens.
