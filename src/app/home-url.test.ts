import { describe, expect, it } from 'vitest';

import { canonicalizeHomeAddress, homePath, isAppPath, requestedHomeId } from './home-url';

describe('home addresses', () => {
  it('reads /app/<id>, /h/<id> and the legacy /app?home=<id>', () => {
    expect(requestedHomeId('/app/ma-maison', '')).toBe('ma-maison');
    expect(requestedHomeId('/h/ma-maison', '')).toBe('ma-maison');
    expect(requestedHomeId('/app/ma-maison/', '?from=push')).toBe('ma-maison');
    expect(requestedHomeId('/app', '?home=ma-maison')).toBe('ma-maison');
    expect(requestedHomeId('/app', '')).toBeNull();
    expect(requestedHomeId('/app/Not_A_Home', '')).toBeNull();
    expect(requestedHomeId('/pair', '?home=ma-maison')).toBeNull();
  });

  it('writes /app/<id> and treats every home address as the app', () => {
    expect(homePath('ma-maison')).toBe('/app/ma-maison');
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/h/ma-maison')).toBe(true);
    expect(isAppPath('/fr')).toBe(false);
  });

  it('rewrites a legacy address in place and keeps its other parameters', () => {
    window.history.replaceState({}, '', '/app?home=ma-maison&from=push');
    canonicalizeHomeAddress(window.location, window.history);
    expect(`${window.location.pathname}${window.location.search}`).toBe('/app/ma-maison?from=push');
  });
});
