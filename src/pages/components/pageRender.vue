<template>
  <div v-html="compiledHTML"/>
</template>

<script>
import { HTMLMinify, formatVar } from '../../lib/formatter';

export default {
  name: 'PageRender',

  props: {
    content: String,
    variables: Object,
  },

  computed: {
    compiledHTML() {
      let newHtml = HTMLMinify(this.content);

      if (!this.variables) return newHtml;

      Object.keys(this.variables).forEach((varnm) => {
        while (newHtml.includes(`{{${varnm}}}`)) {
          newHtml = newHtml.replace(`{{${varnm}}}`, formatVar(this.variables[varnm]));
        }
      });

      return newHtml;
    },
  },
};
</script>

<style>

</style>
