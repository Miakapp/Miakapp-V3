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

      <router-view :relations="relations"/>
    </div>

    <div class="controls">
      <div class="statusBar">
        <div>{{ title }}</div>
        <menuBtn @click="menuOpen = !menuOpen" :active="menuOpen"/>
      </div>

      <div class="sideMenu" :class="{ open: menuOpen }" @click="menuOpen = true">
        <div class="menuItems">
          <div class="rowButton"
            :class="{ active: $route.params.home === relation.home.id }"
            v-for="relation in relations"
            :key="relation.home.id"
            @click="$router.push(`/h/${relation.home.id}`)"
          >
            <!-- eslint-disable-next-line -->
            <svg viewBox="0 0 200 200"><path :fill="relation.home.color" d="M100 0c55,0 100,45 100,100 0,55 -45,100 -100,100 -55,0 -100,-45 -100,-100 0,-55 45,-100 100,-100zm0 37c-35,0 -63,28 -63,63 0,35 28,63 63,63 35,0 63,-28 63,-63 0,-35 -28,-63 -63,-63z"/></svg>
            <div>{{relation.home.name}}</div>
          </div>

          <div class="rowButton" @click="fullscreen">
            <!-- eslint-disable-next-line -->
            <svg viewBox="0 0 200 200"><path d="M100 0c55,0 100,45 100,100 0,55 -45,100 -100,100 -55,0 -100,-45 -100,-100 0,-55 45,-100 100,-100zm0 37c-35,0 -63,28 -63,63 0,35 28,63 63,63 35,0 63,-28 63,-63 0,-35 -28,-63 -63,-63z"/></svg>
            <div>Maison 2</div>
          </div>
        </div>

        <div class="rowButton" @click="fullscreen">
          <div>Account</div>
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

/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;

export default {
  name: 'Home',
  components: { login, loader, menuBtn },

  data: () => ({
    loading: true,
    fUser: null,
    relations: JSON.parse(localStorage.getItem('data')) || [],

    newDisplayName: '',

    menuOpen: false,
    selectedHome: null,
  }),

  created() {
    auth.onAuthStateChanged((fUser) => {
      if (fUser) {
        console.log('Signed', fUser);
        this.fUser = fUser;
        this.loadHomes();
      } else this.loading = false;
    });

    onSwipe((direction) => {
      if (direction === 'right') this.menuOpen = true;
      else if (direction === 'left') this.menuOpen = false;
    });
  },

  methods: {
    async loadHomes() {
      this.relations = (await Promise.all((
        await db.collection('relations').where('user', '==', this.fUser.uid).get()
      ).docs.map(async (r) => {
        const relation = { id: r.id, ...r.data() };

        const fHome = db.collection('homes').doc(relation.home);
        const fHomeData = await fHome.get();

        if (!fHomeData.exists) {
          r.ref.delete();
          return null;
        }

        const home = fHomeData.data();

        const pages = [];

        await Promise.all(await relation.groups.map(async (group) => {
          const fGroupData = await fHome.collection('groups').doc(group).get();
          if (!fGroupData.exists) return null;

          await Promise.all(await fGroupData.data().pages.map(async (page) => {
            const fPageData = await fHome.collection('pages').doc(page).get();
            if (!fPageData.exists) return null;
            pages.push({ id: fPageData.id, ...fPageData.data() });
            return true;
          }));

          return true;
        }));

        return {
          id: relation.id,
          home: {
            id: relation.home,
            name: home.name,
            color: home.color,
          },
          user: {
            admin: relation.isAdmin,
            owner: home.owner === this.fUser.uid,
          },
          pages,
        };
      }))).filter((h) => h);

      console.log(this.relations);
      localStorage.setItem('data', JSON.stringify(this.relations));

      this.loading = false;
    },

    setDisplayName(e) {
      e.preventDefault();

      auth.currentUser.updateProfile({
        displayName: this.newDisplayName,
      }).then(() => {
        window.auth = window.firebase.auth();
        this.fUser = window.firebase.auth().currentUser;
        this.$forceUpdate();
        toast.success({ title: 'Display name changed' });
      }).catch((error) => {
        toast.error({ title: error.message });
      });
    },

    sendConfirmEmail() {
      auth.currentUser.sendEmailVerification().then(() => {
        toast.success({ title: 'Confirmation email sent !' });
      }).catch((error) => {
        toast.error({ title: error.message });
      });
    },

    fullscreen() {
      document.querySelector('html').requestFullscreen();
    },
  },

  computed: {
    title() {
      const relation = this.relations.find((r) => r.home.id === this.$route.params.home);
      if (!relation) return 'Miakapp';

      const page = relation.pages.find((p) => p.id === this.$route.params.page);
      if (page) return page.name;

      return relation.home.name;
    },
  },
};
</script>
