// A whole-house application as an agent would publish it: its own layout,
// styles, navigation and interactions, drawn with plain DOM. Nothing here comes
// from a Miakapp catalogue; `window.miakapp` is the only thing it is given.
const home = window.miakapp;

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: light; font-family: Georgia, serif; }
  body { margin: 0; background: linear-gradient(160deg, #fbe9d0, #d4e7f7); min-height: 100vh; }
  nav { display: flex; gap: 8px; padding: 12px; }
  nav a { padding: 8px 14px; border-radius: 999px; background: #fff8; color: #222; text-decoration: none; }
  nav a[aria-current="page"] { background: #222; color: #fff; }
  .rooms { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; padding: 12px; }
  .room { border-radius: 20px; padding: 18px; background: #fff; box-shadow: 0 8px 24px #0001; }
`;
document.head.append(style);

const nav = document.createElement('nav');
const main = document.createElement('main');
document.body.append(nav, main);

const routes = { rooms: 'Pièces', lights: 'Lumières' };
for (const [route, label] of Object.entries(routes)) {
  const link = document.createElement('a');
  link.href = `#${route}`;
  link.textContent = label;
  link.dataset.route = route;
  nav.append(link);
}

let pending = false;
let lastError = '';

function render() {
  const route = (location.hash.slice(1) || 'rooms');
  for (const link of nav.querySelectorAll('a')) {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  main.replaceChildren();
  if (route === 'lights') {
    const on = home.state.get('zone.living.light.on') === true;
    const button = document.createElement('button');
    button.id = 'light';
    button.textContent = pending ? 'Envoi…' : on ? 'Éteindre le salon' : 'Allumer le salon';
    button.disabled = pending || home.state.stale;
    button.addEventListener('click', async () => {
      pending = true;
      render();
      try {
        await home.call('lighting.set', { on: !on });
        lastError = '';
      } catch (error) {
        lastError = error.code;
      } finally {
        pending = false;
        render();
      }
    });
    const status = document.createElement('p');
    status.id = 'light-status';
    status.textContent = home.state.stale ? 'Données anciennes' : on ? 'Allumé' : 'Éteint';
    main.append(button, status);
    if (lastError) {
      const error = document.createElement('p');
      error.id = 'light-error';
      error.textContent = lastError;
      main.append(error);
    }
    return;
  }
  const grid = document.createElement('section');
  grid.className = 'rooms';
  const temperature = home.state.get('climate.living.temperature');
  const card = document.createElement('article');
  card.className = 'room';
  card.id = 'living';
  card.textContent = `Salon ${typeof temperature === 'number' ? `${temperature.toFixed(1)} °C` : '—'}`;
  const hidden = document.createElement('p');
  hidden.id = 'ungranted';
  hidden.textContent = String(home.state.get('security.alarm.code'));
  grid.append(card, hidden);
  main.append(grid);
}

window.addEventListener('hashchange', render);
home.state.subscribe(render);
render();
