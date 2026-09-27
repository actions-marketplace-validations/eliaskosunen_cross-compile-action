import { jest } from '@jest/globals'
import * as exec from '../__fixtures__/exec.js'
import * as io from '../__fixtures__/io.js'
import { aptCache, resetAptState } from '../__fixtures__/apt-cache.js'

jest.unstable_mockModule('@actions/exec', () => exec)
jest.unstable_mockModule('@actions/io', () => io)

const {
    checkClangBackend,
    locateToolchain,
    parseCompilerInput,
    planToolchain,
    selectCompiler,
} = await import('../src/toolchain.js')
const { findTarget } = await import('../src/targets.js')

beforeEach(() => {
    resetAptState()
    exec.getExecOutput.mockImplementation(aptCache)
})

describe('parseCompilerInput', () => {
    it('defaults to auto', () => {
        expect(parseCompilerInput('')).toBe('auto')
    })

    it('rejects unknown compilers', () => {
        expect(() => parseCompilerInput('msvc')).toThrow(
            /Invalid compiler 'msvc'/,
        )
    })
})

describe('selectCompiler', () => {
    it('prefers clang', () => {
        expect(selectCompiler(findTarget('armv7'), 'auto', '')).toBe('clang')
    })

    it('falls back to gcc without an LLVM backend', () => {
        expect(selectCompiler(findTarget('hppa'), 'auto', '')).toBe('gcc')
    })

    it("doesn't pick an experimental LLVM backend automatically", () => {
        expect(selectCompiler(findTarget('m68k'), 'auto', '')).toBe('gcc')
    })

    it('allows an experimental LLVM backend explicitly', () => {
        expect(selectCompiler(findTarget('m68k'), 'clang', '')).toBe('clang')
    })

    it('rejects clang without an LLVM backend', () => {
        expect(() => selectCompiler(findTarget('hppa'), 'clang', '')).toThrow(
            /LLVM has no backend for PA-RISC/,
        )
    })

    it('rejects a version with auto', () => {
        expect(() => selectCompiler(findTarget('armv7'), 'auto', '21')).toThrow(
            /compiler-version requires an explicit compiler/,
        )
    })
})

describe('planToolchain', () => {
    it('plans the default GCC', async () => {
        const plan = await planToolchain(findTarget('armv6'), 'gcc', '')
        expect(plan).toEqual({
            compiler: 'gcc',
            version: '15',
            packages: ['g++-15-arm-linux-gnueabi'],
            needsLlvmRepository: false,
            programs: {
                cc: 'arm-linux-gnueabi-gcc-15',
                cxx: 'arm-linux-gnueabi-g++-15',
                ar: 'arm-linux-gnueabi-gcc-ar-15',
                ranlib: 'arm-linux-gnueabi-gcc-ranlib-15',
                strip: 'arm-linux-gnueabi-strip',
            },
            flags: ['-march=armv6'],
        })
    })

    it('plans a specific GCC version', async () => {
        const plan = await planToolchain(findTarget('hppa'), 'gcc', '14')
        expect(plan.packages).toEqual(['g++-14-hppa-linux-gnu'])
        expect(plan.programs.cc).toBe('hppa-linux-gnu-gcc-14')
    })

    it('lists the available GCC versions', async () => {
        await expect(
            planToolchain(findTarget('hppa'), 'gcc', '8'),
        ).rejects.toThrow(
            "GCC 8 isn't available for hppa-linux-gnu (package g++-8-hppa-linux-gnu). Available versions: 9, 14, 15",
        )
    })

    it('plans the default clang', async () => {
        const plan = await planToolchain(findTarget('armv7'), 'clang', '')
        expect(plan).toEqual({
            compiler: 'clang',
            version: '21',
            packages: [
                'clang-21',
                'llvm-21',
                'libstdc++-15-dev-armhf-cross',
                'binutils-arm-linux-gnueabihf',
            ],
            needsLlvmRepository: false,
            programs: {
                cc: 'clang-21',
                cxx: 'clang++-21',
                ar: 'llvm-ar-21',
                ranlib: 'llvm-ranlib-21',
                strip: 'llvm-strip-21',
            },
            compilerTarget: 'armv7-linux-gnueabihf',
            flags: ['-B/usr/arm-linux-gnueabihf/bin'],
        })
    })

    it('needs apt.llvm.org for clang versions missing from Ubuntu', async () => {
        const plan = await planToolchain(findTarget('armv7'), 'clang', '23')
        expect(plan.needsLlvmRepository).toBe(true)
        expect(plan.packages[0]).toBe('clang-23')
    })

    it('rejects malformed versions', async () => {
        await expect(
            planToolchain(findTarget('armv7'), 'clang', '21.1'),
        ).rejects.toThrow(/Invalid compiler-version '21.1'/)
    })
})

describe('locateToolchain', () => {
    it('resolves absolute paths', async () => {
        io.which.mockImplementation(async (name) => `/usr/bin/${name}`)
        const plan = await planToolchain(findTarget('hppa'), 'gcc', '')
        const toolchain = await locateToolchain(plan)
        expect(toolchain.programs.cxx).toBe('/usr/bin/hppa-linux-gnu-g++-15')
        expect(io.which).toHaveBeenCalledWith('hppa-linux-gnu-g++-15', true)
    })
})

describe('checkClangBackend', () => {
    const toolchain = {
        compiler: 'clang' as const,
        version: '21',
        programs: {
            cc: '/usr/bin/clang-21',
            cxx: '/usr/bin/clang++-21',
            ar: '',
            ranlib: '',
            strip: '',
        },
        compilerTarget: 'm68k-linux-gnu',
        flags: [],
    }

    function printTargets(stdout: string): void {
        exec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout,
            stderr: '',
        })
    }

    it('accepts a clang with the M68k backend', async () => {
        printTargets(
            '  Registered Targets:\n    m68k       - Motorola 68000 family\n    x86-64     - 64-bit X86: EM64T and AMD64\n',
        )
        await expect(
            checkClangBackend(toolchain, findTarget('m68k')),
        ).resolves.toBeUndefined()
    })

    it('rejects a clang without the M68k backend', async () => {
        printTargets('  Registered Targets:\n    x86-64     - 64-bit X86\n')
        await expect(
            checkClangBackend(toolchain, findTarget('m68k')),
        ).rejects.toThrow(/without the experimental m68k backend/)
    })

    it("doesn't check supported backends", async () => {
        await checkClangBackend(toolchain, findTarget('armv7'))
        expect(exec.getExecOutput).not.toHaveBeenCalled()
    })
})
