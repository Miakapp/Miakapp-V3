const socket = (require('socket.io-client'))(`http://localhost:${process.env.PORT || 3000}/`, {
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
