// Trusted host page for the house-app browser corpus. It plays the Miakapp
// shell: a menu it owns outside the frame, a stage the frame fills, and a call
// function standing in for the coordinator.

import { mountHouseApp, type HouseAppSession } from '../src/app-host';
import { sha256Base64Url } from '../src/artifact';
import { APP_ABI, POINTER_SCHEMA, type CapabilityRequirements } from '../src/contract';

interface MountRequest {
  readonly requires?: Partial<CapabilityRequirements>;
  readonly heartbeatMs?: number;
}

const events: string[] = [];
const calls: Array<{ name: string; args: unknown }> = [];
let session: HouseAppSession | undefined;
let menuPresses = 0;
let revision = 1;

const menu = document.getElementById('shell-menu') as HTMLButtonElement;
menu.addEventListener('click', () => {
  menuPresses += 1;
  menu.dataset.presses = String(menuPresses);
});

const house = {
  events,
  calls,
  menuPresses: () => menuPresses,
  async mount(source: string, request: MountRequest = {}): Promise<void> {
    const bytes = new TextEncoder().encode(source);
    const requires: CapabilityRequirements = {
      state_read: ['zone.living.*', 'climate.living.temperature'],
      event_subscribe: [],
      event_publish: [],
      call: ['lighting.set'],
      presentation: [],
      ...request.requires,
    };
    session = await mountHouseApp({
      pointer: {
        schema: POINTER_SCHEMA,
        home_id: 'test-home',
        generation: 1,
        release: 'test-1',
        abi: APP_ABI,
        url: 'https://artifacts.invalid/test.js',
        sha256: await sha256Base64Url(bytes),
        size: bytes.byteLength,
        requires,
      },
      artifact: { bytes },
    }, {
      sandboxOrigin: 'http://localhost:4173',
      container: document.getElementById('stage')!,
      home: { id: 'test-home', name: 'Maison test' },
      title: 'Interface de Maison test',
      locale: 'fr',
      initialState: {
        values: {
          'zone.living.light.on': false,
          'climate.living.temperature': 21.5,
          'security.alarm.code': '1234',
        },
        revision,
        stale: false,
      },
      heartbeatMs: request.heartbeatMs ?? 400,
      call: async (name, args) => {
        calls.push({ name, args });
        const on = (args as { on?: unknown } | null)?.on === true;
        revision += 1;
        setTimeout(() => session?.publishState({
          values: { 'zone.living.light.on': on, 'security.alarm.code': '1234' },
          revision,
          stale: false,
        }), 10);
        return { applied: true };
      },
      onLifecycle: (lifecycle, failure) => {
        events.push(failure === undefined ? lifecycle : `${lifecycle}:${failure}`);
      },
      onFocusShell: () => menu.focus(),
    });
  },
  markStale(): void {
    revision += 1;
    session?.publishState({ values: {}, revision, stale: true });
  },
  dispose(): void {
    session?.dispose();
  },
};

(window as typeof window & { house: typeof house }).house = house;
document.body.dataset.ready = 'true';
