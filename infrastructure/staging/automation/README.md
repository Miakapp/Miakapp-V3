# Plan-only staging Terraform automation

Status: manual keyless planning active; first private plan strictly reviewed

The YAML and scripts in this directory describe the reviewed keyless plan path
and a separately dormant future apply path. The active workflow candidate at
`.github/workflows/staging-terraform.yml` is byte-identical to this blueprint
and bound to policy SHA-256
`13fd21ad1fa1fdbfec88cefc4af048643eb7a2078d8f33eb0e840c54a3238336`.
It is installed on protected `main` and completed its first successful keyless
plan run.

The infrastructure reserves two separately admitted GitHub environments and
two separate Google service accounts. Both OIDC providers require the immutable
numeric
repository and owner IDs, `main`, the exact workflow reference, and the expected
environment claim. The planner can read infrastructure, manage only `.tflock`
objects, and create private saved plans; it cannot create or replace state. Only
the deployer receives resource mutation roles, and those exclude
project IAM, service-account administration and project-wide Storage so the
deployer cannot rewrite its own trust boundary or the bootstrap state.

The installed workflow contains only policy and plan jobs. The plan job writes
a saved plan to the private state bucket with a create-only
object precondition and a planner identity that lacks delete/replace authority
for `plans/`. Public logs contain only bounded action counts and resource
addresses, never planned values. Before upload, the plan must also pass the
closed `initial-foundation` policy, including its exact graph, actions, planned
values, prior bootstrap output, critical unknown-value references and Terraform
checks. It contains no apply job and cannot request the deployer identity.

`apply.sh` is retained as reviewed future code, but it is not referenced by an
active workflow and now requires the separate
`foundation_apply_authorized` policy bit. That bit is false. The policy CLI
therefore rejects apply before credential-file validation or any Terraform or
Google API access, even under an otherwise valid GitHub context.

`inspect-plan.sh` is the separate operator inspection path. It downloads and
verifies the private plan, initializes only the pinned local provider schemas,
runs the same closed plan policy, then renders it locally from the Terraform
root. It is read-only against Google Cloud and successfully inspected plan
SHA-256 `d90f4d2243a7754372c059f1fcd5297a23c317cbcdc9b9ff734c66575f347d3f`.

The required future apply policy records one explicit reviewer and allows that
reviewer to approve their own manually dispatched run because the repository has
only one human administrator. This is a deliberate two-step operator check, not
independent four-eyes approval. Administrator bypass must still be disabled.

Saved plans are sensitive. The bucket policy deletes the live object after two
days and its archived version after one further day; seven-day bucket soft delete
can retain recoverable bytes longer. The workflow never uses public GitHub
artifact storage.

`github-policy.json` preserves the independently observed pre-installation
GitHub settings while separately authorizing only workflow installation and
manual cloud planning. Its policy job verifies the active file, blueprint, and
digest before the plan job can request OIDC credentials. Foundation apply
requires another reviewed policy transition after the private plan is inspected.
