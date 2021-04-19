<template>
  <div class="home">
    Main page
    <br/>

    <br/>
    Test widget  :
    <div v-html="widget"/>

    <br/><br/><br/>
    <div class="logs" style="background: var(--color3)">
      <div class="log" v-for="log in logs" :key="log">{{log}}</div>
    </div>
  </div>
</template>

<script>

export default {
  name: 'Home',
  components: {},

  data: () => ({
    logs: ['LOGS:'],

    widget: `<div @click="GLOBAL_CLICK_1">
      <div class="button" @click="CLICK_1">Button1</div>
      <button class="button" @click="CLICK_2">Button2</button></div>
      <a class="button" @click="CLICK_3">Button3</a>
    </div>
    <div @click="GLOBAL_CLICK_2">
      <input id="input1" type="text" placeholder="Textbox text">
      <select id="input2">
        <option value="option1">Option 1</option><option value="option2">Option 2</option>
      </select>
    </div>`,
  }),

  mounted() {
    document.body.onclick = (e) => {
      let el = e.target;
      while (!el || !el.attributes
        || !el.attributes['@click']
        || !el.attributes['@click'].value
      ) {
        if (!el.parent) return;
        el = el.parent;
      }

      this.logs.push(`Function => ${el.attributes['@click'].value}`);
    };

    document.body.oninput = (e) => {
      if (!e || !e.target || !e.target.value) return;
      const action = {
        id: e.target.id,
        name: e.target.name,
        value: e.target.value,
      };

      this.logs.push(`${action.id || action.name} => ${action.value}`);
    };
  },
};
</script>
