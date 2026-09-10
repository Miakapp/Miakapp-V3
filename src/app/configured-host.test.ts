import { describe, expect, it } from 'vitest';

import { resolveSameOriginFirebaseAuthDomain } from './configured-host';

describe('configured staging host', () => {
  it('keeps Firebase redirect auth on the same Hosting origin', () => {
    expect(resolveSameOriginFirebaseAuthDomain('home.example.test', {
      hostname: 'home.example.test',
      protocol: 'https:',
    })).toBe('home.example.test');
  });

  it('replaces a cross-origin Firebase domain on HTTPS', () => {
    expect(resolveSameOriginFirebaseAuthDomain('project.firebaseapp.com', {
      hostname: 'project.web.app',
      protocol: 'https:',
    })).toBe('project.web.app');
  });

  it('allows the Firebase emulator domain during HTTP development', () => {
    expect(resolveSameOriginFirebaseAuthDomain('project.firebaseapp.com', {
      hostname: 'localhost',
      protocol: 'http:',
    })).toBe('project.firebaseapp.com');
  });
});
