locals {
  profile     = jsondecode(file("${path.module}/profile.json"))
  relay_image = local.profile.image.digest_reference

  terraform_source_files = [
    ".terraform.lock.hcl",
    "foundation.tf",
    "locals.tf",
    "main.tf",
    "outputs.tf",
    "providers.tf",
    "terraform-cli.tfrc",
    "variables.tf",
    "versions.tf",
  ]
  terraform_source_sha256 = sha256(jsonencode({
    for name in local.terraform_source_files : name => filesha256("${path.module}/${name}")
  }))

  enabled = var.deployment_phase != "absent"
  public  = var.deployment_phase == "public_window"
  relays = {
    for relay in local.profile.services : relay.id => relay
  }
  active_relays = local.enabled ? local.relays : {}
  public_relays = local.public ? local.relays : {}

  bootstrap_audiences = tomap({
    for id, relay in local.relays : id => relay.bootstrap_audience
  })
  selected_audiences = var.deployment_phase == "private_bootstrap" ? local.bootstrap_audiences : var.relay_audiences
  ready_audiences = alltrue([
    for id, relay in local.relays : can(regex(relay.audience_pattern, var.relay_audiences[id]))
  ]) && var.relay_audiences["relay-a"] != var.relay_audiences["relay-b"]

  common_environment = {
    MIAKAPP_ALLOWED_ORIGINS                = local.profile.application.allowed_origin
    MIAKAPP_CONNECTION_ATTEMPTS_PER_MINUTE = tostring(local.profile.admission.connection_attempts_per_minute_per_immediate_peer)
    MIAKAPP_CONTROL_PLANE_ISSUER           = local.profile.control_plane.issuer
    MIAKAPP_CONTROL_PLANE_JWKS_URL         = local.profile.control_plane.jwks_url
    MIAKAPP_DECLARATION_TIMEOUT            = local.profile.relay_runtime.declaration_timeout
    MIAKAPP_DISCONNECT_GRACE               = local.profile.relay_runtime.disconnect_grace
    MIAKAPP_HANDSHAKE_TIMEOUT              = local.profile.relay_runtime.handshake_timeout
    MIAKAPP_LISTEN_ADDRESS                 = ":${local.profile.cloud_run.port}"
    MIAKAPP_MAX_AGGREGATE_QUEUED_BYTES     = tostring(local.profile.admission.maximum_aggregate_queued_bytes)
    MIAKAPP_MAX_CONNECTIONS                = tostring(local.profile.admission.maximum_connections)
    MIAKAPP_MAX_CONNECTIONS_PER_IP         = tostring(local.profile.admission.maximum_connections_per_immediate_peer)
    MIAKAPP_MAX_HOMES                      = tostring(local.profile.admission.maximum_homes)
    MIAKAPP_MAX_QUEUED_BYTES               = tostring(local.profile.admission.maximum_queued_bytes_per_connection)
    MIAKAPP_MAX_TRACKED_IPS                = tostring(local.profile.admission.maximum_tracked_immediate_peers)
    MIAKAPP_PING_INTERVAL                  = local.profile.relay_runtime.ping_interval
    MIAKAPP_PONG_TIMEOUT                   = local.profile.relay_runtime.pong_timeout
    MIAKAPP_SHUTDOWN_TIMEOUT               = local.profile.relay_runtime.shutdown_timeout
    MIAKAPP_WRITE_TIMEOUT                  = local.profile.relay_runtime.write_timeout
  }

  labels = {
    component   = "browser-relay"
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
  }
}
