import { useMemo } from 'react';

import {
  ContractViolation,
  PENDING_NODE_TYPES,
  validateUiTree,
  type DisabledNodeType,
  type PendingNodeType,
  type StatusState,
  type UiNode,
} from '../../component-runtime/src/contract';
import type { SemanticInteraction } from './host';
import { LockIcon } from './icons';

const PREVIEW_MEDIA_HANDLES = new Set(['media.front_door']);

/**
 * Host-owned term for every contract status state. The dot colour used to be the
 * only channel carrying the state, which put it out of reach of assistive
 * technology entirely and collapsed `pending`, `stale` and `outcome_unknown`
 * into one amber bucket — three states a person has to tell apart to know
 * whether an action is still coming, already old, or may have applied. The term
 * is host text next to the component's label, never supplied by the component.
 * Typing it as a total record over `StatusState` is what keeps it exhaustive.
 */
const STATUS_TERMS: Record<StatusState, string> = {
  idle: 'Idle',
  pending: 'Pending',
  accepted: 'Accepted',
  applied: 'Applied',
  failed: 'Failed',
  stale: 'Stale',
  outcome_unknown: 'Outcome unknown',
};

/**
 * Host-owned term for every control the contract lets a component mark pending.
 * The host disables a pending control, and a control that goes inert without
 * saying so reads as broken rather than busy. The term sits beside the
 * component's own label instead of replacing it, so the control keeps the name
 * a person reached for; `aria-busy` repeats it to assistive technology.
 * Typing it as a total record over `PendingNodeType` is what keeps it
 * exhaustive.
 */
const PENDING_TERMS: Record<PendingNodeType, string> = {
  button: 'Working…',
  toggle: 'Working…',
  input: 'Working…',
  select: 'Working…',
};

/**
 * Host-owned term for every control the contract lets a component disable.
 * Before this, `disabled` reached a person through appearance alone, and only
 * for `button` (`opacity: .55`). A disabled `toggle` was pixel-identical to a
 * live one — its real checkbox is visually hidden and the painted track is
 * `aria-hidden` — and `input` and `select` had no disabled treatment at all.
 * Like the pending term, this is host text beside the component's own label, so
 * a component can neither forge it nor suppress it. Typing it as a total record
 * over `DisabledNodeType` is what keeps it exhaustive.
 */
const DISABLED_TERMS: Record<DisabledNodeType, string> = {
  button: 'Unavailable',
  toggle: 'Unavailable',
  input: 'Unavailable',
  select: 'Unavailable',
};

const PENDING_CAPABLE: ReadonlySet<string> = new Set<string>(PENDING_NODE_TYPES);

/**
 * Not every control the contract lets a component disable can also be marked
 * pending, so reaching `PENDING_TERMS` needs a narrowing. Deriving it from
 * `PENDING_NODE_TYPES` rather than spelling the members out is what keeps it
 * honest: a hand-written `type === 'button' || …` stays valid TypeScript after
 * the contract gains a pending-capable control, and silently drops that
 * control's pending term on the floor.
 */
function isPendingCapable(type: DisabledNodeType): type is DisabledNodeType & PendingNodeType {
  return PENDING_CAPABLE.has(type);
}

/**
 * The two reasons a control can be inert are not equals. `pending` implies the
 * host disabled the control itself, so both terms would otherwise fire at once
 * and stack two explanations onto one control. Pending is the more specific and
 * the more perishable of the two, so it wins; `disabled` is what remains when
 * nothing is in flight.
 */
function inertTerm(type: DisabledNodeType, disabled: boolean, pending: boolean): string | null {
  if (pending && isPendingCapable(type)) return PENDING_TERMS[type];
  return disabled ? DISABLED_TERMS[type] : null;
}

/**
 * The separator is load-bearing: two adjacent JSX text nodes produce no space
 * in the accessible name, which would run the label and the term together.
 */
function InertTerm({ className, term }: { className: string; term: string | null }) {
  if (term === null) return null;
  return <>{' '}<small className={className}>{term}</small></>;
}

interface SemanticRendererProps {
  readonly tree: unknown;
  readonly onInteraction: (interaction: SemanticInteraction) => void;
  readonly mediaHandles?: ReadonlySet<string>;
}

interface ValidationSuccess {
  readonly ok: true;
  readonly tree: UiNode;
}

interface ValidationFailure {
  readonly ok: false;
  readonly message: string;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

function stringProp(node: UiNode, name: string): string {
  return node.props[name] as string;
}

function booleanProp(node: UiNode, name: string): boolean {
  return node.props[name] as boolean;
}

function numberProp(node: UiNode, name: string): number {
  return node.props[name] as number;
}

function statusState(node: UiNode): StatusState {
  return node.props.state as StatusState;
}

function children(
  node: UiNode,
  onInteraction: SemanticRendererProps['onInteraction'],
): React.ReactNode {
  return node.children?.map((child) => renderNode(child, onInteraction));
}

function renderNode(
  node: UiNode,
  onInteraction: SemanticRendererProps['onInteraction'],
): React.JSX.Element {
  switch (node.type) {
    case 'screen':
      return (
        <section className="semantic-screen" data-node-id={node.id} key={node.id}>
          <header className="semantic-screen__heading">
            <p className="eyebrow">Your living interface</p>
            <h1>{stringProp(node, 'title')}</h1>
          </header>
          {children(node, onInteraction)}
        </section>
      );
    case 'stack':
      return (
        <div
          className={[
            'semantic-stack',
            `semantic-stack--${stringProp(node, 'direction')}`,
            `semantic-gap--${stringProp(node, 'gap')}`,
            `semantic-align--${stringProp(node, 'align')}`,
          ].join(' ')}
          data-node-id={node.id}
          key={node.id}
        >
          {children(node, onInteraction)}
        </div>
      );
    case 'grid':
      return (
        <div
          className={`semantic-grid semantic-gap--${stringProp(node, 'gap')}`}
          data-columns={numberProp(node, 'columns')}
          data-node-id={node.id}
          key={node.id}
          style={{ '--semantic-columns': numberProp(node, 'columns') } as React.CSSProperties}
        >
          {children(node, onInteraction)}
        </div>
      );
    case 'section':
      return (
        <section className="semantic-card" data-node-id={node.id} key={node.id}>
          <header className="semantic-card__heading">
            <h2>{stringProp(node, 'heading')}</h2>
            {node.props.description ? <p>{stringProp(node, 'description')}</p> : null}
          </header>
          <div className="semantic-card__body">{children(node, onInteraction)}</div>
        </section>
      );
    case 'text':
      return (
        <p
          className={[
            'semantic-text',
            `semantic-text--${stringProp(node, 'tone')}`,
            `semantic-text--${stringProp(node, 'emphasis')}`,
          ].join(' ')}
          data-node-id={node.id}
          key={node.id}
        >
          {stringProp(node, 'text')}
        </p>
      );
    case 'status': {
      const state = statusState(node);
      const term = STATUS_TERMS[state];
      const label = stringProp(node, 'label');
      const detail = node.props.detail ? stringProp(node, 'detail') : undefined;
      return (
        <div
          aria-label={detail ? `${label}: ${term} — ${detail}` : `${label}: ${term}`}
          className={`semantic-status semantic-status--${state}`}
          data-node-id={node.id}
          data-status-state={state}
          key={node.id}
          role="status"
        >
          <span className="semantic-status__dot" />
          <span>
            <strong>{label}</strong>
            <small className="semantic-status__term">{term}</small>
            {detail ? <small>{detail}</small> : null}
          </span>
        </div>
      );
    }
    case 'button': {
      const pending = booleanProp(node, 'pending');
      return (
        <button
          aria-busy={pending}
          className={`semantic-button semantic-button--${stringProp(node, 'variant')}`}
          data-node-id={node.id}
          disabled={booleanProp(node, 'disabled') || pending}
          key={node.id}
          onClick={() => onInteraction({
            event: 'press',
            handler: stringProp(node, 'handler'),
          })}
          type="button"
        >
          {stringProp(node, 'label')}
          <InertTerm
            className="semantic-inert-term"
            term={inertTerm('button', booleanProp(node, 'disabled'), pending)}
          />
        </button>
      );
    }
    case 'toggle': {
      const value = booleanProp(node, 'value');
      const pending = booleanProp(node, 'pending');
      return (
        <label className="semantic-toggle" data-node-id={node.id} key={node.id}>
          <span>{stringProp(node, 'label')}</span>
          <InertTerm
            className="semantic-inert-term"
            term={inertTerm('toggle', booleanProp(node, 'disabled'), pending)}
          />
          <input
            aria-busy={pending}
            checked={value}
            disabled={booleanProp(node, 'disabled') || pending}
            onChange={(event) => onInteraction({
              event: 'change',
              handler: stringProp(node, 'handler'),
              value: event.currentTarget.checked,
            })}
            type="checkbox"
          />
          <span aria-hidden="true" className="semantic-toggle__track"><span /></span>
        </label>
      );
    }
    case 'input': {
      const pending = booleanProp(node, 'pending');
      return (
        <label className="semantic-field" data-node-id={node.id} key={node.id}>
          <span>
            {stringProp(node, 'label')}
            <InertTerm
              className="semantic-inert-term"
              term={inertTerm('input', booleanProp(node, 'disabled'), pending)}
            />
          </span>
          <input
            aria-busy={pending}
            disabled={booleanProp(node, 'disabled') || pending}
            maxLength={numberProp(node, 'max_length')}
            onChange={(event) => onInteraction({
              event: 'change',
              handler: stringProp(node, 'handler'),
              value: event.currentTarget.value,
            })}
            type={stringProp(node, 'input_type')}
            value={stringProp(node, 'value')}
          />
        </label>
      );
    }
    case 'select': {
      const options = node.props.options as Array<{ value: string; label: string }>;
      const pending = booleanProp(node, 'pending');
      return (
        <label className="semantic-field" data-node-id={node.id} key={node.id}>
          <span>
            {stringProp(node, 'label')}
            <InertTerm
              className="semantic-inert-term"
              term={inertTerm('select', booleanProp(node, 'disabled'), pending)}
            />
          </span>
          <select
            aria-busy={pending}
            disabled={booleanProp(node, 'disabled') || pending}
            onChange={(event) => onInteraction({
              event: 'change',
              handler: stringProp(node, 'handler'),
              value: event.currentTarget.value,
            })}
            value={stringProp(node, 'value')}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      );
    }
    case 'progress': {
      const value = numberProp(node, 'value');
      return (
        <div className="semantic-progress" data-node-id={node.id} key={node.id}>
          <span>{stringProp(node, 'label')}</span>
          <div
            aria-label={stringProp(node, 'label')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(value * 100)}
            className="semantic-progress__track"
            role="progressbar"
          >
            <span style={{ width: `${value * 100}%` }} />
          </div>
        </div>
      );
    }
    case 'media':
      return (
        <div
          aria-label={`${stringProp(node, 'label')} preview`}
          className="semantic-media"
          data-media-handle={stringProp(node, 'handle')}
          data-node-id={node.id}
          key={node.id}
          role="img"
        >
          <span className="semantic-media__glow" />
          <span className="semantic-media__door"><LockIcon /></span>
          <small>Capability-gated media</small>
        </div>
      );
  }
}

function validate(tree: unknown, mediaHandles: ReadonlySet<string>): ValidationResult {
  try {
    return { ok: true, tree: validateUiTree(tree, { mediaHandles }) };
  } catch (error) {
    const message = error instanceof ContractViolation
      ? `${error.code}: ${error.message}`
      : 'The component returned an invalid semantic tree.';
    return { ok: false, message };
  }
}

export function SemanticRenderer({
  tree,
  onInteraction,
  mediaHandles = PREVIEW_MEDIA_HANDLES,
}: SemanticRendererProps): React.JSX.Element {
  const result = useMemo(() => validate(tree, mediaHandles), [mediaHandles, tree]);

  if (!result.ok) {
    return (
      <section className="semantic-error" role="alert">
        <strong>Component blocked</strong>
        <p>The trusted host rejected this interface before rendering it.</p>
        <code>{result.message}</code>
      </section>
    );
  }

  return renderNode(result.tree, onInteraction);
}
