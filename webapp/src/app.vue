<template>
  <router-view/>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Questrial&display=swap');

:root {
  --color1: #dddddd;
  --color2: #0d0627;
  --color3: #231c4a;
  --color4: #543ea8;
  --color4-s: #6651ba;
  --color5: #fe4282;
  --color6: #fc6f0f;
  --color7: #ffbe0e;
  --color8: #3ea842;
  --color8-s: #57a95a;

  --font: #ffffff;
  --lightFont: #dfdfdf;

  --success: #3ea842;
  --warning: #fc6f0f;
  --error: #da3939;
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
  transition-duration: 100ms;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  -webkit-appearance: none;
  text-shadow: 0 0 2px #00000020;
  user-select: none;
}

::placeholder { color: #cacaca }

.container {
  width: fit-content;
  margin: 0 auto;
  padding: 20px;
}

.container.withHead { margin-top: 60px }

.title {
  font-size: 30px;
  margin-bottom: 40px;
}

.title svg {
  fill: var(--color2);
  width: 80px;
  background-color: var(--color8);
  border-radius: 50px;
  padding: 10px;
  margin-bottom: 15px;
}

.fullpage {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  overflow-y: auto;
  display: grid;
  align-items: center;
  z-index: 100;
  background-color: var(--color2);
}

.tabs {
  display: grid;
  grid-template-columns: 50% 50%;
  align-items: center;
}

.tab {
  padding: 10px 0;
  display: grid;
  cursor: pointer;
  align-items: center;
  background-color: var(--color3);
  opacity: 0.6;
}

.tab.selected {
  background-color: var(--color3);
  opacity: 1;
  cursor: default;
}

.block {
  background-color: var(--color3);
  margin: 0 auto;
  padding: 20px;
  width: fit-content;
}

.block.small { max-width: 500px }

form {
  display: grid;
}

input, select, .button {
  background-color: var(--color4);
  border: none;
  max-width: 800px;
  margin: 5px 0;
  padding: 10px 15px;
  border-radius: 0;
  font-size: 16px;
  outline: none;
  display: grid;
  grid-template-columns: min-content auto;
  align-items: center;
}

input[type=submit], .button { cursor: pointer }

:disabled {
  opacity: 0.7;
}

.button:hover { background-color: var(--color4-s) }

input[type=submit] { background-color: var(--color8) }
input[type=submit]:hover { background-color: var(--color8-s) }

input:hover, select:hover { border-radius: 0 }
input:focus, select:focus { border-radius: 20px }

.button > svg {
  width: 30px;
  fill: var(--color1);
  margin-right: 15px;
}

.minText {
  margin-top: 10px;
  font-size: 15px;
  text-decoration: underline;
  opacity: 0.7;
  cursor: pointer;
}

.msgBlock.error { background-color: var(--error) }
.msgBlock.warning { background-color: var(--warning) }
.msgBlock.success { background-color: var(--success) }

.msgBlock {
  margin: 5px 0;
  padding: 10px;
  color: var(--lightFont);
  display: flex;
  align-items: center;
  padding-right: 17px;
  transition-duration: 300ms;
  height: fit-content;
  cursor: pointer;
}

.msgBlock, .msgBlock * {
  transition-duration: 400ms;
  transition-timing-function: cubic-bezier(0.71, -0.02, 0.15, 1.6);
}

.msgBlock:not(.open), .msgBlock:not(.open) * {
  transition-duration: 1000ms;
  margin: 0;
  padding: 0;
  opacity: 0;
  font-size: 0;
  pointer-events: none;
}

.msgBlock:not(.open) svg {
  height: 0;
}

.msgBlock svg {
  height: 40px;
  fill: var(--lightFont);
  margin-right: 10px; /* Flex gap is not supported by many browsers */
}

.controls {
  display: grid;
  position: fixed;
  grid-template: min-content auto / 0 auto;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  pointer-events: none;
}

.statusBar {
  display: grid;
  grid-template-columns: auto min-content;
  align-content: center;
  background-color: var(--color7);

  grid-column-start: 1;
  grid-column-end: 3;
  z-index: 1000;
  pointer-events: all;
}

.statusBar div {
  color: var(--color2);
  font-size: 24px;
  display: grid;
  align-content: center;
}

.statusBar svg {
  stroke: var(--color2);
  width: 60px;
  padding: 7px 15px;
}

.sideMenu {
  height: 100%;
  width: calc(100vw + 50px);
  display: grid;
  max-width: 400px;
  grid-template-rows: auto 50px;
  background-color: var(--color3);
  padding-left: 100px;
  box-shadow: var(--color2) 3px 1px 6px;
  transition-duration: 500ms;
  transition-timing-function: cubic-bezier(0.7, -0.1, 0, 1.1);
  z-index: 200;
  overflow-y: auto;
  pointer-events: all;
}

.sideMenu.open {
  transform: translateX(-100px);
  border: none;
}

.rowButton {
  display: grid;
  margin-bottom: 2px;
  padding: 0 15px;
  grid-template-columns: min-content auto;
  align-content: center;
  background-color: var(--color4);
  opacity: 0.8;
  cursor: pointer;
}

.rowButton > svg {
  fill: var(--color1);
  height: 100%;
  width: 15px;
}

.rowButton > div {
  display: grid;
  align-content: center;
  text-align: left;
  margin-left: 15px;
  padding: 15px 0;
}

.rowButton.active { border-right: solid 4px var(--color7) }

.blur {
  transition-duration: 500ms;
  pointer-events: none;
  z-index: -1;
}

#captcha {
  display: flex;
  justify-content: center;
  margin: 5px 0;
}

input.hidden,
.anim.hidden,
.hidden .anim,
.hidden input,
.minText.hidden,
.block.hidden, .block.hidden * {
  transition-duration: 200ms;
  margin: 0;
  padding: 0;
  font-size: 0;
  pointer-events: none;
}

@media screen and (max-width: 999px) {
  .sideMenu {
    transform: translateX(-100%);
  }

  .blur.active {
    backdrop-filter: blur(5px);
    cursor: pointer;
    pointer-events: all;
  }
}

@media screen and (min-width: 1000px) {
  .statusBar svg {
    opacity: 0;
    pointer-events: none;
  }

  .sideMenu {
    transform: translateX(-100px);
  }
}

</style>
