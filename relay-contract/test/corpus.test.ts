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
import { stepsOf, type Corpus, type Step } from '../src/runner.ts';

const corpus = corpusDocument as unknown as Corpus;
const OPCODE_NAMES = new Set(Object.keys(Opcode));

/** The configuration profiles the subject contract in README.md defines. */
const PROFILES = ['default', 'fast-grace', 'drain-on-cli'];

const ACTIONS = new Set([
  'connect',
  'send',
  'expect',
  'expectExclusive',
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
      expect(stepsOf(scenario, corpus).length).toBeGreaterThan(0);
      for (const step of stepsOf(scenario, corpus)) {
        expect(ACTIONS.has((step as Step).action)).toBe(true);
      }
    }
  });

  test('every opcode named by the corpus exists in the certified codec', () => {
    for (const scenario of corpus.scenarios) {
      for (const step of stepsOf(scenario, corpus)) {
        if (step.action === 'expectExclusive') {
          expect(OPCODE_NAMES.has(step.winner.opcode)).toBe(true);
          expect(OPCODE_NAMES.has(step.loser.opcode)).toBe(true);
          continue;
        }
        if (step.action !== 'send' && step.action !== 'expect') continue;
        expect(OPCODE_NAMES.has(step.opcode)).toBe(true);
      }
    }
  });

  test('a scenario only addresses peers it connected', () => {
    for (const scenario of corpus.scenarios) {
      const connected = new Set<string>();
      for (const step of stepsOf(scenario, corpus)) {
        if (step.action === 'wait') continue;
        if (step.action === 'expectExclusive') {
          // A contest needs at least two peers, or it asserts nothing.
          expect(step.peers.length).toBeGreaterThan(1);
          expect(new Set(step.peers).size).toBe(step.peers.length);
          for (const peer of step.peers) expect(connected.has(peer)).toBe(true);
          continue;
        }
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
      for (const step of stepsOf(scenario, corpus)) {
        if (step.action === 'expect') {
          // A match is asserted against the frame this step receives, so its
          // own captures are not yet bound when it runs.
          for (const reference of references(step.match ?? {})) {
            expect(captured.has(reference)).toBe(true);
          }
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

  test('a match addresses a payload by dotted index path', () => {
    for (const scenario of corpus.scenarios) {
      for (const step of stepsOf(scenario, corpus)) {
        if (step.action !== 'expect') continue;
        for (const path of Object.keys(step.match ?? {})) {
          expect(path).toMatch(/^\d+(\.\d+)*$/);
        }
        for (const path of Object.values(step.capture ?? {})) {
          expect(path).toMatch(/^\d+(\.\d+)*$/);
        }
      }
    }
  });

  test('every prelude a scenario names exists', () => {
    for (const scenario of corpus.scenarios) {
      if (scenario.prelude === undefined) continue;
      expect(corpus.preludes?.[scenario.prelude]).toBeDefined();
    }
  });

  test('a profile is either default or declared by the subject contract', () => {
    for (const scenario of corpus.scenarios) {
      if (scenario.profile === undefined) continue;
      expect(PROFILES).toContain(scenario.profile);
    }
  });

  test('a scenario that observes draining names a draining profile', () => {
    for (const scenario of corpus.scenarios) {
      const drains = stepsOf(scenario, corpus).some(
        (step) => step.action === 'expect' && step.opcode === 'Goaway',
      );
      if (!drains) continue;
      expect(scenario.profile).toBe('drain-on-cli');
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
