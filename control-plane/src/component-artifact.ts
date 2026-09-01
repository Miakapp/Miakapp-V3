import { createHash } from 'node:crypto';

import { parse } from 'acorn';

import { apiError } from './errors.js';
import {
  type ComponentRequirements,
} from './types.js';
import { type JsonValue } from './json.js';

export const MAX_COMPONENT_ARTIFACT_BYTES = 2_097_152;
const MAX_PROGRAM_TOKENS = 100_000;
const MAX_AST_MEMBERS = 250_000;
const MAX_REQUIREMENT_ENTRIES = 512;
const MAX_REQUIREMENT_LIST_ENTRIES = 256;
const SOURCE_MAP_DIRECTIVE = /[#@]\s*sourceMappingURL\s*=/u;
const CONTROL_CHARACTER = /\p{Cc}/u;
const REQUIREMENT_FIELDS = [
  'state_read',
  'event_subscribe',
  'event_publish',
  'call',
  'presentation',
] as const;

export interface ComponentArtifactEvidence {
  readonly sha256: string;
  readonly size: number;
  readonly syntaxValid: boolean;
}

function requirementName(value: JsonValue, label: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 258
    || CONTROL_CHARACTER.test(value)) {
    throw apiError('invalid_request');
  }
  const resource = value.endsWith('.*') ? value.slice(0, -2) : value;
  if (resource.length === 0
    || resource.includes('*')
    || resource.startsWith('.')
    || resource.endsWith('.')
    || resource.includes('..')) {
    throw apiError('invalid_request');
  }
  if (Buffer.byteLength(resource, 'utf8') > 256) throw apiError('invalid_request');
  if (label === 'presentation' && (!value.startsWith('media.') || value.endsWith('.*'))) {
    throw apiError('invalid_request');
  }
  return value;
}

export function validateComponentRequirements(value: JsonValue | undefined): ComponentRequirements {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw apiError('invalid_request');
  }
  const keys = Object.keys(value);
  if (keys.length !== REQUIREMENT_FIELDS.length
    || REQUIREMENT_FIELDS.some((field) => !Object.hasOwn(value, field))
    || keys.some((field) => !(REQUIREMENT_FIELDS as readonly string[]).includes(field))) {
    throw apiError('invalid_request');
  }

  let total = 0;
  const parsed = Object.create(null) as Record<typeof REQUIREMENT_FIELDS[number], string[]>;
  for (const field of REQUIREMENT_FIELDS) {
    const entries = value[field];
    if (!Array.isArray(entries)
      || entries.length > MAX_REQUIREMENT_LIST_ENTRIES
      || Object.keys(entries).length !== entries.length) {
      throw apiError('invalid_request');
    }
    const seen = new Set<string>();
    parsed[field] = entries.map((entry) => {
      const name = requirementName(entry, field);
      if (seen.has(name)) throw apiError('invalid_request');
      seen.add(name);
      return name;
    });
    total += entries.length;
  }
  if (total > MAX_REQUIREMENT_ENTRIES) throw apiError('invalid_request');
  return Object.freeze({
    state_read: Object.freeze(parsed.state_read),
    event_subscribe: Object.freeze(parsed.event_subscribe),
    event_publish: Object.freeze(parsed.event_publish),
    call: Object.freeze(parsed.call),
    presentation: Object.freeze(parsed.presentation),
  });
}

export function inspectComponentArtifact(bytes: Uint8Array): ComponentArtifactEvidence {
  const sha256 = createHash('sha256').update(bytes).digest('base64url');
  let syntaxValid = bytes.byteLength > 0 && bytes.byteLength <= MAX_COMPONENT_ARTIFACT_BYTES;
  let source = '';
  if (syntaxValid) {
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      syntaxValid = false;
    }
  }

  let syntaxTree: unknown;
  let hasSourceMapDirective = false;
  let tokens = 0;
  if (syntaxValid) {
    try {
      syntaxTree = parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: false,
        onComment: (_block, text) => {
          if (SOURCE_MAP_DIRECTIVE.test(text)) hasSourceMapDirective = true;
        },
        onToken: () => {
          tokens += 1;
          if (tokens > MAX_PROGRAM_TOKENS) {
            throw new SyntaxError('component artifact exceeds the lexical token limit');
          }
        },
      });
    } catch {
      syntaxValid = false;
    }
  }
  if (syntaxValid && hasSourceMapDirective) syntaxValid = false;

  if (syntaxValid) {
    const stack: unknown[] = [syntaxTree];
    const seen = new WeakSet<object>();
    let members = 0;
    while (stack.length > 0 && syntaxValid) {
      const current = stack.pop();
      if (current === null || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      members += 1;
      if (members > MAX_AST_MEMBERS) {
        syntaxValid = false;
        break;
      }
      const record = current as Record<string, unknown>;
      if (record.type === 'ImportExpression') {
        syntaxValid = false;
        break;
      }
      for (const child of Object.values(record)) {
        if (Array.isArray(child)) {
          for (let index = child.length - 1; index >= 0; index -= 1) stack.push(child[index]);
        } else if (child !== null && typeof child === 'object') {
          stack.push(child);
        }
      }
    }
  }

  return Object.freeze({ sha256, size: bytes.byteLength, syntaxValid });
}
