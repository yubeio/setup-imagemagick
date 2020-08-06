import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'
import {promises as fs} from 'fs'

import {ExecOptions} from '@actions/exec/lib/interfaces'

const RELEASES_URL = 'http://www.imagemagick.org/download/releases'

async function run(): Promise<void> {
  checkPlatform()

  try {
    const version = core.getInput('version', {
      required: true
    })
    const configureArgs = core.getInput('configure_args')
    const artifactPath = core.getInput('artifact_path')

    // check if already instaled by another step
    let installDir: string | undefined = installedPath(version)
    let usingArtifact = false
    const artifactName = buildArtifactName(version)

    core.debug(`installDir (cached for another job): ${installDir}`)

    if (!installDir && artifactPath) {
      installDir = await loadArtifact(artifactPath)
      usingArtifact = !!installDir
    }

    // Download and compile imagemagick if not already present
    if (!installDir) {
      core.info(`Compile imagemagick v${version}`)
      installDir = await getAndCompile(version, configureArgs)
    } else {
      core.debug('imagemagick already installed')
    }

    // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
    core.debug(`installDir: ${installDir}`)

    if (!installDir) {
      throw new Error(
        [
          `ImageMagick v${version} not found`,
          `The list of all available versions can be found in: ${RELEASES_URL}`
        ].join(os.EOL)
      )
    }

    core.exportVariable('artifactName', artifactName)
    core.exportVariable('artifactDir', installDir)

    core.setOutput('artifactName', artifactName)
    core.setOutput('artifactDir', installDir)
    core.setOutput('usingArtifact', usingArtifact)

    await toolCache.cacheDir(installDir, 'imagemagick', version)
    core.addPath(path.join(installDir, 'bin'))
  } catch (error) {
    core.setFailed(error.message)
  }
}

function installedPath(version: string): string {
  return toolCache.find('imagemagick', version)
}

function buildArtifactName(version: string): string {
  return `ImageMagick-${version}-${os.arch()}-precompiled`
}

async function getAndCompile(
  version: string,
  configureArgs: string
): Promise<string> {
  const filename = `ImageMagick-${version}`
  const downloadUrl = `${RELEASES_URL}/${filename}.tar.xz`

  core.info(`Download from "${downloadUrl}"`)
  const sourcePath = await toolCache.downloadTool(downloadUrl)

  core.startGroup(`Extract downloaded archive`)
  const sourceExtractedFolder = await toolCache.extractTar(
    sourcePath,
    undefined,
    'x'
  )
  core.debug(`Extracted folder ${sourceExtractedFolder}`)

  const sourceRoot = path.join(sourceExtractedFolder, filename)
  core.endGroup()

  const precompiledDir = path.resolve('..', buildArtifactName(version))

  core.info(`Install with configure args "${configureArgs}"`)
  await compileImageMagick(sourceRoot, precompiledDir, configureArgs)

  return precompiledDir
}

async function loadArtifact(
  artifactPath?: string
): Promise<string | undefined> {
  if (!artifactPath) return undefined

  artifactPath = path.resolve(artifactPath)

  core.debug(`artifactPath: ${artifactPath}`)

  await exec.exec('pwd')
  await exec.exec('ls -alh')

  try {
    await fs.access(artifactPath)
    const binPath = path.join(artifactPath, 'bin')

    await exec.exec(`ls -alh ${binPath}`)
    await exec.exec(`chmod -R 755 ${binPath}`)
    await exec.exec(`ls -alh ${binPath}`)
    core.debug(`success load artifact directory ${artifactPath}`)
  } catch (error) {
    core.debug(`missing artifact directory ${artifactPath}: ${error}`)

    artifactPath = undefined
  }

  return artifactPath
}

async function compileImageMagick(
  sourceDir: string,
  precompiledDir: string,
  configureArgs: string
): Promise<void> {
  const options: ExecOptions = {
    cwd: sourceDir,
    // silent: true,
    listeners: {
      // stdout: (data: Buffer) => {
      //   core.info(data.toString().trim())
      // },
      stderr: (data: Buffer) => {
        core.error(data.toString().trim())
      }
    }
  }

  core.startGroup(`./configure ${configureArgs}`)
  await exec.exec(
    'sudo',
    [
      './configure',
      `--prefix=${precompiledDir}`,
      ...configureArgs.split(' ')
    ].filter(Boolean),
    options
  )
  core.endGroup()

  core.startGroup(`make`)
  await exec.exec('sudo', ['make'], options)
  core.endGroup()

  core.startGroup(`make install`)
  await exec.exec('sudo', ['make', 'install'], options)
  core.endGroup()

  const skipCheck = parseBoolean(core.getInput('skip_check'), false)

  if (!skipCheck) {
    core.startGroup(`make check`)
    await exec.exec('sudo', ['make', 'check'], options)
    core.endGroup()
  }

  await exec.exec('sudo', ['ldconfig'], options)
}

function parseBoolean(input: string, defaultValue: string | boolean): boolean {
  return (input || `${defaultValue}`).toLowerCase() === 'true'
}

function checkPlatform(): void {
  if (process.platform !== 'linux')
    throw new Error(
      '@gullitmiranda/setup-imagemagick only supports Ubuntu Linux at this time'
    )
}

run()
