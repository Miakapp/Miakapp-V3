# Browser-relay trusted provider owner

This package is the first complete, executable owner of the Miakapp V4 browser-relay
acceptance graph. It joins seven source-truth providers, 32 named provider methods,
17 operation callbacks, and the five browser-matrix capabilities behind the existing
trusted-source composition and dedicated-process boundary.

The owner executes one 22-stage matrix. It closes 43 independently sourced
observations and 40 assertions across Chromium, Firefox, and WebKit, then returns the
existing sanitized operation result. Provider capabilities, operation state, private
page inputs, browser handles, pages, and cleanup closures remain inside the child
process. Only the closed result can cross IPC.

## Offline proof boundary

This milestone deliberately uses concrete but synthetic source truth. The source
providers read from one private, append-only operation ledger and accept no generic
request, endpoint, target, credential, or caller-supplied observation. The operation
callbacks model the exact claim, public window, monitoring, rollback, and final-clean
state machine entirely in memory.

The browser half launches the pinned Playwright 1.62.1 Chromium, Firefox, and WebKit
engines. Chromium loads the real page runtime from a TLS listener bound to
`127.0.0.1`; an ephemeral self-signed certificate is generated with the fixed
`/usr/bin/openssl` binary and erased before the first request. Chromium's fixed host
resolver maps the one staging hostname to that listener and makes every unmatched
hostname fail resolution. Firefox and WebKit use exact-origin Playwright route
fulfilment. A strict offline content-security policy permits connections only to the
document origin, and every opened page must prove that one fixed external request is
blocked. Every other request is rejected, service workers are blocked, and all
contexts close before their browser process.

The Chromium scenario keeps its production monotonic clock. Consequently, the two
required 240-second renewal intervals are real even in the offline browser proof.
That slow proof belongs only to the dedicated workflow.

The evidence session timestamps observations itself, so the source owner also
enforces the real 60-second version-2 publication window and 330-second version-1
retention bound. Publication and dependent relay reads remain below the reviewed
75-second authority deadline; explicit cross-source barriers preserve all remaining
evidence order.

## Artifact and authority

`bundle.mjs` builds a deterministic `MIAKOWN1` artifact containing the exact
repository dependency/validation closure and the required `playwright-core`
runtime, licence, and type-contract subset.
Digest validation requires some dependency tests, guards, workflows, and controlled
testing modules to remain present as inert data. The generated module allowlist makes
those validation-only assets non-importable; only the 87 reviewed runtime modules
can execute. The inert closure includes the exact relay-service Terraform and edge
README bytes that transitive profile validators re-hash, but no unrelated package
files or documentation and no owner testing entrypoint. Browser binaries remain
external Playwright runtime material; the bundle contains no browser binary,
environment value, cloud credential, or user datum.

The child process is a strong ownership and data-flow boundary, not an operating
system sandbox. Its trusted code still has same-user filesystem and network authority.
The package guard therefore admits only the reviewed loopback listener, ephemeral TLS
generation, fixed page origins, and Playwright browser processes.

This proof is not a staging cloud run, Hosting publication, live source observation,
public-ingress change, or authorization to execute the live matrix. It creates no cloud
resource and has zero incremental monthly cost.

Run the fast package gate with:

```sh
sh infrastructure/staging/browser-relay-trusted-provider-owner/check.sh
```

Run the approximately eight-minute real-browser child-process proof explicitly with:

```sh
MIAKAPP_RUN_TRUSTED_PROVIDER_OWNER_BROWSER=1 \
  sh infrastructure/staging/browser-relay-trusted-provider-owner/check.sh
```
