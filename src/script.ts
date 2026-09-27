import * as exec from '@actions/exec'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Matches the default `bash` shell of GitHub Actions run steps
const bashArgs = ['--noprofile', '--norc', '-eo', 'pipefail']

export async function runOnHost(
    name: string,
    script: string,
    options: { cwd: string; env: Record<string, string> },
): Promise<void> {
    const directory = await mkdtemp(
        path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'cross-compile-action-'),
    )
    const file = path.join(directory, `${name}.sh`)
    await writeFile(file, script)
    await exec.exec('bash', [...bashArgs, file], {
        cwd: options.cwd,
        env: { ...(process.env as Record<string, string>), ...options.env },
    })
}

export interface ContainerOptions {
    image: string
    platform: string
    workspace: string
    cwd: string
    env: Record<string, string>
    extraArgs: string[]
}

export function containerArgs(options: ContainerOptions): string[] {
    const volumes = [options.workspace]
    const relative = path.relative(options.workspace, options.cwd)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        volumes.push(options.cwd)
    }
    return [
        'run',
        '--rm',
        '--interactive',
        '--platform',
        options.platform,
        '--user',
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        '--env',
        'HOME=/tmp',
        ...Object.entries(options.env).flatMap(([key, value]) => [
            '--env',
            `${key}=${value}`,
        ]),
        ...volumes.flatMap((volume) => ['--volume', `${volume}:${volume}`]),
        '--workdir',
        options.cwd,
        ...options.extraArgs,
        options.image,
        'bash',
        ...bashArgs,
        '-s',
    ]
}

export async function runInContainer(
    script: string,
    options: ContainerOptions,
): Promise<void> {
    await exec.exec('docker', containerArgs(options), {
        input: Buffer.from(script),
    })
}
