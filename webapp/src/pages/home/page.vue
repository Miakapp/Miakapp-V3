<template>
  <div class="home">
    <div v-if="$route.params.page === 'admin'">
      ADMIN
    </div>

    <div v-if="page" v-html="page.content"/>
  </div>
</template>

<script>

export default {
  name: 'Home',

  props: {
    relations: Object,
  },

  mounted() {
    if (this.$route.params.page !== 'admin' && !this.page) {
      this.$router.push(`/h/${this.$route.params.home}`);
    }
  },

  computed: {
    relation() {
      return this.relations.find((r) => r.home.id === this.$route.params.home);
    },

    page() {
      return this.relation.pages.find((p) => p.id === this.$route.params.page);
    },
  },
};
</script>
