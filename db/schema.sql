-- ==============================================================
-- Passenger Flow Management System V2
-- Database Schema for MySQL 8.0 / MySQL 5.7 / MariaDB 10.3+
--
-- 约定：
--   * 全部表 ENGINE=InnoDB, CHARSET=utf8mb4, COLLATE=utf8mb4_unicode_ci
--     （unicode_ci 在 MariaDB 10.3 与 MySQL 8.0 均可用；不使用 MySQL 8 专有的 0900_ai_ci）
--   * 全部表有主键（DTS 增量迁移依赖）
--   * 不使用外键 / 触发器 / 存储过程 / Event Scheduler / MyISAM / 分区
--   * store_id / device_id 仅建索引，由应用层保证逻辑关联
-- ==============================================================

CREATE DATABASE IF NOT EXISTS passenger_flow_codex
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE passenger_flow_codex;

-- --------------------------------------------------------------
-- 1. 门店表
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  store_id      BIGINT       NOT NULL AUTO_INCREMENT,
  store_code    VARCHAR(64)  NOT NULL,
  store_name    VARCHAR(128) NOT NULL,
  region        VARCHAR(64)  NOT NULL DEFAULT '',
  city          VARCHAR(64)  NOT NULL DEFAULT '',
  address       VARCHAR(255) NOT NULL DEFAULT '',
  business_type VARCHAR(64)  NOT NULL DEFAULT '',
  opening_date  DATE         NULL,
  status        VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (store_id),
  UNIQUE KEY uk_stores_code (store_code),
  KEY idx_stores_city (city),
  KEY idx_stores_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 2. 客流设备表
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  device_id        BIGINT       NOT NULL AUTO_INCREMENT,
  device_code      VARCHAR(64)  NOT NULL,
  store_id         BIGINT       NOT NULL,
  device_name      VARCHAR(128) NOT NULL,
  device_type      VARCHAR(64)  NOT NULL DEFAULT 'CAMERA',
  ip_address       VARCHAR(64)  NOT NULL DEFAULT '',
  firmware_version VARCHAR(64)  NOT NULL DEFAULT '',
  install_date     DATE         NULL,
  last_online_time DATETIME(6)  NULL,
  status           VARCHAR(32)  NOT NULL DEFAULT 'ONLINE',
  created_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (device_id),
  UNIQUE KEY uk_devices_code (device_code),
  KEY idx_devices_store (store_id),
  KEY idx_devices_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 3. 客流事件表（核心业务表）
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flow_events (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  store_id     BIGINT       NOT NULL,
  device_id    BIGINT       NOT NULL,
  event_time   DATETIME(6)  NOT NULL,
  direction    VARCHAR(8)   NOT NULL,
  people_count INT          NOT NULL DEFAULT 1,
  confidence   DECIMAL(5,2) NOT NULL DEFAULT 99.00,
  sensor_type  VARCHAR(32)  NOT NULL DEFAULT 'CAMERA',
  trace_id     VARCHAR(64)  NOT NULL DEFAULT '',
  metadata     JSON         NULL,
  created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_flow_event_time (event_time),
  KEY idx_flow_store_time (store_id, event_time),
  KEY idx_flow_device_time (device_id, event_time),
  KEY idx_flow_trace_id (trace_id),
  KEY idx_flow_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 4. 小时客流统计表
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flow_hourly (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  store_id   BIGINT      NOT NULL,
  stat_date  DATE        NOT NULL,
  stat_hour  TINYINT     NOT NULL,
  in_count   BIGINT      NOT NULL DEFAULT 0,
  out_count  BIGINT      NOT NULL DEFAULT 0,
  peak_count BIGINT      NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_flow_hourly (store_id, stat_date, stat_hour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 5. 设备状态日志表
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_status_logs (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  device_id       BIGINT       NOT NULL,
  log_time        DATETIME(6)  NOT NULL,
  cpu_usage       DECIMAL(5,2) NOT NULL DEFAULT 0,
  memory_usage    DECIMAL(5,2) NOT NULL DEFAULT 0,
  network_latency DECIMAL(8,2) NOT NULL DEFAULT 0,
  temperature     DECIMAL(5,2) NOT NULL DEFAULT 0,
  status          VARCHAR(32)  NOT NULL DEFAULT 'NORMAL',
  message         VARCHAR(255) NOT NULL DEFAULT '',
  metadata        JSON         NULL,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_dsl_device (device_id),
  KEY idx_dsl_log_time (log_time),
  KEY idx_dsl_device_time (device_id, log_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 6. 迁移标记表（Migration Marker）
--    sequence_number 单调递增，用于验证 DTS CDC 同步顺序
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_markers (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  sequence_number BIGINT       NOT NULL,
  marker_uuid     VARCHAR(64)  NOT NULL,
  batch_uuid      VARCHAR(64)  NOT NULL DEFAULT '',
  source_env      VARCHAR(32)  NOT NULL DEFAULT '',
  marker_type     VARCHAR(64)  NOT NULL,
  operation_type  VARCHAR(32)  NOT NULL DEFAULT '',
  row_reference   BIGINT       NULL,
  message         VARCHAR(255) NOT NULL DEFAULT '',
  checksum        VARCHAR(128) NULL,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_marker_seq (sequence_number),
  UNIQUE KEY uk_marker_uuid (marker_uuid),
  KEY idx_marker_type (marker_type),
  KEY idx_marker_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 7. 迁移批次表（Migration Batch）
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_batches (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  batch_uuid     VARCHAR(64)   NOT NULL,
  batch_name     VARCHAR(128)  NOT NULL DEFAULT '',
  operation_type VARCHAR(32)   NOT NULL,
  source_env     VARCHAR(32)   NOT NULL DEFAULT '',
  target_rows    BIGINT        NOT NULL DEFAULT 0,
  affected_rows  BIGINT        NOT NULL DEFAULT 0,
  target_size_mb DECIMAL(12,2) NOT NULL DEFAULT 0,
  status         VARCHAR(32)   NOT NULL DEFAULT 'RUNNING',
  started_at     DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at   DATETIME(6)   NULL,
  notes          VARCHAR(500)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uk_batch_uuid (batch_uuid),
  KEY idx_batch_op (operation_type),
  KEY idx_batch_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 8. 迁移操作审计表（样本级 INSERT / UPDATE / DELETE 记录）
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_operation_audit (
  id                  BIGINT      NOT NULL AUTO_INCREMENT,
  batch_uuid          VARCHAR(64) NOT NULL,
  operation_type      VARCHAR(32) NOT NULL,
  table_name          VARCHAR(64) NOT NULL,
  record_id           BIGINT      NOT NULL DEFAULT 0,
  record_uuid         VARCHAR(64) NOT NULL DEFAULT '',
  before_value        JSON        NULL,
  after_value         JSON        NULL,
  operation_time      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  source_env          VARCHAR(32) NOT NULL DEFAULT '',
  verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  PRIMARY KEY (id),
  KEY idx_audit_batch (batch_uuid),
  KEY idx_audit_op (operation_type),
  KEY idx_audit_record (record_id),
  KEY idx_audit_time (operation_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================
-- 基础种子数据（少量门店与设备，可重复执行）
-- ==============================================================
INSERT INTO stores (store_code, store_name, region, city, address, business_type, opening_date, status) VALUES
  ('ST-0001', '北京国贸旗舰店', '华北', '北京', '北京市朝阳区建国门外大街1号', '旗舰超市', '2021-06-18', 'ACTIVE'),
  ('ST-0002', '上海陆家嘴店',   '华东', '上海', '上海市浦东新区陆家嘴环路1000号', '精品超市', '2021-09-01', 'ACTIVE'),
  ('ST-0003', '广州天河城店',   '华南', '广州', '广州市天河区天河路208号', '标准超市', '2022-01-15', 'ACTIVE'),
  ('ST-0004', '深圳南山科技园店', '华南', '深圳', '深圳市南山区科苑路15号', '标准超市', '2022-03-20', 'ACTIVE'),
  ('ST-0005', '成都春熙路店',   '西南', '成都', '成都市锦江区春熙路8号', '社区超市', '2022-05-08', 'MAINTENANCE')
ON DUPLICATE KEY UPDATE store_name = VALUES(store_name);

INSERT INTO devices (device_code, store_id, device_name, device_type, ip_address, firmware_version, install_date, last_online_time, status) VALUES
  ('DV-0001', 1, '国贸店-入口摄像头-01', 'ENTRANCE_CAMERA', '10.20.1.11', 'v2.4.1', '2021-06-20', NOW(6), 'ONLINE'),
  ('DV-0002', 1, '国贸店-出口摄像头-01', 'EXIT_CAMERA',     '10.20.1.12', 'v2.4.1', '2021-06-20', NOW(6), 'ONLINE'),
  ('DV-0003', 2, '陆家嘴店-入口摄像头-01', 'ENTRANCE_CAMERA', '10.20.2.11', 'v2.3.8', '2021-09-05', NOW(6), 'ONLINE'),
  ('DV-0004', 2, '陆家嘴店-客流传感器-01', 'FLOW_SENSOR',    '10.20.2.13', 'v1.9.0', '2021-09-05', NOW(6), 'WARNING'),
  ('DV-0005', 3, '天河城店-入口摄像头-01', 'ENTRANCE_CAMERA', '10.20.3.11', 'v2.4.1', '2022-01-20', NOW(6), 'ONLINE'),
  ('DV-0006', 3, '天河城店-出口摄像头-01', 'EXIT_CAMERA',     '10.20.3.12', 'v2.4.1', '2022-01-20', DATE_SUB(NOW(6), INTERVAL 3 HOUR), 'OFFLINE'),
  ('DV-0007', 4, '南山店-入口摄像头-01', 'ENTRANCE_CAMERA',  '10.20.4.11', 'v2.5.0', '2022-03-25', NOW(6), 'ONLINE'),
  ('DV-0008', 4, '南山店-出口摄像头-01', 'EXIT_CAMERA',      '10.20.4.12', 'v2.5.0', '2022-03-25', NOW(6), 'ONLINE'),
  ('DV-0009', 5, '春熙路店-入口摄像头-01', 'ENTRANCE_CAMERA', '10.20.5.11', 'v2.2.6', '2022-05-10', DATE_SUB(NOW(6), INTERVAL 30 DAY), 'MAINTENANCE'),
  ('DV-0010', 5, '春熙路店-客流传感器-01', 'FLOW_SENSOR',     '10.20.5.13', 'v1.8.2', '2022-05-10', DATE_SUB(NOW(6), INTERVAL 30 DAY), 'MAINTENANCE')
ON DUPLICATE KEY UPDATE device_name = VALUES(device_name);
