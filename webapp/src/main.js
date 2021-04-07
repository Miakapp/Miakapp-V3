import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import firebase from 'firebase/app';
import 'firebase/analytics';
import 'firebase/auth';
import izitoast from 'izitoast';
import 'izitoast/dist/css/iziToast.min.css';
import api from './api';
import app from './app.vue';

import registerSW from './registerServiceWorker';

window.toast = izitoast;
window.toast.settings({
  position: 'bottomRight',
});

window.toast.confirm = (message, cb) => {
  window.toast.show({
    theme: 'dark',
    title: 'Confirm ?',
    message,
    layout: 2,
    position: 'center',
    maxWidth: '70%',
    backgroundColor: '#344d61',
    progressBarColor: '#00db92',
    overlay: true,
    overlayClose: true,
    timeout: 8000,
    buttons: [
      ['<button>Confirm</button>', (inst, toast) => {
        cb();
        inst.hide({ transitionOut: 'fadeOutDown' }, toast);
      }],
      ['<button>Abort</button>', (inst, toast) => inst.hide({ transitionOut: 'fadeOutDown' }, toast)],
    ],
  });
};

firebase.initializeApp({
  apiKey: 'AIzaSyBn1cfqRZw9UyEbz9fUb4-pbsqSwu5SxAE',
  authDomain: 'miakapp-v2.firebaseapp.com',
  databaseURL: 'https://miakapp-v2.firebaseio.com',
  projectId: 'miakapp-v2',
  storageBucket: 'miakapp-v2.appspot.com',
  messagingSenderId: '639119430041',
  appId: '1:639119430041:web:09bb571a204d077ebd8308',
});

if (window.location.protocol === 'https:') {
  registerSW(firebase, () => {
    function getToken() {
      window.fcm.getToken().then(window.api.addPushToken).catch(() => {
        window.toast.warning({ title: 'Notifications disabled !' });
      });
    }

    getToken();
    window.fcm.onTokenRefresh(getToken);
  });
}

window.auth = firebase.auth();

// const provider = new firebase.auth.GoogleAuthProvider();
// window.auth
//   .signInWithPopup(provider)
//   .then((result) => {
//     // /** @type {firebase.auth.OAuthCredential} */
//     // const token = result.credential.accessToken;
//     // const user = result.user;
//     console.log(result);
//   }).catch((error) => {
//     console.error('Can\'t login', error);
//   });

window.api = api();

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Main',
      component: () => import('./pages/main.vue'),
    },
    {
      path: '/h/',
      name: 'Miakapp',
      component: () => import('./pages/home/homes.vue'),
      children: [
        { path: ':home', component: () => import('./pages/home/home.vue') },
        { path: ':home/:page', component: () => import('./pages/home/page.vue') },
      ],
    },
    {
      path: '/:path(.*)',
      redirect: '/',
    },
  ],
});

createApp(app).use(router).mount('#app');
