<template>
  <div class="page" v-if="page">
    <pageRender v-if="!edit || !relation.user.admin"
      :content="page.content"
      :variables="relation.variables"
    />
    <editor v-else :relation="relation" :page="page"/>

    <!-- eslint-disable-next-line -->
    <svg v-if="relation.user.admin" class="editBtn" :class="{ active: edit }" viewBox="0 0 32 32" @click="edit = !edit"><path d="M10.09,11.71,6.06,16l4,4.29A1.5,1.5,0,0,1,9,22.82a1.47,1.47,0,0,1-1.09-.48L2.91,17a1.49,1.49,0,0,1,0-2.06l5-5.31a1.5,1.5,0,1,1,2.18,2.05Zm19,3.26-5-5.31a1.5,1.5,0,1,0-2.18,2.05l4,4.29-4,4.29A1.5,1.5,0,0,0,23,22.82a1.47,1.47,0,0,0,1.09-.48l5-5.31A1.49,1.49,0,0,0,29.09,15ZM18.71,8.65a1.5,1.5,0,0,0-1.93.88L12.4,21.43a1.49,1.49,0,0,0,.89,1.92,1.37,1.37,0,0,0,.52.1,1.52,1.52,0,0,0,1.41-1l4.38-11.9A1.49,1.49,0,0,0,18.71,8.65Z"/></svg>
  </div>
</template>

<script>
import editor from './editor.vue';
import pageRender from '../../components/pageRender.vue';

export default {
  name: 'Page',

  components: { pageRender, editor },
  props: {
    relation: Object,
    page: Object,
  },

  data: () => ({
    edit: (window.innerWidth >= 1200) && JSON.parse(localStorage.getItem('editorMode') || 'false'),
  }),

  watch: {
    edit() {
      localStorage.setItem('editorMode', this.edit);
    },
  },

  async mounted() {
    if (!this.page) this.$router.push(`/h/${this.$route.params.home}`);
  },
};
</script>

<style scoped>
.editBtn {
  position: fixed;
  top: 0;
  right: 15px;
  height: 55px;
  width: 30px;
  fill: var(--color3);
  z-index: 2000;
  cursor: pointer;
}

.editBtn.active { fill: var(--color5) }

@media screen and (max-width: 1200px) {
  .editBtn { display: none }
}
</style>
