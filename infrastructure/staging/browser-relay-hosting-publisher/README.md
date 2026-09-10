# Dormant browser-relay Firebase Hosting publisher

This package is the fixed-target publisher for the existing two-file browser-relay
page artifact. It implements the three methods expected by the dormant live
operation—`publishRunner`, `verifyRunner`, and `removeRunner`—without wiring them
into that operation, acquiring a credential, making a request, publishing the
site, or authorizing a staging run.

Import and construction perform no network, cloud, command, browser, timer, or
filesystem-mutation work. The production factory accepts one explicitly injected
ephemeral operator OAuth session and two entries previously reopened and verified
by `browser-relay-page/readAndVerifyBrowserRelayPageArtifact`. A separate testing
entry admits injected clock, wait, and HTTP implementations; the recorded
preflight uses only synthetic bytes and response transcripts.

## Fixed target and artifact

The publisher can address only the default Firebase Hosting site
`miakapp-v4-staging` and the origin `https://miakapp-v4-staging.web.app`. Its
artifact must contain, in order:

1. `/__acceptance/browser-relay/` as non-empty HTML; and
2. one content-addressed JavaScript file below
   `/__acceptance/browser-relay/assets/`.

Both raw and deterministic gzip Buffers are bounded to 2 MiB. Sizes, content
types, raw SHA-256, gzip SHA-256, and gzip decompression are independently checked
and privately copied before any request can run. Publication uses the exact
no-store/CSP/security header map prepared by the page builder. No arbitrary path,
site, project, origin, header, label, message, upload URL, retry policy, or HTTP
implementation crosses the production API.

## Safe baseline

`publishRunner(context)` first performs read-only management and public checks. It
requires the exact default site, a complete at-most-100 version/release inventory,
zero non-deleted versions, a latest `SITE_DISABLE` release, and a 404 for both
acceptance files. Historical versions are allowed only in `DELETED` state. This
precondition matters because cleanup disables the entire default staging site;
the publisher must never replace or disable unrelated live content.

After that gate, one invocation may perform, once and in order:

1. create one version with fixed labels and headers;
2. populate exactly the two content-addressed gzip hashes;
3. upload each hash requested by Firebase at most once;
4. finalize the owned version; and
5. create one exact deployment release.

Each response is streamed under a 64 KiB management ceiling, each call has a
30-second timeout, and the caller's exact public-window signal fences all forward
work. A dispatched mutation is never automatically retried. A missing response is
therefore an ambiguous outcome, not permission to repeat it.

`verifyRunner(context)` accepts only the identical operation context after a
successful publication. It performs bounded read-only polling until both public
files have exact bytes, content types, and security headers. Read-only polling is
limited to 30 attempts, two seconds apart, within the operation callback deadline.

`removeRunner()` runs without the forward abort signal so safety-reducing cleanup
remains possible after a partial forward failure. If the version name is known,
it attempts exactly one `SITE_DISABLE` release and one version deletion. It then
uses bounded read-only polling to prove both files return 404, every visible
version is deleted, the owned version is present as `DELETED`, and the latest
release is safely disabled. Successful observation may reconcile an ambiguous
cleanup response; it never causes a mutation replay. If version creation was
ambiguous before a name was returned, only a fully disabled inventory with no
active version can close cleanup. Otherwise the operation fails closed for a
later explicit recovery preflight.

The OAuth string remains only in the private publisher closure and transient HTTP
headers. Raw responses, version/release names, credentials, and artifact bytes do
not cross the operation API. JavaScript strings cannot be securely erased, so the
future owner must still implement and review the separately gated authority
attenuation before live use.

The immutable profile records zero real credentials, DNS, external requests,
cloud mutations, Hosting publications, public-ingress changes, live executions,
and incremental cost. Implemented dormant code is not staging evidence.

Validate it with:

```sh
sh infrastructure/staging/browser-relay-hosting-publisher/check.sh
```
