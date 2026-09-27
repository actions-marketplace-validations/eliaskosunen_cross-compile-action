import { containerArgs } from '../src/script.js'

describe('containerArgs', () => {
    const options = {
        image: 'debian:trixie',
        platform: 'linux/arm64',
        workspace: '/work',
        cwd: '/work/sub',
        env: { QEMU_CPU: 'cortex-a53' },
        extraArgs: ['--privileged'],
    }

    it('mounts the workspace and forwards the environment', () => {
        const args = containerArgs(options)
        expect(args.slice(0, 5)).toEqual([
            'run',
            '--rm',
            '--interactive',
            '--platform',
            'linux/arm64',
        ])
        expect(args.join(' ')).toContain(
            '--env HOME=/tmp --env QEMU_CPU=cortex-a53 --volume /work:/work --workdir /work/sub --privileged debian:trixie bash',
        )
        expect(args.at(-1)).toBe('-s')
    })

    it('also mounts a working directory outside the workspace', () => {
        const args = containerArgs({ ...options, cwd: '/elsewhere' })
        expect(args.join(' ')).toContain(
            '--volume /work:/work --volume /elsewhere:/elsewhere',
        )
    })
})
