# Browser-relay synthetic fixture controller

This directory defines the dormant, in-process controller for the one synthetic
Home used by the staging browser-relay acceptance. It owns the closed lifecycle
between an initially empty fixed namespace and verified final absence.

The controller is deliberately dependency-injected. It contains no CLI, cloud
transport, ambient credential lookup, deployment authority or retry loop. A
separate reviewed adapter must provide Firebase identity creation, owner API
calls, custom-token signing, MiakAPI factories and guarded cleanup before the
controller can perform any live work.

## Fixed synthetic shape

- one anonymous Firebase identity in a fixed staging-only namespace;
- one Home initially routed to relay A and optionally rotated once to relay B;
- one `relay:coordinator` Home Key held only by the MiakAPI provider;
- one coordinator named `miakapp-v4-staging-acceptance`;
- authoritative state `acceptance.temperature`, initially `20`;
- state access `acceptance.*` for the synthetic Firebase identity;
- one `acceptance.set` function returning only the accepted synthetic target;
- at most eight serialized function calls, with duplicate idempotency keys
  returning the prior result without repeating the state mutation;
- exactly one fresh Firebase custom token for each of Chromium, Firefox and
  WebKit, in that order.

## Failure and cleanup boundary

Creation begins only after the adapter proves that all fixture domains are
absent. That observation grants cleanup authority for the fixed namespace; a
failed or ambiguous creation therefore remains recoverable. If the initial
absence cannot be proven, neither creation nor deletion is allowed.

Cleanup stops the coordinator before asking the adapter to remove fixture data,
discards all reachable private references, and succeeds only after the adapter
again proves zero Firebase users, Homes, Home Key records/indexes, owner records
and coordinator sessions. Dependency errors are collapsed so token or response
contents cannot escape through committed results or logs.

The profile grants no cloud mutation, hosting publication, public ingress or
live-execution authority. No live fixture has been created by this package.
