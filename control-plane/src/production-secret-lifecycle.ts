import type {
  PinnedSecretKeyringConfig,
  PinnedSecretVersionReference,
  ProductionSecretPurpose,
} from './production-config.js';
import { PRODUCTION_SECRET_IDS } from './production-config.js';

const LOGICAL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SECRET_VERSION_NAME = /^projects\/([a-z][a-z0-9-]{0,62})\/secrets\/([A-Za-z0-9_-]{1,255})\/versions\/([1-9][0-9]*)$/;
const ALLOWED_PROJECT_BASES = new Set([
  'projects/miakapp-v4-staging',
  'projects/miakapp-v4',
]);

export type ProductionSecretLifecycleTransition =
  | 'initialize'
  | 'prepare'
  | 'activate'
  | 'retire'
  | 'no-op';

export interface ProductionSecretLifecycleClassification {
  readonly transition: ProductionSecretLifecycleTransition;
  readonly purposes: readonly ProductionSecretPurpose[];
}

export class ProductionSecretLifecycleError extends Error {
  constructor() {
    super('Production secret lifecycle transition is invalid');
    this.name = 'ProductionSecretLifecycleError';
  }
}

interface ParsedReference extends PinnedSecretVersionReference {
  readonly resourceBase: string;
  readonly resourceVersion: bigint;
}

interface ParsedKeyring extends PinnedSecretKeyringConfig {
  readonly versions: readonly ParsedReference[];
  readonly byLogicalVersion: ReadonlyMap<string, ParsedReference>;
  readonly resourceBase: string;
}

function fail(): never {
  throw new ProductionSecretLifecycleError();
}

function record(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
  return value as Readonly<Record<string, unknown>>;
}

const SECRET_PURPOSES = Object.freeze(
  Object.keys(PRODUCTION_SECRET_IDS) as ProductionSecretPurpose[],
);

function keyringSet(
  input: unknown,
): Readonly<Record<ProductionSecretPurpose, PinnedSecretKeyringConfig>> {
  const candidate = record(input, SECRET_PURPOSES);
  let projectBase: string | undefined;
  for (const purpose of SECRET_PURPOSES) {
    const parsed = parseKeyring(candidate[purpose]);
    const suffix = `/secrets/${PRODUCTION_SECRET_IDS[purpose]}`;
    if (!parsed.resourceBase.endsWith(suffix)) fail();
    const currentProjectBase = parsed.resourceBase.slice(0, -suffix.length);
    if (!ALLOWED_PROJECT_BASES.has(currentProjectBase)
      || (projectBase !== undefined && currentProjectBase !== projectBase)) {
      fail();
    }
    projectBase = currentProjectBase;
  }
  return candidate as Readonly<Record<ProductionSecretPurpose, PinnedSecretKeyringConfig>>;
}

function parseReference(input: unknown): ParsedReference {
  const reference = record(input, ['logicalVersion', 'resourceName']);
  if (typeof reference.logicalVersion !== 'string'
    || !LOGICAL_VERSION.test(reference.logicalVersion)
    || typeof reference.resourceName !== 'string'
    || Buffer.byteLength(reference.resourceName, 'utf8') > 512) {
    fail();
  }
  const match = SECRET_VERSION_NAME.exec(reference.resourceName);
  if (match === null) fail();
  const resourceBase = `projects/${match[1]}/secrets/${match[2]}`;
  return Object.freeze({
    logicalVersion: reference.logicalVersion,
    resourceName: reference.resourceName,
    resourceBase,
    resourceVersion: BigInt(match[3] as string),
  });
}

function parseKeyring(input: unknown): ParsedKeyring {
  const candidate = record(input, ['currentVersion', 'versions']);
  if (typeof candidate.currentVersion !== 'string'
    || !LOGICAL_VERSION.test(candidate.currentVersion)
    || !Array.isArray(candidate.versions)
    || candidate.versions.length === 0
    || candidate.versions.length > 2) {
    fail();
  }
  const versions = candidate.versions.map((entry) => parseReference(entry));
  const logicalVersions = new Set<string>();
  const resourceNames = new Set<string>();
  const resourceBase = versions[0]?.resourceBase;
  if (resourceBase === undefined) fail();
  for (const version of versions) {
    if (version.resourceBase !== resourceBase
      || logicalVersions.has(version.logicalVersion)
      || resourceNames.has(version.resourceName)) {
      fail();
    }
    logicalVersions.add(version.logicalVersion);
    resourceNames.add(version.resourceName);
  }
  if (!logicalVersions.has(candidate.currentVersion)) fail();
  return Object.freeze({
    currentVersion: candidate.currentVersion,
    versions: Object.freeze(versions),
    byLogicalVersion: new Map(versions.map((version) => [version.logicalVersion, version])),
    resourceBase,
  });
}

function hasSameVersions(left: ParsedKeyring, right: ParsedKeyring): boolean {
  return left.versions.length === right.versions.length
    && left.versions.every((version) => (
      right.byLogicalVersion.get(version.logicalVersion)?.resourceName === version.resourceName
    ));
}

function isSubset(subset: ParsedKeyring, superset: ParsedKeyring): boolean {
  return subset.versions.every((version) => (
    superset.byLogicalVersion.get(version.logicalVersion)?.resourceName === version.resourceName
  ));
}

export function classifyProductionSecretLifecycleTransition(
  previous: PinnedSecretKeyringConfig | undefined,
  next: PinnedSecretKeyringConfig,
): ProductionSecretLifecycleTransition {
  const parsedNext = parseKeyring(next);
  if (previous === undefined) {
    if (parsedNext.versions.length !== 1) fail();
    return 'initialize';
  }

  const parsedPrevious = parseKeyring(previous);
  if (parsedPrevious.resourceBase !== parsedNext.resourceBase) fail();

  if (hasSameVersions(parsedPrevious, parsedNext)) {
    if (parsedPrevious.currentVersion === parsedNext.currentVersion) return 'no-op';
    if (parsedPrevious.versions.length === 2) return 'activate';
    return fail();
  }

  if (parsedPrevious.versions.length === 1
    && parsedNext.versions.length === 2
    && parsedPrevious.currentVersion === parsedNext.currentVersion
    && isSubset(parsedPrevious, parsedNext)) {
    const added = parsedNext.versions.find((version) => (
      !parsedPrevious.byLogicalVersion.has(version.logicalVersion)
    ));
    const highestPreviousVersion = parsedPrevious.versions.reduce(
      (highest, version) => version.resourceVersion > highest ? version.resourceVersion : highest,
      0n,
    );
    if (added === undefined || added.resourceVersion <= highestPreviousVersion) fail();
    return 'prepare';
  }

  if (parsedPrevious.versions.length === 2
    && parsedNext.versions.length === 1
    && parsedPrevious.currentVersion === parsedNext.currentVersion
    && isSubset(parsedNext, parsedPrevious)) {
    return 'retire';
  }

  return fail();
}

export function classifyProductionSecretKeyringsTransition(
  previous: Readonly<Record<ProductionSecretPurpose, PinnedSecretKeyringConfig>> | undefined,
  next: Readonly<Record<ProductionSecretPurpose, PinnedSecretKeyringConfig>>,
): ProductionSecretLifecycleClassification {
  const parsedNext = keyringSet(next);
  if (previous === undefined) {
    for (const purpose of SECRET_PURPOSES) {
      classifyProductionSecretLifecycleTransition(
        undefined,
        parsedNext[purpose],
      );
    }
    return Object.freeze({ transition: 'initialize', purposes: SECRET_PURPOSES });
  }

  const parsedPrevious = keyringSet(previous);
  const changes = SECRET_PURPOSES.flatMap((purpose) => {
    const transition = classifyProductionSecretLifecycleTransition(
      parsedPrevious[purpose],
      parsedNext[purpose],
    );
    return transition === 'no-op' ? [] : [{ purpose, transition }];
  });
  if (changes.length === 0) {
    return Object.freeze({ transition: 'no-op', purposes: Object.freeze([]) });
  }
  if (changes.length !== 1) fail();
  const change = changes[0];
  if (change === undefined) fail();
  return Object.freeze({
    transition: change.transition,
    purposes: Object.freeze([change.purpose]),
  });
}
