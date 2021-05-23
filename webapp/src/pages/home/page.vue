<template>
  <div class="page">
    <adminPage v-if="$route.params.page === 'admin'" :relation="relation"/>
    <div v-if="page" v-html="page.content"/>
  </div>
</template>

<script>
import adminPage from './admin.vue';

export default {
  name: 'Page',

  components: { adminPage },

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

  async mounted() {
    if (this.$route.params.page !== 'admin' && !this.page) {
      this.$router.push(`/h/${this.$route.params.home}`);
    }
  },
};
</script>
