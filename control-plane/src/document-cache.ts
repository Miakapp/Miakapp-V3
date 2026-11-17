import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';

/**
 * Short-lived in-memory cache of Firestore document snapshots for the hot,
 * rarely changing reads: home records, home-key records and their index, the
 * public directory entry and the published interface pointer. It exists to
 * keep the control plane inside Firestore's free tier (50,000 reads a day):
 * a coordinator renews its relay token every ~5 minutes and a resident's page
 * renews its own, and each renewal used to read the same documents again.
 *
 * Correctness rests on two rules:
 *   - the control plane runs as one replica and is the only writer of these
 *     documents, and every mutating request calls {@link clear} when it ends,
 *     so a change made through the API (a revoked key, a deleted home, a new
 *     release) is seen by the very next request;
 *   - a change made behind the API's back (a manual Firestore edit) is seen
 *     after at most `ttlMs`.
 *
 * Missing documents are cached too: a client looping on a deleted home must
 * not cost a read per attempt (the 14/11 incident).
 *
 * A read that started before a {@link clear} never fills the cache, so a
 * request racing a write cannot pin the pre-write snapshot.
 */
export class DocumentCache {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, { readonly snapshot: DocumentSnapshot; readonly expiresAt: number }>();
  readonly #pending = new Map<string, { readonly epoch: number; readonly promise: Promise<DocumentSnapshot> }>();
  #epoch = 0;

  constructor(options: Readonly<{
    readonly ttlMs: number;
    readonly maxEntries?: number;
    readonly now?: () => number;
  }>) {
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 0) throw new Error('Invalid cache TTL');
    this.#ttlMs = options.ttlMs;
    this.#maxEntries = options.maxEntries ?? 2_000;
    this.#now = options.now ?? Date.now;
  }

  /** A cache that never keeps anything: every call reads Firestore. */
  static disabled(): DocumentCache {
    return new DocumentCache({ ttlMs: 0 });
  }

  get enabled(): boolean {
    return this.#ttlMs > 0;
  }

  async get(reference: DocumentReference): Promise<DocumentSnapshot> {
    if (!this.enabled) return reference.get();
    const path = reference.path;
    const now = this.#now();
    const cached = this.#entries.get(path);
    if (cached !== undefined) {
      if (cached.expiresAt > now) return cached.snapshot;
      this.#entries.delete(path);
    }
    // Concurrent requests for the same document share one read.
    const pending = this.#pending.get(path);
    if (pending !== undefined && pending.epoch === this.#epoch) return pending.promise;
    const epoch = this.#epoch;
    const promise = reference.get().then((snapshot) => {
      if (epoch === this.#epoch) {
        if (this.#entries.size >= this.#maxEntries) {
          const oldest = this.#entries.keys().next();
          if (oldest.done !== true) this.#entries.delete(oldest.value);
        }
        this.#entries.set(path, { snapshot, expiresAt: this.#now() + this.#ttlMs });
      }
      return snapshot;
    }).finally(() => {
      if (this.#pending.get(path)?.promise === promise) this.#pending.delete(path);
    });
    this.#pending.set(path, { epoch, promise });
    return promise;
  }

  /** Forgets everything; reads in flight will not fill the cache. */
  clear(): void {
    this.#epoch += 1;
    this.#entries.clear();
    this.#pending.clear();
  }
}
