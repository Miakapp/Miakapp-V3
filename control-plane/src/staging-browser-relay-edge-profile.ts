// This temporary identity pair is deliberately project-specific. It lets the
// reviewed staging browser matrix use provider endpoints without teaching the
// production parser to trust arbitrary run.app or web.app origins.
export const STAGING_BROWSER_RELAY_EDGE_PROFILE = Object.freeze({
  id: 'staging-browser-relay-acceptance',
  issuer: 'https://control-plane-aczhngqraq-od.a.run.app',
  allowedOrigin: 'https://miakapp-v4-staging.web.app',
} as const);
