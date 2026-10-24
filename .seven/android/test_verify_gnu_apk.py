"""Unit tests for strict original-Copilot APK audit (not device acceptance)."""
import importlib.util
import io
import pathlib
import tempfile
import unittest
import zipfile

MODULE = pathlib.Path(__file__).with_name("verify-gnu-apk.py")
SPEC = importlib.util.spec_from_file_location("verify_gnu_android", MODULE)
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class OriginalGnuApkIntegrityTests(unittest.TestCase):
    def test_arm64_elf_header_is_required(self):
        arm = bytearray(80)
        arm[:6] = b"\x7fELF\x02\x01"
        arm[18:20] = (183).to_bytes(2, "little")
        VERIFY.check_arm64_elf(arm, "original-node")
        arm[18:20] = (62).to_bytes(2, "little")
        with self.assertRaisesRegex(ValueError, "AArch64"):
            VERIFY.check_arm64_elf(arm, "original-node")

    def test_duplicate_entries_are_rejected(self):
        source = io.BytesIO()
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("same", "value1")
            archive.writestr("same", "value2")
        with zipfile.ZipFile(io.BytesIO(source.getvalue())) as archive:
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                VERIFY.members(archive, "test")

    def test_directory_traversal_is_rejected(self):
        source = io.BytesIO()
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("../evil", "content")
        with zipfile.ZipFile(io.BytesIO(source.getvalue())) as archive:
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                VERIFY.members(archive, "test")

    def test_thin_client_cannot_fake_a_full_apk(self):
        with tempfile.TemporaryDirectory() as folder:
            file = pathlib.Path(folder) / "fake.apk"
            with zipfile.ZipFile(file, "w") as archive:
                archive.writestr("AndroidManifest.xml", "fake")
            with self.assertRaisesRegex(ValueError, "thin client"):
                VERIFY.verify(file)

    def test_unmodified_original_copilot_paths_are_all_required(self):
        self.assertEqual(len(VERIFY.FOUR_COPILOT_PATHS), 4)
        self.assertTrue(all("linux-arm64" in item for item in VERIFY.FOUR_COPILOT_PATHS))


if __name__ == "__main__":
    unittest.main()
