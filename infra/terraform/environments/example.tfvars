# انسخه إلى staging.tfvars / production.tfvars (خارج git) واملأ القيم — HUMAN-ACTIONS A2
project_id  = "pickly-staging"
region      = "me-central2"
environment = "staging"
image_tag   = "latest"
# db_password يُمرر عبر TF_VAR_db_password أو -var — لا يُكتب هنا
web_base_url = "https://staging.pickly.sa"
alert_channels = []
