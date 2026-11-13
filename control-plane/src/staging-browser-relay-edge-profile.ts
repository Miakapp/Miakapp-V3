// This temporary identity pair is deliberately project-specific. It lets the
// reviewed staging browser matrix use provider endpoints without teaching the
// production parser to trust arbitrary run.app or web.app origins.
export const STAGING_BROWSER_RELAY_EDGE_PROFILE = Object.freeze({
  id: 'staging-browser-relay-acceptance',
  issuer: 'https://control-plane-aczhngqraq-od.a.run.app',
  allowedOrigin: 'https://miakapp-v4-staging.web.app',
} as const);

// Same staging project and browser origin, with the control plane self-hosted
// on the DAC Kubernetes cluster instead of Cloud Run (GCP compute billing is
// off for staging). Pinned exactly like the pair above.
export const STAGING_SELF_HOSTED_DAC_PROFILE = Object.freeze({
  id: 'staging-self-hosted-dac',
  issuer: 'https://miakapp-api.dac.cclabs.cx',
  allowedOrigin: 'https://miakapp-v4-staging.web.app',
} as const);

export const STAGING_EDGE_PROFILES = Object.freeze([
  STAGING_BROWSER_RELAY_EDGE_PROFILE,
  STAGING_SELF_HOSTED_DAC_PROFILE,
] as const);

export type StagingEdgeProfile = typeof STAGING_EDGE_PROFILES[number];

export function stagingEdgeProfileForIssuer(issuer: string): StagingEdgeProfile | undefined {
  return STAGING_EDGE_PROFILES.find((profile) => profile.issuer === issuer);
}
