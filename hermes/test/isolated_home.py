"""Give a test its own Hermes home before Hermes is imported.

Why this exists: Hermes loads ``$HERMES_HOME/.env`` with ``override=True``
(``hermes_cli/env_loader.py`` → ``_load_user_dotenv``), and
``hermes_cli/auth.py:_resolve_api_key_provider_secret`` reads keys through
``get_env_value_prefer_dotenv``, which deliberately prefers that file over
``os.environ``. A test that only patches ``os.environ`` therefore still sees
the developer's real PAT and, worse, can resolve it as a credential. Pointing
``HERMES_HOME`` at a fresh temp dir isolates both the dotenv file and plugin
discovery (``$HERMES_HOME/plugins/model-providers``).

``HERMES_HOME`` is read live by ``hermes_constants.get_process_hermes_home()``,
so it is enough to install the variable before the first Hermes import.

The directory is deliberately stable instead of a fresh ``mkdtemp``: Hermes
activates a private dependency environment per home, and doing that on every
run costs minutes. A throwaway home under the system temp dir is still fully
separated from the developer's ``~/.hermes`` (no ``.env``, no ``auth.json``,
no user plugins), so no real credential can be read. Set
``QODER_CN_TEST_HOME`` to relocate it.
"""

from pathlib import Path
import os
import sys
import tempfile

PLUGIN = Path(__file__).resolve().parents[1]


def _home_path() -> Path:
    override = os.environ.get("QODER_CN_TEST_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    return Path(tempfile.gettempdir()) / "qoder-cn-test-home"


def isolate(install_plugin: bool = True) -> Path:
    """Point this process at a throwaway Hermes home and install the plugin into it."""
    home = _home_path()
    home.mkdir(parents=True, exist_ok=True)
    os.environ["HERMES_HOME"] = str(home)
    # Any value inherited from the developer's shell must not leak into the
    # assertions; tests set their own synthetic PATs explicitly.
    for name in ("QODERCN_PERSONAL_ACCESS_TOKEN", "QODER_PERSONAL_ACCESS_TOKEN"):
        os.environ.pop(name, None)
    if install_plugin:
        sys.path.insert(0, str(PLUGIN))
        from install import install
        install(home / "plugins" / "model-providers" / "qoder-cn")
    return home