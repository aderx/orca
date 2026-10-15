import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

ADAPTER = Path(__file__).with_name("prepare-dependencies.py")
FIXTURE = '''
from pathlib import Path
import os
import sys

def git_common_dir(root):
    return root / '.git'

def resolve_repo_context(*, requested_worktree, primary_hint):
    assert requested_worktree == Path.cwd()
    assert primary_hint == Path.cwd()
    return requested_worktree

def ask(command):
    raise AssertionError('manual y confirmation must not be reached')

def run_frontend_dependency_install(context, command, subject='前端', confirm_online_retry=ask):
    assert os.environ['CI'] == 'true'
    assert sys.stdin.read() == ''
    print('OFFLINE_FAILED', flush=True)
    assert confirm_online_retry('pnpm install --filter=zsv-shell...')
    print('ONLINE_RETRY', flush=True)
    if os.environ.get('FIXTURE_FAIL'):
        raise RuntimeError('registry unavailable')

def prepare_frontend_scope(context, *, product, apps):
    assert product == 'zsv'
    assert apps == ('zsv-shell', 'zsv-compute')
    run_frontend_dependency_install(context, ['pnpm', 'install', '--offline'])
    print('BUILD_COMPLETE', flush=True)

if __name__ == '__main__':
    raise AssertionError('interactive CLI must not run')
'''


class PreparationTests(unittest.TestCase):
    def run_adapter(self, *, fail=False, direct=False):
        with tempfile.TemporaryDirectory(prefix="orca-prepare-") as temporary:
            root = Path(temporary)
            source = root / "installed zs-start.py"
            source.write_text("#!/usr/bin/env python3\n" + FIXTURE)
            launcher = root / "zs-start"
            if direct:
                launcher.symlink_to(source)
                source.chmod(0o755)
            else:
                launcher.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} -B {shlex.quote(str(source))} \"$@\"\n")
                launcher.chmod(0o755)
            env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ.get("PATH", "")}
            if fail:
                env["FIXTURE_FAIL"] = "1"
            return subprocess.run(
                [sys.executable, "-B", str(ADAPTER), "--product", "zsv", "--apps", "zsv-shell,zsv-compute"],
                cwd=root, env=env, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5,
            )

    def test_offline_failure_retries_online_and_builds_without_confirmation(self):
        result = self.run_adapter()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["OFFLINE_FAILED", "ONLINE_RETRY", "BUILD_COMPLETE"])

    def test_failed_install_does_not_build(self):
        result = self.run_adapter(fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("BUILD_COMPLETE", result.stdout)
        self.assertIn("registry unavailable", result.stderr)

    def test_python_entry_is_supported_without_running_cli(self):
        result = self.run_adapter(direct=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
