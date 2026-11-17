'use strict';
// The HTML top bar and footer (assets/hud): filled from the simulation every frame in the 3D view.

// The clock as an hour of the day: dusk is 18:00 and dawn 06:00. The night runs over nightSeconds, the day over daySeconds.
function hourOfDay() {
  return isNight() ? (18 + 12 * clock / TUNE.nightSeconds) % 24 : 6 + 12 * sunTime() / TUNE.daySeconds;
}

// What the footer says: a title naming where the player is, a line of description, and a key prompt when there is
// something to do. A notice (flash) replaces the description while it shows; with nothing to say, the latest event does.
function footerText() {
  const p = player, now = performance.now();
  let title = 'The Town', desc = '', action = null;
  if (rally) {
    title = 'House of Worship';
    desc = rally.broke ? 'The house of worship falls.' : 'Every house is cursed. The vampires swarm the house of worship.';
  } else if (p.state === 'inside') {
    title = p.house === crypt ? 'The Crypt' : p.house.name;
    if (p.feed > 0) desc = 'You feed.';
    else if (autoSkip()) desc = 'Nothing left to do. Time races on.';
    else if (isNight()) { desc = 'Hold Space to pass time.'; action = ['E', 'Leave']; }
    else desc = 'The sun is up. Hold Space to pass time.';
  } else if (p.state === 'talk' && talk) {
    title = talk.house.name;
    desc = talk.feeding ? 'Invited in. You feed.' : talk.t >= TUNE.talkBeatSeconds * 3 ? (talk.won ? 'Invited in' : 'Turned away') : 'You knock.';
  } else if (p.state === 'auto') {
    desc = 'Every door is shut to you tonight. You return to shelter.';
  } else if (p.state === 'walk') {
    const h = nearDoor();
    if (nearCrypt()) {
      title = 'The Crypt';
      if (denTaken(crypt)) desc = 'Another vampire has claimed the crypt.';
      else { desc = 'Shelter from the sun.'; action = ['E', 'Enter']; }
    } else if (h && h.state === 'hunter') {
      title = 'House of Worship'; desc = 'You cannot enter.';
    } else if (h) {
      title = h.name;
      if (h.state === 'cursed') {
        if (vampireInside(h)) desc = 'A vampire is inside.';
        else { desc = 'Cursed. Shelter from the sun.'; action = ['E', 'Enter']; }
      } else if (h.wary) desc = 'Wary until tomorrow night.';
      else if (vampireKnocking(h)) desc = 'Another vampire is at the door.';
      else if (isNight()) { desc = 'They might let you in.'; action = ['E', 'Knock']; }
      else desc = 'The sun is up. Find shelter.';
    }
  }
  if (flashMsg && now - flashMsg.at < flashMsg.ms) desc = flashMsg.text;
  if (!desc && logs.length && now - logs[0].at < 12000) desc = logs[0].text;
  return { title, desc, action };
}

function updateHud() {
  if (!window.hud) return;
  const count = (s) => houses.filter((h) => !h.isHQ && h.state === s).length;
  hud.setCounters({
    clean: count('clean'), cursed: count('cursed'),
    // The player counts too, unless the game has ended in dust.
    vampires: actors.filter((e) => e.kind === 'vamp' && e.alive).length + (mode === 'over' && !endText.won ? 0 : 1),
    hunters: actors.filter((e) => e.kind === 'hunter').length,
    hunger: player.fed ? 0 : player.hunger,
  });
  hud.setTime(hourOfDay(), TUNE.nightSeconds, TUNE.daySeconds, nightNum, TUNE.dawnWarningSeconds);
  const f = footerText();
  hud.setContext(f.title, f.desc);
  hud.setAction(...(mode === 'play' && f.action ? f.action : []));
  hud.setSpeed(mode !== 'play' ? '' : paused ? 'Paused' : timeScale() > 1 ? `Fast x${timeScale()}` : '');
}

// ---------- talk, death and end panels (3D view; the 2D view draws its own on the canvas) ----------

const PORTRAITS = 'assets/portraits/';
const VILLAGERS = 10;
// Fetch every portrait up front, so none pops in late halfway through a talk.
// Every portrait and piece of menu art is fetched and decoded before the game can start (render3d waits for
// artReady), so nothing pops in late. The images are kept, so the browser keeps them decoded.
const preloaded = [];
const preload = (src) => { const img = new Image(); img.src = src; preloaded.push(img); return img.decode().catch(() => {}); };
const artReady = Promise.all([
  ...['knock', 'invited', 'refused', 'feed'].map((n) => preload(`${PORTRAITS}vampire_${n}.jpg`)),
  ...Array.from({ length: VILLAGERS }, (_, i) => ['neutral', 'displeased', 'charmed'].map((m) => preload(`${PORTRAITS}villagers/v${String(i + 1).padStart(2, '0')}_${m}.jpg`))).flat(),
  ...['bat', 'knocker', 'curse', 'sun', 'goblet', 'moon', 'cottage', 'door-open', 'door-shut', 'gear'].map((n) => preload(`assets/ui/icons/${n}.png`)),
  ...['goal', 'knock', 'curse', 'day', 'win'].map((n) => preload(`assets/help/help_${n}.jpg`)),
  preload('assets/ui/bat.png'), preload('assets/ui/corner.png'), preload('assets/title/title_backdrop.jpg'),
]);

const panelEl = (id) => document.getElementById(id);
function setPortrait(img, src) {
  img.classList.toggle('hide', !src);
  if (!src || img.getAttribute('src') === src) return;
  img.src = src;
  img.classList.remove('pop'); void img.offsetWidth; img.classList.add('pop');   // restart the animation
}
const showText = (id, text) => { const el = panelEl(id); el.hidden = !text; if (text && el.textContent !== text) el.textContent = text; };

function updateTalkPanel() {
  const box = panelEl('talk');
  box.hidden = !talk;
  if (!talk) return;
  // Lines appear one beat apart: the knock, the resident's question, the answer, the outcome.
  const shown = talk.feeding ? 4 : Math.floor(talk.t / TUNE.talkBeatSeconds) + 1;
  const villager = `${PORTRAITS}villagers/v${String((talk.house.id - 1) % VILLAGERS + 1).padStart(2, '0')}_`;
  const outcome = shown >= 4;
  setPortrait(panelEl('talkVampire'), `${PORTRAITS}vampire_${talk.feeding ? 'feed' : outcome ? (talk.won ? 'invited' : 'refused') : 'knock'}.jpg`);
  setPortrait(panelEl('talkVillager'), `${villager}${outcome ? (talk.won ? 'charmed' : 'displeased') : 'neutral'}.jpg`);
  box.classList.toggle('feeding', talk.feeding);
  showText('talkHouse', talk.house.name);
  showText('talkKnock', 'Knock, knock.');
  showText('talkQ', shown >= 2 ? `“${talk.q}”` : '');
  showText('talkA', shown >= 3 ? `You: “${talk.a}”` : '');
  // The outcome gets its own band, with an open or a bolted door.
  const band = panelEl('talkOutcomeBand');
  band.hidden = !outcome;
  band.className = `outcome-band ${talk.won ? 'won' : 'lost'}`;
  showText('talkOutcome', outcome ? talk.outcome : '');
  const icon = `assets/ui/icons/door-${talk.won ? 'open' : 'shut'}.png`;
  if (outcome && panelEl('talkOutcomeIcon').getAttribute('src') !== icon) panelEl('talkOutcomeIcon').src = icon;
  panelEl('talkFeed').hidden = !talk.feeding;
  if (talk.feeding) panelEl('talkFeedBar').style.width = `${Math.round(100 * (1 - player.feed / TUNE.feedSeconds))}%`;
}

function updateDeathPanel() {
  const box = panelEl('death'), alpha = deathAlpha();
  box.hidden = alpha <= 0;
  if (alpha <= 0) return;
  box.style.opacity = alpha;
  showText('deathText', deathNotice.text);
  showText('deathWhere', `You'll rise again in ${deathNotice.where}.`);
}

let endShown = null;
// The end screen leads with the outcome, then three featured figures, then the rest on one quiet line.
function updateEndPanel() {
  if (mode !== 'over') { endShown = null; return; }
  if (endShown === endText) return;
  endShown = endText;
  const cursed = houses.filter((h) => !h.isHQ && h.state === 'cursed').length;
  panelEl('endTitle').textContent = endText.won ? 'The town is yours' : 'You are dust';
  panelEl('endText').textContent = endText.won ? 'The vampires broke into the house of worship. The hunters are no more.' : endText.text;
  const featured = [['moon', 'Nights survived', nightNum], ['cottage', 'Homes cursed', cursed], ['door-open', 'Invitations won', stats.invited]];
  panelEl('endFeature').replaceChildren(...featured.map(([icon, label, value]) => {
    const d = document.createElement('div'), img = document.createElement('img'), text = document.createElement('div');
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    d.className = 'surface'; img.src = `assets/ui/icons/${icon}.png`; img.alt = '';
    dt.textContent = label; dd.textContent = value; text.append(dt, dd); d.append(img, text); return d;
  }));
  const minor = [`Doors slammed ${stats.slammed}`, `Deaths ${stats.deaths}`];
  if (!endText.won) minor.push(`Hunters left ${hunterCount()}`);
  panelEl('endMinor').textContent = minor.join('  \u00b7  ');
  panelEl('againButton').focus({ preventScroll: true });
}
panelEl('againButton').addEventListener('click', () => { reset(); mode = 'play'; paused = false; document.activeElement.blur(); });
// Back to the title screen, over a fresh town.
panelEl('titleButton').addEventListener('click', () => { reset(); mode = 'title'; paused = false; document.activeElement.blur(); });

function updatePanels() {
  updateTalkPanel();
  updateDeathPanel();
  updateEndPanel();
}
