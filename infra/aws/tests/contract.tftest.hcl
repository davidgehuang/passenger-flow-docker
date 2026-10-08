# 只使用Terraform mock provider，不访问云账号，不是香港售卖/授权验收。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-east-1a", "ap-east-1b"] }
  }
  mock_data "aws_ami" {
    defaults = { id = "ami-0123456789abcdef0", name = "Rocky-9-x86_64" }
  }
  mock_data "aws_rds_orderable_db_instance" {
    defaults = { instance_class = "db.t4g.medium" }
  }
  mock_resource "aws_db_instance" {
    defaults = { arn = "arn:aws:rds:ap-east-1:123456789012:db:mock-primary" }
  }
}
variables {
  rocky_ami_id    = "ami-0123456789abcdef0"
  rocky_ami_owner = "123456789012"
  mysql_version   = "8.4.11"
  master_password = "ValidationOnly_NotARealSecret123"
}
run "private_writer_and_closed_replica" {
  command = plan
  assert {
    condition     = !aws_db_instance.primary.publicly_accessible && !aws_db_instance.primary.multi_az && aws_db_instance.primary.backup_retention_period == 7
    error_message = "写主库必须私有、单实例并保留备份。"
  }
  assert {
    condition     = aws_db_instance.replica.publicly_accessible && aws_db_instance.replica.backup_retention_period == 7 && length(aws_security_group.replica.ingress) == 1
    error_message = "副本需开启备份；没有DTS来源时只能有APP安全组规则。"
  }
  assert {
    condition     = aws_instance.app.metadata_options[0].http_tokens == "required" && aws_db_instance.primary.deletion_protection && !aws_ecr_repository.app.force_delete
    error_message = "必须保留IMDSv2、删除保护与镜像删除保护。"
  }
}
run "reject_global_dts_access" {
  command = plan
  variables { dts_source_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.dts_source_cidrs]
}
