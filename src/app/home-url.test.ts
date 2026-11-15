import { describe, expect, it } from 'vitest';

import { canonicalizeHomeAddress, homeIdFromInput, homePath, isAppPath, requestedHomeId } from './home-url';

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
    expect(homePath('ma-maison')).toBe('/h/ma-maison');
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/h/ma-maison')).toBe(true);
    expect(isAppPath('/fr')).toBe(false);
  });

  it('rewrites a legacy address in place and keeps its other parameters', () => {
    window.history.replaceState({}, '', '/app?home=ma-maison&from=push');
    canonicalizeHomeAddress(window.location, window.history);
    expect(`${window.location.pathname}${window.location.search}`).toBe('/h/ma-maison?from=push');
    window.history.replaceState({}, '', '/app/ma-maison');
    canonicalizeHomeAddress(window.location, window.history);
    expect(window.location.pathname).toBe('/h/ma-maison');
  });
});

describe('a home typed by hand', () => {
  it('reads an id or any of its links', () => {
    expect(homeIdFromInput('ma-maison')).toBe('ma-maison');
    expect(homeIdFromInput('  Maison ')).toBe('ma-maison');
    expect(homeIdFromInput('miakapp.com/h/ma-maison')).toBe('ma-maison');
    expect(homeIdFromInput('https://www.miakapp.com/h/ma-maison')).toBe('ma-maison');
    expect(homeIdFromInput('https://www.miakapp.com/app/ma-maison')).toBe('ma-maison');
    expect(homeIdFromInput('https://www.miakapp.com/app?home=ma-maison')).toBe('ma-maison');
  });

  it('refuses what names no home', () => {
    expect(homeIdFromInput('')).toBeNull();
    expect(homeIdFromInput('a')).toBeNull();
    expect(homeIdFromInput('ma maison')).toBeNull();
    expect(homeIdFromInput('https://www.miakapp.com/pair')).toBeNull();
  });
});
