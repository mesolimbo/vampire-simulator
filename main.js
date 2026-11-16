'use strict';
// Input and the frame loop. The 3D view (render3d.js) draws the town; ?view=2d draws it flat on the canvas instead.

const view3d = () => !VIEW_2D && window.render3d && window.render3d.ready;

// ---------- input ----------

addEventListener('keydown', (ev) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) ev.preventDefault();
  if (ev.repeat) return;
  keys.add(ev.code);
  if (!VIEW_2D && !view3d()) return;   // hold the game until the town has loaded
  // The town on the title screen is the one the game starts in, so the 3D view need not rebuild.
  if (mode === 'title') { if (ev.code === 'Enter' || ev.code === 'Space') mode = 'play'; return; }
  if (ev.code === 'KeyR') { reset(); mode = 'play'; paused = false; return; }
  if (mode !== 'play') return;
  if (ev.code === 'KeyP') paused = !paused;
  if (ev.code === 'KeyE') interact(false);
  if (ev.code === 'KeyW' || ev.code === 'ArrowUp') interact(true);
});
addEventListener('keyup', (ev) => keys.delete(ev.code));
addEventListener('blur', () => keys.clear());

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'play' && !paused) {
    const steps = timeScale();
    for (let i = 0; i < steps && mode === 'play'; i++) update(dt);
  }
  if (VIEW_2D) draw();
  else if (window.render3d) { window.render3d.frame(); updateHud(); drawOverlay(); }
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
