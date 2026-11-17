/* Standalone presentation layer. Counters are prototype data, not simulated gameplay.
   ?hud=1 and ?hud=2 freeze the two reference states for visual comparison. */
(() => {
  const byId = (id) => document.getElementById(id);
  const fixture = new URLSearchParams(location.search).get('hud');
  document.querySelector('.hud').dataset.fixture = fixture || '';
  const put = (id, value) => { const el = byId(id); if (el.textContent !== String(value)) el.textContent = value; };
  let night = 1, lastHour;
  const pointer = document.querySelector('.hud-clock');
  function context(title, description) { put('hudTitle', title); put('hudDescription', description); }
  window.hud = {
    setCounters({ clean = 16, cursed = 0, vampires = 0, hunters = 1, hunger = 0 } = {}) {
      for (const [id, value] of Object.entries({ hudClean: clean, hudCursed: cursed, hudVampires: vampires, hudHunters: hunters })) put(id, value);
      hunger = Math.max(0, Math.min(3, Math.round(hunger)));
      const blood = 3 - hunger;
      document.querySelector('.hud-pips').setAttribute('aria-label', `Health: ${blood} of 3${blood === 3 ? ', fully fed' : blood === 0 ? ', starving' : ''}`);
      document.querySelectorAll('.hud-pips i').forEach((pip, i) => pip.classList.toggle('full', i < blood));
    },
    // The game passes its own night number, and how close to dawn the countdown should turn red; the preview counts
    // nights itself and only warns before dusk.
    setTime(hour, nightSeconds = 60, daySeconds = 50, nightNumber, dawnWarning = 0) {
      if (fixture === '1' || fixture === '2') return;
      if (lastHour !== undefined && lastHour < 18 && hour >= 18) night++;
      lastHour = hour;
      if (nightNumber) night = nightNumber;
      const day = hour >= 6 && hour < 18;
      const remaining = day ? (18 - hour) / 12 * daySeconds : ((6 - hour + 24) % 24) / 12 * nightSeconds;
      document.querySelector('.hud-moon').dataset.phase = day ? 'day' : 'night';
      document.querySelector('.hud-countdown').classList.toggle('is-warning', remaining > 0 && remaining <= (day ? 5 : dawnWarning));
      put('hudNight', `${day ? 'Day' : 'Night'} ${night}`);
      put('hudCountdown', `${day ? 'Dusk' : 'Dawn'} in ${Math.ceil(remaining)}s`);
      const f = ((hour + 6) % 24) / 12;   // 0-1 over the night, 1-2 over the day
      pointer.style.setProperty('--progress', `${(56 + f * 162) / 4.3}%`);   // x 56-380 of the 430-wide art (clock.svg)
      pointer.setAttribute('aria-label', `Day and night cycle, ${Math.floor(hour)}:${String(Math.floor(hour % 1 * 60)).padStart(2, '0')}`);
    },
    setContext: context,
    // The key prompt beside the footer title, e.g. setAction('E', 'Knock'); no arguments hides it.
    setAction(key, verb) {
      const el = document.querySelector('.hud-action');
      el.classList.toggle('on', !!key);
      if (key) { put('hudActionKey', key); put('hudActionVerb', verb); }
    },
    // Pause or fast-forward, shown after the footer title; an empty string hides it.
    setSpeed(text) { put('hudSpeed', text); },
  };
  window.hud.setCounters();
  if (fixture === '2') {
    window.hud.setCounters({ clean: 12, cursed: 4, vampires: 2 });
    put('hudNight', 'Night 3'); put('hudCountdown', 'Dawn in 36s');
    pointer.style.setProperty('--progress', '22%');
    context('House of Worship', 'The cross watches over the town.');
  }
  // The scene exposes its walker and landmarks; context follows proximity.
  if (fixture !== '1' && fixture !== '2') setInterval(() => {
    const s = window.sceneDebug;
    if (!s) return;
    const distance = (x, z) => Math.hypot(s.walker.x - x, s.walker.z - z);
    if (distance(s.churchAt[0], s.churchAt[1]) < 14) context('House of Worship', 'The cross watches over the town.');
    else if (distance(s.yard.x, s.yard.z - 4) < 17) context('The Crypt', `Night ${night}. You leave the crypt.`);
    else context('The Town', 'Walk among the living. Keep to the shadows.');
  }, 250);
})();
