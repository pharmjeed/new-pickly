variable "project_id" {
  type        = string
  description = "معرف مشروع GCP (HUMAN-ACTIONS A2)"
}

variable "region" {
  type    = string
  default = "me-central2" # الدمام — الأقرب للسعودية
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment: staging أو production فقط."
  }
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "db_tier" {
  type    = string
  default = "db-custom-1-3840" # يرتفع مع الحمل — التوسع الأفقي في Cloud Run
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "web_base_url" {
  type    = string
  default = "https://pickly.sa"
}

variable "alert_channels" {
  type        = list(string)
  default     = []
  description = "قنوات تنبيه Monitoring (تُنشأ يدوياً وتُمرر ids)"
}
