import type { UiNode } from '../../component-runtime/src/contract';
import type { BrowserClient } from './miakapi-browser';

type LiveState = NonNullable<ReturnType<BrowserClient['state']['snapshot']>>['values'];

export interface RealHomeTreeOptions {
  readonly connected: boolean;
  readonly stateStale: boolean;
  readonly state: LiveState;
}

function temperature(state: LiveState, path: string): string {
  const value = state[path];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -30 || value > 60) {
    return 'Indisponible';
  }
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} °C`;
}

export function createRealHomeTree({ connected, stateStale, state }: RealHomeTreeOptions): UiNode {
  const current = connected && !stateStale;
  return {
    id: 'mathieu-home',
    type: 'screen',
    props: { title: 'Ma maison' },
    children: [
      {
        id: 'read-only-state',
        type: 'status',
        props: {
          label: 'États réels · lecture seule',
          detail: !connected ? 'Connexion à la maison en attente' : stateStale
            ? 'Données à actualiser' : 'Données reçues de la maison',
          state: !connected ? 'idle' : stateStale ? 'stale' : 'accepted',
        },
      },
      {
        id: 'temperature-grid',
        type: 'grid',
        props: { columns: 2, gap: 'medium' },
        children: [
          {
            id: 'salon', type: 'section', props: { heading: 'Salon' },
            children: [{
              id: 'salon-temperature', type: 'text',
              props: { text: current ? temperature(state, 'room.salon.temperature') : 'Indisponible', emphasis: 'strong' },
            }],
          },
          {
            id: 'mezzanine', type: 'section', props: { heading: 'Mezzanine' },
            children: [{
              id: 'mezzanine-temperature', type: 'text',
              props: { text: current ? temperature(state, 'room.mezzanine.temperature') : 'Indisponible', emphasis: 'strong' },
            }],
          },
        ],
      },
      {
        id: 'commands-note', type: 'text',
        props: { text: 'Les commandes des équipements seront ajoutées après vérification.', tone: 'muted' },
      },
    ],
  };
}
