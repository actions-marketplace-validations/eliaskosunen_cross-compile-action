import * as core from '@actions/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as apt from './apt.js'
import {
    cmakeToolchainFile,
    environment,
    mesonCrossFile,
    type GeneratedFiles,
    type Setup,
} from './generate.js'
import { findHost, readOsRelease, type Host } from './host.js'
import { ensureBinfmt, locateQemu } from './qemu.js'
import { runInContainer, runOnHost } from './script.js'
import { findTarget, type Target } from './targets.js'
import {
    checkClangBackend,
    locateToolchain,
    parseCompilerInput,
    planToolchain,
    selectCompiler,
} from './toolchain.js'

interface Inputs {
    target: string
    compiler: string
    compilerVersion: string
    qemuCpu: string
    compile: string
    run: string
    workingDirectory: string
    containerImage: string
    containerOptions: string[]
    exportEnv: boolean
}

function readInputs(): Inputs {
    return {
        target: core.getInput('target', { required: true }),
        compiler: core.getInput('compiler'),
        compilerVersion: core.getInput('compiler-version').trim(),
        qemuCpu: core.getInput('qemu-cpu').trim(),
        compile: core.getInput('compile'),
        run: core.getInput('run'),
        workingDirectory: core.getInput('working-directory').trim(),
        containerImage: core.getInput('container-image').trim(),
        containerOptions: core.getMultilineInput('container-options'),
        exportEnv: core.getBooleanInput('export-env'),
    }
}

/** `default` leaves the choice to QEMU */
function resolveQemuCpu(target: Target, input: string): string | undefined {
    if (input === 'default') {
        return undefined
    }
    return input === '' ? target.qemuCpu : input
}

/** The Docker platform for container mode, or undefined when the `run` script runs on the host */
function containerPlatform(target: Target, inputs: Inputs): string | undefined {
    if (inputs.containerImage === '') {
        return undefined
    }
    if (target.dockerPlatform === undefined) {
        throw new Error(
            `container-image isn't supported for ${target.triple}: it has no Docker platform`,
        )
    }
    return target.dockerPlatform
}

function checkAvailability(target: Target, host: Host): void {
    if (
        target.releases !== undefined &&
        !target.releases.includes(host.release)
    ) {
        throw new Error(
            `${target.name} (${target.triple}) isn't available on Ubuntu ${host.release}. ` +
                `Use runs-on: ${target.releases.map((release) => `ubuntu-${release}`).join(' or ')}.`,
        )
    }
}

async function install(
    target: Target,
    host: Host,
    inputs: Inputs,
): Promise<Setup> {
    const compiler = selectCompiler(
        target,
        parseCompilerInput(inputs.compiler),
        inputs.compilerVersion,
    )
    if (compiler === 'clang' && target.clang === 'experimental') {
        core.warning(
            `LLVM's ${target.name} backend is experimental. In testing, calls into glibc's libm returned wrong floating-point results.`,
        )
    }

    await apt.update()
    const plan = await planToolchain(target, compiler, inputs.compilerVersion)
    if (plan.needsLlvmRepository) {
        await apt.addLlvmRepository(plan.version, host.codename)
    }
    await apt.install([
        ...plan.packages,
        ...(target.qemu !== null ? host.qemuPackages : []),
        ...(target.runtimePackages ?? []),
    ])

    const toolchain = await locateToolchain(plan)
    await checkClangBackend(toolchain, target)

    const emulator =
        target.qemu !== null
            ? {
                  path: await locateQemu(target.qemu, host),
                  cpu: resolveQemuCpu(target, inputs.qemuCpu),
              }
            : null
    return { target, toolchain, sysroot: `/usr/${target.gnuTriple}`, emulator }
}

async function checkBinfmt(target: Target, inputs: Inputs): Promise<void> {
    if (target.qemu === null) {
        return
    }
    const binfmt = await ensureBinfmt(target.qemu)
    const container = inputs.containerImage !== ''
    if (binfmt === undefined || !binfmt.enabled) {
        const message = `No binfmt_misc handler is registered for qemu-${target.qemu}`
        if (container) {
            throw new Error(`${message}, so container mode can't work`)
        }
        core.warning(
            `${message}. Target executables can't be run directly; run them through qemu-${target.qemu} or CMAKE_CROSSCOMPILING_EMULATOR.`,
        )
    } else if (container && !binfmt.flags.includes('F')) {
        throw new Error(
            `The binfmt_misc handler for qemu-${target.qemu} lacks the F (fix binary) flag, so it can't be used inside containers`,
        )
    }
}

async function writeFiles(setup: Setup): Promise<GeneratedFiles> {
    const { target, toolchain } = setup
    const directory = path.join(
        process.env.RUNNER_TEMP ?? tmpdir(),
        'cross-compile-action',
        `${target.triple}-${toolchain.compiler}-${toolchain.version}`,
    )
    await mkdir(directory, { recursive: true })
    const files = {
        toolchainFile: path.join(directory, 'toolchain.cmake'),
        mesonCrossFile: path.join(directory, 'meson-cross.ini'),
    }
    await writeFile(files.toolchainFile, cmakeToolchainFile(setup))
    await writeFile(files.mesonCrossFile, mesonCrossFile(setup))
    return files
}

function setOutputs(
    setup: Setup,
    files: GeneratedFiles,
    env: Record<string, string>,
): void {
    const { target, toolchain, sysroot, emulator } = setup
    const outputs: Record<string, string> = {
        triple: target.triple,
        'gnu-triple': target.gnuTriple,
        name: target.name,
        'cmake-system-processor': target.cmakeProcessor,
        sysroot,
        compiler: toolchain.compiler,
        'compiler-version': toolchain.version,
        cc: env.CC,
        cxx: env.CXX,
        'toolchain-file': files.toolchainFile,
        'meson-cross-file': files.mesonCrossFile,
        qemu: emulator?.path ?? '',
        'qemu-cpu': emulator?.cpu ?? '',
    }
    for (const [name, value] of Object.entries(outputs)) {
        core.setOutput(name, value)
        core.info(`${name}: ${value}`)
    }
}

export async function run(): Promise<void> {
    try {
        const inputs = readInputs()
        const target = findTarget(inputs.target)
        const platform = containerPlatform(target, inputs)
        const host = findHost(await readOsRelease(), process.arch)
        checkAvailability(target, host)

        const setup = await core.group(`Set up ${target.name}`, () =>
            install(target, host, inputs),
        )
        await checkBinfmt(target, inputs)
        const files = await writeFiles(setup)
        const env = environment(setup, files)
        if (inputs.exportEnv) {
            for (const [name, value] of Object.entries(env)) {
                core.exportVariable(name, value)
            }
        }
        setOutputs(setup, files, env)

        const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
        const cwd = path.resolve(workspace, inputs.workingDirectory)
        if (inputs.compile !== '') {
            await core.group('Compile', () =>
                runOnHost('compile', inputs.compile, { cwd, env }),
            )
        }
        if (inputs.run !== '') {
            await core.group('Run', () =>
                platform !== undefined
                    ? runInContainer(inputs.run, {
                          image: inputs.containerImage,
                          platform,
                          workspace,
                          cwd,
                          // Host paths (compilers, sysroot) are meaningless inside the container
                          env: Object.fromEntries(
                              Object.entries(env).filter(([name]) =>
                                  ['CROSS_TRIPLE', 'QEMU_CPU'].includes(name),
                              ),
                          ),
                          extraArgs: inputs.containerOptions,
                      })
                    : runOnHost('run', inputs.run, { cwd, env }),
            )
        }
    } catch (error) {
        core.setFailed(error instanceof Error ? error.message : String(error))
    }
}
