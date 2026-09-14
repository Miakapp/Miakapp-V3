/**
 * Boots a real Node-RED runtime with the real published MiakAPI v3 node and
 * deploys a flow through the same code path the editor's Deploy button uses.
 *
 * What is real here, and what is not:
 *   real — Node-RED 5.0.7, its flow loader, its persistence, its message
 *          router, and `node-red-contrib-miakapi@3.0.31` exactly as published;
 *   not real — the `miakapi` cloud SDK, replaced at the `require` boundary by
 *          the recorder in `sdk-recorder.mjs`.
 *
 * That single substitution is the whole point of the adapter. The v3 node
 * connects to the coordinator during node instantiation, so any harness that
 * left the SDK in place would reach a production service from CI. Swapping the
 * SDK instead of editing the node keeps the node's own logic under test.
 *
 * One house per process. `miakapi.js` keeps `HOME` and its event handlers in
 * module scope, so a second deploy in the same process accumulates handlers
 * from the first. Tests get isolation from `node --test`, which runs each test
 * file in its own process.
 */

import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';

import { createSdkRecorder } from './sdk-recorder.mjs';

const require = createRequire(import.meta.url);

/** The node package under characterization, pinned by the lockfile. */
export const NODE_PACKAGE = 'node-red-contrib-miakapi';

/**
 * Node-RED encrypts `flows_cred.json` with this key. It is a test constant on
 * purpose: the point of the harness is to show which fields land in the
 * encrypted credentials file and which land in plain `flows.json`.
 */
const CREDENTIAL_SECRET = 'node-red-adapter-harness-key';

let started = false;

/**
 * @param {object} options
 * @param {unknown[]|null} [options.flows]  Flow definitions to deploy. Pass `null`
 *   to start from whatever the environment already has on disk, which is what a
 *   restore has to do: nobody redeploys the house after pulling a backup back.
 * @param {object[]} [options.users]     Users the recorded SDK should report.
 * @param {string} [options.userDir]     Start in this environment instead of a
 *   fresh temporary one. Used by the restore rehearsal to boot a restored copy.
 * @param {boolean} [options.keepUserDir] Leave the environment on disk at stop().
 * @param {boolean} [options.requireNodes] Throw when the runtime never
 *   instantiates the deployed nodes. Set `false` to inspect a runtime that
 *   started without them, which is what a broken restore produces: Node-RED
 *   resolves `start()`, logs a warning, and waits for the missing types.
 */
export async function startHouse({
  flows = null,
  users = [],
  userDir: existingUserDir = null,
  keepUserDir = false,
  requireNodes = true,
} = {}) {
  if (flows === null && existingUserDir === null) {
    throw new Error('startHouse() needs either flows to deploy or an existing userDir to start from');
  }

  if (started) {
    throw new Error(
      'startHouse() was already called in this process. The v3 node keeps HOME and its '
        + 'handlers in module scope, so a second house would inherit the first one\'s '
        + 'handlers. Use one test file per scenario.',
    );
  }
  started = true;

  const { factory, recorder, emit } = createSdkRecorder({ users });

  // Substitute the SDK before Node-RED loads any node file. `miakapi.js` does
  // `require('miakapi')` at module load, so the interception has to be in
  // place first; it is removed again on stop().
  const originalLoad = Module._load;
  Module._load = function interceptMiakapi(request, ...rest) {
    if (request === 'miakapi') return factory;
    return originalLoad.call(this, request, ...rest);
  };

  const userDir = existingUserDir ?? (await mkdtemp(path.join(tmpdir(), 'node-red-adapter-')));

  // Deploying means we are building an environment, so the node package gets
  // installed. Starting from disk means we are running an environment somebody
  // else produced, so whatever is in `node_modules` is what the house gets —
  // installing here would quietly repair the very gap a restore might have.
  if (flows !== null) {
    await mkdir(path.join(userDir, 'node_modules'), { recursive: true });

    // Node-RED discovers node packages by scanning userDir/node_modules. Linking
    // the installed package keeps the bytes identical to what npm resolved.
    const installedPackage = path.dirname(require.resolve(`${NODE_PACKAGE}/package.json`));
    await symlink(installedPackage, path.join(userDir, 'node_modules', NODE_PACKAGE), 'dir');
  }

  const RED = require('node-red');
  const server = createServer();

  RED.init(server, {
    userDir,
    flowFile: 'flows.json',
    credentialSecret: CREDENTIAL_SECRET,
    // No HTTP surface at all: flows are deployed through the runtime API that
    // backs the admin endpoints, so nothing needs to listen.
    httpAdminRoot: false,
    httpNodeRoot: false,
    disableEditor: true,
    autoInstallModules: false,
    externalModules: { autoInstall: false, palette: { allowInstall: false } },
    logging: { console: { level: 'off', metrics: false, audit: false } },
    functionGlobalContext: {},
  });

  await RED.start();

  /** Every message any node sent, in order, as the router saw it. */
  const sent = [];
  RED.hooks.add('onSend', (sendEvents) => {
    sendEvents.forEach((event) => {
      sent.push({
        sourceId: event.source?.id,
        sourceType: event.source?.node?.type,
        msg: event.msg,
      });
    });
    return sendEvents;
  });

  if (flows !== null) {
    // The same call the admin API makes for a full deploy from the editor.
    await RED.runtime.flows.setFlows({
      user: null,
      flows: { flows },
      deploymentType: 'full',
    });
  }

  // `setFlows` resolves once the configuration is persisted, which is before
  // the runtime has instantiated a single node.
  //
  // Listening for `flows:started` is not enough either: `RED.start()` already
  // starts an empty flow set, and that event can land after `RED.start()`
  // resolves, so a one-shot listener registered around the deploy can be
  // satisfied by the empty start and return a runtime with no nodes in it.
  // Waiting until the nodes exist is the condition the tests actually need.
  //
  // Starting from disk waits on the same condition, against the flows the
  // runtime loaded rather than the ones we handed it.
  const expectedFlows = flows ?? (await readPersistedFlows(userDir));
  let missingNodeIds = [];
  try {
    await waitForNodes(RED, expectedFlows);
  } catch (error) {
    if (requireNodes) throw error;
    missingNodeIds = error.missingNodeIds ?? [];
  }

  const readPersisted = async (file) => {
    try {
      return JSON.parse(await readFile(path.join(userDir, file), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };

  return {
    userDir,
    recorder,
    emit,
    sent,

    /** Deliver a message to a node with an input, as an upstream node would. */
    receive(nodeId, msg = {}) {
      const node = RED.nodes.getNode(nodeId);
      if (!node) throw new Error(`no deployed node with id ${nodeId}`);
      node.receive(msg);
    },

    /** What the runtime itself wrote to disk, not what we authored. */
    persistedFlows: () => readPersisted('flows.json'),
    persistedCredentials: () => readPersisted('flows_cred.json'),

    /**
     * Deployed nodes the runtime never instantiated. Empty on a healthy boot.
     * Only populated when `requireNodes: false`.
     */
    missingNodeIds,

    /**
     * Flow node types the runtime has no registration for.
     *
     * This is the runtime's own view of a failed palette load: it starts, holds
     * the flows, and waits for these types to appear. Nothing throws.
     */
    missingTypes() {
      return [
        ...new Set(
          expectedFlows
            .filter((node) => node.type !== 'tab' && !RED.nodes.getType(node.type))
            .map((node) => node.type),
        ),
      ].sort();
    },

    /** Node types the runtime actually registered from the package. */
    registeredTypes() {
      return RED.nodes
        .getNodeList()
        .filter((entry) => entry.module === NODE_PACKAGE)
        .flatMap((entry) => entry.types);
    },

    async stop() {
      await RED.stop();
      Module._load = originalLoad;
      if (!keepUserDir) await rm(userDir, { recursive: true, force: true });
    },
  };
}

/**
 * Waits until every flow node in `flows` has been instantiated by the runtime.
 *
 * Config nodes (no `z`) and tabs are excluded: the runtime only registers them
 * when a flow node references them.
 */
async function waitForNodes(RED, flows, timeoutMs = Number(process.env.NODE_RED_ADAPTER_NODE_TIMEOUT_MS ?? 20000)) {
  const expected = flows
    .filter((node) => node.type !== 'tab' && typeof node.z === 'string' && node.z.length > 0)
    .map((node) => node.id);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const missing = expected.filter((id) => !RED.nodes.getNode(id));
    if (missing.length === 0) return;

    if (Date.now() > deadline) {
      const error = new Error(
        `the runtime did not instantiate these nodes within ${timeoutMs}ms: ${missing.join(', ')}`,
      );
      error.missingNodeIds = missing;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The flow set the runtime found on disk, which is what a restored house runs. */
async function readPersistedFlows(userDir) {
  try {
    return JSON.parse(await readFile(path.join(userDir, 'flows.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Node-RED routes messages asynchronously; give the event loop a few turns. */
export function settle(turns = 12) {
  return new Promise((resolve) => {
    let remaining = turns;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else setImmediate(tick);
    };
    setImmediate(tick);
  });
}
