# Closed staging browser-relay rollback preflight

This package fixes the rollback target and proves that it is observable before
the browser-relay acceptance window can be opened. It is a dormant in-process
library: there is no CLI, scheduler, deployer, saved credential or cloud
resource. Importing it performs no request and grants no cloud mutation, public
ingress or acceptance-execution authority.

The profile pins browser-relay plan revision 11, its successful monitoring
preflight, the closed three-engine runner, the exact private-ready relay state
and every source file in the existing edge state machine. Its six ordered
rollback steps are byte-for-byte identical to the acceptance plan. Routine
rollback retains both relay services and signing keys; it removes public access
and returns them to scale-to-zero private operation.

The cloud observer is read-only. It requires all of the following at the same
preflight boundary:

- the canonical internal-only control plane with no unauthenticated invoker;
- two exact digest-pinned, keyless, roleless, private-ready relays whose live
  inventory matches the committed successful result;
- a disabled Hosting route with all six historical versions deleted;
- zero Firebase Auth users and exactly the three technical Firestore root
  collections, with no application fixture collection;
- zero temporary acceptance IAM bindings and zero public project binding; and
- an independently rendered Terraform 1.11.3 private-ready plan containing
  four managed-resource no-ops, one output no-op and no create, update, delete
  or replacement.

Only `GET`, `HEAD` and the two read-only Google `POST` methods
`documents:listCollectionIds` and `projects.getIamPolicy` are reachable. Raw
cloud responses, Terraform state, Terraform plan bytes, credentials, user IDs,
Home traffic and browser diagnostics cannot enter the closed result.

The post-merge preflight completed at `2026-09-06T07:06:13.282Z` from exact
implementation commit `0fd0d05ee31f84d42cf69cc6f5cead9cbcad79be`. Its
sanitized result is committed as
[`preflight-result-v1.json`](preflight-result-v1.json), with SHA-256
`e8ceb2164be946d4edebfe2f08d8a3b230dcf9d2a05d9410738e751775950cd3`.
It observed the exact canonical-private target and a zero-change Terraform
plan without a cloud mutation, public-ingress change or acceptance execution.
Plan revision 12 pins that result and marks `ROLLBACK-01` satisfied. Only
`EDGE-01` and every `LIVE-*` row remain open.
