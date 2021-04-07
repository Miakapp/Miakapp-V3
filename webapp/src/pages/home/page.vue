<template>
  <div class="home">
    Home: {{ $route.params.home }} / Page: {{ $route.params.page }}
  </div>
</template>

<script>

export default {
  name: 'Home',
  components: {},
};
</script>
