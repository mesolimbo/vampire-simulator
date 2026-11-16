'use strict';
// Music, ambience and sound effects. Nothing here changes the simulation: each frame compares the simulation with
// what it saw last frame and plays a sound for each change (a knock, a curse, dusk). Volumes come from the settings.

const audio = (() => {
  const SFX = ['knock', 'door_slam', 'door_open', 'door_close', 'crypt_door', 'feed', 'curse', 'vampire_rise', 'purge',
    'vampire_slain', 'player_death', 'sun_sizzle_loop', 'dusk', 'dawn', 'dawn_warning_loop', 'hunter_recruit', 'rally',
    'church_falls', 'win', 'lose', 'start', 'denied', 'ambience_night_loop', 'ambience_day_loop'];
  // Full levels of each bus; the settings' music and effects volumes scale them (ambience goes with the effects).
  const LEVEL = { music: 0.45, ambience: 0.45, sfx: 1 };
  let ctx = null, master, buses = {}, buffers = {}, config = { music: 70, sfx: 80, muted: false };
  const busLevel = (name) => LEVEL[name] * (name === 'music' ? config.music : config.sfx) / 100;

  function configure(s) {
    config = { music: s.music, sfx: s.sfx, muted: s.muted };
    if (!ctx) return;
    master.gain.setTargetAtTime(config.muted ? 0 : 1, ctx.currentTime, 0.05);
    for (const name of Object.keys(LEVEL)) buses[name].gain.setTargetAtTime(busLevel(name), ctx.currentTime, 0.05);
  }

  // Browsers only start audio after a key press or click, so everything is set up on the first one.
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = config.muted ? 0 : 1; master.connect(ctx.destination);
    for (const name of Object.keys(LEVEL)) { buses[name] = ctx.createGain(); buses[name].gain.value = busLevel(name); buses[name].connect(master); }
    const load = (key, url) => fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => { buffers[key] = buf; }).catch((e) => console.warn('audio', url, e));
    SFX.forEach((n) => load(n, `assets/audio/sfx/${n}.mp3`));
    load('bgm', 'assets/audio/music/bgm_loop.mp3');
  }

  function play(name, volume = 1, bus = 'sfx') {
    if (!ctx || !buffers[name] || volume <= 0.01) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffers[name]; g.gain.value = volume;
    src.connect(g).connect(buses[bus]); src.start();
  }

  // Loops fade toward a target level, so they can follow the game state every frame without clicks.
  const loops = {};
  function loop(name, target, bus = 'sfx', fade = 0.6) {
    if (!ctx || !buffers[name]) return;
    let l = loops[name];
    if (!l) {
      if (target <= 0) return;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buffers[name]; src.loop = true; g.gain.value = 0;
      src.connect(g).connect(buses[bus]); src.start();
      l = loops[name] = { g, target: -1 };
    }
    if (Math.abs(l.target - target) > 0.01) { l.target = target; l.g.gain.setTargetAtTime(target, ctx.currentTime, fade / 3); }
  }

  // Events far from the camera are quieter, so the town's business stays in the background.
  function near(p) {
    const s = mode === 'title' ? crypt.door : cameraSubject();
    return Math.max(0.15, 1 - Math.hypot(p.x - s.x, p.y - s.y) / 700);
  }

  let seen = null;
  function snapshot() {
    return {
      mode, map: mapVersion, night: isNight(), rally: !!rally, broke: !!(rally && rally.broke),
      pState: player.state, pHouse: player.house, feeding: !!(talk && talk.feeding), flash: flashMsg, death: deathNotice,
      houses: new Map(houses.map((h) => [h, h.state])),
      actors: new Map(actors.map((e) => [e, { alive: e.alive, state: e.state }])),
    };
  }

  function update() {
    if (!ctx) return;
    const now = snapshot(), was = seen;
    seen = now;
    if (!was || was.map !== now.map) {   // a new game: nothing to compare with yet
      if (was && now.mode === 'play') play('start', 0.8);
      return;
    }
    if (was.mode === 'title' && now.mode === 'play') play('start', 0.8);
    if (was.mode === 'play' && now.mode === 'over') play(endText.won ? 'win' : 'lose');

    if (now.mode === 'play') {
      // The player at doors.
      const door = (s) => (s === crypt ? 'crypt_door' : 'door_open');
      if (was.pState === 'walk' && now.pState === 'talk') play('knock');
      if (was.pState === 'talk' && now.pState === 'walk') play('door_slam');
      if (!was.feeding && now.feeding) { play('door_open'); play('feed', 0.9); }
      else if (was.pState !== 'inside' && now.pState === 'inside' && now.death === was.death && !now.rally) play(door(now.pHouse), 0.8);
      if (was.pState === 'inside' && now.pState === 'walk') play(was.pHouse === crypt ? 'crypt_door' : 'door_close', 0.8);
      if (now.flash && now.flash !== was.flash) play('denied', 0.7);
      if (now.death !== was.death && now.death) play('player_death');

      // The town.
      if (was.night !== now.night) play(now.night ? 'dusk' : 'dawn', 0.7);
      for (const [h, state] of now.houses) {
        const before = was.houses.get(h);
        if (before === 'clean' && state === 'cursed') play('curse', 0.7 * near(h.door));
        if (before === 'cursed' && state === 'clean') play('purge', 0.8 * near(h.door));
      }
      for (const [e, s] of now.actors) {
        const before = was.actors.get(e);
        if (!before) play(e.kind === 'vamp' ? 'vampire_rise' : 'hunter_recruit', 0.7 * near(e));
        else if (before.alive && !s.alive && e.kind === 'vamp') play('vampire_slain', 0.8 * near(e));
        else if (before.state !== 'knock' && s.state === 'knock' && !e.inside) play('knock', 0.5 * near(e));
      }
      if (!was.rally && now.rally) play('rally');
      if (!was.broke && now.broke) play('church_falls');
    }

    // Loops: the music throughout, the night or day around it, the sun's sizzle on the player, and the clock
    // ticking when dawn is close and the player is still outside.
    const playing = now.mode === 'play' && !paused;
    loop('bgm', 1, 'music', 1.5);
    loop('ambience_night_loop', now.mode !== 'title' && now.night ? 1 : 0, 'ambience', 3);
    loop('ambience_day_loop', now.mode !== 'title' && !now.night ? 1 : 0, 'ambience', 3);
    loop('sun_sizzle_loop', playing && player.sun > 0 && player.state !== 'inside' ? 0.9 : 0, 'sfx', 0.2);
    const late = now.night && timeToDawn() < TUNE.dawnWarningSeconds && player.state !== 'inside' && !rally;
    loop('dawn_warning_loop', playing && late ? 0.6 : 0, 'sfx', 0.5);
  }

  return { init, update, configure };
})();
