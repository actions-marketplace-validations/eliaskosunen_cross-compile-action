import { jest } from '@jest/globals'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { aptCache, aptState, resetAptState } from '../__fixtures__/apt-cache.js'
import * as core from '../__fixtures__/core.js'
import * as exec from '../__fixtures__/exec.js'
import * as io from '../__fixtures__/io.js'
import type { Binfmt } from '../src/qemu.js'

// Imported before mocking, so the mocks below can reuse the real implementations
const host = await import('../src/host.js')
const qemu = await import('../src/qemu.js')

const osRelease = jest.fn<typeof host.readOsRelease>()
const ensureBinfmt = jest.fn<typeof qemu.ensureBinfmt>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => exec)
jest.unstable_mockModule('@actions/io', () => io)
jest.unstable_mockModule('../src/host.js', () => ({
    ...host,
    readOsRelease: osRelease,
}))
jest.unstable_mockModule('../src/qemu.js', () => ({
    ...qemu,
    ensureBinfmt,
    locateQemu: async (arch: string, host: { qemuSuffix: string }) =>
        `/usr/bin/qemu-${arch}${host.qemuSuffix}`,
}))

const { run } = await import('../src/main.js')

const binfmtWithFixBinary: Binfmt = {
    enabled: true,
    flags: 'OCF',
}

let temp: string
let inputs: Record<string, string>

function execCalls(): string[] {
    return exec.exec.mock.calls.map(([command, args]) =>
        [command, ...(args ?? [])].join(' '),
    )
}

function exported(): Record<string, string> {
    return Object.fromEntries(
        core.exportVariable.mock.calls.map(([name, value]) => [
            name,
            `${value}`,
        ]),
    )
}

function outputs(): Record<string, string> {
    return Object.fromEntries(
        core.setOutput.mock.calls.map(([name, value]) => [name, `${value}`]),
    )
}

function expectSuccess(): void {
    expect(core.setFailed).not.toHaveBeenCalled()
}

describe('main', () => {
    beforeEach(async () => {
        temp = await mkdtemp(path.join(tmpdir(), 'cross-compile-action-test-'))
        process.env.RUNNER_TEMP = temp
        process.env.GITHUB_WORKSPACE = '/workspace'
        inputs = {}
        core.getInput.mockImplementation((name) => inputs[name] ?? '')
        core.getMultilineInput.mockImplementation((name) =>
            (inputs[name] ?? '').split('\n').filter((line) => line !== ''),
        )
        core.getBooleanInput.mockImplementation(
            (name) => (inputs[name] ?? 'true') === 'true',
        )
        core.group.mockImplementation((_name, callback) => callback())
        osRelease.mockResolvedValue({ id: 'ubuntu', versionId: '26.04' })
        ensureBinfmt.mockResolvedValue(binfmtWithFixBinary)
        exec.exec.mockResolvedValue(0)
        resetAptState()
        exec.getExecOutput.mockImplementation(aptCache)
        io.which.mockImplementation(async (name) => `/usr/bin/${name}`)
        // Not root, so privileged commands use sudo
        jest.spyOn(process, 'getuid').mockReturnValue(1000)
    })

    afterEach(async () => {
        jest.resetAllMocks()
        jest.restoreAllMocks()
        await rm(temp, { recursive: true, force: true })
    })

    it('sets up clang for armv7', async () => {
        inputs = { target: 'armv7' }
        await run()
        expectSuccess()

        expect(execCalls()).toContain(
            'sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends ' +
                'clang-21 llvm-21 libstdc++-15-dev-armhf-cross binutils-arm-linux-gnueabihf qemu-user qemu-user-binfmt',
        )
        const toolchainFile = path.join(
            temp,
            'cross-compile-action',
            'armv7-linux-gnueabihf-clang-21',
            'toolchain.cmake',
        )
        expect(exported()).toMatchObject({
            CC: '/usr/bin/clang-21 --target=armv7-linux-gnueabihf -B/usr/arm-linux-gnueabihf/bin',
            CMAKE_TOOLCHAIN_FILE: toolchainFile,
            QEMU_LD_PREFIX: '/usr/arm-linux-gnueabihf',
            QEMU_CPU: 'cortex-a8',
        })
        expect(outputs()).toMatchObject({
            triple: 'armv7-linux-gnueabihf',
            compiler: 'clang',
            'compiler-version': '21',
            qemu: '/usr/bin/qemu-arm',
            'toolchain-file': toolchainFile,
        })
        expect(await readFile(toolchainFile, 'utf8')).toContain(
            'set(CMAKE_C_COMPILER_TARGET "armv7-linux-gnueabihf")',
        )
        expect(await readFile(outputs()['meson-cross-file'], 'utf8')).toContain(
            "exe_wrapper = ['/usr/bin/qemu-arm'",
        )
    })

    it('uses gcc for hppa with compiler: auto', async () => {
        inputs = { target: 'hppa-unknown-linux-gnu', compiler: 'auto' }
        await run()
        expectSuccess()
        expect(execCalls()).toContain(
            'sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends ' +
                'g++-15-hppa-linux-gnu qemu-user qemu-user-binfmt',
        )
        expect(outputs()).toMatchObject({ compiler: 'gcc', 'qemu-cpu': '' })
        expect(exported().QEMU_CPU).toBeUndefined()
    })

    it('rejects clang for hppa', async () => {
        inputs = { target: 'hppa', compiler: 'clang' }
        await run()
        expect(core.setFailed).toHaveBeenCalledWith(
            'LLVM has no backend for PA-RISC (hppa-linux-gnu); use compiler: gcc',
        )
        expect(exec.exec).not.toHaveBeenCalled()
    })

    it('runs i686 natively', async () => {
        inputs = { target: 'i686', compiler: 'gcc' }
        await run()
        expectSuccess()
        expect(execCalls()).toContain(
            'sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends ' +
                'g++-15-i686-linux-gnu libc6-i386 lib32stdc++6 lib32gcc-s1',
        )
        expect(ensureBinfmt).not.toHaveBeenCalled()
        expect(exported().QEMU_LD_PREFIX).toBeUndefined()
        expect(outputs().qemu).toBe('')
    })

    it('overrides the QEMU CPU', async () => {
        inputs = { target: 'aarch64', 'qemu-cpu': 'neoverse-n1' }
        await run()
        expectSuccess()
        expect(exported().QEMU_CPU).toBe('neoverse-n1')
    })

    it("leaves the QEMU CPU to QEMU with 'default'", async () => {
        inputs = { target: 'aarch64', 'qemu-cpu': 'default' }
        await run()
        expectSuccess()
        expect(exported().QEMU_CPU).toBeUndefined()
        expect(outputs()['qemu-cpu']).toBe('')
    })

    it("doesn't export the environment with export-env: false", async () => {
        inputs = { target: 'armv7', 'export-env': 'false' }
        await run()
        expectSuccess()
        expect(core.exportVariable).not.toHaveBeenCalled()
    })

    it('adds apt.llvm.org for clang versions missing from Ubuntu', async () => {
        const fetch = jest
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('KEY'))
        inputs = {
            target: 'armv7',
            compiler: 'clang',
            'compiler-version': '23',
        }
        await run()
        expectSuccess()
        expect(fetch).toHaveBeenCalledWith(
            'https://apt.llvm.org/llvm-snapshot.gpg.key',
        )
        const calls = exec.exec.mock.calls
        const source = calls.find(([, args]) =>
            args?.includes('/etc/apt/sources.list.d/llvm-23.list'),
        )
        expect(source?.[2]?.input?.toString()).toBe(
            'deb [signed-by=/etc/apt/keyrings/apt.llvm.org.asc] http://apt.llvm.org/resolute/ llvm-toolchain-resolute-23 main\n',
        )
        expect(execCalls().at(-1)).toContain('clang-23 llvm-23')
    })

    it('runs the compile and run scripts on the host', async () => {
        inputs = {
            target: 'armv7',
            compile: 'cmake -B build',
            run: './build/test',
            'working-directory': 'sub',
        }
        await run()
        expectSuccess()
        const scripts = exec.exec.mock.calls.filter(
            ([command]) => command === 'bash',
        )
        expect(scripts).toHaveLength(2)
        for (const [, args, options] of scripts) {
            expect(args?.slice(0, 4)).toEqual([
                '--noprofile',
                '--norc',
                '-eo',
                'pipefail',
            ])
            expect(options?.cwd).toBe('/workspace/sub')
            expect(options?.env?.QEMU_LD_PREFIX).toBe(
                '/usr/arm-linux-gnueabihf',
            )
        }
        expect(await readFile(scripts[0][1]?.[4] ?? '', 'utf8')).toBe(
            'cmake -B build',
        )
        expect(await readFile(scripts[1][1]?.[4] ?? '', 'utf8')).toBe(
            './build/test',
        )
    })

    it('runs the run script in a container', async () => {
        inputs = {
            target: 'aarch64',
            run: './build/test',
            'container-image': 'debian:trixie',
            'container-options': '--env\nFOO=a b',
        }
        await run()
        expectSuccess()
        const docker = exec.exec.mock.calls.find(
            ([command]) => command === 'docker',
        )
        const args = docker?.[1] ?? []
        expect(args.join(' ')).toContain('--platform linux/arm64')
        expect(args).toContain('CROSS_TRIPLE=aarch64-linux-gnu')
        expect(args).toContain('QEMU_CPU=cortex-a53')
        expect(args).toContain('FOO=a b')
        expect(args.join(' ')).not.toContain('QEMU_LD_PREFIX')
        expect(docker?.[2]?.input?.toString()).toBe('./build/test')
    })

    it('runs i686 containers natively', async () => {
        inputs = { target: 'i686', run: 'true', 'container-image': 'debian' }
        await run()
        expectSuccess()
        expect(ensureBinfmt).not.toHaveBeenCalled()
        const docker = exec.exec.mock.calls.find(
            ([command]) => command === 'docker',
        )
        expect(docker?.[1]?.join(' ')).toContain('--platform linux/386')
    })

    it('requires the F binfmt flag in container mode', async () => {
        ensureBinfmt.mockResolvedValue({ ...binfmtWithFixBinary, flags: 'OC' })
        inputs = { target: 'aarch64', run: 'true', 'container-image': 'debian' }
        await run()
        expect(core.setFailed).toHaveBeenCalledWith(
            expect.stringContaining('lacks the F (fix binary) flag'),
        )
    })

    it('warns without binfmt on the host', async () => {
        ensureBinfmt.mockResolvedValue(undefined)
        inputs = { target: 'aarch64' }
        await run()
        expectSuccess()
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('No binfmt_misc handler is registered'),
        )
    })

    it('rejects container mode for targets without a Docker platform', async () => {
        inputs = { target: 'hppa', 'container-image': 'debian' }
        await run()
        expect(core.setFailed).toHaveBeenCalledWith(
            "container-image isn't supported for hppa-linux-gnu: it has no Docker platform",
        )
    })

    it('rejects unsupported hosts', async () => {
        osRelease.mockResolvedValue({ id: 'ubuntu', versionId: '22.04' })
        inputs = { target: 'armv7' }
        await run()
        expect(core.setFailed).toHaveBeenCalledWith(
            expect.stringContaining('Unsupported host: ubuntu 22.04'),
        )
    })

    it('uses qemu-user-static on Ubuntu 24.04', async () => {
        osRelease.mockResolvedValue({ id: 'ubuntu', versionId: '24.04' })
        aptState.dependencies['g++'] = 'g++-13'
        inputs = { target: 'mips64el', compiler: 'gcc' }
        await run()
        expectSuccess()
        expect(execCalls()).toContain(
            'sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends ' +
                'g++-13-mips64el-linux-gnuabi64 qemu-user-static',
        )
        expect(outputs()).toMatchObject({
            qemu: '/usr/bin/qemu-mips64el-static',
            'qemu-cpu': 'MIPS64R2-generic',
        })
    })

    it('rejects targets that the host release lacks', async () => {
        inputs = { target: 'mips64el-linux-gnuabi64' }
        await run()
        expect(core.setFailed).toHaveBeenCalledWith(
            "MIPS64 release 2 (little-endian) (mips64el-linux-gnuabi64) isn't available on Ubuntu 26.04. Use runs-on: ubuntu-24.04.",
        )
    })

    it('warns about experimental clang backends', async () => {
        exec.getExecOutput.mockImplementation(async (command, args) =>
            command === 'apt-cache'
                ? aptCache(command, args)
                : {
                      exitCode: 0,
                      stdout: '    m68k - Motorola 68000\n',
                      stderr: '',
                  },
        )
        inputs = { target: 'm68k', compiler: 'clang' }
        await run()
        expectSuccess()
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('backend is experimental'),
        )
    })
})
