import { describe, expect, test } from 'bun:test';
import {
  COMPONENT_ABI,
  ContractViolation,
  LIMITS,
  POINTER_SCHEMA,
  isCapabilityGranted,
  measureStructuredValue,
  validateEnvelope,
  validatePointer,
  validateUiTree,
  type ComponentPointerV1,
} from '../src/contract';
import {
  fetchAndVerifyArtifact,
  sha256Base64Url,
  verifyArtifactBytes,
} from '../src/artifact';
import { validateGuestProgram } from '../src/program';

const artifactOrigin = 'https://artifacts.example';

function validRequirements() {
  return {
    state_read: ['global.*'],
    event_subscribe: ['alarm.changed'],
    event_publish: ['ui.preference.changed'],
    call: ['lighting.set'],
    presentation: ['media.front_door'],
  };
}

function pointer(overrides: Partial<ComponentPointerV1> = {}): ComponentPointerV1 {
  return {
    schema: POINTER_SCHEMA,
    home_id: 'home-test',
    generation: 4,
    release: '2026-08-30.1',
    abi: COMPONENT_ABI,
    url: `${artifactOrigin}/homes/home-test/sha256-artifact.mjs`,
    sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    size: 128,
    requires: validRequirements(),
    ...overrides,
  };
}

function pointerContext() {
  return {
    expectedHomeId: 'home-test',
    minimumGeneration: 3,
    allowedArtifactOrigins: new Set([artifactOrigin]),
    allowedPathPrefixes: ['/homes/'],
  };
}

function validTree() {
  return {
    id: 'home',
    type: 'screen',
    props: { title: 'My home' },
    children: [
      {
        id: 'layout',
        type: 'stack',
        props: { gap: 'medium' },
        children: [
          { id: 'temperature', type: 'text', props: { text: '21.5 °C' } },
          {
            id: 'operation',
            type: 'status',
            props: { label: 'Lighting', state: 'outcome_unknown' },
          },
          {
            id: 'toggle',
            type: 'button',
            props: { label: 'Toggle light', handler: 'toggle-light' },
          },
          {
            id: 'camera',
            type: 'media',
            props: { label: 'Front door', handle: 'media.front_door' },
          },
        ],
      },
    ],
  };
}

describe('component pointer', () => {
  test('normalizes an exact valid pointer', () => {
    expect(validatePointer(pointer(), pointerContext())).toEqual(pointer());
  });

  test.each([
    ['wrong home', pointer({ home_id: 'home-other' }), 'pointer_invalid'],
    ['rollback', pointer({ generation: 2 }), 'pointer_invalid'],
    ['wrong origin', pointer({ url: 'https://attacker.example/a.mjs' }), 'pointer_invalid'],
    ['oversize', pointer({ size: LIMITS.artifactBytes + 1 }), 'artifact_too_large'],
    ['bad digest', pointer({ sha256: 'not-a-digest' }), 'pointer_invalid'],
  ])('rejects %s', (_label, candidate, code) => {
    expect(() => validatePointer(candidate, pointerContext())).toThrow(ContractViolation);
    try {
      validatePointer(candidate, pointerContext());
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  test('rejects unknown and prototype-shaped fields', () => {
    const unknown = { ...pointer(), extra: true };
    expect(() => validatePointer(unknown, pointerContext())).toThrow(/extra/);

    const poisoned = JSON.parse(JSON.stringify(pointer()));
    poisoned.requires.__proto__ = [];
    expect(() => validatePointer(poisoned, pointerContext())).toThrow(ContractViolation);
  });

  test('accepts only the RFC 0001 suffix wildcard', () => {
    const invalid = pointer({
      requires: { ...validRequirements(), state_read: ['global*'] },
    });
    expect(() => validatePointer(invalid, pointerContext())).toThrow(ContractViolation);
    expect(isCapabilityGranted(['global.*'], 'global.temperature')).toBe(true);
    expect(isCapabilityGranted(['global.*'], 'global')).toBe(false);
    expect(isCapabilityGranted(['lighting.set'], 'lighting.set')).toBe(true);
    expect(isCapabilityGranted(['lighting.set'], 'lighting.setup')).toBe(false);

    const wildcardPresentation = pointer({
      requires: { ...validRequirements(), presentation: ['media.*'] },
    });
    expect(() => validatePointer(wildcardPresentation, pointerContext())).toThrow(/exact media handles/);
  });
});

describe('semantic UI tree', () => {
  test('returns a normalized framework-neutral tree', () => {
    const result = validateUiTree(validTree(), {
      mediaHandles: new Set(['media.front_door']),
    });
    expect(result.type).toBe('screen');
    expect(result.children?.[0]!.props).toEqual({
      direction: 'vertical',
      gap: 'medium',
      align: 'stretch',
    });
  });

  test('rejects raw HTML, URLs, duplicate IDs, and ungranted media', () => {
    const htmlTree = validTree();
    (htmlTree.children[0]!.children[0]!.props as Record<string, unknown>).html = '<img src=x>';
    expect(() => validateUiTree(htmlTree, { mediaHandles: new Set(['media.front_door']) })).toThrow(/html/);

    const urlTree = validTree();
    (urlTree.children[0]!.children[0]!.props as Record<string, unknown>).href = 'https://attacker.example';
    expect(() => validateUiTree(urlTree, { mediaHandles: new Set(['media.front_door']) })).toThrow(/href/);

    const duplicateTree = validTree();
    duplicateTree.children[0]!.children[1]!.id = 'temperature';
    expect(() => validateUiTree(duplicateTree, { mediaHandles: new Set(['media.front_door']) })).toThrow(/Duplicate/);

    expect(() => validateUiTree(validTree(), { mediaHandles: new Set() })).toThrow(/not granted/);
  });

  test('rejects excessive depth without recursive traversal', () => {
    let current: Record<string, unknown> = {
      id: 'leaf',
      type: 'text',
      props: { text: 'leaf' },
    };
    for (let depth = 0; depth < LIMITS.uiDepth + 1; depth += 1) {
      current = {
        id: `stack-${depth}`,
        type: depth === LIMITS.uiDepth ? 'screen' : 'stack',
        props: depth === LIMITS.uiDepth ? { title: 'Root' } : {},
        children: [current],
      };
    }
    expect(() => validateUiTree(current)).toThrow(/depth/);
  });
});

describe('bridge envelope', () => {
  const context = {
    instance: 'A'.repeat(16),
    epoch: 2,
    expectedSeq: 1,
    allowedKinds: new Set(['ui.render']),
  };

  test('accepts one exact contiguous envelope', () => {
    expect(validateEnvelope({
      v: 1,
      instance: context.instance,
      epoch: 2,
      seq: 1,
      kind: 'ui.render',
      payload: { ok: true },
    }, context)).toMatchObject({ seq: 1, kind: 'ui.render' });
  });

  test('rejects stale epochs, sequence gaps, unknown kinds, cycles, and large values', () => {
    expect(() => validateEnvelope({
      v: 1, instance: context.instance, epoch: 1, seq: 1, kind: 'ui.render', payload: {},
    }, context)).toThrow(/epoch/);
    expect(() => validateEnvelope({
      v: 1, instance: context.instance, epoch: 2, seq: 2, kind: 'ui.render', payload: {},
    }, context)).toThrow(/sequence/);
    expect(() => validateEnvelope({
      v: 1, instance: context.instance, epoch: 2, seq: 1, kind: 'unknown', payload: {},
    }, context)).toThrow(/kind/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => measureStructuredValue(cycle)).toThrow(/cycle/);
    expect(() => measureStructuredValue('x'.repeat(LIMITS.envelopeBytes))).toThrow(/byte limit/);
  });

  test('rejects sparse arrays and named array properties before traversal', () => {
    const sparse: unknown[] = [];
    sparse.length = 1_000_000_000;
    expect(() => measureStructuredValue(sparse)).toThrow(/too many entries/);

    const named: unknown[] = [];
    Object.assign(named, { secret: 'not an indexed value' });
    expect(() => measureStructuredValue(named)).toThrow(/canonical array/);
  });
});

describe('artifact integrity', () => {
  test('verifies the exact bytes and rejects size or hash mismatches', async () => {
    const bytes = new TextEncoder().encode('self.postMessage("hello")');
    const sha256 = await sha256Base64Url(bytes);
    await expect(verifyArtifactBytes({ size: bytes.byteLength, sha256 }, bytes)).resolves.toEqual({ bytes, sha256 });
    await expect(verifyArtifactBytes({ size: bytes.byteLength + 1, sha256 }, bytes)).rejects.toMatchObject({
      code: 'artifact_size_mismatch',
    });
    const changed = bytes.slice();
    changed[0] = changed[0]! ^ 1;
    await expect(verifyArtifactBytes({ size: bytes.byteLength, sha256 }, changed)).rejects.toMatchObject({
      code: 'artifact_hash_mismatch',
    });
  });

  test('fetches without credentials, streams within the bound, and verifies before returning', async () => {
    const bytes = new TextEncoder().encode('self.postMessage("verified")');
    const sha256 = await sha256Base64Url(bytes);
    const candidate = pointer({ size: bytes.byteLength, sha256 });
    let captured: RequestInit | undefined;
    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'text/javascript',
          'content-length': String(bytes.byteLength),
        },
      });
    };
    const result = await fetchAndVerifyArtifact(candidate, {
      fetch: fetchMock as unknown as typeof fetch,
      allowedArtifactOrigins: new Set([artifactOrigin]),
      allowedPathPrefixes: ['/homes/'],
    });
    expect(result.bytes).toEqual(bytes);
    expect(captured).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    });
  });

  test('aborts an observed body that exceeds the signed size', async () => {
    const bytes = new Uint8Array(64);
    const candidate = pointer({ size: 32 });
    const fetchMock = async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'text/javascript' },
    });
    await expect(fetchAndVerifyArtifact(candidate, {
      fetch: fetchMock as unknown as typeof fetch,
      allowedArtifactOrigins: new Set([artifactOrigin]),
    })).rejects.toMatchObject({ code: 'artifact_too_large' });
  });

  test('rejects hostile response metadata before accepting artifact bytes', async () => {
    const bytes = new TextEncoder().encode('self.postMessage("verified")');
    const sha256 = await sha256Base64Url(bytes);
    const candidate = pointer({ size: bytes.byteLength, sha256 });
    const fetchWith = (response: Response) => fetchAndVerifyArtifact(candidate, {
      fetch: (async () => response) as unknown as typeof fetch,
      allowedArtifactOrigins: new Set([artifactOrigin]),
      allowedPathPrefixes: ['/homes/'],
    });

    await expect(fetchWith(new Response(bytes, {
      status: 503,
      headers: { 'content-type': 'text/javascript' },
    }))).rejects.toMatchObject({ code: 'artifact_fetch_failed' });

    await expect(fetchWith(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))).rejects.toMatchObject({ code: 'artifact_fetch_failed' });

    await expect(fetchWith(new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'text/javascript',
        'content-length': String(bytes.byteLength + 1),
      },
    }))).resolves.toMatchObject({ bytes });

    const redirected = new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'text/javascript' },
    });
    Object.defineProperty(redirected, 'url', {
      value: 'https://attacker.example/homes/home-test/artifact.mjs',
    });
    await expect(fetchWith(redirected)).rejects.toMatchObject({ code: 'pointer_invalid' });
  });
});

describe('guest program profile', () => {
  test('accepts a self-contained classic Worker program', () => {
    expect(() => validateGuestProgram(new TextEncoder().encode(
      "self.onmessage = () => self.postMessage({ v: 1, kind: 'ui.render', payload: {} });",
    ))).not.toThrow();
    expect(() => validateGuestProgram(new TextEncoder().encode(
      'const note = "//# sourceMappingURL=ordinary-string.js.map";',
    ))).not.toThrow();
  });

  test.each([
    ["import('https://attacker.example/module.mjs')", /dynamic import/],
    ["import value from './chunk.mjs'", /classic Worker script/],
    ['export default 1', /classic Worker script/],
    ['//# sourceMappingURL=private.js.map', /source maps/],
  ])('rejects forbidden program source', (source, expected) => {
    expect(() => validateGuestProgram(new TextEncoder().encode(source))).toThrow(expected);
  });

  test('rejects malformed UTF-8 before Worker construction', () => {
    expect(() => validateGuestProgram(Uint8Array.from([0xc3, 0x28]))).toThrow(/UTF-8/);
  });
});
