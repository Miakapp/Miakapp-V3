/**
 * A recording stand-in for the `miakapi` v3 SDK.
 *
 * `node-red-contrib-miakapi@3.0.31` opens a live connection to the MiakAPI
 * coordinator the moment an `initMiakapi` node is instantiated:
 *
 *     HOME = Miakapi(config.home, config.coordID, config.coordSecret);
 *
 * A test harness must never reach that service, so this module reproduces the
 * exact surface the published node touches and records every call instead of
 * performing it. The node's own code is left untouched: the substitution
 * happens at the `require('miakapi')` boundary (see `harness.mjs`).
 *
 * The surface below is not a guess. It is the complete set of SDK members
 * referenced by `miakapi.js` at version 3.0.31:
 *   Miakapi(home, coordID, coordSecret)
 *   HOME.onReady / onUpdate / onUserLogin / onUserAction
 *   HOME.variables (assignment) and HOME.commit()
 *   HOME.users, each with displayName, groups, isAdmin, notifications, sendPush
 *   HOME.reconnect()
 *
 * Anything the node calls outside that set throws, so a future version of the
 * node that depends on more of the SDK fails loudly here rather than silently
 * exercising a stub that no longer resembles the real client.
 */

/**
 * @typedef {object} RecordedUser
 * @property {string} uid
 * @property {string} displayName
 * @property {string[]} groups
 * @property {boolean} isAdmin
 * @property {boolean} notifications
 */

/**
 * @param {{ users?: RecordedUser[] }} [options]
 */
export function createSdkRecorder(options = {}) {
  const declaredUsers = options.users ?? [];

  const recorder = {
    /** Every `Miakapi(...)` construction, with the credentials it received. */
    connections: [],
    /** Every `HOME.commit()`, with a snapshot of the variables at that moment. */
    commits: [],
    /** Every `user.sendPush(notif)`, with the recipient. */
    pushes: [],
    /** Every `HOME.reconnect()`. */
    reconnects: 0,
  };

  /** @type {{ ready: Function[], update: Function[], userLogin: Function[], userAction: Function[] }} */
  const subscribers = { ready: [], update: [], userLogin: [], userAction: [] };

  const users = declaredUsers.map((user) => ({
    ...user,
    sendPush(notif) {
      recorder.pushes.push({ uid: user.uid, displayName: user.displayName, notif });
    },
  }));

  const home = {
    // `variables` is a plain assignable property: the node mutates a module
    // level object and then assigns the whole thing before committing.
    variables: {},
    users,

    onReady(handler) {
      subscribers.ready.push(handler);
    },
    onUpdate(handler) {
      subscribers.update.push(handler);
    },
    onUserLogin(handler) {
      subscribers.userLogin.push(handler);
    },
    onUserAction(handler) {
      subscribers.userAction.push(handler);
    },

    commit() {
      // Snapshot, not reference: the node reuses one variables object across
      // commits, so keeping the reference would rewrite history.
      recorder.commits.push(structuredClone(home.variables));
    },

    reconnect() {
      recorder.reconnects += 1;
    },
  };

  // Fail loudly on any SDK member the node did not use at 3.0.31.
  const guardedHome = new Proxy(home, {
    get(target, property, receiver) {
      if (property in target || typeof property === 'symbol') {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(
        `node-red-contrib-miakapi used an unrecorded miakapi SDK member: ${String(property)}. `
          + 'The recorder in src/sdk-recorder.mjs must be extended to match the real client.',
      );
    },
  });

  /** The CommonJS shape of the real package: the module export is the factory. */
  function factory(homeID, coordID, coordSecret) {
    recorder.connections.push({ homeID, coordID, coordSecret });
    return guardedHome;
  }

  /** Drive the callbacks the coordinator would otherwise fire. */
  const emit = {
    ready() {
      subscribers.ready.forEach((handler) => handler());
    },
    update(nextUsers) {
      subscribers.update.forEach((handler) => handler(nextUsers));
    },
    userLogin(event) {
      subscribers.userLogin.forEach((handler) => handler(event));
    },
    userAction(action) {
      subscribers.userAction.forEach((handler) => handler(action));
    },
    /**
     * How many subscriptions the SDK received, per event.
     *
     * This counts calls to `HOME.onUserAction` and friends, which is not the
     * number of nodes listening. `initMiakapi` subscribes once per event and
     * fans out to nodes through its own module level `handlers` object, so the
     * coordinator always sees exactly one consumer per event per process.
     */
    sdkSubscriptionCounts() {
      return {
        ready: subscribers.ready.length,
        update: subscribers.update.length,
        userLogin: subscribers.userLogin.length,
        userAction: subscribers.userAction.length,
      };
    },
  };

  return { factory, recorder, emit, home: guardedHome };
}
