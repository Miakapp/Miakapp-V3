if (!window.onUserEvent) window.onUserEvent = {};

document.body.onclick = (e) => {
  let el = e.target;
  while (!el || !el.attributes || !el.attributes['@click']) {
    if (!el.parentElement) return;
    el = el.parentElement;
  }

  Object.values(window.onUserEvent).forEach((h) => h({
    type: 'click',
    id: el.id,
    name: el.attributes['@click'].value,
  }));
};

document.body.oninput = (e) => {
  if (!e || !e.target || !e.target.value || !e.target.attributes['@watch']) return;

  Object.values(window.onUserEvent).forEach((h) => h({
    type: 'input',
    id: e.target.id,
    name: e.target.name,
    value: e.target.value,
  }));
};
