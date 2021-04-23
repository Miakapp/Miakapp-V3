module.exports = {
  apps: [
    {
      name: 'miakapp-worker-default',
      script: './main.js',

      max_memory_restart: '100M',
    },
    {
      name: 'miakapp-worker-rescue',
      script: './main.js',

      max_memory_restart: '100M',
    },
  ],
};
