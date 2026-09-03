# Retired staging Terraform foundation recovery

Status: one-shot partial-foundation recovery completed and retired

The manual keyless workflow that completed the staging foundation recovery is
no longer installed under `.github/workflows/`. Its three activation flags are
false in `github-policy.json`, so neither planning nor applying can be admitted
through that path. GitHub workflow `349440747` was independently observed in
state `disabled_manually` before its active source was removed.

`staging-terraform.yml` is immutable historical evidence of the exact workflow
that ran. Its reviewed SHA-256 remains
`701891a221ee949c5b1f0d67e537911fc7fa1476f46c5e670593eb341f2cae2e`.
It must not be copied back into the active workflow directory without a new,
explicitly reviewed authorization.

The historical workflow separated planning and applying across distinct GitHub
environments and Google service accounts. It stored saved plans privately,
validated the closed `partial-foundation-recovery` resource inventory, required
approval before applying the exact saved binary, serialized the eight IAM
writes, and verified convergence after apply. These details explain the
evidence; they do not grant current authority.

The corresponding cloud exchange path is also retired. Configuration commit
`ee457535a64355cd8133410d9c8c43f039608928` produced a 25,925-byte private plan
with SHA-256
`8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888`.
It contained 35 no-ops and exactly two updates: only `disabled` changed from
`false` to `true` on the plan and apply Workload Identity providers. Apply
reported `0 added, 2 changed, 0 destroyed`; a follow-up plan reported no
changes. The Workload Identity pool remains enabled and retained.

Current bootstrap state generation `1788460174191027` is 61,864 bytes at
serial 42 with 37 managed resources, two data resources and one output. Its
SHA-256 is
`288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d`.
The preceding serial-41 generation remains the historical evidence for planner
role adoption.

Disabling both providers closes the reviewed GitHub OIDC exchange route. It
does not delete the planner/deployer service accounts or their IAM grants, and
does not prove that other administrators cannot impersonate them. Those
identities remain part of the teardown inventory.

`plan.sh` and `apply.sh` are intentionally inert compatibility entrypoints. They
fail immediately without inspecting credentials, invoking Terraform, or making
network or cloud calls. Keeping hard-fail files prevents an old reference from
silently performing a different operation.

`inspect-plan.sh` remains the explicitly invoked, read-only operator tool for
historical initial plans. Saved plan data is sensitive and remains subject to
the private state bucket's retention and soft-delete controls.

`validate-policy.mjs` accepts only the exact retired policy during ordinary
validation. Both `--require-plan-activation` and
`--require-apply-activation` fail closed. It also requires the active workflow
path to be absent and the historical blueprint to retain its reviewed digest.
