// Navigates between its pages with the History API, like the starter's createNav():
// push two pages, then go back past them. It must stay alive.
document.body.textContent = 'pages';
window.miakapp.ready();
const steps = [
  () => history.replaceState({ page: 0 }, ''),
  () => history.pushState({ page: 1 }, ''),
  () => history.pushState({ page: 2 }, ''),
  () => history.back(),
  () => history.back(),
  () => { document.body.dataset.done = 'yes'; },
];
let step = 0;
const next = () => {
  if (step >= steps.length) return;
  try { steps[step](); } catch { /* a browser without history in the frame */ }
  step += 1;
  setTimeout(next, 150);
};
setTimeout(next, 100);
