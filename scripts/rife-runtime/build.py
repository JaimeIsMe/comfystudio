#!/usr/bin/env python3
"""Build and stage Velorn's pinned, PNG-only RIFE runtime.

The builder deliberately avoids recursive submodules: the wrapper's obsolete
libwebp revision is never fetched. Every source checkout and model/header input
is pinned and verified before CMake is allowed to execute.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform as host_platform_module
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Iterable, Optional, Union


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
PINS_PATH = SCRIPT_DIR / "pins.json"
PATCH_PATH = SCRIPT_DIR / "patches" / "0001-png-only.patch"

TARGET_IDS = {
    ("linux", "x64"): "linux-x64",
    ("win32", "x64"): "win-x64",
    ("darwin", "x64"): "mac-x64",
    ("darwin", "arm64"): "mac-arm64",
}

LICENSE_FILENAMES = {
    "wrapper": "LICENSE.rife-ncnn-vulkan.txt",
    "ncnn": "LICENSE.ncnn.txt",
    "glslang": "LICENSE.glslang.txt",
    "stb": "LICENSE.stb.txt",
    "practicalRife": "LICENSE.Practical-RIFE-models.txt",
}

MAC_LICENSE_FILENAMES = {
    "moltenVk": "LICENSE.MoltenVK.txt",
}

LINUX_ABI_BASELINE = {
    "distribution": "Ubuntu 20.04",
    "glibcMax": "2.31",
    "glibcxxMax": "3.4.28",
}

WINDOWS_FORBIDDEN_CRT_DEPENDENCIES = (
    "vcruntime",
    "msvcp",
    "ucrtbase",
    "api-ms-win-crt",
    "msvcrt.dll",
    "libgcc_s",
    "libstdc++",
    "libwinpthread",
)

WORK_MARKER = ".velorn-rife-build-root"


class BuildError(RuntimeError):
    pass


def load_pins() -> dict[str, Any]:
    with PINS_PATH.open("r", encoding="utf-8") as handle:
        pins = json.load(handle)
    if pins.get("schemaVersion") != 1:
        raise BuildError("pins.json must use schemaVersion 1")
    if pins.get("runtime", {}).get("pngOnly") is not True:
        raise BuildError("pins.json must require pngOnly=true")
    if pins.get("runtime", {}).get("webpDisabled") is not True:
        raise BuildError("pins.json must require webpDisabled=true")
    return pins


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_text_lf(path: Path, contents: str) -> None:
    """Write deterministic LF text on every supported Python/platform pair."""
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(contents)


def verify_file(path: Path, expected: dict[str, Any], label: str) -> None:
    if path.is_symlink() or not path.is_file():
        raise BuildError(f"Missing {label}: {path}")
    size = path.stat().st_size
    if "size" in expected and size != int(expected["size"]):
        raise BuildError(f"Unexpected size for {label}: expected {expected['size']}, got {size}")
    actual_hash = sha256_file(path)
    if actual_hash != expected["sha256"]:
        raise BuildError(
            f"SHA-256 mismatch for {label}: expected {expected['sha256']}, got {actual_hash}"
        )


def run(
    command: Iterable[Union[str, Path]],
    *,
    cwd: Optional[Path] = None,
    env: Optional[dict[str, str]] = None,
    capture: bool = False,
) -> str:
    rendered = [str(value) for value in command]
    print("+", " ".join(rendered), flush=True)
    result = subprocess.run(
        rendered,
        cwd=cwd,
        env=env,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    if result.returncode != 0:
        detail = f"\n{result.stdout.rstrip()}" if capture and result.stdout else ""
        raise BuildError(f"Command failed with status {result.returncode}: {' '.join(rendered)}{detail}")
    return (result.stdout or "").strip()


def require_tool(command: str) -> str:
    resolved = shutil.which(command)
    if not resolved:
        raise BuildError(f"Required build tool is not available: {command}")
    return resolved


def clone_exact(source: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "--quiet", destination])
    # Do not inherit a Windows user's core.autocrlf setting. The audited patch
    # and source hashes are intentionally based on exact LF checkout bytes.
    run(["git", "-C", destination, "config", "core.autocrlf", "false"])
    run(["git", "-C", destination, "config", "core.eol", "lf"])
    run(["git", "-C", destination, "remote", "add", "origin", source["repository"]])
    run(
        [
            "git",
            "-c",
            "protocol.file.allow=never",
            "-C",
            destination,
            "fetch",
            "--no-tags",
            "--depth=1",
            "origin",
            source["commit"],
        ]
    )
    run(["git", "-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"])
    actual = run(["git", "-C", destination, "rev-parse", "HEAD"], capture=True)
    if actual != source["commit"]:
        raise BuildError(
            f"Commit mismatch for {source['name']}: expected {source['commit']}, got {actual}"
        )


def safe_remove(
    path: Path,
    *,
    reason: str,
    allowed_parent: Path,
    required_marker: Optional[str] = None,
) -> None:
    if path.is_symlink():
        raise BuildError(f"Refusing to remove symlinked {reason} path: {path}")
    resolved = path.resolve()
    parent = allowed_parent.resolve()
    protected = {Path(resolved.anchor), Path.home().resolve(), REPO_ROOT.resolve(), parent}
    try:
        relative = resolved.relative_to(parent)
    except ValueError as error:
        raise BuildError(f"Refusing to remove {reason} outside {parent}: {resolved}") from error
    if resolved in protected or not relative.parts:
        raise BuildError(f"Refusing to remove unsafe {reason} path: {resolved}")
    if required_marker is not None:
        marker = resolved / WORK_MARKER
        if marker.is_symlink() or not marker.is_file():
            raise BuildError(f"Refusing to remove unmarked {reason} path: {resolved}")
        if marker.read_text(encoding="utf-8").strip() != required_marker:
            raise BuildError(f"Refusing to remove {reason} with an invalid marker: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)


def normalize_host_platform() -> str:
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform in {"win32", "cygwin"}:
        return "win32"
    raise BuildError(f"Unsupported host platform: {sys.platform}")


def normalize_host_arch() -> str:
    machine = host_platform_module.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x64"
    if machine in {"aarch64", "arm64"}:
        return "arm64"
    raise BuildError(f"Unsupported host architecture: {machine}")


def target_id(platform_name: str, arch: str) -> str:
    value = TARGET_IDS.get((platform_name, arch))
    if not value:
        supported = ", ".join(sorted(TARGET_IDS.values()))
        raise BuildError(f"Unsupported runtime target {platform_name}-{arch}; expected one of {supported}")
    return value


def resolve_moltenvk_layout(sdk_root: Path) -> tuple[Path, Path, Path]:
    root = sdk_root.resolve()
    candidates = (root, root / "MoltenVK", root / "MoltenVK" / "MoltenVK")
    relative_library = Path("static") / "MoltenVK.xcframework" / "macos-arm64_x86_64" / "libMoltenVK.a"
    for candidate in candidates:
        include_dir = candidate / "include"
        library = candidate / relative_library
        if include_dir.joinpath("vulkan", "vulkan.h").is_file() and library.is_file():
            return candidate, include_dir, library
    raise BuildError(
        "Could not find the pinned MoltenVK SDK layout below --vulkan-sdk; expected "
        "MoltenVK/include/vulkan/vulkan.h and "
        "MoltenVK/static/MoltenVK.xcframework/macos-arm64_x86_64/libMoltenVK.a"
    )


def verify_pinned_license(source_dir: Path, source: dict[str, Any], label: str) -> None:
    expected_hash = source.get("licenseSha256")
    if not expected_hash:
        return
    verify_file(
        source_dir / source["licensePath"],
        {"sha256": expected_hash, "size": source["licenseSize"]},
        f"{label} license",
    )


def prepare_source(
    work_dir: Path,
    pins: dict[str, Any],
    platform_name: str,
) -> tuple[Path, dict[str, Path]]:
    sources = pins["sources"]
    wrapper_dir = work_dir / "source"
    ncnn_dir = wrapper_dir / "src" / "ncnn"
    glslang_dir = ncnn_dir / "glslang"
    stb_dir = work_dir / "stb"
    practical_rife_dir = work_dir / "Practical-RIFE"

    clone_exact(sources["wrapper"], wrapper_dir)
    clone_exact(sources["ncnn"], ncnn_dir)
    clone_exact(sources["glslang"], glslang_dir)
    clone_exact(sources["stb"], stb_dir)
    clone_exact(sources["practicalRife"], practical_rife_dir)

    source_dirs = {
        "wrapper": wrapper_dir,
        "ncnn": ncnn_dir,
        "glslang": glslang_dir,
        "stb": stb_dir,
        "practicalRife": practical_rife_dir,
    }
    verify_pinned_license(practical_rife_dir, sources["practicalRife"], "Practical-RIFE")
    evidence = sources["practicalRife"]["modelLicenseEvidence"]
    verify_file(
        practical_rife_dir / evidence["path"],
        {"sha256": evidence["sha256"]},
        "Practical-RIFE model-license evidence",
    )

    if platform_name == "darwin":
        molten_vk_dir = work_dir / "MoltenVK"
        clone_exact(sources["moltenVk"], molten_vk_dir)
        verify_pinned_license(molten_vk_dir, sources["moltenVk"], "MoltenVK")
        source_dirs["moltenVk"] = molten_vk_dir

    for filename, expected in sources["stb"]["files"].items():
        source_header = stb_dir / filename
        verify_file(source_header, expected, f"stb/{filename}")
        shutil.copy2(source_header, wrapper_dir / "src" / filename)
        verify_file(wrapper_dir / "src" / filename, expected, f"patched source/{filename}")

    run(["git", "-C", wrapper_dir, "apply", "--check", PATCH_PATH])
    run(["git", "-C", wrapper_dir, "apply", PATCH_PATH])

    # These upstream WebP helpers are not referenced after the patch. Removing
    # them as well makes accidental reintroduction during later CMake edits fail
    # closed and guarantees the obsolete libwebp submodule is never acquired.
    for obsolete in (wrapper_dir / "src" / "FindWebP.cmake", wrapper_dir / "src" / "webp_image.h"):
        if not obsolete.is_file():
            raise BuildError(f"Expected obsolete WebP source was not present: {obsolete}")
        obsolete.unlink()
    libwebp_dir = wrapper_dir / "src" / "libwebp"
    if libwebp_dir.exists():
        if any(libwebp_dir.iterdir()):
            raise BuildError("libwebp must not be fetched into the secure runtime source tree")
        libwebp_dir.rmdir()

    audit_png_only_source(wrapper_dir)
    verify_model_source(wrapper_dir, pins)
    return wrapper_dir, source_dirs


def audit_png_only_source(wrapper_dir: Path) -> None:
    main_text = (wrapper_dir / "src" / "main.cpp").read_text(encoding="utf-8")
    cmake_text = (wrapper_dir / "src" / "CMakeLists.txt").read_text(encoding="utf-8")
    forbidden = (
        "webp_load",
        "webp_save",
        '#include "webp_image.h"',
        "find_package(WebP)",
        "add_subdirectory(libwebp)",
        "ncnn webp",
        "stbi_write_jpg",
    )
    combined = main_text + "\n" + cmake_text
    present = [token for token in forbidden if token in combined]
    if present:
        raise BuildError(f"PNG-only source audit failed; forbidden tokens remain: {present}")
    if 'set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")' not in cmake_text:
        raise BuildError("Source audit failed; Windows builds must use the static MSVC runtime")
    required = ("#define STBI_ONLY_PNG", "stbi_load_from_memory", "stbi_write_png_to_func")
    missing = [token for token in required if token not in main_text]
    if missing:
        raise BuildError(f"PNG-only source audit failed; required tokens are missing: {missing}")
    help_contracts = (
        "case L'h':\n            print_usage();\n            return 0;",
        "case 'h':\n            print_usage();\n            return 0;",
    )
    if any(contract not in main_text for contract in help_contracts):
        raise BuildError("Source audit failed; -h must exit 0 on Windows and POSIX")


def verify_model_source(wrapper_dir: Path, pins: dict[str, Any]) -> None:
    model = pins["model"]
    model_dir = wrapper_dir / model["sourcePath"]
    for filename, expected in model["files"].items():
        verify_file(model_dir / filename, expected, f"{model['name']}/{filename}")


def configure_and_build(
    args: argparse.Namespace,
    wrapper_dir: Path,
    work_dir: Path,
    pins: dict[str, Any],
) -> tuple[Path, dict[str, Any]]:
    cmake = require_tool(args.cmake)
    require_tool("git")
    build_dir = work_dir / "cmake-build"
    source_dir = wrapper_dir / "src"
    build_dir.mkdir(parents=True, exist_ok=True)

    environment = os.environ.copy()
    environment["SOURCE_DATE_EPOCH"] = str(pins["runtime"]["sourceDateEpoch"])
    environment["CMAKE_BUILD_PARALLEL_LEVEL"] = str(args.jobs)
    if args.vulkan_sdk:
        environment["VULKAN_SDK"] = str(args.vulkan_sdk.resolve())

    configure = [
        cmake,
        "-S",
        source_dir,
        "-B",
        build_dir,
        "-G",
        args.generator,
        "-DCMAKE_BUILD_TYPE=Release",
        "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
        "-DCMAKE_SKIP_RPATH=ON",
        "-DUSE_SYSTEM_NCNN=OFF",
        "-DNCNN_SYSTEM_GLSLANG=OFF",
        "-DNCNN_OPENMP=OFF",
        "-DCMAKE_DISABLE_FIND_PACKAGE_OpenMP=TRUE",
        "-DNCNN_BUILD_TESTS=OFF",
        "-DNCNN_BUILD_TOOLS=OFF",
        "-DNCNN_BUILD_EXAMPLES=OFF",
    ]

    if args.platform == "darwin":
        if not args.vulkan_sdk:
            raise BuildError("macOS RIFE builds require --vulkan-sdk pointing at extracted MoltenVK 1.4.1")
        molten_vk_root, molten_vk_include, molten_vk_library = resolve_moltenvk_layout(args.vulkan_sdk)
        environment["VULKAN_SDK"] = str(molten_vk_root)
        configure.extend(
            [
                "-DUSE_STATIC_MOLTENVK=ON",
                f"-DVulkan_INCLUDE_DIR={molten_vk_include}",
                f"-DVulkan_LIBRARY={molten_vk_library}",
                f"-DCMAKE_OSX_ARCHITECTURES={'x86_64' if args.arch == 'x64' else 'arm64'}",
                "-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0",
            ]
        )
    elif args.platform == "win32":
        configure.extend(
            [
                "-DCMAKE_POLICY_DEFAULT_CMP0091=NEW",
                "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
            ]
        )
        if args.generator.startswith("Visual Studio"):
            configure.extend(["-A", "x64"])
    else:
        prefix_map = f"-ffile-prefix-map={work_dir.resolve()}=/usr/src/velorn-rife"
        configure.extend(
            [
                f"-DCMAKE_C_FLAGS={prefix_map}",
                f"-DCMAKE_CXX_FLAGS={prefix_map}",
            ]
        )

    if args.toolchain_file:
        configure.append(f"-DCMAKE_TOOLCHAIN_FILE={args.toolchain_file.resolve()}")
    configure.extend(args.cmake_arg)

    run(configure, env=environment)
    run(
        [
            cmake,
            "--build",
            build_dir,
            "--config",
            "Release",
            "--target",
            pins["runtime"]["executableBaseName"],
            "--parallel",
            str(args.jobs),
        ],
        env=environment,
    )

    executable_name = pins["runtime"]["executableBaseName"] + (".exe" if args.platform == "win32" else "")
    candidates = [
        candidate
        for candidate in build_dir.rglob(executable_name)
        if candidate.is_file() and "CMakeFiles" not in candidate.parts
    ]
    if len(candidates) != 1:
        raise BuildError(f"Expected exactly one built {executable_name}, found: {candidates}")
    executable = candidates[0]
    if args.platform != "win32":
        executable.chmod(executable.stat().st_mode | 0o755)
    binary_audit = audit_binary(executable, work_dir, args.platform, args.arch)

    tools = {
        "cmake": run([cmake, "--version"], capture=True).splitlines()[0],
        "generator": args.generator,
        "python": sys.version.splitlines()[0],
    }
    cache_path = build_dir / "CMakeCache.txt"
    if cache_path.is_file():
        cache = cache_path.read_text(encoding="utf-8", errors="replace")
        for key in ("CMAKE_CXX_COMPILER", "CMAKE_CXX_COMPILER_VERSION"):
            marker = f"{key}:"
            for line in cache.splitlines():
                if line.startswith(marker) and "=" in line:
                    tools[key] = line.split("=", 1)[1]
                    break
    return executable, {
        "tools": tools,
        "cmakeArgs": [str(value) for value in configure[1:]],
        "binaryAudit": binary_audit,
    }


def parse_version(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def maximum_symbol_version(output: str, family: str) -> Optional[str]:
    pattern = rf"(?<![A-Z]){re.escape(family)}_([0-9]+(?:\.[0-9]+)+)"
    versions = {match.group(1) for match in re.finditer(pattern, output)}
    return max(versions, key=parse_version) if versions else None


def validate_linux_abi(output: str) -> dict[str, str]:
    glibc = maximum_symbol_version(output, "GLIBC")
    glibcxx = maximum_symbol_version(output, "GLIBCXX")
    if not glibc or not glibcxx:
        raise BuildError("Could not determine required GLIBC and GLIBCXX symbol versions")
    if parse_version(glibc) > parse_version(LINUX_ABI_BASELINE["glibcMax"]):
        raise BuildError(
            f"Linux runtime requires GLIBC_{glibc}, newer than the "
            f"{LINUX_ABI_BASELINE['distribution']} ceiling GLIBC_{LINUX_ABI_BASELINE['glibcMax']}"
        )
    if parse_version(glibcxx) > parse_version(LINUX_ABI_BASELINE["glibcxxMax"]):
        raise BuildError(
            f"Linux runtime requires GLIBCXX_{glibcxx}, newer than the "
            f"{LINUX_ABI_BASELINE['distribution']} ceiling GLIBCXX_{LINUX_ABI_BASELINE['glibcxxMax']}"
        )
    return {"glibcRequired": glibc, "glibcxxRequired": glibcxx}


def audit_binary(
    executable: Path,
    work_dir: Path,
    platform_name: str,
    arch: str,
) -> dict[str, Any]:
    if executable.is_symlink() or not executable.is_file():
        raise BuildError(f"Runtime executable must be a regular file, not a symlink: {executable}")
    binary_bytes = executable.read_bytes().lower()
    secure_banner = b"velorn secure build: png input and output only; webp is disabled."
    if secure_banner not in binary_bytes:
        raise BuildError("Built executable is missing the PNG-only security banner")
    if b"webp" in binary_bytes.replace(secure_banner, b""):
        raise BuildError("Built executable contains a WebP reference outside the security banner")

    dependency_output = ""
    metadata: dict[str, Any] = {}
    if platform_name == "linux":
        readelf = require_tool("readelf")
        header = run([readelf, "-h", executable], capture=True)
        if arch != "x64" or "ELF64" not in header or "Advanced Micro Devices X86-64" not in header:
            raise BuildError(f"Linux runtime architecture does not match {arch}")
        dependency_output = run([readelf, "-d", executable], capture=True)
        versions = run([readelf, "--version-info", executable], capture=True)
        metadata.update(validate_linux_abi(versions))
        metadata.update({"architecture": "x86_64", "inspector": Path(readelf).name})
    elif platform_name == "darwin":
        otool = require_tool("otool")
        lipo = require_tool("lipo")
        architectures = run([lipo, "-archs", executable], capture=True).split()
        expected = "x86_64" if arch == "x64" else "arm64"
        if architectures != [expected]:
            raise BuildError(f"macOS runtime architecture mismatch: expected {expected}, got {architectures}")
        dependency_output = run([otool, "-L", executable], capture=True)
        metadata.update({"architecture": expected, "inspector": Path(otool).name})
    elif platform_name == "win32":
        dumpbin = shutil.which("dumpbin")
        llvm_readobj = shutil.which("llvm-readobj")
        objdump = shutil.which("objdump")
        if dumpbin:
            header = run([dumpbin, "/HEADERS", executable], capture=True)
            dependency_output = run([dumpbin, "/DEPENDENTS", executable], capture=True)
            valid_arch = "machine (x64)" in header.lower()
            inspector = "dumpbin"
        elif llvm_readobj:
            header = run([llvm_readobj, "--file-headers", executable], capture=True)
            dependency_output = run([llvm_readobj, "--needed-libs", executable], capture=True)
            valid_arch = "x86_64" in header.lower()
            inspector = "llvm-readobj"
        elif objdump:
            header = run([objdump, "-f", executable], capture=True)
            dependency_output = run([objdump, "-p", executable], capture=True)
            valid_arch = "pei-x86-64" in header.lower() or "i386:x86-64" in header.lower()
            inspector = "objdump"
        else:
            raise BuildError("Windows runtime audit requires dumpbin, llvm-readobj, or objdump")
        if arch != "x64" or not valid_arch:
            raise BuildError(f"Windows runtime architecture does not match {arch}")
        metadata.update({"architecture": "x86_64", "inspector": inspector})

    lowered = dependency_output.lower()
    if "webp" in lowered:
        raise BuildError("Built executable has a WebP dynamic dependency")
    if any(name in lowered for name in ("libgomp", "libomp", "vcomp")):
        raise BuildError("Built executable unexpectedly depends on an OpenMP runtime")
    if platform_name == "win32":
        forbidden_crt = [name for name in WINDOWS_FORBIDDEN_CRT_DEPENDENCIES if name in lowered]
        if forbidden_crt:
            raise BuildError(
                "Windows runtime unexpectedly depends on redistributable CRT helpers: "
                f"{forbidden_crt}"
            )
    if str(work_dir.resolve()).lower() in lowered:
        raise BuildError("Built executable contains a build-directory runtime dependency")

    try:
        is_native_target = (
            platform_name == normalize_host_platform() and arch == normalize_host_arch()
        )
    except BuildError:
        is_native_target = False
    if is_native_target:
        help_result = subprocess.run(
            [str(executable), "-h"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        help_output = help_result.stdout or b""
        if help_result.returncode != 0:
            raise BuildError(
                f"Runtime help command must exit 0 on every platform; got {help_result.returncode}"
            )
        if secure_banner not in help_output.lower():
            raise BuildError("Runtime help output is missing the PNG-only security banner")
        metadata["helpExitCode"] = 0
    return metadata


def copy_license(source_root: Path, relative_path: str, destination: Path, label: str) -> None:
    source = source_root / relative_path
    if not source.is_file() or source.stat().st_size == 0:
        raise BuildError(f"Missing or empty {label} license: {source}")
    shutil.copy2(source, destination)


def file_manifest(stage_dir: Path) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for path in sorted(stage_dir.rglob("*")):
        if path.is_symlink():
            raise BuildError(f"Staged runtime must not contain symlinks: {path}")
        if not path.is_file() or path.name == "PROVENANCE.json":
            continue
        relative = path.relative_to(stage_dir).as_posix()
        entries[relative] = {"sha256": sha256_file(path), "size": path.stat().st_size}
    return entries


def stage_runtime(
    args: argparse.Namespace,
    executable: Path,
    wrapper_dir: Path,
    source_dirs: dict[str, Path],
    pins: dict[str, Any],
    build_metadata: dict[str, Any],
) -> Path:
    identifier = target_id(args.platform, args.arch)
    output_root = args.output_root.resolve()
    stage_dir = output_root / identifier / "rife"
    if stage_dir.exists() and not args.replace:
        raise BuildError(f"Stage already exists; pass --replace to replace it: {stage_dir}")

    output_root.mkdir(parents=True, exist_ok=True)
    temporary_parent = output_root / identifier
    temporary_parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".rife.stage-", dir=temporary_parent))
    try:
        executable_name = pins["runtime"]["executableBaseName"] + (
            ".exe" if args.platform == "win32" else ""
        )
        shutil.copy2(executable, temporary / executable_name)
        if args.platform != "win32":
            (temporary / executable_name).chmod(0o755)

        model_destination = temporary / pins["model"]["name"]
        model_destination.mkdir()
        model_source = wrapper_dir / pins["model"]["sourcePath"]
        for filename, expected in pins["model"]["files"].items():
            verify_file(model_source / filename, expected, f"model/{filename}")
            shutil.copy2(model_source / filename, model_destination / filename)
            verify_file(model_destination / filename, expected, f"staged model/{filename}")

        licenses_dir = temporary / "licenses"
        licenses_dir.mkdir()
        applicable_licenses = dict(LICENSE_FILENAMES)
        if args.platform == "darwin":
            applicable_licenses.update(MAC_LICENSE_FILENAMES)
        for key, filename in applicable_licenses.items():
            source = pins["sources"][key]
            verify_pinned_license(source_dirs[key], source, key)
            copy_license(source_dirs[key], source["licensePath"], licenses_dir / filename, key)

        license_files = sorted(f"licenses/{filename}" for filename in applicable_licenses.values())

        patch_hash = sha256_file(PATCH_PATH)
        provenance = {
            "schemaVersion": 1,
            "platform": args.platform,
            "arch": args.arch,
            "target": identifier,
            "wrapper": {
                "repository": pins["sources"]["wrapper"]["repository"],
                "commit": pins["sources"]["wrapper"]["commit"],
            },
            "sources": {
                key: {
                    "repository": value["repository"],
                    "commit": value["commit"],
                }
                for key, value in pins["sources"].items()
                if key in source_dirs
            },
            "model": pins["model"]["name"],
            "modelLicenseEvidence": {
                "repository": pins["sources"]["practicalRife"]["repository"],
                "commit": pins["sources"]["practicalRife"]["commit"],
                **pins["sources"]["practicalRife"]["modelLicenseEvidence"],
            },
            "pngOnly": True,
            "webpDisabled": True,
            "openMpDisabled": True,
            "binaryState": "unsigned-source-build",
            "licenseFiles": license_files,
            "sourceDateEpoch": pins["runtime"]["sourceDateEpoch"],
            "sourcePatch": {
                "path": PATCH_PATH.relative_to(REPO_ROOT).as_posix(),
                "sha256": patch_hash,
                "removedUpstreamFiles": ["src/FindWebP.cmake", "src/webp_image.h"],
                "unfetchedSubmodules": ["src/libwebp"],
            },
            "build": build_metadata,
            "files": file_manifest(temporary),
        }
        if args.platform == "linux":
            provenance["linuxAbiBaseline"] = dict(LINUX_ABI_BASELINE)
        if args.platform == "win32":
            provenance["windowsCrt"] = "static"
        provenance_path = temporary / "PROVENANCE.json"
        write_text_lf(provenance_path, json.dumps(provenance, indent=2, sort_keys=True) + "\n")
        verify_staged_runtime(temporary)

        if stage_dir.exists():
            safe_remove(
                stage_dir,
                reason="existing RIFE stage",
                allowed_parent=temporary_parent,
            )
        temporary.rename(stage_dir)
    except Exception:
        if temporary.exists():
            safe_remove(
                temporary,
                reason="temporary RIFE stage",
                allowed_parent=temporary_parent,
            )
        raise
    return stage_dir


def verify_staged_runtime(stage_dir: Path) -> dict[str, Any]:
    if stage_dir.is_symlink() or not stage_dir.is_dir():
        raise BuildError(f"Staged runtime must be a regular directory, not a symlink: {stage_dir}")
    provenance_path = stage_dir / "PROVENANCE.json"
    if provenance_path.is_symlink() or not provenance_path.is_file():
        raise BuildError(f"Missing staged provenance: {provenance_path}")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BuildError(f"Invalid staged provenance: {provenance_path}") from error
    if not isinstance(provenance, dict):
        raise BuildError("PROVENANCE.json root must be an object")
    required_fields = (
        "schemaVersion",
        "platform",
        "arch",
        "target",
        "wrapper",
        "sources",
        "model",
        "modelLicenseEvidence",
        "pngOnly",
        "webpDisabled",
        "openMpDisabled",
        "binaryState",
        "licenseFiles",
        "sourceDateEpoch",
        "sourcePatch",
        "files",
    )
    missing = [field for field in required_fields if field not in provenance]
    if missing:
        raise BuildError(f"PROVENANCE.json is missing required fields: {missing}")
    if provenance["schemaVersion"] != 1:
        raise BuildError("PROVENANCE.json must use schemaVersion 1")
    if provenance["pngOnly"] is not True or provenance["webpDisabled"] is not True:
        raise BuildError("PROVENANCE.json does not describe a PNG-only, WebP-disabled runtime")
    if provenance["openMpDisabled"] is not True:
        raise BuildError("PROVENANCE.json must record openMpDisabled=true")
    if provenance["binaryState"] != "unsigned-source-build":
        raise BuildError("PROVENANCE.json must identify the unsigned source-build payload")
    pins = load_pins()
    if provenance["model"] != pins["model"]["name"]:
        raise BuildError(f"Unexpected staged model: {provenance['model']}")

    platform_name = provenance["platform"]
    architecture = provenance["arch"]
    if not isinstance(platform_name, str) or not isinstance(architecture, str):
        raise BuildError("PROVENANCE.json platform and arch must be strings")
    identifier = target_id(platform_name, architecture)
    if provenance["target"] != identifier:
        raise BuildError(
            f"PROVENANCE.json target does not match platform/arch: {provenance['target']}"
        )
    if platform_name == "linux" and provenance.get("linuxAbiBaseline") != LINUX_ABI_BASELINE:
        raise BuildError(
            "PROVENANCE.json must record the Ubuntu 20.04 GLIBC/GLIBCXX compatibility baseline"
        )
    if platform_name != "linux" and "linuxAbiBaseline" in provenance:
        raise BuildError("PROVENANCE.json records a Linux ABI baseline for a non-Linux target")
    if platform_name == "win32" and provenance.get("windowsCrt") != "static":
        raise BuildError("PROVENANCE.json must record windowsCrt=static")
    if platform_name != "win32" and "windowsCrt" in provenance:
        raise BuildError("PROVENANCE.json records a Windows CRT contract for a non-Windows target")

    wrapper_source = pins["sources"]["wrapper"]
    expected_wrapper = {
        "repository": wrapper_source["repository"],
        "commit": wrapper_source["commit"],
    }
    if provenance["wrapper"] != expected_wrapper:
        raise BuildError("PROVENANCE.json wrapper repository or commit is not trusted")

    source_keys = set(LICENSE_FILENAMES)
    if platform_name == "darwin":
        source_keys.update(MAC_LICENSE_FILENAMES)
    expected_sources = {
        key: {
            "repository": pins["sources"][key]["repository"],
            "commit": pins["sources"][key]["commit"],
        }
        for key in source_keys
    }
    if provenance["sources"] != expected_sources:
        raise BuildError("PROVENANCE.json source repositories or commits are not trusted")

    practical_rife = pins["sources"]["practicalRife"]
    expected_model_license_evidence = {
        "repository": practical_rife["repository"],
        "commit": practical_rife["commit"],
        **practical_rife["modelLicenseEvidence"],
    }
    if provenance["modelLicenseEvidence"] != expected_model_license_evidence:
        raise BuildError("PROVENANCE.json model-license evidence is not trusted")

    expected_source_patch = {
        "path": PATCH_PATH.relative_to(REPO_ROOT).as_posix(),
        "sha256": sha256_file(PATCH_PATH),
        "removedUpstreamFiles": ["src/FindWebP.cmake", "src/webp_image.h"],
        "unfetchedSubmodules": ["src/libwebp"],
    }
    if provenance["sourcePatch"] != expected_source_patch:
        raise BuildError("PROVENANCE.json source-patch metadata does not match the trusted patch")
    if provenance["sourceDateEpoch"] != pins["runtime"]["sourceDateEpoch"]:
        raise BuildError("PROVENANCE.json sourceDateEpoch does not match the pinned build")

    if not isinstance(provenance["licenseFiles"], list) or not all(
        isinstance(value, str) for value in provenance["licenseFiles"]
    ):
        raise BuildError("PROVENANCE.json licenseFiles must be a list of paths")
    if not isinstance(provenance["files"], dict):
        raise BuildError("PROVENANCE.json files must be an object")
    executable_name = "rife-ncnn-vulkan.exe" if platform_name == "win32" else "rife-ncnn-vulkan"
    expected_license_files = {f"licenses/{filename}" for filename in LICENSE_FILENAMES.values()}
    if platform_name == "darwin":
        expected_license_files.update(f"licenses/{filename}" for filename in MAC_LICENSE_FILENAMES.values())
    if set(provenance["licenseFiles"]) != expected_license_files:
        raise BuildError("PROVENANCE.json licenseFiles do not match the target's required licenses")
    required_paths = {
        executable_name,
        "rife-v4.6/flownet.bin",
        "rife-v4.6/flownet.param",
        *expected_license_files,
    }
    actual_files = file_manifest(stage_dir)
    missing_paths = sorted(required_paths - set(actual_files))
    if missing_paths:
        raise BuildError(f"Staged runtime is missing required files: {missing_paths}")
    if actual_files != provenance["files"]:
        raise BuildError("Staged runtime hashes or sizes do not match PROVENANCE.json")
    for filename, expected in pins["model"]["files"].items():
        verify_file(stage_dir / "rife-v4.6" / filename, expected, f"staged model/{filename}")
    source_for_license_file = {
        filename: key for key, filename in {**LICENSE_FILENAMES, **MAC_LICENSE_FILENAMES}.items()
    }
    for relative in expected_license_files:
        filename = Path(relative).name
        source = pins["sources"][source_for_license_file[filename]]
        verify_file(
            stage_dir / relative,
            {"sha256": source["licenseSha256"], "size": source["licenseSize"]},
            relative,
        )
    for relative in required_paths:
        if relative.startswith("licenses/") and actual_files[relative]["size"] <= 0:
            raise BuildError(f"Staged license is empty: {relative}")
    audit_binary(stage_dir / executable_name, stage_dir, platform_name, provenance["arch"])
    return provenance


def make_parser() -> argparse.ArgumentParser:
    pins = load_pins()
    try:
        host_platform = normalize_host_platform()
        host_arch = normalize_host_arch()
    except BuildError:
        host_platform, host_arch = "linux", "x64"

    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="fetch, verify, compile, and stage a runtime")
    build.add_argument("--platform", choices=("linux", "win32", "darwin"), default=host_platform)
    build.add_argument("--arch", choices=("x64", "arm64"), default=host_arch)
    build.add_argument("--output-root", type=Path, default=REPO_ROOT / "build" / "rife-runtime")
    build.add_argument("--work-dir", type=Path)
    build.add_argument("--clean", action="store_true", help="remove the exact work directory before building")
    build.add_argument("--replace", action="store_true", help="replace the exact existing target stage")
    build.add_argument("--allow-cross", action="store_true", help="allow a non-native target with a supplied toolchain")
    build.add_argument("--toolchain-file", type=Path)
    build.add_argument("--vulkan-sdk", type=Path)
    build.add_argument("--cmake", default="cmake")
    build.add_argument("--generator", default="Ninja")
    build.add_argument("--cmake-arg", action="append", default=[], help="additional CMake argument; use --cmake-arg=-DNAME=VALUE")
    build.add_argument("--jobs", type=int, default=max(1, os.cpu_count() or 1))

    plan = subparsers.add_parser("plan", help="print the target contract without changing files")
    plan.add_argument("--platform", choices=("linux", "win32", "darwin"), default=host_platform)
    plan.add_argument("--arch", choices=("x64", "arm64"), default=host_arch)
    plan.add_argument("--output-root", type=Path, default=REPO_ROOT / "build" / "rife-runtime")
    plan.add_argument("--vulkan-sdk", type=Path)

    verify = subparsers.add_parser("verify", help="verify a staged runtime and its provenance")
    verify.add_argument("stage", type=Path)
    return parser


def main() -> int:
    parser = make_parser()
    args = parser.parse_args()
    pins = load_pins()

    try:
        if args.command == "plan":
            identifier = target_id(args.platform, args.arch)
            executable = pins["runtime"]["executableBaseName"] + (".exe" if args.platform == "win32" else "")
            result = {
                "platform": args.platform,
                "arch": args.arch,
                "target": identifier,
                "stage": str((args.output_root.resolve() / identifier / "rife")),
                "executable": executable,
                "model": pins["model"]["name"],
                "pngOnly": True,
                "webpDisabled": True,
                "openMpDisabled": True,
            }
            if args.platform == "linux":
                result["linuxAbiBaseline"] = dict(LINUX_ABI_BASELINE)
            if args.platform == "win32":
                result["windowsCrt"] = "static"
                result["forbiddenRuntimeDependencies"] = list(
                    WINDOWS_FORBIDDEN_CRT_DEPENDENCIES
                )
            if args.platform == "darwin":
                result["staticMoltenVk"] = True
                result["requiredMoltenVkArchiveSha256"] = pins["optionalSdks"]["moltenVkMac"]["sha256"]
                if args.vulkan_sdk:
                    molten_root, molten_include, molten_library = resolve_moltenvk_layout(args.vulkan_sdk)
                    result["moltenVkRoot"] = str(molten_root)
                    result["vulkanInclude"] = str(molten_include)
                    result["vulkanLibrary"] = str(molten_library)
            print(json.dumps(result, indent=2, sort_keys=True))
            return 0

        if args.command == "verify":
            provenance = verify_staged_runtime(args.stage.absolute())
            print(
                f"Verified {provenance['target']} RIFE runtime: "
                f"{len(provenance['files'])} hashed payload files"
            )
            return 0

        identifier = target_id(args.platform, args.arch)
        host_platform = normalize_host_platform()
        host_arch = normalize_host_arch()
        is_cross_build = (args.platform, args.arch) != (host_platform, host_arch)
        if is_cross_build:
            if not args.allow_cross:
                raise BuildError(
                    f"Target {identifier} is not native to {host_platform}-{host_arch}; "
                    "use a native runner or pass --allow-cross with the appropriate toolchain"
                )
            if not args.toolchain_file:
                raise BuildError("Cross-builds require an explicit --toolchain-file")
        if args.toolchain_file and (
            args.toolchain_file.is_symlink() or not args.toolchain_file.is_file()
        ):
            raise BuildError(f"CMake toolchain file is missing or is a symlink: {args.toolchain_file}")
        if args.jobs < 1:
            raise BuildError("--jobs must be at least 1")

        default_work_root = (REPO_ROOT / "build" / "rife-runtime-work").resolve()
        requested_work_dir = args.work_dir or (default_work_root / identifier)
        if requested_work_dir.is_symlink():
            raise BuildError(f"--work-dir must not be a symlink: {requested_work_dir}")
        work_dir = requested_work_dir.resolve()
        allowed_work_roots = [default_work_root, Path(tempfile.gettempdir()).resolve()]
        if os.environ.get("RUNNER_TEMP"):
            allowed_work_roots.append(Path(os.environ["RUNNER_TEMP"]).resolve())
        matched_work_root = None
        for candidate_root in allowed_work_roots:
            try:
                relative = work_dir.relative_to(candidate_root)
            except ValueError:
                continue
            if len(relative.parts) == 1:
                matched_work_root = candidate_root
                break
        if matched_work_root is None:
            roots = ", ".join(str(value) for value in allowed_work_roots)
            raise BuildError(
                "--work-dir must be a direct child of a controlled build or temporary root: "
                f"{roots}"
            )
        if work_dir.exists():
            if not args.clean:
                raise BuildError(f"Work directory already exists; pass --clean to replace it: {work_dir}")
            safe_remove(
                work_dir,
                reason="RIFE work directory",
                allowed_parent=matched_work_root,
                required_marker=identifier,
            )
        work_dir.mkdir(parents=True)
        write_text_lf(work_dir / WORK_MARKER, f"{identifier}\n")

        require_tool("git")
        wrapper_dir, source_dirs = prepare_source(work_dir, pins, args.platform)
        executable, build_metadata = configure_and_build(args, wrapper_dir, work_dir, pins)
        stage_dir = stage_runtime(
            args,
            executable,
            wrapper_dir,
            source_dirs,
            pins,
            build_metadata,
        )
        print(f"Built and verified {identifier} RIFE runtime at {stage_dir}")
        return 0
    except BuildError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
