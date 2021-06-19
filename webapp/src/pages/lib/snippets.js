export default [
  {
    displayText: 'Page',
    text:
`<page id="pagename">
  Page content
</page>
<style>
  #pagename {}
</style>`,
  },
  {
    displayText: 'Container',
    text:
`<div class="container">
  <div class="title">
    <div>Title</div>
  </div>
  <div class="content">
    Content
  </div>
</div>`,
  },
  {
    displayText: 'Menu',
    text:
`<div class="menu">
  
</div>`,
  },
  {
    displayText: 'Menu with buttons',
    text:
`<div class="menu">
  <div class="big_button" action="click" id="button1">
    Simple Button
  </div>
  <div class="big_button disabled" action="click" id="button2">
    Disabled Button
  </div>
  <div class="big_button selected" action="click" id="button3">
    Green Button
  </div>
  <div class="big_button important" action="click" id="button4">
    Important Button
  </div>
</div>`,
  },
  {
    displayText: 'List',
    text:
`<div class="list">
  <div class="inline">
    <div>Item 1</div>
    <div>Value 1</div>
  </div>
  <div class="inline">
    <div>Item 2</div>
    <div>Value 2</div>
  </div>
</div>`,
  },
  {
    displayText: 'List item',
    text:
`<div class="inline">
  <div>Item</div>
  <div>Value</div>
</div>`,
  },
  {
    displayText: 'Grid',
    text:
`<div class="grid">
  <div>Item 1</div>
  <div>Item 2</div>
</div>`,
  },
  {
    displayText: 'Grid with buttons',
    text:
`<div class="grid">
  <div class="button" action="click" id="button1">Small button</div>
  <div class="button dark" action="click" id="button2">Small dark button</div>
  <div class="button red double" action="click" id="button3">Small red double button</div>
</div>`,
  },
  {
    displayText: 'Small button',
    text:
`<div class="button" action="click" id="button1">
  Small button
</div>`,
  },
  {
    displayText: 'Small red button',
    text:
`<div class="button red" action="click" id="button1">
  Small red button
</div>`,
  },
  {
    displayText: 'Small dark button',
    text:
`<div class="button dark" action="click" id="button1">
  Small dark button
</div>`,
  },
  {
    displayText: 'Small double button',
    text:
`<div class="button double" action="click" id="button1">
  Small double button
</div>`,
  },
  {
    displayText: 'Big button',
    text:
`<div class="big_button" action="click" id="button1">
  Big button
</div>`,
  },
  {
    displayText: 'Big green button',
    text:
`<div class="big_button selected" action="click" id="button1">
  Big green button
</div>`,
  },
  {
    displayText: 'Toggle',
    text:
`<label class="switch">
  <input type="checkbox" checked="[[checkbox1_checked]]" action="check" id="checkbox1">
  <span class="slider"></span>
</label>`,
  },
  {
    displayText: 'Separator',
    text: '<div class="separator"></div>',
  },
  {
    displayText: 'Page end',
    text: '<div class="pageEnd"></div>',
  },
  {
    displayText: 'Div',
    text: `<div>
  
</div>`,
  },
];
