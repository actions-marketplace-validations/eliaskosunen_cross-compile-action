import { findTarget, normalizeTriple, targets } from '../src/targets.js'

describe('normalizeTriple', () => {
    it.each([
        ['armv7-unknown-linux-gnueabihf', 'armv7-linux-gnueabihf'],
        ['i686-pc-linux-gnu', 'i686-linux-gnu'],
        [' AArch64-Linux-GNU ', 'aarch64-linux-gnu'],
        ['hppa-linux-gnu', 'hppa-linux-gnu'],
        ['armv7', 'armv7'],
    ])('%s -> %s', (input, expected) => {
        expect(normalizeTriple(input)).toBe(expected)
    })
})

describe('findTarget', () => {
    it('finds a target by triple', () => {
        expect(findTarget('powerpc64le-linux-gnu').debianArch).toBe('ppc64el')
    })

    it('finds a target by triple with a vendor', () => {
        expect(findTarget('riscv64-unknown-linux-gnu').triple).toBe(
            'riscv64-linux-gnu',
        )
    })

    it('finds a target by alias', () => {
        expect(findTarget('arm64').triple).toBe('aarch64-linux-gnu')
        expect(findTarget('PPC64LE').triple).toBe('powerpc64le-linux-gnu')
    })

    it('finds MIPS targets', () => {
        expect(findTarget('mips64el').triple).toBe('mips64el-linux-gnuabi64')
        expect(findTarget('mipsisa32r6el-linux-gnu')).toMatchObject({
            debianArch: 'mipsr6el',
            qemu: 'mipsel',
            qemuCpu: 'mips32r6-generic',
            endian: 'little',
        })
        expect(findTarget('mips64r6')).toMatchObject({
            gnuTriple: 'mipsisa64r6-linux-gnuabi64',
            debianArch: 'mips64r6',
            qemu: 'mips64',
            endian: 'big',
        })
    })

    it('lists the supported targets for an unknown target', () => {
        expect(() => findTarget('x86_64-apple-darwin')).toThrow(
            /Unsupported target 'x86_64-apple-darwin'.*\n.*armv5te-linux-gnueabi \(armv5, armv5te, armel\)/,
        )
    })
})

describe('target table', () => {
    it('has unique triples and aliases', () => {
        const names = targets.flatMap((target) => [
            target.triple,
            ...target.aliases,
        ])
        expect(new Set(names).size).toBe(names.length)
    })

    it.each(targets.map((target) => [target.triple, target]))(
        '%s is consistent',
        (_, target) => {
            expect(normalizeTriple(target.triple)).toBe(target.triple)
            expect(target.triple.split('-')).toHaveLength(3)
            expect(target.aliases.length).toBeGreaterThan(0)
            expect(target.name).not.toBe('')
            expect(target.gnuTriple).toMatch(/^[a-z0-9_]+-linux-gnu/)
            expect(target.debianArch).not.toBe('')
            expect(target.cmakeProcessor).not.toBe('')
            // Only targets that run natively need extra runtime packages on the host
            expect(target.qemu === null).toBe(
                target.runtimePackages !== undefined,
            )
            // A native target has no QEMU CPU to pin
            expect(target.qemu !== null || target.qemuCpu === undefined).toBe(
                true,
            )
        },
    )
})
