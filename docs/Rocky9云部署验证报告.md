# Rocky 9 云部署工具验证报告

日期：2026-10-08。范围：passenger-flow-docker新增AWS/腾讯Terraform、云部署脚本和少量兼容配置。

## 1. 结论

**本地代码与隔离容器链路已通过验证，可以进入用户执行AWS预检、审核真实Terraform计划的阶段。**

没有创建或修改真实云资源，没有推送ECR，没有执行真实DTS迁移，没有在Rocky虚拟机/云宿主机上运行部署。不能把本报告解释为“香港云环境已经上线验收”。

按用户本轮确认：先实施AWS；腾讯单节点MySQL8.4规格保持不变，等待腾讯确认TLS能力。Terraform默认阻止未确认的目标数据库创建。

## 2. 实际环境

| 项目 | 本轮环境 |
| --- | --- |
| 工作机 | Windows，Docker Desktop Linux引擎 |
| Docker Engine | 29.6.2 |
| Node | 24.19.0（宿主机测试）；APP仍用Dockerfile锁定的Node24 Alpine基础镜像 |
| MySQL | 隔离测试镜像8.4.11 |
| MySQL摘要 | sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242 |
| Terraform | 1.16.4 |
| Provider | AWS6.68.0、Tencent1.83.34，锁定Windows/Linux摘要 |
| 浏览器 | 本机Microsoft Edge，Playwright无界面验证 |
| 数据规模 | CLI生成200条客流＋认证HTTP插入1条；不是1GiB压测 |

隔离项目：pf-cloud-check-20261008110053；端口127.0.0.1:3032；结束后仅清理该项目容器和卷。原passenger-flow-docker-acceptance应用与数据库容器ID保留，原本地配置没有替换。

## 3. 已通过检查

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| Windows cloud-tools.bat -Action Validate | 通过 | 真正调用Windows PowerShell，三个Terraform目录init/validate通过；没有apply |
| Terraform格式 | 通过 | 源文件及mock测试格式检查 |
| Terraform mock计划 | 4/4通过 | AWS私有主库与关闭DTS入站、全网来源拒绝；腾讯TLS未确认阻断、确认后私网/备份约束 |
| Bash语法与ShellCheck | 通过 | 临时容器中静态检查，不执行脚本系统变更 |
| Python配置工具 | 3/3通过 | 字符保存、raw密码、非法参数、重复写配置 |
| Node单元测试 | 30/30通过 | 包含TLS默认兼容、SQL标识符、现有容量、只读等测试 |
| ESLint | 通过 | 包含新增云数据库与浏览器测试脚本 |
| Python语法编译 | 通过 | 配置、验证、并发和隔离测试脚本 |
| 当前源码Docker构建 | 通过 | 保持基础镜像摘要，非root运行 |
| 独立容器验收 | 19项通过 | 覆盖TLS、认证、页面、写入、重建与只读保护 |
| 新库初始化 | 通过 | 八张表、5家店、10台设备 |
| 数据库真实TLS认证 | 通过 | 业务账号连接，验证CA链与db主机名 |
| 特殊字符密码 | 通过 | 美元、井号、单双引号、反斜线、空格经raw配置真实登录 |
| TLS反例 | 通过 | 错误证书主机名、非信任CA都拒绝 |
| 错误业务密码 | 通过 | 非零失败，没有错误成功提示 |
| 网页认证 | 通过 | 未登录首页401，正确账号七个页面200 |
| 浏览器资源 | 通过 | 七页渲染、导航、截图；无脚本错误，无外部CDN请求 |
| 网页写入保护 | 通过 | 同站POST成功插入1条，跨站POST403 |
| 重建APP | 通过 | 登录配置及201条客流保留 |
| 腾讯只读启动契约 | 通过 | 同一APP设只读后仍可查询，造数命令被拒绝 |
| 原Windows验证入口 | 通过 | verify-docker-acceptance.bat实际运行；业务账号、八表、应用、网页登录全部通过 |

**重要测试边界：** 测试中的mysql.rds_set_configuration是隔离MySQL内的空操作测试桩，仅用于走完初始化控制流程；不证明RDS管理员实际权限或72小时保留已在AWS生效。测试没有建立真实RDS异步复制，未执行replica-check的真实云验收。

本轮测试原始脱敏结果保存在：

- reports/cloud-container/result.json
- reports/cloud-browser/result.json及七张页面截图

reports被Git忽略，不作为源码提交。截图仅含随机测试数据及测试地址；没有包含密码。

## 4. 本地响应记录

最终隔离测试中，七个HTTP请求均200，耗时0–31ms（计时分辨率会出现0ms）；Edge页面完整加载约640–893ms。它们只反映本地201条客流、单机Docker链路，不能预测1GiB数据库、5个并发用户、跨云网络或真实RDS的响应时间。

未采集真实数据库CPU、IO、香港公网时延或DTS延迟；不据此宣称解决历史大数据量高CPU问题。

## 5. 检查期间发现并修复的工具问题

1. Windows下Python默认GBK读取测试文本可能失败：显式UTF-8。
2. Unix文件权限模式不能直接用于Windows测试：生产Linux仍600，Windows测试不误用chmod模拟POSIX安全属性。
3. PowerShell5.1中文兼容：新增Windows脚本使用UTF-8 BOM和CRLF；云Shell保持LF。
4. export并赋值会掩盖命令失败：拆开赋值和export，ShellCheck通过。
5. Nginx验证失败恢复：移除本脚本新装的单个站点文件后恢复备份，防止旧配置中本来没有该文件时留下残留。
6. 只读容器维护标记不可写：云环境显式放/tmp，原环境默认路径保持兼容。
7. 云数据库证书验证：新增显式DB_SSL_VERIFY_IDENTITY，云配置开启；旧环境默认值不变，正反例均通过。
8. 腾讯规格与TLS要求存在冲突风险：新增创建前置条件，默认阻断；不静默换规格或关闭TLS。

## 6. 尚未验证、由用户在云端验收的项目

| 项目 | 当前状态 |
| --- | --- |
| AWS香港AMI订阅、实例售卖、配额与实际价格 | 未查询用户账户 |
| 真实Terraform plan/apply及S3后端锁并发 | 未执行 |
| Rocky9宿主机systemd/SELinux/firewalld/重启 | 未执行；容器静态检查不能替代 |
| AWS SSM Agent安装及联网 | 未执行 |
| RDS实际管理员授权、Binlog参数、72小时保留与异步复制 | 未执行 |
| 可信IP证书签发、6天周期自动续期 | 未执行，仅提供配置和操作流程 |
| Nginx代理后的HTTPS POST | 未执行；已验证APP直连同站/跨站POST |
| 腾讯单节点8.4 TLS/证书端点 | 官方确认待办，目标创建默认阻断 |
| TencentDB真实备份策略、CVM网络、ECR短期拉取 | 未执行 |
| 1GiB数据／5用户压测 | 未执行，已提供只读5并发工具与记录表 |
| DTS结构＋全量＋增量、两段追平、割接与回退 | 未执行 |

使用[完整手册](Rocky9-AWS与腾讯云迁移操作手册.md)逐项完成，并把云上证据补充进新报告，不能覆盖本轮本地实测边界。

## 7. 交付与保护

仅修改容器项目；原passenger-flow-system-codex未改动。本轮没有改本地compose.yaml、.env.docker或.env.docker.acceptance，没有删除用户旧卷。

新增文件与兼容配置见[变更清单](Rocky9云部署变更清单.md)。父仓库当前将整个容器目录显示为untracked，git diff无法展示未暂存新目录的内容；需由用户git add后自行审阅。没有自动git add、commit、push，也没有打包。
