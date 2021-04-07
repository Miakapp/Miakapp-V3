import { register } from 'register-service-worker';
import 'firebase/messaging';

/* eslint-disable no-console */

export default function registerSW(firebase, callback = () => null) {
  register(`${process.env.BASE_URL}sw.js`, {
    ready() {
      console.log('App is being served from cache by a service worker.');
    },
    registered(registration) {
      window.fcm = firebase.messaging();
      window.fcm.useServiceWorker(registration);
      callback();
    },
    cached() {
      console.log('Content has been cached for offline use.');
    },
    updatefound() {
      console.log('New content is downloading.');
    },
    updated(rg) {
      console.log('New content is available; please refresh.');
      rg.waiting.postMessage({ type: 'update' });
    },
    offline() {
      console.log('No internet connection found. App is running in offline mode.');
    },
    error(error) {
      console.error('Error during service worker registration:', error);
    },
  });
}
