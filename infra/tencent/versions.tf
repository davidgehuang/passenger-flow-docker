terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    tencentcloud = { source = "tencentcloudstack/tencentcloud", version = "= 1.83.34" }
  }
  backend "s3" {}
}
provider "tencentcloud" { region = "ap-hongkong" }
