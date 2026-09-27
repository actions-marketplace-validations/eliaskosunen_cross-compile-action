import { findHost, parseOsRelease } from '../src/host.js'

const resolute = `PRETTY_NAME="Ubuntu 26.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="26.04"
VERSION_CODENAME=resolute
ID=ubuntu
ID_LIKE=debian
`

describe('parseOsRelease', () => {
    it('parses quoted and unquoted values', () => {
        expect(parseOsRelease(resolute)).toEqual({
            id: 'ubuntu',
            versionId: '26.04',
        })
    })

    it('leaves missing fields empty', () => {
        expect(parseOsRelease('ID=fedora\n')).toEqual({
            id: 'fedora',
            versionId: '',
        })
    })
})

describe('findHost', () => {
    it.each([
        ['24.04', 'noble', ['qemu-user-static']],
        ['26.04', 'resolute', ['qemu-user', 'qemu-user-binfmt']],
    ])('supports Ubuntu %s', (versionId, codename, qemuPackages) => {
        expect(findHost({ id: 'ubuntu', versionId }, 'x64')).toMatchObject({
            codename,
            qemuPackages,
        })
    })

    it('rejects other releases', () => {
        expect(() =>
            findHost({ id: 'ubuntu', versionId: '22.04' }, 'x64'),
        ).toThrow(
            'Unsupported host: ubuntu 22.04 (x64). Supported hosts are Ubuntu 24.04 and 26.04 on x86_64 (runs-on: ubuntu-24.04 or ubuntu-26.04).',
        )
    })

    it('rejects other distributions', () => {
        expect(() =>
            findHost({ id: 'debian', versionId: '26.04' }, 'x64'),
        ).toThrow(/Unsupported host/)
    })

    it('rejects other architectures', () => {
        expect(() => findHost(parseOsRelease(resolute), 'arm64')).toThrow(
            /Unsupported host/,
        )
    })
})
