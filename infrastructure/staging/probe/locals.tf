locals {
  project_id        = "miakapp-v4-staging"
  project_number    = "1072737219170"
  region            = "europe-west9"
  state_bucket_name = "miakapp-v4-staging-tfstate-1072737219170"
  workload_prefix   = "terraform/workload"

  workflow_name         = "miakapp-private-probe"
  probe_service_account = "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
  function_name         = "control-plane"
  function_uri          = "https://control-plane-aczhngqraq-od.a.run.app"
  discovery_path        = "/.well-known/miakapp-control-plane"

  expected_workload_source_sha256 = "d2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4"
  expected_workload_commit        = "3f5a94dfcdfc0984487a558d966bbeaa769b18eb"

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
    purpose     = "private-probe"
  }

  workflow_source = <<-YAML
    main:
      steps:
        - invoke:
            call: http.get
            args:
              url: ${local.function_uri}${local.discovery_path}
              timeout: 30
              headers:
                Accept: application/json
              auth:
                type: OIDC
                audience: ${local.function_uri}
            result: response
        - result:
            return:
              code: $${response.code}
              headers: $${response.headers}
              body: $${response.body}
  YAML
}
