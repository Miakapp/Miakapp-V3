import { afterEach, describe, expect, it } from 'vitest';

import { captureTestSession, endTestSession, readTestSession, TestSessionIdentity } from './test-session';

function ticketFor(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  return `mkt1.${payload}.sig`;
}

const exp = Math.floor(Date.now() / 1_000) + 600;

describe('test sessions in the shell', () => {
  afterEach(() => {
    endTestSession('colmon');
    sessionStorage.clear();
  });

  it('keeps the ticket for this tab, takes it out of the address and keeps the rest', () => {
    const ticket = ticketFor({ home: 'colmon', role: 'member', release: null, exp });
    history.replaceState(null, '', '/h/colmon?invite=x');
    captureTestSession({ pathname: '/h/colmon', search: '?invite=x', hash: `#miakapp-test=${ticket}&page=2` });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/h/colmon?invite=x#page=2');
    const session = readTestSession('colmon');
    expect(session).toMatchObject({ homeId: 'colmon', role: 'member', release: null, ticket });
    expect(new TestSessionIdentity(session!).getUserId()).toBe('test:member');
  });

  it('ignores a ticket for another home, and an expired one', () => {
    captureTestSession({ pathname: '/h/colmon', search: '', hash: `#miakapp-test=${ticketFor({ home: 'other', role: 'member', exp })}` });
    expect(readTestSession('colmon')).toBeUndefined();
    captureTestSession({ pathname: '/h/colmon', search: '', hash: `#miakapp-test=${ticketFor({ home: 'colmon', role: 'member', exp: 10 })}` });
    expect(readTestSession('colmon')).toBeUndefined();
  });
});
