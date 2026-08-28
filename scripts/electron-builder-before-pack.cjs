const { normalizeArch, normalizePlatform } = require('../electron/rifeRuntime')
const { verifyStagedReleaseInputs } = require('./runtime-package-gate.cjs')

module.exports = async function beforePack(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  verifyStagedReleaseInputs({
    projectRoot: context.packager.projectDir,
    platform,
    arch,
  })
}
