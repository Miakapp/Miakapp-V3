import { beforeEach, describe, expect, it } from 'vitest';
import { captureHomeLink, homeLinkFor, parseHomeLink } from './home-link';

describe('home links', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps what a home link carried for that home, Miakapp\'s own parameters excluded', () => {
    captureHomeLink({ pathname: '/h/colmon', search: '?invite=abc&from=push&oobCode=x&invite=2', hash: '#salon' });
    expect(homeLinkFor('colmon')).toEqual({ params: { invite: 'abc' }, hash: 'salon' });
    expect(homeLinkFor('other')).toEqual({ params: {}, hash: '' });
  });

  it('ignores addresses that name no home and links that carry nothing', () => {
    captureHomeLink({ pathname: '/', search: '?invite=abc', hash: '' });
    captureHomeLink({ pathname: '/h/colmon', search: '', hash: '' });
    expect(sessionStorage.length).toBe(0);
  });

  it('drops what is over the bounds', () => {
    expect(parseHomeLink(`?a=${'x'.repeat(3_000)}`, `#${'y'.repeat(3_000)}`)).toEqual({ params: {}, hash: '' });
    const many = Array.from({ length: 40 }, (_, i) => `k${i}=v`).join('&');
    expect(Object.keys(parseHomeLink(`?${many}`, '').params)).toHaveLength(32);
  });

  it('survives a corrupt stored value', () => {
    sessionStorage.setItem('miakapp.home-link.v1:colmon', '{');
    expect(homeLinkFor('colmon')).toEqual({ params: {}, hash: '' });
  });
});
