variable "billing_account_id" {
  description = "Approved existing billing account ID, supplied only during bootstrap planning."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the canonical XXXXXX-XXXXXX-XXXXXX form."
  }
}
