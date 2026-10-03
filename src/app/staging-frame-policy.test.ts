import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hosting = JSON.parse(readFileSync('firebase.staging.json', 'utf8')) as {
  hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
};

describe('staging shell frame navigation boundary', () => {
  it('restricts every route to runtime documents and required identity frames', () => {
    // The iframe sandbox and its own CSP do not prevent self-navigation with
    // home data in a URL. The parent must block that request BEFORE dispatch;
    // removing the frame on its second load is only lifecycle recovery.
    const policy = hosting.hosting.headers
      .filter((rule) => rule.source === '**')
      .flatMap((rule) => rule.headers)
      .find((header) => header.key.toLowerCase() === 'content-security-policy')?.value;
    expect(policy).toBeDefined();
    expect(policy?.split(/\s+/u)).toEqual([
      'frame-src',
      'https://miakapp-v4-sandbox.web.app/app.html',
      'https://miakapp-v4-sandbox.web.app/sandbox.html',
      'https://miakapp-v4-staging.firebaseapp.com/__/auth/iframe',
      'https://www.google.com/recaptcha/',
      'https://recaptcha.google.com/recaptcha/',
      'https://www.recaptcha.net/recaptcha/',
    ]);
  });
});
