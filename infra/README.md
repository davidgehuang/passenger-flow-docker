# Rocky 9 云基础设施

先阅读[完整操作手册](../docs/Rocky9-AWS与腾讯云迁移操作手册.md)，不要直接填占位符后执行apply。

- bootstrap：AWS香港S3状态桶，本地bootstrap状态需单独备份。
- aws：香港EC2＋私有RDS写主库＋异步只读副本，APP无公网3030。
- tencent：香港CVM＋TencentDB；**TLS尚待厂商确认，默认阻止目标库创建**。
- 两端独立S3状态key、独立plan，不自动创建DTS任务。
- 模块中的*.tftest.hcl使用mock provider，只测配置约束，不证明真实售卖与授权。

Windows从项目根目录运行：

```powershell
.\cloud-tools.bat -Action Validate
python tests/cloud-terraform.py
```

真实计划的下一步按手册逐项执行。没有在源码中写真实AMI、密码、账号密钥或DTS来源；预检后自行锁定。不要提交tfvars、backend.hcl、tfplan、tfstate、.terraform和.cloud-local。应提交三个Provider锁文件。
