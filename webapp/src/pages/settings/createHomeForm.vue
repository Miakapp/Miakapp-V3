<template>
  <form class="block" :class="{ hidden: !newHomeForm.active }" @submit="createHome">
    <input type="text" v-model="newHomeForm.id" placeholder="Home ID" required>
    <div class="iconNameSelect">
      <select v-model="newHomeForm.icon" required>
        <option v-for="e in homeEmojis" :key="e" :value="e">{{ e }}</option>
      </select>
      <input type="text" v-model="newHomeForm.name" placeholder="Display Name" required>
    </div>
    <input type="submit" value="Create home">
  </form>

  <div class="addButton" @click="newHomeForm.active = !newHomeForm.active">
    {{ !newHomeForm.active ? 'Create a home' : 'Abort' }}
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
  name: 'CreateHomeForm',

  props: { active: Boolean },

  data: () => ({
    homeEmojis: ['🏠', '🏡', '🏘️', '🏫', '🏢', '🏣',
      '🏥', '🏦', '🏪', '🏩', '🏨', '💒', '⛪', '🏬',
      '🌇', '🌆', '🏯', '🏰', '⛺', '🏭', '🏚️',
    ],

    newHomeForm: {
      active: false,
      id: '',
      icon: '🏠',
      name: '',
    },
  }),

  watch: {
    [['newHomeForm.id']]() {
      this.newHomeForm.id = this.newHomeForm.id.toLowerCase().replace(/[^0-9a-z]/g, '');
    },

    [['newHomeForm.name']](a, b) {
      if (this.newHomeForm.id === b.toLowerCase().replace(/[^0-9a-z]/g, '')) {
        this.newHomeForm.id = a.toLowerCase().replace(/[^0-9a-z]/g, '');
      }
    },
  },

  methods: {
    async createHome(e) {
      e.preventDefault();
      const homeDoc = db.collection('homes').doc(this.newHomeForm.id);

      try {
        if ((await homeDoc.get()).exists) {
          toast.error({ title: 'This Home ID is unavailable' });
          return;
        }
      } catch (err) { /* This name is available */ }

      homeDoc.set({
        icon: this.newHomeForm.icon,
        name: this.newHomeForm.name,
        owner: auth.currentUser.uid,
      }).then(() => {
        this.createRelation(homeDoc);
      }).catch(() => {
        toast.error({ title: 'This Home ID is unavailable' });
      });
    },

    createRelation(homeDoc) {
      const relationDoc = db.collection('relations').doc(`${this.newHomeForm.id}@${auth.currentUser.uid}`);

      relationDoc.set({
        home: this.newHomeForm.id,
        user: auth.currentUser.uid,
        displayName: auth.currentUser.displayName || 'Unknown',
        isAdmin: true,
      }).then(() => {
        this.newHomeForm.active = false;
        this.newHomeForm.id = '';
        this.newHomeForm.name = '';

        toast.success({ title: `Home ${this.newHomeForm.name} created !` });
        auth.updateCurrentUser(auth.currentUser);
      }).catch(() => {
        toast.error({ title: 'This Home ID is unavailable' });
        relationDoc.delete();
        homeDoc.delete();
      });
    },
  },
};
</script>

<style>
.addButton {
  margin: 15px auto 10px;
  max-width: 196px;
  height: 50px;
  background-color: var(--color8);
  display: grid;
  align-items: center;

  cursor: pointer;
  opacity: 0.9;
}

.iconNameSelect {
  display: grid;
  grid-template-columns: min-content auto;
}

select {
  margin-right: 5px;
  padding: 0 20px;
}

.addButton:hover { opacity: 1 }
</style>
