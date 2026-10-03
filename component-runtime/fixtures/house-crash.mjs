// Fails while booting: the shell must replace it with its own crash screen.
document.body.textContent = 'half drawn';
throw new Error('house failed to boot');
