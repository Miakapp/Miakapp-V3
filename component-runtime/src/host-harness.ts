import { sha256Base64Url, verifyArtifactBytes } from './artifact';
import {
  BROKER_PROTOCOL,
  COMPONENT_ABI,
  ContractViolation,
  LIMITS,
  isCapabilityGranted,
  isPlainRecord,
  validateEnvelope,
  validateRequirements,
  validateResourceName,
  validateUiTree,
  type CapabilityRequirements,
  type Envelope,
  type UiNode,
} from './contract';

const BROKER_MESSAGE_KINDS = new Set([
  'runtime.bound',
  'runtime.worker_ready',
  'runtime.active',
  'runtime.pong',
  'runtime.error',
  'runtime.terminated',
  'ui.render',
  'event.subscribe',
  'event.unsubscribe',
  'event.publish',
  'call.start',
  'call.credit',
  'call.cancel',
  'log.write',
]);

const DEFAULT_GRANT: CapabilityRequirements = {
  state_read: ['global.*'],
  event_subscribe: ['alarm.changed'],
  event_publish: ['ui.preference.changed'],
  call: ['lighting.set'],
  presentation: ['media.front_door'],
};

interface MountOptions {
  grant?: CapabilityRequirements;
  initialState?: Record<string, unknown>;
  hashOverride?: string;
  tamperAfterHostVerification?: boolean;
  duplicateLoad?: boolean;
  staging?: boolean;
}

interface HarnessSnapshot {
  lifecycle: string;
  epoch: number;
  errors: Array<{ code: string; message: string }>;
  calls: unknown[];
  events: unknown[];
  logs: unknown[];
  renderRevision: number;
  hostTicks: number;
}

interface HarnessWindow extends Window {
  runtimeHarness?: RuntimeHarness;
  firebaseToken?: string;
}

function randomId(bytes = 24): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function brokerResourceName(value: unknown, label: string): string {
  try {
    return validateResourceName(value, label);
  } catch (error) {
    if (error instanceof ContractViolation) {
      throw new ContractViolation('bridge_protocol_violation', error.message);
    }
    throw error;
  }
}

function exactReady(value: unknown, nonce: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 3
    && keys[0] === 'nonce'
    && keys[1] === 'runtime'
    && keys[2] === 'type'
    && record.type === 'miakapp.runtime.ready'
    && record.runtime === '1'
    && record.nonce === nonce;
}

function renderNode(
  node: UiNode,
  renderRevision: number,
  interact: (nodeId: string, event: string, value?: unknown) => void,
): HTMLElement {
  let element: HTMLElement;
  const props = node.props;
  switch (node.type) {
    case 'screen': {
      element = document.createElement('main');
      const heading = document.createElement('h1');
      heading.textContent = props.title as string;
      element.append(heading);
      break;
    }
    case 'stack':
    case 'grid':
      element = document.createElement('div');
      element.dataset.layout = node.type;
      break;
    case 'section': {
      element = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = props.heading as string;
      element.append(heading);
      if (props.description) {
        const description = document.createElement('p');
        description.textContent = props.description as string;
        element.append(description);
      }
      break;
    }
    case 'text':
      element = document.createElement('p');
      element.textContent = props.text as string;
      break;
    case 'status': {
      element = document.createElement('div');
      element.setAttribute('role', 'status');
      element.dataset.state = props.state as string;
      element.textContent = `${props.label}${props.detail ? `: ${props.detail}` : ''}`;
      break;
    }
    case 'button': {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = props.label as string;
      button.disabled = Boolean(props.disabled || props.pending);
      button.addEventListener('click', () => interact(node.id, 'press'));
      element = button;
      break;
    }
    case 'toggle': {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = props.value as boolean;
      input.disabled = Boolean(props.disabled || props.pending);
      input.addEventListener('change', () => interact(node.id, 'change', input.checked));
      label.append(input, document.createTextNode(props.label as string));
      element = label;
      break;
    }
    case 'input': {
      const label = document.createElement('label');
      label.append(document.createTextNode(props.label as string));
      const input = document.createElement('input');
      input.type = props.input_type as string;
      input.value = props.value as string;
      input.maxLength = props.max_length as number;
      input.disabled = Boolean(props.disabled);
      input.addEventListener('input', () => interact(node.id, 'change', input.value));
      label.append(input);
      element = label;
      break;
    }
    case 'select': {
      const label = document.createElement('label');
      label.append(document.createTextNode(props.label as string));
      const select = document.createElement('select');
      for (const option of props.options as Array<{ value: string; label: string }>) {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        select.append(optionElement);
      }
      select.value = props.value as string;
      select.disabled = Boolean(props.disabled);
      select.addEventListener('change', () => interact(node.id, 'change', select.value));
      label.append(select);
      element = label;
      break;
    }
    case 'progress': {
      const label = document.createElement('label');
      label.append(document.createTextNode(props.label as string));
      const progress = document.createElement('progress');
      progress.max = 1;
      progress.value = props.value as number;
      label.append(progress);
      element = label;
      break;
    }
    case 'media': {
      element = document.createElement('button');
      element.textContent = props.label as string;
      element.dataset.mediaHandle = props.handle as string;
      break;
    }
    default:
      throw new ContractViolation('render_invalid', `Unsupported renderer node: ${node.type}`);
  }
  element.dataset.nodeId = node.id;
  element.dataset.renderRevision = String(renderRevision);
  for (const child of node.children ?? []) {
    element.append(renderNode(child, renderRevision, interact));
  }
  return element;
}

export class RuntimeHarness {
  readonly sandboxOrigin: string;
  readonly root: HTMLElement;
  private iframe: HTMLIFrameElement | undefined;
  private port: MessagePort | undefined;
  private instance = '';
  private epoch = 0;
  private outgoingSeq = 1;
  private expectedBrokerSeq = 1;
  private renderRevision = 0;
  private grant: CapabilityRequirements = DEFAULT_GRANT;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private pendingBrokerProbe: number | undefined;
  private nextBrokerProbe = 1;
  private missedBrokerHeartbeats = 0;
  private lifecycle = 'absent';
  private errors: Array<{ code: string; message: string }> = [];
  private calls: unknown[] = [];
  private events: unknown[] = [];
  private logs: unknown[] = [];
  private hostTicks = 0;

  constructor(sandboxOrigin: string, root: HTMLElement) {
    this.sandboxOrigin = sandboxOrigin;
    this.root = root;
    setInterval(() => { this.hostTicks += 1; }, 25);
  }

  private snapshot(): HarnessSnapshot {
    return {
      lifecycle: this.lifecycle,
      epoch: this.epoch,
      errors: structuredClone(this.errors),
      calls: structuredClone(this.calls),
      events: structuredClone(this.events),
      logs: structuredClone(this.logs),
      renderRevision: this.renderRevision,
      hostTicks: this.hostTicks,
    };
  }

  status(): HarnessSnapshot {
    return this.snapshot();
  }

  private send(kind: string, payload: unknown, transfer: Transferable[] = []): void {
    if (!this.port) throw new Error('Runtime port is not bound');
    const envelope: Envelope = {
      v: BROKER_PROTOCOL,
      instance: this.instance,
      epoch: this.epoch,
      seq: this.outgoingSeq,
      kind,
      payload,
    };
    this.outgoingSeq += 1;
    this.port.postMessage(envelope, transfer);
  }

  private interact(nodeId: string, event: string, value?: unknown): void {
    this.send('ui.interaction', {
      render_revision: this.renderRevision,
      node_id: nodeId,
      event,
      ...(value === undefined ? {} : { value }),
    });
  }

  private render(treeValue: unknown, revision: number): void {
    const mediaHandles = new Set(
      this.grant.presentation.filter((entry) => entry.startsWith('media.') && !entry.endsWith('.*')),
    );
    const tree = validateUiTree(treeValue, { mediaHandles });
    const fragment = document.createDocumentFragment();
    fragment.append(renderNode(tree, revision, (nodeId, event, value) => this.interact(nodeId, event, value)));
    this.root.replaceChildren(fragment);
    this.renderRevision = revision;
  }

  private handleBrokerMessage(event: MessageEvent): void {
    try {
      if (event.ports.length > 0) throw new ContractViolation('bridge_protocol_violation', 'broker transferred a port');
      const envelope = validateEnvelope(event.data, {
        instance: this.instance,
        epoch: this.epoch,
        expectedSeq: this.expectedBrokerSeq,
        allowedKinds: BROKER_MESSAGE_KINDS,
        allowBinary: true,
      });
      this.expectedBrokerSeq += 1;
      const payload = envelope.payload as Record<string, unknown>;
      switch (envelope.kind) {
        case 'runtime.bound':
          this.lifecycle = 'broker_starting';
          break;
        case 'runtime.worker_ready':
          this.lifecycle = 'staging';
          break;
        case 'ui.render': {
          const revision = payload.render_revision;
          if (!Number.isSafeInteger(revision) || (revision as number) !== this.renderRevision + 1) {
            throw new ContractViolation('render_invalid', 'host render revision is invalid');
          }
          this.render(payload.tree, revision as number);
          if (this.lifecycle === 'staging') this.send('runtime.activate', {});
          break;
        }
        case 'runtime.active':
          this.lifecycle = 'active';
          break;
        case 'runtime.pong': {
          if (!isPlainRecord(payload)
            || Object.keys(payload).length !== 1
            || !Number.isSafeInteger(payload.challenge)
            || payload.challenge !== this.pendingBrokerProbe) {
            throw new ContractViolation('bridge_protocol_violation', 'broker heartbeat acknowledgement is invalid');
          }
          this.pendingBrokerProbe = undefined;
          this.missedBrokerHeartbeats = 0;
          break;
        }
        case 'call.start': {
          const name = brokerResourceName(payload.name, 'call name');
          if (!isCapabilityGranted(this.grant.call, name)) {
            throw new ContractViolation('capability_denied', `Host denied call: ${name}`);
          }
          this.calls.push(payload);
          this.send('call.accepted', { operation_id: payload.operation_id });
          this.send('call.result', { operation_id: payload.operation_id, value: { ok: true } });
          break;
        }
        case 'event.publish': {
          const name = brokerResourceName(payload.name, 'event name');
          if (!isCapabilityGranted(this.grant.event_publish, name)) {
            throw new ContractViolation('capability_denied', `Host denied event: ${name}`);
          }
          this.events.push(payload);
          break;
        }
        case 'event.subscribe':
        case 'event.unsubscribe':
        case 'call.credit':
        case 'call.cancel':
          this.events.push({ kind: envelope.kind, ...payload });
          break;
        case 'log.write':
          this.logs.push(payload);
          break;
        case 'runtime.error':
          this.errors.push(payload as { code: string; message: string });
          this.lifecycle = 'failed';
          this.dispose();
          break;
        case 'runtime.terminated':
          if (this.lifecycle !== 'failed') this.lifecycle = 'terminated';
          this.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      this.errors.push({
        code: error instanceof ContractViolation ? error.code : 'bridge_protocol_violation',
        message: error instanceof Error ? error.message : 'Unknown host error',
      });
      this.lifecycle = 'failed';
      this.dispose();
    }
  }

  private async waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > timeoutMs) throw new Error(`Timed out in lifecycle ${this.lifecycle}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async mountSource(source: string, options: MountOptions = {}): Promise<HarnessSnapshot> {
    this.dispose();
    this.errors = [];
    this.calls = [];
    this.events = [];
    this.logs = [];
    this.renderRevision = 0;
    this.pendingBrokerProbe = undefined;
    this.nextBrokerProbe = 1;
    this.missedBrokerHeartbeats = 0;
    this.outgoingSeq = 1;
    this.expectedBrokerSeq = 1;
    this.epoch += 1;
    this.instance = randomId();
    this.grant = validateRequirements(options.grant ?? DEFAULT_GRANT);
    this.lifecycle = 'iframe_starting';
    const nonce = randomId();
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.tabIndex = -1;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'; bluetooth 'none'; clipboard-read 'none'; clipboard-write 'none'");
    iframe.src = `${this.sandboxOrigin}/sandbox.html#nonce=${nonce}`;
    this.iframe = iframe;

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Runtime ready timed out'));
      }, 5_000);
      const onMessage = (event: MessageEvent): void => {
        if (event.source !== iframe.contentWindow || !exactReady(event.data, nonce)) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        const channel = new MessageChannel();
        const boundPort = channel.port1;
        this.port = boundPort;
        boundPort.addEventListener('message', (message) => {
          if (this.port === boundPort) this.handleBrokerMessage(message);
        });
        boundPort.start();
        iframe.contentWindow!.postMessage({
          type: 'miakapp.runtime.bind',
          runtime: '1',
          nonce,
          instance: this.instance,
          epoch: this.epoch,
        }, '*', [channel.port2]);
        resolve();
      };
      window.addEventListener('message', onMessage);
    });
    document.body.append(iframe);
    await ready;
    await this.waitFor(() => this.lifecycle === 'broker_starting');

    const originalBytes = new TextEncoder().encode(source);
    const originalDigest = await sha256Base64Url(originalBytes);
    const pointer = {
      size: originalBytes.byteLength,
      sha256: options.hashOverride ?? originalDigest,
    };
    try {
      await verifyArtifactBytes(pointer, originalBytes);
    } catch (error) {
      this.errors.push({
        code: error instanceof ContractViolation ? error.code : 'artifact_hash_mismatch',
        message: error instanceof Error ? error.message : 'Artifact verification failed',
      });
      this.lifecycle = 'failed';
      this.dispose();
      return this.snapshot();
    }

    const transferBytes = originalBytes.slice();
    if (options.tamperAfterHostVerification && transferBytes.length > 0) {
      transferBytes[0] = transferBytes[0]! ^ 1;
    }
    const loadPayload = (artifact: ArrayBuffer) => ({
      release: {
        home_id: 'home-test',
        generation: this.epoch,
        release: `test-${this.epoch}`,
        abi: COMPONENT_ABI,
        sha256: pointer.sha256,
        size: pointer.size,
      },
      grant: this.grant,
      initial_state: options.initialState ?? { 'global.temperature': 21.5 },
      state_revision: 1,
      staging: options.staging ?? true,
      locale: 'en',
      theme: 'light',
      artifact,
    });
    this.send('runtime.load', loadPayload(transferBytes.buffer), [transferBytes.buffer]);
    if (options.duplicateLoad) {
      const duplicateBytes = originalBytes.slice();
      this.send('runtime.load', loadPayload(duplicateBytes.buffer), [duplicateBytes.buffer]);
    }

    this.heartbeat = setInterval(() => {
      if (this.port && (this.lifecycle === 'staging' || this.lifecycle === 'active')) {
        if (this.pendingBrokerProbe !== undefined) {
          this.missedBrokerHeartbeats += 1;
          if (this.missedBrokerHeartbeats >= LIMITS.missedHeartbeats) {
            this.errors.push({
              code: 'runtime_unresponsive',
              message: 'runtime broker missed heartbeat acknowledgements',
            });
            this.lifecycle = 'failed';
            this.dispose();
          }
          return;
        }
        this.pendingBrokerProbe = this.nextBrokerProbe;
        this.nextBrokerProbe += 1;
        this.send('runtime.ping', { challenge: this.pendingBrokerProbe });
      }
    }, LIMITS.heartbeatMs);
    await this.waitFor(() => ['active', 'failed', 'terminated'].includes(this.lifecycle), 7_000);
    return this.snapshot();
  }

  async waitForLifecycle(lifecycle: string, timeoutMs = 5_000): Promise<HarnessSnapshot> {
    await this.waitFor(() => this.lifecycle === lifecycle, timeoutMs);
    return this.snapshot();
  }

  suspend(): HarnessSnapshot {
    if (this.lifecycle !== 'active') throw new Error('Runtime is not active');
    this.lifecycle = 'suspended';
    this.send('lifecycle.suspend', {});
    return this.snapshot();
  }

  resume(): HarnessSnapshot {
    if (this.lifecycle !== 'suspended') throw new Error('Runtime is not suspended');
    this.send('lifecycle.resume', {});
    this.lifecycle = 'active';
    return this.snapshot();
  }

  sendStatePatch(payload: unknown): void {
    this.send('state.patch', payload);
  }

  dispose(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.pendingBrokerProbe = undefined;
    this.missedBrokerHeartbeats = 0;
    if (this.port) {
      try {
        this.send('runtime.dispose', {});
      } catch {
        // The channel may already be closed by a hostile runtime.
      }
      this.port.close();
    }
    this.port = undefined;
    this.iframe?.remove();
    this.iframe = undefined;
    this.root.replaceChildren();
    if (!['failed', 'terminated', 'absent'].includes(this.lifecycle)) this.lifecycle = 'terminated';
  }
}

export function installHostHarness(): RuntimeHarness {
  const root = document.querySelector<HTMLElement>('#generated');
  if (!root) throw new Error('Missing #generated root');
  const sandboxOrigin = document.documentElement.dataset.sandboxOrigin;
  if (!sandboxOrigin) throw new Error('Missing sandbox origin');
  const harness = new RuntimeHarness(sandboxOrigin, root);
  const harnessWindow = window as HarnessWindow;
  harnessWindow.firebaseToken = 'firebase-secret-must-not-cross';
  localStorage.setItem('firebase-token', 'firebase-secret-must-not-cross');
  harnessWindow.runtimeHarness = harness;
  return harness;
}

if (typeof window !== 'undefined') installHostHarness();
