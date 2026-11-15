import { describe, expect, it } from 'vitest';

import { canonicalizeHomeAddress, homeIdFromInput, homePath, isAppPath, requestedHomeId } from './home-url';

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
    expect(homePath('colmon')).toBe('/h/colmon');
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/h/colmon')).toBe(true);
    expect(isAppPath('/fr')).toBe(false);
  });

  it('rewrites a legacy address in place and keeps its other parameters', () => {
    window.history.replaceState({}, '', '/app?home=colmon&from=push');
    canonicalizeHomeAddress(window.location, window.history);
    expect(`${window.location.pathname}${window.location.search}`).toBe('/h/colmon?from=push');
    window.history.replaceState({}, '', '/app/colmon');
    canonicalizeHomeAddress(window.location, window.history);
    expect(window.location.pathname).toBe('/h/colmon');
  });
});

describe('a home typed by hand', () => {
  it('reads an id or any of its links', () => {
    expect(homeIdFromInput('colmon')).toBe('colmon');
    expect(homeIdFromInput('  Colmon ')).toBe('colmon');
    expect(homeIdFromInput('miakapp.com/h/colmon')).toBe('colmon');
    expect(homeIdFromInput('https://www.miakapp.com/h/colmon')).toBe('colmon');
    expect(homeIdFromInput('https://www.miakapp.com/app/colmon')).toBe('colmon');
    expect(homeIdFromInput('https://www.miakapp.com/app?home=colmon')).toBe('colmon');
  });

  it('refuses what names no home', () => {
    expect(homeIdFromInput('')).toBeNull();
    expect(homeIdFromInput('a')).toBeNull();
    expect(homeIdFromInput('ma maison')).toBeNull();
    expect(homeIdFromInput('https://www.miakapp.com/pair')).toBeNull();
  });
});
