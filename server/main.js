const firebase = require('firebase-admin');

const credentials = process.env.credentials
  ? JSON.parse(process.env.credentials)
  : require('./firebaseCredentials.json');

global.firebase = firebase;
firebase.initializeApp({
  credential: firebase.credential.cert(credentials),
  databaseURL: 'https://miakapp-v2.firebaseio.com',
});

const miakode = require('./miakode');
const ws = require('./wsServer').server;
const db = firebase.firestore();

// const connected = [];

/** @enum @const */
const P_TYPES = {
  USER: {
    /** From server (1) */
    PING: '\x10',
    /** From server (1) */
    DATA: '\x11',

    /** From user (2) */
    PONG: '\x20',
    ACTION: '\x21',
  },

  COORD: {
    /** From server (3) */
    PING: '\x30',
    HOME: '\x31',
    USER_CONNECT: '\x32',
    USER_ACTION: '\x33',

    /** From coordinator (4) */
    PONG: '\x40',
    COMMIT: '\x41',
    NOTIF: '\x42',
  },
};

/**
 * @param {import('websocket').connection} socket
 * @param {string} type
 * @param {string} data
 */

function sendPacket(socket, type, data) {
  console.log(type);
  socket.sendBytes(Buffer.from(`${type}${data}`));
}

function parsePacket(packet) {
  if (!packet.binaryData) return { type: 'unknown' };

  const parsed = packet.binaryData.toString();
  return {
    type: parsed[0],
    data: parsed.substring(1),
  };
}

console.log('Ready !');
ws.on('connect', (socket) => {
  // const userUID = rq.resourceURL.path.split('/');

  let ping = 0;
  let pong = 0;
  let payload = '';

  socket.on('message', (packet) => {
    const msg = parsePacket(packet);
    switch (msg.type) {
      case P_TYPES.USER.PONG:
        if (msg.data === payload) pong = Date.now();
        console.log('Ping=', pong - ping, 'ms');
        break;

      default:
        console.log('Unknown packet', msg);
        break;
    }
    // if (msg.utf8Data === 'pong') pong = Date.now();
  });

  const pingInterval = setInterval(() => {
    if (ping - pong > 5000) {
      console.log('Timeout disconnect');
      socket.close(4000, 'PING_TIMEOUT');
    }

    payload = miakode.string.encode(Math.round(Math.random() * 10000).toString());
    ping = Date.now();
    sendPacket(socket, P_TYPES.USER.PING, payload);
  }, 3000);

  console.log('Connexion');
  socket.on('close', (data, desc) => {
    console.log('DISCONNECT', data, desc);
    clearInterval(pingInterval);
  });
});

// const homeGroups = db.collection('homes').doc('maison1').collection('groups');
// const homeUsers = db.collection('relations').where('home', '==', homeID);
// homeGroups.onSnapshot((snapshot) => {
//   home.groups = snapshot.docs;
//   // emit => P_TYPES.COORD.HOME
// });

// homeUsers.onSnapshot((snapshot) => {
//   home.users = snapshot.docs;
//   // emit => P_TYPES.COORD.HOME
// });

// const fcm = firebase.messaging();

// const loggedUsers = {};

// io.use(async (socket, next) => {
//   if (!socket.handshake.auth.token
//     || !socket.handshake.auth.uid) return;

//   auth.verifyIdToken(socket.handshake.auth.token).then((fUser) => {
//     if (!loggedUsers[fUser.uid]) {
//       loggedUsers[fUser.uid] = {
//         sockets: [],
//       };
//     }

//     loggedUsers[fUser.uid].sockets.push(socket.id);

//     next();
//   }).catch((error) => {
//     console.error('Can\'t login user', socket.handshake.auth.uid, error.message);
//   });
// });

// io.on('connect', (socket) => {
//   const user = loggedUsers[socket.handshake.auth.uid];

//   console.log('User connected', user);
//   socket.emit('logged', { message: 'logged' });

//   socket.on('disconnect', () => {
//     console.log('User disconnected', socket.id);
//     user.sockets = user.sockets.filter((s) => s !== socket.id);
//   });
// });
