# Private staging invocation path

Status: reviewed contract, not deployed

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

Planning and applying use a short-lived private bundle outside the repository.
The apply consumes only the exact reviewed binary plan and then requires a
zero-change convergence plan. Invocation is a separate one-shot operation: its
wrapper refuses any Workflow that already has an execution and never retries.
No result is committed until independent validation has removed execution IDs,
operator identity and provider diagnostics.
