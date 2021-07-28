<template>
  <div class="block" v-if="joinable">
    <template v-if="home && home.name">
      <div class="title">You have been invited to join <u>{{ home.name }}</u></div>
      <div class="homeIcon">{{ home.icon }}</div>
      <div>Click button to join this home</div>
      <div class="joinButton" @click="join">Accept</div>
    </template>
    <template v-else>
      <div class="title">This home doesn't exist</div>
      <div>Invitation link is invalid</div>
      <div class="joinButton" @click="$router.push('/h')">Back</div>
    </template>
  </div>
</template>

<script>
/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;

export default {
  name: 'JoinHome',

  props: { relation: Object, page: Object },

  data: () => ({
    joinable: false,
    home: {},
  }),

  async mounted() {
    const continueMount = async () => {
      db.collection('relations')
        .doc(`${this.$route.params.home}@${auth.currentUser.uid}`)
        .get()
        .then(() => {
          this.$router.push(`/h/${this.$route.params.home}`);
        })
        .catch(() => {
          this.joinable = true;
        });

      this.home = (await db.collection('homes')
        .doc(this.$route.params.home)
        .get()).data();
    };

    if (!auth.currentUser) {
      auth.onAuthStateChanged((user) => {
        if (user) continueMount();
      });
    } else continueMount();
  },

  methods: {
    async join() {
      db.collection('relations')
        .doc(`${this.$route.params.home}@${auth.currentUser.uid}`)
        .set({
          home: this.$route.params.home,
          user: auth.currentUser.uid,
          invitation: this.$route.params.invitID,
          displayName: auth.currentUser.displayName
            || auth.currentUser.email.split('@')[0]
            || 'Unnamed user',
        })
        .then(() => {
          auth.updateCurrentUser(auth.currentUser);
          this.$router.push(`/h/${this.$route.params.home}`);
        })
        .catch(() => {
          toast.error({ title: 'Wrong or expired invitation link' });
          console.log(`${this.$route.params.home}@${auth.currentUser.uid}`, {
            home: this.$route.params.home,
            user: auth.currentUser.uid,
            invitation: this.$route.params.invitID,
            displayName: auth.currentUser.displayName
              || auth.currentUser.email.split('@')[0]
              || 'Unnamed user',
          });
          this.$router.push('/h');
        });
    },
  },
};
</script>

<style scoped>
.homeIcon {
  font-size: 50px;
  margin-bottom: 40px;
}

.joinButton {
  margin: 30px auto 20px;
  width: 100%;
  max-width: 400px;
  background-color: var(--color8);
  padding: 20px 0;
  font-size: 19px;
  cursor: pointer;
}

.joinButton:hover { background-color: var(--color8-s) }
</style>
