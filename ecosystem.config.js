module.exports = {
  apps: [
    {
      name: 'vless',
      script: 'lib/index.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        UUID: 'a6e8c036bd124d45b431-f39213494c1d',
        PORT: 19594,
        WS_PATH: '/ws',
      },
    },
  ],
}
