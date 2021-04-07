const socket = (require('socket.io-client'))('https://miakapi3.cloud.usp-3.fr/', {
  auth: {
    id: 'user1@test.com',
    token: '123',
  },
});

console.log('Connecting...');

socket.on('connect', (...data) => {
  console.log('Connected', data);
});

socket.on('disconnect', (...data) => {
  console.log('Disconnected', data);
});
