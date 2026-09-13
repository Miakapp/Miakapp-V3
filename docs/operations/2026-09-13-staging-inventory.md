# `infrastructure/staging` — inventory before any cleanup

Date: 2026-09-13

Status: findings for review. **Nothing has been deleted.**

Scope: read-only measurement of what `infrastructure/staging` contains, what
depends on it, and what it costs. Written because the directory is 71% of the
repository and nobody had a picture of it.

## The shape of the repository

| Directory | Lines | Files |
| --- | ---: | ---: |
| `infrastructure/` | 191,767 | 642 |
| `control-plane/` | 24,877 | 79 |
| `control-plane-contract/` | 16,404 | 26 |
| `docs/` | 8,633 | 11 |
| `coordinator-contract/` | 8,339 | 33 |
| `protocol/` | 4,104 | 15 |
| `component-runtime/` | 3,934 | 29 |
| `src/` — the web application | **3,185** | 18 |
| Whole repository | 269,106 | — |

The staging scaffolding is roughly **sixty times the size of the application it
stages**, and forty-eight times the size of the component runtime, which is the
part of the codebase that actually confines untrusted code.

## The `browser-relay-*` cluster

Thirty-six directories under `infrastructure/staging` are named
`browser-relay*`. Together with their tests they are:

- **311 tracked files, 78,012 lines** in the directories themselves;
- **49 test files, 31,356 lines** under `infrastructure/staging/test/`;
- **16 of the repository's 25 GitHub workflows**.

Their names are the finding. Among others:

```
browser-relay-chromium-case-adapter      browser-relay-case-scheduler
browser-relay-secondary-case-adapter     browser-relay-aggregator
browser-relay-independent-case-adapter   browser-relay-orchestrator
browser-relay-operation-case-adapter     browser-relay-independent-observers
browser-relay-source-clients             browser-relay-authenticated-source-readers
browser-relay-source-transports          browser-relay-trusted-source-composition
browser-relay-source-session-producers   browser-relay-evidence-session
browser-relay-source-authority-adapters  browser-relay-page-receipt
browser-relay-fixture                    browser-relay-scenario-fixture
browser-relay-fixture-cloud              browser-relay-scenario-fixture-cloud
browser-relay-fixture-miakapi            browser-relay-playwright-bridge
```

Four distinct "case adapters", a "case scheduler", an "aggregator" and an
"orchestrator" exist for what is functionally one task: drive a real browser
against the relay and record that it worked. Five separate "fixture" packages
and three "source" abstraction layers sit on top of it.

This is the signature of generated abstraction, not of a problem that needed
twenty-two layers.

**None of it is dead, though, and that matters for how it should be handled.**
I checked: every one of the thirty-six directories is named by something — the
central `infrastructure/staging/check.sh`, a test under
`infrastructure/staging/test/`, or a workflow. Nineteen have no `check.sh` and
no workflow of their own, but they are still exercised through the shared suite.
So this is not dead code to delete; it is live code that is disproportionate to
its task, which is a slower and more deliberate problem to unwind.

## The finding that matters most

`src/app/miakapi-browser.ts`, in the production web application, contains:

```ts
// The staging evidence suite already pins this browser-only MiakAPI bundle by
// digest. Reusing it keeps the web host on that reviewed runtime without
// rewriting the repository-wide dependency lock that historical evidence
// intentionally seals.
// @ts-expect-error The reviewed bundle is generated JavaScript with no sibling declarations.
import * as miakapiBrowserImplementation from '../../infrastructure/staging/browser-relay-page/vendor/miakapi-browser-v4.mjs';
```

The application imports an **84 KB minified vendored bundle, with no type
declarations, from inside a staging evidence directory**, and the comment says
plainly why: updating the real dependency would have disturbed evidence that the
staging suite seals.

That is the scaffolding constraining the product. Whatever is decided about the
rest of this directory, this import should become a dependency on
`miakapi/browser` — the actual published package — with types.

## What it costs

Measured on this machine, with providers already present, the eight Terraform
roots finish `init`, `validate` and `test` in **20 seconds**. In CI they take
over thirty minutes, because `check.sh` runs
`terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` across
all eight, downloading both platforms of every provider — about 1.5 GB — on
every run. `terraform providers lock` deliberately ignores the plugin cache, so
this cannot be cached away.

Until today that gate had no path filter and ran on **every pull request**, and
no concurrency group, so superseded pushes ran it again to completion. Both are
fixed on `mathieu/ci-cost`.

## What is healthy, for contrast

Everything outside this directory is fast and green. Measured today after
installing Go and the Playwright browsers, which were missing from this machine
and were the actual reason two suites appeared broken:

| Suite | Time | Result |
| --- | ---: | --- |
| `test:protocol` | 1 s | pass |
| `test:synthetic-home` | <1 s | pass |
| `test:control-plane-contract` | <1 s | pass |
| `test:coordinator-contract` | 5 s | pass |
| `test:runtime` — adversarial harness | 47 s | **54/54** across Chromium, Firefox, WebKit |
| `lint` / `typecheck` / `test:web` / `build` | 1.2 / 1.0 / 1.5 / 1.3 s | pass |

The component runtime's adversarial security harness — the part of the
repository most worth protecting — costs 47 seconds and passes on three engines.
It is not the reason anything is slow.

## Known failures, not yet diagnosed

- `test:staging-manifest`: 3 of 54 subtests fail in
  `browser-relay-trusted-provider-process`, all about killing a SIGTERM-ignoring
  descendant in the same POSIX process group. Process-group semantics differ
  inside a container, so this is plausibly environmental. It needs confirmation
  on real CI before being treated as a bug.
- `test:control-plane-emulator`: refuses to run because `check.sh` pins Bun
  1.2.23 and this machine has 1.4.2. An exact pin, not a failure.

## Suggested order of work

1. **Replace the vendored import** in `src/app/miakapi-browser.ts` with a real
   dependency on `miakapi/browser`. Small, self-contained, and it unhooks the
   application from the scaffolding.
2. **Rewrite `infrastructure/staging/README.md`.** Its status section is a
   single run-on sentence of retired, converged and rebased states. Nobody can
   act on it, which is part of why the directory grew unchecked.
3. **Decide the `browser-relay-*` cluster deliberately**, directory by
   directory: what does it verify, is that verification still needed, is it
   verified anywhere else. Since none of it is orphaned, every removal is a
   decision that something no longer needs proving — not a tidy-up. Start with
   the four case adapters and the scheduler, where the duplication is clearest.
4. **Split the Terraform roots into a CI matrix** so the eight run in parallel,
   and move the `providers lock` supply-chain verification into its own workflow
   triggered by `.terraform.lock.hcl`. Both change status-check names, so
   confirm branch protection first.
