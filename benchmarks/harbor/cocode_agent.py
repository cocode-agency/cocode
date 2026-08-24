"""Harbor installed-agent adapter for Cocode's headless runner."""

import json
import shlex
from pathlib import Path, PurePosixPath
from typing import Any, override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.model_connection import ModelConnectionSpec, ResolvedModelConnection
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

_REMOTE_HOME = PurePosixPath("/tmp/cocode-benchmark")
_REMOTE_DSH_HOME = _REMOTE_HOME / "dsh"
_REMOTE_SUPERVISOR_HOME = _REMOTE_HOME / "supervisor"
_REMOTE_RUNTIME_HOME = _REMOTE_HOME / "runtimes"
_REMOTE_LOG_DIR = PurePosixPath("/logs/agent/cocode")
_CUSTOM_PROVIDER = "harbor-endpoint"


class CocodeAgent(BaseInstalledAgent):
    """Install Cocode in the task container and run one isolated agent turn."""

    MODEL_CONNECTION = ModelConnectionSpec(passthrough=True)
    SUPPORTS_RESUME = False

    def __init__(
        self,
        *args: Any,
        package: str = "@cocode-agency/tui@latest",
        tui_tarball_path: str | None = None,
        supervisor_tarball_path: str | None = None,
        reasoning_effort: str | None = None,
        approval_policy: str = "allow",
        timeout_sec: int = 1800,
        max_tokens: int | None = None,
        model_api: str = "openai-responses",
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        if approval_policy not in {"allow", "reject"}:
            raise ValueError("approval_policy must be allow or reject")
        if timeout_sec <= 0:
            raise ValueError("timeout_sec must be positive")
        if max_tokens is not None and max_tokens <= 0:
            raise ValueError("max_tokens must be positive")
        self._package = package
        self._tui_tarball_path = (
            Path(tui_tarball_path).expanduser().resolve()
            if tui_tarball_path
            else None
        )
        self._supervisor_tarball_path = (
            Path(supervisor_tarball_path).expanduser().resolve()
            if supervisor_tarball_path
            else None
        )
        if (self._tui_tarball_path is None) != (
            self._supervisor_tarball_path is None
        ):
            raise ValueError(
                "tui_tarball_path and supervisor_tarball_path must be supplied together"
            )
        self._reasoning_effort = reasoning_effort
        self._approval_policy = approval_policy
        self._timeout_sec = timeout_sec
        self._max_tokens = max_tokens
        self._model_api = model_api

    @staticmethod
    @override
    def name() -> str:
        return "cocode"

    @override
    def get_version_command(self) -> str | None:
        return ". ~/.nvm/nvm.sh; cocode --version"

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.ensure_system_dependencies(environment, ("curl",))
        package_specs = await self._install_package_specs(environment)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{nvm_node_install_snippet()} && "
                "npm install --global -- "
                + " ".join(shlex.quote(spec) for spec in package_specs)
                + " && "
                "cocode --version"
            ),
        )

    async def _install_package_specs(
        self, environment: BaseEnvironment
    ) -> list[str]:
        if self._tui_tarball_path is not None:
            assert self._supervisor_tarball_path is not None
            for path in (self._tui_tarball_path, self._supervisor_tarball_path):
                if not path.is_file():
                    raise FileNotFoundError(f"Cocode package tarball not found: {path}")
            remote_supervisor = "/tmp/cocode-host-supervisor.tgz"
            remote_tui = "/tmp/cocode-tui.tgz"
            await environment.upload_file(
                self._supervisor_tarball_path, remote_supervisor
            )
            await environment.upload_file(self._tui_tarball_path, remote_tui)
            return [remote_supervisor, remote_tui]

        package_spec = self._package
        if self._version:
            package_name = self._package.split("@", 2)
            package_spec = (
                f"@{package_name[1]}@{self._version}"
                if self._package.startswith("@")
                else f"{self._package.split('@', 1)[0]}@{self._version}"
            )
        return [package_spec]

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        provider, model_id = self._split_model_name()
        access = self.model_connection
        provider = access.provider or provider
        env = dict(access.env)
        provider, route_env = self._provider_route(access, provider, model_id)
        env.update(route_env)
        env.update(
            {
                "COCODE_DSH_HOME": _REMOTE_DSH_HOME.as_posix(),
                "DSH_HOME": _REMOTE_DSH_HOME.as_posix(),
                "DSH_SESSION_ROOT": (_REMOTE_DSH_HOME / "sessions").as_posix(),
                "COCODE_SUPERVISOR_HOME": _REMOTE_SUPERVISOR_HOME.as_posix(),
                "COCODE_HOST_RUNTIME_HOME": _REMOTE_RUNTIME_HOME.as_posix(),
                "COCODE_PROVIDER": provider,
                "COCODE_MODEL": model_id,
            }
        )

        run_command = [
            "cocode",
            "run",
            f"--provider {shlex.quote(provider)}",
            f"--model {shlex.quote(model_id)}",
            f"--approval-policy {shlex.quote(self._approval_policy)}",
            f"--timeout {self._timeout_sec}s",
            f"--event-log {shlex.quote((_REMOTE_LOG_DIR / 'events.jsonl').as_posix())}",
            "--json",
        ]
        if self._reasoning_effort:
            run_command.append(f"--reasoning-effort {shlex.quote(self._reasoning_effort)}")
        if self._max_tokens is not None:
            run_command.append(f"--max-tokens {self._max_tokens}")
        run_command.append(f"--prompt {shlex.quote(instruction)}")

        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                ". ~/.nvm/nvm.sh; "
                f"mkdir -p {shlex.quote(_REMOTE_LOG_DIR.as_posix())}; "
                + " ".join(run_command)
                + f" 2>&1 | stdbuf -oL tee {shlex.quote((_REMOTE_LOG_DIR / 'output.log').as_posix())}"
            ),
            env=env,
        )

    def _split_model_name(self) -> tuple[str, str]:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")
        return tuple(self.model_name.split("/", 1))  # type: ignore[return-value]

    def _provider_route(
        self,
        access: ResolvedModelConnection,
        provider: str,
        model_id: str,
    ) -> tuple[str, dict[str, str]]:
        endpoint = access.configured_base_url
        if endpoint is None:
            if provider in {"deepseek", "deepseek-official"}:
                return "deepseek-official", {}
            return provider, {}

        api_key_env = self._api_key_env_name(access)
        if api_key_env is None:
            raise ValueError("Custom Cocode endpoints require an API-key environment variable")
        providers = {
            _CUSTOM_PROVIDER: {
                "baseURL": endpoint,
                "apiKeyEnv": api_key_env,
                "api": self._model_api,
                "models": [{"id": model_id}],
            }
        }
        return _CUSTOM_PROVIDER, {"COCODE_LLM_PROVIDERS": json.dumps(providers)}

    @staticmethod
    def _api_key_env_name(access: ResolvedModelConnection) -> str | None:
        if access.api_key is None:
            return None
        return next(
            (name for name, value in sorted(access.env.items()) if value == access.api_key),
            None,
        )
