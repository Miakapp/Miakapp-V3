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
  --color7-s: #ffce48;
  --color8: #3ea842;
  --color8-s: #57a95a;

  --font: #ffffff;
  --lightFont: #dfdfdf;

  --success: #3ea842;
  --warning: #fc6f0f;
  --warning-s: #ed7e34;
  --error: #da3939;
  --error-s: #df5454;
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
}

body *:not(input),
body input[type=submit] { user-select: none }

::placeholder { color: #cacaca }

.container {
  width: fit-content;
  margin: 0 auto;
  padding: 20px;
}

.container.withHead { margin-top: 60px }
.container.full { width: auto }

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
  align-items: center;
  background-color: var(--color3);
  opacity: 0.6;
}

.tab.selected {
  background-color: var(--color3);
  opacity: 1;
  cursor: default;
}

.tab:not(.selected) { cursor: pointer }

.block {
  background-color: var(--color3);
  margin: 0 auto;
  padding: 20px;
  max-width: 1000px;
  overflow: auto;
}

.block.small { max-width: 500px }

form {
  display: grid;
}

.twoColumns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 5px;
}

.simpleInput {
  display: grid;
  margin-bottom: 5px;
}

.simpleInput > div:first-child,
.lightLabel {
  text-align: left;
  font-size: 16px;
  opacity: 0.7;
}

input, select, .button {
  background-color: var(--color4);
  border: none;
  width: 100%;
  max-width: 800px;
  margin: 5px 0;
  padding: 10px 15px;
  border-radius: 0;
  font-size: 16px;
  outline: none;
  display: grid;
  align-items: center;
}

select {
  margin-right: 5px;
  padding: 0 20px;
  height: 36px;
  width: 100%;
}

.wIcon {
  grid-template-columns: min-content auto;
  margin-bottom: 0;
}

input, select, .button:not(.wIcon):not(.plusButton) {
  height: 36px;
}

.bigGrid {
  display: grid;
  grid-template-columns: 50% 50%;
  max-width: 600px;
  margin: 0 auto 10px;
}

.bigGrid > .bigBtn:nth-child(2n-1):last-of-type {
  grid-column: 1 / 3;
}

.bigBtn {
  background-color: var(--color4);
  padding: 25px 20px;
  margin: 1px;
  height: 140px;
  max-width: 600px;
}

.bigBtn * { pointer-events: none }

.bigBtn:hover { background-color: var(--color4-s) }

.bigBtnIcon {
  font-size: 40px;
  margin-bottom: 10px;
}

.bigBtn:hover { padding: 15px 20px }
.bigBtn:hover > .bigBtnIcon { font-size: 50px }
.bigBtnText {
  font-size: 25px;
  overflow: hidden;
  white-space: nowrap;
}

.bigBtn > svg {
  fill: var(--color1);
  height: 50px;
  margin-bottom: 10px;
}

.bigBtn:hover > svg {
  margin-top: 10px;
  height: 55px;
}

input[type=submit], .button, .bigBtn { cursor: pointer }

.disabled, :disabled {
  opacity: 0.4;
  pointer-events: none;
}

.button:hover { background-color: var(--color4-s) }

input[type=time],
input[type=datetime-local],
input[type=date],
input[type=week],
input[type=month] {
  display: block;
  padding: 6px 15px;
}

input:hover, select:hover { border-radius: 0 }

:not(.gridForm) > input:focus,
:not(.gridForm) > select:focus { border-radius: 20px }

.button > svg {
  width: 30px;
  fill: var(--color1);
  margin-right: 15px;
  pointer-events: none;
}

input[type=submit], .green { background-color: var(--color8) }
input[type=submit]:hover, .green:hover { background-color: var(--color8-s) }

.orange { background-color: var(--warning) }
.orange:hover { background-color: var(--warning-s) }

.yellow { background-color: var(--color7); color: var(--color3); }
.yellow:hover { background-color: var(--color7-s); }

.red { background-color: var(--error) }
.red:hover { background-color: var(--error-s) }

.button.big {
  grid-template-columns: auto;
  max-width: 400px;
  margin: 20px auto 10px;
}

.plusButton {
  max-width: 400px;
  font-size: 30px;
  margin: 20px auto 0;
  padding-top: 5px;
}

.infoItem {
  display: grid;
  width: 100%;
  max-width: 400px;
  grid-template-columns: auto auto;
  margin: 0 auto;
  justify-content: space-between;
  align-items: center;
}

.infoItem > :first-child { opacity: 0.8 }

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
  height: 100vh;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  pointer-events: none;
}

.statusBar {
  display: grid;
  grid-template-columns: min-content auto;
  align-content: center;
  background-color: var(--color7);

  grid-column: 1 / 3;
  z-index: 1000;
  pointer-events: all;
  height: 55px;
}

.statusBar .path {
  display: flex;
}

.statusBar .path .step {
  color: var(--color2);
  font-size: 18px;
  align-self: center;
  cursor: pointer;
  transition-duration: 400ms;
}

.statusBar .path .step svg {
  width: 6px;
  height: 100%;
  margin: 0 10px;
}

.statusBar > svg {
  stroke: var(--color2);
  height: 55px;
  padding: 7px 15px;
}

.sideMenu {
  height: 100%;
  width: calc(100vw + 50px);
  display: grid;
  max-width: 400px;
  grid-template-rows: auto 60px;
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

.sideMenu .noItems {
  font-size: 20px;
  height: 100%;
  display: grid;
  align-items: center;
}

.rowButton {
  opacity: 0.8;
  cursor: pointer;
  margin-bottom: 2px;
}

.rowButton > div > svg {
  fill: var(--color1);
  height: 100%;
  width: 100%;
  padding: 7px;
}

.rowButton > div {
  display: grid;
  grid-template-columns: 30px auto 21px;
  text-align: left;
  line-height: 60px;
  padding-left: 10px;
  padding-right: 5px;
  font-size: 18px;
  background-color: var(--color4);
  opacity: 0.9;
}

.rowButton > div:hover { opacity: 1 }

.rowButton.active {
  opacity: 0.9;
  border-right: solid 2px var(--color8);
}

.rowItem {
  margin: 2px 2px 0 20px;
  height: 50px;
}

.rowHome .name {
  font-size: 20px;
  line-height: 60px;
  padding-left: 10px;
}

.rowSeparator {
  height: 2px;
  background-color: var(--color8) !important;
  margin: 2px 2px 0 20px;
}

.rowItem > div {
  display: grid;
  align-content: end;
  line-height: 50px;
}

.rowItem > .name { padding-left: 7px }
.iconRow { text-align: center }
.rowItem .iconRow { padding-bottom: 3px }

.bottomButton {
  grid-template-columns: 38px auto 23px !important;
  padding-right: 10px !important;
}

.blur {
  transition-duration: 500ms;
  pointer-events: none;
  z-index: -1;
}

.line {
  display: grid;
}

table {
  margin: 0 auto;
  width: 100%;
  min-width: 300px;
  max-width: 800px;
  border-spacing: 1px 2px;
}

tr {
  height: 50px;
  background-color: var(--color4);
  opacity: 0.9;
}

tr:hover { opacity: 1 }

td { padding: 0 10px }

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
  height: 0;
  pointer-events: none;
}

.separator { height: 25px }
.clickable { cursor: pointer }
.noDisplay:not(.display) { display: none }

@media screen and (max-width: 350px) {
  .statusBar .path *:not(.step:last-child) {
    font-size: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    opacity: 0;
    width: 0;
  }

  .statusBar .path .step:last-child {
    font-size: 20px;
  }
}

@media screen and (max-width: 500px) {
  .statusBar .path .step:first-child {
    font-size: 0 !important;
    padding: 0;
  }

  .container.withHead { margin-top: 55px }
  .container { padding: 10px }
  .block { padding: 15px }
  .separator { height: 15px }
}

@media screen and (max-width: 999px) {
  .sideMenu {
    transform: translateX(-100%);
  }

  .blur.active {
    /* backdrop-filter: blur(5px); */
    backdrop-filter: brightness(0.8);
    cursor: pointer;
    pointer-events: all;
  }
}

@media screen and (min-width: 1000px) {
  .statusBar > svg {
    opacity: 0;
    width: 0;
    padding: 10px;
    pointer-events: none;
  }

  .sideMenu {
    transform: translateX(-100px);
  }
}

</style>
