# Guarded staging Terraform partial-recovery automation

Status: protected manual keyless partial-foundation recovery authorized

The YAML and scripts in this directory describe the bounded recovery path after
the initial staging foundation apply stopped with partial state. The active workflow at
`.github/workflows/staging-terraform.yml` is byte-identical to this blueprint
and bound to policy SHA-256
`701891a221ee949c5b1f0d67e537911fc7fa1476f46c5e670593eb341f2cae2e`.
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
addresses, never planned values. Before upload, the plan must pass the closed
`partial-foundation-recovery` policy: exactly 25 no-ops and eight additive IAM
creates, the exact partial prior-state inventory, seven accepted refresh-only
provider normalizations, fully known targets, critical references and passing
Terraform checks. The plan job cannot request the deployer identity.

The apply job depends on both earlier jobs and on explicit approval in the
`miakapp-v4-staging-apply` environment. `apply.sh` accepts only the exact private
object path and SHA-256 emitted by the same workflow attempt, repeats the closed
plan validation immediately before Terraform, and applies that saved binary
without replanning. The eight IAM writes are serialized to avoid competing
read-modify-write operations on the same policy. It then runs a private,
non-saving plan and succeeds only if Terraform reports complete convergence.
Detailed plans and apply logs remain in discarded runner files.

`inspect-plan.sh` remains the read-only operator path for historical initial
plans. The partial recovery was independently planned and fully reviewed from
state generation `1788452068422403`: exactly eight creates, 25 no-ops and no
configuration update or delete. Its temporary local saved plan passed the new
profile and was removed after validation.

The apply environment records one explicit reviewer and allows that reviewer to
approve their own manually dispatched run because the repository has
only one human administrator. This is a deliberate two-step operator check, not
independent four-eyes approval. Administrator bypass must still be disabled.

Saved plans are sensitive. The bucket policy deletes the live object after two
days and its archived version after one further day; seven-day bucket soft delete
can retain recoverable bytes longer. The workflow never uses public GitHub
artifact storage.

`github-policy.json` preserves the independently observed GitHub settings and
authorizes this exact one-shot recovery workflow. Its policy job verifies the
active file, blueprint, digest, and apply authorization before either cloud job
can request OIDC credentials. Any resource inventory or action change fails
before a plan can be uploaded or applied; after successful convergence, this
authorization is retired in a separate protected change.
