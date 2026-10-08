variable "project" {
  type    = string
  default = "passenger-flow"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.project))
    error_message = "项目名使用小写字母、数字、横线，长度3–25。"
  }
}
variable "rocky_ami_id" {
  type = string
  validation {
    condition     = can(regex("^ami-[0-9a-f]+$", var.rocky_ami_id))
    error_message = "须填写预检确认的香港 Rocky 9 x86_64 AMI，不自动选择其他镜像。"
  }
}
variable "rocky_ami_owner" {
  type        = string
  description = "从 Rocky 官方 Marketplace 页面核对的12位发布者账户ID"
  validation {
    condition     = can(regex("^[0-9]{12}$", var.rocky_ami_owner))
    error_message = "必须指定可信发布者账户ID。"
  }
}
variable "mysql_version" {
  type = string
  validation {
    condition     = can(regex("^8\\.4\\.[0-9]+$", var.mysql_version))
    error_message = "填写香港可售的明确8.4补丁版本，不使用浮动版本。"
  }
}
variable "master_password" {
  type      = string
  sensitive = true
  ephemeral = true
  validation {
    condition     = length(var.master_password) >= 16 && length(var.master_password) <= 41 && !can(regex("[/@\"\\s]", var.master_password))
    error_message = "RDS管理员密码16–41位，不含空白、斜线、@或双引号。"
  }
}
variable "password_version" {
  type    = number
  default = 1
}
variable "master_user" {
  type    = string
  default = "pfadmin"
}
variable "app_instance_type" {
  type    = string
  default = "t3.medium"
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "dts_source_cidrs" {
  type    = set(string)
  default = []
  validation {
    condition     = alltrue([for c in var.dts_source_cidrs : can(cidrhost(c, 0)) && can(regex("^[0-9.]+/[0-9]+$", c)) && try(tonumber(split("/", c)[1]) >= 24, false)])
    error_message = "仅允许DTS官方来源网段，IPv4前缀至少/24；禁止0.0.0.0/0。"
  }
}
variable "database_name" {
  type    = string
  default = "passenger_flow_codex"
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "alarm_email" {
  type    = string
  default = ""
}
