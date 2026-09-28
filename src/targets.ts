import type { Release } from './host.js'

export type ClangSupport = 'supported' | 'experimental' | 'unsupported'

/** A clang bug that makes `compiler: auto` pick GCC, and warns when an affected clang is used */
export interface ClangBug {
    /** Completes "clang <version> ..." */
    description: string
    /** First clang major version without the bug */
    fixedIn: number
}

export interface Target {
    /** Canonical LLVM target triple, without a vendor component */
    triple: string
    /** Short names accepted as the `target` input */
    aliases: string[]
    /** Human-readable name */
    name: string
    /** Debian/Ubuntu cross-compilation triple; the sysroot is /usr/<gnuTriple> */
    gnuTriple: string
    /** Debian architecture, used as the suffix of cross packages (libstdc++-15-dev-<debianArch>-cross) */
    debianArch: string
    /** `uname -m` on the target, as recommended by the CMake docs */
    cmakeProcessor: string
    mesonCpuFamily: string
    endian: 'little' | 'big'
    /** qemu-user architecture (qemu-<qemu>), or null when the target runs natively on an x86_64 host */
    qemu: string | null
    /** Packages needed to run target executables natively on the host */
    runtimePackages?: string[]
    /** Baseline CPU for QEMU_CPU, or undefined to use QEMU's default */
    qemuCpu?: string
    /** `docker run --platform` value, or undefined when container mode isn't supported */
    dockerPlatform?: string
    /** Extra flags for both GCC and clang */
    compilerFlags?: string[]
    /** Extra flags for GCC; clang gets the same information from the triple */
    gccFlags: string[]
    clang: ClangSupport
    clangBug?: ClangBug
    /** Host releases that have cross toolchains for the target; undefined means all of them */
    releases?: readonly Release[]
}

interface MipsVariant {
    bits: 32 | 64
    endian: 'little' | 'big'
    isaRevision: 2 | 6
}

/** Ubuntu 26.04 dropped the MIPS cross toolchains */
function mips({ bits, endian, isaRevision }: MipsVariant): Target {
    const el = endian === 'little' ? 'el' : ''
    const architecture =
        isaRevision === 6
            ? `mipsisa${bits}r6${el}`
            : `mips${bits === 64 ? '64' : ''}${el}`
    const gnuTriple = `${architecture}-linux-gnu${bits === 64 ? 'abi64' : ''}`
    const qemu = `mips${bits === 64 ? '64' : ''}${el}`
    const qemuCpu = {
        '32r2': '24Kf',
        '64r2': 'MIPS64R2-generic',
        '32r6': 'mips32r6-generic',
        '64r6': 'I6400',
    }[`${bits}r${isaRevision}`]
    return {
        triple: gnuTriple,
        aliases: isaRevision === 6 ? [`mips${bits}r6${el}`] : [qemu],
        name: `MIPS${bits} release ${isaRevision} (${endian}-endian)`,
        gnuTriple,
        debianArch: `mips${bits === 64 ? '64' : ''}${isaRevision === 6 ? 'r6' : ''}${el}`,
        cmakeProcessor: bits === 64 ? 'mips64' : 'mips',
        mesonCpuFamily: bits === 64 ? 'mips64' : 'mips',
        endian,
        qemu,
        qemuCpu,
        dockerPlatform:
            bits === 64 && isaRevision === 2 && endian === 'little'
                ? 'linux/mips64le'
                : undefined,
        // GOT entries are twice as large as on MIPS32, so large programs (e.g.
        // C++ debug builds of test suites) overflow the 16-bit GOT offsets
        compilerFlags: bits === 64 ? ['-mxgot'] : undefined,
        gccFlags: [],
        clang: 'supported',
        // Release 6 requires unaligned loads to work, so the bug doesn't crash there
        clangBug:
            bits === 32 && isaRevision === 2
                ? {
                      description:
                          "can emit unaligned loads at -O0, which crash with SIGBUS (e.g. libstdc++'s std::regex with a character class)",
                      fixedIn: 20,
                  }
                : undefined,
        releases: ['24.04'],
    }
}

export const targets: readonly Target[] = [
    {
        triple: 'armv5te-linux-gnueabi',
        aliases: ['armv5', 'armv5te', 'armel'],
        name: 'ARMv5TE (soft-float)',
        gnuTriple: 'arm-linux-gnueabi',
        debianArch: 'armel',
        cmakeProcessor: 'armv5tel',
        mesonCpuFamily: 'arm',
        endian: 'little',
        qemu: 'arm',
        qemuCpu: 'arm926',
        dockerPlatform: 'linux/arm/v5',
        gccFlags: ['-march=armv5te'],
        clang: 'supported',
    },
    {
        triple: 'armv6-linux-gnueabi',
        aliases: ['armv6'],
        name: 'ARMv6 (soft-float)',
        gnuTriple: 'arm-linux-gnueabi',
        debianArch: 'armel',
        cmakeProcessor: 'armv6l',
        mesonCpuFamily: 'arm',
        endian: 'little',
        qemu: 'arm',
        qemuCpu: 'arm1176',
        dockerPlatform: 'linux/arm/v6',
        gccFlags: ['-march=armv6'],
        clang: 'supported',
    },
    {
        triple: 'armv7-linux-gnueabihf',
        aliases: ['armv7', 'armhf'],
        name: 'ARMv7 (hard-float)',
        gnuTriple: 'arm-linux-gnueabihf',
        debianArch: 'armhf',
        cmakeProcessor: 'armv7l',
        mesonCpuFamily: 'arm',
        endian: 'little',
        qemu: 'arm',
        qemuCpu: 'cortex-a8',
        dockerPlatform: 'linux/arm/v7',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'aarch64-linux-gnu',
        aliases: ['aarch64', 'arm64'],
        name: 'AArch64',
        gnuTriple: 'aarch64-linux-gnu',
        debianArch: 'arm64',
        cmakeProcessor: 'aarch64',
        mesonCpuFamily: 'aarch64',
        endian: 'little',
        qemu: 'aarch64',
        qemuCpu: 'cortex-a53',
        dockerPlatform: 'linux/arm64',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'i686-linux-gnu',
        aliases: ['i686', 'i386', 'x86'],
        name: 'x86 (32-bit)',
        gnuTriple: 'i686-linux-gnu',
        debianArch: 'i386',
        cmakeProcessor: 'i686',
        mesonCpuFamily: 'x86',
        endian: 'little',
        qemu: null,
        runtimePackages: [
            'libc6-i386',
            'lib32stdc++6',
            'lib32gcc-s1',
            'lib32atomic1',
        ],
        dockerPlatform: 'linux/386',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'powerpc-linux-gnu',
        aliases: ['powerpc', 'ppc'],
        name: 'PowerPC (32-bit, big-endian)',
        gnuTriple: 'powerpc-linux-gnu',
        debianArch: 'powerpc',
        cmakeProcessor: 'ppc',
        mesonCpuFamily: 'ppc',
        endian: 'big',
        qemu: 'ppc',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'powerpc64-linux-gnu',
        aliases: ['powerpc64', 'ppc64'],
        name: 'PowerPC 64 (big-endian)',
        gnuTriple: 'powerpc64-linux-gnu',
        debianArch: 'ppc64',
        cmakeProcessor: 'ppc64',
        mesonCpuFamily: 'ppc64',
        endian: 'big',
        qemu: 'ppc64',
        qemuCpu: 'power7',
        dockerPlatform: 'linux/ppc64',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'powerpc64le-linux-gnu',
        aliases: ['powerpc64le', 'ppc64le', 'ppc64el'],
        name: 'PowerPC 64 (little-endian)',
        gnuTriple: 'powerpc64le-linux-gnu',
        debianArch: 'ppc64el',
        cmakeProcessor: 'ppc64le',
        mesonCpuFamily: 'ppc64',
        endian: 'little',
        qemu: 'ppc64le',
        qemuCpu: 'power9',
        dockerPlatform: 'linux/ppc64le',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'riscv64-linux-gnu',
        aliases: ['riscv64'],
        name: 'RISC-V 64',
        gnuTriple: 'riscv64-linux-gnu',
        debianArch: 'riscv64',
        cmakeProcessor: 'riscv64',
        mesonCpuFamily: 'riscv64',
        endian: 'little',
        qemu: 'riscv64',
        dockerPlatform: 'linux/riscv64',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 's390x-linux-gnu',
        aliases: ['s390x'],
        name: 'IBM Z (s390x)',
        gnuTriple: 's390x-linux-gnu',
        debianArch: 's390x',
        cmakeProcessor: 's390x',
        mesonCpuFamily: 's390x',
        endian: 'big',
        qemu: 's390x',
        dockerPlatform: 'linux/s390x',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'sparc64-linux-gnu',
        aliases: ['sparc64'],
        name: 'SPARC 64',
        gnuTriple: 'sparc64-linux-gnu',
        debianArch: 'sparc64',
        cmakeProcessor: 'sparc64',
        mesonCpuFamily: 'sparc64',
        endian: 'big',
        qemu: 'sparc64',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'loongarch64-linux-gnu',
        aliases: ['loongarch64', 'loong64'],
        name: 'LoongArch 64',
        gnuTriple: 'loongarch64-linux-gnu',
        debianArch: 'loong64',
        cmakeProcessor: 'loongarch64',
        mesonCpuFamily: 'loongarch64',
        endian: 'little',
        qemu: 'loongarch64',
        dockerPlatform: 'linux/loong64',
        gccFlags: [],
        clang: 'supported',
    },
    {
        triple: 'm68k-linux-gnu',
        aliases: ['m68k'],
        name: 'Motorola 68000',
        gnuTriple: 'm68k-linux-gnu',
        debianArch: 'm68k',
        cmakeProcessor: 'm68k',
        mesonCpuFamily: 'm68k',
        endian: 'big',
        qemu: 'm68k',
        qemuCpu: 'm68020',
        gccFlags: [],
        clang: 'experimental',
    },
    {
        triple: 'hppa-linux-gnu',
        aliases: ['hppa', 'parisc'],
        name: 'PA-RISC',
        gnuTriple: 'hppa-linux-gnu',
        debianArch: 'hppa',
        cmakeProcessor: 'parisc',
        mesonCpuFamily: 'parisc',
        endian: 'big',
        qemu: 'hppa',
        gccFlags: [],
        clang: 'unsupported',
    },
    {
        triple: 'alpha-linux-gnu',
        aliases: ['alpha'],
        name: 'Alpha',
        gnuTriple: 'alpha-linux-gnu',
        debianArch: 'alpha',
        cmakeProcessor: 'alpha',
        mesonCpuFamily: 'alpha',
        endian: 'little',
        qemu: 'alpha',
        qemuCpu: 'ev56',
        gccFlags: [],
        clang: 'unsupported',
    },
    {
        triple: 'sh4-linux-gnu',
        aliases: ['sh4'],
        name: 'SuperH SH-4',
        gnuTriple: 'sh4-linux-gnu',
        debianArch: 'sh4',
        cmakeProcessor: 'sh4',
        mesonCpuFamily: 'sh4',
        endian: 'little',
        qemu: 'sh4',
        gccFlags: [],
        clang: 'unsupported',
    },
    mips({ bits: 32, endian: 'big', isaRevision: 2 }),
    mips({ bits: 32, endian: 'little', isaRevision: 2 }),
    mips({ bits: 64, endian: 'big', isaRevision: 2 }),
    mips({ bits: 64, endian: 'little', isaRevision: 2 }),
    mips({ bits: 32, endian: 'big', isaRevision: 6 }),
    mips({ bits: 32, endian: 'little', isaRevision: 6 }),
    mips({ bits: 64, endian: 'big', isaRevision: 6 }),
    mips({ bits: 64, endian: 'little', isaRevision: 6 }),
]

/** A target can have several vendor spellings, e.g. armv7-unknown-linux-gnueabihf */
const ignoredVendors = new Set(['unknown', 'pc', 'none'])

export function normalizeTriple(triple: string): string {
    const parts = triple.trim().toLowerCase().split('-')
    if (parts.length === 4 && ignoredVendors.has(parts[1])) {
        parts.splice(1, 1)
    }
    return parts.join('-')
}

export function findTarget(input: string): Target {
    const normalized = normalizeTriple(input)
    const target = targets.find(
        (candidate) =>
            candidate.triple === normalized ||
            candidate.aliases.includes(normalized),
    )
    if (target === undefined) {
        const supported = targets
            .map(
                (candidate) =>
                    `${candidate.triple} (${candidate.aliases.join(', ')})`,
            )
            .join('\n  ')
        throw new Error(
            `Unsupported target '${input}'. Supported targets:\n  ${supported}`,
        )
    }
    return target
}
