'use strict';
// The menus over the game: the title screen, how to play, and settings. Settings are saved in this browser and
// passed on to the audio and the 3D view.

const SETTINGS_KEY = 'vampire-settings';
const DEFAULT_SETTINGS = { music: 20, sfx: 90, muted: false, shadows: 'high', resolution: 'auto', blur: true, aa: true };
const FASTEST_GRAPHICS = { shadows: 'off', resolution: '0.5', blur: false, aa: false };
const settings = (() => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
})();

const menu = (() => {
  const byId = (id) => document.getElementById(id), el = byId('menu'), shade = byId('shade');
  const views = ['titleView', 'howTo', 'settingsView'].map(byId);
  const controls = { music: byId('setMusic'), sfx: byId('setSfx'), muted: byId('setMute'), shadows: byId('setShadows'), resolution: byId('setRes'), blur: byId('setBlur'), aa: byId('setAa') };
  let view = 'titleView', inGame = false, wasPaused = false;

  function apply() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
    for (const [k, c] of Object.entries(controls)) { if (c.type === 'checkbox') c.checked = settings[k]; else c.value = settings[k]; }
    byId('setMusicVal').textContent = `${settings.music}%`;
    byId('setSfxVal').textContent = `${settings.sfx}%`;
    audio.configure(settings);
    if (window.render3d) window.render3d.configure(settings);
  }
  for (const [k, c] of Object.entries(controls)) {
    c.addEventListener('input', () => { settings[k] = c.type === 'checkbox' ? c.checked : c.type === 'range' ? +c.value : c.value; apply(); });
  }

  const open = () => mode === 'title' || inGame;
  function show(name) {
    view = name;
    views.forEach((v) => { v.hidden = v.id !== name; });
    el.querySelectorAll('[data-title-only]').forEach((b) => { b.hidden = inGame; });
    if (name === 'howTo') turnPage(0, true);
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

  // How to play is a few pages, each with a picture from the game.
  const pages = [...byId('howTo').querySelectorAll('.help-page')], dots = byId('howTo').querySelector('.dots');
  pages.forEach(() => dots.appendChild(document.createElement('i')));
  let page = 0;
  function turnPage(step, reset = false) {
    page = reset ? 0 : Math.min(pages.length - 1, Math.max(0, page + step));
    pages.forEach((p, i) => { p.hidden = i !== page; });
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === page));
    byId('howTo').querySelector('[data-action=prev]').disabled = page === 0;
    byId('howTo').querySelector('[data-action=next]').disabled = page === pages.length - 1;
  }

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.view) openInGame(b.dataset.view);
    else if (b.dataset.action === 'start') start();
    else if (b.dataset.action === 'back') back();
    else if (b.dataset.action === 'prev') turnPage(-1);
    else if (b.dataset.action === 'next') turnPage(1);
    else if (b.dataset.action === 'fastest') { Object.assign(settings, FASTEST_GRAPHICS); apply(); }
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

  function toggleMute() { settings.muted = !settings.muted; apply(); }

  // Each frame: menus show on the title screen or when opened in game; the shade dims the 3D view's end screen.
  function sync() {
    el.hidden = !open();
    shade.hidden = mode !== 'over' || VIEW_2D;
  }

  apply();
  return { key, sync, toggleMute };
})();
