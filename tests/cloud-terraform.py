"""将Terraform源文件复制至独立本地后端，用mock provider检查计划。

不访问云账号，不生成真实云计划，不修改已有后端、状态或用户tfvars。
"""
import shutil
import subprocess
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
test_root = root / ".cloud-local" / ("terraform-mock-" + time.strftime("%Y%m%d%H%M%S"))
for platform in ("aws", "tencent"):
    source = root / "infra" / platform
    target = test_root / platform
    target.mkdir(parents=True)
    for file in source.glob("*.tf"):
        target.joinpath(file.name).write_text(file.read_text(encoding="utf-8").replace('backend "s3" {}', ""), encoding="utf-8")
    shutil.copy2(source / ".terraform.lock.hcl", target / ".terraform.lock.hcl")
    if (source / "cloud-init.sh").exists():
        shutil.copy2(source / "cloud-init.sh", target / "cloud-init.sh")
    shutil.copytree(source / "tests", target / "tests")
    for args in (["init", "-backend=false", "-input=false", "-no-color"], ["test", "-no-color"]):
        subprocess.run(["terraform", "-chdir=" + str(target), *args], check=True, timeout=300)
