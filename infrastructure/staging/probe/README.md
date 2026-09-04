# Private staging invocation path

Status: two pinned failures; diagnostic Function deployed; third execution not invoked

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

The first execution authenticated through internal ingress but received a
controlled `503 service_unavailable`. A separate read-only boundary
reproduction found that Secret Manager canonicalizes the staging project ID in
response names to its equivalent numeric project and that the runtime rejected
that valid representation. The original execution had no classified startup
log, so it could not independently identify which initialization boundary
produced the `503`. A compatibility correction was deployed without making a
request.

The bounded recovery then made exactly one second execution with no Workflow
or client retry. It reached the corrected private Function but received the
same controlled `503`. The wrapper stopped immediately. There are exactly two
failed executions and no success; their identifiers, trace contexts and raw
diagnostics remain private.

`recover.sh` was the single-purpose path used for that second execution. It
accepted only the exact first failure, corrected Function revision and an
authorization bound to the then-current `origin/main`. Its one-execution
preflight now fails closed because the second execution exists, so it cannot
make another request.

The diagnostic Function deployment changed no ingress, IAM, network, scaling
or runtime document. It removed assumptions about optional Cloud Run project
environment variables and emits only a fixed initialization event plus a
coarse stage. No error message, stack, resource name, execution identifier or
trace context is logged by that diagnostic. Active revision
`control-plane-00003-hum` is pinned to source SHA-256
`86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358`.
The deployment made no Function request.

Cloud Run's deployment health check proved the container healthy but did not
execute the Firebase `onInit` callback: the SDK runs that callback immediately
before the first application request. The next diagnostic therefore still
requires one private Workflow execution.

The revised `recover.sh` pins both existing failures by exact timestamp,
Workflow revision, step, HTTP shape and non-retained trace format. It pins the
new Function revision, source and deployment commit, verifies the two-execution
inventory and workload twice, then permits exactly one Workflow execution with
no retry. A success must leave exactly the two original failures followed by
one validated discovery response. A failure stops immediately and leaves only
private diagnostics; a fourth execution cannot pass the three-execution
postcondition or either future two-execution preflight.
