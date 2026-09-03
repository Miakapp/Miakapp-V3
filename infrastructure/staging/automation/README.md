# Guarded staging Terraform plan-and-apply automation

Status: protected manual keyless foundation apply authorized; not yet executed

The YAML and scripts in this directory describe the complete reviewed path for
the initial staging foundation. The active workflow at
`.github/workflows/staging-terraform.yml` is byte-identical to this blueprint
and bound to policy SHA-256
`b506f7561dd5fb6ddb9e9c1d525f11cfe31cfce68e2cbabd544f068d0bfc8d32`.
It becomes active only through protected `main`.

The infrastructure reserves two separately admitted GitHub environments and
two separate Google service accounts. Both OIDC providers require the immutable
numeric
repository and owner IDs, `main`, the exact workflow reference, and the expected
environment claim. The planner can read infrastructure, manage only `.tflock`
objects, and create private saved plans; it cannot create or replace state. Only
the deployer receives resource mutation roles, and those exclude
project IAM, service-account administration and project-wide Storage so the
deployer cannot rewrite its own trust boundary or the bootstrap state.

The workflow has policy, plan, and apply jobs. The plan job writes a saved plan
to the private state bucket with a create-only
object precondition and a planner identity that lacks delete/replace authority
for `plans/`. Public logs contain only bounded action counts and resource
addresses, never planned values. Before upload, the plan must also pass the
closed `initial-foundation` policy, including its exact graph, actions, planned
values, prior bootstrap output, critical unknown-value references and Terraform
checks. The plan job cannot request the deployer identity.

The apply job depends on both earlier jobs and on explicit approval in the
`miakapp-v4-staging-apply` environment. `apply.sh` accepts only the exact private
object path and SHA-256 emitted by the same workflow attempt, repeats the closed
plan validation immediately before Terraform, and applies that saved binary
without replanning. It then runs a private, non-saving plan and succeeds only if
Terraform reports complete convergence. Detailed plans and apply logs remain in
discarded runner files.

`inspect-plan.sh` is the separate operator inspection path. It downloads and
verifies the private plan, initializes only the pinned local provider schemas,
runs the same closed plan policy, then renders it locally from the Terraform
root. It is read-only against Google Cloud and successfully inspected the latest
plan from run `33774848684`, SHA-256
`5def42ea3f598a5f2c59d9456814646c1b526526c6b96acf20a0db7626bc36da`.

The apply environment records one explicit reviewer and allows that reviewer to
approve their own manually dispatched run because the repository has
only one human administrator. This is a deliberate two-step operator check, not
independent four-eyes approval. Administrator bypass must still be disabled.

Saved plans are sensitive. The bucket policy deletes the live object after two
days and its archived version after one further day; seven-day bucket soft delete
can retain recoverable bytes longer. The workflow never uses public GitHub
artifact storage.

`github-policy.json` preserves the independently observed GitHub settings and
authorizes this exact initial-foundation workflow. Its policy job verifies the
active file, blueprint, digest, and apply authorization before either cloud job
can request OIDC credentials. The closed initial plan shape means that after the
foundation exists, another dispatch fails before uploading or applying a plan.
