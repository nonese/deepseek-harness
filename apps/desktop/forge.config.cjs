module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'FZFX-DSH',
    extraResource: ['./runtime', './desktop.config.json'],
  },
  rebuildConfig: {},
  makers: [{
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'FZFX_DSH',
      setupExe: 'FZFX-DSH-Setup.exe',
      noMsi: true,
      authors: '奉中附小',
      description: '奉中附小 DSH Windows desktop client',
    },
  }],
}
