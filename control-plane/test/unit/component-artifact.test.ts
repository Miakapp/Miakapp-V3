import { describe, expect, test } from 'bun:test';

import {
  inspectComponentArtifact,
  MAX_COMPONENT_ARTIFACT_BYTES,
  validateComponentRequirements,
} from '../../src/component-artifact.js';
import { type JsonValue } from '../../src/json.js';

const EMPTY_REQUIREMENTS = Object.freeze({
  state_read: [],
  event_subscribe: [],
  event_publish: [],
  call: [],
  presentation: [],
});

describe('component publication contract', () => {
  test('accepts and hashes one bounded self-contained classic Worker program', () => {
    const source = Buffer.from('self.onmessage = () => self.postMessage("ok");\n');
    expect(inspectComponentArtifact(source)).toEqual({
      sha256: 'OYz_JQmAhc-1dnPMSL8QZx_5WlcDthtr6w6zlMEuYZI',
      size: source.byteLength,
      syntaxValid: true,
    });
  });

  test.each([
    ['empty input', new Uint8Array()],
    ['invalid UTF-8', Uint8Array.from([0xff])],
    ['module syntax', Buffer.from('export default 1;')],
    ['dynamic import', Buffer.from('void import("https://example.test/x.js");')],
    ['source map directive', Buffer.from('/*# sourceMappingURL=x.map */\nself.x = 1;')],
    ['hashbang', Buffer.from('#!/usr/bin/env node\nself.x = 1;')],
  ] as Array<[string, Uint8Array]>)('marks %s as invalid while retaining delivery evidence', (_name, bytes) => {
    const evidence = inspectComponentArtifact(bytes);
    expect(evidence.size).toBe(bytes.byteLength);
    expect(evidence.sha256).toHaveLength(43);
    expect(evidence.syntaxValid).toBeFalse();
  });

  test('aborts token-dense input before constructing a full near-limit AST', () => {
    const evidence = inspectComponentArtifact(Buffer.from(';'.repeat(MAX_COMPONENT_ARTIFACT_BYTES)));
    expect(evidence.size).toBe(MAX_COMPONENT_ARTIFACT_BYTES);
    expect(evidence.syntaxValid).toBeFalse();
  });

  test('rejects an artifact above the byte ceiling', () => {
    const evidence = inspectComponentArtifact(Buffer.alloc(MAX_COMPONENT_ARTIFACT_BYTES + 1, 0x20));
    expect(evidence.size).toBe(MAX_COMPONENT_ARTIFACT_BYTES + 1);
    expect(evidence.syntaxValid).toBeFalse();
  });

  test('normalizes the exact closed capability-requirement shape', () => {
    expect(validateComponentRequirements({
      state_read: ['global.temperature', 'rooms.*'],
      event_subscribe: ['motion.changed'],
      event_publish: [],
      call: ['lighting.set'],
      presentation: ['media.front_door'],
    })).toEqual({
      state_read: ['global.temperature', 'rooms.*'],
      event_subscribe: ['motion.changed'],
      event_publish: [],
      call: ['lighting.set'],
      presentation: ['media.front_door'],
    });
  });

  test.each([
    ['unknown field', { ...EMPTY_REQUIREMENTS, extra: [] }],
    ['missing field', { state_read: [], event_subscribe: [], event_publish: [], call: [] }],
    ['duplicate', { ...EMPTY_REQUIREMENTS, state_read: ['global.x', 'global.x'] }],
    ['empty segment', { ...EMPTY_REQUIREMENTS, call: ['lighting..set'] }],
    ['embedded wildcard', { ...EMPTY_REQUIREMENTS, state_read: ['rooms.*.temperature'] }],
    ['wildcard presentation', { ...EMPTY_REQUIREMENTS, presentation: ['media.*'] }],
    ['non-media presentation', { ...EMPTY_REQUIREMENTS, presentation: ['global.temperature'] }],
  ] as Array<[string, JsonValue]>)('rejects requirements with an %s', (_name, requirements) => {
    expect(() => validateComponentRequirements(requirements)).toThrow('Request is invalid');
  });
});
