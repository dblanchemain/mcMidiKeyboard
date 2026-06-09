module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: ['python'],
    name: 'mcMidiKeyboard',
    executableName: 'mc-midi-keyboard',
    icon: 'images/icon',   // .ico (win), .icns (mac), .png (linux)
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
