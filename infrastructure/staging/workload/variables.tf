variable "source_archive_path" {
  description = "Absolute path to the private deterministic control-plane ZIP."
  type        = string

  validation {
    condition     = can(filesha256(var.source_archive_path))
    error_message = "The source archive must be a readable local regular file."
  }
}

variable "source_archive_sha256" {
  description = "SHA-256 of the exact source archive selected by the private plan."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.source_archive_sha256))
    error_message = "The source archive SHA-256 must be canonical lowercase hexadecimal."
  }
}

variable "repository_commit" {
  description = "Exact reviewed origin/main commit from which the archive was built."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.repository_commit))
    error_message = "The repository commit must be a canonical full Git object ID."
  }
}

variable "operator_user_email" {
  description = "Private active Google user allowed to mint an ID token for the staging probe."
  type        = string
  sensitive   = true

  validation {
    condition = (
      var.operator_user_email == lower(trimspace(var.operator_user_email)) &&
      can(regex("^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\\.[a-z]{2,63}$", var.operator_user_email))
    )
    error_message = "The operator identity must be a canonical lowercase user email."
  }
}

variable "browser_relay_rotation_entry" {
  description = "Select the reviewed two-key runtime with signing version 1 current for the browser-relay rehearsal entry."
  type        = bool
  default     = false
}
