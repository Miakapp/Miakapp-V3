# Dormant browser-relay operator authority source

This package is the parent-side boundary between one locally configured Google
user and the existing trusted-provider process authority channel. It can obtain
one OAuth access token, verify that token belongs to the private staging operator,
and expose its bytes to exactly one trusted asynchronous callback. It has no CLI,
scheduler, provider implementation, Hosting publisher, or live-operation wiring.

Import and construction perform no command, credential, network, cloud, or
filesystem-mutation work. The first `consume` call is the only path that can run
the fixed command and principal-verification sequence. The current profile and CI
exercise that path with synthetic injected implementations only; this package has
not acquired a real credential or contacted the userinfo endpoint.

## Exact acquisition

The production entry runs only `gcloud`, without a shell, from the repository
root and with the common sanitized child environment. Standard input is ignored;
stdout and stderr are bounded to 64 KiB. It performs, once and in order:

1. `config get-value account --quiet`;
2. `config get-value auth/impersonate_service_account --quiet`; and
3. `auth print-access-token --account=<verified account> --quiet`.

The first result must be a lowercase email whose SHA-256 equals the reviewed
private operator pin. The second must be empty or `(unset)`. The third must be a
printable, whitespace-free Buffer of 20 through 16,384 bytes. Application Default
Credentials, service-account keys, configured impersonation, environment token
overrides, arbitrary gcloud commands, scopes, accounts, and targets are not
accepted.

The bearer is checked once with an exact no-store request to
`https://openidconnect.googleapis.com/v1/userinfo`. The bounded JSON response must
report that same email and `email_verified: true`. The private email and response
never appear in the public result.

## One-use callback

```js
import {
  createBrowserRelayOperatorAuthoritySource,
} from './source.mjs';

const source = createBrowserRelayOperatorAuthoritySource();
const result = await source.consume(
  (authority, { expires_at_milliseconds, signal }) => ownerProcess.execute({
    authority,
    signal,
  }),
  { signal: operatorAbortSignal },
);
await source.close();
```

The callback receives the owned Node `Buffer`, one deadline no more than 25
minutes after acquisition begins, and the signal linking caller cancellation,
source close, and that local deadline. The result must be bounded JSON-safe closed
data without credential-shaped fields or bytes. Callback errors and all external
diagnostics collapse to fixed error codes. A second consume, concurrent consume,
consume after close, expired window, principal drift, or malformed response fails
closed. `close()` is idempotent, signals in-flight work to abort, and waits for
settlement. Because the callback is trusted same-process code, an uncooperative
callback cannot be forcibly terminated and can ignore that signal.

Command outputs, principal-response bytes, and the owned authority Buffer are
overwritten in `finally`. This is best-effort application-memory hygiene, not
secure erasure. Building an HTTP Authorization header necessarily creates a
transient immutable JavaScript string that cannot be erased, and trusted callback
code can deliberately copy the bearer. The underlying Google user access token is
also not cryptographically audience-restricted. The local deadline and fixed code
path narrow its use; the separately gated seven-provider attenuation remains
required before live execution.

The profile grants no authority to acquire real credentials, contact external
services, mutate cloud state, publish Hosting content, expose ingress, or execute
the staging matrix. Those actions require a later reviewed composition and the
existing exact live authorization boundary.

Validate the dormant package with:

```sh
sh infrastructure/staging/browser-relay-operator-authority-source/check.sh
```
