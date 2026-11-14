// The Firebase Hosting config of the dedicated sandbox site.
//
// The site serves one document, `/app.html` (see `app-document.ts`), and that
// document is only safe under the headers built with it. The config declares no
// rewrite on purpose: an unknown path must 404 rather than fall through to a
// document served under the sandbox's headers.

export interface SandboxHeader {
  readonly key: string;
  readonly value: string;
}

export class SandboxDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxDocumentError';
  }
}

export interface SandboxHostingConfigInput {
  readonly site: string;
  readonly documents: readonly { readonly path: string; readonly headers: readonly SandboxHeader[] }[];
}

export function buildSandboxHostingConfig(input: SandboxHostingConfigInput): unknown {
  if (input.site.trim() === '') {
    throw new SandboxDocumentError('hosting site is empty');
  }
  return {
    hosting: {
      site: input.site,
      public: '.',
      ignore: ['firebase.json'],
      headers: input.documents.map((document) => ({
        source: document.path,
        headers: document.headers.map((header) => ({ key: header.key, value: header.value })),
      })),
    },
  };
}
