module.exports = {
  apps: [
    {
      name: 'gorod-dating',
      script: 'src/server.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
