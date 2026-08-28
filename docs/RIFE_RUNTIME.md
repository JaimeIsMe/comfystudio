# Velorn RIFE runtime

Velorn's cached Optical Flow mode uses a Velorn-owned, PNG-only build of
`rife-ncnn-vulkan` with the pinned `rife-v4.6` model. The renderer cannot supply
an executable or model path. Electron resolves one fixed runtime and runs one
isolated GPU job at a time.

## Development runtime

Local development resolves this ignored layout:

```text
.runtime/rife/
  rife-ncnn-vulkan[.exe]
  rife-v4.6/
    flownet.bin
    flownet.param
```

`VELORN_RIFE_RUNTIME_DIR` can point to the same layout in development only. A
packaged application always ignores this override and resolves
`resources/bin/rife`.

A development runtime without provenance is deliberately treated as an
untrusted local fixture. If `PROVENANCE.json` is present, Velorn validates the
same trusted schema, hashes, licenses, target, executable architecture, and
model pins required in a package. An invalid provenance file makes even the
development runtime unavailable.

Runtime binaries and model weights must not be committed to this repository.

## Pinned source build

The source builder is `scripts/rife-runtime/build.py`. It fetches exact commits,
does not fetch the obsolete libwebp submodule, applies the reviewed PNG-only
patch, verifies the pinned model and replacement stb headers, builds ncnn and
the wrapper, audits the result, and stages it atomically.

Build the runtime natively for the target:

```bash
python3 scripts/rife-runtime/build.py build \
  --platform linux \
  --arch x64 \
  --clean \
  --replace
```

Supported pairs are:

- `linux` / `x64`
- `win32` / `x64`
- `darwin` / `x64`
- `darwin` / `arm64`

`plan` prints the resolved target without changing files. `verify <stage>`
rechecks an existing stage. Cross-compilation is rejected unless the caller
explicitly supplies `--allow-cross` and the applicable toolchain; releases use
native runners instead.

Platform builds need a Vulkan SDK. Linux can use distribution Vulkan headers
and loader libraries. Windows uses the pinned LunarG SDK. macOS uses the pinned
MoltenVK headers and universal static library, passed through
`--vulkan-sdk` and `--cmake-arg`.

The Linux release helper is built inside Ubuntu 20.04, establishing Ubuntu
20.04 as the minimum Linux runtime baseline for RIFE. The package gate scans the
ELF version requirements and rejects helpers above `GLIBC_2.31` or
`GLIBCXX_3.4.28`, even if they happen to run on the newer outer packaging host.

## Staging and packaged layout

The builder stages one target at:

```text
build/rife-runtime/<target>/rife/
  rife-ncnn-vulkan[.exe]
  rife-v4.6/
    flownet.bin
    flownet.param
  licenses/
    LICENSE.rife-ncnn-vulkan.txt
    LICENSE.ncnn.txt
    LICENSE.glslang.txt
    LICENSE.stb.txt
    LICENSE.Practical-RIFE-models.txt
    LICENSE.MoltenVK.txt              # macOS only
  PROVENANCE.json
```

Target IDs are `win-x64`, `linux-x64`, `mac-x64`, and `mac-arm64`.
Electron Builder copies only the current target to:

```text
resources/bin/rife/
```

It also copies exactly one target-native FFmpeg and FFprobe binary, plus each
downloaded asset's companion `README` and `LICENSE`, to `resources/bin`. Both
packages are pinned to version `5.3.0`; their decompressed binary and notice
sizes and SHA-256 values are compiled into the package gate. Release jobs set
`npm_config_platform` and `npm_config_arch` before a clean install. macOS Intel
and Apple Silicon therefore run separate native installs and builds.

The small package resolver files (`index.js`, `package.json`, ordinary package
README, and package license) remain in `app.asar`. The lower-case downloaded
`ffmpeg*` and `ffprobe*` binary/sidecar payloads are excluded from dependency
packaging so `resources/bin` is their only shipped copy. The unpacked-package
gate inspects both `app.asar` and `app.asar.unpacked` and rejects duplicates.

## Trust and packaging gates

`PROVENANCE.json` schema version 1 records the target platform/architecture,
pinned wrapper and dependency commits, `rife-v4.6`, the PNG-only/WebP-disabled
security properties, build tools and arguments, declared license files, and a
SHA-256 plus size for every shipped payload file.

The gate fails when any of these checks fails:

- Runtime executable, model, provenance, or a declared license is missing,
  empty, symlinked, unmanifested, or unexpectedly present.
- A payload size or SHA-256 differs from provenance before signing, or on
  Linux at any time.
- The model files differ from Velorn's compiled-in `rife-v4.6` hashes.
- Provenance names a different target, wrapper commit, model, schema, or
  security posture.
- The executable format or machine architecture differs from the package
  target, or a POSIX executable lacks execute permission.
- Starting RIFE does not print the Velorn PNG-only/WebP-disabled build marker.
- FFmpeg or FFprobe cannot start or has the wrong executable format or machine
  architecture.
- An unsigned FFmpeg/FFprobe binary or its companion release notice/license
  differs from Velorn's target-specific pinned size or SHA-256.
- The bundled FFmpeg does not contain the `minterpolate` filter needed by the
  native Frame Blend fallback.

Electron Builder runs these checks in both `beforePack` and `afterPack`. Release
jobs run them explicitly once more against the unpacked app. Packaged runtime
resolution repeats the trust checks at the native-code boundary before RIFE can
run.

Code signing appends or rewrites bytes in a Windows PE or macOS Mach-O file, so
the final signed helpers cannot equal their pre-sign pinned hashes. The mutation
exception is deliberately limited to the RIFE, FFmpeg, and FFprobe executables
in a signed Windows or macOS package:

- `beforePack` still verifies the exact unsigned hash of all three executables.
- Linux always verifies those exact executable hashes.
- Windows and macOS continue to verify exact model and license hashes after
  signing and at runtime.
- Windows and macOS package gates likewise allow signing mutation of the pinned
  FFmpeg/FFprobe executables only after verifying their same-publisher OS
  signatures; their notice and license hashes remain exact.
- Before the signed RIFE executable is started, the release gate verifies its
  OS signature. Runtime resolution repeats this verification and requires its
  Authenticode subject/issuer or Apple Team Identifier to match the running,
  validly signed Velorn executable.

This means the residual Windows/macOS trust assumption is the platform signing
identity and Velorn's signing pipeline for those mutated native executables. A
valid same-publisher signature is not a mathematical binding back to a recorded
unsigned hash. The exact pre-sign gate, isolated builder copy, same-publisher
post-sign checks, and signed app bundle form that chain of custody; compromise
of the signing identity remains out of scope.

Useful local commands are:

```bash
npm run runtime:verify-native
npm run rife-runtime:verify
npm run runtime:verify-staged
```

Add `--smoke-rife` to the gate CLI for a real three-frame interpolation. Linux
release CI forces Mesa lavapipe for a deterministic Vulkan smoke. Standard
macOS and Windows hosted runners do not guarantee usable GPU access, so their
release jobs perform provenance, architecture, linkage, package, signing, and
startup-help validation without claiming a real interpolation.

## Signing and release checks

Windows release CI verifies valid Authenticode signatures on `Velorn.exe`,
RIFE, FFmpeg, and FFprobe, including a matching signer inside the package gate,
before executing the native probes. macOS verifies the application with
`codesign --deep --strict`, individually verifies RIFE, FFmpeg, and FFprobe,
and requires RIFE's Apple team to match Velorn after signing/notarization.
Linux verifies the unpacked package and real interpolation with exact hashes.

Do not publish the upstream `20221029` executable unchanged. It embeds a 2020
libwebp revision that predates the libwebp 1.3.2 security fix. It is suitable
only as an untrusted local PNG fixture. Releases must use wrapper commit
`a7532fc3f9f8f008cd6eecd6f2ffe2a9698e0cf7`, the reviewed PNG-only patch, and
the pinned current stb headers. There is no CPU fallback; when RIFE cannot be
trusted or started, Velorn should offer Frame Blend instead.

## Manual release acceptance

Automated gates prove package integrity, target architecture, startup, and the
available CI interpolation paths. A signed-build interpolation on real Windows,
Intel Mac, and Apple Silicon hardware is a required manual release gate; Linux
should also be tested on representative hardware in addition to lavapipe CI.
Review slow motion, a ramp, a scene cut, cancel and retry, cache reuse,
save/reopen, frame stepping, and final export. Confirm temporary files are
removed after success, cancellation, and failure.
