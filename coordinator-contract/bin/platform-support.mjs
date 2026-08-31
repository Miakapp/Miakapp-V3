export const WINDOWS_UNSUPPORTED_MESSAGE =
  'External subject conformance is POSIX-only: Windows cannot guarantee bounded subject process-tree termination without a native Job Object';

export function externalRunnerPlatformError(platform) {
  return platform === 'win32' ? WINDOWS_UNSUPPORTED_MESSAGE : undefined;
}
