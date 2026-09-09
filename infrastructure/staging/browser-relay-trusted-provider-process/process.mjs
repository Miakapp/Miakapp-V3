import {
  StagingBrowserRelayTrustedProviderProcessError,
  cloneValidatedTrustedProviderProcessResult,
  normalizeTrustedProviderProcessOptions,
  rejectTrustedProviderProcess,
} from './contract.mjs';
import {
  createBrowserRelayTrustedProviderProcessInternal,
} from './internal.mjs';

export function createBrowserRelayTrustedProviderProcess(optionsValue) {
  if (arguments.length !== 1) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  const options = normalizeTrustedProviderProcessOptions(optionsValue);
  const processController = createBrowserRelayTrustedProviderProcessInternal(options);
  return Object.freeze(Object.assign(Object.create(null), {
    async execute(input = {}) {
      try {
        if (arguments.length > 1) rejectTrustedProviderProcess('invalid_configuration');
        return await cloneValidatedTrustedProviderProcessResult(
          await processController.execute(input),
        );
      } catch (error) {
        if (error instanceof StagingBrowserRelayTrustedProviderProcessError) throw error;
        throw new StagingBrowserRelayTrustedProviderProcessError('peer_failed');
      }
    },
    close: processController.close,
  }));
}
