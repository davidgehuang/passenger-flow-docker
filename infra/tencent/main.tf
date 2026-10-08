variable "project" {
  type    = string
  default = "passenger-flow"
}
variable "zone" { type = string }
variable "rocky_image_id" { type = string }
variable "instance_type" {
  type        = string
  description = "售卖预检确认的2核4GB x86_64 CVM规格，不自动升配"
}
variable "ssh_key_ids" { type = set(string) }
variable "admin_cidrs" {
  type = set(string)
  validation {
    condition     = length(var.admin_cidrs) > 0 && alltrue([for c in var.admin_cidrs : can(cidrhost(c, 0)) && can(regex("^[0-9.]+/[0-9]+$", c)) && try(tonumber(split("/", c)[1]) >= 24, false)])
    error_message = "至少提供一个管理来源IPv4网段，前缀至少/24。"
  }
}
variable "root_password" {
  type      = string
  sensitive = true
}
variable "target_tls_verified" {
  type        = bool
  default     = false
  description = "仅在腾讯确认香港单节点MySQL8.4支持TLS、证书端点校验后设置true；默认阻止付费创建。"
}
variable "database_name" {
  type    = string
  default = "passenger_flow_codex"
}
variable "destroy_protect" {
  type    = string
  default = "on"
}
variable "dts_source_cidrs" {
  type    = set(string)
  default = []
  validation {
    condition     = alltrue([for c in var.dts_source_cidrs : can(cidrhost(c, 0)) && can(regex("^[0-9.]+/[0-9]+$", c)) && try(tonumber(split("/", c)[1]) >= 24, false)])
    error_message = "仅填写腾讯DTS实际内网来源，禁止全网开放。"
  }
}
data "tencentcloud_images" "rocky" {
  image_id   = var.rocky_image_id
  image_type = ["PUBLIC_IMAGE"]
}
data "tencentcloud_instance_types" "selected" {
  availability_zone = var.zone
  cpu_core_count    = 2
  memory_size       = 4
  exclude_sold_out  = true
}
resource "tencentcloud_vpc" "lab" {
  name       = var.project
  cidr_block = "10.70.0.0/16"
}
resource "tencentcloud_subnet" "lab" {
  name              = var.project
  vpc_id            = tencentcloud_vpc.lab.id
  availability_zone = var.zone
  cidr_block        = "10.70.1.0/24"
}
resource "tencentcloud_security_group" "app" { name = "${var.project}-app" }
resource "tencentcloud_security_group_rule_set" "app" {
  security_group_id = tencentcloud_security_group.app.id
  ingress {
    action     = "ACCEPT"
    cidr_block = "0.0.0.0/0"
    port       = "80,443"
    protocol   = "TCP"
  }
  dynamic "ingress" {
    for_each = var.admin_cidrs
    content {
      action     = "ACCEPT"
      cidr_block = ingress.value
      port       = "22"
      protocol   = "TCP"
    }
  }
  egress {
    action     = "ACCEPT"
    cidr_block = "0.0.0.0/0"
    port       = "ALL"
    protocol   = "ALL"
  }
}
resource "tencentcloud_security_group" "db" { name = "${var.project}-db" }
resource "tencentcloud_security_group_rule_set" "db" {
  security_group_id = tencentcloud_security_group.db.id
  ingress {
    action     = "ACCEPT"
    cidr_block = "${tencentcloud_instance.app.private_ip}/32"
    port       = "3306"
    protocol   = "TCP"
  }
  dynamic "ingress" {
    for_each = var.dts_source_cidrs
    content {
      action     = "ACCEPT"
      cidr_block = ingress.value
      port       = "3306"
      protocol   = "TCP"
    }
  }
  egress {
    action     = "ACCEPT"
    cidr_block = "0.0.0.0/0"
    port       = "ALL"
    protocol   = "ALL"
  }
}
resource "tencentcloud_instance" "app" {
  instance_name            = "${var.project}-app"
  availability_zone        = var.zone
  image_id                 = var.rocky_image_id
  instance_type            = var.instance_type
  instance_charge_type     = "POSTPAID_BY_HOUR"
  system_disk_type         = "CLOUD_PREMIUM"
  system_disk_size         = 40
  vpc_id                   = tencentcloud_vpc.lab.id
  subnet_id                = tencentcloud_subnet.lab.id
  security_groups          = [tencentcloud_security_group.app.id]
  key_ids                  = var.ssh_key_ids
  allocate_public_ip       = false
  disable_security_service = false
  disable_monitor_service  = false
  lifecycle {
    precondition {
      condition     = contains([for t in data.tencentcloud_instance_types.selected.instance_types : t.instance_type], var.instance_type)
      error_message = "指定香港CVM规格不是可售2核4GB，禁止自动替换。"
    }
    precondition {
      condition     = length(data.tencentcloud_images.rocky.images) == 1 && can(regex("(?i)rocky.*9", data.tencentcloud_images.rocky.images[0].image_name)) && data.tencentcloud_images.rocky.images[0].architecture == "x86_64"
      error_message = "镜像必须是预检确认的Rocky 9官方公共镜像。"
    }
  }
}
resource "tencentcloud_eip" "app" {
  name                       = "${var.project}-app"
  internet_charge_type       = "TRAFFIC_POSTPAID_BY_HOUR"
  internet_max_bandwidth_out = 5
}
resource "tencentcloud_eip_association" "app" {
  eip_id      = tencentcloud_eip.app.id
  instance_id = tencentcloud_instance.app.id
}
resource "tencentcloud_mysql_instance" "target" {
  instance_name     = "${var.project}-target"
  availability_zone = var.zone
  device_type       = "BASIC_V2"
  disk_type         = "CLOUD_SSD"
  engine_type       = "InnoDB"
  engine_version    = "8.4"
  charge_type       = "POSTPAID"
  cpu               = 2
  mem_size          = 4000
  volume_size       = 50
  root_password     = var.root_password
  vpc_id            = tencentcloud_vpc.lab.id
  subnet_id         = tencentcloud_subnet.lab.id
  security_groups   = [tencentcloud_security_group.db.id]
  internet_service  = 0
  intranet_port     = 3306
  slave_deploy_mode = 0
  destroy_protect   = var.destroy_protect
  force_delete      = false
  parameters        = { character_set_server = "utf8mb4" }
  lifecycle {
    precondition {
      condition     = var.target_tls_verified
      error_message = "当前官方功能表未确认单节点MySQL8.4支持SSL。先通过腾讯工单核验TLS及证书主机名；不能明文降级或自动升配。"
    }
  }
}
resource "tencentcloud_mysql_backup_policy" "target" {
  mysql_id              = tencentcloud_mysql_instance.target.id
  backup_model          = "snapshot"
  retention_period      = 7
  backup_time           = "02:00-06:00"
  binlog_period         = 7
  enable_binlog_standby = "off"
}
output "deployment" {
  value = {
    platform    = "TENCENT", region = "ap-hongkong", app_ip = tencentcloud_eip.app.public_ip,
    instance_id = tencentcloud_instance.app.id, db_host = tencentcloud_mysql_instance.target.intranet_ip,
    db_port     = tencentcloud_mysql_instance.target.intranet_port, db_name = var.database_name,
    master_user = "root", os = "Rocky Linux 9"
  }
}
