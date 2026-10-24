"""Unit tests for source-only GNU AArch64 dynamic dependency parsing.

No test in this file marks Android compatibility as ready.
"""
import importlib.util
import pathlib
import unittest

MODULE = pathlib.Path(__file__).with_name("build-isolated-gnu-runtime.py")
SPEC = importlib.util.spec_from_file_location("seven_gnu_probe", MODULE)
SCRIPT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCRIPT)


class IsolatedGnuRuntimeTests(unittest.TestCase):
    def test_expected_copilot_native_objects_are_not_elided(self):
        self.assertEqual(len(SCRIPT.REQUIRED_COPILOT), 4)
        self.assertTrue(all(path.startswith(("node_modules/", "extensions/"))
                            for path in SCRIPT.REQUIRED_COPILOT))

    def test_abi_isolation_does_not_mark_research_as_accepted(self):
        code = MODULE.read_text()
        self.assertIn('"androidVerified": False', code)
        self.assertIn('"releaseEligible": False', code)
        self.assertIn("libc.so.6", code)
        self.assertIn("--library-path", code)

    def test_native_elf_architecture_is_checked(self):
        self.assertEqual(SCRIPT.AARCH64, 183)
        self.assertEqual(SCRIPT.ELF_MAGIC, b"\x7fELF")


if __name__ == "__main__":
    unittest.main()
