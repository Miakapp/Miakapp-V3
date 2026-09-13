/**
 * Drives any RFC 0001 server implementation through the shared scenario corpus.
 *
 * The runner speaks only the wire: it starts the subject as a child process,
 * opens real WebSocket connections, and encodes and decodes frames with the
 * same `protocol/typescript` codec that is already certified byte-for-byte
 * against the Go implementation. Nothing here knows what the subject is written
 * in, which is the entire point.
 */
import { Opcode, decodeFrame, encodeFrame, type Frame } from '../../protocol/typescript/src/codec.ts';

const OPCODE_BY_NAME = new Map<string, number>(Object.entries(Opcode));
const NAME_BY_OPCODE = new Map<number, string>(
  Object.entries(Opcode).map(([name, code]) => [code as number, name]),
);

export interface ConnectStep {
  readonly action: 'connect';
  readonly peer: string;
}

export interface SendStep {
  readonly action: 'send';
  readonly peer: string;
  readonly opcode: string;
  /**
   * Payload to encode. Any `{"$": "name"}` object is replaced by the value
   * captured earlier in the scenario under that name — epochs and dictionary
   * IDs are assigned by the subject, so a corpus cannot hard-code them.
   */
  readonly payload: readonly unknown[];
}

export interface ExpectStep {
  readonly action: 'expect';
  readonly peer: string;
  readonly opcode: string;
  /** Payload assertions by index, as decimal string keys. Deep-compared. */
  readonly match?: Readonly<Record<string, unknown>>;
  /** Binds values out of the received payload, by dotted index path. */
  readonly capture?: Readonly<Record<string, string>>;
}

export interface ExpectClosedStep {
  readonly action: 'expectClosed';
  readonly peer: string;
}

export interface ExpectSilenceStep {
  readonly action: 'expectSilence';
  readonly peer: string;
  readonly ms: number;
}

export interface CloseStep {
  readonly action: 'close';
  readonly peer: string;
}

export interface WaitStep {
  readonly action: 'wait';
  readonly ms: number;
}

export type Step =
  | ConnectStep
  | SendStep
  | ExpectStep
  | ExpectClosedStep
  | ExpectSilenceStep
  | CloseStep
  | WaitStep;

export interface Scenario {
  readonly name: string;
  /** The RFC 0001 clause this scenario holds the subject to. */
  readonly requires: string;
  readonly profile?: string;
  readonly steps: readonly Step[];
}

export interface Corpus {
  readonly schema: string;
  readonly protocol: readonly [number, number];
  readonly subprotocol: string;
  readonly scenarios: readonly Scenario[];
}

export interface SubjectCommand {
  readonly command: readonly string[];
}

export interface ScenarioResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failure?: string;
}

const CONNECT_TIMEOUT_MS = 5_000;
const RECEIVE_TIMEOUT_MS = 5_000;
const SUBJECT_START_TIMEOUT_MS = 10_000;

class Peer {
  readonly #socket: WebSocket;
  readonly #inbox: Frame[] = [];
  readonly #waiters: Array<(frame: Frame) => void> = [];
  #closed = false;
  #closeWaiters: Array<() => void> = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data;
      if (!(data instanceof ArrayBuffer)) return;
      const frame = decodeFrame(new Uint8Array(data));
      const waiter = this.#waiters.shift();
      if (waiter === undefined) this.#inbox.push(frame);
      else waiter(frame);
    });
    socket.addEventListener('close', () => {
      this.#closed = true;
      for (const resolve of this.#closeWaiters.splice(0)) resolve();
    });
  }

  static async connect(url: string, subprotocol: string): Promise<Peer> {
    const socket = new WebSocket(url, [subprotocol]);
    const peer = new Peer(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connection timed out')), CONNECT_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('connection failed'));
      });
    });
    return peer;
  }

  send(frame: Frame): void {
    this.#socket.send(encodeFrame(frame));
  }

  get closed(): boolean {
    return this.#closed;
  }

  async receive(): Promise<Frame> {
    const buffered = this.#inbox.shift();
    if (buffered !== undefined) return buffered;
    return await new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(onFrame);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error(this.#closed
          ? 'the connection closed while a frame was expected'
          : 'timed out waiting for a frame'));
      }, RECEIVE_TIMEOUT_MS);
      const onFrame = (frame: Frame): void => {
        clearTimeout(timer);
        resolve(frame);
      };
      this.#waiters.push(onFrame);
    });
  }

  async awaitClose(timeoutMs: number): Promise<boolean> {
    if (this.#closed) return true;
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(this.#closed), timeoutMs);
      this.#closeWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Frames already delivered but not yet consumed, for silence assertions. */
  get pending(): number {
    return this.#inbox.length;
  }

  dispose(): void {
    try {
      this.#socket.close();
    } catch {
      // A peer the subject already closed needs no further action.
    }
  }
}

function opcodeOf(name: string): number {
  const opcode = OPCODE_BY_NAME.get(name);
  if (opcode === undefined) throw new Error(`unknown opcode name: ${name}`);
  return opcode;
}

function describe(frame: Frame): string {
  return `${NAME_BY_OPCODE.get(frame.opcode) ?? `0x${frame.opcode.toString(16)}`} ${JSON.stringify(frame.payload)}`;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Reads a dotted index path such as "3.0.0" out of a decoded payload. */
function valueAt(payload: readonly unknown[], path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (!Array.isArray(current)) return undefined;
    current = (current as unknown[])[Number(segment)];
  }
  return current;
}

/** Replaces every `{"$": "name"}` placeholder with a captured value. */
function resolve(value: unknown, captured: ReadonlyMap<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => resolve(item, captured));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const reference = record['$'];
  if (typeof reference === 'string' && Object.keys(record).length === 1) {
    if (!captured.has(reference)) throw new Error(`no value captured under ${reference}`);
    return captured.get(reference);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, resolve(item, captured)]),
  );
}

/** Starts one subject and resolves its advertised URL. */
async function startSubject(
  subject: SubjectCommand,
  profile: string,
): Promise<{ url: string; stop: () => void }> {
  const [command, ...rest] = subject.command;
  if (command === undefined) throw new Error('the subject command is empty');
  const child = Bun.spawn([command, ...rest], {
    env: { ...process.env, MIAKAPP_CONFORMANCE_PROFILE: profile },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const deadline = Date.now() + SUBJECT_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    const line = buffered.split('\n').find((candidate) => candidate.startsWith('LISTENING '));
    if (line !== undefined) {
      void reader.cancel().catch(() => undefined);
      return {
        url: line.slice('LISTENING '.length).trim(),
        stop: () => child.kill(),
      };
    }
  }
  child.kill();
  throw new Error('the subject did not announce a LISTENING url');
}

async function runSteps(
  steps: readonly Step[],
  url: string,
  subprotocol: string,
): Promise<void> {
  const peers = new Map<string, Peer>();
  const captured = new Map<string, unknown>();
  const peerOf = (name: string): Peer => {
    const peer = peers.get(name);
    if (peer === undefined) throw new Error(`peer ${name} is not connected`);
    return peer;
  };

  try {
    for (const [index, step] of steps.entries()) {
      const at = `step ${index + 1} (${step.action})`;
      switch (step.action) {
        case 'connect': {
          if (peers.has(step.peer)) throw new Error(`${at}: peer ${step.peer} is already connected`);
          peers.set(step.peer, await Peer.connect(url, subprotocol));
          break;
        }
        case 'send': {
          const payload = resolve([...step.payload], captured) as never;
          peerOf(step.peer).send({ opcode: opcodeOf(step.opcode), payload });
          break;
        }
        case 'expect': {
          const frame = await peerOf(step.peer).receive();
          const expected = opcodeOf(step.opcode);
          if (frame.opcode !== expected) {
            throw new Error(`${at}: expected ${step.opcode} on ${step.peer}, received ${describe(frame)}`);
          }
          for (const [key, value] of Object.entries(step.match ?? {})) {
            const observed = valueAt(frame.payload, key);
            if (!deepEqual(observed, value)) {
              throw new Error(
                `${at}: ${step.opcode}.payload[${key}] on ${step.peer} is `
                + `${JSON.stringify(observed)}, expected ${JSON.stringify(value)}`,
              );
            }
          }
          for (const [name, path] of Object.entries(step.capture ?? {})) {
            const value = valueAt(frame.payload, path);
            if (value === undefined) {
              throw new Error(`${at}: nothing to capture at ${step.opcode}.payload[${path}]`);
            }
            captured.set(name, value);
          }
          break;
        }
        case 'expectClosed': {
          const closed = await peerOf(step.peer).awaitClose(RECEIVE_TIMEOUT_MS);
          if (!closed) throw new Error(`${at}: ${step.peer} is still connected`);
          break;
        }
        case 'expectSilence': {
          const peer = peerOf(step.peer);
          await Bun.sleep(step.ms);
          if (peer.pending > 0) {
            throw new Error(`${at}: ${step.peer} received ${peer.pending} unexpected frame(s)`);
          }
          break;
        }
        case 'close': {
          peerOf(step.peer).dispose();
          peers.delete(step.peer);
          break;
        }
        case 'wait': {
          await Bun.sleep(step.ms);
          break;
        }
      }
    }
  } finally {
    for (const peer of peers.values()) peer.dispose();
  }
}

export async function runScenario(
  scenario: Scenario,
  corpus: Corpus,
  subject: SubjectCommand,
): Promise<ScenarioResult> {
  let started: { url: string; stop: () => void } | undefined;
  try {
    started = await startSubject(subject, scenario.profile ?? 'default');
    await runSteps(scenario.steps, started.url, corpus.subprotocol);
    return { name: scenario.name, passed: true };
  } catch (error) {
    return {
      name: scenario.name,
      passed: false,
      failure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    started?.stop();
  }
}

export async function runCorpus(
  corpus: Corpus,
  subject: SubjectCommand,
  filter?: string,
): Promise<readonly ScenarioResult[]> {
  const selected = filter === undefined
    ? corpus.scenarios
    : corpus.scenarios.filter((scenario) => scenario.name.includes(filter));
  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    results.push(await runScenario(scenario, corpus, subject));
  }
  return results;
}
