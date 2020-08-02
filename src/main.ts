import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'

// import {wait} from './wait'

async function run(): Promise<void> {
  checkPlatform()

  try {
    const imageMagickVersion = core.getInput('imagemagick_version', {
      required: true
    })
    // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
    core.debug(new Date().toTimeString())

    // Download and compile imagemagick if not already present
    const toolPath = installedPath(imageMagickVersion)
    core.debug(`toolPath: ${toolPath}`)

    if (toolPath) {
      core.debug('imagemagick already installed')
    }

    core.info(`Start setup imagemagick v${imageMagickVersion}`)

    // await wait(parseInt(ms, 10))
    core.debug(new Date().toTimeString())

    // core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    core.setFailed(error.message)
  }
}

function installedPath(version: string): string {
  return toolCache.find('imagemagick', version)
}

function checkPlatform(): void {
  if (process.platform !== 'linux')
    throw new Error(
      '@actions/setup-imagemagick only supports Ubuntu Linux at this time'
    )
}

run()
