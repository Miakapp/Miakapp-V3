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
  const home = await getHome(credentials.home);
  if (!home.server) throw new Error('There is no selected server for this home');

  const client = new WebSocketClient();
  function newSocket() {
    client.connect(`wss://${home.server}/${home.id}/`, null, '//coordinator.miakapp');
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
          event: [
            'DISCONNECT',
            'CONNECT',
          ][parsed[0]],
          connectionID: userClient[0],
          user: userClient[1],
        });
        return;
      }

      if (msg.type === '\x33') { // USER ACTION
        console.log('User action', msg.data);
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

connect({
  home: 'maison1',
  id: 'coordinatorID',
  secret: 'coordinatorSecret',
});
