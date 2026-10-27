"""Build a portable GUI + capture worker; no client or Python needed at runtime."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-root", type=Path, required=True, help="EndfieldLogsClient/_internal")
    parser.add_argument("--toolchain", help="Optional rustup toolchain")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent
    core = args.core_root.resolve()
    sys.path.insert(0, str(project / "capture"))
    from skill_actions import write_maps
    write_maps(core, project / "data")
    data_files = [
        "data/message_ids_cs.json", "data/message_ids_sc.json",
        "data/packet_semantics/packet_resolver_bundle.json",
        "data/local_tables/NumIdStrTable.json",
        "jsondata/CharacterNameIndex.json", "jsondata/Dungeon.json",
        "secrets/client_privkey.pem",
    ]
    for name in ["src/endfield_pcap/service.py", *data_files]:
        if not (core / name).is_file():
            parser.error(f"Missing capture core file: {core / name}")
    work = project / "work"
    work.mkdir(exist_ok=True)
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console",
               "--name", "endfield-capture", "--paths", str(core / "src"),
               "--collect-submodules", "endfield_pcap.proto_generated",
               "--collect-all", "Crypto", "--distpath", str(work / "dist"),
               "--workpath", str(work / "pyinstaller"), "--specpath", str(work)]
    for name in data_files:
        command += ["--add-data", str(core / name) + os.pathsep + str(Path(name).parent)]
    command += [str(project / "capture/worker.py")]
    build_env = os.environ.copy()
    build_env["PYTHONPATH"] = str(core / "src") + os.pathsep + build_env.get("PYTHONPATH", "")
    subprocess.run(command, cwd=project, env=build_env, check=True)
    subprocess.run([str(work / "dist/endfield-capture/endfield-capture.exe"),
                    "--log-dir", str(work / "packaging-check"), "--check-protocols"], check=True)
    cargo = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo.exe")
    command = [cargo]
    if args.toolchain:
        command += ["+" + args.toolchain]
    target = project / "target"
    command += ["build", "--release", "--locked", "--target-dir", str(target)]
    subprocess.run(command, cwd=project, check=True)
    output = project / "dist/endfield-action-capture"
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(target / "release/endfield-action-capture.exe", output)
    shutil.copytree(work / "dist/endfield-capture", output / "capture", dirs_exist_ok=True)
    shutil.copy2(project / "README.md", output)
    shutil.copytree(project / "data", output / "data", dirs_exist_ok=True)
    print(f"Portable application: {output}")


if __name__ == "__main__":
    main()
