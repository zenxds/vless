module.exports = {
  apps: [
    {
      name: 'vless',
      script: 'lib/index.js',
      instances: process.env.PM2_INSTANCES || '2',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        // UUID: '',
        // PORT: 19594,
        // WS_PATH: '/ws',
      },
    },
  ],
}
