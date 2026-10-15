"""Reuse the installed zs-start preparation with the launcher's automatic-install policy."""
import argparse
import importlib.util
import os
from pathlib import Path
import shlex
import shutil
import sys

sys.dont_write_bytecode = True


def locate_zs_start():
    executable = shutil.which("zs-start")
    if not executable:
        raise RuntimeError("未找到 zs-start，请先安装项目启动工具")
    launcher = Path(executable).resolve()
    source = launcher.read_text()
    if "python" in source.splitlines()[0]:
        return launcher
    # RequirementTracker installs a shell entry pointing at its bundled Python source.
    for line in source.splitlines():
        words = shlex.split(line, comments=True)
        if words and words[0] == "exec":
            for word in words[1:]:
                candidate = Path(word)
                if candidate.is_absolute() and candidate.suffix == ".py" and candidate.is_file():
                    return candidate
    raise RuntimeError("无法定位 zs-start 的 Python 入口，请检查已安装的启动工具")


def prepare(product, apps):
    source = locate_zs_start()
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location("orca_zs_start", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 zs-start 依赖准备函数")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    original_install = module.run_frontend_dependency_install

    def automatic_install(context, command, subject="前端"):
        return original_install(
            context, command, subject=subject, confirm_online_retry=lambda _command: True
        )

    module.run_frontend_dependency_install = automatic_install
    os.environ["CI"] = "true"
    common = module.git_common_dir(Path.cwd())
    if common is None:
        raise RuntimeError("无法识别当前工作树的 Git 仓库")
    context = module.resolve_repo_context(requested_worktree=Path.cwd(), primary_hint=common.parent)
    module.prepare_frontend_scope(context, product=product, apps=apps)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--product", required=True)
    parser.add_argument("--apps", required=True)
    args = parser.parse_args()
    apps = tuple(dict.fromkeys(value.strip() for value in args.apps.split(",") if value.strip()))
    if not apps:
        parser.error("缺少待准备的模块")
    try:
        prepare(args.product, apps)
    except Exception as error:
        print(f"依赖准备失败：{error}", file=sys.stderr)
        sys.exit(1)
