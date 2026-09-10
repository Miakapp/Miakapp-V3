import {
  createBrowserRelayHostingPublisherForImplementation,
} from './internal.mjs';

function wait(milliseconds, signal = undefined) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => finish(() => reject(new Error('Hosting publisher wait aborted')));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(resolve), milliseconds);
    if (signal?.aborted) abort();
  });
}

const IMPLEMENTATIONS = Object.freeze({
  clock: Date.now,
  fetch: globalThis.fetch.bind(globalThis),
  wait,
});

export function createBrowserRelayHostingPublisher(session, artifactEntries) {
  return createBrowserRelayHostingPublisherForImplementation(
    session,
    artifactEntries,
    IMPLEMENTATIONS,
  ).publisher;
}
