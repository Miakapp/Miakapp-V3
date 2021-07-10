export default [
  {
    displayText: 'Page',
    text:
`<page id="pagename">
  <div class="block small">
    <div class="title">Big grid example</div>

    <div class="bigGrid">
      <div id="btn1" class="bigBtn" @click>
        <div class="bigBtnIcon">🔷</div>
        <div class="bigBtnText">Normal button</div>
      </div>
      <div id="btn2" class="bigBtn green" @click>
        <div class="bigBtnIcon">✔</div>
        <div class="bigBtnText">Green button</div>
      </div>
      <div id="btn3" class="bigBtn orange" @click>
        <div class="bigBtnIcon">🔶</div>
        <div class="bigBtnText">Orange button</div>
      </div>
      <div id="btn4" class="bigBtn red" @click>
        <div class="bigBtnIcon">❌</div>
        <div class="bigBtnText">Red button</div>
      </div>
      <div id="btn5" class="bigBtn disabled" @click>
        <div class="bigBtnIcon">🔒</div>
        <div class="bigBtnText">Disabled button</div>
      </div>
    </div>
  </div>

  <div class="separator"></div>

  <div class="block small">
    <div class="title">Form example</div>

    <div class="simpleInput">
      <div>Text example</div>
      <input id="textInput1" type="text" placeholder="Text" @watch>
    </div>

    <!-- Double columns -->
    <div class="twoColumns">
      <div class="simpleInput">
        <div>Select example</div>
        <select id="select1" @watch>
          <option value="value1">Choice 1</option>
          <option value="value2">Choice 2</option>
          <option value="value3">Choice 3</option>
          <option value="value4">Choice 4</option>
        </select>
      </div>

      <div class="simpleInput">
        <div>Number example</div>
        <input id="numberInput1" type="number" placeholder="Number" @watch>
      </div>
    </div>

    <div class="twoColumns">
      <div class="simpleInput">
        <div>Time example</div>
        <input id="timeInput1" type="time" @watch>
      </div>

      <div class="simpleInput">
        <div>Week example</div>
        <input id="weekInput1" type="week" @watch>
      </div>

      <div class="simpleInput">
        <div>Month example</div>
        <input id="monthInput1" type="month" @watch>
      </div>

      <div class="simpleInput">
        <div>Date example</div>
        <input id="dateInput1" type="date" @watch>
      </div>
    </div>

    <div class="simpleInput">
      <div>Datetime example</div>
      <input id="datetimeInput1" type="datetime-local" @watch>
    </div>

    <div class="twoColumns">
      <div id="redBtn" class="button red" @click>Red button</div>
      <div id="greenBtn" class="button green" @click>Green button</div>
    </div>
  </div>

  <div class="separator"></div>

  <div class="block small">
    <div class="title">Properties example</div>

    <div class="infoItem">
      <div>Example of property 1</div>
      <div>Value of property 1</div>
    </div>    
    <div class="infoItem">
      <div>Example of property 2</div>
      <div>Value of property 2</div>
    </div>    
    <div class="infoItem">
      <div>Example of property 3</div>
      <div>Value of property 3</div>
    </div>
    <div class="infoItem">
      <div>Example of property 4</div>
      <div>Value of property 4</div>
    </div>    
    <div class="infoItem">
      <div>Example of property 5</div>
      <div>Value of property 5</div>
    </div>

    <div class="separator"></div>

    <div class="twoColumns">
      <div id="normalBtn1" class="button" @click>Normal button</div>
      <div id="normalBtn2" class="button disabled" @click>Disabled button</div>
    </div>
  </div>

  <div class="separator"></div>

  <div class="block small">
    <div class="title">Table example</div>

    <table>
      <tr>
        <th>Column 1</th>
        <th>Column 2</th>
        <th>Column 3</th>
      </tr>
      <tr>
        <td>Line 1, Col 1</td>
        <td>Line 1, Col 2</td>
        <td>Line 1, Col 3</td>
      </tr>
      <tr class="clickable" id="line2" @click>
        <td>Line 2, Col 1</td>
        <td>Line 2, Col 2</td>
        <td>Line 2, Col 3</td>
      </tr>
    </table>

    <div id="addLineBtn" class="button green plusButton" @click>+</div>
  </div>
</page>

<style>
  #pagename {

  }
</style>
`,
  },
  {
    displayText: 'Small block',
    text:
`<div class="block small">
  <div class="title">Small block</div>

  <div>
    Content
  </div>
</div>`,
  },
  {
    displayText: 'Big grid',
    text:
`<div class="bigGrid">
  
</div>`,
  },
  {
    displayText: 'Big grid with buttons',
    text:
`<div class="bigGrid">
  <div id="btn1" class="bigBtn" @click>
    <div class="bigBtnIcon">🔷</div>
    <div class="bigBtnText">Normal button</div>
  </div>
  <div id="btn2" class="bigBtn green" @click>
    <div class="bigBtnIcon">✔</div>
    <div class="bigBtnText">Green button</div>
  </div>
  <div id="btn3" class="bigBtn orange" @click>
    <div class="bigBtnIcon">🔶</div>
    <div class="bigBtnText">Orange button</div>
  </div>
  <div id="btn4" class="bigBtn red" @click>
    <div class="bigBtnIcon">❌</div>
    <div class="bigBtnText">Red button</div>
  </div>
  <div id="btn5" class="bigBtn disabled" @click>
    <div class="bigBtnIcon">🔒</div>
    <div class="bigBtnText">Disabled button</div>
  </div>
</div>`,
  },
  {
    displayText: 'Input container',
    text:
`<div class="simpleInput">

</div>`,
  },
  {
    displayText: 'Input with label',
    text:
`<div class="simpleInput">
  <div>Text example</div>
  <input id="textInput1" type="text" placeholder="Text" @watch>
</div>`,
  },
  {
    displayText: 'Select with label',
    text:
`<div class="simpleInput">
  <div>Select example</div>
  <select id="select1" @watch>
    <option value="value1">Choice 1</option>
    <option value="value2">Choice 2</option>
    <option value="value3">Choice 3</option>
    <option value="value4">Choice 4</option>
  </select>
</div>`,
  },
  {
    displayText: 'Select',
    text:
`<select id="select1" @watch>
  <option value="value1">Choice 1</option>
  <option value="value2">Choice 2</option>
  <option value="value3">Choice 3</option>
  <option value="value4">Choice 4</option>
</select>`,
  },
  {
    displayText: 'Two columns',
    text:
`<div class="twoColumns">

</div>`,
  },
  {
    displayText: 'Buttons',
    text:
`<div id="redBtn" class="button red" @click>Red button</div>
<div id="greenBtn" class="button green" @click>Green button</div>
<div id="normalBtn1" class="button" @click>Normal button</div>
<div id="normalBtn2" class="button disabled" @click>Disabled button</div>`,
  },
  {
    displayText: 'Table',
    text:
`<table>
  <tr>
    <th>Column 1</th>
    <th>Column 2</th>
    <th>Column 3</th>
  </tr>
  <tr>
    <td>Line 1, Col 1</td>
    <td>Line 1, Col 2</td>
    <td>Line 1, Col 3</td>
  </tr>
  <tr class="clickable" id="line2" @click>
    <td>Line 2, Col 1</td>
    <td>Line 2, Col 2</td>
    <td>Line 2, Col 3</td>
  </tr>
</table>`,
  },
  {
    displayText: 'Separator',
    text: '<div class="separator"></div>',
  },
  {
    displayText: 'Div',
    text: `<div>
  
</div>`,
  },
  {
    displayText: '@click',
    text: '@click',
  },
  {
    displayText: '@watch',
    text: '@watch',
  },
];
