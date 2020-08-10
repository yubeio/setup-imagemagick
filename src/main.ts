import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'
import {promises as fs} from 'fs'

import {ExecOptions} from '@actions/exec/lib/interfaces'

const SOURCE_RELEASES_URL = 'http://www.imagemagick.org/download/releases'
const GITHUB_RELEASES_URL =
  'https://github.com/gullitmiranda/setup-imagemagick/releases'

async function run(): Promise<void> {
  checkPlatform()

  try {
    const version = core.getInput('version', {
      required: true
    })
    const configureArgs = core.getInput('configure_args')
    const artifactPath = core.getInput('artifact_path')
    const releaseTag = core.getInput('release_tag')
    const compileFallback = parseBoolean(
      core.getInput('compile_fallback'),
      false
    )
    const skipCache = parseBoolean(core.getInput('skip_cache'), false)

    const artifactName = buildArtifactName(version)
    let installDir: string | undefined

    // check if already instaled by another step
    if (!skipCache) {
      installDir = installedPath(version)

      // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
      core.debug(`installDir (cached for another job): ${installDir}`)
    }

    if (!installDir && releaseTag) {
      installDir = await getFromRelease(releaseTag, version)
    }

    if (!installDir && artifactPath) {
      installDir = await loadArtifact(artifactPath)
    }

    if (!installDir && !compileFallback) {
      const from = [
        releaseTag && 'release_tag',
        artifactPath && 'artifact_path'
      ]
        .filter(Boolean)
        .join(' or ')

      throw Error(
        `Fail to get precompiled file from ${from}, and the compile_fallback option is disabled`
      )
    }

    if (!installDir) {
      // Download and compile imagemagick if not already present
      core.info(`Compile imagemagick v${version}`)
      installDir = await getAndCompile(version, configureArgs)
    }

    core.debug(`installDir: ${installDir}`)

    if (!installDir) {
      throw new Error(
        [
          `ImageMagick v${version} not found`,
          `The list of all available versions can be found in: ${SOURCE_RELEASES_URL}`
        ].join(os.EOL)
      )
    }

    core.setOutput('artifactName', artifactName)
    core.setOutput('artifactDir', installDir)

    await exec.exec('sudo', ['ldconfig', path.resolve(installDir, 'lib')], {
      listeners: {
        // stdout: (data: Buffer) => {
        //   core.info(data.toString().trim())
        // },
        stderr: (data: Buffer) => {
          core.error(data.toString().trim())
        }
      }
    })

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

async function getFromRelease(
  releaseTag: string,
  version: string
): Promise<string | undefined> {
  const filename = buildArtifactName(version)
  const downloadUrl = `${GITHUB_RELEASES_URL}/download/${releaseTag}/${filename}.tar.gz`
  let installDir
  let downloadedFile

  try {
    core.info(`Download from "${downloadUrl}"`)
    downloadedFile = await toolCache.downloadTool(downloadUrl)
  } catch (error) {
    core.error(
      `fail to get artifact ${filename} from release ${releaseTag}. See all available releases and versions in ${GITHUB_RELEASES_URL}`
    )
    core.debug(error)
  }

  if (downloadedFile) {
    core.startGroup(`Extract downloaded archive`)
    const extractedFolder = await toolCache.extractTar(
      downloadedFile,
      undefined,
      'zx'
    )
    core.endGroup()
    core.debug(`Extracted folder ${extractedFolder}`)
    installDir = path.join(extractedFolder, filename)

    const binPath = path.join(installDir, 'bin')

    await exec.exec(`chmod -R 755 ${binPath}`)
  }

  return installDir
}

async function loadArtifact(
  artifactPath?: string
): Promise<string | undefined> {
  if (!artifactPath) return undefined

  artifactPath = path.resolve(artifactPath)

  core.debug(`artifactPath: ${artifactPath}`)

  try {
    await fs.access(artifactPath)
    const binPath = path.join(artifactPath, 'bin')

    await exec.exec(`chmod -R 755 ${binPath}`)
    core.debug(`success load artifact directory ${artifactPath}`)
  } catch (error) {
    core.debug(`missing artifact directory ${artifactPath}: ${error}`)

    artifactPath = undefined
  }

  return artifactPath
}

async function getAndCompile(
  version: string,
  configureArgs: string
): Promise<string> {
  const filename = `ImageMagick-${version}`
  const downloadUrl = `${SOURCE_RELEASES_URL}/${filename}.tar.xz`

  core.info(`Download from "${downloadUrl}"`)
  const sourcePath = await toolCache.downloadTool(downloadUrl)

  core.startGroup(`Extract downloaded archive`)
  const sourceExtractedFolder = await toolCache.extractTar(
    sourcePath,
    undefined,
    'x'
  )
  core.endGroup()
  core.debug(`Extracted folder ${sourceExtractedFolder}`)

  const sourceRoot = path.join(sourceExtractedFolder, filename)

  const precompiledDir = path.resolve('..', buildArtifactName(version))

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

  const skipCheck = parseBoolean(core.getInput('skip_check'), false)

  if (!skipCheck) {
    core.startGroup(`make check`)
    await exec.exec('sudo', ['make', 'check'], options)
    core.endGroup()
  }
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
