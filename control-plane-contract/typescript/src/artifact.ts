import { createHash } from 'node:crypto';

import { parse } from 'acorn';

const MAX_ARTIFACT_BYTES = 2_097_152;
const MAX_PROGRAM_TOKENS = 100_000;
const MAX_AST_MEMBERS = 250_000;
const SOURCE_MAP_DIRECTIVE = /[#@]\s*sourceMappingURL\s*=/u;

export interface ArtifactEvidence {
  digest: string;
  size: number;
  syntaxValid: boolean;
}

export function inspectArtifactSource(source: string): ArtifactEvidence {
  const bytes = Buffer.from(source, 'utf8');
  let syntaxValid = bytes.byteLength > 0 && bytes.byteLength <= MAX_ARTIFACT_BYTES;
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
          if (tokens > MAX_PROGRAM_TOKENS) throw new SyntaxError('artifact exceeds the lexical token limit');
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
      const value = stack.pop();
      if (value === null || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      members += 1;
      if (members > MAX_AST_MEMBERS) {
        syntaxValid = false;
        break;
      }
      const record = value as Record<string, unknown>;
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

  return Object.freeze({
    digest: createHash('sha256').update(bytes).digest('base64url'),
    size: bytes.byteLength,
    syntaxValid,
  });
}
