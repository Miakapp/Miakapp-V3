# Dormant staging browser-relay edge state machine

This package implements the reversible control-plane network transition needed
by the live browser-relay acceptance matrix. It is deliberately a library, not
an operator entrypoint: there is no shell wrapper, top-level invocation, saved
plan or authorization token. Importing a module performs no network request.
The current staging control plane remains canonical, internal-only and without
an unauthenticated invoker.

The guarded state machine permits only these forward states:

1. exact canonical runtime, private ingress and private IAM;
2. exact staging browser-relay runtime, still-private ingress and IAM;
3. exact staging browser-relay runtime, `ALLOW_ALL` ingress and private IAM;
4. exact staging browser-relay runtime, `ALLOW_ALL` ingress and one `allUsers`
   `roles/run.invoker` member.

The public IAM member is installed last. Rollback removes it first, restores
private ingress second and restores the canonical runtime third. If the first
IAM removal has an ambiguous outcome, rollback still closes ingress and makes
one observed second removal pass. It never restores the canonical runtime while
ingress is open. A callback error or its 900-second execution deadline always
enters the same rollback path, reserving 300 seconds inside the absolute
1,200-second public-window bound for closure and reconciliation.

Both runtime documents are byte-pinned. The edge form differs from the current
canonical form only in the atomic issuer/origin pair:

| Field | Canonical | Bounded edge window |
|---|---|---|
| issuer | `https://control.staging.miakapp.com` | `https://control-plane-aczhngqraq-od.a.run.app` |
| allowed origin | `https://app.staging.miakapp.com` | `https://miakapp-v4-staging.web.app` |

The inventory contract also pins the deployed source, commit, copied source,
function identity, scale 0..1, timeout, concurrency and the sole existing probe
invoker. Unknown roles, members, runtime bytes, origins, projects, services or
source revisions fail before a mutation.

The Cloud adapter uses only the Cloud Run functions v2 Function PATCH and Cloud
Run v2 IAM APIs. Runtime and ingress are separate Function field-mask updates;
IAM uses the current policy etag and replaces only the exact reviewed binding.
Long-running Function operations are bounded and re-observed after completion.
See the official
[Function PATCH reference](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch)
and [Cloud Run IAM reference](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services).

This increment does not satisfy `EDGE-01` by itself. Before any live use, a
later orchestrator must add an atomic single-use claim, bind a private plan to a
merged commit, require the relay, runner, monitoring and rollback preconditions,
persist only sanitized evidence, and expose the state machine through one
bounded execution path. Until then, the package cannot be run from the command
line and authorizes no cloud mutation.
