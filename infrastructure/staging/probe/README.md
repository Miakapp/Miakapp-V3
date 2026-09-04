# Private staging invocation path

Status: deployed; one pinned failed execution; recovery not yet invoked

This isolated Terraform root creates the cheapest bounded path able to reach the
internal-only staging control plane without changing its ingress. It enables the
Workflows API and creates one unscheduled Workflow in Paris. The Workflow uses
the existing `miakapp-staging-probe` identity, which can invoke only the
underlying `control-plane` Cloud Run service.

The Workflow contains a fixed, argument-free `GET` to
`/.well-known/miakapp-control-plane`, OIDC authentication with the exact service
root as audience, a 30-second timeout and no retry. It has no trigger, scheduler,
input-controlled URL, Firebase token or App Check token. Call logging is disabled
and basic execution history contains only the public discovery response.

The discovery route performs no Miakapp application write. A cold start still
loads all five Secret Manager values and verifies the KMS public key before the
route is served, so one successful invocation validates the real runtime without
creating Firestore, Storage or FCM data. It does not validate Firebase Auth or
App Check; those remain separate gates.

The GCS backend prefix is `terraform/probe`. This keeps the Workflow and API
state separate from the already converged bootstrap, foundation and Function
states. There is no destroy entry point. Both managed resources have
`prevent_destroy`, enabling the API is non-destructive on teardown, and the
Workflow has deletion protection.

Planning and applying used a short-lived private bundle outside the repository.
The apply consumed only the exact reviewed binary plan and then required a
zero-change convergence plan. The original invocation remains a separate
one-shot operation: its wrapper refuses any Workflow that already has an
execution and never retries.

That first execution authenticated through internal ingress but received a
controlled `503 service_unavailable`. Secret Manager had canonicalized the
staging project ID in each response name to its equivalent numeric project;
the runtime's stricter comparison rejected that representation before serving
discovery. The execution identifier, trace context and raw diagnostics remain
private.

`recover.sh` is a different, single-purpose path. It accepts only that exact
failed execution (including Workflow revision, timestamps, step, HTTP status
and non-sensitive error shape), the exact corrected Function revision and an
authorization bound to the current `origin/main`. It checks the one-execution
inventory twice, makes exactly one new Workflow execution with no Workflow or
client retry, then requires exactly the original failure plus one success. It
cannot accept any other failure or run after a second execution already exists.
Only a sanitized result without execution IDs or trace context may be
committed.
