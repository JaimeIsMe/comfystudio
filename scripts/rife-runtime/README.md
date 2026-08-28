# Velorn secure RIFE runtime builder

This directory builds the native RIFE runtime used by Velorn's cached Optical
Flow mode. It is intentionally separate from the application build so release
jobs can compile and inspect each native target before packaging.

The builder fetches exact Git commits, verifies the RIFE v4.6 model and updated
`stb` headers by SHA-256, applies the checked-in PNG-only patch, compiles the
runtime, and stages a complete release payload. It never initializes the
upstream `libwebp` submodule. OpenMP is disabled on every target to avoid an
unbundled `libgomp`, `libomp`, or `vcomp` dependency; interpolation remains
Vulkan/Metal accelerated.

## Requirements

- Python 3.8 or newer and Git.
- CMake and Ninja (override the generator with `--generator` if needed).
- A C/C++ compiler for the target architecture.
- Vulkan headers and loader libraries. Point `--vulkan-sdk` at an extracted,
  separately hash-verified Vulkan SDK when they are not installed system-wide.
- macOS builds require the pinned MoltenVK SDK and are linked with
  `USE_STATIC_MOLTENVK=ON`. Its pinned license is fetched independently and is
  required in the staged payload.
- Windows builds force CMake's `MultiThreaded` MSVC runtime (`/MT`). The binary
  audit rejects VCRUNTIME, MSVCP, UCRT helper, MinGW libstdc++, and related
  redistributable DLL dependencies rather than assuming they exist on a clean
  user's machine.

Release jobs should pin the runner image and build-tool versions. Those tool
versions and the complete CMake invocation are recorded in `PROVENANCE.json`.
The optional SDK archive URLs and SHA-256 values audited for release automation
are recorded in `pins.json`; this script does not silently download SDKs or run
their installers.

Linux release builds must run inside an Ubuntu 20.04 build root or container.
The builder inspects the resulting ELF and rejects anything requiring newer
than GLIBC 2.31 or GLIBCXX 3.4.28. A binary compiled directly on a newer host is
useful for local development only and cannot be staged as a release payload.

## Build commands

Run each target on a native runner unless a reviewed CMake toolchain is supplied:

```bash
python3 scripts/rife-runtime/build.py build \
  --platform linux --arch x64 --clean --replace

python3 scripts/rife-runtime/build.py build \
  --platform darwin --arch x64 --vulkan-sdk /path/to/vulkan-sdk \
  --clean --replace

python3 scripts/rife-runtime/build.py build \
  --platform darwin --arch arm64 --vulkan-sdk /path/to/vulkan-sdk \
  --clean --replace
```

From a Windows developer or CI shell:

```powershell
python scripts/rife-runtime/build.py build `
  --platform win32 --arch x64 --vulkan-sdk C:\VulkanSDK\1.4.335.0 `
  --work-dir "$env:RUNNER_TEMP\vrife" `
  --clean --replace
```

Extra CMake settings use `--cmake-arg=-DNAME=VALUE`. A non-native build also
requires both `--allow-cross` and an explicit `--toolchain-file`; the resulting
architecture is inspected before staging. Custom work directories must be a
direct child of the system temporary directory, `RUNNER_TEMP`, or Velorn's
dedicated build root. This keeps Windows CI paths short without allowing a
cleanup request to target an arbitrary directory.

## Stage contract

Each successful build creates exactly one of these directories:

```text
build/rife-runtime/linux-x64/rife/
build/rife-runtime/win-x64/rife/
build/rife-runtime/mac-x64/rife/
build/rife-runtime/mac-arm64/rife/
```

Each contains:

```text
rife-ncnn-vulkan[.exe]
rife-v4.6/flownet.bin
rife-v4.6/flownet.param
licenses/*.txt
PROVENANCE.json
```

`PROVENANCE.json` schema version 1 records the target, source commits, model
license evidence, PNG-only/WebP-disabled/OpenMP-disabled gates, patch hash,
tools, explicit `licenseFiles`, `binaryState: unsigned-source-build`, Linux ABI
baseline or `windowsCrt: static` where applicable, and SHA-256/size for every
other staged file. The
verifier rejects symlinks and requires a platform-native dependency and
architecture inspector. On a native builder it also requires `-h` to exit 0 and
print the PNG-only security banner. Standalone verification binds the
provenance to the exact checked-in patch, every target-applicable source
repository and commit, the model-license evidence, source epoch, target tuple,
and platform runtime compatibility contract; editing hashes in a
self-consistent manifest is not sufficient to substitute any of those inputs.

Inspect a target path without fetching or writing anything:

```bash
python3 scripts/rife-runtime/build.py plan --platform linux --arch x64
```

Verify a staged payload:

```bash
python3 scripts/rife-runtime/build.py verify \
  build/rife-runtime/linux-x64/rife
```

Signing changes executable bytes. Windows Authenticode or macOS code signing
must therefore occur before the release pipeline's final provenance hash is
sealed, or the executable entry must be regenerated and reverified afterward.
The builder's initial provenance describes the unsigned source-build output.

## Pinned network inputs

All source acquisitions use HTTPS and an exact commit:

- `https://github.com/nihui/rife-ncnn-vulkan.git` at
  `a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7`.
- `https://github.com/Tencent/ncnn.git` at
  `b4ba207c18d3103d6df890c0e3a97b469b196b26`.
- `https://github.com/KhronosGroup/glslang.git` at
  `86ff4bca1ddc7e2262f119c16e7228d0efb67610`.
- `https://github.com/nothings/stb.git` at
  `2c980bb59875b0d32144a71867fbdebb2f77cd20`.
- `https://github.com/hzwer/Practical-RIFE.git` at
  `bbfd2ea90910789a860ea3e2b32a240cd577b75e` for the original model license and
  its explicit trained-model licensing statement.
- macOS only: `https://github.com/KhronosGroup/MoltenVK.git` at
  `db445ff2042d9ce348c439ad8451112f354b8d2a` for the linked runtime notice.

The authoritative header, model, license, and optional SDK archive hashes are
kept in `pins.json` and are enforced before the corresponding input is used.
