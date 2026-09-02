# Dormant staging Terraform automation

Status: blueprint only; not installed under `.github/workflows`; cannot run

The YAML and scripts in this directory describe the supported future keyless
plan/apply path. They are deliberately outside GitHub's active workflow
directory. Copying the blueprint is unauthorized until `github-policy.json` is
replaced by an independently captured, reviewed activation record.

The blueprint uses two separately admitted GitHub environments and two separate
Google service accounts. Both OIDC providers require the immutable numeric
repository and owner IDs, `main`, the exact workflow reference, and the expected
environment claim. The planner can read infrastructure, manage only `.tflock`
objects, and create private saved plans; it cannot create or replace state. Only
the deployer receives resource mutation roles, and those exclude
project IAM, service-account administration and project-wide Storage so the
deployer cannot rewrite its own trust boundary or the bootstrap state.

The plan job writes a saved plan to the private state bucket with a create-only
object precondition and a planner identity that lacks delete/replace authority
for `plans/`. Public logs contain only bounded action counts and resource
addresses, never planned values. The apply job starts only after the
apply-environment approval, downloads the exact object from the same workflow
run, verifies its SHA-256 digest, and applies that saved plan. Terraform rejects
it if another operation made its state stale.

`inspect-plan.sh` is the separate operator inspection path. It downloads and
verifies the private plan, then renders it locally. It is read-only but requires
authorized local Google credentials and has not been run.

The required policy currently records one explicit reviewer and allows that
reviewer to approve their own manually dispatched run because the repository has
only one human administrator. This is a deliberate two-step operator check, not
independent four-eyes approval. Administrator bypass must still be disabled.

Saved plans are sensitive. The bucket policy deletes the live object after two
days and its archived version after one further day; seven-day bucket soft delete
can retain recoverable bytes longer. The workflow never uses public GitHub
artifact storage.

Activation requires a separate reviewed change: configure and re-observe the
GitHub branch/environment/Actions policy, apply and migrate the bootstrap state,
initialize and verify the empty foundation state with protected operator
credentials, replace the policy record with an independently captured active
record, and only then copy this YAML into
`.github/workflows/staging-terraform.yml`. Merely copying the file is
insufficient: its policy job deliberately rejects the current inactive record
before requesting OIDC credentials.
