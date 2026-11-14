import { describe, expect, it } from 'vitest';

import { canonicalizeHomeAddress, homePath, isAppPath, requestedHomeId } from './home-url';

describe('home addresses', () => {
  it('reads /app/<id>, /h/<id> and the legacy /app?home=<id>', () => {
    expect(requestedHomeId('/app/colmon', '')).toBe('colmon');
    expect(requestedHomeId('/h/colmon', '')).toBe('colmon');
    expect(requestedHomeId('/app/colmon/', '?from=push')).toBe('colmon');
    expect(requestedHomeId('/app', '?home=colmon')).toBe('colmon');
    expect(requestedHomeId('/app', '')).toBeNull();
    expect(requestedHomeId('/app/Not_A_Home', '')).toBeNull();
    expect(requestedHomeId('/pair', '?home=colmon')).toBeNull();
  });

  it('writes /app/<id> and treats every home address as the app', () => {
    expect(homePath('colmon')).toBe('/app/colmon');
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/h/colmon')).toBe(true);
    expect(isAppPath('/fr')).toBe(false);
  });

  it('rewrites a legacy address in place and keeps its other parameters', () => {
    window.history.replaceState({}, '', '/app?home=colmon&from=push');
    canonicalizeHomeAddress(window.location, window.history);
    expect(`${window.location.pathname}${window.location.search}`).toBe('/app/colmon?from=push');
  });
});
