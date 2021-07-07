<template>
  <div class="ideContainer">
    <div id="editor"/>

    <div class="middleBar">
      <div class="saveContainer">
        <div class="vs_button full"
          :class="{ disabled: lastContents[page.id] === page.content }"
          @click="savePage"
        >Save page</div>
        <div class="vs_button" @click="importFile">Import file</div>
        <div class="vs_button" @click="exportFile">Export file</div>
      </div>

      <div class="pageDebugTool">
        <div class="miniTable">
          <div class="containerTitle">Variables</div>
          <div v-for="(d, i) in relation.variables" :key="i" :class="{ active: uses[i] }">
            <div class="round active" v-if="uses[i]">{{ uses[i] }}</div>
            <div class="round" v-else>0</div>
            <div>{{ i }}</div>
            <div class="description">{{ crop(d) }}</div>
          </div>
        </div>

        <div class="miniTable">
          <div class="containerTitle">
            <div>Events</div>
            <!-- eslint-disable-next-line -->
            <svg viewBox="0 0 100 100" @click="events = []"><path d="M37.0008645,38.0587981 L38.0008645,72.0587981 C38.0333378,73.1628902 38.954706,74.0316088 40.0587981,73.9991355 C41.1628902,73.9666622 42.0316088,73.045294 41.9991355,71.9412019 L40.9991355,37.9412019 C40.9666622,36.8371098 40.045294,35.9683912 38.9412019,36.0008645 C37.8371098,36.0333378 36.9683912,36.954706 37.0008645,38.0587981 Z"/><path d="M59.0008645,37.9412019 L58.0008645,71.9412019 C57.9683912,73.045294 58.8371098,73.9666622 59.9412019,73.9991355 C61.045294,74.0316088 61.9666622,73.1628902 61.9991355,72.0587981 L62.9991355,38.0587981 C63.0316088,36.954706 62.1628902,36.0333378 61.0587981,36.0008645 C59.954706,35.9683912 59.0333378,36.8371098 59.0008645,37.9412019 Z"/><path d="M25,29 L75,29 C76.3807119,29 77.5,27.8807119 77.5,26.5 C77.5,25.1192881 76.3807119,24 75,24 L25,24 C23.6192881,24 22.5,25.1192881 22.5,26.5 C22.5,27.8807119 23.6192881,29 25,29 Z"/><path d="M42.4038099,25.6868028 L43.4448153,22.0432839 C43.6677785,21.2629127 44.6793677,20.5 45.4914967,20.5 L54.5085033,20.5 C55.3211505,20.5 56.3320347,21.2622589 56.5551847,22.0432839 L57.5961901,25.6868028 L62.4038099,24.3131972 L61.3628045,20.6696783 C60.5262772,17.741833 57.5532275,15.5 54.5085033,15.5 L45.4914967,15.5 C42.4471337,15.5 39.4734928,17.742638 38.6371955,20.6696783 L37.5961901,24.3131972 L42.4038099,25.6868028 Z"/><path d="M48,38 L48,72 C48,73.1045695 48.8954305,74 50,74 C51.1045695,74 52,73.1045695 52,72 L52,38 C52,36.8954305 51.1045695,36 50,36 C48.8954305,36 48,36.8954305 48,38 Z"/><path d="M69.5017129,27.9074708 L67.6495899,77.9147922 C67.617802,78.7730669 66.8619095,79.5 65.9999745,79.5 L34.0000255,79.5 C33.1389427,79.5 32.3820983,78.7703732 32.3504101,77.9147922 L30.4982871,27.9074708 C30.4471846,26.527705 29.2872367,25.4506105 27.9074708,25.5017129 C26.527705,25.5528154 25.4506105,26.7127633 25.5017129,28.0925292 L27.3538359,78.0998505 C27.4850472,81.6425548 30.4490851,84.5 34.0000255,84.5 L65.9999745,84.5 C69.5490762,84.5 72.5147533,81.6479424 72.6461641,78.0998505 L74.4982871,28.0925292 C74.5493895,26.7127633 73.472295,25.5528154 72.0925292,25.5017129 C70.7127633,25.4506105 69.5528154,26.527705 69.5017129,27.9074708 Z"/></svg>
          </div>
          <div v-for="(h, i) in events" :key="i" :class="{ errored: h.errored }">
            <div class="round">{{ h.action }}</div>
            <div>{{ h.value }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="preview">
      <phone :content="lastContents[page.id]" :variables="relation.variables"/>
    </div>
  </div>
</template>

<script>
import CodeMirror from 'codemirror';
import phone from '../components/phone.vue';
import snippets from '../../lib/snippets';
import { crop } from '../../lib/formatter';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/darcula.css';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/addon/comment/comment';
import 'codemirror/addon/search/search';
import 'codemirror/addon/search/matchesonscrollbar';
import 'codemirror/addon/search/match-highlighter';
import 'codemirror/addon/dialog/dialog.css';
import 'codemirror/addon/edit/matchbrackets';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/keymap/sublime';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/selection/active-line';
import 'codemirror/addon/hint/show-hint';
import 'codemirror/addon/hint/show-hint.css';

/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('firebase').default.firestore.Firestore} */
const db = window.db;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;

let editor = null;

export default {
  name: 'PageEditor',

  components: { phone },

  props: {
    relation: Object,
    page: Object,
  },

  data: () => ({
    uses: {},
    events: [],
    lastContents: {},
    lastSave: 0,
  }),

  methods: {
    crop,

    savePage() {
      if (this.lastContents[this.page.id] === this.page.content) return;
      console.log('Saving...');
      db.collection('homes')
        .doc(this.relation.home.id)
        .collection('pages')
        .doc(this.page.id)
        .update({
          content: this.lastContents[this.page.id],
        })
        .then(() => {
          toast.success({ title: 'Page saved !' });
          auth.updateCurrentUser(auth.currentUser);
        });
    },

    importFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = (e) => {
        if (e.target.files[0].size >= 65535) {
          toast.error({ title: 'This file is too big' });
          return;
        }
        if (e.target.files[0].type !== 'text/html') {
          toast.error({ title: 'This file is not a Miakapp page' });
          return;
        }
        const reader = new FileReader();
        reader.readAsText(e.target.files[0], 'UTF-8');
        reader.onload = (readerEvent) => {
          editor.setValue(readerEvent.target.result);
          toast.success({ title: 'Page imported' });
        };
      };
      input.click();
    },

    exportFile() {
      const data = new Blob([this.page.content], { type: 'text/html' });
      const a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(data);
      a.download = `${this.page.name.replace(' ', '_').toLowerCase()}.miak.html`;
      a.click();
      toast.success({ title: 'Page exported' });
    },

    computeVars(content) {
      const uses = {};

      if (!this.relation.variables) return;
      Object.keys(this.relation.variables).forEach((varnm) => {
        uses[varnm] = content.split(`{{${varnm}}}`).length - 1;
      });

      this.uses = uses;
    },
  },

  watch: {
    page() {
      if (!this.lastContents[this.page.id]) this.lastContents[this.page.id] = this.page.content;
      editor.setValue(this.lastContents[this.page.id]);
    },

    [['page.content']]() {
      this.computeVars(this.page.content);
    },

    [['relation.variables']]() {
      this.computeVars(this.page.content);
    },
  },

  mounted() {
    this.lastContents[this.page.id] = this.page.content;

    editor = CodeMirror(document.getElementById('editor'), {
      value: this.page.content,
      mode: 'htmlmixed',
      theme: 'darcula',
      tabSize: 2,
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      highlightSelectionMatches: true,
      autoCloseTags: true,
      styleActiveLine: true,
      keyMap: 'sublime',
    });

    function snippet() {
      CodeMirror.showHint(editor, () => {
        const cursor = editor.getCursor();
        const token = editor.getTokenAt(cursor);

        const list = snippets.filter(
          (item) => item.text.toUpperCase().indexOf(token.string.toUpperCase()) >= 0,
        );

        return {
          list: list.length ? list : snippets,
          from: CodeMirror.Pos(cursor.line, token.start),
          to: CodeMirror.Pos(cursor.line, cursor.ch),
        };
      }, { completeSingle: false });
    }

    editor.setOption('extraKeys', {
      'Cmd-Space': snippet,
      'Ctrl-Space': snippet,
    });

    editor.on('change', () => {
      this.lastContents[this.page.id] = editor.getValue();
    });

    window.onUserEvent.EDITOR = (data) => {
      if (data.type === 'click') {
        this.events.unshift({ action: data.id || 'Anonymous button', value: 'Click', errored: !data.id });
      } else {
        this.events.unshift({ action: data.id || 'Anonymous input', value: data.value, errored: !data.id });
      }
    };

    document.addEventListener('keydown', (event) => {
      if (
        event.key !== 'Control'
        && event.ctrlKey
        && event.key === 's'
      ) {
        event.preventDefault();
        if (Date.now() - this.lastSave > 1000) {
          this.lastSave = Date.now();
          this.savePage();
        }
      }
    }, false);

    window.addEventListener('beforeunload', (e) => {
      if (this.lastContents[this.page.id] !== this.page.content) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  },
};
</script>

<style scoped>
.ideContainer {
  display: flex;
  flex-wrap: nowrap;
  border-left: none;
  height: calc(100vh - 55px);
  margin: -25px -20px;
  overflow: hidden;
}

.middleBar {
  display: grid;
  row-gap: 5px;
  grid-template-rows: 65px auto;
  background-color: var(--color3);
  max-width: 300px;
  padding: 10px;
  width: 100%;
  user-select: none;
}

.pageDebugTool {
  display: flex;
  flex-wrap: wrap;
}
.pageDebugTool > *:last-child { height: 100px; }

.saveContainer {
  display: grid;
  grid-gap: 10px;
  grid-template-columns: 50% 50%;
  margin-right: 10px;
}

.vs_button {
  background-color: var(--color4);
  font-size: 13px;
  padding: 7px;
  cursor: pointer;
}

.vs_button.full {
  grid-column-start: 1;
  grid-column-end: 3;
}

.vs_button.disabled { opacity: 0.5; cursor: default; }
.vs_button:not(.disabled):hover { background-color: var(--color5) }

.miniTable {
  width: 100%;
  text-align: left;
}

.miniTable > .containerTitle {
  display: flex;
  justify-content: space-between;
  border-bottom: solid 1px var(--color4);
  margin-bottom: 5px;
  font-size: 18px;
  cursor: default;
  height: 20px;
}

.containerTitle > svg {
  height: 100%;
  fill: var(--color4);
  cursor: pointer;
}
.containerTitle > svg:hover { fill: var(--color4) }

.miniTable > *:not(.containerTitle) {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  font-size: 14px;
  padding: 2px 7px;
  cursor: pointer;
}
.miniTable > *:not(.containerTitle):hover { background-color: var(--color4) }

.round {
  font-size: 12px;
  color: var(--lightFont);
  background-color: var(--color4);
  margin-right: 7px;
  padding: 2px 5px;
  border-radius: 10px;
}

.errored { opacity: 0.7 }
.errored > :first-child { background-color: var(--error) }

.description {
  color: var(--lightFont);
  font-size: 11px;
  line-height: 16px;
  text-overflow: clip;
  white-space: nowrap;
  overflow: hidden;
  opacity: 0.8;
}

.round.active {
  background-color: var(--color8) !important;
}

.preview {
  width: 100%;
  height: 100%;
  max-width: 450px;
  overflow-y: auto;
  margin: 0 auto;
}
</style>

<style>
#editor {
  text-align: left;
  width: 40%;
  height: 100%;
}

#editor *, .CodeMirror-hint {
  transition: none;
  font-family: Consolas, Menlo, Monaco,
    'Lucida Console', 'Liberation Mono',
    'DejaVu Sans Mono', 'Bitstream Vera Sans Mono',
    'Courier New', monospace, serif;
}

.CodeMirror {
  height: 100%;
}

.CodeMirror-hint {
  text-align: left;
  color: #818181;
}

.CodeMirror-hint-active {
  color: #efefef !important;
}
</style>
