import { parse } from 'acorn';
import { ContractViolation, LIMITS } from './contract';

const SOURCE_MAP_DIRECTIVE = /[#@]\s*sourceMappingURL\s*=/u;
const MAX_PROGRAM_TOKENS = 100_000;
const MAX_AST_MEMBERS = 250_000;

function fail(message: string): never {
  throw new ContractViolation('artifact_program_invalid', message);
}

export function validateGuestProgram(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.artifactBytes) {
    fail('guest program size is invalid');
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('guest program is not valid UTF-8');
  }
  let syntaxTree: unknown;
  let hasSourceMapDirective = false;
  let tokens = 0;
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
        if (tokens > MAX_PROGRAM_TOKENS) fail('guest program exceeds the lexical token limit');
      },
    });
  } catch (error) {
    return fail(`guest program is not a self-contained classic Worker script: ${error instanceof Error ? error.message : 'parse failure'}`);
  }
  if (hasSourceMapDirective) fail('source maps are not allowed in runtime artifacts');

  const stack: unknown[] = [syntaxTree];
  const seen = new WeakSet<object>();
  let members = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    members += 1;
    if (members > MAX_AST_MEMBERS) fail('guest program syntax tree exceeds the complexity limit');

    const record = value as Record<string, unknown>;
    if (record.type === 'ImportExpression') {
      fail('dynamic import is forbidden because it can emit a request before CSP rejection');
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
