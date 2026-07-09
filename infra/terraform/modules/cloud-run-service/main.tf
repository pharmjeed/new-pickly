variable "name" { type = string }
variable "region" { type = string }
variable "image" { type = string }
variable "service_account_email" { type = string }
variable "vpc_connector" { type = string }
variable "port" { type = number }
variable "min_instances" { type = number }
variable "max_instances" { type = number }
variable "env" { type = map(string) }
variable "secret_env" { type = map(string) }
variable "allow_public" { type = bool }

resource "google_cloud_run_v2_service" "svc" {
  name     = var.name
  location = var.region

  template {
    service_account = var.service_account_email
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
    vpc_access {
      connector = var.vpc_connector
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.image
      ports { container_port = var.port }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  # Rollback: المراجعات محفوظة — gcloud run services update-traffic --to-revisions
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_public ? 1 : 0
  name     = google_cloud_run_v2_service.svc.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "url" {
  value = google_cloud_run_v2_service.svc.uri
}
