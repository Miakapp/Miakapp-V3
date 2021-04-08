<template>
  <div class="home" v-if="fUser && !loading">
    <div class="container withHead">
      <div class="fullpage" v-if="!fUser.emailVerified || !fUser.displayName">
        <div>
          <div class="title">OK</div>
          <form class="block" v-if="!fUser.displayName" @submit="setDisplayName">
          <input type="text" placeholder="No email" autocomplete="email"
            v-model="fUser.email" disabled>
          <input type="text" placeholder="No phone number" autocomplete="tel"
            v-model="fUser.phoneNumber" disabled>
          <input type="text" placeholder="Display name" autocomplete="name"
            v-model="newDisplayName" required>
          <input type="submit" value="Save">
        </form>
        </div>
      </div>

      <div v-if="!$route.params.home">
        <div class="block">
          Test
        </div>
      </div>

      <router-view/>
    </div>

    <div class="controls">
      <div class="statusBar">
        <div>Miakapp</div>
        <menuBtn @click="menuOpen = !menuOpen" :active="menuOpen"/>
      </div>

      <div class="sideMenu" :class="{ open: menuOpen }" @click="menuOpen = true">
        <div class="menuItems">
          <div class="rowButton" v-for="(home, id) in homes" :key="id" @click="selectHome(h)">
            <!-- eslint-disable-next-line -->
            <svg viewBox="0 0 200 200"><path d="M100 0c55,0 100,45 100,100 0,55 -45,100 -100,100 -55,0 -100,-45 -100,-100 0,-55 45,-100 100,-100zm0 37c-35,0 -63,28 -63,63 0,35 28,63 63,63 35,0 63,-28 63,-63 0,-35 -28,-63 -63,-63z"/></svg>
            <div>Maison 1</div>
          </div>
          <div class="rowButton" @click="fullscreen">
            <!-- eslint-disable-next-line -->
            <svg viewBox="0 0 200 200"><path d="M100 0c55,0 100,45 100,100 0,55 -45,100 -100,100 -55,0 -100,-45 -100,-100 0,-55 45,-100 100,-100zm0 37c-35,0 -63,28 -63,63 0,35 28,63 63,63 35,0 63,-28 63,-63 0,-35 -28,-63 -63,-63z"/></svg>
            <div>Maison 2</div>
          </div>
        </div>

        <div class="rowButton" @click="fullscreen">
          <div>Fullscreen</div>
        </div>
      </div>

      <div class="blur" :class="{ active: menuOpen }" @click="menuOpen = false"/>
    </div>
  </div>
  <login v-else-if="!loading"/>
  <loader v-else/>
</template>

<script>
import login from '../login.vue';
import loader from '../components/loader.vue';
import menuBtn from '../components/menuBtn.vue';
import onSwipe from '../lib/onSwipe';

export default {
  name: 'Home',
  components: { login, loader, menuBtn },
  data: () => ({
    loading: true,
    fUser: null,

    menuOpen: false,

    newDisplayName: '',
  }),

  created() {
    window.auth.onAuthStateChanged((fUser) => {
      if (fUser) {
        console.log('Signed', fUser);
        this.fUser = fUser;
        this.loading = false;
      } else this.loading = false;
    });

    onSwipe((direction) => {
      if (direction === 'right') this.menuOpen = true;
      else if (direction === 'left') this.menuOpen = false;
    });
  },

  methods: {
    setDisplayName(e) {
      e.preventDefault();

      window.auth.currentUser.updateProfile({
        displayName: this.newDisplayName,
      }).then(() => {
        window.auth = window.firebase.auth();
        this.fUser = window.firebase.auth().currentUser;
        this.$forceUpdate();
        window.toast.success({ title: 'Display name changed' });
      }).catch((error) => {
        window.toast.error({ title: error.message });
      });
    },

    sendConfirmEmail() {
      window.auth.currentUser.sendEmailVerification().then(() => {
        window.toast.success({ title: 'Confirmation email sent !' });
      }).catch((error) => {
        window.toast.error({ title: error.message });
      });
    },

    fullscreen() {
      document.querySelector('html').requestFullscreen();
    },
  },
};
</script>
