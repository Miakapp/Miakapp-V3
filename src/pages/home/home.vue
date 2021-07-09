<template>
  <div class="home" v-if="$route.name === 'Home'">
    <div class="bigGrid">
      <div class="bigBtn"
        v-for="page in relation.pages" :key="page.id"
        @click="$router.push(`/h/${relation.home.id}/${page.id}`)"
      >
        <div class="bigBtnIcon">{{ page.icon }}</div>
        <div class="bigBtnText">{{ page.name }}</div>
      </div>
    </div>

    <div class="bigGrid">
      <div class="bigBtn green"
        v-if="relation.user.admin"
        @click="$router.push(`/h/${$route.params.home}/admin`)"
      >
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 100 100"><path d="M78.5,77.9c0,4.2-3.5,7.7-7.7,7.7H22.1c-4.2,0-7.7-3.5-7.7-7.7V29.2c0-4.2,3.5-7.7,7.7-7.7h23.6l12-11.9H22.1 c-10.8,0-19.6,8.8-19.6,19.6v48.7c0,10.8,8.8,19.6,19.6,19.6h48.7c10.8,0,19.6-8.8,19.6-19.6V42.3l-11.9,12V77.9z"/><path d="M29.9,66.1c-0.8,2.5,1.5,4.8,4,4l13-4.3c2.3-0.8,4.3-2,6.2-3.4L37.6,46.9c-1.4,1.9-2.7,3.9-3.4,6.2L29.9,66.1z"/><path d="M95.4,10.4l-5.8-5.8c-2.8-2.8-7.3-2.8-10.1,0L45.8,38.3l15.9,15.9l33.7-33.7C98.2,17.8,98.2,13.2,95.4,10.4z"/></svg>
        <div class="bigBtnText">Manage home</div>
      </div>
    </div>

    <div class="block small">
      <div class="title">User options</div>

      <div class="content">
        <div class="simpleInput">
          <div>Display name</div>
          <input type="text" v-model="user.displayName" placeholder="Display name">
        </div>

        <div class="twoColumns">
          <div class="simpleInput">
            <div>User type</div>
            <select :value="relation.user.admin" disabled>
              <option :value="true">{{ relation.user.owner ? 'Owner' : 'Admin' }}</option>
              <option :value="false">User</option>
            </select>
          </div>

          <div class="simpleInput">
            <div>Notifications</div>
            <select :value="relation.user.notifications" v-model="user.notifications">
              <option :value="true">Enabled</option>
              <option :value="false">Disabled</option>
            </select>
          </div>
        </div>

        <div class="button green" @click="saveUser">Save</div>
      </div>
    </div>

    <div class="separator"/>

    <div class="block small">
      <div class="title">Leave home</div>

      <div class="content">
        <div class="button red" @click="leaveHome">Leave home</div>
      </div>
    </div>
  </div>

  <router-view v-else :relation="relation" :page="page"/>
</template>

<script>
import miakode from '../../lib/miakode';

/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;

export default {
  name: 'Home',

  props: {
    relations: Object,
  },

  computed: {
    relation() {
      const rel = this.relations.find((r) => r.home.id === this.$route.params.home);
      if (rel) {
        // eslint-disable-next-line
        this.user.displayName = rel.user.displayName;
        // eslint-disable-next-line
        this.user.notifications = rel.user.notifications;

        return { variables: this.variables, ...rel };
      }
      return {};
    },

    page() {
      return this.relation.pages && this.$route.name !== 'Join'
        ? this.relation.pages.find((p) => p.id === this.$route.params.page)
        : {};
    },
  },

  data: () => ({
    socket: null,
    variables: {},
    user: {
      displayName: 'Unnamed user',
      notifications: false,
    },
  }),

  mounted() {
    this.connect();
  },

  watch: {
    $route(to, from) {
      if (
        ['Page', 'Admin'].includes(to.name)
        && to.params.home !== from.params.home
      ) this.connect();
    },
  },

  methods: {
    connect() {
      if ((!this.relation || !this.relation.id) && this.$route.name !== 'Join') {
        this.$router.push('/h');
        return;
      }
      if (!this.relation.home || !this.relation.home.server) return;
      if (this.socket && this.socket.close) this.socket.close();

      this.socket = new WebSocket(`wss://${this.relation.home.server}/${this.relation.home.id}/`);

      this.socket.onopen = async () => {
        const authSocket = async () => {
          this.sendPacket('\x02', miakode.array.encode([
            this.$route.params.home,
            auth.currentUser.uid,
            await auth.currentUser.getIdToken(),
          ]));
        };

        if (!auth.currentUser) {
          auth.onAuthStateChanged((user) => {
            if (user) authSocket();
          });
        } else authSocket();

        window.onUserEvent.SOCKET = (data) => {
          if (!data.id) return;
          console.log('UserAction', data);
          this.sendPacket('\x21', (data.type === 'input' ? 1 : 0) + miakode.array.encode([
            data.id, data.name, data.value,
          ]));
        };
      };

      this.socket.onerror = () => {};

      this.socket.onclose = (ev) => {
        if (ev.wasClean) {
          if (ev.reason === 'NO_COORDINATOR') {
            toast.error({ title: 'Coordinator is not available' });
            return;
          }

          if (ev.reason === 'NO_GROUP') {
            toast.error({ title: 'You have no permission in this home' });
            return;
          }

          toast.error({ title: ev.reason });
        } else setTimeout(this.connect, 1000);

        console.log('CLOSED', ev, ev.code, ev.wasClean);
      };

      this.socket.onmessage = async (ev) => {
        const packet = await ev.data.text();
        const type = packet[0];
        const data = packet.substring(1);

        switch (type) {
          case '\x10': // PING
            console.log('Ping', data);
            this.sendPacket('\x20', data);
            break;

          case '\x11': // DATA
            this.variables = miakode.object.decode(data);
            delete this.variables[''];
            console.log('GlobalData', this.variables);
            break;

          default:
            console.log('Unknown packet', type, data);
            break;
        }
      };
    },

    sendPacket(...chunks) {
      if (this.socket) this.socket.send(new Blob(chunks));
      else this.connect();
    },

    saveUser() {
      db.collection('relations')
        .doc(`${this.$route.params.home}@${auth.currentUser.uid}`)
        .update({
          displayName: this.user.displayName,
          notifications: this.user.notifications,
        })
        .then(() => {
          toast.success({ title: 'User updated !' });
          auth.updateCurrentUser(auth.currentUser);
        })
        .catch(() => {
          toast.error({ title: 'Can\'t update user...' });
        });
    },

    leaveHome() {
      toast.confirm('Are you sure you want to leave this home ?', () => {
        db.collection('relations')
          .doc(`${this.$route.params.home}@${auth.currentUser.uid}`)
          .delete()
          .then(() => {
            this.$router.push('/h');
            toast.success({ title: 'You left this home !' });
            auth.updateCurrentUser(auth.currentUser);
          })
          .catch(() => {
            toast.error({ title: 'Can\'t leave this home...' });
          });
      });
    },
  },
};
</script>

<style scoped>
.block > .title {
  margin-bottom: 20px;
}

.content {
  max-width: 400px;
  margin: 0 auto;
}

@media screen and (min-width: 1200px) {
  .bigBtn { margin: 5px }
}
</style>
