import {
  claimTrustedProviderEphemeralAuthority,
} from './authority-channel.mjs';
import {
  StagingBrowserRelayTrustedProviderProcessError,
  cloneValidatedTrustedProviderProcessResult,
  normalizeTrustedProviderProcessOptions,
  rejectTrustedProviderProcess,
  validateTrustedProviderProcessExecuteInput,
} from './contract.mjs';
import {
  createBrowserRelayTrustedProviderProcessInternal,
} from './internal.mjs';

const INTRINSIC_BUFFER_FILL = Buffer.prototype.fill;

export function createBrowserRelayTrustedProviderProcess(optionsValue) {
  if (arguments.length !== 1) {
    rejectTrustedProviderProcess('invalid_configuration');
  }
  const options = normalizeTrustedProviderProcessOptions(optionsValue);
  const processController = createBrowserRelayTrustedProviderProcessInternal(options);
  return Object.freeze(Object.assign(Object.create(null), {
    async execute(input) {
      let authority;
      try {
        if (arguments.length !== 1) rejectTrustedProviderProcess('invalid_configuration');
        const validated = validateTrustedProviderProcessExecuteInput(input);
        authority = claimTrustedProviderEphemeralAuthority(validated.authority);
        return await cloneValidatedTrustedProviderProcessResult(
          await processController.execute(Object.freeze({
            authority,
            ...(validated.signal === undefined ? {} : { signal: validated.signal }),
          })),
        );
      } catch (error) {
        if (error instanceof StagingBrowserRelayTrustedProviderProcessError) throw error;
        throw new StagingBrowserRelayTrustedProviderProcessError('peer_failed');
      } finally {
        if (authority !== undefined) {
          try {
            Reflect.apply(INTRINSIC_BUFFER_FILL, authority, [0]);
          } catch {
            // The internal process boundary owns the same buffer and also clears it.
          }
        }
        authority = undefined;
      }
    },
    close: processController.close,
  }));
}
