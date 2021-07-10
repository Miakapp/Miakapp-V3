<template>
  <div v-html="compiledHTML"/>
</template>

<script>
import { HTMLMinify, formatVar } from '../lib/formatter';

export default {
  name: 'PageRender',

  props: {
    content: String,
    variables: Object,
    groups: Array,
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

      const groupMatches = newHtml.match(/\[\[.*?\]\]/g);
      if (groupMatches && this.groups) {
        groupMatches.forEach((groupMatch) => {
          const groupName = groupMatch.replace(/\[\[|\]\]/g, '');
          const replacedBy = this.groups.includes(groupName) ? 'display' : 'noDisplay';

          while (newHtml.includes(groupMatch)) {
            newHtml = newHtml.replace(groupMatch, replacedBy);
          }
        });
      }

      return newHtml;
    },
  },
};
</script>

<style>

</style>
