import { describe, expect, test } from 'bun:test';

import { inspectArtifactSource } from '../src/index.js';

describe('component artifact inspection', () => {
  test('accepts a bounded self-contained classic Worker program', () => {
    expect(inspectArtifactSource('self.onmessage = () => self.postMessage("ok");\n'))
      .toMatchObject({ syntaxValid: true });
  });

  test('aborts token-dense input before constructing a full near-limit AST', () => {
    const evidence = inspectArtifactSource(';'.repeat(2_097_152));
    expect(evidence.size).toBe(2_097_152);
    expect(evidence.syntaxValid).toBeFalse();
  });
});
