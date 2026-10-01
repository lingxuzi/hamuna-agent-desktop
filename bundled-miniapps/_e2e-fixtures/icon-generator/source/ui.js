document.getElementById('gen-btn').addEventListener('click', () => {
  const icons = ['🎨', '🖌️', '✏️', '🎭', '🎪', '🎬'];
  document.getElementById('icon-output').textContent =
    icons[Math.floor(Math.random() * icons.length)];
});