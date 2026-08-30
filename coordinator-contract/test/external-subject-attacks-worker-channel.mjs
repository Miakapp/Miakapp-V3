import { writeSync } from 'node:fs';

const attack = process.env.MIAKAPP_TEST_WORKER_CHANNEL_ATTACK;
const waitCell = new Int32Array(new SharedArrayBuffer(4));

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.byteLength);
  return Buffer.concat([header, payload]);
}

if (attack === 'invalid_response') {
  writeSync(4, frame({ type: 'complete', token: 'subject-controlled-token' }));
} else if (attack === 'oversized_response') {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(4_194_305);
  writeSync(4, header);
} else {
  throw new Error('Unknown worker-channel attack');
}

Atomics.wait(waitCell, 0, 0);
