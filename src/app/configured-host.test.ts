import { describe, expect, it } from 'vitest';

import { requireSameOriginFirebaseAuthDomain } from './configured-host';

describe('configured staging host', () => {
  it('keeps Firebase redirect auth on the same Hosting origin', () => {
    expect(requireSameOriginFirebaseAuthDomain('home.example.test', {
      hostname: 'home.example.test',
      protocol: 'https:',
    })).toBe('home.example.test');
  });

  it('rejects cross-origin redirect auth on HTTPS', () => {
    expect(() => requireSameOriginFirebaseAuthDomain('project.firebaseapp.com', {
      hostname: 'project.web.app',
      protocol: 'https:',
    })).toThrow('Firebase authDomain must match the HTTPS host');
  });

  it('allows the Firebase emulator domain during HTTP development', () => {
    expect(requireSameOriginFirebaseAuthDomain('project.firebaseapp.com', {
      hostname: 'localhost',
      protocol: 'http:',
    })).toBe('project.firebaseapp.com');
  });
});
