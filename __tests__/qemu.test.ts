import { jest } from '@jest/globals'
import type * as fs from 'node:fs/promises'
import * as core from '../__fixtures__/core.js'
import * as exec from '../__fixtures__/exec.js'
import * as io from '../__fixtures__/io.js'

const access = jest.fn<typeof fs.access>()
const readFile = jest.fn<(path: string) => Promise<string>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => exec)
jest.unstable_mockModule('@actions/io', () => io)
jest.unstable_mockModule('node:fs/promises', () => ({ access, readFile }))

const { ensureBinfmt, locateQemu, parseBinfmt } = await import('../src/qemu.js')

const binfmtDirectory = '/proc/sys/fs/binfmt_misc'

/** The emulated binfmt_misc filesystem and binfmt.d files */
let system: {
    mounted: boolean
    handlers: Map<string, string>
    configurations: Map<string, string>
    /** Whether mount and registration succeed, like in a privileged environment */
    privileged: boolean
}

function handler(flags: string): string {
    return `enabled\ninterpreter /usr/bin/qemu-arm\nflags: ${flags}\noffset 0\n`
}

function commands(): string[] {
    return exec.exec.mock.calls.map(([command, args]) =>
        [command, ...(args ?? [])].join(' '),
    )
}

beforeEach(() => {
    system = {
        mounted: true,
        handlers: new Map(),
        configurations: new Map([
            [
                'qemu-arm',
                ':qemu-arm:M::\\x7fELF:\\xff\\xff:/usr/bin/qemu-arm:OCF\n',
            ],
        ]),
        privileged: true,
    }
    jest.spyOn(process, 'getuid').mockReturnValue(1000)
    access.mockImplementation(async (path) => {
        if (path !== `${binfmtDirectory}/register` || !system.mounted) {
            throw new Error(`ENOENT: ${path}`)
        }
    })
    readFile.mockImplementation(async (path) => {
        const binfmt = /^\/proc\/sys\/fs\/binfmt_misc\/(.+)$/.exec(path)
        const configuration = /^\/usr\/lib\/binfmt\.d\/(.+)\.conf$/.exec(path)
        const content =
            binfmt !== null && system.mounted
                ? system.handlers.get(binfmt[1])
                : configuration !== null
                  ? system.configurations.get(configuration[1])
                  : undefined
        if (content === undefined) {
            throw new Error(`ENOENT: ${path}`)
        }
        return content
    })
    exec.exec.mockImplementation(async (_command, args = [], options) => {
        if (!system.privileged) {
            return 1
        }
        if (args[0] === 'mount') {
            system.mounted = true
        } else if (args[0] === 'tee') {
            const registration = options?.input?.toString() ?? ''
            const [, name, , , , , , flags] = registration.split(':')
            system.handlers.set(name, handler(flags))
        }
        return 0
    })
})

afterEach(() => {
    jest.resetAllMocks()
    jest.restoreAllMocks()
})

describe('parseBinfmt', () => {
    it('parses a binfmt_misc entry', () => {
        const entry = `enabled
interpreter /usr/bin/qemu-arm
flags: OCF
offset 0
magic 7f454c4601010100000000000000000002002800
mask ffffffffffffff00fffffffffffffffffeffffff
`
        expect(parseBinfmt(entry)).toEqual({ enabled: true, flags: 'OCF' })
    })

    it('parses a disabled entry', () => {
        expect(parseBinfmt('disabled\ninterpreter /x\nflags: \n')).toEqual({
            enabled: false,
            flags: '',
        })
    })
})

describe('ensureBinfmt', () => {
    it('uses a registered handler', async () => {
        system.handlers.set('qemu-arm', handler('F'))
        await expect(ensureBinfmt('arm')).resolves.toEqual({
            enabled: true,
            flags: 'F',
        })
        expect(exec.exec).not.toHaveBeenCalled()
    })

    it('mounts binfmt_misc when it is not mounted', async () => {
        system.mounted = false
        system.handlers.set('qemu-arm', handler('F'))
        await expect(ensureBinfmt('arm')).resolves.toMatchObject({
            flags: 'F',
        })
        expect(commands()).toEqual([
            `sudo mount -t binfmt_misc binfmt_misc ${binfmtDirectory}`,
        ])
    })

    it('registers a missing handler from its binfmt.d file', async () => {
        await expect(ensureBinfmt('arm')).resolves.toEqual({
            enabled: true,
            flags: 'OCF',
        })
        expect(commands()).toEqual([`sudo tee ${binfmtDirectory}/register`])
        // The trailing newline would be part of the flags
        expect(exec.exec.mock.calls[0][2]?.input?.toString()).toBe(
            ':qemu-arm:M::\\x7fELF:\\xff\\xff:/usr/bin/qemu-arm:OCF',
        )
    })

    it('returns undefined when registration is not permitted', async () => {
        system.privileged = false
        await expect(ensureBinfmt('arm')).resolves.toBeUndefined()
        expect(commands()).toEqual([`sudo tee ${binfmtDirectory}/register`])
    })

    it('returns undefined when binfmt_misc cannot be mounted', async () => {
        system.mounted = false
        system.privileged = false
        await expect(ensureBinfmt('arm')).resolves.toBeUndefined()
    })

    it('returns undefined without a binfmt.d file', async () => {
        await expect(ensureBinfmt('sh4')).resolves.toBeUndefined()
        expect(exec.exec).not.toHaveBeenCalled()
        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('Reading the binfmt.d file for qemu-sh4'),
        )
    })
})

describe('locateQemu', () => {
    it.each([
        ['', '/usr/bin/qemu-arm'],
        ['-static', '/usr/bin/qemu-arm-static'],
    ])("finds the binary with suffix '%s'", async (qemuSuffix, expected) => {
        io.which.mockImplementation(async (name) => `/usr/bin/${name}`)
        const host = {
            release: '24.04' as const,
            codename: 'noble',
            qemuPackages: [],
            qemuSuffix,
        }
        await expect(locateQemu('arm', host)).resolves.toBe(expected)
        expect(io.which).toHaveBeenCalledWith(expected.slice(9), true)
    })
})
