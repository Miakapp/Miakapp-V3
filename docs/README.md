# Miakapp 3.5 documentation

Miakapp 3.5 is an ecosystem-wide rebuild. This repository is the canonical
home for the shared architecture and delivery roadmap even though the work is
implemented across several repositories.

## Documents

- [`specs/2026-08-29-miakapp-3.5-design.md`](specs/2026-08-29-miakapp-3.5-design.md)
  — approved product and architecture direction. The protocol, component
  runtime, platform control plane, and migration contracts still have explicit
  design gates before implementation.
- [`roadmaps/2026-08-29-miakapp-3.5-coordination.md`](roadmaps/2026-08-29-miakapp-3.5-coordination.md)
  — cross-repository sequence, ownership, acceptance gates, and deferred work.

Repository-specific implementation plans must link back to these documents and
must not redefine a shared contract locally.

## Public-repository rule

Everything under `docs/` is public. Never include production inventory,
household names, user counts, device identifiers, credentials, private hostnames,
or exports from a real home. Production characterization belongs in a local,
gitignored `.context/` directory.
