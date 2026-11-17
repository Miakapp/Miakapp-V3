import { AsyncLocalStorage } from 'node:async_hooks';

import {
  DocumentReference,
  Firestore,
  Query,
  Transaction,
} from 'firebase-admin/firestore';

/**
 * In-memory count of billed Firestore document reads, by route and by
 * collection. Firestore bills one read per document returned (a missing
 * document or an empty query still costs one), and the free tier stops at
 * 50,000 a day; Google's own metrics are unreadable without billing, so the
 * control plane counts for itself.
 *
 * The meter patches the SDK prototypes once (reads happen in four entry
 * points: Firestore#getAll, which DocumentReference#get uses, Query#get, and
 * Transaction#get/getAll) and attributes each read to the route that the
 * server stored in an AsyncLocalStorage around the request. Retried
 * transactions are counted as often as they run, which is what Firestore
 * bills.
 */

interface RouteCount { requests: number; reads: number }

interface Window {
  readonly startedAt: number;
  reads: number;
  readonly routes: Map<string, RouteCount>;
  readonly collections: Map<string, number>;
}

export interface ReadMeterSnapshot {
  readonly since: string;
  readonly seconds: number;
  readonly reads: number;
  readonly routes: Record<string, RouteCount>;
  readonly collections: Record<string, number>;
}

const context = new AsyncLocalStorage<string>();
let installed = false;

function newWindow(now: number): Window {
  return { startedAt: now, reads: 0, routes: new Map(), collections: new Map() };
}

let total = newWindow(Date.now());
let current = newWindow(Date.now());

function route(name: string, window: Window): RouteCount {
  let entry = window.routes.get(name);
  if (entry === undefined) {
    entry = { requests: 0, reads: 0 };
    window.routes.set(name, entry);
  }
  return entry;
}

function record(collection: string, reads: number): void {
  const name = context.getStore() ?? 'background';
  for (const window of [total, current]) {
    window.reads += reads;
    route(name, window).reads += reads;
    window.collections.set(collection, (window.collections.get(collection) ?? 0) + reads);
  }
}

function collectionOf(target: unknown): string {
  if (target instanceof DocumentReference) return target.parent.id;
  const options = (target as { _queryOptions?: { collectionId?: unknown } })._queryOptions;
  if (typeof options?.collectionId === 'string') return options.collectionId;
  const inner = (target as { _query?: unknown })._query;
  if (inner !== undefined && inner !== target) return collectionOf(inner);
  return 'unknown';
}

function recordDocuments(args: readonly unknown[]): void {
  for (const argument of args) {
    if (argument instanceof DocumentReference) record(collectionOf(argument), 1);
  }
}

function querySize(result: unknown): number {
  const size = (result as { size?: unknown }).size;
  return typeof size === 'number' ? Math.max(1, size) : 1;
}

/** Patches the Firestore SDK once; later calls do nothing. */
export function installFirestoreReadMeter(): void {
  if (installed) return;
  installed = true;

  const getAll = Firestore.prototype.getAll;
  Firestore.prototype.getAll = function patchedGetAll(this: Firestore, ...args: unknown[]) {
    recordDocuments(args);
    return (getAll as (...values: unknown[]) => ReturnType<typeof getAll>).apply(this, args);
  } as typeof getAll;

  const queryGet = Query.prototype.get;
  Query.prototype.get = async function patchedQueryGet(this: Query) {
    const result = await queryGet.call(this);
    record(collectionOf(this), querySize(result));
    return result;
  } as typeof queryGet;

  const transactionGet = Transaction.prototype.get;
  Transaction.prototype.get = async function patchedTransactionGet(this: Transaction, target: unknown) {
    const result = await (transactionGet as (value: unknown) => Promise<unknown>).call(this, target);
    // Documents and aggregations cost one read; a query costs its results.
    record(collectionOf(target), target instanceof Query ? querySize(result) : 1);
    return result;
  } as typeof transactionGet;

  const transactionGetAll = Transaction.prototype.getAll;
  Transaction.prototype.getAll = function patchedTransactionGetAll(this: Transaction, ...args: unknown[]) {
    recordDocuments(args);
    return (transactionGetAll as (...values: unknown[]) => ReturnType<typeof transactionGetAll>).apply(this, args);
  } as typeof transactionGetAll;
}

/**
 * Stable route name: identifiers in the path become placeholders so that the
 * table stays small (`GET /v1/homes/:home/interface`).
 */
export function routeName(method: string, url: string): string {
  const path = url.split('?')[0] ?? '';
  const normalized = path
    .replace(/^\/v1\/homes\/[^/]+/, '/v1/homes/:home')
    .replace(/\/v1\/components\/[A-Za-z0-9_-]+\.js$/, '/v1/components/:sha.js')
    .replace(/\/[A-Za-z0-9_-]{43}$/, '/:sha')
    .replace(/\/[A-Za-z0-9_-]{22}(?=$|:)/, '/:id');
  return `${method} ${normalized.length > 96 ? normalized.slice(0, 96) : normalized}`;
}

/** Runs a request handler with its route attached to every read it makes. */
export function meterRequest<Value>(name: string, run: () => Value): Value {
  for (const window of [total, current]) route(name, window).requests += 1;
  return context.run(name, run);
}

function snapshot(window: Window, now: number): ReadMeterSnapshot {
  const routes = [...window.routes.entries()]
    .sort(([, a], [, b]) => b.reads - a.reads || b.requests - a.requests);
  const collections = [...window.collections.entries()].sort(([, a], [, b]) => b - a);
  return Object.freeze({
    since: new Date(window.startedAt).toISOString(),
    seconds: Math.round((now - window.startedAt) / 1_000),
    reads: window.reads,
    routes: Object.fromEntries(routes.map(([name, count]) => [name, { ...count }])),
    collections: Object.fromEntries(collections),
  });
}

/** Counts since the process started. */
export function readMeterTotals(now = Date.now()): ReadMeterSnapshot {
  return snapshot(total, now);
}

/** Counts since the previous call (or start), then starts a new window. */
export function takeReadMeterWindow(now = Date.now()): ReadMeterSnapshot {
  const result = snapshot(current, now);
  current = newWindow(now);
  return result;
}

/** Test hook: forget everything counted so far. */
export function resetReadMeter(now = Date.now()): void {
  total = newWindow(now);
  current = newWindow(now);
}
