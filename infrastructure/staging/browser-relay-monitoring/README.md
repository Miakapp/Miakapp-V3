# Closed staging browser-relay monitoring contract

This package defines the only monitoring observations and budget limits that a
future browser-relay acceptance orchestrator may use. It is deliberately an
in-process library: there is no command-line entrypoint, scheduler, dashboard,
alerting policy, saved credential or cloud resource. Importing it performs no
network request and authorizes neither a cloud mutation nor public ingress.

The read-only preflight checks six existing Cloud Monitoring descriptors and
runs a five-minute `HEADERS` query for each one. Raw points, labels, time series,
API errors and resource names are discarded. Only the number of bounded series
headers is retained. The queries cover:

- Cloud Run request count, instance count and billable instance time for the
  control plane and the two staging relay services;
- Firestore document writes;
- reCAPTCHA Enterprise assessments; and
- Cloud KMS peak QPS availability. Exact KMS signature counts still come from
  the closed acceptance runner because Cloud Monitoring exposes peak activity,
  not a per-operation signing counter.

The same preflight verifies the existing `Miakapp V4 staging monthly` billing
budget: EUR 10 monthly, project-only, credits included, thresholds at EUR 2,
5 and 10, and project-level recipients enabled. The billing account identifier
is private input and only its already-reviewed SHA-256 digest may leave memory.
The API quota project is always `miakapp-v4-staging`.

Before producing a successful preflight result, the live boundary observer must
also prove that the control plane is in its exact canonical private state and
both relay services are in their exact private-ready state with no public IAM
member. This orders monitoring before any public ingress transition.

`evaluateMonitoringSample` accepts only the counters and durations named in the
profile. It returns either `within_reviewed_bounds` or
`stop_and_rollback_required` with stable reason identifiers. It never accepts or
returns tokens, identities, request contents, home traffic or browser artifacts.

The immutable profile deliberately continues to describe the implementation
increment itself and therefore records no live evidence. After that increment
merged, the exact implementation commit ran one read-only preflight at the
private boundary. The sanitized
[`preflight-result-v1.json`](preflight-result-v1.json) records six successful
allow-listed queries, zero returned series headers, the reviewed EUR 10 budget
shape, zero cloud mutations, zero public-ingress changes and zero acceptance
executions. Browser-relay plan revision 11 pins both profile and result digests,
so `MONITORING-01` is satisfied without rewriting the historical profile or
claiming that the acceptance matrix ran.
