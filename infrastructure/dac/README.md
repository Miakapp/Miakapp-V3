# Miakapp V4 staging on DAC

Since 2026-10-11 the `miakapp-v4-staging` GCP project has billing disabled.
Firebase Auth, App Check (reCAPTCHA Enterprise), Firestore and Hosting keep
working on the free tier; the control plane and the relay run on the DAC
Kubernetes cluster instead of Cloud Run.

| Piece | Where |
| --- | --- |
| Web app, `/pair` | Firebase Hosting, `https://miakapp-v4-staging.web.app` (`scripts/deploy-staging.sh`) |
| Control plane | `https://miakapp-api.dac.cclabs.cx`, `control-plane/src/self-hosted-server.ts` |
| Relay | `wss://miakapp-relay.dac.cclabs.cx/ws`, `Miakapp-Server` |
| Identity, data | Firebase project `miakapp-v4-staging` |

`miakapp-staging.yaml` is the whole workload. Both pods build the public
source at the commit pinned in their `COMMIT` variable (the GHCR packages are
private and the cluster has no pull credential); bump it to deploy. If the
packages become public, switch to `ghcr.io/miakapp/miakapp-control-plane` and
`ghcr.io/miakapp/miakapp-server`.

## Out-of-band objects (namespace `miakapp-staging`)

- Secret `control-plane-keys`: `kms-access-token-signing-3.pem` (Ed25519
  PKCS#8) and `secret-miakapp-<purpose>-2` (32 random bytes, base64) for
  `home-key-pepper`, `component-hmac`, `push-hmac`, `audit-hmac`,
  `network-hmac`. See `control-plane/src/self-hosted-runtime.ts`.
- Secret `control-plane-service-account`: `sa.json`, a key of
  `miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com`.
- ConfigMap `control-plane-runtime`: `runtime-config.json`, a
  `miakapp.production-runtime/2` document with issuer
  `https://miakapp-api.dac.cclabs.cx` and the public JWK of the key above.

The Home Key pepper changed with the move: Home Keys issued by the Cloud Run
control plane no longer authenticate. Pair again through `/pair`.

## Known limits

- Both services see the Traefik pod as the client address, so per-source
  throttling is effectively global. The relay's per-IP limits equal its global
  ones for that reason.
- Artifacts published before the move point at the Cloud Run origin and are
  refused by the web app; publish again.
- The CLI's default issuer is `https://control.miakapp.com`. Staging needs
  `miakapp pair --issuer https://miakapp-api.dac.cclabs.cx`, which `/pair`
  prints.
