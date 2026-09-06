variable "deployment_phase" {
  description = "Exact lifecycle phase for the two ephemeral staging relay services."
  type        = string

  validation {
    condition = contains([
      "absent",
      "private_bootstrap",
      "private_ready",
      "public_window",
    ], var.deployment_phase)
    error_message = "The relay deployment phase is not part of the reviewed state machine."
  }
}

variable "relay_audiences" {
  description = "Exact WSS audiences observed from the two Cloud Run services after private bootstrap."
  type        = map(string)

  validation {
    condition = (
      length(var.relay_audiences) == 2 &&
      contains(keys(var.relay_audiences), "relay-a") &&
      contains(keys(var.relay_audiences), "relay-b") &&
      alltrue([
        for audience in values(var.relay_audiences) :
        can(regex("^wss://[a-z0-9.-]+/ws$", audience))
      ])
    )
    error_message = "Relay audiences must contain only relay-a and relay-b canonical WSS endpoints."
  }
}
