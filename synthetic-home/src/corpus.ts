import { readFile } from 'node:fs/promises';
import {
  FixtureViolation,
  type FixtureContext,
  type JsonValue,
  type SyntheticHome,
  type SyntheticHomeManifest,
  type SyntheticScenario,
  type SyntheticScenarioCorpus,
  validateHome,
  validateManifest,
  validateScenarioCorpus,
  valueMatchesType,
} from './contract.js';

export interface SyntheticHomeCorpus {
  manifest: SyntheticHomeManifest;
  home: SyntheticHome;
  scenarios: SyntheticScenarioCorpus;
}

const BUILT_IN_FIXTURE_ROOT = new URL('../fixtures/v1/', import.meta.url);

function invalidReference(message: string): never {
  throw new FixtureViolation('invalid_reference', message);
}

function requireReference(condition: boolean, message: string): asserts condition {
  if (!condition) invalidReference(message);
}

function assertTypedState(
  values: Record<string, JsonValue>,
  declarations: ReadonlyMap<string, SyntheticHome['state_paths'][number]>,
  label: string,
): void {
  for (const [path, value] of Object.entries(values)) {
    const declaration = declarations.get(path);
    requireReference(declaration !== undefined, `${label}.${path} is not declared`);
    requireReference(
      valueMatchesType(value, declaration.value_type),
      `${label}.${path} does not match ${declaration.value_type}`,
    );
  }
}

interface ScenarioIndexes {
  actors: ReadonlyMap<string, SyntheticHome['actors'][number]>;
  groups: ReadonlySet<string>;
  devices: ReadonlyMap<string, SyntheticHome['devices'][number]>;
  state: ReadonlyMap<string, SyntheticHome['state_paths'][number]>;
  actions: ReadonlyMap<string, SyntheticHome['actions'][number]>;
  events: ReadonlyMap<string, SyntheticHome['events'][number]>;
}

function contextHasEntries(context: FixtureContext): boolean {
  return Object.keys(context.global).length > 0
    || Object.values(context.flows).some((flow) => Object.keys(flow).length > 0);
}

function assertContextReferences(
  context: FixtureContext,
  declarations: FixtureContext,
  label: string,
): void {
  for (const key of Object.keys(context.global)) {
    requireReference(
      Object.hasOwn(declarations.global, key),
      `${label}.global.${key} is not declared`,
    );
  }
  for (const [flowId, values] of Object.entries(context.flows)) {
    const declaredFlow = declarations.flows[flowId];
    requireReference(declaredFlow !== undefined, `${label}.flows.${flowId} is not declared`);
    for (const key of Object.keys(values)) {
      requireReference(
        Object.hasOwn(declaredFlow, key),
        `${label}.flows.${flowId}.${key} is not declared`,
      );
    }
  }
}

function validateStimuli(
  scenario: SyntheticScenario,
  home: SyntheticHome,
  indexes: ScenarioIndexes,
  label: string,
): Set<string> {
  const operationIds = new Set<string>();
  for (const stimulus of scenario.stimuli) {
    if (stimulus.kind === 'event') {
      const event = indexes.events.get(stimulus.name);
      requireReference(event !== undefined, `${label} uses undeclared event ${stimulus.name}`);
      requireReference(
        valueMatchesType(stimulus.value, event.value_type),
        `${label} event ${stimulus.name} has the wrong value type`,
      );
    } else if (stimulus.kind === 'action') {
      const actor = indexes.actors.get(stimulus.actor_id);
      const action = indexes.actions.get(stimulus.action_id);
      requireReference(actor !== undefined, `${label} uses unknown actor ${stimulus.actor_id}`);
      requireReference(action !== undefined, `${label} uses unknown action ${stimulus.action_id}`);
      requireReference(
        action.type === stimulus.type
          && action.element_id === stimulus.element_id
          && action.name === stimulus.name,
        `${label} action ${stimulus.action_id} does not match its declaration`,
      );
      requireReference(
        !operationIds.has(stimulus.operation_id),
        `${label} repeats operation ${stimulus.operation_id}`,
      );
      operationIds.add(stimulus.operation_id);
      if (action.type === 'input') {
        requireReference(
          stimulus.value !== undefined
            && action.value_type !== undefined
            && valueMatchesType(stimulus.value, action.value_type),
          `${label} action ${stimulus.action_id} has the wrong value type`,
        );
      }
    } else if (stimulus.kind === 'lifecycle') {
      requireReference(
        home.lifecycle_signals.includes(stimulus.signal),
        `${label} uses undeclared lifecycle signal ${stimulus.signal}`,
      );
    }
  }
  return operationIds;
}

function validateProtectedState(
  scenario: SyntheticScenario,
  indexes: ScenarioIndexes,
  label: string,
): void {
  const patched = new Set(Object.keys(scenario.expected.state_patch));
  for (const path of scenario.expected.unchanged_paths) {
    requireReference(indexes.state.has(path), `${label} protects undeclared state path ${path}`);
    requireReference(!patched.has(path), `${label} both changes and protects ${path}`);
  }
}

function validateCommands(
  scenario: SyntheticScenario,
  operationIds: ReadonlySet<string>,
  indexes: ScenarioIndexes,
  label: string,
): void {
  for (const command of scenario.expected.recorded_commands) {
    const device = indexes.devices.get(command.target_id);
    requireReference(
      device !== undefined,
      `${label} records a command for unknown device ${command.target_id}`,
    );
    requireReference(
      device.capabilities.includes(command.name),
      `${label} command ${command.name} is not a capability of ${command.target_id}`,
    );
    if (command.cause.kind === 'operation') {
      requireReference(
        operationIds.has(command.cause.operation_id),
        `${label} command refers to unknown operation ${command.cause.operation_id}`,
      );
    } else {
      const stimulus = scenario.stimuli[command.cause.stimulus_index];
      requireReference(
        stimulus !== undefined,
        `${label} command refers to unknown stimulus ${command.cause.stimulus_index}`,
      );
      requireReference(
        stimulus.kind !== 'action',
        `${label} action commands must use operation provenance`,
      );
    }
  }
}

function validateNotifications(
  scenario: SyntheticScenario,
  indexes: ScenarioIndexes,
  label: string,
): void {
  for (const notification of scenario.expected.notification_intents) {
    requireReference(
      notification.audience.groups.length + notification.audience.actors.length > 0,
      `${label} notification has an empty audience`,
    );
    for (const group of notification.audience.groups) {
      requireReference(indexes.groups.has(group), `${label} notification uses unknown group ${group}`);
    }
    for (const actorId of notification.audience.actors) {
      const actor = indexes.actors.get(actorId);
      requireReference(actor !== undefined, `${label} notification uses unknown actor ${actorId}`);
      requireReference(
        actor.notifications_enabled,
        `${label} explicitly targets actor ${actorId} with notifications disabled`,
      );
    }
  }
}

function operationSequence(scenario: SyntheticScenario, operationId: string): string {
  return scenario.expected.operations
    .filter(({ operation_id: candidate }) => candidate === operationId)
    .map(({ status }) => status)
    .join(',');
}

function operationCommands(scenario: SyntheticScenario, operationId: string) {
  return scenario.expected.recorded_commands.filter(({ cause }) => (
    cause.kind === 'operation' && cause.operation_id === operationId
  ));
}

function validateOperations(
  scenario: SyntheticScenario,
  operationIds: ReadonlySet<string>,
  indexes: ScenarioIndexes,
  label: string,
): void {
  for (const operation of scenario.expected.operations) {
    requireReference(
      operationIds.has(operation.operation_id),
      `${label} observes unknown operation ${operation.operation_id}`,
    );
  }

  const onlyActionStimuli = scenario.stimuli.every(({ kind }) => kind === 'action');
  for (const stimulus of scenario.stimuli) {
    if (stimulus.kind !== 'action') continue;
    const actor = indexes.actors.get(stimulus.actor_id)!;
    const action = indexes.actions.get(stimulus.action_id)!;
    const observations = scenario.expected.operations.filter(({ operation_id: operationId }) => (
      operationId === stimulus.operation_id
    ));
    const sequence = operationSequence(scenario, stimulus.operation_id);
    requireReference(
      sequence === 'denied'
        || sequence === 'accepted,applied'
        || sequence === 'accepted,outcome_unknown',
      `${label} operation ${stimulus.operation_id} has no valid terminal sequence`,
    );

    const authorized = action.allowed_groups.some((group) => actor.groups.includes(group));
    if (!authorized) {
      requireReference(
        sequence === 'denied' && observations[0]!.reason === 'group_not_allowed',
        `${label} operation ${stimulus.operation_id} does not preserve group authorization`,
      );
    }
    if (sequence === 'denied') {
      requireReference(
        operationCommands(scenario, stimulus.operation_id).length === 0,
        `${label} denied operation ${stimulus.operation_id} records a device command`,
      );
      if (onlyActionStimuli) {
        requireReference(
          Object.keys(scenario.expected.state_patch).length === 0
            && !contextHasEntries(scenario.expected.context_patch)
            && scenario.expected.recorded_commands.length === 0
            && scenario.expected.notification_intents.length === 0
            && scenario.expected.lifecycle.length === 0,
          `${label} denied-only actions must not produce side effects`,
        );
      }
    }
    if (sequence === 'accepted,outcome_unknown' && action.idempotency === 'non_idempotent') {
      const causalCommands = operationCommands(scenario, stimulus.operation_id);
      const primaryCommand = causalCommands[0];
      const matchingCommands = primaryCommand === undefined
        ? []
        : scenario.expected.recorded_commands.filter((command) => (
          command.target_id === primaryCommand.target_id && command.name === primaryCommand.name
        ));
      requireReference(
        causalCommands.length === 1 && matchingCommands.length === 1,
        `${label} non-idempotent unknown operation ${stimulus.operation_id} must not be retried`,
      );
    }
  }
}

function validatesCoverageClaim(
  scenario: SyntheticScenario,
  coverage: SyntheticScenario['coverage'][number],
  indexes: ScenarioIndexes,
): boolean {
  const actionStimuli = scenario.stimuli.filter((stimulus) => stimulus.kind === 'action');
  const lifecycleStimuli = scenario.stimuli.filter((stimulus) => stimulus.kind === 'lifecycle');
  if (coverage === 'bootstrap') {
    return lifecycleStimuli.some(({ signal }) => signal === 'ready')
      && scenario.expected.lifecycle.some(({ signal }) => signal === 'ready');
  }
  if (coverage === 'persisted_context') {
    return contextHasEntries(scenario.setup.context)
      || contextHasEntries(scenario.expected.context_patch);
  }
  if (coverage === 'sensor_automation') {
    return scenario.stimuli.some(({ kind }) => kind === 'event')
      && scenario.expected.recorded_commands.some(({ cause }) => cause.kind === 'stimulus')
      && Object.keys(scenario.expected.state_patch).length > 0;
  }
  if (coverage === 'authorization') {
    return actionStimuli.length > 0 && scenario.expected.operations.length > 0;
  }
  if (coverage === 'concurrent_action') {
    const busy = Object.values(scenario.setup.context.flows).some((flow) => (
      Object.entries(flow).some(([key, value]) => key.endsWith('.busy') && value === true)
    ));
    return busy
      && actionStimuli.length > 0
      && scenario.expected.operations.some(({ status, reason }) => (
        status === 'denied' && reason === 'device_busy'
      ))
      && scenario.expected.recorded_commands.length === 0;
  }
  if (coverage === 'climate_control') {
    return scenario.stimuli.some((stimulus) => (
      (stimulus.kind === 'action' || stimulus.kind === 'event')
        && stimulus.name.startsWith('climate.')
    )) && Object.keys(scenario.expected.state_patch).some((path) => path.startsWith('climate.'));
  }
  if (coverage === 'energy_schedule') {
    return scenario.stimuli.some(({ kind }) => kind === 'timer')
      && Object.keys(scenario.expected.state_patch).some((path) => (
        path.startsWith('energy.') || path.startsWith('system.clock.')
      ));
  }
  if (coverage === 'notification') {
    return scenario.expected.notification_intents.length > 0;
  }
  if (coverage === 'reconnect') {
    return lifecycleStimuli.some(({ signal }) => signal === 'reconnect' || signal === 'disconnect')
      && scenario.expected.lifecycle.some(({ signal }) => (
        signal === 'reconnect' || signal === 'disconnect'
      ));
  }
  const unknown = scenario.expected.operations.find(({ status }) => status === 'outcome_unknown');
  if (unknown === undefined) return false;
  const actionStimulus = actionStimuli.find(({ operation_id: operationId }) => (
    operationId === unknown.operation_id
  ));
  return actionStimulus !== undefined
    && indexes.actions.get(actionStimulus.action_id)?.idempotency === 'non_idempotent'
    && operationCommands(scenario, unknown.operation_id).length === 1
    && scenario.expected.recorded_commands.length === 1;
}

function validateScenarioReferences(
  scenario: SyntheticScenario,
  home: SyntheticHome,
  indexes: ScenarioIndexes,
): void {
  const label = `scenario ${scenario.id}`;
  assertTypedState(scenario.setup.state, indexes.state, `${label}.setup.state`);
  assertTypedState(scenario.expected.state_patch, indexes.state, `${label}.expected.state_patch`);
  assertContextReferences(scenario.setup.context, home.initial_context, `${label}.setup.context`);
  assertContextReferences(
    scenario.expected.context_patch,
    home.initial_context,
    `${label}.expected.context_patch`,
  );

  const operationIds = validateStimuli(scenario, home, indexes, label);
  validateProtectedState(scenario, indexes, label);
  validateCommands(scenario, operationIds, indexes, label);
  validateNotifications(scenario, indexes, label);

  for (const lifecycle of scenario.expected.lifecycle) {
    requireReference(
      home.lifecycle_signals.includes(lifecycle.signal),
      `${label} emits undeclared lifecycle signal ${lifecycle.signal}`,
    );
  }
  validateOperations(scenario, operationIds, indexes, label);
  for (const coverage of scenario.coverage) {
    requireReference(
      validatesCoverageClaim(scenario, coverage, indexes),
      `${label} does not demonstrate declared coverage ${coverage}`,
    );
  }
}

export function validateCorpusDocuments(
  manifestValue: unknown,
  homeValue: unknown,
  scenariosValue: unknown,
): SyntheticHomeCorpus {
  const manifest = validateManifest(manifestValue);
  const home = validateHome(homeValue);
  const scenarios = validateScenarioCorpus(scenariosValue);
  requireReference(home.home_id === scenarios.home_id, 'home and scenario corpus IDs differ');

  const groups = new Set(home.groups.map(({ id }) => id));
  const zones = new Set(home.zones.map(({ id }) => id));
  const actors = new Map(home.actors.map((actor) => [actor.id, actor]));
  const devices = new Map(home.devices.map((device) => [device.id, device]));
  const state = new Map(home.state_paths.map((declaration) => [declaration.path, declaration]));
  const actions = new Map(home.actions.map((action) => [action.id, action]));
  const events = new Map(home.events.map((event) => [event.name, event]));

  for (const actor of home.actors) {
    for (const group of actor.groups) {
      requireReference(groups.has(group), `actor ${actor.id} uses unknown group ${group}`);
    }
  }
  for (const device of home.devices) {
    requireReference(zones.has(device.zone_id), `device ${device.id} uses unknown zone ${device.zone_id}`);
  }
  for (const action of home.actions) {
    for (const group of action.allowed_groups) {
      requireReference(groups.has(group), `action ${action.id} uses unknown group ${group}`);
    }
    if (action.name.endsWith('.toggle')) {
      requireReference(
        action.idempotency === 'non_idempotent',
        `toggle action ${action.id} must be non-idempotent`,
      );
    }
  }

  const initialPaths = Object.keys(home.initial_state);
  requireReference(
    initialPaths.length === state.size,
    'home.initial_state must contain every declared state path exactly once',
  );
  assertTypedState(home.initial_state, state, 'home.initial_state');

  const covered = new Set<string>();
  const indexes = { actors, groups, devices, state, actions, events };
  for (const scenario of scenarios.scenarios) {
    scenario.coverage.forEach((coverage) => covered.add(coverage));
    validateScenarioReferences(scenario, home, indexes);
  }
  for (const coverage of manifest.required_coverage) {
    requireReference(covered.has(coverage), `required coverage ${coverage} has no scenario`);
  }
  if (manifest.required_coverage.includes('authorization')) {
    requireReference(
      scenarios.scenarios.some((scenario) => (
        scenario.coverage.includes('authorization')
          && scenario.expected.operations.some(({ status, reason }) => (
            status === 'denied' && reason === 'group_not_allowed'
          ))
      )),
      'authorization coverage must include a group-denied action',
    );
  }

  return { manifest, home, scenarios };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, 'utf8')) as unknown;
}

export async function loadSyntheticHomeCorpus(
  fixtureRoot: URL = BUILT_IN_FIXTURE_ROOT,
): Promise<SyntheticHomeCorpus> {
  const manifestValue = await readJson(new URL('manifest.json', fixtureRoot));
  const manifest = validateManifest(manifestValue);
  const [homeValue, scenariosValue] = await Promise.all([
    readJson(new URL(manifest.files.home, fixtureRoot)),
    readJson(new URL(manifest.files.scenarios, fixtureRoot)),
  ]);
  return deepFreeze(validateCorpusDocuments(manifest, homeValue, scenariosValue));
}
