#!/usr/bin/env python3
"""Build a source bundle (.tgz) of the working tree for deployment.

Uses git's file lists (tracked + untracked-not-ignored) so node_modules,
generated, storage, dist, .git, etc. are excluded. Python's tarfile is used
instead of shelling out to `tar`, which hangs in Git Bash on Windows.

Usage: python make_bundle.py <output.tgz>
"""
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else (ROOT / "bundle.tgz")

# Skip the local launch artifacts and any worktrees / nested git dirs.
SKIP_PREFIXES = (".claude/", "deploy/aws/stack62-key.pem", "deploy/aws/.env.aws", "deploy/aws/.state")


def git_files(*args):
    out = subprocess.run(
        ["git", "-C", str(ROOT), *args],
        capture_output=True, check=True,
    ).stdout
    return [p for p in out.split(b"\0") if p]


def main():
    tracked = git_files("ls-files", "-z")
    untracked = git_files("ls-files", "-o", "--exclude-standard", "-z")
    rels = []
    seen = set()
    for raw in tracked + untracked:
        rel = raw.decode("utf-8", "surrogateescape")
        if rel in seen:
            continue
        if any(rel.startswith(p) for p in SKIP_PREFIXES):
            continue
        seen.add(rel)
        rels.append(rel)

    count = 0
    with tarfile.open(OUT, "w:gz") as tar:
        for rel in rels:
            fp = ROOT / rel
            if not fp.is_file():
                continue
            try:
                tar.add(fp, arcname=rel, recursive=False)
                count += 1
            except (PermissionError, OSError) as e:
                print(f"  skip {rel}: {e}", file=sys.stderr)

    size_mb = OUT.stat().st_size / 1_048_576
    print(f"Bundle: {OUT} — {count} files, {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
