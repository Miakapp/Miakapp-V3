<template>
  <div class="admin">
    <div class="block">
      <div class="title">Users</div>
      <div>
        Manage users
      </div>

      <div class="separator"/>

      <div class="users">
        <div class="droppable" v-for="user in admin.users" :key="user.id"
          :class="{ open: user.open }"
        >
          <div class="head withIcon" @click="user.open = !user.open">
            <div class="name">{{ user.displayName || 'Unnamed user' }}</div>
            <svg viewBox="0 0 100 100"
              :style="{
                fill: user.isOwner ? 'var(--color5)' : 'var(--color7)',
                opacity: (user.isAdmin || user.isOwner) ? 1 : 0,
              }"
            >
              <!-- eslint-disable-next-line -->
              <path d="M50,21c-16,0-29,13-29,29s13,29,29,29s29-13,29-29S66,21,50,21z M50,75c-13.8,0-25-11.2-25-25s11.2-25,25-25s25,11.2,25,25 S63.8,75,50,75z M62,46.2l-6,5.9l1.4,8.3L50,56.4l-7.4,3.9l1.4-8.3l-6-5.9l8.3-1.2l3.7-7.5l3.7,7.5L62,46.2z"/>
            </svg>
          </div>

          <div class="body">
            <div class="simpleInput">
              <div>Display name</div>
              <input type="text" placeholder="Display name"
                v-model="user.displayName">
            </div>

            <div class="simpleInput">
              <div>Groups (max: 3)</div>
              <select v-model="user.groups[0]">
                <option value="" :disabled="!!user.groups[1]">None</option>
                <option v-for="group in admin.groups" :key="group.id"
                  :value="group.id" :disabled="user.groups.includes(group.id)">
                  {{ group.displayName }}
                </option>
              </select>

              <select v-model="user.groups[1]" v-if="user.groups[0]">
                <option value="" :disabled="!!user.groups[2]">None</option>
                <option v-for="group in admin.groups" :key="group.id"
                  :value="group.id" :disabled="user.groups.includes(group.id)">
                  {{ group.displayName }}
                </option>
              </select>

              <select v-model="user.groups[2]" v-if="user.groups[1]">
                <option value="">None</option>
                <option v-for="group in admin.groups" :key="group.id"
                  :value="group.id" :disabled="user.groups.includes(group.id)">
                  {{ group.displayName }}
                </option>
              </select>
            </div>

            <div class="twoColumns">
              <div class="simpleInput">
                <div>User type</div>
                <select v-model="user.isAdmin" :disabled="user.isOwner">
                  <option :value="true">{{ user.isOwner ? 'Owner' : 'Admin' }}</option>
                  <option :value="false">User</option>
                </select>
              </div>

              <div class="simpleInput">
                <div>Notifications</div>
                <select v-model="user.notifications">
                  <option :value="true">Enabled</option>
                  <option :value="false">Disabled</option>
                </select>
              </div>
            </div>

            <div class="twoColumns">
              <div class="button red"
                :class="{ disabled: user.isOwner }"
                @click="removeUser(user.id)"
              >Remove</div>
              <div class="button green" @click="updateUser(user.id)">Save</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="separator"/>

    <div class="block">
      <div class="title">Groups</div>
      <div>
        Manage groups
      </div>

      <div class="separator"/>

      <div class="groups">
        <div class="droppable" v-for="group in admin.groups" :key="group.id"
          :class="{ open: group.open }"
        >
          <div class="head withLabel" @click="group.open = !group.open">
            <div>{{ group.displayName }}</div>
            <div class="lightLabel">{{ group.name }}</div>
          </div>

          <div class="body">
            <div class="simpleInput">
              <div>Display name</div>
              <input type="text" placeholder="Display name"
                v-model="group.displayName">
            </div>

            <div class="simpleInput">
              <div>Short name</div>
              <input type="text" placeholder="Short name"
                v-model="group.name">
            </div>

            <div class="lightLabel">Pages</div>
            <div class="pageList">
              <div class="pageLine" v-for="(page, i) in group.pages" :key="page">
                <div class="btn clickable"
                  :class="{ disabled: i === 0 }"
                  @click="movePageInGroup(group.id, i, true)">▲</div>
                <div class="btn clickable"
                  :class="{ disabled: i === group.pages.length - 1 }"
                  @click="movePageInGroup(group.id, i, false)">▼</div>
                <div>{{ getPageName(page) }}</div>
                <div class="clickable delBtn" @click="remPageFromGroup(group.id, page)">╳</div>
              </div>
            </div>

            <div class="doubleInput">
              <select v-model="group.selectedPage">
                <option value="" disabled>Select page...</option>
                <option v-for="page in admin.pages"
                  :key="page.id"
                  :value="page.id"
                  :disabled="!page.id || group.pages.includes(page.id)"
                >
                  {{ page.icon }} {{ page.name }}
                </option>
              </select>
              <div class="button green"
                :class="{ disabled: !group.selectedPage }"
                @click="addPageInGroup(group.id)">Add</div>
            </div>

            <div>
              <div style="height:10px"/>
            </div>

            <div class="twoColumns">
              <div class="button red"
                @click="delGroup(group.id)"
              >Delete</div>
              <div class="button green" @click="updateGroup(group.id)">Save</div>
            </div>
          </div>
        </div>

        <div class="newButton" @click="newGroup">+</div>
      </div>
    </div>

    <div class="separator"/>

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
</template>

<script>
/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;

export default {
  name: 'Admin',

  props: {
    relation: Object,
  },

  computed: {
  },

  data: () => ({
    admin: {
      users: [],
      // invitations: [],
      groups: [],
      pages: [],
      // coordinators: [],
      servers: [],
    },
  }),

  methods: {
    updateUser(userID) {
      const userData = this.admin.users.find((u) => u.id === userID);
      if (!userData) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      if (!userData.displayName) {
        toast.error({ title: 'Please set a display name' });
        return;
      }

      db.collection('relations')
        .doc(`${this.relation.home.id}@${userID}`)
        .update({
          displayName: userData.displayName,
          groups: userData.groups.filter((g) => g),
          isAdmin: userData.isAdmin,
          notifications: userData.notifications,
        }).then(() => {
          toast.success({ title: 'User updated !' });
          this.loadUsers();
        })
        .catch(() => {
          toast.error({ title: 'Can\'t edit this user' });
        });

      console.log('Update relation', `${this.relation.home.id}@${userID}`, userData);
    },

    removeUser(userID) {
      const userData = this.admin.users.find((u) => u.id === userID);
      if (!userData) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      db.collection('relations')
        .doc(`${this.relation.home.id}@${userID}`)
        .delete()
        .then(() => {
          toast.success({ title: 'User removed from home !' });
          this.loadUsers();
        })
        .catch(() => {
          toast.error({ title: 'Can\'t remove this user' });
        });
    },

    newGroup() {
      db.collection('homes')
        .doc(this.relation.home.id)
        .collection('groups')
        .add({
          displayName: 'New group',
          name: 'newGroup',
          pages: [],
        });
      this.loadGroups();
    },

    updateGroup(groupID) {
      const groupData = this.admin.groups.find((g) => g.id === groupID);
      if (!groupData) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      if (!groupData.displayName) {
        toast.error({ title: 'Please set a display name' });
        return;
      }

      if (!groupData.name) {
        toast.error({ title: 'Please set a name' });
        return;
      }

      db.collection('homes')
        .doc(this.relation.home.id)
        .collection('groups')
        .doc(groupID)
        .update({
          name: groupData.name,
          displayName: groupData.displayName,
          pages: groupData.pages,
        })
        .then(() => {
          toast.success({ title: 'Group updated !' });
          this.loadGroups();
        })
        .catch(() => {
          toast.error({ title: 'Can\'t edit this group' });
        });
    },

    delGroup(groupID) {
      const groupData = this.admin.groups.find((g) => g.id === groupID);
      if (!groupData) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      toast.confirm('Are you sure you want to delete this group ?', () => {
        db.collection('homes')
          .doc(this.relation.home.id)
          .collection('groups')
          .doc(groupID)
          .delete()
          .then(() => {
            toast.success({ title: 'Group deleted from home !' });
            this.loadGroups();
          })
          .catch((e) => {
            console.log(e);
            toast.error({ title: 'Can\'t delete this group' });
          });
      });
    },

    addPageInGroup(groupID) {
      const group = this.admin.groups.find((g) => g.id === groupID);

      if (!group.selectedPage) return;
      if (!group) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      console.log(group);

      group.pages.push(group.selectedPage);
      group.selectedPage = '';
    },

    movePageInGroup(groupID, pos, up) {
      const group = this.admin.groups.find((g) => g.id === groupID);
      if (!group) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      const newPos = (up ? pos - 1 : pos + 1);
      group.pages[pos] = group.pages.splice(newPos, 1, group.pages[pos])[0];
    },

    remPageFromGroup(groupID, pageID) {
      const group = this.admin.groups.find((g) => g.id === groupID);
      if (!group) {
        toast.error({ title: 'Error, please try again' });
        return;
      }

      group.pages = group.pages.filter((p) => p !== pageID);
    },

    getPageName(pageID) {
      const page = this.admin.pages.find((p) => p.id === pageID);
      if (!page) return 'Deleted page';
      return `${page.icon} ${page.name}`;
    },

    selectServer(server) {
      db.collection('homes').doc(this.relation.home.id).update({ server }).then(() => {
        auth.updateCurrentUser(auth.currentUser);
        toast.success({ title: 'Server changed' });
      });
    },

    async loadGroups() {
      this.admin.groups = (
        await db
          .collection('homes')
          .doc(this.relation.home.id)
          .collection('groups')
          .get()
      ).docs.map((d) => ({
        id: d.id,
        displayName: d.get('displayName') || '',
        name: d.get('name') || '',
        pages: d.get('pages') || [],
        selectedPage: '',
      }));
    },

    async loadPages() {
      this.admin.pages = (
        await db
          .collection('homes')
          .doc(this.relation.home.id)
          .collection('pages')
          .get()
      ).docs.map((d) => ({
        id: d.id,
        name: d.get('name') || '',
        content: d.get('content') || '',
        icon: d.get('icon') || '❔',
      }));
    },

    async loadUsers() {
      this.admin.users = (
        await db.collection('relations').where('home', '==', this.$route.params.home).get()
      ).docs.map((d) => {
        const groups = d.get('groups') || [];
        return {
          id: d.get('user'),
          displayName: d.get('displayName') || '',
          groups: [
            groups[0] || '',
            groups[1] || '',
            groups[2] || '',
          ],
          notifications: d.get('notifications') || false,
          isAdmin: d.get('isAdmin') || false,
          isOwner: d.get('user') === this.relation.home.owner,
        };
      });
    },

    async loadServers() {
      this.admin.servers = (await db.collection('SERVERS').get()).docs.map((d) => ({
        host: d.id,
        name: d.get('name'),
        last: d.get('last'),
      }));

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
    },

    loadAll() {
      this.loadUsers();
      this.loadGroups();
      this.loadPages();
      this.loadServers();
    },
  },

  watch: {
    async $route(from, to) {
      if (this.$route.params.page === 'admin' && from.params.home !== to.params.home) this.loadAll();
    },
  },

  created() {
    this.loadAll();
  },
};
</script>

<style scoped>
.droppable {
  border: solid 1px var(--color4-s);
  border-radius: 10px;
  margin-bottom: 10px;
  max-width: 400px;
  margin: 0 auto 10px;
}

.droppable > .head {
  cursor: pointer;
  display: grid;
  align-items: center;
  text-align: left;
  justify-content: space-between;
  padding: 15px;
}

.droppable > .head.withIcon {
  grid-template-columns: auto 30px;
}

.droppable > .head.withLabel {
  grid-template-columns: auto auto;
}

.droppable.open > .body {
  padding: 0 15px 15px;
}

.droppable:not(.open) > .body * {
  transform: scale(0.7);
  opacity: 0;
  height: 0;
  margin: 0;
  pointer-events: none;
}

.twoColumns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 5px;
}

.pageLine {
  display: grid;
  margin: 5px 0;
  grid-template-columns: 40px 40px auto 40px;
  border: solid 1px var(--color4);
  align-items: center;
}

.delBtn {
  font-size: 12px;
}

.pageLine > * {
  padding: 10px;
}

.btn.disabled { opacity: 0.3 }
.btn:hover { background-color: var(--color4) }
.delBtn:hover { background-color: var(--error) }

.doubleInput {
  display: grid;
  grid-template-columns: 2fr 1fr;
  column-gap: 5px;
}

.newButton {
  font-size: 30px;
  height: 45px;
  line-height: 40px;
  background-color: var(--color8);
  max-width: 400px;
  margin: 20px auto 0;
  cursor: pointer;
}
</style>
