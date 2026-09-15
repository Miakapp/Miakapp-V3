import {
  COMPONENT_ABI,
  ContractViolation,
  LIMITS,
  type UiNode,
  type UiNodeType,
  type UiValidationContext,
  validateUiTree,
} from './contract';

/**
 * Authoring adapter for the ABI 1 UI contract.
 *
 * RFC 0002 §1: React is an authoring adapter above the UI ABI, not part of the
 * security boundary. Nothing here is a security control — the host revalidates
 * every tree it receives. The adapter exists so an author discovers a contract
 * violation in their own worker, at the point they wrote it, instead of having
 * the render rejected after it crosses the broker.
 *
 * It accepts React-shaped elements without importing React, so a component can
 * be authored with JSX under any pragma while the artifact stays a
 * self-contained classic Worker script inside `LIMITS.artifactBytes`.
 */

const REACT_ELEMENT = Symbol.for('react.element');
const REACT_TRANSITIONAL_ELEMENT = Symbol.for('react.transitional.element');
const REACT_FRAGMENT = Symbol.for('react.fragment');

const NODE_TYPES = new Set<UiNodeType>([
  'screen',
  'stack',
  'grid',
  'section',
  'text',
  'status',
  'button',
  'toggle',
  'input',
  'select',
  'progress',
  'media',
]);

const CONTAINER_TYPES = new Set<UiNodeType>(['screen', 'stack', 'grid', 'section']);

/** Props that carry an author function instead of an ABI handler string. */
const HANDLER_PROPS = ['onPress', 'onChange'] as const;

const NODE_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const UNSAFE_KEY_CHARACTER = /[^A-Za-z0-9._:-]/gu;

export type AuthoringHandler = (payload: unknown) => void;

export interface AuthoringElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly key?: string | number | null;
}

export type AuthoringChild = AuthoringElement | string | number | null | undefined | false;

export interface AuthoringOptions extends UiValidationContext {
  /** Prefix for generated node identifiers. Must be a valid ABI node id stem. */
  readonly idPrefix?: string;
}

export interface AuthoredTree {
  /** The ABI version this tree was authored against. */
  readonly abi: typeof COMPONENT_ABI;
  /** A tree already accepted by the same validator the host runs. */
  readonly tree: UiNode;
  /**
   * Handler id -> author function. The id is always the node id, so it is
   * unique by construction and an author never invents a routing string.
   */
  readonly handlers: ReadonlyMap<string, AuthoringHandler>;
}

export class AuthoringError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'AuthoringError';
    this.path = path;
  }
}

function fail(message: string, path: string): never {
  throw new AuthoringError(message, path);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accepts anything React-shaped without depending on React: an element is an
 * object exposing `type` and `props`. React tags its elements, and both the
 * classic and the React 19 transitional tag are recognised, but an untagged
 * `{ type, props }` descriptor is equally valid so the adapter works with a
 * bare JSX pragma or a plain object literal.
 */
function isElement(value: unknown): value is AuthoringElement {
  if (!isPlainRecord(value)) return false;
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  if (tag !== undefined && tag !== REACT_ELEMENT && tag !== REACT_TRANSITIONAL_ELEMENT) return false;
  return 'type' in value && isPlainRecord(value.props);
}

/** Minimal `createElement`, so JSX can target this adapter directly. */
export function createElement(
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: AuthoringChild[]
): AuthoringElement {
  const { key, ...rest } = props ?? {};
  const resolved: Record<string, unknown> = { ...rest };
  if (children.length > 0) {
    resolved.children = children.length === 1 ? children[0] : children;
  }
  return {
    type,
    props: resolved,
    key: key === undefined || key === null ? null : (key as string | number),
  };
}

export const Fragment = REACT_FRAGMENT;

function segmentFromKey(key: string | number | null | undefined, index: number, path: string): string {
  if (key === null || key === undefined) return String(index);
  const raw = String(key);
  const cleaned = raw.replace(UNSAFE_KEY_CHARACTER, '-');
  if (cleaned.length === 0) fail('key produces an empty identifier segment', path);
  return cleaned;
}

function flattenChildren(value: unknown, out: unknown[]): void {
  if (value === null || value === undefined || value === false || value === true) return;
  if (Array.isArray(value)) {
    for (const entry of value) flattenChildren(entry, out);
    return;
  }
  out.push(value);
}

/**
 * Evaluates function components and fragments until a node-typed element is
 * reached. Components are plain synchronous functions of props: the adapter
 * deliberately provides no hooks, because guest state already lives in the
 * component program that decides when to render.
 */
function resolveElement(element: AuthoringElement, path: string): AuthoringElement {
  let current = element;
  for (let depth = 0; depth <= LIMITS.uiDepth; depth += 1) {
    const type = current.type;
    if (typeof type === 'string') return current;
    if (type === REACT_FRAGMENT) return current;
    if (typeof type !== 'function') {
      fail(`unsupported element type: ${String(type)}`, path);
    }
    const produced = (type as (props: Record<string, unknown>) => unknown)(current.props);
    if (!isElement(produced)) {
      fail('a component must return a single element', path);
    }
    current = { ...produced, key: produced.key ?? current.key ?? null };
  }
  return fail('component nesting exceeds the ABI depth limit', path);
}

interface BuildContext {
  readonly handlers: Map<string, AuthoringHandler>;
  readonly seenIds: Set<string>;
  readonly idPrefix: string;
}

function buildNode(
  input: unknown,
  idSegments: readonly string[],
  path: string,
  context: BuildContext,
): UiNode {
  if (!isElement(input)) {
    if (typeof input === 'string' || typeof input === 'number') {
      fail('bare text is not an ABI node; wrap it in a <text> element', path);
    }
    fail('expected an element', path);
  }

  const resolved = resolveElement(input, path);
  if (resolved.type === REACT_FRAGMENT) {
    fail('a fragment cannot be an ABI node; every node needs its own type and id', path);
  }

  const type = resolved.type as UiNodeType;
  if (typeof type !== 'string' || !NODE_TYPES.has(type)) {
    fail(`unknown node type: ${String(resolved.type)}`, path);
  }

  const { children: rawChildren, id: explicitId, ...rest } = resolved.props;

  const id = resolveId(explicitId, idSegments, path, context);
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if ((HANDLER_PROPS as readonly string[]).includes(key)) continue;
    props[key] = value;
  }

  for (const handlerProp of HANDLER_PROPS) {
    const candidate = rest[handlerProp];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'function') {
      fail(`${handlerProp} must be a function`, path);
    }
    if (props.handler !== undefined) {
      fail(`${handlerProp} and handler cannot both be set`, path);
    }
    // The handler id is the node id: unique by construction, stable across
    // renders, and never invented by the author.
    props.handler = id;
    context.handlers.set(id, candidate as AuthoringHandler);
  }

  const node: UiNode = { id, type, props };

  const flattened: unknown[] = [];
  flattenChildren(rawChildren, flattened);

  if (!CONTAINER_TYPES.has(type)) {
    if (flattened.length > 0) fail(`${type} cannot have children`, path);
    return node;
  }

  node.children = flattened.map((child, index) => {
    const childElement = isElement(child) ? resolveElement(child, `${path}[${index}]`) : child;
    const key = isElement(childElement) ? childElement.key : null;
    const segment = segmentFromKey(key, index, `${path}[${index}]`);
    return buildNode(child, [...idSegments, segment], `${path}[${index}]`, context);
  });

  return node;
}

function resolveId(
  explicitId: unknown,
  idSegments: readonly string[],
  path: string,
  context: BuildContext,
): string {
  let id: string;
  if (explicitId === undefined) {
    id = idSegments.length === 0 ? context.idPrefix : `${context.idPrefix}.${idSegments.join('.')}`;
    if (!NODE_ID.test(id)) {
      fail(
        `generated node id "${id}" is not a valid ABI id; give this node an explicit id`,
        path,
      );
    }
  } else {
    if (typeof explicitId !== 'string' || !NODE_ID.test(explicitId)) {
      fail(`explicit id must match ${String(NODE_ID)}`, path);
    }
    id = explicitId;
  }
  if (context.seenIds.has(id)) {
    fail(`duplicate node id "${id}"; give one of these nodes an explicit id`, path);
  }
  context.seenIds.add(id);
  return id;
}

/**
 * Builds an ABI 1 tree from an authored element and validates it with the same
 * validator the host runs. A violation surfaces here, in the guest, naming the
 * element path that caused it.
 */
export function renderTree(element: unknown, options: AuthoringOptions = {}): AuthoredTree {
  const idPrefix = options.idPrefix ?? 'n';
  if (!NODE_ID.test(idPrefix)) {
    fail(`idPrefix must match ${String(NODE_ID)}`, 'options.idPrefix');
  }

  const context: BuildContext = {
    handlers: new Map<string, AuthoringHandler>(),
    seenIds: new Set<string>(),
    idPrefix,
  };

  const built = buildNode(element, [], 'root', context);

  // The host is the authority. Running its validator here means the adapter can
  // never widen the contract by accident: anything it emits is something the
  // host would have accepted.
  const tree = validateUiTree(
    built,
    options.mediaHandles === undefined ? {} : { mediaHandles: options.mediaHandles },
  );

  // Validation rewrites props (defaults, normalisation) but never ids, so any
  // handler the author attached must still be addressable.
  for (const handler of context.handlers.keys()) {
    if (!context.seenIds.has(handler)) {
      throw new ContractViolation('render_invalid', `handler ${handler} lost its node`);
    }
  }

  return { abi: COMPONENT_ABI, tree, handlers: context.handlers };
}

/**
 * Routes a `ui.interaction` payload to the function the author attached.
 * Returns false when no handler matches, so a stale interaction from a previous
 * render is ignored rather than misrouted to whatever now owns that id.
 */
export function dispatchInteraction(
  authored: AuthoredTree,
  handler: unknown,
  payload: unknown,
): boolean {
  if (typeof handler !== 'string') return false;
  const target = authored.handlers.get(handler);
  if (target === undefined) return false;
  target(payload);
  return true;
}
