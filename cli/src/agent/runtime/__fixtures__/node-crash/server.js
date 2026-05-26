// Fixture: exits with code 1 immediately. Used to test crash-before-ready.
console.error('intentional crash');
process.exit(1);
