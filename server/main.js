const io = require('socket.io')(process.env.PORT || 3000, {
  serveClient: false,
  cookie: false,
});

const TEST_CREDS = {
  'user1@test.com': '123',
  'user2@test.com': '456',
};

function login({ id, token }) {
  return TEST_CREDS[id] && TEST_CREDS[id] === token;
}

const loggedUsers = {};

io.use((socket, next) => {
  if (
    !socket.handshake.auth.id
    || !socket.handshake.auth.token
    || !login(socket.handshake.auth)
  ) return;

  if (!loggedUsers[socket.handshake.auth.id]) {
    loggedUsers[socket.handshake.auth.id] = {
      sockets: [],
    };
  }

  loggedUsers[socket.handshake.auth.id].sockets.push(socket.id);

  next();
});

io.on('connect', (socket) => {
  const user = loggedUsers[socket.handshake.auth.id];

  console.log('User connected', user);

  socket.on('disconnect', () => {
    console.log('User disconnected', socket.id);
    user.sockets = user.sockets.filter((s) => s !== socket.id);
  });
});
