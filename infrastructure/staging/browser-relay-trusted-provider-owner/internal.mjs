import {
  TRUSTED_PROVIDER_OWNER_OUTPUT_FIELDS,
  rejectTrustedProviderOwner,
  validateTrustedProviderBrowserOwner,
  validateTrustedProviderOperationOwner,
  validateTrustedProviderOwnerExecuteInput,
  validateTrustedProviderOwnerResult,
  validateTrustedProviderOwnerRuntime,
  validateTrustedProviderSourceOwner,
} from './contract.mjs';

function reject() {
  return rejectTrustedProviderOwner();
}

function ownerSurface(execute, close) {
  const owner = Object.create(null);
  Object.defineProperties(owner, {
    execute: {
      configurable: false,
      enumerable: true,
      writable: false,
      value: execute,
    },
    close: {
      configurable: false,
      enumerable: true,
      writable: false,
      value: close,
    },
  });
  return Object.freeze(owner);
}

export function createBrowserRelayTrustedProviderOwnerInternal(runtimeValue) {
  if (arguments.length !== 1) reject();
  const runtime = validateTrustedProviderOwnerRuntime(runtimeValue);
  let state = 'ready';
  let sourceOwner;
  let operationOwner;
  let browserOwner;
  let composition;
  let executeTask;
  let closeTask;

  async function closeOwnedGraph() {
    let failed = false;
    if (composition !== undefined) {
      try {
        if (await composition.close() !== undefined) failed = true;
      } catch {
        failed = true;
      }
    }
    if (sourceOwner !== undefined) {
      try {
        if (await sourceOwner.close() !== undefined) failed = true;
      } catch {
        failed = true;
      }
    }
    if (browserOwner !== undefined) {
      try {
        if (await browserOwner.close() !== undefined) failed = true;
      } catch {
        failed = true;
      }
    }
    if (operationOwner !== undefined) {
      try {
        if (await operationOwner.close() !== undefined) failed = true;
      } catch {
        failed = true;
      }
    }
    composition = undefined;
    sourceOwner = undefined;
    browserOwner = undefined;
    operationOwner = undefined;
    if (failed) reject();
    return undefined;
  }

  async function performExecute(inputValue) {
    const input = validateTrustedProviderOwnerExecuteInput(inputValue);
    const localController = input.signal === undefined ? new AbortController() : undefined;
    const signal = input.signal ?? localController.signal;
    try {
      sourceOwner = validateTrustedProviderSourceOwner(await runtime.createSourceTruth(
        Object.freeze({ clock: runtime.clock, delay: runtime.delay, signal }),
      ));
      operationOwner = validateTrustedProviderOperationOwner(await runtime.createOperation(
        Object.freeze({ authority: sourceOwner.authority }),
      ));
      browserOwner = validateTrustedProviderBrowserOwner(await runtime.createBrowser(
        Object.freeze({ authority: sourceOwner.authority }),
      ));
      composition = await runtime.createComposition(Object.freeze({
        providers: sourceOwner.providers,
        operation: operationOwner.components,
        matrix: browserOwner.components,
      }), Object.freeze({ signal }));
      if (composition === null || typeof composition !== 'object'
        || !Object.isFrozen(composition)
        || JSON.stringify(Reflect.ownKeys(composition).sort())
          !== JSON.stringify(['close', 'execute'])
        || typeof composition.execute !== 'function'
        || typeof composition.close !== 'function') reject();
      const result = validateTrustedProviderOwnerResult(await composition.execute());
      state = 'executed';
      return result;
    } catch {
      state = 'failed';
      throw new Error('Trusted provider owner execution failed');
    } finally {
      if (localController !== undefined && !localController.signal.aborted) {
        try { localController.abort(); } catch {}
      }
    }
  }

  const owner = ownerSurface(
    function execute(input = {}) {
      if (arguments.length > 1 || state !== 'ready' || executeTask !== undefined) {
        return Promise.resolve().then(() => reject());
      }
      state = 'executing';
      executeTask = Promise.resolve().then(() => performExecute(input)).catch(() => reject());
      return executeTask;
    },
    async function close() {
      if (arguments.length !== 0) reject();
      if (closeTask === undefined) {
        closeTask = (async () => {
          if (executeTask !== undefined) await Promise.allSettled([executeTask]);
          await closeOwnedGraph();
          state = 'closed';
        })();
      }
      await closeTask;
      return undefined;
    },
  );
  if (JSON.stringify(Object.keys(owner).sort())
    !== JSON.stringify([...TRUSTED_PROVIDER_OWNER_OUTPUT_FIELDS].sort())) reject();
  return owner;
}
