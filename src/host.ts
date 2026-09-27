import { readFile } from 'node:fs/promises'

export type Release = '24.04' | '26.04'

export interface Host {
    release: Release
    codename: string
    qemuPackages: string[]
    /** qemu-user binaries are qemu-<arch><qemuSuffix> */
    qemuSuffix: string
}

// Both releases need statically linked QEMU binaries with binfmt_misc
// handlers that have the F flag, so they also work inside containers.
// On 24.04 those come from qemu-user-static; on 26.04, qemu-user is static.
const hosts: readonly Host[] = [
    {
        release: '24.04',
        codename: 'noble',
        qemuPackages: ['qemu-user-static'],
        qemuSuffix: '-static',
    },
    {
        release: '26.04',
        codename: 'resolute',
        qemuPackages: ['qemu-user', 'qemu-user-binfmt'],
        qemuSuffix: '',
    },
]

export const releases = hosts.map((host) => host.release)

export interface OsRelease {
    id: string
    versionId: string
}

export function parseOsRelease(content: string): OsRelease {
    const fields = new Map<string, string>()
    for (const line of content.split('\n')) {
        const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
        if (match !== null) {
            fields.set(match[1], match[2].replace(/^"(.*)"$/, '$1'))
        }
    }
    return {
        id: fields.get('ID') ?? '',
        versionId: fields.get('VERSION_ID') ?? '',
    }
}

export function findHost(release: OsRelease, arch: string): Host {
    const host = hosts.find(
        (candidate) => candidate.release === release.versionId,
    )
    if (release.id !== 'ubuntu' || arch !== 'x64' || host === undefined) {
        throw new Error(
            `Unsupported host: ${release.id} ${release.versionId} (${arch}). ` +
                `Supported hosts are Ubuntu ${releases.join(' and ')} on x86_64 (runs-on: ${releases.map((r) => `ubuntu-${r}`).join(' or ')}).`,
        )
    }
    return host
}

export async function readOsRelease(): Promise<OsRelease> {
    return parseOsRelease(await readFile('/etc/os-release', 'utf8'))
}

/** Prefixes a command with sudo, unless already running as root (e.g. in a container) */
export function privileged(
    command: string,
    args: string[],
): [string, string[]] {
    if (process.getuid?.() === 0) {
        return [command, args]
    }
    return ['sudo', [command, ...args]]
}
