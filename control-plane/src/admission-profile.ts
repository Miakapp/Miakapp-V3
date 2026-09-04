import type { AdmissionProfile } from './types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CONTROL_PLANE_ADMISSION_PROFILE: AdmissionProfile = Object.freeze({
  limits: Object.freeze({
    'audit.events': Object.freeze({ maximum: 4_096, windowMilliseconds: MINUTE }),
    'source.operations': Object.freeze({ maximum: 512, windowMilliseconds: MINUTE }),
    'home.create.actor': Object.freeze({ maximum: 32, windowMilliseconds: HOUR }),
    'home.create.source': Object.freeze({ maximum: 64, windowMilliseconds: HOUR }),
    'access.exchange.source': Object.freeze({ maximum: 256, windowMilliseconds: MINUTE }),
    'access.exchange.key': Object.freeze({ maximum: 32, windowMilliseconds: MINUTE }),
    'access.exchange.home': Object.freeze({ maximum: 128, windowMilliseconds: MINUTE }),
    'user_relay.exchange.source': Object.freeze({ maximum: 128, windowMilliseconds: MINUTE }),
    'user_relay.exchange.user': Object.freeze({ maximum: 32, windowMilliseconds: MINUTE }),
    'push.challenge.actor': Object.freeze({ maximum: 64, windowMilliseconds: MINUTE }),
    'push.challenge.app': Object.freeze({ maximum: 256, windowMilliseconds: MINUTE }),
    'push.challenge.source': Object.freeze({ maximum: 128, windowMilliseconds: MINUTE }),
    'push.send.key': Object.freeze({ maximum: 120, windowMilliseconds: MINUTE }),
    'push.send.home': Object.freeze({ maximum: 240, windowMilliseconds: MINUTE }),
    'push.send.grant': Object.freeze({ maximum: 120, windowMilliseconds: MINUTE }),
    'push.send.destination': Object.freeze({ maximum: 120, windowMilliseconds: MINUTE }),
    'component.upload.issue.home': Object.freeze({ maximum: 64, windowMilliseconds: MINUTE }),
    'component.upload.issue_bytes.home': Object.freeze({ maximum: 64 * 1_024 * 1_024, windowMilliseconds: HOUR }),
    'component.upload.delivery.upload': Object.freeze({ maximum: 8, windowMilliseconds: 15 * MINUTE }),
    'component.upload.delivery.home': Object.freeze({ maximum: 64, windowMilliseconds: MINUTE }),
    'component.upload.delivery_bytes.home': Object.freeze({ maximum: 64 * 1_024 * 1_024, windowMilliseconds: HOUR }),
    'component.finalize.home': Object.freeze({ maximum: 64, windowMilliseconds: MINUTE }),
    'component.activate.home': Object.freeze({ maximum: 64, windowMilliseconds: MINUTE }),
  }),
  auditRetentionMilliseconds: 7 * DAY,
  auditSlots: 4_096,
  bucketSlots: 65_536,
  maximumAuditEventBytes: 2_048,
  bucketRetentionMilliseconds: DAY,
  maximumRetryAfterSeconds: 300,
});
