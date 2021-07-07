import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/analytics';
import 'firebase/firestore';
import izitoast from 'izitoast';
import 'izitoast/dist/css/iziToast.min.css';
import app from './app.vue';
import './lib/userEvent';

window.toast = izitoast;
window.toast.settings({
  position: 'bottomRight',
});

window.toast.confirm = (message, cb, config = {}) => {
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
    ...config,
  });
};

firebase.initializeApp({
  apiKey: 'AIzaSyBbn5Z7zWn-Qz-JPmNM_YF_rvYvBzvVyec',
  authDomain: 'miakapp-3.firebaseapp.com',
  projectId: 'miakapp-3',
  storageBucket: 'miakapp-3.appspot.com',
  messagingSenderId: '603250078961',
  appId: '1:603250078961:web:082db2556ca84f0576a550',
});

window.firebase = firebase;
window.auth = firebase.auth();
window.db = firebase.firestore();

window.auth.useDeviceLanguage();

// eslint-disable-next-line
if (window.location.protocol === 'https:') import('./registerServiceWorker');

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Main',
      component: () => import('./pages/main.vue'),
    },
    {
      path: '/h',
      name: 'Miakapp',
      component: () => import('./pages/home/homes.vue'),
      children: [{
        name: 'Home',
        path: ':home',
        component: () => import('./pages/home/home.vue'),
        children: [
          { name: 'Admin', path: 'admin', component: () => import('./pages/home/admin.vue') },
          { name: 'Page', path: ':page', component: () => import('./pages/home/page.vue') },
          { name: 'Join', path: 'join/:invitID', component: () => import('./pages/home/join.vue') },
        ],
      }],
    },
    {
      path: '/:path(.*)',
      redirect: '/h',
    },
  ],
});

createApp(app).use(router).mount('#app');
