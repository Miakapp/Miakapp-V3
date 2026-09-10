import type { BrowserClient } from './miakapi-browser';

import type { UiNode } from '../../component-runtime/src/contract';

type LiveState = NonNullable<ReturnType<BrowserClient['state']['snapshot']>>['values'];

function text(
  id: string,
  value: string,
  tone: 'default' | 'muted' | 'positive' | 'warning' | 'critical' = 'default',
  emphasis: 'normal' | 'strong' = 'normal',
): UiNode {
  return { id, type: 'text', props: { text: value, tone, emphasis } };
}

function stringValue(
  state: LiveState,
  path: string,
  fallback: string,
): string {
  const value = state[path];
  return typeof value === 'string' ? value : fallback;
}

function numberValue(
  state: LiveState,
  path: string,
): number | undefined {
  const value = state[path];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(
  state: LiveState,
  path: string,
): boolean | undefined {
  const value = state[path];
  return typeof value === 'boolean' ? value : undefined;
}

export interface LiveTreeOptions {
  readonly connected: boolean;
  readonly pendingAction: boolean;
  readonly state: LiveState;
}

export function createLiveTree(options: LiveTreeOptions): UiNode {
  const { connected, pendingAction, state } = options;
  const lightOn = booleanValue(state, 'zone.alpha.light.on');
  const temperature = numberValue(state, 'climate.zone_gamma.temperature');
  const setpoint = numberValue(state, 'climate.zone_gamma.setpoint');
  const gridPower = numberValue(state, 'energy.grid.power_w');
  const battery = numberValue(state, 'device.contact_alpha.battery_percent');
  const barrier = stringValue(state, 'access.barrier.phase', 'Unknown');
  const coordinator = stringValue(state, 'service.coordinator.health', 'Waiting');

  return {
    id: 'live-home',
    type: 'screen',
    props: { title: 'Miakapp staging home' },
    children: [
      {
        id: 'live-summary',
        type: 'stack',
        props: { gap: 'small' },
        children: [
          text(
            'live-summary-title',
            connected ? 'The browser is receiving real relay state.' : 'Waiting for a live home.',
            connected ? 'positive' : 'muted',
            'strong',
          ),
          text(
            'live-summary-detail',
            'This screen is rendered by the trusted host from MiakAPI state. No Node-RED dependency is involved.',
            'muted',
          ),
        ],
      },
      {
        id: 'live-grid',
        type: 'grid',
        props: { columns: 3, gap: 'medium' },
        children: [
          {
            id: 'live-lighting',
            type: 'section',
            props: { heading: 'Lighting', description: 'Synthetic zone alpha' },
            children: [
              text(
                'live-light-state',
                lightOn === undefined ? 'State unavailable' : lightOn ? 'Light is on' : 'Light is off',
                lightOn === undefined ? 'muted' : lightOn ? 'positive' : 'default',
                'strong',
              ),
              {
                id: 'live-light-toggle',
                type: 'button',
                props: {
                  label: 'Toggle light',
                  handler: 'lighting.toggle',
                  variant: 'primary',
                  disabled: !connected,
                  pending: pendingAction,
                },
              },
            ],
          },
          {
            id: 'live-climate',
            type: 'section',
            props: { heading: 'Climate', description: 'Synthetic zone gamma' },
            children: [
              text(
                'live-temperature',
                temperature === undefined ? 'Temperature unavailable' : `${temperature.toFixed(1)}°`,
                'default',
                'strong',
              ),
              text(
                'live-setpoint',
                setpoint === undefined ? 'No setpoint' : `Target ${setpoint.toFixed(1)}°`,
                'muted',
              ),
            ],
          },
          {
            id: 'live-entry',
            type: 'section',
            props: { heading: 'Entry', description: 'Synthetic barrier' },
            children: [
              {
                id: 'live-barrier-state',
                type: 'status',
                props: {
                  label: 'Barrier',
                  detail: barrier,
                  state: barrier === 'closed' ? 'accepted' : 'idle',
                },
              },
            ],
          },
          {
            id: 'live-energy',
            type: 'section',
            props: { heading: 'Energy', description: 'Grid import' },
            children: [
              text(
                'live-grid-power',
                gridPower === undefined ? 'Power unavailable' : `${Math.round(gridPower)} W`,
                'default',
                'strong',
              ),
            ],
          },
          {
            id: 'live-device',
            type: 'section',
            props: { heading: 'Contact sensor', description: 'Battery' },
            children: [
              {
                id: 'live-device-battery',
                type: 'progress',
                props: {
                  label: battery === undefined ? 'Battery unavailable' : `Battery · ${Math.round(battery)}%`,
                  value: battery === undefined ? 0 : Math.min(1, Math.max(0, battery / 100)),
                },
              },
            ],
          },
          {
            id: 'live-runtime',
            type: 'section',
            props: { heading: 'Coordinator', description: 'Bun runtime' },
            children: [
              {
                id: 'live-runtime-health',
                type: 'status',
                props: {
                  label: 'Health',
                  detail: coordinator,
                  state: coordinator === 'healthy' ? 'accepted' : 'idle',
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
