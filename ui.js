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
    title = talk.house.name; desc = 'You knock.';
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
    vampires: actors.filter((e) => e.kind === 'vamp').length,
    hunters: actors.filter((e) => e.kind === 'hunter').length,
    hunger: player.fed ? 0 : player.hunger,
  });
  hud.setTime(hourOfDay(), TUNE.nightSeconds, TUNE.daySeconds, nightNum, TUNE.dawnWarningSeconds);
  const f = footerText();
  hud.setContext(f.title, f.desc);
  hud.setAction(...(mode === 'play' && f.action ? f.action : []));
  hud.setSpeed(mode !== 'play' ? '' : paused ? 'Paused' : timeScale() > 1 ? `Fast x${timeScale()}` : '');
}
