# Private staging invocation path

Status: one successful private discovery response after two pinned failures; recovery consumed

This isolated Terraform root created the cheapest bounded path able to reach
the internal-only staging control plane without changing its ingress. It
enabled the Workflows API and created one unscheduled Workflow in Paris. The
Workflow uses the existing `miakapp-staging-probe` identity, which can invoke
only the underlying `control-plane` Cloud Run service.

The Workflow contains a fixed, argument-free `GET` to
`/.well-known/miakapp-control-plane`, OIDC authentication with the exact service
root as audience, a 30-second timeout and no retry. It has no trigger,
scheduler, input-controlled URL, Firebase token or App Check token. Call
logging is disabled and execution history remains `BASIC`.

The discovery route performs no Miakapp application write. A cold start loads
all five Secret Manager values and verifies the KMS public key before the route
is served, so the successful response validates the real secure runtime without
creating Firestore, Storage or FCM data. It does not validate Firebase Auth or
App Check; those remain separate gates.

## Deployment boundary

The GCS backend prefix is `terraform/probe`. Its state contains three managed
resources, one data resource and one output at serial 3 with nothing tainted.
This keeps the Workflow and API state separate from the converged bootstrap,
foundation and Function states. There is no destroy entry point. Both managed
cloud resources have `prevent_destroy`, enabling the API is non-destructive on
teardown, and the Workflow has deletion protection.

Planning and applying used a short-lived private bundle outside the repository.
The exact create-three/update-zero/delete-zero plan has SHA-256
`b7ef650d00215db3644de1e76107b3096425022903f83a40071eaff7e984f3d9`.
Apply consumed only that reviewed binary plan and required a zero-change
convergence plan. The Terraform source remains the historical, single-purpose
deployment contract; it is not a general update or replay path.

## Bounded execution history

The first execution authenticated through internal ingress but received a
controlled `503 service_unavailable`. A separate read-only boundary
reproduction found a latent incompatibility with Secret Manager's equivalent
numeric project representation. The original execution had no classified
startup log, so it could not independently identify which initialization
boundary produced the `503`.

A compatibility correction was deployed without making a request. The bounded
recovery then made exactly one second execution with no Workflow or client
retry. It reached the corrected private Function but received the same
controlled `503`, and the wrapper stopped immediately.

The diagnostic Function deployment changed no ingress, IAM, network, scaling
or runtime document. It removed assumptions about optional Cloud Run project
environment variables and emits only a fixed initialization event plus a
coarse stage. No error message, stack, resource name, execution identifier or
trace context is logged by that diagnostic. The revision active for this
historical execution, `control-plane-00003-hum`, is pinned to source SHA-256
`86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358`.

The revised recovery path pinned both existing failures, the diagnostic
Function revision, source and deployment commit. It verified the two-execution
inventory and workload twice, then made exactly one third execution with no
retry. That execution succeeded in 956 ms and returned HTTP 200 with the exact
`miakapp.control-plane-discovery/1` document. The postcondition observed exactly
three executions: two failures and one success.

`recover.sh` is now consumed. Its two-execution preflight fails closed against
the recorded three-execution inventory, so it cannot make a fourth request.
`invoke.sh` also remains consumed because it accepts only an empty execution
history.

## Public evidence boundary

The canonical sanitized [`result.json`](result.json) has SHA-256
`ea3245756727eaf071f2edc6ef55ba1b730c5e3f61e38746fb7cbf36e8f4ef05`.
[`evidence.mjs`](evidence.mjs) pins its exact bytes and closed object graph and
rejects execution UUIDs, trace contexts, stacks, raw diagnostics and unknown
fields. The public artifact contains only reduced execution profiles, the
successful response, reviewed revisions and hashes, bounded counts, and
explicit negative claims for Firebase Auth, App Check and application mutation.
Raw execution responses, identifiers, trace contexts, request logs and private
diagnostics remain outside the repository.
