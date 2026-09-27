// Regenerates the target table in README.md from src/targets.ts.
// With --check, fails instead if the table is out of date.
import { readFile, writeFile } from 'node:fs/promises'
import * as prettier from 'prettier'
import { releases } from '../src/host.ts'
import { targets } from '../src/targets.ts'

const start = '<!-- targets:start -->'
const end = '<!-- targets:end -->'

const clang = {
    supported: '✓',
    experimental: 'experimental',
    unsupported: '✗',
}

const rows = targets.map((target) =>
    [
        `\`${target.triple}\``,
        target.aliases.map((alias) => `\`${alias}\``).join(', '),
        target.name,
        clang[target.clang],
        (target.releases ?? releases).join(', '),
        target.qemu === null ? 'native' : (target.qemuCpu ?? 'QEMU default'),
        target.dockerPlatform !== undefined
            ? `\`${target.dockerPlatform}\``
            : '✗',
    ].join(' | '),
)

const table = [
    '| Triple | Aliases | Name | clang | Ubuntu | QEMU CPU | Container platform |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
].join('\n')

const readme = await readFile('README.md', 'utf8')
const startIndex = readme.indexOf(start)
const endIndex = readme.indexOf(end)
if (startIndex === -1 || endIndex === -1) {
    throw new Error(`README.md must contain ${start} and ${end}`)
}
const updated = await prettier.format(
    readme.slice(0, startIndex + start.length) +
        '\n\n' +
        table +
        '\n\n' +
        readme.slice(endIndex),
    { ...(await prettier.resolveConfig('README.md')), filepath: 'README.md' },
)

if (process.argv.includes('--check')) {
    if (updated !== readme) {
        console.error(
            'The target table in README.md is out of date; run npm run docs',
        )
        process.exit(1)
    }
} else {
    await writeFile('README.md', updated)
}
