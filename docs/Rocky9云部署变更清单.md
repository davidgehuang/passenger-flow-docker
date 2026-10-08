# Rocky9云部署变更清单

所有交付位于passenger-flow-docker。用户自行提交Git，未创建云资源。

## 新增

| 目录/文件 | 内容 |
| --- | --- |
| infra/bootstrap/main.tf | S3状态桶的加密、版本、公网阻断、防误删 |
| infra/aws/ | 网络、EC2、EIP、角色、ECR、两台RDS、参数、告警 |
| infra/tencent/ | CVM、网络、TencentDB、备份及TLS阻断条件 |
| 三个.terraform.lock.hcl | 固定Provider及Windows/Linux校验摘要 |
| *.tfvars.example / backend.hcl.example | 无真实密码的操作模板 |
| infra/*/tests/contract.tftest.hcl | 不连接云账号的Terraform约束测试 |
| cloud-tools.bat | Windows默认验证入口 |
| deploy/cloud/cloud-tools.ps1 | 凭据引导、预检、Plan、人工确认Apply、端点输出、人工发布 |
| deploy/cloud/compose.yaml | 只运行APP、127.0.0.1:3030、只读文件系统、非root |
| deploy/cloud/*.sh | Rocky准备、CA、部署、升级/回退、证书 |
| deploy/cloud/*.conf | Nginx验证站点和HTTPS反向代理模板 |
| deploy/cloud/*.service / *.timer | APP、证书续期的systemd配置 |
| deploy/cloud/*.py | 配置、云验证、5用户只读测量 |
| scripts/cloud-db.js | 显式新源库初始化、TLS检查、RDS副本预检 |
| tests/cloud* | SQL/TLS、配置、独立容器、浏览器、Terraform测试 |
| docs/Rocky9-AWS与腾讯云迁移操作手册.md | 完整实施、登录、DTS、割接、恢复、资源释放 |
| docs/Rocky9云部署验证报告.md | 实测结果及未验证范围 |

## 现有文件的兼容调整

- config/settings.js：新增可选DB_SSL_VERIFY_IDENTITY和MAINTENANCE_FILE。旧环境默认行为不变；云环境明确启用证书身份验证及/tmp维护标记。
- scripts/container-preflight.js：认证错误提示区分云数据库与本地Compose服务，不再把所有问题归因RDS。
- scripts/run-unit-tests.js：纳入云部署单元测试。
- .gitignore：忽略Terraform状态/计划/实际变量、后端、云本地秘密及Python缓存，保留模板和锁文件。
- .dockerignore：排除基础设施、部署资料、云端秘密、Terraform文件，避免进入APP镜像。
- README.md：增加AWS/Rocky9入口、手册和验证报告链接。

Dockerfile基础摘要、本地compose.yaml、普通/验收启动入口、现有环境文件、旧数据库卷以及原非容器程序没有改动。

## Git审阅方法

父仓库当前把整个项目显示为未跟踪目录。未暂存文件不会出现在git diff里，所以本次不提供伪造的历史差异。请在父仓库根执行：

```powershell
git status --short
git add passenger-flow-docker
git diff --cached --stat
git diff --cached --check
git diff --cached -- passenger-flow-docker/infra passenger-flow-docker/deploy/cloud
```

确认没有.env、config.json、tfstate、tfplan、真实tfvars、私钥、DPAPI密码或测试生成目录后，自行commit/push。若项目已在独立仓库，使用对应根目录。不要为得到差异而重新初始化、覆盖或移动现有仓库。
