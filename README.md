# cross-compile-action

## Notice

This repository is almost entirely AI-generated, so use it at your own risk. I
don't personally find CI development or devops that exciting. This action is
used by [scnlib](https://github.com/eliaskosunen/scnlib) and
[eknan](https://github.com/eliaskosunen/eknan) to test their functionality on
different architectures in CI.

## Introduction

Build and test C and C++ code for other CPU architectures in GitHub Actions.

The action installs a cross compiler (clang or GCC) for the target on the x86_64
runner, and QEMU to run the result. Compiling natively inside an emulated system
is slow; this way compilation runs at full speed and only the tests run under
emulation.

```yaml
jobs:
    test:
        runs-on: ubuntu-26.04
        steps:
            - uses: actions/checkout@v7
            - uses: eliaskosunen/cross-compile-action@v1
              with:
                  target: aarch64
                  compile: |
                      cmake -S . -B build -G Ninja
                      cmake --build build
                  run: ctest --test-dir build --output-on-failure
```

The `compile` script runs with the cross toolchain set up: CMake, Meson, Make
and plain compiler invocations all build for the target without extra arguments.
The `run` script can execute the built programs as if they were native.

## Requirements

- `runs-on: ubuntu-26.04` or `ubuntu-24.04` (x86_64). A few targets are only
  available on one of them; see [Targets](#targets).

## Examples

### Testing on many architectures

```yaml
jobs:
    test:
        runs-on: ubuntu-26.04
        strategy:
            fail-fast: false
            matrix:
                target:
                    - armv7
                    - aarch64
                    - i686
                    - ppc64
                    - riscv64
                    - s390x
                    - hppa
        steps:
            - uses: actions/checkout@v7
            - uses: eliaskosunen/cross-compile-action@v1
              with:
                  target: ${{ matrix.target }}
                  compile: |
                      cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
                      cmake --build build
                  run: ctest --test-dir build --output-on-failure
```

By default, the action uses clang, or GCC for targets that clang doesn't support
(`hppa` above) or has known bugs on. To test both compilers, add
`compiler: [clang, gcc]` to the matrix, and exclude the `clang` combinations of
GCC-only targets.

### MIPS

The MIPS targets need `ubuntu-24.04`, because Ubuntu 26.04 has no MIPS cross
compilers:

```yaml
jobs:
    mips:
        runs-on: ubuntu-24.04
        steps:
            - uses: actions/checkout@v7
            - uses: eliaskosunen/cross-compile-action@v1
              with:
                  target: mips64el
                  compile: |
                      cmake -S . -B build -G Ninja
                      cmake --build build
                  run: ctest --test-dir build --output-on-failure
```

- On MIPS32 release 2 (`mips` and `mipsel`), clang 18 and 19 can emit unaligned
  loads at `-O0`, which crash with SIGBUS, e.g. in libstdc++'s `std::regex`.
  `compiler: auto` uses GCC for these targets, and older clang versions print a
  warning. clang 20 works: set `compiler: clang` and `compiler-version: 20`.
- On 64-bit MIPS, the action compiles with `-mxgot`, because large programs
  would otherwise fail to link with
  `relocation truncated to fit: R_MIPS_CALL16`.

### Separate build and test steps

Without `compile` and `run`, the action only sets up the toolchain, and later
steps of the job use it through environment variables. This way you can put
other steps in between, like caching or uploading artifacts.

```yaml
- uses: eliaskosunen/cross-compile-action@v1
  id: cross
  with:
      target: riscv64
- run: cmake -S . -B build -G Ninja && cmake --build build
- run: ctest --test-dir build --output-on-failure
```

Meson needs its cross file passed explicitly:

```yaml
- run: |
      meson setup build --cross-file '${{ steps.cross.outputs.meson-cross-file }}'
      meson test -C build
```

### Specific compiler versions

```yaml
- uses: eliaskosunen/cross-compile-action@v1
  with:
      target: armv7
      compiler: clang
      compiler-version: 22
```

GCC versions come from Ubuntu. clang versions that Ubuntu doesn't provide are
installed from [apt.llvm.org](https://apt.llvm.org).

### Testing in a container

To run the tests in a full Linux distribution for the target, for example
because they need programs or libraries that the cross toolchain doesn't
include, set `container-image` to a Docker image. `run` then runs in that image,
emulated with QEMU. `compile` still runs on the runner.

```yaml
- uses: eliaskosunen/cross-compile-action@v1
  with:
      target: aarch64
      container-image: debian:trixie
      compile: |
          cmake -S . -B build -G Ninja -DCMAKE_EXE_LINKER_FLAGS=-static
          cmake --build build
      run: ./build/tests
```

Pass extra `docker run` arguments in `container-options`, one per line:

```yaml
container-options: |
    --env
    FOO=bar
    --volume=/opt/data:/data
```

The workspace is mounted in the container at the same path. Programs are built
against the runner's C and C++ libraries. Link them statically, or use an image
whose libraries are at least as new (e.g. `ubuntu:26.04` on `ubuntu-26.04`).

The image must be available for the target's platform (see [Targets](#targets)).
Multi-architecture images don't always include every platform: `debian:trixie`
has no `linux/mips64le` variant, for example, but the per-architecture
repository `mips64le/debian:trixie` does.

## Inputs

| Input               | Default          | Description                                                                                                     |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `target`            | (required)       | Target triple (e.g. `armv7-linux-gnueabihf`, vendor optional) or alias (e.g. `armv7`). See [Targets](#targets). |
| `compiler`          | `auto`           | `clang`, `gcc`, or `auto`: clang if the target supports it without known bugs, GCC otherwise.                   |
| `compiler-version`  | Ubuntu's default | Major version of the compiler, e.g. `22`. Requires `compiler` to be `clang` or `gcc`.                           |
| `qemu-cpu`          | Target baseline  | CPU model for QEMU. `default` uses QEMU's own default. See [Emulated CPU](#emulated-cpu).                       |
| `compile`           |                  | bash script that builds the code.                                                                               |
| `run`               |                  | bash script that runs the built code.                                                                           |
| `working-directory` | Workspace        | Working directory of `compile` and `run`, relative to the workspace.                                            |
| `container-image`   |                  | Docker image to run `run` in, instead of on the runner.                                                         |
| `container-options` |                  | Extra `docker run` arguments for `container-image`, one per line.                                               |
| `export-env`        | `true`           | Make the [environment variables](#environment-variables) available to later steps of the job.                   |

## Outputs

| Output                   | Example                                                |
| ------------------------ | ------------------------------------------------------ |
| `triple`                 | `armv7-linux-gnueabihf`                                |
| `gnu-triple`             | `arm-linux-gnueabihf`                                  |
| `name`                   | `ARMv7 (hard-float)`                                   |
| `cmake-system-processor` | `armv7l`                                               |
| `sysroot`                | `/usr/arm-linux-gnueabihf`                             |
| `compiler`               | `clang`                                                |
| `compiler-version`       | `21`                                                   |
| `cc`                     | `/usr/bin/clang-21 --target=armv7-linux-gnueabihf …`   |
| `cxx`                    | `/usr/bin/clang++-21 --target=armv7-linux-gnueabihf …` |
| `toolchain-file`         | Path of the CMake toolchain file                       |
| `meson-cross-file`       | Path of the Meson cross file                           |
| `qemu`                   | `/usr/bin/qemu-arm`; empty for `i686`                  |
| `qemu-cpu`               | `cortex-a8`; empty for QEMU's default                  |

## Environment variables

These are set for `compile` and `run`, and for the rest of the job unless
`export-env` is `false`:

| Variable                | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `CC`, `CXX`             | C and C++ compiler commands for the target                       |
| `AR`, `RANLIB`, `STRIP` | Binary utilities for the target                                  |
| `CMAKE_TOOLCHAIN_FILE`  | CMake toolchain file, used automatically by CMake 3.21 and newer |
| `CROSS_TRIPLE`          | Target triple                                                    |
| `CROSS_SYSROOT`         | Directory of the target's C and C++ libraries                    |
| `QEMU_LD_PREFIX`        | Where QEMU finds the libraries of dynamically linked programs    |
| `QEMU_CPU`              | Emulated CPU model                                               |

The CMake toolchain file and the Meson cross file link libatomic when it's
needed. Targets without 8-byte atomic instructions (e.g. ARMv5TE, 32-bit MIPS
and 32-bit PowerPC) need it for `std::atomic<std::uint64_t>`, and ARMv5TE needs
it for all atomic operations with clang, including those in `std::shared_ptr`.
`CC` and `CXX` don't include it, so builds that use them directly need to add
`-latomic` when linking.

Because `CC` and `CXX` point to the cross compiler, later steps that build
something for the runner itself should set their own compiler, or use
`export-env: false`.

## Targets

<!-- targets:start -->

| Triple                         | Aliases                             | Name                             | clang           | Ubuntu       | QEMU CPU         | Container platform |
| ------------------------------ | ----------------------------------- | -------------------------------- | --------------- | ------------ | ---------------- | ------------------ |
| `armv5te-linux-gnueabi`        | `armv5`, `armv5te`, `armel`         | ARMv5TE (soft-float)             | ✓               | 24.04, 26.04 | arm926           | `linux/arm/v5`     |
| `armv6-linux-gnueabi`          | `armv6`                             | ARMv6 (soft-float)               | ✓               | 24.04, 26.04 | arm1176          | `linux/arm/v6`     |
| `armv7-linux-gnueabihf`        | `armv7`, `armhf`                    | ARMv7 (hard-float)               | ✓               | 24.04, 26.04 | cortex-a8        | `linux/arm/v7`     |
| `aarch64-linux-gnu`            | `aarch64`, `arm64`                  | AArch64                          | ✓               | 24.04, 26.04 | cortex-a53       | `linux/arm64`      |
| `i686-linux-gnu`               | `i686`, `i386`, `x86`               | x86 (32-bit)                     | ✓               | 24.04, 26.04 | native           | `linux/386`        |
| `powerpc-linux-gnu`            | `powerpc`, `ppc`                    | PowerPC (32-bit, big-endian)     | ✓               | 24.04, 26.04 | QEMU default     | ✗                  |
| `powerpc64-linux-gnu`          | `powerpc64`, `ppc64`                | PowerPC 64 (big-endian)          | ✓               | 24.04, 26.04 | power7           | `linux/ppc64`      |
| `powerpc64le-linux-gnu`        | `powerpc64le`, `ppc64le`, `ppc64el` | PowerPC 64 (little-endian)       | ✓               | 24.04, 26.04 | power9           | `linux/ppc64le`    |
| `riscv64-linux-gnu`            | `riscv64`                           | RISC-V 64                        | ✓               | 24.04, 26.04 | QEMU default     | `linux/riscv64`    |
| `s390x-linux-gnu`              | `s390x`                             | IBM Z (s390x)                    | ✓               | 24.04, 26.04 | QEMU default     | `linux/s390x`      |
| `sparc64-linux-gnu`            | `sparc64`                           | SPARC 64                         | ✓               | 24.04, 26.04 | QEMU default     | ✗                  |
| `loongarch64-linux-gnu`        | `loongarch64`, `loong64`            | LoongArch 64                     | ✓               | 24.04, 26.04 | QEMU default     | `linux/loong64`    |
| `m68k-linux-gnu`               | `m68k`                              | Motorola 68000                   | experimental    | 24.04, 26.04 | m68020           | ✗                  |
| `hppa-linux-gnu`               | `hppa`, `parisc`                    | PA-RISC                          | ✗               | 24.04, 26.04 | QEMU default     | ✗                  |
| `alpha-linux-gnu`              | `alpha`                             | Alpha                            | ✗               | 24.04, 26.04 | ev56             | ✗                  |
| `sh4-linux-gnu`                | `sh4`                               | SuperH SH-4                      | ✗               | 24.04, 26.04 | QEMU default     | ✗                  |
| `mips-linux-gnu`               | `mips`                              | MIPS32 release 2 (big-endian)    | ✓ (not default) | 24.04        | 24Kf             | ✗                  |
| `mipsel-linux-gnu`             | `mipsel`                            | MIPS32 release 2 (little-endian) | ✓ (not default) | 24.04        | 24Kf             | ✗                  |
| `mips64-linux-gnuabi64`        | `mips64`                            | MIPS64 release 2 (big-endian)    | ✓               | 24.04        | MIPS64R2-generic | ✗                  |
| `mips64el-linux-gnuabi64`      | `mips64el`                          | MIPS64 release 2 (little-endian) | ✓               | 24.04        | MIPS64R2-generic | `linux/mips64le`   |
| `mipsisa32r6-linux-gnu`        | `mips32r6`                          | MIPS32 release 6 (big-endian)    | ✓               | 24.04        | mips32r6-generic | ✗                  |
| `mipsisa32r6el-linux-gnu`      | `mips32r6el`                        | MIPS32 release 6 (little-endian) | ✓               | 24.04        | mips32r6-generic | ✗                  |
| `mipsisa64r6-linux-gnuabi64`   | `mips64r6`                          | MIPS64 release 6 (big-endian)    | ✓               | 24.04        | I6400            | ✗                  |
| `mipsisa64r6el-linux-gnuabi64` | `mips64r6el`                        | MIPS64 release 6 (little-endian) | ✓               | 24.04        | I6400            | ✗                  |

<!-- targets:end -->

The triple can also be written with a vendor, e.g. `aarch64-unknown-linux-gnu`.

- **clang**: "experimental" and "not default" targets are only used when
  `compiler: clang` is set explicitly. LLVM's M68k backend has produced wrong
  floating-point results in testing. See [MIPS](#mips) for the "not default"
  targets.
- **i686** runs directly on the x86_64 runner, without QEMU.
- **Container platform** is the Docker platform used with `container-image`.
  Targets without one don't support containers.

### Emulated CPU

QEMU emulates the oldest CPU that Ubuntu supports for the target, so tests fail
if the code uses instructions that the target's baseline doesn't have. Targets
marked "QEMU default" use QEMU's default CPU, which supports every instruction
QEMU can emulate. Use `qemu-cpu` to choose a different CPU model, e.g.
`neoverse-n1` for aarch64.

## Tips

- `CMAKE_SYSTEM_PROCESSOR` is what `uname -m` reports on the target, e.g.
  `armv7l`, `ppc64le` or `parisc`.
- QEMU runs both static and dynamic executables. If a program crashes under
  emulation, try the other kind of linking: statically linked googletest
  binaries have been seen to crash under `hppa` emulation, for example.

## License

[Apache License 2.0](LICENSE)
