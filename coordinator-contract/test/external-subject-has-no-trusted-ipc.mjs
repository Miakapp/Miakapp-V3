if (process.send !== undefined
  || process._send !== undefined
  || process.channel !== undefined) {
  throw new Error('Subject process inherited trusted Node IPC');
}

export { createCoordinatorContractSubject } from './external-subject.mjs';
