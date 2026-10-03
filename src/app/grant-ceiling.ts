import type { CapabilityRequirements } from '../../component-runtime/src/contract';

/**
 * The platform's ceiling for any published interface.
 *
 * It is not where home data is protected: the relay only ever delivers the
 * signed-in resident's coordinator-authorized view, so a path the coordinator
 * did not grant never reaches the browser, whatever a release declares. The
 * ceiling keeps a release inside its own declaration — prefixes such as
 * `room.*`, `security.*`, `monitoring.*` or `admin.*` included — and away from
 * what the shell never brokers for a home: protocol-reserved `miakapp.*`
 * functions, events and media.
 */
export function platformGrantCeiling(requires: CapabilityRequirements): CapabilityRequirements {
  return {
    state_read: [...requires.state_read],
    event_subscribe: [],
    event_publish: [],
    call: requires.call.filter((name) => name !== 'miakapp.*' && !name.startsWith('miakapp.')),
    presentation: [],
  };
}
