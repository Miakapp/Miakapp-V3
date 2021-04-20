const firebase = require('firebase-admin');
const SocketIO = require('socket.io');
const firebaseCredentials = require('./firebaseCredentials.json');

firebase.initializeApp({
  credential: firebase.credential.cert(firebaseCredentials),
  databaseURL: 'https://miakapp-v2.firebaseio.com',
});

const auth = firebase.auth();
// const fcm = firebase.messaging();

const io = SocketIO(process.env.PORT || 3000, {
  serveClient: false,
  cookie: false,
});

const loggedUsers = {};

io.use(async (socket, next) => {
  if (!socket.handshake.auth.token
    || !socket.handshake.auth.uid) return;

  auth.verifyIdToken(socket.handshake.auth.token).then((fUser) => {
    if (!loggedUsers[fUser.uid]) {
      loggedUsers[fUser.uid] = {
        sockets: [],
      };
    }

    loggedUsers[fUser.uid].sockets.push(socket.id);

    next();
  }).catch((error) => {
    console.error('Can\'t login user', socket.handshake.auth.uid, error.message);
  });
});

io.on('connect', (socket) => {
  const user = loggedUsers[socket.handshake.auth.uid];

  console.log('User connected', user);

  socket.on('disconnect', () => {
    console.log('User disconnected', socket.id);
    user.sockets = user.sockets.filter((s) => s !== socket.id);
  });
});
