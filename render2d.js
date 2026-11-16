'use strict';
// The canvas renderer: the original 2D view (index.html?view=2d), and the doorstep conversation, death banner and
// title and end screens, which the 3D view draws on a transparent canvas over the scene.

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const VIEW_H = cv.height - HUD - FOOT;   // the map shows between the top bar and the footer, which hold all the text

function text(str, x, y, color = '#fff', font = '13px monospace', align = 'left') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align;
  ctx.fillText(str, x, y);
}
function wrap(str, x, y, maxW, lineH, color, font) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left';
  let line = '';
  for (const word of str.split(' ')) {
    const trial = line ? line + ' ' + word : word;
    if (ctx.measureText(trial).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = word; }
    else line = trial;
  }
  ctx.fillText(line, x, y);
  return y + lineH;
}
function bar(x, y, w, frac, color) {
  ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 4);
}

// Buildings carry their own status, with no labels:
//   colour  a cursed house decays from its clean colours over the nights until it raises a vampire
//   lights  bright red where the player sleeps, dull orange for another vampire, yellow for a household that
//           will still answer the door, dark otherwise
//   door    shut on every living household and on the crypt; a cursed house stands open unless a vampire
//           is inside it
const CLEAN = { roof: '#8a5a3c', wall: '#c9b48a' }, DECAYED = { roof: '#3a3140', wall: '#595457' };
const WORSHIP = { roof: '#2f5f8a', wall: '#dfe6ee' };
const LIGHT = { player: '#ff2233', vampire: '#b5651d', home: '#f2c94c', worship: '#9fc4e8' };

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function buildingLook(s) {
  const occupant = playerIn(s) ? LIGHT.player : vampireInside(s) ? LIGHT.vampire : null;
  if (s === crypt) return { light: occupant, shut: true };
  if (s.state === 'cursed') return { light: occupant, shut: !!occupant };
  if (s.state === 'hunter') return { light: isNight() ? null : LIGHT.worship, shut: true };
  return { light: isNight() && !s.wary ? LIGHT.home : null, shut: true };
}

function houseColors(h) {
  if (h.state === 'hunter') return WORSHIP;
  if (h.state !== 'cursed') return CLEAN;
  const t = h.isHQ || h.vampire ? 1 : 0.4 + 0.6 * Math.min(1, h.cursedNights / TUNE.nightsToSpawnVampire);
  return { roof: mix(CLEAN.roof, DECAYED.roof, t), wall: mix(CLEAN.wall, DECAYED.wall, t) };
}

function drawBuilding(x, y, roof, wall, shut, windows, iron) {
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(x + 6, y + HOUSE_H - 2, HOUSE_W, 8);
  ctx.fillStyle = wall;
  ctx.fillRect(x, y + 34, HOUSE_W, 30);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 34); ctx.lineTo(x + HOUSE_W + 4, y + 34); ctx.lineTo(x + HOUSE_W - 10, y - 14); ctx.lineTo(x + 10, y - 14);
  ctx.closePath(); ctx.fill();
  const dx = x + HOUSE_W / 2 - 8, dy = y + 42;
  const leaf = iron ? '#2e333b' : '#7a5433', edge = iron ? '#0c0e12' : '#24160d';
  if (shut) {
    ctx.fillStyle = leaf; ctx.fillRect(dx, dy, 16, 22);
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.strokeRect(dx + 1, dy + 1, 14, 21);
    if (iron) {
      ctx.fillStyle = '#0c0e12'; ctx.fillRect(dx + 4, dy + 4, 8, 5);                         // barred grille
      ctx.fillStyle = '#6d7480'; for (const [rx, ry] of [[3, 13], [12, 13], [3, 19], [12, 19]]) ctx.fillRect(dx + rx, dy + ry, 1, 1);   // rivets
    } else {
      ctx.fillStyle = '#e6c36a'; ctx.fillRect(dx + 11, dy + 11, 2, 2);
    }
  } else {
    ctx.fillStyle = '#0f0806'; ctx.fillRect(dx, dy, 16, 22);
    ctx.fillStyle = leaf; ctx.fillRect(dx, dy, 4, 22);   // the door leaf, swung open
  }
  if (windows) {
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(x + 14, y + 42, 14, 12);
    ctx.fillRect(x + HOUSE_W - 28, y + 42, 14, 12);
  }
}

// Lights are painted after the night tint so they glow through it. A house shows them in its windows. The
// crypt has none, so its light shows through the grille in its iron door.
function drawLight(s, color) {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = color === LIGHT.player ? 18 : 8;
  ctx.fillStyle = color;
  if (s === crypt) {
    ctx.fillRect(s.x + HOUSE_W / 2 - 4, s.y + 46, 8, 5);
    ctx.shadowBlur = 0; ctx.fillStyle = '#0c0e12';
    ctx.fillRect(s.x + HOUSE_W / 2 - 2, s.y + 46, 1, 5); ctx.fillRect(s.x + HOUSE_W / 2 + 1, s.y + 46, 1, 5);   // bars
  } else {
    ctx.fillRect(s.x + 14, s.y + 42, 14, 12);
    ctx.fillRect(s.x + HOUSE_W - 28, s.y + 42, 14, 12);
  }
  ctx.restore();
}

function drawHouse(h) {
  const c = houseColors(h);
  drawBuilding(h.x, h.y, c.roof, c.wall, buildingLook(h).shut, true);
}

// The cross on the house of worship is the town's health gauge: it blazes white while every household is
// clean, dims step by step to dull grey as houses are cursed, and turns bright red for the final swarm.
// Painted after the night tint, like the lights.
function drawCross(h) {
  const homes = houses.filter((x) => !x.isHQ);
  const health = homes.filter((x) => x.state !== 'cursed').length / homes.length;
  ctx.save();
  ctx.fillStyle = mix('#474b52', '#ffffff', health);
  ctx.shadowColor = '#fff7cf'; ctx.shadowBlur = 26 * health * health;
  // The final encounter: with every house taken, the cross burns bright red.
  if (rally) { ctx.fillStyle = '#ff1f2e'; ctx.shadowColor = '#ff1f2e'; ctx.shadowBlur = 28; }
  for (let pass = 0; pass < (rally || health > 0.6 ? 2 : 1); pass++) {   // a second pass doubles the halo
    ctx.fillRect(h.x + HOUSE_W / 2 - 2, h.y - 6, 4, 26);
    ctx.fillRect(h.x + HOUSE_W / 2 - 9, h.y + 2, 18, 4);
  }
  // A hairline outline, drawn over the glow, keeps the edge of the cross sharp at every brightness.
  const cx = h.x + HOUSE_W / 2, y = h.y;
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#0d1524'; ctx.lineWidth = 1;
  ctx.beginPath();
  const outline = [[-2.5, -6.5], [2.5, -6.5], [2.5, 1.5], [9.5, 1.5], [9.5, 6.5], [2.5, 6.5], [2.5, 20.5], [-2.5, 20.5], [-2.5, 6.5], [-9.5, 6.5], [-9.5, 1.5], [-2.5, 1.5]];
  outline.forEach(([ox, oy], i) => (i ? ctx.lineTo(cx + ox, y + oy) : ctx.moveTo(cx + ox, y + oy)));
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

function drawActor(x, y, body, trim, r = 9) {
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x, y + r - 2, r, r * 0.45, 0, 0, 7); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(x, y - r * 0.5, r, 0, 7); ctx.fill();
  ctx.strokeStyle = trim; ctx.lineWidth = 2; ctx.stroke();
}

function darkness() {
  if (!isNight()) return 0;
  return 0.5 * Math.min(1, clock / 3, timeToDawn() / 3);
}


function aimCamera(snap) {
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const s = snap ? player : cameraSubject();
  const dx = clamp(s.x - cv.width / 2, WORLD_W - cv.width) - cam.x, dy = clamp(s.y - VIEW_H / 2, WORLD_H - VIEW_H) - cam.y;
  const far = Math.hypot(dx, dy);
  // Following the player is brisk. Panning to anything else is a slow glide of a few pixels a frame.
  const k = snap ? 1 : s === player ? 0.12 : far && Math.min(1, Math.min(5, Math.max(0.5, far * 0.04)) / far);
  cam.x += dx * k; cam.y += dy * k;
}

function drawGround() {
  ctx.fillStyle = '#3f5f3c'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = '#35503a';   // the graveyard's darker turf
  ctx.beginPath(); ctx.ellipse(crypt.x + HOUSE_W / 2, crypt.y + HOUSE_H + T / 2, 5.2 * T, 4.4 * T, 0, 0, 7); ctx.fill();
  const strip = (l, half, color, reach = WORLD_W + WORLD_H) => {
    ctx.strokeStyle = color; ctx.lineWidth = half * 2;
    ctx.beginPath(); ctx.moveTo(l.x - l.dx * reach, l.y - l.dy * reach); ctx.lineTo(l.x + l.dx * reach, l.y + l.dy * reach); ctx.stroke();
  };
  for (const r of roads) strip(r, ROAD_HALF, '#8c7757');
  strip(river, RIVER_HALF, '#2a5c8d');
  strip(river, RIVER_HALF - 14, '#2f67a0');
  for (const b of bridges) { strip(b, BRIDGE_HALF, '#38250f', b.half); strip(b, BRIDGE_HALF - 5, '#6a4a2b', b.half); }
}

function drawWorld() {
  drawGround();

  const items = [];
  for (const t of tombs) items.push({ y: t.y, draw: () => { ctx.fillStyle = '#8b9390'; ctx.fillRect(t.x - 7, t.y - 16, 14, 18); ctx.beginPath(); ctx.arc(t.x, t.y - 16, 7, 0, 7); ctx.fill(); } });
  items.push({ y: crypt.y + HOUSE_H, draw: () => drawBuilding(crypt.x, crypt.y, '#565d63', '#7d858c', buildingLook(crypt).shut, false, true) });
  for (const h of houses) items.push({ y: h.y + HOUSE_H, draw: () => drawHouse(h) });
  for (const e of actors) {
    if (e.inside) continue;
    // Anyone standing at a door stays close up against it. Walkers keep to the right of their route, so two
    // going opposite ways pass side by side.
    const h = heading(e), standing = e.atDoor || e.state === 'knock' || e.state === 'inspect' || e.state === 'purge';
    const tx = standing || !h ? 0 : -h.y * 9;
    const ty = standing || !h ? -8 : h.x * 9;
    e.ox = (e.ox || 0) + (tx - (e.ox || 0)) * 0.2;
    e.oy = (e.oy || 0) + (ty - (e.oy || 0)) * 0.2;
    const x = e.x + e.ox, y = e.y + e.oy;
    items.push({ y, draw: () => {
      if (e.kind === 'vamp') drawActor(x, y, '#3a1747', '#e0566a');
      else if (e.main) drawActor(x, y, '#f2c94c', '#3a2a00', 11);
      else drawActor(x, y, '#e8eef5', '#1f4f7a');
      if (e.state === 'knock') bar(x - 12, y - 26, 24, 1 - e.timer / TUNE.npcKnockSeconds, '#e0566a');
      if (e.state === 'purge') bar(x - 12, y - 26, 24, 1 - e.timer / TUNE.purgeSeconds, '#6fb3e8');
      if (e.state === 'inspect') bar(x - 12, y - 26, 24, 1 - e.timer / TUNE.inspectSeconds, '#d8d8d8');
    } });
  }
  if (player.state !== 'inside') items.push({ y: player.y, draw: () => drawActor(player.x, player.y, '#111', '#ff3b4e', 11) });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  const d = darkness();
  if (d > 0) { ctx.fillStyle = `rgba(8,10,40,${d})`; ctx.fillRect(0, 0, WORLD_W, WORLD_H); }

  for (const s of [crypt, ...houses]) { const light = buildingLook(s).light; if (light) drawLight(s, light); }
  if (rally || church().state === 'hunter') drawCross(church());

  if (player.sun > 0) bar(player.x - 16, player.y - 34, 32, player.sun / TUNE.sunGraceSeconds, '#ffb020');
}

function drawHud() {
  ctx.fillStyle = '#14141c'; ctx.fillRect(0, 0, cv.width, HUD);
  const night = isNight();
  text(night ? `Night ${nightNum}` : `Day ${nightNum}`, 16, 30, night ? '#b9c3ff' : '#ffd86b', 'bold 20px monospace');

  const bx = 150, bw = 300, nw = bw * TUNE.nightSeconds / cycle();
  ctx.fillStyle = '#2a2f6a'; ctx.fillRect(bx, 18, nw, 12);
  ctx.fillStyle = '#d9b23c'; ctx.fillRect(bx + nw, 18, bw - nw, 12);
  ctx.fillStyle = '#fff'; ctx.fillRect(bx + bw * clock / cycle() - 1, 13, 3, 22);
  const left = Math.ceil(night ? timeToDawn() : timeToDusk());
  text(night ? `Dawn in ${left}s` : `Dusk in ${left}s`, bx + bw + 14, 29, night && left <= TUNE.dawnWarningSeconds ? '#ff5a5a' : '#ddd', 'bold 15px monospace');

  const count = (s) => houses.filter((h) => h.state === s).length;
  const vamps = actors.filter((e) => e.kind === 'vamp').length, hunters = actors.filter((e) => e.kind === 'hunter').length;
  const summary = `Houses: ${count('cursed')} cursed, ${count('clean')} clean   NPC vampires ${vamps}   Hunters ${hunters}`;
  text(summary, 610, 29, '#ddd', '14px monospace');
  const starving = !player.fed && player.hunger >= TUNE.nightsToStarve - 1;
  text(player.fed ? 'Fed tonight' : `Hungry ${player.hunger}/${TUNE.nightsToStarve}`, 610 + ctx.measureText(summary).width + 24, 29, player.fed ? '#7dffa0' : starving ? '#ff5a5a' : '#ddd', 'bold 14px monospace');
  if (paused) text('PAUSED', cv.width - 16, 29, '#fff', 'bold 15px monospace', 'right');
  else if (timeScale() > 1) text(`>> x${timeScale()}`, cv.width - 16, 29, '#7dffa0', 'bold 15px monospace', 'right');
}


// The footer is two lines tall. The bottom line is the newest event. The top line is what the player can do
// or has just been told, or the event before when there is nothing to say. Events fade out with age.
function drawFooter() {
  const now = performance.now(), top = cv.height - FOOT;
  ctx.fillStyle = '#14141c'; ctx.fillRect(0, top, cv.width, FOOT);

  let hint = doorPrompt();
  if (player.state === 'inside') hint = player.feed > 0 ? '' : (player.house === crypt ? 'Inside the crypt.' : `Inside ${player.house.at}.`) + (autoSkip() ? '  Nothing left to do. Time races on.' : isNight() ? '  [E] leave   hold [Space] to pass time' : '  Hold [Space] to pass time');
  if (flashMsg && now - flashMsg.at < flashMsg.ms) hint = flashMsg.text;
  if (rally) hint = rally.broke ? 'The house of worship falls.' : 'Every house is cursed. The vampires swarm the house of worship.';
  const hinted = hint && mode === 'play';
  if (hinted) text(hint, 16, top + 19, '#fff', 'bold 14px monospace');

  logs.slice(0, hinted ? 1 : 2).forEach((l, i) => {
    const age = (now - l.at) / 1000;
    if (age > 12) return;
    ctx.globalAlpha = Math.min(1, 12 - age);
    text(l.text, 16, top + 39 - i * 20, i ? '#aaa' : '#eee');
  });
  ctx.globalAlpha = 1;
}

function drawOverlays() {
  drawFooter();
  drawDeathBanner();
}

function drawDeathBanner() {
  const now = performance.now();
  // Death gets its own banner across the middle of the screen, so no other notice can replace or hide it.
  const deathAge = deathNotice ? (now - deathNotice.at) / 1000 : Infinity;
  // It also fades out over the last game seconds before dusk, so it is gone when the player steps outside.
  const untilDusk = isNight() ? 0 : timeToDusk() - 2;
  if (deathAge < TUNE.deathNoticeSeconds && untilDusk > 0 && mode === 'play') {
    ctx.globalAlpha = Math.min(1, TUNE.deathNoticeSeconds - deathAge, untilDusk / 6);
    ctx.fillStyle = 'rgba(10,0,4,.82)'; ctx.fillRect(0, cv.height / 2 - 56, cv.width, 112);
    ctx.fillStyle = '#b3202a'; ctx.fillRect(0, cv.height / 2 - 56, cv.width, 3); ctx.fillRect(0, cv.height / 2 + 53, cv.width, 3);
    text(deathNotice.text, cv.width / 2, cv.height / 2 - 2, '#ff5a6a', 'bold 28px monospace', 'center');
    text(`You'll rise again in ${deathNotice.where}.`, cv.width / 2, cv.height / 2 + 30, '#ddd', '16px monospace', 'center');
    ctx.globalAlpha = 1;
  }
}

function drawTalk() {
  const w = 720, h = 250, x = (cv.width - w) / 2, y = HUD + (VIEW_H - h) / 2;
  const beat = TUNE.talkBeatSeconds, shown = talk.feeding ? 4 : Math.floor(talk.t / beat) + 1;
  const fed = talk.feeding ? 1 - player.feed / TUNE.feedSeconds : 0;
  const red = talk.feeding ? Math.min(1, fed * 4) : 0;   // the panel bleeds to red as feeding starts
  ctx.fillStyle = `rgba(${Math.round(12 + 98 * red)},${Math.round(10 - 6 * red)},${Math.round(18 - 8 * red)},.95)`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = talk.feeding ? '#ff3b4e' : '#b3202a'; ctx.lineWidth = talk.feeding ? 4 : 2; ctx.strokeRect(x, y, w, h);
  text(talk.house.name, x + 24, y + 32, '#ff8a9a', 'bold 15px monospace');
  let ty = y + 68;
  if (shown >= 1) { text('Knock, knock.', x + 24, ty, '#a8a8b8', 'italic 15px monospace'); ty += 34; }
  if (shown >= 2) ty = wrap(`"${talk.q}"`, x + 24, ty, w - 48, 24, '#fff', 'bold 18px monospace') + 10;
  if (shown >= 3) ty = wrap(`You: "${talk.a}"`, x + 24, ty, w - 48, 22, '#ffb3bd', '16px monospace') + 10;
  if (shown >= 4) wrap(talk.outcome, x + 24, ty, w - 48, 22, talk.won ? '#7dffa0' : '#ff5a5a', 'bold 16px monospace');
  if (talk.feeding) {
    text('You feed.', x + 24, y + h - 34, '#fff', 'bold 18px monospace');
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x + 140, y + h - 48, w - 164, 14);
    ctx.fillStyle = '#ff3b4e'; ctx.fillRect(x + 140, y + h - 48, (w - 164) * fed, 14);
  }
}

function drawPanel(lines) {
  ctx.fillStyle = 'rgba(6,6,12,.88)'; ctx.fillRect(0, 0, cv.width, cv.height);
  let y = 150;
  for (const [str, color, font, gap] of lines) {
    text(str, cv.width / 2, y, color || '#ddd', font || '16px monospace', 'center');
    y += gap || 28;
  }
}

function drawTitle() {
  drawPanel([
    ['VAMPIRE SIMULATOR', '#ff3b4e', 'bold 44px monospace', 30],
    ['lo-fi playtest build', '#888', '14px monospace', 56],
    ['WASD to move.  Walk up to a door and press W or E.', '#fff'],
    ['The doorstep talk plays out by itself. Your first knock each night is 2 to 1 to get you in, the rest are even.', '#fff'],
    ['A house you enter is cursed. After three nights it raises a vampire of its own.', null],
    ['Sunlight kills. By day, shelter in the crypt or inside a cursed house.', null],
    ['The town is new every game. Nobody can cross the river except by its two bridges.', null],
    ['Each morning every hunter visits one random house and purges it if cursed. Long-cursed houses draw them more.', null],
    ['The main hunter (gold) kills any vampire he finds, you included. No other hunter can kill you.', null],
    ['A house purged by the main hunter sends him a new hunter. Converts retire at the second house they visit.', null],
    ['Being invited in is feeding. Any vampire that goes three nights without it starves.', null],
    ['A lesser vampire beats a recruit 2 to 1, and recruits die if they find you. Nobody reaches you in the crypt.', null],
    ['One vampire to a house or crypt. Other vampires may take the crypt, or be home when you need a bed.', null],
    ['Curse every other house and the vampires storm the house of worship. You only die for good with no cursed house left.', '#ffd86b', null, 50],
    ['Hold Space: fast-forward    P: pause    R: restart', '#9aa'],
    ['Press Enter to rise', '#ff3b4e', 'bold 22px monospace', 60],
  ]);
}

function drawEnd() {
  const count = (s) => houses.filter((h) => h.state === s).length;
  drawPanel([
    [endText.won ? 'THE TOWN IS YOURS' : 'YOU ARE DUST', endText.won ? '#7dffa0' : '#ff3b4e', 'bold 44px monospace', 50],
    [endText.text, '#fff', '18px monospace', 50],
    [`Nights: ${nightNum}    Invitations won: ${stats.invited}    Doors slammed: ${stats.slammed}    Deaths: ${stats.deaths}`],
    [`Houses at the end: ${count('cursed')} cursed, ${count('clean')} clean    Hunters alive: ${hunterCount()}`, null, null, 60],
    ['Press R to play again', '#ffd86b', 'bold 20px monospace'],
  ]);
}

let drawnMap = 0;   // the map the 2D camera last snapped to
function draw() {
  if (mode === 'title') return drawTitle();
  if (drawnMap !== mapVersion) { drawnMap = mapVersion; aimCamera(true); }
  drawHud();
  aimCamera(false);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, HUD, cv.width, VIEW_H); ctx.clip();
  ctx.translate(-Math.round(cam.x), HUD - Math.round(cam.y));
  drawWorld();
  ctx.restore();
  drawOverlays();
  if (talk) drawTalk();
  if (mode === 'over') drawEnd();
}

// The 3D view keeps the top bar and footer in HTML, and draws only these on a transparent canvas over the scene.
function drawOverlay() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (mode === 'title') return drawTitle();
  drawDeathBanner();
  if (talk) drawTalk();
  if (mode === 'over') drawEnd();
}
