import { describe, expect, test } from 'bun:test';

import {
  DISABLED_NODE_TYPES,
  PENDING_NODE_TYPES,
  validateUiTree,
  type DisabledNodeType,
  type UiNode,
} from '../src/contract';
import { collectInteractionTargets } from '../src/runtime-broker';

const CONTROL_PROPS: Record<DisabledNodeType, Record<string, unknown>> = {
  button: { label: 'Unlock the door', handler: 'entry.unlock' },
  toggle: { label: 'Kitchen', value: false, handler: 'lighting.kitchen.toggle' },
  input: { label: 'Scene name', value: 'Evening', handler: 'scene.rename' },
  select: {
    label: 'Scene',
    value: 'evening',
    handler: 'scene.select',
    options: [{ value: 'evening', label: 'Evening' }],
  },
};

/**
 * Validated rather than hand-built, so the target map is collected from the same
 * shape a real render produces — including the defaults `validateUiTree` fills
 * in for props the component left out.
 */
function control(type: DisabledNodeType, inert: Record<string, boolean>): UiNode {
  return validateUiTree({
    id: 'root',
    type: 'screen',
    props: { title: 'Control surface' },
    children: [{ id: 'control', type, props: { ...CONTROL_PROPS[type], ...inert } }],
  });
}

describe('collectInteractionTargets', () => {
  test('closes every control the contract lets a component mark pending', () => {
    // Guards the loop against passing vacuously if the vocabulary is emptied.
    expect(PENDING_NODE_TYPES).toHaveLength(4);

    for (const type of PENDING_NODE_TYPES) {
      const targets = collectInteractionTargets(control(type, { pending: true }));

      // The host paints a pending control inert. This is the half that refuses
      // an interaction arriving for it regardless — from a stale render, a host
      // defect, or a guest replaying its own `ui.interaction`. `input` and
      // `select` were open here while `button` and `toggle` were closed.
      expect(targets.get('control')?.disabled).toBe(true);
    }
  });

  test('closes every control the contract lets a component disable', () => {
    expect(DISABLED_NODE_TYPES).toHaveLength(4);

    for (const type of DISABLED_NODE_TYPES) {
      const targets = collectInteractionTargets(control(type, { disabled: true }));

      expect(targets.get('control')?.disabled).toBe(true);
    }
  });

  test('leaves a control that declared neither flag open', () => {
    for (const type of DISABLED_NODE_TYPES) {
      const targets = collectInteractionTargets(control(type, {}));

      expect(targets.get('control')?.disabled).toBe(false);
      expect(targets.get('control')?.handler).toBe(CONTROL_PROPS[type].handler as string);
    }
  });
});
