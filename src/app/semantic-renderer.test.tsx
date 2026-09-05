import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UiNode } from '../../component-runtime/src/contract';
import { createDemoTree } from './demo-tree';
import { SemanticRenderer } from './semantic-renderer';

const INITIAL_STATE = {
  entryLocked: true,
  kitchenLights: false,
  livingRoomLights: true,
  selectedScene: 'evening' as const,
  lastAction: 'Nothing yet.',
};

describe('SemanticRenderer', () => {
  it('renders a validated ABI tree and emits structured interactions', () => {
    const onInteraction = vi.fn();

    render(<SemanticRenderer onInteraction={onInteraction} tree={createDemoTree(INITIAL_STATE)} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Good evening, Mathieu.' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Front door camera preview' })).toHaveAttribute(
      'data-media-handle',
      'media.front_door',
    );

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
