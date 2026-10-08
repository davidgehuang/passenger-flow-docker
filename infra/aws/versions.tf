terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.68.0" }
  }
  backend "s3" {}
}
provider "aws" {
  region = "ap-east-1"
  default_tags { tags = { Project = var.project, Environment = "migration-lab" } }
}
