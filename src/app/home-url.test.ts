import { describe, expect, it } from 'vitest';

import { homeIdFromInput, homePath, isAppPath, requestedHomeId } from './home-url';

describe('home addresses', () => {
  it('reads /h/<id> only', () => {
    expect(requestedHomeId('/h/ma-maison')).toBe('ma-maison');
    expect(requestedHomeId('/h/ma-maison/')).toBe('ma-maison');
    expect(requestedHomeId('/app/ma-maison')).toBeNull();
    expect(requestedHomeId('/app')).toBeNull();
    expect(requestedHomeId('/h/Not_A_Home')).toBeNull();
    expect(requestedHomeId('/pair')).toBeNull();
  });

  it('writes /h/<id> and treats /app and every home address as the app', () => {
    expect(homePath('ma-maison')).toBe('/h/ma-maison');
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/h/ma-maison')).toBe(true);
    expect(isAppPath('/app/ma-maison')).toBe(true);
    expect(isAppPath('/fr')).toBe(false);
  });
});

describe('a home typed by hand', () => {
  it('reads an id or any of its links', () => {
    expect(homeIdFromInput('ma-maison')).toBe('ma-maison');
    expect(homeIdFromInput('  Maison ')).toBe('ma-maison');
    expect(homeIdFromInput('miakapp.com/h/ma-maison')).toBe('ma-maison');
    expect(homeIdFromInput('https://www.miakapp.com/h/ma-maison')).toBe('ma-maison');
  });

  it('refuses what names no home', () => {
    expect(homeIdFromInput('')).toBeNull();
    expect(homeIdFromInput('a')).toBeNull();
    expect(homeIdFromInput('ma maison')).toBeNull();
    expect(homeIdFromInput('https://www.miakapp.com/pair')).toBeNull();
  });
});
