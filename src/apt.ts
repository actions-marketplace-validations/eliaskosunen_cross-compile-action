import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { privileged } from './host.js'

const llvmKeyUrl = 'https://apt.llvm.org/llvm-snapshot.gpg.key'
const llvmKeyring = '/etc/apt/keyrings/apt.llvm.org.asc'

export async function update(): Promise<void> {
    await exec.exec(...privileged('apt-get', ['update', '-q']))
}

export async function install(packages: string[]): Promise<void> {
    await exec.exec(
        ...privileged('env', [
            'DEBIAN_FRONTEND=noninteractive',
            'apt-get',
            'install',
            '-y',
            '-q',
            '--no-install-recommends',
            ...packages,
        ]),
    )
}

export async function exists(name: string): Promise<boolean> {
    const result = await exec.getExecOutput(
        'apt-cache',
        ['show', '--no-all-versions', name],
        { ignoreReturnCode: true, silent: true },
    )
    return result.exitCode === 0 && result.stdout.trim() !== ''
}

/** Returns the first capture group of `pattern` among the package's direct dependencies */
export async function findDependency(
    name: string,
    pattern: RegExp,
): Promise<string | undefined> {
    const result = await exec.getExecOutput(
        'apt-cache',
        ['depends', '--no-recommends', '--no-suggests', name],
        { ignoreReturnCode: true, silent: true },
    )
    for (const line of result.stdout.split('\n')) {
        const match = /^\s*Depends:\s*(\S+)/.exec(line)
        const dependency = match !== null ? pattern.exec(match[1]) : null
        if (dependency !== null) {
            return dependency[1]
        }
    }
    return undefined
}

/** Returns the captured groups of `pattern` for every package whose name matches it */
export async function search(pattern: RegExp): Promise<string[]> {
    const result = await exec.getExecOutput('apt-cache', ['pkgnames'], {
        silent: true,
    })
    return result.stdout
        .split('\n')
        .map((name) => pattern.exec(name.trim())?.[1])
        .filter((captured): captured is string => captured !== undefined)
}

export async function addLlvmRepository(
    version: string,
    codename: string,
): Promise<void> {
    core.info(`Adding apt.llvm.org repository for LLVM ${version}`)
    const response = await fetch(llvmKeyUrl)
    if (!response.ok) {
        throw new Error(
            `Failed to download ${llvmKeyUrl}: ${response.status} ${response.statusText}`,
        )
    }
    const key = Buffer.from(await response.arrayBuffer())
    await exec.exec(...privileged('install', ['-d', '/etc/apt/keyrings']))
    await exec.exec(...privileged('tee', [llvmKeyring]), {
        input: key,
        silent: true,
    })
    const source = `deb [signed-by=${llvmKeyring}] http://apt.llvm.org/${codename}/ llvm-toolchain-${codename}-${version} main\n`
    await exec.exec(
        ...privileged('tee', [`/etc/apt/sources.list.d/llvm-${version}.list`]),
        { input: Buffer.from(source) },
    )
    await update()
}
