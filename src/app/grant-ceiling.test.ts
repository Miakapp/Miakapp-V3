import { describe, expect, it } from 'vitest';
import { platformGrantCeiling } from './grant-ceiling';

describe('platformGrantCeiling', () => {
  it('keeps the home\'s own functions and miakapp.join, never another reserved function', () => {
    const ceiling = platformGrantCeiling({
      state_read: ['room.*'],
      event_subscribe: ['door.opened'],
      event_publish: [],
      call: ['lighting.set', 'miakapp.join', 'miakapp.direct.house', 'miakapp.*'],
      presentation: ['media.camera'],
    });
    expect(ceiling.call).toEqual(['lighting.set', 'miakapp.join']);
    expect(ceiling.event_subscribe).toEqual([]);
    expect(ceiling.presentation).toEqual([]);
  });
});
