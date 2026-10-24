#!/usr/bin/env python3
"""Offline regression tests for signed-source Android Kerberos ZIP merging."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().with_name("merge-kerberos-runtime.py")
SIGNER = "CC72CF8BA7DBFA0182877D045A897D96E57CF20C"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def writezip(path, libs):
    with zipfile.ZipFile(path, "w") as archive:
        for name, contents in libs.items():
            archive.writestr(name, contents)


class MergeKerberosTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.node = root / "node"
        self.krb = root / "krb"
        self.node.mkdir()
        self.krb.mkdir()
        self.node_libraries = {"libnode-dep.so": b"original-node-bionic"}
        self.krb_libraries = {"libgssapi_krb5.so": b"signed-krb5-native",
                              "libcom_err.so": b"signed-comerr-native"}
        self.node_metadata = {
            "platform": "android-bionic-arm64",
            "signerFingerprint": SIGNER,
            "indexOrigin": "termux-main stable",
            "libraries": {name: sha(raw) for name, raw in self.node_libraries.items()}
        }
        self.krb_metadata = {
            "signerFingerprint": SIGNER,
            "indexOrigin": "termux-main stable",
            "packages": {"krb5": {"sha256": "a" * 64}},
            "libraries": {name: sha(raw) for name, raw in self.krb_libraries.items()}
        }
        self.sync()

    def sync(self):
        writezip(self.node / "android-libs.zip", self.node_libraries)
        writezip(self.krb / "kerberos-libs.zip", self.krb_libraries)
        (self.node / "provenance.json").write_text(json.dumps(self.node_metadata))
        (self.krb / "kerberos-provenance.json").write_text(json.dumps(self.krb_metadata))

    def merge(self):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.node), str(self.krb)],
                              capture_output=True, text=True)

    def test_success_preserves_node_and_signed_kerberos_library_hashes(self):
        output = self.merge()
        self.assertEqual(output.returncode, 0, output.stderr)
        manifest = json.loads((self.node / "provenance.json").read_text())
        with zipfile.ZipFile(self.node / "android-libs.zip") as archive:
            self.assertEqual(set(archive.namelist()), set(self.node_libraries) | set(self.krb_libraries))
            for filename, digest in manifest["libraries"].items():
                self.assertEqual(sha(archive.read(filename)), digest)
        self.assertEqual(manifest["kerberosSources"]["packages"], self.krb_metadata["packages"])

    def test_rejects_forged_kerberos_hash(self):
        self.krb_metadata["libraries"]["libcom_err.so"] = "0" * 64
        self.sync()
        result = self.merge()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("hash mismatch", result.stderr)

    def test_rejects_conflicting_native_shared_library(self):
        self.krb_libraries["libnode-dep.so"] = b"replaced-node-library"
        self.krb_metadata["libraries"]["libnode-dep.so"] = sha(b"replaced-node-library")
        self.sync()
        result = self.merge()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Conflicting Kerberos/native Node", result.stderr)

    def test_rejects_different_signed_repository_identity(self):
        self.krb_metadata["signerFingerprint"] = "0" * 40
        self.sync()
        self.assertNotEqual(self.merge().returncode, 0)

    def test_rejects_zip_path_traversal(self):
        self.krb_libraries["../outside.so"] = b"unsafefile"
        self.krb_metadata["libraries"]["../outside.so"] = sha(b"unsafefile")
        self.sync()
        self.assertNotEqual(self.merge().returncode, 0)


if __name__ == "__main__":
    unittest.main()
