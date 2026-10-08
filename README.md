# Passenger Flow 容器化实验版

## AWS 香港＋Rocky Linux 9 新入口

新增 EC2 Docker APP＋RDS写主库／只读副本的Terraform及Rocky9部署工具，保留本地Docker入口与TKE文件。

- [完整操作手册：配置、首次登录、HTTPS、DTS及回退](docs/Rocky9-AWS与腾讯云迁移操作手册.md)
- [本轮验证报告与未验证边界](docs/Rocky9云部署验证报告.md)
- [Terraform目录说明](infra/README.md)

项目根目录运行 `.\cloud-tools.bat -Action Validate` 只验证配置。真实云资源由你审核计划后创建；本轮未创建、推送或提交。按已确认选择，优先AWS；腾讯单节点MySQL8.4的TLS能力待官方确认，默认阻止目标库创建。

这是从 passenger-flow-system-codex 提取的独立目录，基线提交为 597ba3584e064fbb75e9a5d276902ff02232dcd4。原目录、原数据库和原 Rocky/systemd 部署均未改动。

本目录面向本机 Docker Compose 与腾讯云 TKE Phase 1：一个可重复构建的 Node.js 镜像、两副本 Deployment、私网 TencentDB、TCR、认证保护的 Prometheus 指标和手动发布工作流。默认数据库名继续使用 passenger_flow_codex。它仍是客流管理与迁移实验系统，不声称已接入真实摄像头。

## Windows 首次启动与登录

已安装 Docker Desktop 并切换到 Linux containers 即可；日常运行不需要在 Windows 安装 Node.js 或 MySQL。

**已有旧卷或正在排查旧密码：优先双击 `start-docker-acceptance.bat`。** 它创建独立项目、独立配置 `.env.docker.acceptance` 和独立数据库卷，默认地址 http://127.0.0.1:3031，保留旧环境。首次按引导设置数据库、数据库账号和网页账号，三个密码可以分别输入，或回车安全生成。成功提示必须等数据库真实认证、八表和网页账号都验证通过后才出现。

- 验收环境查看密码：双击 `show-docker-acceptance-config.bat`，仅在本机编辑器查看。
- 验收环境再次验证：双击 `verify-docker-acceptance.bat`。
- 验收环境停止：双击 `stop-docker-acceptance.bat`，保留数据。
- 普通环境对应入口：`start-docker-local.bat` / `verify-docker-local.bat` / `show-docker-config.bat` / `stop-docker-local.bat`，配置 `.env.docker`，默认端口3030。

网页登录用 `APP_AUTH_USER` / `APP_AUTH_PASSWORD`；MySQL 用 `DB_USER` / `DB_PASSWORD`；MySQL 管理员用 `root` / `MYSQL_ROOT_PASSWORD`。**不要互换这三类密码。** 本地 APP 到数据库固定使用服务名 `db:3306`，容器 IP 改变也无需修改。首次创建5家店、10台设备；客流为0是正常初始状态，造数另行操作。

修改配置不会修改旧数据库卷里的账号密码。遇到认证拒绝会停止成功提示，不能通过删除旧卷解决。具体初始化、恢复与服务器部署见 [容器化部署手册](docs/容器化部署手册.md)。本轮证据见 [首次启动修复与验收报告](docs/首次启动修复与验收报告.md)。

## 文件入口

| 文件 | 用途 |
| --- | --- |
| Dockerfile、.dockerignore | 非 root 生产镜像；排除私密配置、本地库和报告 |
| compose.yaml、.env.docker.example | 本机单实例演示 |
| k8s/ | TKE 命名空间、配置、两副本、Service、ServiceMonitor、一次性建表 Job |
| .github/workflows/ci.yml | 推送后测试和构建，不部署 |
| .github/workflows/manual-tke-release.yml | 人工触发 TCR 推送和 TKE 滚动发布 |
| docs/容器化部署手册.md | 从本机到 TCR、TencentDB、TKE 的完整步骤 |
| docs/架构与验证说明.md | 多副本限制、监控指标、验收和回退 |

TKE 占位符必须先替换，Secret 由你在目标集群创建。本目录不会自动创建腾讯云资源、迁移现有业务数据或推送 GitHub。构建、测试和云端验收状态以文档末尾的实测边界为准。
