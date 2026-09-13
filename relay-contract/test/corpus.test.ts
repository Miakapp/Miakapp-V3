/**
 * Self-tests for the corpus and the runner.
 *
 * Passing these proves the kit is internally consistent. It proves nothing
 * about any implementation: a subject conforms only after it passes the
 * complete corpus, which `src/main.ts` drives.
 */
import { describe, expect, test } from 'bun:test';
import { Opcode } from '../../protocol/typescript/src/codec.ts';
import corpusDocument from '../fixtures/v1/scenarios.json' with { type: 'json' };
import type { Corpus, Step } from '../src/runner.ts';

const corpus = corpusDocument as unknown as Corpus;
const OPCODE_NAMES = new Set(Object.keys(Opcode));

const ACTIONS = new Set([
  'connect',
  'send',
  'expect',
  'expectClosed',
  'expectSilence',
  'close',
  'wait',
]);

describe('corpus', () => {
  test('declares the protocol it covers', () => {
    expect(corpus.schema).toBe('miakapp.relay-conformance/1');
    expect(corpus.protocol).toEqual([1, 0]);
    expect(corpus.subprotocol).toBe('miakapp');
  });

  test('scenario names are unique and namespaced', () => {
    const names = corpus.scenarios.map((scenario) => scenario.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toContain('/');
  });

  test('every scenario cites the clause it holds the subject to', () => {
    for (const scenario of corpus.scenarios) {
      expect(scenario.requires).toMatch(/^RFC 0001 §/);
    }
  });

  test('every step is a known action', () => {
    for (const scenario of corpus.scenarios) {
      expect(scenario.steps.length).toBeGreaterThan(0);
      for (const step of scenario.steps) {
        expect(ACTIONS.has((step as Step).action)).toBe(true);
      }
    }
  });

  test('every opcode named by the corpus exists in the certified codec', () => {
    for (const scenario of corpus.scenarios) {
      for (const step of scenario.steps) {
        if (step.action !== 'send' && step.action !== 'expect') continue;
        expect(OPCODE_NAMES.has(step.opcode)).toBe(true);
      }
    }
  });

  test('a scenario only addresses peers it connected', () => {
    for (const scenario of corpus.scenarios) {
      const connected = new Set<string>();
      for (const step of scenario.steps) {
        if (step.action === 'wait') continue;
        if (step.action === 'connect') {
          expect(connected.has(step.peer)).toBe(false);
          connected.add(step.peer);
          continue;
        }
        expect(connected.has(step.peer)).toBe(true);
        if (step.action === 'close') connected.delete(step.peer);
      }
    }
  });

  test('every placeholder is captured before it is referenced', () => {
    for (const scenario of corpus.scenarios) {
      const captured = new Set<string>();
      for (const step of scenario.steps) {
        if (step.action === 'expect') {
          for (const name of Object.keys(step.capture ?? {})) captured.add(name);
          continue;
        }
        if (step.action !== 'send') continue;
        for (const reference of references(step.payload)) {
          expect(captured.has(reference)).toBe(true);
        }
      }
    }
  });

  test('a profile is either default or declared by the subject contract', () => {
    for (const scenario of corpus.scenarios) {
      if (scenario.profile === undefined) continue;
      expect(['default', 'fast-grace']).toContain(scenario.profile);
    }
  });
});

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const reference = record['$'];
  if (typeof reference === 'string' && Object.keys(record).length === 1) return [reference];
  return Object.values(record).flatMap(references);
}
