// Shows what the home's link carried, as an app reading an invite would.
const output = document.createElement('pre');
output.id = 'link';
output.textContent = JSON.stringify(window.miakapp.link);
document.body.append(output);
window.miakapp.ready();
