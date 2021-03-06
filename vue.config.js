module.exports = {
  filenameHashing: false,
  outputDir: './dist',
  pwa: {
    name: 'Miakapp',
    themeColor: '#ffbf01',
    msTileColor: '#ffbf01',
    workboxPluginMode: 'InjectManifest',
    assetsVersion: '3.0',
    appleMobileWebAppCapable: 'yes',
    appleMobileWebAppStatusBarStyle: 'blue',
    manifestOptions: {
      start_url: './h',
      background_color: '#ffbf01',
      display: 'standalone',
      icons: [
        {
          src: './icons/512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        {
          src: './icons/256.png',
          sizes: '256x256',
          type: 'image/png',
        },
        {
          src: './icons/128.png',
          sizes: '128x128',
          type: 'image/png',
        },
      ],
      gcm_sender_id: '103953800507',
    },
    iconPaths: {
      msTileImage: './icons/mstile-256.png',
      appleTouchIcon: './icons/128.png',
      favicon32: './icons/favicon-32.png',
      favicon16: './icons/favicon-16.png',
      maskIcon: './icons/logo.svg',
    },
    workboxOptions: {
      swSrc: 'sw.js',
    },
  },
  devServer: {
    disableHostCheck: true,
  },
};
