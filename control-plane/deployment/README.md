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
