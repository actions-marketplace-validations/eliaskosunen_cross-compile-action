import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import { access, readFile } from 'node:fs/promises'
import { privileged, type Host } from './host.js'

const binfmtDirectory = '/proc/sys/fs/binfmt_misc'

export interface Binfmt {
    enabled: boolean
    flags: string
}

export function parseBinfmt(content: string): Binfmt {
    const lines = content.split('\n').map((line) => line.trim())
    return {
        enabled: lines.includes('enabled'),
        flags:
            lines
                .find((line) => line.startsWith('flags:'))
                ?.slice(6)
                .trim() ?? '',
    }
}

async function readBinfmt(arch: string): Promise<Binfmt | undefined> {
    try {
        return parseBinfmt(
            await readFile(`${binfmtDirectory}/qemu-${arch}`, 'utf8'),
        )
    } catch {
        return undefined
    }
}

/** Runs a privileged command, returning false instead of failing */
async function tryPrivileged(
    command: string,
    args: string[],
    input?: string,
): Promise<boolean> {
    const exitCode = await exec.exec(...privileged(command, args), {
        ignoreReturnCode: true,
        silent: true,
        input: input !== undefined ? Buffer.from(input) : undefined,
    })
    return exitCode === 0
}

/**
 * Makes sure target executables can be run directly through binfmt_misc.
 * The QEMU packages register the handlers through systemd-binfmt, which
 * doesn't run everywhere (e.g. in containers), so fall back to mounting
 * binfmt_misc and registering the handler from its binfmt.d file ourselves.
 */
export async function ensureBinfmt(arch: string): Promise<Binfmt | undefined> {
    const mounted = await access(`${binfmtDirectory}/register`).then(
        () => true,
        () => false,
    )
    if (!mounted) {
        await tryPrivileged('mount', [
            '-t',
            'binfmt_misc',
            'binfmt_misc',
            binfmtDirectory,
        ])
    }
    const existing = await readBinfmt(arch)
    if (existing !== undefined) {
        return existing
    }
    try {
        const registration = await readFile(
            `/usr/lib/binfmt.d/qemu-${arch}.conf`,
            'utf8',
        )
        await tryPrivileged(
            'tee',
            [`${binfmtDirectory}/register`],
            registration.trim(),
        )
    } catch (error) {
        core.debug(
            `Reading the binfmt.d file for qemu-${arch} failed: ${error}`,
        )
    }
    return readBinfmt(arch)
}

export async function locateQemu(arch: string, host: Host): Promise<string> {
    return io.which(`qemu-${arch}${host.qemuSuffix}`, true)
}
