import type * as exec from '@actions/exec'

/** Package state of the emulated host; tests may change it */
export const aptState = {
    packages: [] as string[],
    dependencies: {} as Record<string, string>,
}

export function resetAptState(): void {
    aptState.packages = [
        'clang-20',
        'clang-21',
        'clang-22',
        'g++-9-hppa-linux-gnu',
        'g++-14-hppa-linux-gnu',
        'g++-15-hppa-linux-gnu',
        'g++-15-arm-linux-gnueabi',
        'g++-15-arm-linux-gnueabihf',
        'g++-15-i686-linux-gnu',
        'g++-15-aarch64-linux-gnu',
        'g++-13-mips64el-linux-gnuabi64',
    ]
    aptState.dependencies = { clang: 'clang-21', 'g++': 'g++-15' }
}

/** A getExecOutput implementation that answers apt-cache queries from aptState */
export const aptCache: typeof exec.getExecOutput = async (
    command,
    args = [],
) => {
    const name = args.at(-1) ?? ''
    const output = (stdout: string, exitCode = 0) => ({
        exitCode,
        stdout,
        stderr: '',
    })
    if (command !== 'apt-cache') {
        throw new Error(`Unexpected command: ${command}`)
    }
    switch (args[0]) {
        case 'show':
            return aptState.packages.includes(name)
                ? output(`Package: ${name}\n`)
                : output('', 100)
        case 'depends':
            return output(
                `${name}\n  Depends: ${aptState.dependencies[name] ?? 'libc6'}\n`,
            )
        case 'pkgnames':
            return output(aptState.packages.join('\n'))
        default:
            throw new Error(`Unexpected apt-cache command: ${args[0]}`)
    }
}
