import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import process from 'node:process';

import {
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES,
  TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
  TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
  buildTrustedProviderProcessReady,
} from '../../contract.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  encodeTrustedProviderProcessFrame,
  readTrustedProviderProcessFrames,
} from '../../framed-channel.mjs';
import { createReadStream, createWriteStream } from 'node:fs';

const arguments_ = process.argv.slice(2);
const ownerPath = arguments_[3];
const ownerSha256 = arguments_[5];
let configuration;
try {
  configuration = JSON.parse(readFileSync(ownerPath, 'utf8'));
} catch {
  configuration = { mode: 'invalid_configuration' };
}

function rawFrame(payload) {
  const bytes = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([header, bytes]);
}

if (configuration.mode === 'noncanonical') {
  writeSync(4, rawFrame('{ "type":"ready"}'));
  process.exit(0);
} else if (configuration.mode === 'duplicate') {
  writeSync(4, rawFrame('{"type":"ready","type":"failure"}'));
  process.exit(0);
} else if (configuration.mode === 'oversized') {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(TRUSTED_PROVIDER_PROCESS_MAXIMUM_FRAME_BYTES + 1);
  writeSync(4, header);
  process.exit(0);
} else if (configuration.mode === 'truncated') {
  writeSync(4, Buffer.from([0, 0, 0, 10, 0x7b]));
  process.exit(0);
} else if (configuration.mode === 'flood') {
  const frame = encodeTrustedProviderProcessFrame({});
  writeSync(4, Buffer.concat(Array(5).fill(frame)));
  process.exit(0);
} else if (configuration.mode === 'wrong_version') {
  writeSync(4, encodeTrustedProviderProcessFrame({
    schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
    protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION + 1,
    type: 'ready',
    owner_bundle_sha256: ownerSha256,
  }));
  process.exit(0);
} else if (configuration.mode === 'early_exit') {
  process.exit(0);
} else {
  const requestStream = createReadStream(null, { autoClose: true, fd: 3 });
  const responseStream = createWriteStream(null, { autoClose: true, fd: 4 });
  const writer = createTrustedProviderProcessFrameWriter(responseStream);
  if (configuration.mode === 'hang_ready') {
    requestStream.resume();
  } else {
    await writer.write(buildTrustedProviderProcessReady(ownerSha256));
    let cancelCount = 0;
    const requestReader = readTrustedProviderProcessFrames(requestStream, {
      async onMessage(message) {
        if (configuration.mode === 'count_cancels') {
          if (message.type === 'execute') {
            writeFileSync(`${configuration.observation_path}.started`, 'started');
            return;
          }
          cancelCount += 1;
          writeFileSync(configuration.observation_path, String(cancelCount));
          if (cancelCount === 1) {
            setTimeout(() => {
              void (async () => {
                await writer.write({
                  schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
                  protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
                  type: 'failure',
                  request_id: message.request_id,
                  code: 'peer_failed',
                });
                requestReader.stop();
                requestStream.destroy();
                await writer.end();
              })().catch(() => {
                process.exitCode = 1;
              });
            }, 50);
          }
          return;
        }
        if (configuration.mode === 'crash_after_execute') {
          process.kill(process.pid, 'SIGKILL');
          return;
        }
        const requestId = configuration.mode === 'wrong_id'
          ? 'B'.repeat(43)
          : message.request_id;
        const response = configuration.mode === 'result'
          || configuration.mode === 'result_then_hang'
          ? {
            schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
            protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
            type: 'result',
            request_id: requestId,
            result: configuration.result,
          }
          : {
            schema: TRUSTED_PROVIDER_PROCESS_PROTOCOL_SCHEMA,
            protocol_version: TRUSTED_PROVIDER_PROCESS_PROTOCOL_VERSION,
            type: 'failure',
            request_id: requestId,
            code: configuration.mode === 'invalid_code'
              ? 'Bearer child-only-secret'
              : 'peer_failed',
          };
        await writer.write(response);
        if (configuration.mode === 'extra_terminal') await writer.write(response);
        if (configuration.mode === 'result_then_hang') {
          setInterval(() => {}, 1_000);
        } else {
          requestReader.stop();
          requestStream.destroy();
          await writer.end();
        }
      },
      onFailure() {
        process.exitCode = 1;
      },
      onEnd() {
        if (configuration.mode !== 'result_then_hang') process.exitCode = 0;
      },
    });
  }
}
