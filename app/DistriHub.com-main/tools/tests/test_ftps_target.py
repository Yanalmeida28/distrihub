import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("target", Path(__file__).parents[1] / "verify_ftps_target.py")
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)


class FakeFtp:
    def __init__(self, content):
        self.content = content

    def retrbinary(self, command, receive):
        assert command == "RETR app-version.json"
        receive(self.content)


class TargetTests(unittest.TestCase):
    def test_matching_website_is_confirmed(self):
        self.assertEqual(target.verify_target(FakeFtp(b'{"buildId":"current"}'), "current"), "current")

    def test_different_site_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            target.verify_target(FakeFtp(b'{"buildId":"another-site"}'), "current")

    def test_missing_version_is_rejected(self):
        with self.assertRaises(RuntimeError):
            target.verify_target(FakeFtp(b'{}'), "current")
        with self.assertRaises(RuntimeError):
            target.verify_target(FakeFtp(b'{}'), "")

    def test_invalid_or_oversized_response_is_rejected(self):
        with self.assertRaises(json.JSONDecodeError):
            target.verify_target(FakeFtp(b'not JSON'), "current")
        with self.assertRaisesRegex(RuntimeError, "Unexpected remote"):
            target.verify_target(FakeFtp(b'x' * 65537), "current")


if __name__ == "__main__":
    unittest.main()
