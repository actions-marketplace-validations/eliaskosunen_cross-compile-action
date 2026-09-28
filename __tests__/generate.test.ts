import {
    cmakeToolchainFile,
    environment,
    mesonCrossFile,
    type Setup,
} from '../src/generate.js'
import { findTarget } from '../src/targets.js'

const files = {
    toolchainFile: '/tmp/toolchain.cmake',
    mesonCrossFile: '/tmp/meson-cross.ini',
}

function clangSetup(): Setup {
    const target = findTarget('armv7-linux-gnueabihf')
    return {
        target,
        toolchain: {
            compiler: 'clang',
            version: '21',
            programs: {
                cc: '/usr/bin/clang-21',
                cxx: '/usr/bin/clang++-21',
                ar: '/usr/bin/llvm-ar-21',
                ranlib: '/usr/bin/llvm-ranlib-21',
                strip: '/usr/bin/llvm-strip-21',
            },
            compilerTarget: target.triple,
            flags: ['-B/usr/arm-linux-gnueabihf/bin'],
        },
        sysroot: '/usr/arm-linux-gnueabihf',
        emulator: { path: '/usr/bin/qemu-arm', cpu: 'cortex-a8' },
    }
}

function gccSetup(triple: string, flags: string[] = []): Setup {
    const target = findTarget(triple)
    const prefix = `/usr/bin/${target.gnuTriple}`
    const sysroot = `/usr/${target.gnuTriple}`
    return {
        target,
        toolchain: {
            compiler: 'gcc',
            version: '15',
            programs: {
                cc: `${prefix}-gcc-15`,
                cxx: `${prefix}-g++-15`,
                ar: `${prefix}-gcc-ar-15`,
                ranlib: `${prefix}-gcc-ranlib-15`,
                strip: `${prefix}-strip`,
            },
            flags,
        },
        sysroot,
        emulator:
            target.qemu !== null
                ? { path: `/usr/bin/qemu-${target.qemu}`, cpu: target.qemuCpu }
                : null,
    }
}

const setups: [string, () => Setup][] = [
    ['clang armv7', clangSetup],
    ['gcc hppa', () => gccSetup('hppa')],
    ['gcc armv6', () => gccSetup('armv6', ['-march=armv6'])],
    ['gcc i686 (native)', () => gccSetup('i686')],
]

describe.each(setups)('%s', (_, setup) => {
    it('generates a CMake toolchain file', () => {
        expect(cmakeToolchainFile(setup())).toMatchSnapshot()
    })

    it('generates a Meson cross file', () => {
        expect(mesonCrossFile(setup())).toMatchSnapshot()
    })

    it('generates the environment', () => {
        expect(environment(setup(), files)).toMatchSnapshot()
    })
})

describe('emulator', () => {
    it('omits -cpu without a CPU model', () => {
        const setup = gccSetup('hppa')
        expect(cmakeToolchainFile(setup)).toContain(
            'set(CMAKE_CROSSCOMPILING_EMULATOR "/usr/bin/qemu-hppa;-L;/usr/hppa-linux-gnu")',
        )
        expect(environment(setup, files).QEMU_CPU).toBeUndefined()
    })
})

describe('quoting', () => {
    it('escapes special characters', () => {
        const setup = clangSetup()
        setup.toolchain.compilerTarget = undefined
        setup.toolchain.flags = ['-DNAME="a b"', "-DQ='c'"]
        expect(cmakeToolchainFile(setup)).toContain(
            'set(CMAKE_C_COMPILER "/usr/bin/clang-21;-DNAME=\\"a b\\" -DQ=\'c\'")',
        )
        expect(mesonCrossFile(setup)).toContain(
            "'-DNAME=\"a b\"', '-DQ=\\'c\\''",
        )
    })
})
