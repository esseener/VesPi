"""Local VesPi skill manager: list, create, delete, evolve. Cloud stays off."""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
import uuid
from pathlib import Path

os.environ.setdefault("OPENSPACE_CLOUD_MODE", "off")
os.environ.setdefault("OPENSPACE_CLOUD_TELEMETRY_MODE", "off")
os.environ.setdefault("OPENSPACE_SKIP_DOTENV", "1")

from openspace.utils.logging import Logger

Logger.configure(level=logging.ERROR, log_to_console=False, log_to_file=None, force=True)

from openspace.skill_engine.evidence.store import resolve_skill_store_db_path
from openspace.skill_engine.patch import create_skill
from openspace.skill_engine.registry import SkillRegistry, write_skill_id
from openspace.skill_engine.store import SkillStore

ALLOWED = {"vespi", "project", "openspace", "bundled"}
NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9._-]{0,63}$")


def skill_home() -> Path:
    return Path.home() / ".vespi" / "skills"


def profile_skills() -> Path:
    return Path.home() / ".omp" / "profiles" / "vespi" / "agent" / "skills"


def add_dir(dirs: list[Path], sources: dict[str, str], path: Path, source: str) -> None:
    resolved = path.expanduser()
    dirs.append(resolved)
    try:
        sources[str(resolved.resolve())] = source
    except OSError:
        sources[str(resolved)] = source


def skill_roots(cwd: Path) -> tuple[list[Path], dict[str, str]]:
    home = Path.home()
    dirs: list[Path] = []
    sources: dict[str, str] = {}
    add_dir(dirs, sources, skill_home(), "vespi")
    add_dir(dirs, sources, profile_skills(), "vespi")
    add_dir(dirs, sources, home / ".openspace" / "skills", "openspace")
    add_dir(dirs, sources, cwd / ".vespi" / "skills", "project")
    add_dir(dirs, sources, cwd / ".openspace" / "skills", "project")
    pkg = Path(__import__("openspace").__file__).resolve().parent
    add_dir(dirs, sources, pkg / "host_skills", "bundled")
    return dirs, sources


def store_db(cwd: Path) -> Path:
    return resolve_skill_store_db_path(workspace_dir=cwd)


def managed_roots() -> list[Path]:
    roots = []
    for path in (skill_home(), profile_skills()):
        try:
            roots.append(path.expanduser().resolve())
        except OSError:
            roots.append(path.expanduser())
    return roots


def is_managed(skill_dir: Path) -> bool:
    resolved = skill_dir.resolve()
    for root in managed_roots():
        if resolved == root or root in resolved.parents:
            return True
    return False


def skill_dir_of(path: str) -> Path:
    skill_md = Path(path).expanduser().resolve()
    if skill_md.name.lower() == "skill.md":
        return skill_md.parent
    return skill_md


def record_stats(store: SkillStore | None, skill) -> dict[str, object]:
    if store is None:
        return {}
    rec = None
    try:
        rec = store.load_record(skill.skill_id)
    except Exception:
        rec = None
    if rec is None:
        try:
            rec = store.load_record_by_path(str(Path(skill.path).parent))
        except Exception:
            rec = None
    if rec is None:
        return {}
    lineage = rec.lineage
    origin = getattr(getattr(lineage, "origin", None), "value", None) or None
    return {
        "origin": origin,
        "generation": int(getattr(lineage, "generation", 0) or 0),
        "uses": int(rec.total_uses or 0),
        "successes": int(rec.total_completions or rec.trust_successes or 0),
        "changeSummary": getattr(lineage, "change_summary", None) or None,
    }


def list_payload(cwd: Path) -> list[dict[str, object]]:
    dirs, sources = skill_roots(cwd)
    registry = SkillRegistry(skill_dirs=dirs, skill_dir_sources=sources)
    db = store_db(cwd)
    store = SkillStore(db) if db.exists() else None
    try:
        out: list[dict[str, object]] = []
        seen: set[str] = set()
        for skill in registry.list_skills():
            path = str(skill.path)
            if path in seen:
                continue
            seen.add(path)
            source = skill.source if skill.source in ALLOWED else "openspace"
            row: dict[str, object] = {
                "name": skill.display_name or skill.name,
                "description": skill.description or "",
                "path": path,
                "source": source,
                "enabled": True,
                "skillId": skill.skill_id,
                "managed": is_managed(Path(path).parent),
            }
            row.update(record_stats(store, skill))
            out.append(row)
        return out
    finally:
        if store is not None:
            store.close()


def create_local(name: str, description: str) -> dict[str, object]:
    name = (name or "").strip()
    if not NAME_RE.match(name):
        return {"ok": False, "error": "invalid skill name"}
    target = skill_home() / name
    if target.exists():
        return {"ok": False, "error": f"skill already exists: {target}"}
    desc = (description or "").strip() or name
    content = (
        f"---\nname: {name}\ndescription: {desc}\n---\n\n"
        f"# {name}\n\n"
        "Local VesPi skill. Edit this file to teach the agent a reusable procedure.\n"
    )
    result = create_skill(target, content)
    if not result.ok:
        return {"ok": False, "error": result.error or "create failed"}
    write_skill_id(target, f"{name}__imp_{uuid.uuid4().hex[:8]}")
    return {"ok": True, "path": str(target / "SKILL.md"), "name": name}


def delete_local(path: str) -> dict[str, object]:
    skill_dir = skill_dir_of(path)
    if not is_managed(skill_dir):
        return {"ok": False, "error": "can only delete VesPi-managed skills"}
    if not skill_dir.exists():
        return {"ok": False, "error": "skill directory not found"}
    shutil.rmtree(skill_dir)
    return {"ok": True, "path": str(skill_dir)}


def evolve_local(cwd: Path, path: str, direction: str) -> dict[str, object]:
    if not direction.strip():
        return {"ok": False, "error": "direction is required"}

    skill_path = skill_dir_of(path)
    if not (skill_path / "SKILL.md").exists():
        return {"ok": False, "error": f"SKILL.md not found in {skill_path}"}

    import asyncio

    from openspace import OpenSpace, OpenSpaceConfig
    from openspace.host_detection import (
        build_grounding_config_path,
        build_llm_kwargs,
        load_runtime_env,
    )
    from openspace.skill_engine.triggers import ManualTriggerRequest

    os.environ["OPENSPACE_CLOUD_MODE"] = "off"
    os.environ["OPENSPACE_CLOUD_TELEMETRY_MODE"] = "off"
    os.environ["OPENSPACE_WORKSPACE"] = str(cwd)
    os.environ["OPENSPACE_HOST_SKILL_DIRS"] = str(skill_home())
    os.environ["OPENSPACE_CONFIG_HOME"] = str(cwd / ".openspace")

    async def run() -> dict[str, object]:
        load_runtime_env()
        model, llm_kwargs = build_llm_kwargs(os.environ.get("OPENSPACE_MODEL", ""))
        config = OpenSpaceConfig(
            llm_model=model,
            llm_kwargs=llm_kwargs,
            workspace_dir=str(cwd),
            session_storage_dir=str(cwd / ".openspace"),
            grounding_config_path=build_grounding_config_path(),
            evolution_mode="autonomous",
        )
        openspace = OpenSpace(config=config)
        await openspace.initialize()
        registry = openspace.get_skill_registry()
        if not registry:
            raise RuntimeError("SkillRegistry not initialized")
        meta = registry.register_skill_dir(skill_path)
        if not meta:
            raise RuntimeError(f"Failed to register {skill_path}")
        store = openspace.get_skill_store()
        if store is None:
            raise RuntimeError("SkillStore is not initialized")
        await store.sync_from_registry([meta])
        runtime = openspace.runtime
        register = getattr(runtime, "register_evidence_read_roots", None)
        if callable(register):
            register(skill_path)
        trigger_engine = openspace.get_trigger_engine()
        if not trigger_engine:
            raise RuntimeError("Evolution TriggerEngine is not initialized")
        jobs = trigger_engine.from_manual_request(
            ManualTriggerRequest(
                action="fix",
                reason="manual_fix",
                skill_ids=(meta.skill_id,),
                metadata={
                    "skill_dir": str(skill_path),
                    "direction": direction,
                    "skill_name": meta.name,
                },
            )
        )
        if not jobs:
            return {
                "ok": False,
                "error": "Manual fix request did not produce a TriggerJob.",
                "skillId": meta.skill_id,
            }
        drain = getattr(runtime, "drain_evolution_jobs", None)
        outcomes = []
        if callable(drain):
            outcomes = await drain(job_ids=[job.job_id for job in jobs], limit=len(jobs))
        statuses = [
            str(getattr(item, "status", "") or "")
            for item in outcomes
        ]
        failed = [status for status in statuses if status.startswith("failed")]
        return {
            "ok": not failed,
            "skillId": meta.skill_id,
            "jobs": len(jobs),
            "outcomes": len(outcomes),
            "statuses": statuses,
            "error": "; ".join(failed) if failed else None,
        }

    return asyncio.run(run())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["list", "create", "delete", "evolve"])
    parser.add_argument("--cwd", default=str(Path.cwd()))
    parser.add_argument("--name")
    parser.add_argument("--description", default="")
    parser.add_argument("--path")
    parser.add_argument("--direction", default="")
    args = parser.parse_args()
    cwd = Path(args.cwd).expanduser()
    try:
        if args.action == "list":
            json.dump(list_payload(cwd), sys.stdout, ensure_ascii=False)
            return 0
        if args.action == "create":
            payload = create_local(args.name or "", args.description)
        elif args.action == "delete":
            payload = delete_local(args.path or "")
        else:
            payload = evolve_local(cwd, args.path or "", args.direction)
    except Exception as exc:
        json.dump({"ok": False, "error": str(exc)}, sys.stdout, ensure_ascii=False)
        return 1
    json.dump(payload, sys.stdout, ensure_ascii=False)
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
