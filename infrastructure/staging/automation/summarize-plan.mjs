const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_CHANGES = 256;
const TERRAFORM_ACTIONS = new Set(['no-op', 'read', 'create', 'update', 'delete', 'forget']);

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('Terraform plan JSON exceeds the review summary limit');
  }
}

const plan = JSON.parse(input);
if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
  throw new Error('Terraform plan must be a JSON object');
}
const changes = plan.resource_changes;
if (!Array.isArray(changes) || changes.length > MAX_CHANGES) {
  throw new Error('Terraform plan has an invalid resource-change collection');
}

const counts = new Map();
const lines = [];
for (const change of changes) {
  if (change === null || typeof change !== 'object' || Array.isArray(change)) {
    throw new Error('Terraform resource change must be an object');
  }
  if (typeof change.address !== 'string' || !/^[A-Za-z0-9_.\[\]"-]{1,256}$/.test(change.address)) {
    throw new Error('Terraform resource address is invalid');
  }
  const actions = change.change?.actions;
  if (
    !Array.isArray(actions)
    || actions.length === 0
    || actions.length > 3
    || actions.some((action) => typeof action !== 'string' || !TERRAFORM_ACTIONS.has(action))
  ) {
    throw new Error('Terraform resource actions are invalid');
  }
  const label = actions.join('->');
  counts.set(label, (counts.get(label) ?? 0) + 1);
  if (label !== 'no-op' && label !== 'read') lines.push(`${label}: ${change.address}`);
}

console.log(`Terraform plan summary (${changes.length} resources)`);
for (const [label, count] of [...counts].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
  console.log(`${label}: ${count}`);
}
for (const line of lines.sort((left, right) => left.localeCompare(right, 'en'))) console.log(line);
