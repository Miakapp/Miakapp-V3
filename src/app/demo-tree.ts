import type { UiNode } from '../../component-runtime/src/contract';

export interface DemoHomeState {
  readonly entryLocked: boolean;
  readonly kitchenLights: boolean;
  readonly livingRoomLights: boolean;
  readonly selectedScene: 'evening' | 'focus' | 'away';
  readonly lastAction: string;
}

function text(
  id: string,
  value: string,
  tone: 'default' | 'muted' | 'positive' | 'warning' | 'critical' = 'default',
  emphasis: 'normal' | 'strong' = 'normal',
): UiNode {
  return {
    id,
    type: 'text',
    props: { text: value, tone, emphasis },
  };
}

function status(
  id: string,
  label: string,
  detail: string,
  state: 'idle' | 'pending' | 'accepted' | 'applied' | 'failed' | 'stale' | 'outcome_unknown',
): UiNode {
  return {
    id,
    type: 'status',
    props: { label, detail, state },
  };
}

export function createDemoTree(state: DemoHomeState): UiNode {
  const lightCount = Number(state.livingRoomLights) + Number(state.kitchenLights) + 2;

  return {
    id: 'horizon',
    type: 'screen',
    props: { title: 'Good evening, Mathieu.' },
    children: [
      {
        id: 'intro',
        type: 'stack',
        props: { gap: 'small' },
        children: [
          text(
            'intro-summary',
            'Your home is calm. Nothing needs your attention.',
            'default',
            'strong',
          ),
          text(
            'intro-detail',
            'A live preview rendered through the same closed semantic UI contract as a home-authored bundle.',
            'muted',
          ),
        ],
      },
      {
        id: 'rooms',
        type: 'grid',
        props: { columns: 3, gap: 'medium' },
        children: [
          {
            id: 'climate',
            type: 'section',
            props: {
              heading: 'Climate',
              description: 'Living room',
            },
            children: [
              text('climate-temperature', '21.4°', 'default', 'strong'),
              status('climate-trend', 'Comfort', 'Stable for 2 hours', 'accepted'),
              {
                id: 'climate-humidity',
                type: 'progress',
                props: { label: 'Humidity · 47%', value: 0.47 },
              },
            ],
          },
          {
            id: 'lighting',
            type: 'section',
            props: {
              heading: 'Lighting',
              description: `${lightCount} lights on`,
            },
            children: [
              {
                id: 'lighting-living',
                type: 'toggle',
                props: {
                  label: 'Living room',
                  value: state.livingRoomLights,
                  handler: 'lighting.living.toggle',
                },
              },
              {
                id: 'lighting-kitchen',
                type: 'toggle',
                props: {
                  label: 'Kitchen',
                  value: state.kitchenLights,
                  handler: 'lighting.kitchen.toggle',
                },
              },
              {
                id: 'lighting-settle',
                type: 'button',
                props: {
                  label: 'Settle in',
                  handler: 'lighting.settle',
                  variant: 'secondary',
                },
              },
            ],
          },
          {
            id: 'energy',
            type: 'section',
            props: {
              heading: 'Energy',
              description: 'Producing more than you use',
            },
            children: [
              text('energy-production', '3.8 kW solar', 'positive', 'strong'),
              text('energy-consumption', '1.6 kW home · 1.2 kW battery', 'muted'),
              {
                id: 'energy-battery',
                type: 'progress',
                props: { label: 'Home battery · 72%', value: 0.72 },
              },
            ],
          },
          {
            id: 'entry',
            type: 'section',
            props: {
              heading: 'Entry',
              description: 'Last opened 18 minutes ago',
            },
            children: [
              status(
                'entry-state',
                'Front door',
                state.entryLocked ? 'Locked' : 'Unlocked in preview',
                state.entryLocked ? 'accepted' : 'outcome_unknown',
              ),
              {
                id: 'entry-camera',
                type: 'media',
                props: { label: 'Front door camera', handle: 'media.front_door' },
              },
              {
                id: 'entry-lock',
                type: 'button',
                props: {
                  label: state.entryLocked ? 'Preview unlock' : 'Lock again',
                  handler: 'entry.lock.toggle',
                  variant: state.entryLocked ? 'secondary' : 'primary',
                },
              },
            ],
          },
          {
            id: 'scenes',
            type: 'section',
            props: {
              heading: 'Scenes',
              description: 'Small changes, one intention',
            },
            children: [
              {
                id: 'scene-choice',
                type: 'select',
                props: {
                  label: 'Choose a scene',
                  value: state.selectedScene,
                  handler: 'scene.select',
                  options: [
                    { value: 'evening', label: 'Slow evening' },
                    { value: 'focus', label: 'Deep focus' },
                    { value: 'away', label: 'Everyone away' },
                  ],
                },
              },
              {
                id: 'scene-apply',
                type: 'button',
                props: {
                  label: 'Apply scene',
                  handler: 'scene.apply',
                  variant: 'primary',
                },
              },
              text('scene-last-action', state.lastAction, 'muted'),
            ],
          },
          {
            id: 'air',
            type: 'section',
            props: {
              heading: 'Air quality',
              description: 'Bedroom',
            },
            children: [
              text('air-score', 'Excellent', 'positive', 'strong'),
              status('air-window', 'Window', 'Closed · rain expected at 23:00', 'idle'),
              {
                id: 'air-quality',
                type: 'progress',
                props: { label: 'Freshness · 91%', value: 0.91 },
              },
            ],
          },
        ],
      },
    ],
  };
}
