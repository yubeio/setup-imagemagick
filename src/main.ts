import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'

import {ExecOptions} from '@actions/exec/lib/interfaces'

const RELEASES_URL = 'http://www.imagemagick.org/download/releases'

async function run(): Promise<void> {
  checkPlatform()

  try {
    const version = core.getInput('version', {
      required: true
    })
    const configureArgs = core.getInput('configure_args')

    // Download and compile imagemagick if not already present
    let installDir = installedPath(version)

    if (!installDir) {
      core.info(`Compile imagemagick v${version}`)

      installDir = await getAndCompile(version, configureArgs)

      await toolCache.cacheDir(installDir, 'imagemagick', version)
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

    core.exportVariable('artifactName', path.basename(installDir))
    core.exportVariable('artifactDir', installDir)

    core.setOutput('artifactName', path.basename(installDir))
    core.setOutput('artifactDir', installDir)

    core.addPath(path.join(installDir, 'bin'))
  } catch (error) {
    core.setFailed(error.message)
  }
}

function installedPath(version: string): string {
  return toolCache.find('imagemagick', version)
}

function precompiledFilename(version: string): string {
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

  const precompiledDir = path.resolve('..', precompiledFilename(version))

  core.info(`Install with configure args "${configureArgs}"`)
  await compileImageMagick(sourceRoot, precompiledDir, configureArgs)

  return precompiledDir
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

  core.startGroup(`make check`)
  await exec.exec('sudo', ['make', 'check'], options)
  core.endGroup()

  await exec.exec('sudo', ['ldconfig'], options)
}

function checkPlatform(): void {
  if (process.platform !== 'linux')
    throw new Error(
      '@gullitmiranda/setup-imagemagick only supports Ubuntu Linux at this time'
    )
}

run()
