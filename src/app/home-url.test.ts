import { describe, expect, it } from 'vitest';

import { homeIdFromInput, homePath, isAppPath, requestedHomeId } from './home-url';

describe('home addresses', () => {
  it('reads /h/<id> only', () => {
    expect(requestedHomeId('/h/colmon')).toBe('colmon');
    expect(requestedHomeId('/h/colmon/')).toBe('colmon');
    expect(requestedHomeId('/app/colmon')).toBeNull();
    expect(requestedHomeId('/app')).toBeNull();
    expect(requestedHomeId('/h/Not_A_Home')).toBeNull();
    expect(requestedHomeId('/pair')).toBeNull();
  });

  it('writes /h/<id> and treats /app and every home address as the app', () => {
    expect(homePath('colmon')).toBe('/h/colmon');
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/h/colmon')).toBe(true);
    expect(isAppPath('/app/colmon')).toBe(true);
    expect(isAppPath('/fr')).toBe(false);
  });
});

describe('a home typed by hand', () => {
  it('reads an id or any of its links', () => {
    expect(homeIdFromInput('colmon')).toBe('colmon');
    expect(homeIdFromInput('  Colmon ')).toBe('colmon');
    expect(homeIdFromInput('miakapp.com/h/colmon')).toBe('colmon');
    expect(homeIdFromInput('https://www.miakapp.com/h/colmon')).toBe('colmon');
  });

  it('refuses what names no home', () => {
    expect(homeIdFromInput('')).toBeNull();
    expect(homeIdFromInput('a')).toBeNull();
    expect(homeIdFromInput('ma maison')).toBeNull();
    expect(homeIdFromInput('https://www.miakapp.com/pair')).toBeNull();
  });
});
