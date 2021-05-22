require('./envLoader');

const firebase = require('firebase-admin');

const credentials = process.env.credentials
  ? JSON.parse(process.env.credentials)
  : require('./firebaseCredentials.json');

global.firebase = firebase;
firebase.initializeApp({
  credential: firebase.credential.cert(credentials),
  databaseURL: process.env.DB_URL || 'https://miakapp-v2.firebaseio.com',
});

const miakode = require('./miakode');
const ws = require('./wsServer').server;

const auth = firebase.auth();
const db = firebase.firestore();

function setState() {
  db.collection('SERVERS').doc(process.env.SERVER_URL).set({
    name: process.env.SERVER_NAME,
    last: Date.now(),
  });
}

if (process.env.SERVER_URL && process.env.SERVER_NAME) {
  console.log(`Server URL: ${process.env.SERVER_URL}`);
  setState();
  setInterval(setState, 1800000); // 1800000ms = 30min = 48/day
} else console.log('Server has no URL');

// const connected = [];

/** @enum @const */
const P_TYPES = {
  AUTH: {
    /** From server (0x) */
    OK: '\x00',
    /** From user (02) */
    USER: '\x02',
    /** From coordinator (04) */
    COORD: '\x04',
  },

  USER: {
    /** From server (1x) */
    PING: '\x10',
    DATA: '\x11',

    /** From user (2x) */
    PONG: '\x20',
    ACTION: '\x21',
  },

  COORD: {
    /** From server (3x) */
    PING: '\x30',
    USERLIST: '\x31',
    USER_CONNECT: '\x32',
    USER_ACTION: '\x33',

    /** From coordinator (4x) */
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

function sendPacket(socket, type, data = '') {
  socket.sendBytes(Buffer.from(`${type}${data}`));
  console.log(type);
}

function parsePacket(packet) {
  if (!packet.binaryData) return { type: 'unknown' };

  const parsed = packet.binaryData.toString();
  return {
    type: parsed[0],
    data: parsed.substring(1),
  };
}

const genPayload = () => miakode.string.encode(Math.round(Math.random() * 10000).toString());

function Home(homeID) {
  this.id = homeID;
  this.variables = {};
  this.listeners = {};

  /** @type {{ id: string, name: string, displayName: string }[]} */
  this.fGroups = [];

  /**
   * @typedef {{
   *  id: string,
   *  home: string,
   *  user: string,
   *  displayName: string,
   *  groups: string[],
   *  isAdmin: boolean
   * }} fRelation
   */

  /** @type {fRelation[]} */
  this.fRelations = [];

  /** @typedef {'onHomeUpdate' | 'onData' | 'onUserEvent' | 'onUserAction'} event */
  /** @callback eventCallback @param {{}} data */

  /**
   * @param {number} socketID
   * @param {event} eventName
   * @param {eventCallback} callback
  */
  this.subscribe = (socketID, eventName, callback) => {
    if (!this.listeners[socketID]) this.listeners[socketID] = {};
    this.listeners[socketID][eventName] = callback;
  };

  /** @param {number} socketID */
  this.removeListeners = (socketID) => {
    delete this.listeners[socketID];
  };

  /**
   * @param {event} event
   * @param {eventData} data
   */
  this.emit = (event, ...data) => {
    Object.values(this.listeners).filter((l) => l[event]).forEach((l) => l[event](...data));
  };

  const homeDoc = db.collection('homes').doc(homeID);
  const groupsDoc = homeDoc.collection('groups');
  const homeUsers = db.collection('relations').where('home', '==', homeID);

  const unsubscribeGroups = groupsDoc.onSnapshot((snapshot) => {
    this.fGroups = snapshot.docs.map((a) => ({ id: a.id, ...a.data() }));
    if (this.fRelations.length > 0) this.emit('onHomeUpdate');
    console.log('Groups changes');
  });

  const unsubscribeUsers = homeUsers.onSnapshot((snapshot) => {
    this.fRelations = snapshot.docs.map((a) => ({ id: a.id, ...a.data() }));
    if (this.fGroups.length > 0) this.emit('onHomeUpdate');
    console.log('Users changes');
  });

  this.destroy = () => {
    unsubscribeGroups();
    unsubscribeUsers();
  };
}

/** @type {Object<string, Home>} */
const HOMES = {};

let incrementer = 0;

console.log('Ready !');
ws.on('connect', (socket) => {
  incrementer += 1;

  const client = {
    /** @type {'USER' | 'COORD' | null} */
    type: null,
    /** @type {string | null} */
    homeID: null,
    /** @type {number} */
    socketID: incrementer,
  };

  let pongPayload = null;
  let pongTime = null;

  socket.on('message', async (packet) => {
    const msg = parsePacket(packet);
    if (!msg.data) return;
    // If not authenticated and packet is not an authentication packet
    if (!client.type && ![P_TYPES.AUTH.COORD, P_TYPES.AUTH.USER].includes(msg.type)) return;

    // USER AUTHENTICATION
    if (msg.type === P_TYPES.AUTH.USER && !client.type) {
      console.log('Auth user');
      const [homeID, userID, userToken] = miakode.array.decode(msg.data);
      if (!homeID || !userID || !userToken) {
        socket.close(4002, 'WRONG_REQUEST');
        return;
      }

      auth.verifyIdToken(userToken).then(async (fUser) => {
        if (fUser.uid !== userID) {
          socket.close(4001, 'WRONG_ACCOUNT_CHECK');
          return;
        }

        const relationDoc = await db.collection('relations').doc(`${homeID}@${userID}`).get();

        if (!relationDoc.exists) {
          socket.close(4001, 'WRONG_ACCOUNT_CHECK');
          return;
        }

        if (!HOMES[homeID]) {
          console.log(HOMES);
          socket.close(4003, 'NO_COORDINATOR');
          return;
        }

        const uGroups = relationDoc.get('groups');

        if (!uGroups || uGroups.length === 0) {
          socket.close(4004, 'NO_GROUP');
          return;
        }

        client.homeID = homeID;
        client.type = 'USER';

        function sendVariables() {
          const userVariables = {};
          const ugNames = uGroups.map((id) => HOMES[homeID].fGroups.find((g) => g.id === id).name);

          Object.keys(HOMES[homeID].variables).forEach((k) => {
            const namespace = k.split('.')[0];
            if (['global', ...ugNames].includes(namespace)) {
              userVariables[k] = HOMES[homeID].variables[k];
            }
          });
          console.log('HomeVariables', HOMES[homeID].variables);
          console.log('UserVariables', userVariables);
          sendPacket(socket, P_TYPES.USER.DATA, miakode.object.encode(userVariables));
        }

        HOMES[homeID].subscribe(client.socketID, 'onData', sendVariables);
        sendVariables();

        socket.on('close', () => {
          HOMES[client.homeID].emit('onUserEvent', userID, client.socketID, '0');
        });

        HOMES[client.homeID].emit('onUserEvent', userID, client.socketID, '1');
        console.log('=>', client);
      }).catch((e) => {
        console.log(e);
        socket.close(4001, 'WRONG_CREDENTIALS');
      });

      return;
    }

    // COORDINATOR AUTHENTICATION
    if (msg.type === P_TYPES.AUTH.COORD && !client.type) {
      console.log('Auth coord');
      const [homeID, coordID, coordSecret] = miakode.array.decode(msg.data);
      if (!homeID || !coordID || !coordSecret) {
        socket.close(4002, 'WRONG_REQUEST');
        return;
      }

      const homeDoc = db.collection('homes').doc(homeID);

      if ((await homeDoc.get()).exists) {
        const coordDoc = homeDoc.collection('coordinators').doc(coordID);
        const fCoord = await coordDoc.get();
        if (fCoord.exists && fCoord.data().secret === coordSecret) {
          coordDoc.update({ lastDate: Date.now() });

          client.homeID = homeID;
          client.type = 'COORD';

          console.log('=>', client);

          if (!HOMES[client.homeID]) HOMES[client.homeID] = new Home(client.homeID);

          HOMES[client.homeID].subscribe(client.socketID, 'onHomeUpdate', () => {
            const users = HOMES[client.homeID].fRelations.map((r) => {
              const gNs = r.groups.map((id) => HOMES[homeID].fGroups.find((g) => g.id === id).name);
              return `${r.isAdmin ? '1' : '0'}${r.user}\x01${r.displayName}\x01${gNs.join('\x02')}\x00`;
            });

            sendPacket(socket, P_TYPES.COORD.USERLIST, users);
          });

          HOMES[client.homeID].subscribe(client.socketID, 'onUserEvent', (userID, socketID, event) => {
            console.log('onUserEvent', userID, socketID, event);
            sendPacket(socket, P_TYPES.COORD.USER_CONNECT, miakode.string.encode(
              `${event}${socketID}@${userID}`,
            ));
          });

          HOMES[client.homeID].subscribe(client.socketID, 'onUserAction', (action) => {
            console.log('onUserAction', action);
            sendPacket(socket, P_TYPES.COORD.USER_ACTION, miakode.object.encode(action));
          });

          sendPacket(socket, P_TYPES.AUTH.OK);
          return;
        }
      }
      socket.close(4001, 'WRONG_CREDENTIALS');
      return;
    }

    if (msg.type === P_TYPES.COORD.COMMIT && client.type === 'COORD') {
      HOMES[client.homeID].variables = miakode.object.decode(msg.data);
      HOMES[client.homeID].emit('onData');

      console.log('COMMIT DATA', HOMES[client.homeID].variables);
      return;
    }

    if (msg.type === P_TYPES[client.type].PONG) {
      pongTime = Date.now();
      pongPayload = msg.data;
      return;
    }

    console.log('Unknown packet', msg);
  });

  let pingPayload = null;
  let pingTime = null;
  const pingInterval = setInterval(() => {
    console.log('ping');
    if (!client.type || pingPayload !== pongPayload) {
      socket.close(4000, 'TIMEOUT');
      return;
    }

    if (pongTime) console.log('Ping', pongTime - pingTime, 'ms');

    pingPayload = genPayload();
    pingTime = Date.now();
    sendPacket(socket, P_TYPES[client.type].PING, pingPayload);
  }, 5000);

  socket.on('close', (code, desc) => {
    console.log('DISCONNECT', code, desc);
    clearInterval(pingInterval);

    if (client.homeID && HOMES[client.homeID]) {
      console.log('Remove listeners', client.socketID, HOMES[client.homeID].listeners[client.socketID]);
      HOMES[client.homeID].removeListeners(client.socketID);
      console.log(HOMES[client.homeID].listeners);
    }
  });
});
