<template>
  <div class="home" v-if="logged">
    Homes
    <router-view/>
  </div>
  <login v-else/>
</template>

<script>
import login from '../login.vue';

export default {
  name: 'Home',
  components: { login },
  data: () => ({
    logged: false,
    loading: true,
  }),

  created() {
    window.auth.onAuthStateChanged((user) => {
      if (user) {
        console.log('Signed', user);
        this.logged = true;
        this.loading = false;
      } else {
        this.loading = false;
      }
    });
  },
};
</script>
