// Draws, becomes ready, then stops answering forever.
document.body.textContent = 'about to hang';
window.miakapp.ready();
setTimeout(() => {
  for (;;) { /* never yields */ }
}, 200);
