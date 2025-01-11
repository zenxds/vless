module.exports = {
  apps: [
    {
      name: 'vless',
      script: 'lib/index.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        UUID: '',
        PORT: 19594,
        WS_PATH: '/ws',
      },
    },
  ],
}
