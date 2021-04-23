<template>
  <div class="page">
    <div v-if="$route.params.page === 'admin'">
      <div class="block">
        <div class="title">Server</div>
        <div>
          Select the server you want to use
        </div>

        <div class="separator"/>

        <table v-if="admin.servers.length > 0">
          <tr>
            <th>Name</th>
            <th>Latency (ms)</th>
            <th>Select</th>
          </tr>
          <tr v-for="server in admin.servers" :key="server.host">
            <td>{{ server.name }}</td>
            <td v-if="server.online === true" :style="{ color: server.color }">
              {{ server.min }} - {{ server.max }}
            </td>
            <td v-else-if="server.online === false">Unreachable</td>
            <td v-else>Checking...</td>
            <td>
              <!-- eslint-disable-next-line -->
              <svg v-if="server.host === relation.home.server" height="20px" fill="var(--color1)" viewBox="0 0 128000 128000"><path d="M64000 32239c17541,0 31761,14220 31761,31761 0,17541 -14220,31761 -31761,31761 -17541,0 -31761,-14220 -31761,-31761 0,-17541 14220,-31761 31761,-31761zm0 -32239c17671,0 33673,7163 45254,18746 11583,11581 18746,27583 18746,45254 0,17671 -7163,33673 -18746,45254 -11580,11580 -27583,18746 -45254,18746 -17671,0 -33674,-7166 -45254,-18746 -11583,-11581 -18746,-27583 -18746,-45254 0,-17671 7163,-33673 18746,-45254 11581,-11583 27583,-18746 45254,-18746zm38190 25810c-9772,-9774 -23276,-15819 -38190,-15819 -14914,0 -28418,6045 -38190,15819 -9774,9772 -15819,23276 -15819,38190 0,14914 6045,28418 15819,38190 9772,9773 23276,15819 38190,15819 14914,0 28418,-6046 38190,-15819 9774,-9772 15819,-23276 15819,-38190 0,-14914 -6045,-28418 -15819,-38190z"/></svg>
              <!-- eslint-disable-next-line -->
              <svg v-else-if="server.online" class="clickable" @click="selectServer(server.host)" viewBox="0 0 23115 23115" height="20px" fill="var(--color1)"><path d="M11558 0c3191,0 6081,1294 8172,3385 2092,2092 3385,4982 3385,8173 0,3191 -1293,6081 -3385,8172 -2091,2091 -4981,3385 -8172,3385 -3191,0 -6081,-1294 -8173,-3385 -2091,-2091 -3385,-4981 -3385,-8172 0,-3191 1294,-6081 3385,-8173 2092,-2091 4982,-3385 8173,-3385zm6896 4661c-1764,-1765 -4203,-2857 -6896,-2857 -2694,0 -5132,1092 -6897,2857 -1765,1765 -2857,4203 -2857,6897 0,2693 1092,5132 2857,6896 1765,1765 4203,2857 6897,2857 2693,0 5132,-1092 6896,-2857 1765,-1764 2857,-4203 2857,-6896 0,-2694 -1092,-5132 -2857,-6897z"/></svg>
              <div v-else>X</div>
            </td>
          </tr>
        </table>

        <div class="separator"/>
      </div>
    </div>

    <div v-if="page" v-html="page.content"/>
  </div>
</template>

<script>
/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;
// const toastErr = (err) => toast.error({ title: err.message });

export default {
  name: 'Page',

  props: {
    relations: Object,
  },

  computed: {
    relation() {
      return this.relations.find((r) => r.home.id === this.$route.params.home);
    },

    page() {
      return this.relation.pages.find((p) => p.id === this.$route.params.page);
    },
  },

  data: () => ({
    admin: {
      servers: [],
    },
  }),

  methods: {
    selectServer(server) {
      console.log('Selectserver', server);
      db.collection('homes').doc(this.relation.home.id).update({ server }).then(() => {
        auth.updateCurrentUser(auth.currentUser);
        toast.success({ title: 'Server changed' });
      });
    },
  },

  async mounted() {
    if (this.$route.params.page !== 'admin' && !this.page) {
      this.$router.push(`/h/${this.$route.params.home}`);
    }

    if (this.$route.params.page === 'admin') {
      this.admin.servers = (await db.collection('SERVERS').get()).docs.map((d) => {
        const s = d.data();
        return { host: d.id, name: s.name, last: s.last };
      });

      this.admin.servers.forEach(async (s, k) => {
        try {
          let steps = [];
          for (let i = 0; i < 8; i += 1) {
            const start = Date.now();
            // eslint-disable-next-line
            await fetch(`https://${s.host}/ping`);
            steps.push(Date.now() - start);
          }
          steps = steps.sort((a, b) => a - b);
          const min = steps[0];
          const max = steps[4];
          let color = '#49e84f';

          if (steps[4] > 60) color = '#fff218';
          if (steps[4] > 100) color = '#ff8600';
          if (steps[4] > 150) color = '#ff1d1d';

          this.admin.servers[k] = {
            ...this.admin.servers[k],
            min,
            max,
            color,
            online: true,
          };
        } catch (e) {
          this.admin.servers[k].online = false;
        }
      });
    }
  },
};
</script>
