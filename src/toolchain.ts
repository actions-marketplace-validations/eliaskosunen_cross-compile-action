import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as apt from './apt.js'
import type { Target } from './targets.js'

export type CompilerInput = 'auto' | 'clang' | 'gcc'
export type Compiler = 'clang' | 'gcc'

export interface Programs {
    cc: string
    cxx: string
    ar: string
    ranlib: string
    strip: string
}

export interface Toolchain {
    compiler: Compiler
    version: string
    programs: Programs
    /** Only for clang: --target value */
    compilerTarget?: string
    flags: string[]
}

/** A toolchain before installation; its programs are names, not paths */
export interface ToolchainPlan extends Toolchain {
    packages: string[]
    /** Only for clang: the LLVM version needs the apt.llvm.org repository */
    needsLlvmRepository: boolean
}

export function parseCompilerInput(input: string): CompilerInput {
    const value = input.trim() === '' ? 'auto' : input.trim()
    if (value !== 'auto' && value !== 'clang' && value !== 'gcc') {
        throw new Error(
            `Invalid compiler '${input}': expected 'auto', 'clang' or 'gcc'`,
        )
    }
    return value
}

export function selectCompiler(
    target: Target,
    input: CompilerInput,
    version: string,
): Compiler {
    if (input === 'auto') {
        if (version !== '') {
            throw new Error(
                "compiler-version requires an explicit compiler ('clang' or 'gcc'), because 'auto' may pick either",
            )
        }
        return target.clang === 'supported' ? 'clang' : 'gcc'
    }
    if (input === 'clang' && target.clang === 'unsupported') {
        throw new Error(
            `LLVM has no backend for ${target.name} (${target.triple}); use compiler: gcc`,
        )
    }
    return input
}

/**
 * Ubuntu's default GCC major version. The cross toolchains of each target
 * exist in this version, while their g++-<triple> metapackages may point
 * elsewhere (e.g. GCC 12 for MIPS on 24.04) or be missing.
 */
async function defaultGccVersion(): Promise<string> {
    const version = await apt.findDependency('g++', /^g\+\+-(\d+)$/)
    if (version === undefined) {
        throw new Error("Couldn't determine the default GCC version")
    }
    return version
}

async function defaultClangVersion(): Promise<string> {
    const version = await apt.findDependency('clang', /^clang-(\d+)$/)
    if (version === undefined) {
        throw new Error("Couldn't determine the default clang version")
    }
    return version
}

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function planGcc(
    target: Target,
    requestedVersion: string,
): Promise<ToolchainPlan> {
    const version =
        requestedVersion === '' ? await defaultGccVersion() : requestedVersion
    const compilerPackage = `g++-${version}-${target.gnuTriple}`
    if (!(await apt.exists(compilerPackage))) {
        const available = await apt.search(
            new RegExp(`^g\\+\\+-(\\d+)-${escape(target.gnuTriple)}$`),
        )
        throw new Error(
            `GCC ${version} isn't available for ${target.gnuTriple} (package ${compilerPackage}). ` +
                `Available versions: ${available.sort((a, b) => Number(a) - Number(b)).join(', ') || 'none'}`,
        )
    }
    const prefix = target.gnuTriple
    return {
        compiler: 'gcc',
        version,
        packages: [compilerPackage],
        needsLlvmRepository: false,
        programs: {
            cc: `${prefix}-gcc-${version}`,
            cxx: `${prefix}-g++-${version}`,
            ar: `${prefix}-gcc-ar-${version}`,
            ranlib: `${prefix}-gcc-ranlib-${version}`,
            strip: `${prefix}-strip`,
        },
        flags: target.gccFlags,
    }
}

async function planClang(
    target: Target,
    requestedVersion: string,
): Promise<ToolchainPlan> {
    const version =
        requestedVersion === '' ? await defaultClangVersion() : requestedVersion
    // clang uses the libstdc++, libgcc and crt files of the GCC cross toolchain
    const gccVersion = await defaultGccVersion()
    return {
        compiler: 'clang',
        version,
        packages: [
            `clang-${version}`,
            `llvm-${version}`,
            `libstdc++-${gccVersion}-dev-${target.debianArch}-cross`,
            `binutils-${target.gnuTriple}`,
        ],
        needsLlvmRepository: !(await apt.exists(`clang-${version}`)),
        programs: {
            cc: `clang-${version}`,
            cxx: `clang++-${version}`,
            ar: `llvm-ar-${version}`,
            ranlib: `llvm-ranlib-${version}`,
            strip: `llvm-strip-${version}`,
        },
        compilerTarget: target.triple,
        // Older clang versions look for the linker by the LLVM triple
        // (e.g. armv7-linux-gnueabihf-ld) and fall back to the host's ld
        flags: [`-B/usr/${target.gnuTriple}/bin`],
    }
}

export async function planToolchain(
    target: Target,
    compiler: Compiler,
    requestedVersion: string,
): Promise<ToolchainPlan> {
    if (requestedVersion !== '' && !/^\d+$/.test(requestedVersion)) {
        throw new Error(
            `Invalid compiler-version '${requestedVersion}': expected a major version number, e.g. 15`,
        )
    }
    return compiler === 'gcc'
        ? planGcc(target, requestedVersion)
        : planClang(target, requestedVersion)
}

export async function locateToolchain(plan: ToolchainPlan): Promise<Toolchain> {
    const programs = { ...plan.programs }
    for (const key of Object.keys(programs) as (keyof Programs)[]) {
        programs[key] = await io.which(programs[key], true)
    }
    const { compiler, version, compilerTarget, flags } = plan
    return { compiler, version, programs, compilerTarget, flags }
}

/** Experimental LLVM backends (M68k) aren't necessarily enabled in every clang build */
export async function checkClangBackend(
    toolchain: Toolchain,
    target: Target,
): Promise<void> {
    if (toolchain.compiler !== 'clang' || target.clang !== 'experimental') {
        return
    }
    const result = await exec.getExecOutput(
        toolchain.programs.cc,
        ['-print-targets'],
        { silent: true },
    )
    const architecture = target.triple.split('-')[0]
    if (
        !new RegExp(`^\\s*${escape(architecture)}\\s`, 'm').test(result.stdout)
    ) {
        throw new Error(
            `clang ${toolchain.version} was built without the experimental ${architecture} backend; use compiler: gcc`,
        )
    }
}
