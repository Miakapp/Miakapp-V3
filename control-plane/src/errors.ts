export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_firebase_token'
  | 'invalid_app_check_token'
  | 'recent_authentication_required'
  | 'invalid_home_key'
  | 'invalid_access_token'
  | 'invalid_destination_proof'
  | 'not_home_owner'
  | 'insufficient_scope'
  | 'invalid_push_grant'
  | 'home_not_found'
  | 'home_exists'
  | 'limit_exceeded'
  | 'temporarily_unavailable';

interface ErrorDefinition {
  readonly status: number;
  readonly message: string;
  readonly retryable: boolean;
}

const ERROR_DEFINITIONS: Readonly<Record<ApiErrorCode, ErrorDefinition>> = Object.freeze({
  invalid_request: { status: 400, message: 'Request is invalid', retryable: false },
  invalid_firebase_token: { status: 401, message: 'Authentication failed', retryable: false },
  invalid_app_check_token: { status: 401, message: 'Application verification failed', retryable: false },
  recent_authentication_required: {
    status: 401,
    message: 'Recent authentication is required',
    retryable: false,
  },
  invalid_home_key: { status: 401, message: 'Authentication failed', retryable: false },
  invalid_access_token: { status: 401, message: 'Authentication failed', retryable: false },
  invalid_destination_proof: { status: 401, message: 'Destination proof is invalid', retryable: false },
  not_home_owner: { status: 403, message: 'Home ownership is required', retryable: false },
  insufficient_scope: { status: 403, message: 'Required scope is not granted', retryable: false },
  invalid_push_grant: { status: 403, message: 'Push grant is invalid', retryable: false },
  home_not_found: { status: 404, message: 'Home was not found', retryable: false },
  home_exists: { status: 409, message: 'Home ID is already allocated', retryable: false },
  limit_exceeded: { status: 413, message: 'A platform limit was exceeded', retryable: false },
  temporarily_unavailable: {
    status: 503,
    message: 'Service is temporarily unavailable',
    retryable: true,
  },
});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = 'ApiError';
    this.code = code;
    this.status = definition.status;
    this.retryable = definition.retryable;
  }
}

export function apiError(code: ApiErrorCode): ApiError {
  return new ApiError(code);
}
