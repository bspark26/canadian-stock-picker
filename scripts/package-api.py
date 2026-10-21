"""Build Linux/x86_64 Python 3.12 Lambda zip on Mac or Linux."""
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".tmp/lambda-package"
OUTPUT = ROOT / ".tmp/analysis-api.zip"


def main():
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)
    subprocess.run([
        sys.executable, "-m", "pip", "install", "--platform", "manylinux2014_x86_64",
        "--implementation", "cp", "--python-version", "3.12", "--only-binary=:all:",
        "--target", str(BUILD), "-r", str(ROOT / "infra/requirements.txt"),
    ], check=True)
    # Package application code only; never copy the repo, .env, raw cache or keys.
    for folder in ("api", "scanner"):
        shutil.copytree(ROOT / folder, BUILD / folder, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for relative in ("config/defaults.json", "models/probability.json"):
        destination = BUILD / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
    files = [p for p in BUILD.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    total = sum(p.stat().st_size for p in files)
    if total >= 250 * 1024 * 1024:
        raise SystemExit("Package exceeds Lambda's uncompressed limit; use a container build.")
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, path.relative_to(BUILD))
    print(f"Built {OUTPUT}: {OUTPUT.stat().st_size / 1024**2:.1f} MiB zipped / {total / 1024**2:.1f} MiB unpacked")


if __name__ == "__main__":
    main()
