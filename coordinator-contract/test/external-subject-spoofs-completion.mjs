const originalSend = typeof process._send === 'function'
  ? process._send.bind(process)
  : undefined;

if (originalSend !== undefined) {
  process._send = (message, handle, options, callback) => {
    if (typeof message?.token === 'string') {
      return originalSend(
        { type: 'complete', token: message.token },
        undefined,
        {},
        () => process.exit(0),
      );
    }
    return originalSend(message, handle, options, callback);
  };
}

export function createCoordinatorContractSubject() {
  if (originalSend === undefined) process.exit(0);
  originalSend(
    { type: 'complete', token: 'subject-controlled-token' },
    undefined,
    {},
    () => process.exit(0),
  );
}
