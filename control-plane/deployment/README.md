# Production control-plane package

This directory defines the dependency-locked Node.js 22 package used only by the
staging and future production deployment boundaries. It does not change the
emulator codebase selected by `../firebase.json`.

`package.mjs` compiles the control plane, walks the static module graph rooted at
`production-entrypoint.js`, rejects emulator-only or dynamic imports, and creates
a deterministic ZIP outside the repository. The archive contains only the
production JavaScript modules plus this directory's exact `package.json` and
`package-lock.json`; it contains no runtime configuration, secret payload,
credential or source map.

Run it with an absolute path in a private temporary directory:

```sh
node deployment/package.mjs /private/tmp/control-plane.zip
```

The staging workload wrapper invokes this packager and binds the resulting
SHA-256 digest into its private Terraform plan.

## Firebase session revocation

The runtime verifies Firebase ID tokens with `checkRevoked: true`. Every
Firebase-authenticated API request therefore also reads the account's disabled
state and token-valid-after timestamp; signature verification alone is not
sufficient. Deleted, disabled and revoked accounts receive the same bounded
`401 invalid_firebase_token` response. An account-lookup dependency failure
remains a retryable `503`; it never falls back to signature-only verification.
The emulator entrypoint uses the same adapter. Note that Firebase Admin always
checks account state in emulator mode, even if `checkRevoked` is omitted, so
emulator success alone cannot prove the production flag is enabled.

Before deploying this code, the runtime service account needs
`firebaseauth.users.get` on its own Firebase project. Use a dedicated custom role
containing only that permission, not Firebase Admin/Editor or a user-management
role. For staging the role is `miakapp.controlPlaneAuthReader`, bound only to
`miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com`. Preserve the
existing policy version, conditional bindings and etag when adding the member;
read back the exact role and binding before releasing the function. No user
write, delete, listing, password-hash or token-signing permission is needed.
This additive role is separate from the Terraform-managed FCM role.

This check gates new Firebase-authenticated requests. It does not terminate
already-established relay sessions, revoke previously issued Home Keys or
retroactively cancel an accepted device action.
