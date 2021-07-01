const https = require('https');
const WebSocketClient = require('websocket').client;
const miakode = require('./miakode');

function getHome(homeID) {
  return new Promise((cb, err) => {
    https.get(`https://firestore.googleapis.com/v1/projects
/miakapp-v2/databases/(default)/documents/homes/${homeID}`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('close', () => {
        data = JSON.parse(data);
        if (data.fields && data.fields.name) {
          cb({
            id: homeID,
            name: data.fields.name.stringValue,
            server: data.fields.server.stringValue,
          });
        } else err(new Error('Wrong homeID'));
      });
    });
  });
}

function sendPacket(socket, type, data) {
  socket.sendBytes(Buffer.from(`${type}${data}`));
  console.log(type, data.length);
}

function parsePacket(packet) {
  if (!packet.binaryData) return { type: 'unknown' };

  const parsed = packet.binaryData.toString();
  return {
    type: parsed[0],
    data: parsed.substring(1),
  };
}

const connect = async (credentials) => {
  const homeDoc = await getHome(credentials.home);
  if (!homeDoc.server) throw new Error('There is no selected server for this home');

  const client = new WebSocketClient();
  function newSocket() {
    console.log('Connecting to', homeDoc.server);
    client.connect(`wss://${homeDoc.server}/${homeDoc.id}/`, null, '//coordinator.miakapp');
  }

  function sendData(s) {
    console.log('Sending data');
    sendPacket(s, '\x41', miakode.object.encode({
      'group1.test1': 'val 1',
      'group1.test2': 'val 2',
      'group1.test.sub1': 'val 3',
      'group2.test': 'val 4',
      'unexistinggroup.group1': 'OOPS1',
      'unexistinggroup.group1.test': 'OOPS2',
      'global.glb1': 'global 1',
      'global.glb2': 'global 2',
      'global.timestamp': Date.now(),
    }));
  }

  client.on('connect', (s) => {
    console.log('Coordinator connected');

    s.on('message', (packet) => {
      const msg = parsePacket(packet);

      // PING: '\x30',
      // HOME: '\x31',
      // USER_CONNECT: '\x32',
      // USER_ACTION: '\x33',

      // PONG: '\x40',
      // DATA: '\x41',
      // NOTIF: '\x42',

      if (msg.type === '\x30') { // PING
        sendPacket(s, '\x40', msg.data);
        return;
      }

      if (msg.type === '\x31') { // USERLIST
        const users = msg.data.split('\x00').filter((u) => u).map((u) => {
          const [id, displayName, groups] = u.split('\x01');
          return {
            id: id.substring(1),
            displayName,
            isAdmin: (id[0] !== '0'),
            groups: groups.split('\x02'),
          };
        });
        console.log('Users', users);
        return;
      }

      if (msg.type === '\x32') { // USER CONNECT
        const parsed = miakode.string.decode(msg.data);
        const userClient = parsed.substring(1).split('@');
        console.log('User event', {
          event: ['DISCONNECT', 'CONNECT'][parsed[0]],
          connectionID: userClient[0],
          user: userClient[1],
        });
        return;
      }

      if (msg.type === '\x33') { // USER ACTION
        const [userID, type, id, name, value] = miakode.array.decode(msg.data);
        console.log('User action', {
          userID, type, id, name, value,
        });
        return;
      }

      if (msg.type === '\x00') { // LOGGED
        console.log('Logged');
        sendData(s);
        return;
      }

      console.log('Unknown packet', msg);
    });

    sendPacket(s, '\x04', miakode.array.encode([
      credentials.home,
      credentials.id,
      credentials.secret,
    ]));

    setInterval(() => sendData(s), 10000);

    s.on('close', (code, desc) => {
      console.log('CLOSE', code, desc);
      setTimeout(newSocket, 200);
    });
  });

  client.on('connectFailed', () => {
    console.log('Coordinator failed connect');
    setTimeout(newSocket, 200);
  });

  newSocket();
};

/**
 * User instance
 * @typedef {{
 *  id: string,
 *  displayName: string,
 *  isAdmin: boolean,
 *  groups: string[],
 * }} User
 */

/**
 * User login event data
 * @typedef {Object} UserLoginEvent
 * @property {User} user
 * @property {'CONNECT' | 'DISCONNECT'} type Event type
 * @property {number} connectionUID ID of connection
 */

/**
 * User action event data
 * @typedef {Object} UserActionEvent
 * @property {User} user
 * @property {'click' | 'input'} type Event type
 * @property {string} id ID of DOM element
 * @property {string} name Name of DOM element
 * @property {string} value Value of input element (if exists)
 */

/**
 * Instance of miakapp home
 * @typedef {Object} Home
 * @property {User} variables Dynamic variables to inject in your pages
 * @property {(modifs: {}) => null} commit Send data modifications to users
 * @property {(callback: (data: UserLoginEvent) => null) => null
 * } onUserLogin Event that handles when an user connects or disconnects
 * @property {(callback: (data: UserActionEvent) => null) => null
 * } onUserAction Event that handles when an user interact with a page
 */

/**
 * Creates a home instance
 * @param {string} home Home ID (in your URL)
 * @param {string} id Coordinator ID (default is "main")
 * @param {string} secret Coordinator secret token
 * @returns {Home} Returns an instance of home
 */
module.exports = function Miakapi(home, id, secret) {
  /** @type {((data: UserLoginEvent) => null)[]} */
  const userLoginCallbacks = [];
  /** @type {((data: UserActionEvent) => null)[]} */
  const userActionCallbacks = [];

  const { emitCallback, emitNotif } = connect({ home, id, secret }, {
    onUserLogin(data) {
      userLoginCallbacks.forEach((h) => h(data));
    },
    onUserAction(data) {
      userActionCallbacks.forEach((h) => h(data));
    },
  });

  const variables = {};

  return {
    variables,

    commit(modifs = {}) {
      Object.assign(variables, modifs);
      emitCallback(variables);
    },

    sendNotif(notification = {}) {
      emitNotif(notification);
    },

    onUserLogin(callback) {
      userLoginCallbacks.push(callback);
    },
    onUserAction(callback) {
      userActionCallbacks.push(callback);
    },
  };
};
