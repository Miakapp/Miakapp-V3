const WebSocketServer = require('websocket').server;
const http = require('http');

/** @type {import('firebase-admin').auth.Auth} */
const auth = global.firebase.auth();

let fails = {};
let success = {};
setInterval(() => {
  // Reset lists every 5 minutes
  fails = {};
  success = {};
}, 300000);

const httpServer = http.createServer();

httpServer.listen(process.env.PORT || 3000);

exports.server = new WebSocketServer({
  httpServer,
});

exports.server.on('request', (rq) => {
  const ip = rq.remoteAddresses.join('@');
  console.log('Connect', ip);

  if (fails[ip] && fails[ip] >= 10) {
    console.log('Banned IP', ip);
    rq.reject(403);
    return;
  }

  const originHost = rq.origin.split('/')[2];
  if (![
    'dev.miakapp.com:8080',
    'miakapp.web.app',
    'beta.miakapp.com',
    'miakapp.com',
    'coordinator.miakapp',
  ].includes(originHost)) {
    console.log('Wrong origin', originHost);
    rq.reject(403);
    return;
  }

  const params = rq.resourceURL.path.split('/');

  if (params.length !== 3) {
    console.log('Wrong request');
    rq.reject(400);
    return;
  }

  if (success[params[1]] && Date.now() - success[params[1]] < 2000) {
    console.log('Anti spam', params[1]);
    if (fails[ip]) fails[ip] += 1; else fails[ip] = 1;
    rq.reject(403);
    return;
  }

  auth.verifyIdToken(params[2]).then((fUser) => {
    if (fUser.uid === params[1]) {
      success[params[1]] = Date.now();
      console.log('OK');
      rq.accept();
    } else {
      console.log('Wrong UID');
      if (fails[ip]) fails[ip] += 1; else fails[ip] = 1;
      rq.reject(401);
    }
  }).catch(() => {
    if (fails[ip]) fails[ip] += 1; else fails[ip] = 1;

    console.log('Wrong Token');
    rq.reject(401);
  });

});
