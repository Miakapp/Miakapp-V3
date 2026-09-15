import { describe, expect, test } from 'bun:test';
import { COMPONENT_ABI, ContractViolation } from '../src/contract';
import {
  AuthoringError,
  createElement as h,
  dispatchInteraction,
  Fragment,
  renderTree,
} from '../src/authoring';

const screen = (...children: unknown[]) =>
  h('screen', { title: 'Test home' }, ...(children as never[]));

describe('authoring adapter', () => {
  test('emits an ABI 1 tree the host validator accepts', () => {
    const authored = renderTree(
      screen(
        h('stack', { gap: 'medium' },
          h('text', { text: 'Temperature: 21' }),
          h('status', { label: 'Light operation', state: 'applied' }),
        ),
      ),
    );

    expect(authored.abi).toBe(COMPONENT_ABI);
    expect(authored.tree.type).toBe('screen');
    expect(authored.tree.children![0]!.children!.map((node) => node.type)).toEqual(['text', 'status']);
    // The validator fills declared defaults, proving this is its output.
    expect(authored.tree.children![0]!.children![0]!.props.tone).toBe('default');
  });

  test('a handler id is the node id, so the author never invents a routing string', () => {
    let pressed = 0;
    const authored = renderTree(
      screen(h('button', { label: 'Toggle light', onPress: () => { pressed += 1; } })),
    );

    const button = authored.tree.children![0]!;
    expect(button?.type).toBe('button');
    expect(button?.props.handler).toBe(button?.id);
    expect([...authored.handlers.keys()]).toEqual([button!.id]);

    expect(dispatchInteraction(authored, button!.props.handler, undefined)).toBe(true);
    expect(pressed).toBe(1);
  });

  test('an interaction for an unknown handler is ignored, not misrouted', () => {
    const authored = renderTree(screen(h('button', { label: 'Go', onPress: () => {} })));
    expect(dispatchInteraction(authored, 'n.9', undefined)).toBe(false);
    expect(dispatchInteraction(authored, undefined, undefined)).toBe(false);
  });

  test('keys make ids stable when a list is reordered', () => {
    const lamps = (order: readonly string[]) =>
      renderTree(
        screen(
          h('stack', { gap: 'small' },
            ...order.map((name) =>
              h('toggle', { key: name, label: name, value: true, onChange: () => {} }),
            ),
          ),
        ),
      );

    const before = lamps(['kitchen', 'hall']);
    const after = lamps(['hall', 'kitchen']);

    const idFor = (tree: typeof before, label: string) =>
      tree.tree.children![0]!.children!.find((node) => node.props.label === label)?.id;

    expect(idFor(before, 'kitchen')).toBe(idFor(after, 'kitchen')!);
    expect(idFor(before, 'hall')).toBe(idFor(after, 'hall')!);
    expect(idFor(before, 'kitchen')).not.toBe(idFor(before, 'hall')!);
  });

  test('positional ids change when an unkeyed list is reordered', () => {
    // Documents the cost of omitting keys: identity follows position, so the
    // host rebinds controls. The adapter does not hide this.
    const unkeyed = (order: readonly string[]) =>
      renderTree(
        screen(
          h('stack', { gap: 'small' },
            ...order.map((name) => h('text', { text: name })),
          ),
        ),
      );

    const before = unkeyed(['a', 'b']);
    const after = unkeyed(['b', 'a']);
    const first = (tree: typeof before) => tree.tree.children![0]!.children![0]!;

    expect(first(before)?.id).toBe(first(after)!.id);
    expect(first(before)?.props.text).not.toBe(first(after)!.props.text);
  });

  test('function components are evaluated and inherit their key', () => {
    const Lamp = (props: Record<string, unknown>) =>
      h('toggle', { label: props.name as string, value: props.on as boolean, onChange: () => {} });

    const authored = renderTree(
      screen(
        h('stack', { gap: 'small' },
          h(Lamp, { key: 'kitchen', name: 'Kitchen', on: true }),
        ),
      ),
    );

    const toggle = authored.tree.children![0]!.children![0]!;
    expect(toggle?.type).toBe('toggle');
    expect(toggle?.id).toBe('n.0.kitchen');
  });

  test('a component returning a non-element is an authoring error', () => {
    const Broken = () => 'just text' as unknown as never;
    expect(() => renderTree(screen(h(Broken, null)))).toThrow(AuthoringError);
  });

  test('rejects an unknown node type before it reaches the broker', () => {
    expect(() => renderTree(screen(h('iframe', { src: 'https://example.test' })))).toThrow(
      /unknown node type: iframe/,
    );
  });

  test('rejects a fragment used as a node, because a node needs its own id', () => {
    expect(() => renderTree(screen(h(Fragment, null, h('text', { text: 'x' }))))).toThrow(
      AuthoringError,
    );
  });

  test('rejects bare text with an instruction instead of a validator error', () => {
    expect(() => renderTree(screen('Temperature: 21'))).toThrow(/wrap it in a <text> element/);
  });

  test('rejects children on a leaf node', () => {
    expect(() => renderTree(screen(h('text', { text: 'x' }, h('text', { text: 'y' }))))).toThrow(
      /text cannot have children/,
    );
  });

  test('rejects a non-function handler prop', () => {
    expect(() => renderTree(screen(h('button', { label: 'Go', onPress: 'toggle' })))).toThrow(
      /onPress must be a function/,
    );
  });

  test('rejects setting both a handler function and a handler string', () => {
    expect(() =>
      renderTree(screen(h('button', { label: 'Go', handler: 'go', onPress: () => {} }))),
    ).toThrow(/cannot both be set/);
  });

  test('keeps an explicit handler string working for manual routing', () => {
    const authored = renderTree(screen(h('button', { label: 'Go', handler: 'go' })));
    expect(authored.tree.children![0]!.props.handler).toBe('go');
    expect(authored.handlers.size).toBe(0);
  });

  test('rejects a duplicate id and says how to fix it', () => {
    expect(() =>
      renderTree(
        screen(
          h('stack', { gap: 'small' },
            h('text', { id: 'same', text: 'a' }),
            h('text', { id: 'same', text: 'b' }),
          ),
        ),
      ),
    ).toThrow(/duplicate node id "same"/);
  });

  test('rejects an explicit id the ABI would reject', () => {
    expect(() => renderTree(screen(h('text', { id: '1bad', text: 'a' })))).toThrow(/explicit id/);
  });

  test('rejects an id-hostile key rather than emitting an invalid id', () => {
    expect(() =>
      renderTree(screen(h('stack', { gap: 'small' }, h('text', { key: '@@@', text: 'a' })))),
    ).not.toThrow();
    expect(() =>
      renderTree(screen(h('stack', { gap: 'small' }, h('text', { key: '', text: 'a' })))),
    ).toThrow(AuthoringError);
  });

  test('host contract violations still surface, with the host error type', () => {
    // The adapter never widens the contract: a prop the ABI does not declare is
    // rejected by the host validator, not silently dropped.
    expect(() => renderTree(screen(h('text', { text: 'x', colour: 'red' })))).toThrow(
      ContractViolation,
    );
    expect(() => renderTree(h('stack', { gap: 'medium' }))).toThrow(/root must be a screen/);
    expect(() => renderTree(screen(h('progress', { label: 'p', value: 2 })))).toThrow(
      ContractViolation,
    );
  });

  test('a media handle stays capability-gated through the adapter', () => {
    const tree = screen(h('media', { label: 'Doorbell', handle: 'camera.front' }));
    expect(() => renderTree(tree)).toThrow(ContractViolation);
    expect(
      renderTree(tree, { mediaHandles: new Set(['camera.front']) }).tree.children![0]!.props.handle,
    ).toBe('camera.front');
  });

  test('idPrefix is validated and applied', () => {
    expect(renderTree(screen(), { idPrefix: 'lamp' }).tree.id).toBe('lamp');
    expect(() => renderTree(screen(), { idPrefix: '1' })).toThrow(/idPrefix/);
  });

  test('accepts a React-tagged element without importing React', () => {
    const reactElement = {
      $$typeof: Symbol.for('react.element'),
      type: 'text',
      props: { text: 'from React' },
      key: null,
    };
    const authored = renderTree(screen(reactElement));
    expect(authored.tree.children![0]!.props.text).toBe('from React');
  });

  test('rejects an element tagged as another React construct', () => {
    const portal = { $$typeof: Symbol.for('react.portal'), type: 'text', props: { text: 'x' } };
    expect(() => renderTree(screen(portal))).toThrow(AuthoringError);
  });

  test('false and null children are skipped, so conditionals read naturally', () => {
    const authored = renderTree(
      screen(
        h('stack', { gap: 'small' },
          false,
          h('text', { text: 'shown' }),
          null,
          undefined,
        ),
      ),
    );
    expect(authored.tree.children![0]!.children).toHaveLength(1);
  });
});
