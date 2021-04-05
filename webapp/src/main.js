import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import app from './app.vue';
import home from './views/home.vue';
import './registerServiceWorker';

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: home,
    },
  ],
});

createApp(app).use(router).mount('#app');
