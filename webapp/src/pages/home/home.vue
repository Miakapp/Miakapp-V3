<template>
  <div class="home">
    Home: {{ $route.params.home }}
    <div class="button" @click="connect">Enter</div>
  </div>
</template>

<script>

export default {
  name: 'Home',
  components: {},
};
</script>
