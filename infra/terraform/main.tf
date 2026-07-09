# Pickly — بنية GCP (docs/09§2: Cloud Run · Cloud SQL · Memorystore · Storage ·
# Secret Manager · Cloud Armor · Monitoring) بقابلية نقل (Docker/Postgres/Redis قياسية).
# التفعيل: HUMAN-ACTIONS A2 (مشروع + فوترة + Service Account) ثم:
#   terraform init && terraform apply -var-file=environments/staging.tfvars

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  # بعد إنشاء المشروع: أنشئ bucket للحالة وفعّل هذا البلوك
  # backend "gcs" { bucket = "pickly-terraform-state" prefix = "env" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  services = ["run.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com",
    "secretmanager.googleapis.com", "compute.googleapis.com", "vpcaccess.googleapis.com",
    "monitoring.googleapis.com", "artifactregistry.googleapis.com", "cloudscheduler.googleapis.com"]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

# ===== Artifact Registry =====
resource "google_artifact_registry_repository" "pickly" {
  location      = var.region
  repository_id = "pickly"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

# ===== الشبكة (اتصال خاص لـSQL/Redis) =====
resource "google_compute_network" "vpc" {
  name                    = "pickly-vpc-${var.environment}"
  auto_create_subnetworks = true
}

resource "google_vpc_access_connector" "connector" {
  name          = "pickly-conn-${var.environment}"
  network       = google_compute_network.vpc.name
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  depends_on    = [google_project_service.apis]
}

# ===== Cloud SQL (PostgreSQL + PostGIS) =====
resource "google_sql_database_instance" "postgres" {
  name             = "pickly-pg-${var.environment}"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier = var.db_tier
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00" # نسخ يومي — خطة الاستعادة في RUNBOOK.md
      backup_retention_settings { retained_backups = 14 }
    }
    maintenance_window {
      day  = 2 # الاثنين فجراً
      hour = 3
    }
  }
  deletion_protection = var.environment == "production"
}

resource "google_sql_database" "pickly" {
  name     = "pickly"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = "pickly"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password # من Secret — لا يُكتب في tfvars الملتزم
}

# ===== Memorystore (Redis) =====
resource "google_redis_instance" "redis" {
  name               = "pickly-redis-${var.environment}"
  tier               = var.environment == "production" ? "STANDARD_HA" : "BASIC"
  memory_size_gb     = 1
  region             = var.region
  authorized_network = google_compute_network.vpc.id
  depends_on         = [google_project_service.apis]
}

# ===== Storage (صور المنتجات والوثائق — S3-compatible عبر GCS) =====
resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  cors {
    origin          = [var.web_base_url]
    method          = ["GET", "PUT"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

# ===== Secret Manager — الأسرار حصراً هنا (docs/09§6-6) =====
locals {
  secrets = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "PAYMENT_API_KEY",
    "PAYMENT_WEBHOOK_SECRET", "SMS_API_KEY", "FCM_SERVICE_ACCOUNT_JSON", "ROUTES_API_KEY"]
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secrets)
  secret_id = "pickly-${var.environment}-${each.value}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# ===== حساب خدمة التشغيل =====
resource "google_service_account" "runtime" {
  account_id   = "pickly-runtime-${var.environment}"
  display_name = "Pickly runtime (${var.environment})"
}

resource "google_project_iam_member" "runtime_roles" {
  for_each = toset(["roles/cloudsql.client", "roles/secretmanager.secretAccessor",
    "roles/storage.objectAdmin", "roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# ===== Cloud Run =====
module "run_api" {
  source                = "./modules/cloud-run-service"
  name                  = "pickly-api-${var.environment}"
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/pickly/api:${var.image_tag}"
  service_account_email = google_service_account.runtime.email
  vpc_connector         = google_vpc_access_connector.connector.id
  port                  = 4000
  min_instances         = var.environment == "production" ? 1 : 0
  max_instances         = 20 # التوسع الأفقي — هدف الحمل docs/20
  env                   = { NODE_ENV = "production", API_PORT = "4000" }
  secret_env            = { for s in local.secrets : s => google_secret_manager_secret.secrets[s].secret_id }
  allow_public          = true
}

module "run_worker" {
  source                = "./modules/cloud-run-service"
  name                  = "pickly-worker-${var.environment}"
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/pickly/worker:${var.image_tag}"
  service_account_email = google_service_account.runtime.email
  vpc_connector         = google_vpc_access_connector.connector.id
  port                  = 8080
  min_instances         = 1 # يعالج outbox والمؤقتات دائماً
  max_instances         = 3
  env                   = { NODE_ENV = "production" }
  secret_env            = { for s in local.secrets : s => google_secret_manager_secret.secrets[s].secret_id }
  allow_public          = false
}

# ===== Cloud Armor (أمام الـLB — يُربط عند إضافة HTTPS LB والدومين A3) =====
resource "google_compute_security_policy" "armor" {
  name = "pickly-armor-${var.environment}"
  rule {
    action   = "rate_based_ban"
    priority = 100
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      rate_limit_threshold {
        count        = 300
        interval_sec = 60
      }
    }
  }
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
  }
}

# ===== المراقبة والتنبيهات =====
resource "google_monitoring_alert_policy" "api_errors" {
  display_name = "Pickly API 5xx (${var.environment})"
  combiner     = "OR"
  conditions {
    display_name = "5xx rate"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"pickly-api-${var.environment}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = var.alert_channels
}

resource "google_monitoring_alert_policy" "db_cpu" {
  display_name = "Pickly DB CPU (${var.environment})"
  combiner     = "OR"
  conditions {
    display_name = "cpu > 80%"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = var.alert_channels
}

output "api_url" {
  value = module.run_api.url
}
output "db_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}
output "redis_host" {
  value = google_redis_instance.redis.host
}
