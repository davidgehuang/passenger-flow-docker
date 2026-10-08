# mock计划只校验配置行为，不证明单节点MySQL8.4实际支持SSL。
mock_provider "tencentcloud" {
  mock_data "tencentcloud_images" {
    defaults = { images = [{ image_id = "img-mock", image_name = "Rocky Linux 9", architecture = "x86_64" }] }
  }
  mock_data "tencentcloud_instance_types" {
    defaults = { instance_types = [{ instance_type = "MOCK2.MEDIUM4" }] }
  }
}
variables {
  zone           = "ap-hongkong-1"
  rocky_image_id = "img-mock"
  instance_type  = "MOCK2.MEDIUM4"
  ssh_key_ids    = ["skey-mock"]
  admin_cidrs    = ["192.0.2.1/32"]
  root_password  = "ValidationOnly_NeverDeploy123!"
}
run "block_unconfirmed_tls" {
  command         = plan
  expect_failures = [tencentcloud_mysql_instance.target]
}
run "confirmed_contract" {
  command = plan
  variables { target_tls_verified = true }
  assert {
    condition     = tencentcloud_mysql_instance.target.internet_service == 0 && tencentcloud_mysql_instance.target.destroy_protect == "on" && !tencentcloud_mysql_instance.target.force_delete
    error_message = "目标库必须私网并保留删除保护。"
  }
  assert {
    condition     = tencentcloud_mysql_backup_policy.target.backup_model == "snapshot" && tencentcloud_mysql_backup_policy.target.retention_period == 7
    error_message = "单节点使用快照备份并保留7天。"
  }
}
