# Miakapp 4 staging intent

Status: planning only; no cloud project or resource has been created

This directory records the reviewable infrastructure intent for the future
`miakapp-v4-staging` project. It is deliberately not Terraform, Firebase CLI
configuration, or a deployment workflow. Merging it does not reserve a project
ID, link billing, enable an API, authenticate to Google Cloud, or deploy code.

## Safety boundary

[`manifest.json`](manifest.json) is a closed, machine-validated policy. The
current revision requires all of the following:

- the only staging target is `miakapp-v4-staging`;
- `miakapp-3`, `miakapp-v4`, and every `demo-*` project are invalid targets;
- project creation, billing linkage, deployment, public ingress and CI cloud
  authentication remain disabled;
- the root Firebase default remains the untouched `miakapp-3` legacy project,
  and no staging alias is allowed;
- staging data is synthetic only;
- the regional intent is consistently `europe-west1`, but is not marked reviewed
  because Firestore and bucket locations become difficult or impossible to
  change after creation;
- the Function scales to zero and is capped at one instance;
- the component bucket is private, uses uniform access and Public Access
  Prevention, has no CORS origin, versioning, retention lock or soft-delete
  window in the initial cost posture;
- no load balancer, forwarding rule, Cloud Armor policy, VPC connector, Cloud
  NAT, minimum instance or Analytics property is accepted; and
- secret values, broad project roles and human IAM bindings cannot be represented
  by the schema.

The manifest names resources and intended access so they can be reviewed before
an infrastructure implementation exists. It does not assert that those resources
or bindings already exist. The FCM runtime permission intentionally remains
unresolved until the real transport adapter determines the narrow deployable
role.

## Planned inventory

| Boundary | Initial intent |
|---|---|
| Project | `miakapp-v4-staging`, not created, no billing account |
| Compute | one second-generation `controlPlane` Function in `europe-west1`, `minInstances=0`, `maxInstances=1` |
| Firestore | default Standard regional database, deletion protection enabled, three explicit TTL fields |
| Storage | dedicated private component bucket, not the Firebase default bucket |
| Signing | software Ed25519 Cloud KMS key; manual version lifecycle |
| Secrets | five named Secret Manager resources, automatic replication, at most two active versions each |
| Identity | one dedicated runtime service account and resource-scoped access inventory |
| Cost | EUR 2/5/10 alert thresholds, no free-tier assumption, no hard-cap claim |
| Teardown | manual, independently inventoried, typed project-ID confirmation |

Cloud KMS key rings cannot be deleted. Budget alerts can arrive late and do not
stop spend. The Cloud Run spend-cap preview covers only eligible compute and is
not enabled or treated as a project-wide safety boundary here.

## Validate locally

Node.js 22 is the only requirement:

```sh
npm run test:staging-manifest
```

The check parses the bounded manifest, rejects unknown fields and policy drift,
verifies the legacy `.firebaserc` default, and runs adversarial mutations. It
does not invoke Firebase, `gcloud`, Terraform, the network, or a credential
provider. The matching CI workflow has only `contents: read` permission and no
OIDC or secret access.

The control-plane now also has an inactive, locally tested production
composition: a closed runtime/resource parser, pinned Secret Manager reads, an
Ed25519 Cloud KMS signer, standard Firebase Admin App Check verification,
FID-targeted FCM messaging and a production Storage boundary. The manifest
records that unit-test evidence without claiming real-service acceptance. The
Function entry point still imports only the demo-emulator composition; the
inactive factory is never called by Firebase configuration. IAM bindings, a
deployable `onInit()` entry point, live key publication/rotation and every
`STAGE-*` observation remain activation blockers. No project or billable
operation results from this code.

The inactive factory pins metadata credentials to
`miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com`, pins the
standard Google API universe/endpoints, disables generated-client retries and
rejects credential-file, emulator, quota-project, universe and SDK-debug
environment overrides, including alternate metadata hosts. This is a locally
verified construction constraint, not evidence that the account or its IAM
bindings exist.

## Activation gate

Before this planning record can become deployable infrastructure, a separately
reviewed change must:

1. resolve every item in `readiness.required_blockers` with production adapters
   and evidence;
2. obtain explicit operator approval for the immutable locations, project
   creation and billing linkage;
3. define the deployer identity and exact FCM permission without broad roles;
4. keep the project target explicit in every command and workflow;
5. add a dry-run/plan artifact that cannot target legacy or production; and
6. rehearse [`TEARDOWN.md`](TEARDOWN.md) before opening public ingress.

Passing this manifest gate authorizes none of those actions. The real-service
acceptance work remains the `STAGE-01` through `STAGE-09` matrix in
[`../../control-plane/FAULT-MATRIX.md`](../../control-plane/FAULT-MATRIX.md).

## References

- [Firebase environment isolation](https://firebase.google.com/docs/projects/dev-workflows/overview-environments)
- [Firebase infrastructure with Terraform](https://firebase.google.com/docs/projects/terraform/get-started)
- [Manage Functions instances](https://firebase.google.com/docs/functions/manage-functions)
- [Firebase billing safety](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)
- [Cloud Billing budgets](https://cloud.google.com/billing/docs/how-to/budgets)
- [Firebase project locations](https://firebase.google.com/docs/projects/locations)
- [Cloud Storage uniform bucket-level access](https://cloud.google.com/storage/docs/uniform-bucket-level-access)
- [Secret Manager best practices](https://cloud.google.com/secret-manager/docs/best-practices)
- [Cloud KMS IAM](https://cloud.google.com/kms/docs/iam)
