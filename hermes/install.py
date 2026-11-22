"""Install the local Hermes provider plugin; never installs test files."""
from pathlib import Path
import argparse
import os
import shutil


def install(destination: Path) -> Path:
    source = Path(__file__).resolve().parent
    target = destination.expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True)
    for name in ("__init__.py", "runtime.py", "usage.py", "plugin.yaml", "gateway.mjs", "README.md"):
        origin = source / name
        if not origin.is_file():
            raise RuntimeError(f"Missing {name}; run the Hermes gateway build first")
        shutil.copy2(origin, target / name)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", type=Path, default=Path(
        os.environ.get("HERMES_HOME", Path.home() / ".hermes"),
    ) / "plugins" / "model-providers" / "qoder-cn")
    args = parser.parse_args()
    print(f"Installed qoder-cn in {install(args.dest)}")
