/**
 * Brings the Miakapp V4 staging home up for a session and back down after it.
 *
 * The staging home is not free to leave running, and the reason is not the
 * obvious one. Measured on 2026-09-14:
 *
 *   miakapp-staging-coordinator   86 321 billable seconds  (min = 1)
 *   miakapp-staging-relay-a       86 307 billable seconds  (min = 0)
 *   miakapp-staging-relay-b                0 seconds       (min = 0)
 *   control-plane                      242 seconds         (min = 0)
 *
 * The coordinator is billed because `min = 1` pins one instance. The relay is
 * billed because the coordinator holds an outbound WebSocket to it, and Cloud
 * Run bills an instance with an open connection as active whatever its minimum
 * is. Two vCPU-days for one idle home. `relay-b`, identical but unconnected,
 * costs nothing — which is what identifies the socket as the cause.
 *
 * So there is exactly one switch, and it is the coordinator's minimum. At zero
 * the instance terminates (nothing inbound ever wakes it — it has no invoker
 * binding at all), its socket closes, and the relay scales to zero behind it.
 *
 * The switch is honest about what it costs in the other direction: `up` leaves
 * the home reachable and billing continuously until someone runs `down`.
 */
import { readFileSync } from 'node:fs';

const PROJECT = 'miakapp-v4-staging';
const REGION = 'europe-west9';
const COORDINATOR = 'miakapp-staging-coordinator';
const WATCHED = [COORDINATOR, 'miakapp-staging-relay-a', 'miakapp-staging-relay-b', 'control-plane'];
const UP_CONFIRMATION = `start-billing:${PROJECT}`;

type Command = 'status' | 'up' | 'down';

function usage(): never {
  console.error('Usage: bun scripts/staging-home.ts <status|up|down> [--apply]');
  console.error('');
  console.error('  status        read-only; prints the minimum and the live instance count');
  console.error('  down          sets the coordinator minimum to 0 and stops the burn');
  console.error(`  up            sets it to 1; needs MIAKAPP_STAGING_HOME_CONFIRMATION=${UP_CONFIRMATION}`);
  console.error('');
  console.error('  up and down print the exact request and change nothing without --apply.');
  process.exit(2);
}

async function accessToken(): Promise<string> {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path === undefined) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set; run `gcloud auth application-default login`');
  }
  const adc = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`token exchange failed: HTTP ${response.status}`);
  return (await response.json() as { access_token: string }).access_token;
}

function serviceUrl(name: string): string {
  return `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${name}`;
}

async function readService(token: string, name: string): Promise<Record<string, never>> {
  const response = await fetch(serviceUrl(name), {
    headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT },
  });
  if (!response.ok) throw new Error(`reading ${name} failed: HTTP ${response.status}`);
  return await response.json() as Record<string, never>;
}

/**
 * Live instance counts. `min` says what is pinned; this says what is running,
 * and the difference between the two is the whole point — a `min = 0` service
 * holding a socket reads as zero in the configuration and bills all day.
 */
async function instanceCounts(token: string): Promise<Map<string, number>> {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 60 * 1000);
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries`);
  url.searchParams.set('filter', 'metric.type="run.googleapis.com/container/instance_count"');
  url.searchParams.set('interval.startTime', start.toISOString());
  url.searchParams.set('interval.endTime', end.toISOString());
  url.searchParams.set('aggregation.alignmentPeriod', '600s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_MAX');

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT },
  });
  const counts = new Map<string, number>();
  if (!response.ok) return counts;
  const body = await response.json() as {
    timeSeries?: Array<{
      resource?: { labels?: { service_name?: string } };
      points?: Array<{ value?: { doubleValue?: number; int64Value?: string } }>;
    }>;
  };
  for (const series of body.timeSeries ?? []) {
    const name = series.resource?.labels?.service_name;
    if (name === undefined) continue;
    const peak = Math.max(...(series.points ?? []).map((point) => (
      point.value?.doubleValue ?? Number(point.value?.int64Value ?? 0)
    )), 0);
    counts.set(name, Math.max(counts.get(name) ?? 0, peak));
  }
  return counts;
}

async function status(token: string): Promise<void> {
  const counts = await instanceCounts(token);
  console.log('SERVICE                          MIN  RUNNING (peak, last 10 min)');
  for (const name of WATCHED) {
    const service = await readService(token, name);
    const scaling = (service as { template?: { scaling?: { minInstanceCount?: number } } }).template?.scaling;
    const running = counts.get(name) ?? 0;
    console.log(`${name.padEnd(32)} ${String(scaling?.minInstanceCount ?? 0).padEnd(4)} ${running}`);
  }
  console.log('');
  console.log(counts.get(COORDINATOR)
    ? 'The staging home is UP and billing. Run `down` when the session is over.'
    : 'The staging home is DOWN. A sign-in will show "Waiting for a live home".');
}

async function setMinimum(token: string, minimum: number, apply: boolean): Promise<void> {
  const service = await readService(token, COORDINATOR);
  const template = (service as { template?: Record<string, unknown> }).template;
  if (template === undefined) throw new Error('the coordinator has no template to patch');

  const current = (template.scaling as { minInstanceCount?: number } | undefined)?.minInstanceCount ?? 0;
  if (current === minimum) {
    console.log(`${COORDINATOR} is already at minInstanceCount=${minimum}; nothing to do.`);
    return;
  }

  // Only the template is sent, and only its scaling minimum differs, so traffic,
  // ingress and IAM are untouched by construction rather than by care.
  const body = {
    template: { ...template, scaling: { ...(template.scaling as object ?? {}), minInstanceCount: minimum } },
  };

  console.log(`PATCH ${serviceUrl(COORDINATOR)}`);
  console.log(`  template.scaling.minInstanceCount: ${current} -> ${minimum}`);
  console.log(`  reverse with: bun scripts/staging-home.ts ${minimum === 0 ? 'up' : 'down'} --apply`);

  if (!apply) {
    console.log('\nDry run. Nothing was changed. Pass --apply to send it.');
    return;
  }

  const response = await fetch(serviceUrl(COORDINATOR), {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-goog-user-project': PROJECT,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`patch failed: HTTP ${response.status} ${(await response.text()).slice(0, 400)}`);
  }
  console.log(`\nApplied. ${COORDINATOR} minInstanceCount is now ${minimum}.`);
  if (minimum === 0) {
    console.log('The instance terminates shortly; relay-a scales to zero once its socket closes.');
  }
}

const command = process.argv[2] as Command | undefined;
const apply = process.argv.includes('--apply');
if (command !== 'status' && command !== 'up' && command !== 'down') usage();

const token = await accessToken();

if (command === 'status') {
  await status(token);
} else if (command === 'down') {
  await setMinimum(token, 0, apply);
} else {
  if (process.env.MIAKAPP_STAGING_HOME_CONFIRMATION !== UP_CONFIRMATION) {
    console.error(`Set MIAKAPP_STAGING_HOME_CONFIRMATION=${UP_CONFIRMATION} to start the staging home.`);
    console.error('It bills two Cloud Run instances continuously until `down` is run.');
    process.exit(1);
  }
  await setMinimum(token, 1, apply);
}
