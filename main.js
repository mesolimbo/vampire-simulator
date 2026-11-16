'use strict';
// Input and the frame loop. The 3D view (render3d.js) draws the town; ?view=2d draws it flat on the canvas instead.

// ---------- input ----------

addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  audio.init();
  if (ev.code === 'KeyM') return menu.toggleMute();
  if (menu.key(ev)) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) ev.preventDefault();
  keys.add(ev.code);
  if (ev.code === 'KeyR') { reset(); mode = 'play'; paused = false; return; }
  if (mode !== 'play') return;
  if (ev.code === 'KeyP') paused = !paused;
  if (ev.code === 'KeyE') interact(false);
  if (ev.code === 'KeyW' || ev.code === 'ArrowUp') interact(true);
});
// Held movement keys must not scroll the page either.
addEventListener('keydown', (ev) => { if (ev.repeat && mode === 'play' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) ev.preventDefault(); });
addEventListener('keyup', (ev) => keys.delete(ev.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', () => audio.init());

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'play' && !paused) {
    const steps = timeScale();
    for (let i = 0; i < steps && mode === 'play'; i++) update(dt);
  }
  audio.update();
  menu.sync();
  if (VIEW_2D) draw();
  else if (window.render3d) { window.render3d.frame(); updateHud(); drawOverlay(); }
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
