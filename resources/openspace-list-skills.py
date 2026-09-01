"""List VesPi/OpenSpace skills through OpenSpace SkillRegistry."""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

from openspace.utils.logging import Logger

Logger.configure(level=logging.ERROR, log_to_console=False, log_to_file=None, force=True)

from openspace.skill_engine.registry import SkillRegistry

ALLOWED = {"vespi", "project", "openspace", "bundled"}


def add(dirs: list[Path], sources: dict[str, str], path: Path, source: str) -> None:
    resolved = path.expanduser()
    dirs.append(resolved)
    sources[str(resolved.resolve())] = source


def main() -> int:
    cwd = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path.cwd()
    home = Path.home()
    dirs: list[Path] = []
    sources: dict[str, str] = {}

    add(dirs, sources, home / ".vespi" / "skills", "vespi")
    add(dirs, sources, home / ".omp" / "profiles" / "vespi" / "agent" / "skills", "vespi")
    add(dirs, sources, home / ".openspace" / "skills", "openspace")
    add(dirs, sources, cwd / ".vespi" / "skills", "project")
    add(dirs, sources, cwd / ".openspace" / "skills", "project")

    pkg = Path(__import__("openspace").__file__).resolve().parent
    add(dirs, sources, pkg / "host_skills", "bundled")

    registry = SkillRegistry(skill_dirs=dirs, skill_dir_sources=sources)
    out = []
    seen: set[str] = set()
    for skill in registry.list_skills():
        path = str(skill.path)
        if path in seen:
            continue
        seen.add(path)
        source = skill.source if skill.source in ALLOWED else "openspace"
        out.append(
            {
                "name": skill.display_name or skill.name,
                "description": skill.description or "",
                "path": path,
                "source": source,
                "enabled": True,
            }
        )
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
