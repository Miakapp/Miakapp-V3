# Private staging control-plane workload

This is the third, workload-only Terraform state for `miakapp-v4-staging`. It
reads but never owns the reconciled bootstrap and foundation states. Its GCS
backend prefix is `terraform/workload`, so a Function deployment cannot alter
the 37-resource bootstrap or 33-resource foundation evidence.

The initial graph contains exactly:

- one deterministic source ZIP in a dedicated private Paris bucket;
- one private Paris Docker repository and a build-only service account with
  repository writer, source-object viewer and log-writer access. A conditional
  project grant additionally permits reads only from Google's regional
  `gcf-v2-sources-*` object prefix used during the Function build;
- one Gen 2 `nodejs22` Function using the existing runtime identity, the exact
  committed non-secret runtime document, 256 MB, one CPU, concurrency 16,
  `minInstances=0`, `maxInstances=1`, a 30-second timeout and internal-only
  network ingress;
- one custom runtime role containing only `cloudmessaging.messages.create`;
  and
- one keyless synthetic probe account with `roles/run.invoker` on only the
  underlying Cloud Run service. The private operator receives only
  `iam.serviceAccounts.getOpenIdToken` on that probe account.

There is no `allUsers` or `allAuthenticatedUsers` binding, VPC connector, load
balancer, Cloud Armor policy, minimum instance, secret mount, service-account
key or live request. Internal-only ingress means the probe identity is defined
before testing but cannot be called directly from an internet workstation.
Choosing and pricing a public ingress path remains a later gate.

## Guarded plan and apply

Both commands require a clean checkout at the exact `origin/main` commit, the
pinned toolchain, normal local User ADC and the reviewed Google user. The raw
user email exists only in a mode-0600 private variable file and Terraform plan;
the repository records only its SHA-256 fingerprint.

Create the initial plan in an existing private parent outside the repository:

```sh
MIAKAPP_STAGING_WORKLOAD_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/workload/plan.sh /private/tmp
```

The plan command builds the source twice-tested deterministic archive, uses the
real locking backend, permits only the closed 15-create/zero-update/zero-delete
graph, and prints the exact short-lived authorization token. Terraform may
create its canonical empty workload state while initializing the previously
absent backend prefix; no workload is applied by this command.

Apply only that saved binary plan:

```sh
MIAKAPP_STAGING_WORKLOAD_APPLY_AUTHORIZATION='apply-private-workload:...' \
  ./infrastructure/staging/workload/apply.sh /private/tmp/miakapp-staging-workload-XXXXXX
```

Apply output and any provider failure remain private. Success requires a fresh
zero-change plan and independent Cloud Functions, Cloud Run, IAM, Storage and
Artifact Registry inventory. The inventory explicitly performs no Function
request and writes a private, non-secret `result.json` for later review.

No destroy entry point exists. Resources with meaningful identity or storage
carry `prevent_destroy`; generated source bytes remain reproducible from the
reviewed commit.

## Bounded first-build recovery

The first saved-plan apply reached Cloud Build but stopped before a Cloud Run
service or revision existed because the custom build identity could not read
Google's regional `gcf-v2-sources-*` copy. Successfully created prerequisites
remain tracked in the workload state. The plan validator therefore also has one
closed recovery profile: it accepts only the failed Gen 2 Function baseline,
the new conditional source-reader and private invoker creates, an in-place
Function update, and zero deletes. Any replacement, wider IAM scope, different
Function state or additional change is rejected.
