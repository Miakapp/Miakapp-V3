import { describe, expect, test } from 'bun:test';

import { Firestore, Query, Transaction } from 'firebase-admin/firestore';

import {
  installFirestoreReadMeter,
  meterRequest,
  readMeterTotals,
  resetReadMeter,
  routeName,
  takeReadMeterWindow,
} from '../../src/read-meter.js';

// The meter wraps whatever the prototypes hold when it installs: offline
// stand-ins go first, so the counted calls never reach the network.
Firestore.prototype.getAll = (async (...refs: unknown[]) => refs.map(() => ({ exists: false }))) as never;
Query.prototype.get = (async () => ({ size: 3 })) as never;
Transaction.prototype.get = (async (target: unknown) => (
  target instanceof Query ? { size: 0 } : { exists: true }
)) as never;
installFirestoreReadMeter();

const firestore = new Firestore({ projectId: 'meter-test' });

describe('read meter', () => {
  test('names routes without identifiers', () => {
    expect(routeName('GET', '/v1/homes/colmon/interface')).toBe('GET /v1/homes/:home/interface');
    expect(routeName('POST', '/v1/access-tokens:exchange')).toBe('POST /v1/access-tokens:exchange');
    expect(routeName('DELETE', '/v1/homes/colmon/home-keys/AAAAAAAAAAAAAAAAAAAAAA'))
      .toBe('DELETE /v1/homes/:home/home-keys/:id');
    expect(routeName('POST', '/v1/homes/colmon/component-uploads/AAAAAAAAAAAAAAAAAAAAAA:finalize'))
      .toBe('POST /v1/homes/:home/component-uploads/:id:finalize');
    expect(routeName('GET', `/v1/components/${'a'.repeat(43)}.js`)).toBe('GET /v1/components/:sha.js');
  });

  test('counts billed reads by route and collection', async () => {
    resetReadMeter();
    await meterRequest('GET /v1/homes/:home/interface', async () => {
      await firestore.collection('controlHomes').doc('colmon').get();
      await firestore.getAll(firestore.collection('homes').doc('a'), firestore.collection('homes').doc('b'));
      await firestore.collection('controlHomes').where('owner_uid', '==', 'u').get();
    });
    await meterRequest('POST /v1/access-tokens:exchange', async () => {
      const transaction = Object.create(Transaction.prototype) as Transaction;
      await transaction.get(firestore.collection('controlHomes').doc('colmon').collection('homeKeys').doc('k'));
      // An empty query still costs one read.
      await transaction.get(firestore.collection('homeKeyIndex').limit(5));
    });
    await firestore.collection('components').doc('colmon').get();

    const totals = readMeterTotals();
    expect(totals.reads).toBe(1 + 2 + 3 + 1 + 1 + 1);
    expect(totals.routes['GET /v1/homes/:home/interface']).toEqual({ requests: 1, reads: 6 });
    expect(totals.routes['POST /v1/access-tokens:exchange']).toEqual({ requests: 1, reads: 2 });
    expect(totals.routes.background).toEqual({ requests: 0, reads: 1 });
    expect(totals.collections).toEqual({ controlHomes: 4, homes: 2, homeKeys: 1, homeKeyIndex: 1, components: 1 });

    expect(takeReadMeterWindow().reads).toBe(9);
    expect(takeReadMeterWindow().reads).toBe(0);
    expect(readMeterTotals().reads).toBe(9);
  });
});
