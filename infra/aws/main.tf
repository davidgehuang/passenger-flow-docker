data "aws_availability_zones" "available" { state = "available" }
data "aws_ami" "rocky" {
  owners = [var.rocky_ami_owner]
  filter {
    name   = "image-id"
    values = [var.rocky_ami_id]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
data "aws_rds_orderable_db_instance" "selected" {
  engine                     = "mysql"
  engine_version             = var.mysql_version
  preferred_instance_classes = [var.db_instance_class]
  storage_type               = "gp3"
}
resource "aws_vpc" "lab" {
  cidr_block           = "10.60.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.project }
}
resource "aws_internet_gateway" "lab" { vpc_id = aws_vpc.lab.id }
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.lab.id
  cidr_block        = cidrsubnet(aws_vpc.lab.cidr_block, 8, count.index + 1)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project}-public-${count.index}" }
}
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.lab.id
  cidr_block        = cidrsubnet(aws_vpc.lab.cidr_block, 8, count.index + 11)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project}-private-${count.index}" }
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.lab.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.lab.id
  }
}
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_security_group" "app" {
  name_prefix = "${var.project}-app-"
  vpc_id      = aws_vpc.lab.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "primary" {
  name_prefix = "${var.project}-primary-"
  vpc_id      = aws_vpc.lab.id
  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "replica" {
  name_prefix = "${var.project}-replica-"
  vpc_id      = aws_vpc.lab.id
  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  dynamic "ingress" {
    for_each = var.dts_source_cidrs
    content {
      from_port   = 3306
      to_port     = 3306
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_db_subnet_group" "primary" {
  name       = "${var.project}-private"
  subnet_ids = aws_subnet.private[*].id
}
resource "aws_db_subnet_group" "replica" {
  name       = "${var.project}-public-replica"
  subnet_ids = aws_subnet.public[*].id
}
resource "aws_db_parameter_group" "mysql" {
  name_prefix = "${var.project}-mysql84-"
  family      = "mysql8.4"
  parameter {
    name  = "binlog_format"
    value = "ROW"
  }
  parameter {
    name  = "binlog_row_image"
    value = "FULL"
  }
  parameter {
    name         = "gtid_mode"
    value        = "ON"
    apply_method = "pending-reboot"
  }
  parameter {
    name         = "enforce_gtid_consistency"
    value        = "ON"
    apply_method = "pending-reboot"
  }
  parameter {
    name  = "require_secure_transport"
    value = "ON"
  }
  # log_replica_updates由RDS管理；SQL预检必须核验ON，不写不可修改的参数。
  lifecycle { create_before_destroy = true }
}
resource "aws_db_instance" "primary" {
  identifier                      = "${var.project}-primary"
  engine                          = "mysql"
  engine_version                  = var.mysql_version
  instance_class                  = var.db_instance_class
  allocated_storage               = 50
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  username                        = var.master_user
  password_wo                     = var.master_password
  password_wo_version             = var.password_version
  multi_az                        = false
  publicly_accessible             = false
  db_subnet_group_name            = aws_db_subnet_group.primary.name
  vpc_security_group_ids          = [aws_security_group.primary.id]
  parameter_group_name            = aws_db_parameter_group.mysql.name
  backup_retention_period         = 7
  backup_window                   = "18:00-19:00"
  maintenance_window              = "sun:19:00-sun:20:00"
  auto_minor_version_upgrade      = false
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.project}-primary-final"
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["error", "slowquery"]
  lifecycle {
    precondition {
      condition     = data.aws_rds_orderable_db_instance.selected.instance_class == var.db_instance_class
      error_message = "指定香港RDS规格不可售，禁止自动升配。"
    }
    precondition {
      condition     = can(regex("(?i)rocky.*9", data.aws_ami.rocky.name))
      error_message = "选定AMI名称未标识Rocky 9，需重新核验官方镜像。"
    }
  }
}
resource "aws_db_instance" "replica" {
  identifier                      = "${var.project}-replica"
  replicate_source_db             = aws_db_instance.primary.arn
  instance_class                  = var.db_instance_class
  storage_type                    = "gp3"
  max_allocated_storage           = 100
  publicly_accessible             = true
  multi_az                        = false
  db_subnet_group_name            = aws_db_subnet_group.replica.name
  vpc_security_group_ids          = [aws_security_group.replica.id]
  parameter_group_name            = aws_db_parameter_group.mysql.name
  backup_retention_period         = 7
  auto_minor_version_upgrade      = false
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.project}-replica-final"
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["error", "slowquery"]
  depends_on                      = [aws_route_table_association.public]
}
resource "aws_ecr_repository" "app" {
  name                 = var.project
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_iam_role" "app" {
  name_prefix = "${var.project}-ec2-"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "ecr" {
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = aws_ecr_repository.app.arn
      }
    ]
  })
}
resource "aws_iam_instance_profile" "app" { role = aws_iam_role.app.name }
resource "aws_instance" "app" {
  ami                         = data.aws_ami.rocky.id
  instance_type               = var.app_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  user_data                   = file("${path.module}/cloud-init.sh")
  user_data_replace_on_change = false
  metadata_options { http_tokens = "required" }
  root_block_device {
    volume_size = 40
    volume_type = "gp3"
    encrypted   = true
  }
  tags = { Name = "${var.project}-app" }
}
resource "aws_eip" "app" {
  domain     = "vpc"
  instance   = aws_instance.app.id
  depends_on = [aws_internet_gateway.lab]
}
resource "aws_sns_topic" "alarms" { name = "${var.project}-alarms" }
resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}
locals {
  metrics = {
    primary_cpu   = { id = aws_db_instance.primary.id, name = "CPUUtilization", threshold = 80, op = "GreaterThanThreshold" }
    replica_cpu   = { id = aws_db_instance.replica.id, name = "CPUUtilization", threshold = 80, op = "GreaterThanThreshold" }
    replica_lag   = { id = aws_db_instance.replica.id, name = "ReplicaLag", threshold = 60, op = "GreaterThanThreshold" }
    primary_space = { id = aws_db_instance.primary.id, name = "FreeStorageSpace", threshold = 10737418240, op = "LessThanThreshold" }
    replica_space = { id = aws_db_instance.replica.id, name = "FreeStorageSpace", threshold = 10737418240, op = "LessThanThreshold" }
  }
}
resource "aws_cloudwatch_metric_alarm" "db" {
  for_each            = local.metrics
  alarm_name          = "${var.project}-${each.key}"
  namespace           = "AWS/RDS"
  metric_name         = each.value.name
  dimensions          = { DBInstanceIdentifier = each.value.id }
  comparison_operator = each.value.op
  threshold           = each.value.threshold
  period              = 60
  evaluation_periods  = 5
  statistic           = "Average"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
output "deployment" {
  value = {
    platform     = "AWS", region = "ap-east-1", app_ip = aws_eip.app.public_ip,
    instance_id  = aws_instance.app.id, db_host = aws_db_instance.primary.address,
    replica_host = aws_db_instance.replica.address, db_port = 3306,
    db_name      = var.database_name, master_user = var.master_user,
    repository   = aws_ecr_repository.app.repository_url, os = "Rocky Linux 9"
  }
}
