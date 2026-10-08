import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
s = importlib.util.spec_from_file_location("cloud_config", root / "deploy/cloud/cloud-config.py")
cfg = importlib.util.module_from_spec(s)
s.loader.exec_module(cfg)


class CloudConfigTest(unittest.TestCase):
    def config(self):
        return dict(platform="AWS", db_host="test.rds.amazonaws.com", app_ip="192.0.2.1",
                    db_name="passenger_flow_codex", db_user="passenger_app", app_user="测试管理员",
                    db_password="a$# '\"\\ space", app_password="web$# '\"\\ space",
                    image="123456789012.dkr.ecr.ap-east-1.amazonaws.com/pf@sha256:" + "a"*64, readonly=False)

    def test_raw_password_and_no_seed(self):
        c = self.config()
        text = cfg.env_text(c)
        for key in ("db_password", "app_password"):
            env_key = "DB_PASSWORD" if key == "db_password" else "APP_AUTH_PASSWORD"
            self.assertIn(env_key + "=" + c[key] + "\n", text)
        self.assertIn("AUTO_INIT_SCHEMA=false\n", text)
        self.assertIn("DB_SSL_VERIFY_IDENTITY=true\n", text)
        self.assertIn("SEED_DEMO_DATA=false\n", text)

    def test_invalid_inputs(self):
        for key, value in (("image","repo:latest"),("db_name","bad;drop"),("app_user","a:b"),
                           ("db_password","x\nDB_SSL=false"),("platform","LOCAL"),("readonly","false"),
                           ("readonly",1),("db_user","x"*33),("app_ip","not-an-ip")):
            c=self.config(); c[key]=value
            with self.assertRaises(ValueError): cfg.check_config(c)

    def test_save_preserves_characters(self):
        c=self.config()
        test_dir = root / ".cloud-local"
        test_dir.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_dir) as d:
            cfg.save(c,Path(d))
            self.assertEqual(json.loads((Path(d)/"config.json").read_text(encoding="utf-8")),c)
            c["readonly"]=True
            cfg.save(c,Path(d))
            self.assertIn("DB_READ_ONLY=true\n",(Path(d)/"app.env").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
