'use strict';
// The menus over the game: the title screen, how to play, and settings. Settings are saved in this browser and
// passed on to the audio and the 3D view.

const SETTINGS_KEY = 'vampire-settings';
const DEFAULT_SETTINGS = { music: 20, sfx: 90, muted: false, shadows: 'high', resolution: 'auto', blur: true, aa: true };
// Graphics presets; any other mix of the four settings shows as Custom.
const QUALITY = {
  low: { shadows: 'off', resolution: '0.5', blur: false, aa: false },
  balanced: { shadows: 'low', resolution: '0.75', blur: true, aa: false },
  high: { shadows: 'high', resolution: 'auto', blur: true, aa: true },
};
const qualityName = () => Object.keys(QUALITY).find((q) => Object.entries(QUALITY[q]).every(([k, v]) => settings[k] === v)) || 'custom';
const settings = (() => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
})();

const menu = (() => {
  const byId = (id) => document.getElementById(id), el = byId('menu'), shade = byId('shade'), backdrop = byId('titleBackdrop');
  const views = ['titleView', 'howTo', 'settingsView'].map(byId);
  const controls = { music: byId('setMusic'), sfx: byId('setSfx'), muted: byId('setMute'), shadows: byId('setShadows'), resolution: byId('setRes'), blur: byId('setBlur'), aa: byId('setAa') };
  let view = 'titleView', inGame = false, wasPaused = false;

  function apply() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
    for (const [k, c] of Object.entries(controls)) { if (c.type === 'checkbox') c.checked = settings[k]; else c.value = settings[k]; }
    byId('setMusicVal').textContent = `${settings.music}%`;
    byId('setSfxVal').textContent = `${settings.sfx}%`;
    for (const r of [controls.music, controls.sfx]) r.style.setProperty('--fill', `${r.value}%`);
    const q = qualityName();
    el.querySelectorAll('[data-quality]').forEach((b) => { b.classList.toggle('on', b.dataset.quality === q); b.setAttribute('aria-pressed', b.dataset.quality === q); });
    audio.configure(settings);
    if (window.render3d) window.render3d.configure(settings);
  }
  for (const [k, c] of Object.entries(controls)) {
    c.addEventListener('input', () => { settings[k] = c.type === 'checkbox' ? c.checked : c.type === 'range' ? +c.value : c.value; apply(); });
  }

  const open = () => mode === 'title' || inGame;
  function show(name) {
    view = name;
    el.hidden = !open();   // visible before measuring the help pages
    views.forEach((v) => { v.hidden = v.id !== name; });
    el.querySelectorAll('[data-title-only]').forEach((b) => { b.hidden = inGame; });
    if (name === 'howTo') { turnPage(0, true); evenPages(); }
    const first = byId(name).querySelector('button.primary:not([hidden])') || byId(name).querySelector('[data-action=back]') || byId(name).querySelector('button');
    first.focus({ preventScroll: true });
    el.scrollTop = 0;
  }
  // Help and settings can also open over a game in progress, which pauses until they close.
  function openInGame(name) {
    if (mode === 'play' && !inGame) { inGame = true; wasPaused = paused; paused = true; }
    show(name);
  }
  function close() { inGame = false; paused = wasPaused; document.activeElement.blur(); }
  function back() { if (inGame) close(); else show('titleView'); }
  // The town behind the title screen is the one the game starts in, so the 3D view need not rebuild.
  function start() {
    if (mode !== 'title' || !(VIEW_2D || (window.render3d && window.render3d.ready))) return;
    mode = 'play';
    document.activeElement.blur();
  }

  // How to play is five named steps, each a picture from the game and three short lessons.
  const pages = [...byId('howTo').querySelectorAll('.help-page')], steps = [...byId('howTo').querySelectorAll('.step')];
  let page = 0;
  // Leaders from each badge that names a target to that point of its picture.
  function drawLeaders() {
    byId('howTo').querySelectorAll('.leader').forEach((l) => l.remove());
    byId('howTo').querySelectorAll('.callout[data-target]').forEach((c) => {
      const fig = c.parentElement, w = fig.clientWidth, h = fig.clientHeight;
      if (!w) return;
      const [tx, ty] = c.dataset.target.split(',').map(Number);
      const x0 = parseFloat(c.style.left) / 100 * w, y0 = parseFloat(c.style.top) / 100 * h, x1 = tx / 100 * w, y1 = ty / 100 * h;
      const len = Math.hypot(x1 - x0, y1 - y0) - 5, l = document.createElement('i');
      l.className = 'leader';
      Object.assign(l.style, { left: `${x0}px`, top: `${y0 - 1}px`, width: `${len}px`, transform: `rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)` });
      fig.appendChild(l);
    });
  }
  function evenPages() {
    pages.forEach((p) => { p.style.minHeight = ''; });
    let tallest = 0;
    pages.forEach((p) => { const was = p.hidden; p.hidden = false; tallest = Math.max(tallest, p.offsetHeight); p.hidden = was; });
    pages.forEach((p) => { p.style.minHeight = `${tallest}px`; });
    drawLeaders();
  }
  addEventListener('resize', () => { if (view === 'howTo' && open()) evenPages(); });
  function turnPage(step, reset = false, to = null) {
    page = reset ? 0 : to !== null ? to : Math.min(pages.length - 1, Math.max(0, page + step));
    pages.forEach((p, i) => { p.hidden = i !== page; });
    drawLeaders();
    steps.forEach((s, i) => { s.classList.toggle('on', i === page); s.setAttribute('aria-current', i === page ? 'step' : 'false'); });
    byId('helpCount').textContent = `${page + 1} / ${pages.length}`;
    byId('howTo').querySelector('[data-action=prev]').disabled = page === 0;
    byId('howTo').querySelector('[data-action=next]').disabled = page === pages.length - 1;
  }

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.step) turnPage(0, false, +b.dataset.step);
    else if (b.dataset.quality && b.dataset.quality !== 'custom') { Object.assign(settings, QUALITY[b.dataset.quality]); apply(); }
    else if (b.dataset.view) openInGame(b.dataset.view);
    else if (b.dataset.action === 'start') start();
    else if (b.dataset.action === 'back') back();
    else if (b.dataset.action === 'prev') turnPage(-1);
    else if (b.dataset.action === 'next') turnPage(1);
    else if (b.dataset.action === 'fullscreen') toggleFullscreen();
  });

  // Keys while a menu is open. Returns true when the key belongs to the menu, so the game ignores it.
  function key(ev) {
    if (!open()) {
      if (mode !== 'play') return false;
      if (ev.code === 'Escape') { openInGame('settingsView'); return true; }
      if (ev.code === 'KeyH') { openInGame('howTo'); return true; }
      return false;
    }
    const focused = el.contains(document.activeElement) && document.activeElement !== document.body;
    if (ev.code === 'Escape' || (ev.code === 'Backspace' && !focused)) { if (view !== 'titleView') back(); return true; }
    if (view === 'settingsView') return true;   // its sliders and boxes take the arrow keys and Space themselves
    if (view === 'howTo' && (ev.code === 'ArrowLeft' || ev.code === 'KeyA')) { turnPage(-1); return true; }
    if (view === 'howTo' && (ev.code === 'ArrowRight' || ev.code === 'KeyD')) { turnPage(1); return true; }
    if (ev.code === 'KeyH') { if (view === 'howTo') back(); else show('howTo'); return true; }
    if (inGame) return true;
    if (ev.code === 'Enter' && document.activeElement instanceof HTMLButtonElement) return true;   // the button handles it
    if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); start(); }
    else if (ev.code === 'KeyO') show('settingsView');
    return true;
  }

  // Full screen, from the title screen, the settings, or F anywhere.
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  const syncFullscreen = () => el.querySelectorAll('.fs-label').forEach((l) => { l.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
  document.addEventListener('fullscreenchange', syncFullscreen);
  if (!document.fullscreenEnabled) el.querySelectorAll('[data-action=fullscreen]').forEach((b) => { b.hidden = true; });

  function toggleMute() { settings.muted = !settings.muted; apply(); }

  // Each frame: menus show on the title screen or when opened in game; the shade dims the 3D view's end screen.
  // The title screen shows its render of the town behind every menu; over a game the menus dim the town lightly.
  function sync() {
    el.hidden = !open();
    backdrop.hidden = mode !== 'title';
    el.classList.toggle('scrim', view !== 'titleView');
    el.classList.toggle('on-title', mode === 'title');
    shade.hidden = mode !== 'over' || VIEW_2D;
    document.documentElement.classList.toggle('game-over', mode === 'over' && !VIEW_2D);
    document.documentElement.classList.toggle('no-cursor', !!document.fullscreenElement && mode === 'play' && !open());
  }

  apply();
  return { key, sync, toggleMute, toggleFullscreen };
})();
