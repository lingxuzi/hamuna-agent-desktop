// ui.js — MiniApp interaction logic.
// Bind events after DOM is ready; keep state in storage via
// window.__miniappStorage.get/set, never in a module-level global.
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app');
  if (root) root.textContent = 'Hello from MiniApp';
});
