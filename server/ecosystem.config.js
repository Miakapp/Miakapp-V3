module.exports = {
  apps: [
    {
      name: 'miakapp-worker-default',
      script: './main.js',
      max_memory_restart: '300M',
    },
  ],
};
