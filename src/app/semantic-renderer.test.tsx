import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  PENDING_NODE_TYPES,
  STATUS_STATES,
  type PendingNodeType,
  type StatusState,
  type UiNode,
} from '../../component-runtime/src/contract';
import { createDemoTree } from './demo-tree';
import { SemanticRenderer } from './semantic-renderer';

const INITIAL_STATE = {
  entryLocked: true,
  kitchenLights: false,
  livingRoomLights: true,
  selectedScene: 'evening' as const,
  lastAction: 'Nothing yet.',
};

function statusTree(state: StatusState): UiNode {
  return {
    id: 'root',
    type: 'screen',
    props: { title: 'Status surface' },
    children: [
      { id: 'status', type: 'status', props: { label: 'Comfort', state } },
    ],
  };
}

function pendingControlTree(type: PendingNodeType): UiNode {
  const props = type === 'button'
    ? { label: 'Unlock the door', handler: 'entry.unlock', pending: true }
    : { label: 'Kitchen', value: false, handler: 'lighting.kitchen.toggle', pending: true };

  return {
    id: 'root',
    type: 'screen',
    props: { title: 'Pending surface' },
    children: [{ id: 'control', type, props }],
  };
}

describe('SemanticRenderer', () => {
  it('renders a validated ABI tree and emits structured interactions', () => {
    const onInteraction = vi.fn();

    render(<SemanticRenderer onInteraction={onInteraction} tree={createDemoTree(INITIAL_STATE)} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Good evening, Mathieu.' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Front door camera preview' })).toHaveAttribute(
      'data-media-handle',
      'media.front_door',
    );
    expect(
      screen.getByRole('status', { name: 'Comfort: Accepted — Stable for 2 hours' }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Kitchen' }));
    expect(onInteraction).toHaveBeenCalledWith({
      event: 'change',
      handler: 'lighting.kitchen.toggle',
      value: true,
    });
  });

  it('fails closed before rendering properties outside the semantic contract', () => {
    const invalidTree: UiNode = {
      id: 'root',
      type: 'screen',
      props: {
        title: 'Untrusted screen',
        style: 'background-image: url(https://attacker.example/collect)',
      },
    };

    render(<SemanticRenderer onInteraction={vi.fn()} tree={invalidTree} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Component blocked');
    expect(screen.getByRole('alert')).toHaveTextContent('screen.props.style is not allowed');
    expect(screen.queryByRole('heading', { name: 'Untrusted screen' })).not.toBeInTheDocument();
  });

  it('names every contract status state in trusted text, not only in the dot colour', () => {
    // Guards the loop below against passing vacuously if the vocabulary is emptied.
    expect(STATUS_STATES).toHaveLength(7);

    const terms = new Map<StatusState, string>();

    for (const state of STATUS_STATES) {
      const { unmount } = render(
        <SemanticRenderer
          onInteraction={vi.fn()}
          tree={statusTree(state)}
        />,
      );

      const status = screen.getByRole('status');
      const term = status.querySelector('.semantic-status__term')?.textContent ?? '';

      expect(term).not.toBe('');
      // The state must survive into the accessible name, which the dot cannot reach.
      expect(status).toHaveAccessibleName(`Comfort: ${term}`);
      expect(status).toHaveAttribute('data-status-state', state);

      terms.set(state, term);
      unmount();
    }

    // A term shared by two states would put them back in one indistinguishable bucket.
    expect(new Set(terms.values()).size).toBe(STATUS_STATES.length);
  });

  it('tells pending, stale and outcome-unknown apart', () => {
    for (const [state, expected] of [
      ['pending', 'Pending'],
      ['stale', 'Stale'],
      ['outcome_unknown', 'Outcome unknown'],
    ] as const) {
      const { unmount } = render(
        <SemanticRenderer onInteraction={vi.fn()} tree={statusTree(state)} />,
      );

      expect(screen.getByRole('status')).toHaveTextContent(expected);
      unmount();
    }
  });

  it('keeps a pending control named and says why it stopped answering', () => {
    // Guards the loop below against passing vacuously if the vocabulary is emptied.
    expect(PENDING_NODE_TYPES).toHaveLength(2);

    for (const type of PENDING_NODE_TYPES) {
      const { unmount } = render(
        <SemanticRenderer onInteraction={vi.fn()} tree={pendingControlTree(type)} />,
      );

      const control = screen.getByRole(type === 'button' ? 'button' : 'checkbox');
      const label = type === 'button' ? 'Unlock the door' : 'Kitchen';
      const term = document
        .querySelector(`.semantic-${type}__pending`)
        ?.textContent ?? '';

      expect(term).not.toBe('');
      // The host disables it; without the term the control just reads as broken.
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('aria-busy', 'true');
      // The label a person reached for has to survive the pending state.
      expect(control).toHaveAccessibleName(`${label} ${term}`);

      unmount();
    }
  });

  it('leaves a settled control untouched by the pending vocabulary', () => {
    render(<SemanticRenderer onInteraction={vi.fn()} tree={createDemoTree(INITIAL_STATE)} />);

    const toggle = screen.getByRole('checkbox', { name: 'Kitchen' });

    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-busy', 'false');
    expect(document.querySelector('.semantic-toggle__pending')).toBeNull();
    expect(document.querySelector('.semantic-button__pending')).toBeNull();
  });

  it('rejects media that the trusted host did not grant', () => {
    render(
      <SemanticRenderer
        mediaHandles={new Set()}
        onInteraction={vi.fn()}
        tree={createDemoTree(INITIAL_STATE)}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('capability_denied');
  });
});
