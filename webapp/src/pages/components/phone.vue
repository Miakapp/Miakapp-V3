<template>
  <div class="smartphone">
    <div class="content" v-html="content" @click="onClick"/>
  </div>
</template>

<script>
export default {
  name: 'Phone',
  props: {
    content: String,
    onClick: Function,
  },
};
</script>

<style scoped>
.smartphone {
  position: relative;
  height: calc(100% + 20px);
  margin: -20px;
  border: 8px var(--color3) solid;
  border-top-width: 30px;
  border-bottom-width: 40px;
  border-radius: 10px;
  transform: scale(0.8);
}

.smartphone:before {
  content: '';
  display: block;
  width: 60px;
  height: 5px;
  position: absolute;
  top: -15px;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color4);
  border-radius: 10px;
}

.smartphone:after {
  content: '';
  display: block;
  width: 60px;
  height: 20px;
  position: absolute;
  left: 50%;
  bottom: -40px;
  transform: translate(-50%, -50%);
  background: var(--color4);
  border-radius: 10px;
}

.smartphone .content {
  height: calc(100% - 2px);
  overflow: auto;
  margin: 2px 0;
}
</style>
