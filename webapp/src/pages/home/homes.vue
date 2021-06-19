<template>
  <div v-if="fUser && !loading">
    <div class="container full withHead">
      <template v-if="!$route.params.home">
        <div class="block">
          <div class="title">Homes</div>

          <table v-if="relations.length > 0">
            <tr v-for="relation in relations"
              class="clickable"
              :key="relation.home.id"
              @click="selectPage(relation.home.id)"
            >
              <td>{{ relation.home.icon }}</td>
              <td>{{ relation.home.name }}</td>
              <td>{{ relation.pages.length }} page{{ relation.pages.length > 1 ? 's' : '' }}</td>

              <td v-if="relation.user.owner">Owner</td>
              <td v-else-if="relation.user.admin">Admin</td>
              <td v-else>User</td>
            </tr>
          </table>

          <div style="margin: 0 auto; width: 100%;">
            <createHomeForm/>
          </div>
        </div>

        <div class="separator"/>

        <accountSettings :fUser="fUser"/>

        <div class="separator"/>

        <div class="block">
          <div class="title">Delete account</div>
          <div class="button bigRed" @click="deleteAccount">Delete account</div>
        </div>
      </template>

      <router-view :relations="relations"/>
    </div>

    <div class="controls">
      <div class="statusBar">
        <menuBtn :active="menuOpen" @click="menuOpen = !menuOpen"/>
        <div class="path">
          <div class="step" style="font-size: 24px; font-weight: 900;" @click="selectPage()">
            Miakapp
          </div>
          <div class="step"
            v-for="step in path"
            :key="step.id"
            @click="selectPage(...step.path)">
            <!-- eslint-disable-next-line -->
            <svg viewBox="0 0 60 100"><path d="M5.271,100c-1.349,0-2.697-0.515-3.727-1.544c-2.059-2.059-2.059-5.395,0-7.454L42.546,50L1.544,8.998  c-2.059-2.059-2.059-5.395,0-7.454s5.395-2.059,7.454,0l44.729,44.729c2.059,2.059,2.059,5.395,0,7.454L8.998,98.456 C7.969,99.485,6.62,100,5.271,100z"/></svg>
            {{ step.name }}
          </div>
        </div>
      </div>

      <div class="sideMenu" :class="{ open: menuOpen }">
        <div class="menuItems">
          <div class="noItems" v-if="relations.length === 0">No home</div>

          <div class="rowButton"
            :class="{ active: $route.params.home === relation.home.id }"
            v-for="relation in relations"
            :key="relation.home.id"
          >
            <div class="rowHome" @click="selectPage(relation.home.id)">
              <div v-if="relation.home.icon" class="iconRow">{{ relation.home.icon }}</div>
              <!-- eslint-disable-next-line -->
              <svg v-else width="18" viewBox="0 0 200 200"><path :fill="relation.home.color" d="M100 0c55,0 100,45 100,100 0,55 -45,100 -100,100 -55,0 -100,-45 -100,-100 0,-55 45,-100 100,-100zm0 37c-35,0 -63,28 -63,63 0,35 28,63 63,63 35,0 63,-28 63,-63 0,-35 -28,-63 -63,-63z"/></svg>
              <div class="name">{{ relation.home.name }}</div>
            </div>

            <div class="rowItem"
              v-for="page in relation.pages"
              :key="page.id"
              @click="selectPage(relation.home.id, page.id)"
            >
              <div v-if="page.icon" class="iconRow">{{ page.icon }}</div>
              <div class="name">{{ page.name }}</div>
              <!-- eslint-disable-next-line -->
              <svg v-if="$route.params.page === page.id" viewBox="0 0 60 100"><path d="M5.271,100c-1.349,0-2.697-0.515-3.727-1.544c-2.059-2.059-2.059-5.395,0-7.454L42.546,50L1.544,8.998  c-2.059-2.059-2.059-5.395,0-7.454s5.395-2.059,7.454,0l44.729,44.729c2.059,2.059,2.059,5.395,0,7.454L8.998,98.456 C7.969,99.485,6.62,100,5.271,100z"/></svg>
            </div>

            <div class="rowSeparator"/>

            <div class="rowItem" v-if="relation.user.admin"
              @click="selectPage(relation.home.id, 'admin')">
              <!-- eslint-disable-next-line -->
              <svg width="17" viewBox="0 0 100 100"><path d="M78.5,77.9c0,4.2-3.5,7.7-7.7,7.7H22.1c-4.2,0-7.7-3.5-7.7-7.7V29.2c0-4.2,3.5-7.7,7.7-7.7h23.6l12-11.9H22.1 c-10.8,0-19.6,8.8-19.6,19.6v48.7c0,10.8,8.8,19.6,19.6,19.6h48.7c10.8,0,19.6-8.8,19.6-19.6V42.3l-11.9,12V77.9z"/><path d="M29.9,66.1c-0.8,2.5,1.5,4.8,4,4l13-4.3c2.3-0.8,4.3-2,6.2-3.4L37.6,46.9c-1.4,1.9-2.7,3.9-3.4,6.2L29.9,66.1z"/><path d="M95.4,10.4l-5.8-5.8c-2.8-2.8-7.3-2.8-10.1,0L45.8,38.3l15.9,15.9l33.7-33.7C98.2,17.8,98.2,13.2,95.4,10.4z"/></svg>
              <div class="name">Manage</div>
              <!-- eslint-disable-next-line -->
              <svg v-if="$route.params.home === relation.home.id && $route.name === 'Admin'" viewBox="0 0 60 100"><path d="M5.271,100c-1.349,0-2.697-0.515-3.727-1.544c-2.059-2.059-2.059-5.395,0-7.454L42.546,50L1.544,8.998  c-2.059-2.059-2.059-5.395,0-7.454s5.395-2.059,7.454,0l44.729,44.729c2.059,2.059,2.059,5.395,0,7.454L8.998,98.456 C7.969,99.485,6.62,100,5.271,100z"/></svg>
            </div>

            <div class="rowItem" @click="selectPage(relation.home.id)">
              <!-- eslint-disable-next-line -->
              <svg width="17" viewBox="0 0 100 100"><path d="M98.69,28.92c-1.56-3.61-5.86-6.35-9.57-6.09s-8-1.19-9.9-3-3.44-6.09-3.3-9.82S73.19,2.1,69.52.64s-8.63-.35-11.07,2.44S51.92,7.92,49.32,8s-6.74-1.87-9.26-4.59S32.53-.28,28.92,1.28s-6.37,5.86-6.11,9.57-1.19,8-3,9.9-6.09,3.42-9.8,3.3S2.1,26.79.64,30.46,0.29,39.09,3.08,41.53,7.92,48.06,8,50.65s-1.86,6.74-4.59,9.26S-0.3,67.43,1.28,71.06s5.86,6.37,9.57,6.11,8,1.19,9.9,3,3.44,6.07,3.3,9.8,2.73,7.91,6.41,9.37,8.63,0.35,11.07-2.44,6.52-4.84,9.12-4.88,6.74,1.89,9.28,4.61,7.54,3.65,11.15,2.09,6.37-5.84,6.11-9.55,1.19-8,3-9.9S86.27,75.85,90,76s7.91-2.73,9.37-6.41,0.37-8.63-2.44-11.09S92.07,52,92,49.37s1.87-6.74,4.61-9.26A10.69,10.69,0,0,0,98.69,28.92Zm-41,38.94A19.46,19.46,0,1,1,67.84,42.3,19.46,19.46,0,0,1,57.72,67.86Z"/></svg>
              <div class="name">Settings</div>
              <!-- eslint-disable-next-line -->
              <svg v-if="$route.params.home === relation.home.id && $route.name === 'Home'" viewBox="0 0 60 100"><path d="M5.271,100c-1.349,0-2.697-0.515-3.727-1.544c-2.059-2.059-2.059-5.395,0-7.454L42.546,50L1.544,8.998  c-2.059-2.059-2.059-5.395,0-7.454s5.395-2.059,7.454,0l44.729,44.729c2.059,2.059,2.059,5.395,0,7.454L8.998,98.456 C7.969,99.485,6.62,100,5.271,100z"/></svg>
            </div>
          </div>
        </div>

        <div class="rowButton" @click="selectPage()">
          <div class="bottomButton">
            <!-- eslint-disable-next-line -->
            <svg width="25" viewBox="0 0 32 32"><path d="M16,3.71C9.21,3.71,3.71,9.21,3.71,16c0,6.79,5.5,12.29,12.29,12.29S28.29,22.79,28.29,16C28.29,9.21,22.79,3.71,16,3.71z M16,7.84c2.25,0,4.08,1.83,4.08,4.08S18.25,16,16,16s-4.08-1.83-4.08-4.08S13.75,7.84,16,7.84z M23.09,22.35 c-1.75,1.94-4.28,3.17-7.09,3.17s-5.34-1.22-7.09-3.17c-0.44-0.49-0.44-1.25,0-1.74c1.74-1.95,4.27-3.17,7.09-3.17 s5.35,1.22,7.09,3.17C23.53,21.1,23.53,21.86,23.09,22.35z"/></svg>
            <div class="name">Account</div>
            <!-- eslint-disable-next-line -->
            <svg v-if="!$route.params.home" viewBox="0 0 60 100"><path d="M5.271,100c-1.349,0-2.697-0.515-3.727-1.544c-2.059-2.059-2.059-5.395,0-7.454L42.546,50L1.544,8.998  c-2.059-2.059-2.059-5.395,0-7.454s5.395-2.059,7.454,0l44.729,44.729c2.059,2.059,2.059,5.395,0,7.454L8.998,98.456 C7.969,99.485,6.62,100,5.271,100z"/></svg>
          </div>
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

import accountSettings from '../settings/account.vue';
import createHomeForm from '../settings/createHomeForm.vue';

/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;
const toastErr = (err) => toast.error({ title: err.message });

export default {
  name: 'Home',
  components: {
    login,
    loader,
    menuBtn,

    accountSettings,
    createHomeForm,
  },

  data: () => ({
    loading: true,
    fUser: null,
    relations: JSON.parse(localStorage.getItem('data')) || [],

    menuOpen: false,
  }),

  created() {
    auth.onIdTokenChanged((fUser) => {
      if (fUser) {
        console.log('Signed', fUser);
        this.fUser = { ...fUser };
        this.loadHomes();
      } else this.loading = false;
    });

    onSwipe((direction) => {
      if (this.relations.length === 0) return;

      if (direction === 'right') this.menuOpen = true;
      else if (direction === 'left') this.menuOpen = false;
    });
  },

  methods: {
    selectPage(home = '', page = '') {
      if (!home) this.$router.push('/h');
      else if (!page) this.$router.push(`/h/${home}`);
      else this.$router.push(`/h/${home}/${page}`);

      localStorage.setItem('lastHome', home);
      this.menuOpen = false;
    },

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

        if (!relation.groups) relation.groups = [];

        await Promise.all(await relation.groups.map(async (group) => {
          const fGroupData = await fHome.collection('groups').doc(group).get();
          if (!fGroupData.exists) return null;

          await Promise.all(await fGroupData.data().pages.map(async (page) => {
            const fPageData = await fHome.collection('pages').doc(page).get();
            if (!fPageData.exists || pages.findIndex((p) => p.id === page) > -1) return null;
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
            icon: home.icon,
            server: home.server || '',
            owner: home.owner || '',
          },
          user: {
            owner: home.owner === this.fUser.uid,
            admin: relation.isAdmin || home.owner === this.fUser.uid,
          },
          pages,
        };
      }))).filter((h) => h);

      console.log(this.relations);
      localStorage.setItem('data', JSON.stringify(this.relations));

      const lastHome = localStorage.getItem('lastHome');
      if (lastHome && !this.$route.params.home) this.$router.push(`/h/${lastHome}`);

      this.loading = false;
    },

    deleteAccount() {
      toast.confirm('Are you sure you want to delete your account ? This action is irreversible.', () => {
        if (this.relations.length === 0) {
          auth.currentUser.delete().then(() => window.location.reload()).catch(toastErr);
        } else toast.warning({ title: 'Please leave all homes before deleting your account' });
      }, { icon: 'ico-warning' });
    },
  },

  computed: {
    path() {
      const relation = this.relations.find((r) => r.home.id === this.$route.params.home);
      if (!relation) return [{ name: 'Account', color: '#dddddd', path: [] }];

      const page = (this.$route.name === 'Admin'
        ? { id: 'admin', name: 'Admin' }
        : relation.pages.find((p) => p.id === this.$route.params.page)
      );

      return page ? [
        { ...relation.home, path: [relation.home.id] },
        { ...page, path: [relation.home.id, page.id] },
      ] : [
        { ...relation.home, path: [relation.home.id] },
      ];
    },
  },
};
</script>

<style scoped>
@media screen and (min-width: 1000px) {
  .container {
    padding-left: 320px;
  }
}
</style>
