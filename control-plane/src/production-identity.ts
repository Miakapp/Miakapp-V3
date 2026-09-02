import type { Credential, GoogleOAuthAccessToken } from 'firebase-admin/app';
import { Compute } from 'google-auth-library';
import { GoogleAuth, googleAuthLibrary } from 'google-gax';

import { ProductionDependencyError } from './cloud-security.js';
import type { ProductionRuntimeConfig } from './production-runtime-config.js';

const FIREBASE_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/userinfo.email',
] as const);
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface ProductionRuntimeIdentity {
  readonly firebaseCredential: Credential;
  readonly authClient: Compute;
  readonly googleAuth: GoogleAuth;
  readonly serviceAccountEmail: string;
}

function fail(): never {
  throw new ProductionDependencyError();
}

class MetadataServiceAccountCredential implements Credential {
  readonly #client: Compute;

  constructor(client: Compute) {
    this.#client = client;
  }

  async getAccessToken(): Promise<GoogleOAuthAccessToken> {
    try {
      const response = await this.#client.getAccessToken();
      const token = response.token;
      const expiry = this.#client.credentials.expiry_date;
      const expiresIn = typeof expiry === 'number'
        ? Math.floor((expiry - Date.now()) / 1_000)
        : 0;
      if (typeof token !== 'string'
        || token.length === 0
        || Buffer.byteLength(token, 'utf8') > 8_192
        || !/^[\x21-\x7e]+$/.test(token)
        || !Number.isSafeInteger(expiresIn)
        || expiresIn < 1
        || expiresIn > 86_400) {
        return fail();
      }
      return Object.freeze({ access_token: token, expires_in: expiresIn });
    } catch {
      return fail();
    }
  }
}

export function createProductionRuntimeIdentity(
  config: ProductionRuntimeConfig,
): ProductionRuntimeIdentity {
  const compute = new Compute({
    serviceAccountEmail: config.serviceAccountEmail,
    scopes: [...FIREBASE_SCOPES],
  });
  const cloudCompute = new googleAuthLibrary.Compute({
    serviceAccountEmail: config.serviceAccountEmail,
    scopes: [CLOUD_PLATFORM_SCOPE],
  });
  const googleAuth = new GoogleAuth({
    authClient: cloudCompute,
    projectId: config.security.projectId,
    universeDomain: 'googleapis.com',
  });
  return Object.freeze({
    authClient: compute,
    firebaseCredential: new MetadataServiceAccountCredential(compute),
    googleAuth,
    serviceAccountEmail: config.serviceAccountEmail,
  });
}
