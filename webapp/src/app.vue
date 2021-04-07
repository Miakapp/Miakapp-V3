<template>
  <router-view/>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Questrial&display=swap');

:root {
  --color1: #dddddd;
  --color2: #303030;

  --font: #e6e6e6;
}

body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  font-size: 17px;
  margin: 0;
  background-color: var(--color2);
}

body * {
  color: var(--font);
  font-family: Questrial, Arial, sans-serif;
  transition-duration: 0.1s;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  -webkit-appearance: none;
  text-shadow: 0 0 2px #00000020;
  user-select: none;
}

::placeholder { color: #d0d0d0 }

.container {
  min-height: 500px;
  padding: 20px;
}

</style>
