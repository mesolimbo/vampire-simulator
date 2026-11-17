// The simulation: rules, tuning, map generator, pathfinding and state. It knows nothing about drawing.
'use strict';

// Every balance knob lives here. Override any of them from the URL, e.g. index.html?nightSeconds=30&npcInviteChance=0.5
const TUNE = {
  nightSeconds: 60,
  daySeconds: 50,
  playerSpeed: 150,
  vampireSpeed: 95,
  hunterSpeed: 120,           // fast enough to reach the farthest home over a bridge and be back by dusk
  maxQueueWait: 4,           // seconds a walker waits for a held tile before pushing through (stops jams)
  convertVisitsBeforeRetiring: 2, // a converted hunter settles in the house of his Nth visit and leaves the game
  followGap: 30,             // pixels a new convert keeps behind the main hunter on the walk home
  deathNoticeSeconds: 5,     // longest the banner stays up after the player dies and rises elsewhere (it also clears before dusk)
  sunGraceSeconds: 2,        // time in sunlight before a vampire dies
  dawnWarningSeconds: 15,    // the dawn countdown turns red, and a fed player stays indoors, this close to sunrise
  feedSeconds: 6,            // player is locked inside after being invited in
  nightsToSpawnVampire: 3,
  nightsToStarve: 3,         // a vampire that goes this many nights without being invited in starves
  hqRespawnDays: 2,          // with no hunters left, the house of worship raises one after this many dawns
  npcKnockSeconds: 4,
  firstKnockInviteChance: 2 / 3, // the player's first knock of each night: 2 to 1 in favour
  playerInviteChance: 0.5,   // every later knock that night is a coin toss
  talkBeatSeconds: 1.1,      // pause between lines of the doorstep conversation
  npcInviteChance: 0.5,
  npcCryptChance: 0.2,       // chance an NPC vampire spends the day in the crypt instead of at home
  hunterSuspicionPerDay: 1,  // extra weight a cursed house gains per day cursed when hunters draw their visits (a clean house weighs 1)
  inspectSeconds: 3.5,       // a hunter's pause at the door of a house that turns out not to be cursed
  purgeSeconds: 3,
  hunterWakeDelay: 3,
  recruitBeatsVampire: 1 / 3, // converted hunter against a converted vampire: 2 to 1 for the vampire
  mainHunterBeatsPlayer: 1,  // only the main hunter can kill the player, and he always does
  fastForward: 8,
  returnFastForward: 3,      // gentler speed-up while hunters or vampires are still walking home
  grassCost: 1.4,            // how much longer a step on grass feels to a walker than a step on a road
  seed: 0,                   // map seed. 0 draws a new map every game; any other number always builds the same one
};
for (const [k, v] of new URLSearchParams(location.search)) {
  if (k in TUNE && !isNaN(parseFloat(v))) TUNE[k] = parseFloat(v);
}

const T = 32, COLS = 52, ROWS = 28, HUD = 48, FOOT = 48;   // the map is wider and taller than the view, which scrolls with the player
const WORLD_W = COLS * T, WORLD_H = ROWS * T;
const HOUSE_W = 3 * T, HOUSE_H = 2 * T, HOMES = 16;
const RIVER_HALF = 74, ROAD_HALF = 36, BRIDGE_HALF = 40;   // half-widths in pixels
const BUILDING = 1, WATER = 2, TOMB = 3;   // tile blockers. Only buildings stop the player by tile: water and tombs use exact shapes

// Each entry is [resident's call, six plausible replies]. A knock uses one call and one of its replies at
// random, purely for flavour: 18 calls x 6 replies = 108 exchanges.
const CALLS = [
  ['Who is it?', ['A traveller. The inn was full.', 'Nobody you know, but I mean no harm.', 'A friend, if you will have one.', 'Someone with sore feet and a long way still to go.', 'Your new neighbour. I thought I should say hello.', 'A stranger. I will not pretend otherwise.']],
  ['What do you want at this hour?', ['A few minutes by a fire, if you can spare them.', 'Directions, mostly. I am badly lost.', 'Only to talk. It has been a long, quiet road.', 'A roof until the weather turns.', 'To return something I think belongs to you.', 'Honestly? Company.']],
  ['It is late. State your business.', ['I need a bed and can pay for it.', 'My horse went lame a mile back.', 'I am looking for my brother. He came this way.', 'I have a message for the owner of this house.', 'I sell lamp oil. You look like you use plenty.', 'No business. I saw a light and hoped.']],
  ['Do I know you?', ['No, but I knew this house when I was young.', 'We met at the market, I think. You sold me apples.', 'Not yet.', 'I doubt it. I only arrived tonight.', 'You knew my mother, I believe.', 'People often say I have a familiar face.']],
  ['Where have you come from?', ['From the coast. Three days on foot.', 'The next valley over. You would not know the village.', 'The city. I do not miss it.', 'Up the hill. I have taken the old manor.', 'Far enough that my boots are finished.', 'Along the churchyard road. It is a grim walk at night.']],
  ['Why knock on my door?', ['Yours was the only window with a light.', 'The house looked kind. Some do.', 'I tried three others. Nobody answered.', 'I heard singing and followed it.', 'A man at the tavern said you take in travellers.', 'I liked the garden.']],
  ['Are you alone out there?', ['Quite alone.', 'Just me and the moths round your lamp.', 'Yes. My companions went on ahead.', 'Alone, and glad to find someone awake.', 'There is a cat following me, but otherwise yes.', 'I have been alone a long time.']],
  ['Cold night, is it not?', ['Bitter. I cannot feel my hands.', 'I have known colder, but not by much.', 'It is. Your hearth looks very welcome from here.', 'I hardly notice it any more.', 'Cold enough that I will not keep you at the door long.', 'The frost is pretty, at least.']],
  ['What is your name, stranger?', ['Ambrose. And yours?', 'Most people call me Corvin.', 'Silas, from an old family nobody remembers.', 'Names can wait. I am too cold to spell mine.', 'Lucian. I am pleased to meet you.', 'Call me whatever you like, if there is soup.']],
  ['What trade are you in?', ['I buy and sell old books.', 'I am a physician, of a sort.', 'Wine. I keep a very old cellar.', 'I mend clocks.', 'None, now. I inherited.', 'I draw maps for people who are lost.']],
  ['How long would you stay?', ['Until the rain stops, no longer.', 'An hour. Less, if I bore you.', 'I will be gone before sunrise, I promise.', 'As long as it takes to dry my coat.', 'Just the night.', 'Only until you ask me to leave.']],
  ['What will you have, if I let you in?', ['A cup of water would do.', 'Nothing. I ate on the road.', 'Whatever is warm.', 'A little wine, if there is any.', 'Only a chair.', 'I would not say no to a drink.']],
  ['We do not get many visitors.', ['Then I am glad to be one.', 'That is a shame. It is a handsome street.', 'Neither do I.', 'I will try to be a good one.', 'Their loss. The place has charm.', 'Quiet towns are the best kind.']],
  ['My dog does not like you.', ['Dogs rarely do at first.', 'He is a good guard. You should be proud.', 'He smells the road on me, that is all.', 'I have a way with animals. Give him a minute.', 'Then I will keep my distance from him.', 'I am more of a cat person myself.']],
  ['You look pale. Are you ill?', ['Only tired.', 'I have always been this colour.', 'A long winter indoors, nothing more.', 'It is the moonlight. It flatters nobody.', 'I have not eaten since yesterday.', 'I was ill. I am much better now.']],
  ['Give me one reason to open this door.', ['I will be no trouble.', 'I can pay.', 'Because you are curious, or you would not have answered.', 'It is cold out here and warm in there.', 'I tell a good story.', 'Because nobody else will.']],
  ['Did someone send you?', ['The innkeeper. He said you were kind.', 'Nobody. I go where I please.', 'A priest two villages back gave me your name.', 'My late aunt spoke of this house.', 'The road did, more or less.', 'A friend of yours, though he asked me not to say which.']],
  ['What is that you are carrying?', ['A bottle. I thought we might share it.', 'Only my coat.', 'A letter I have been meaning to deliver.', 'A gift. It is rude to arrive with nothing.', 'Soil from home. A sentimental habit.', 'Everything I own, I am afraid.']],
];

// One hundred family names and ten kinds of home. Each page load draws the town's sixteen households from
// them once, and they keep those names until the next reload (restarting with R does not rename them).
const FAMILY_NAMES = [
  'Mansford', 'Talbot', 'Ashcombe', 'Blackwood', 'Carrow', 'Dunmore', 'Eastlake', 'Fairfax', 'Garrick', 'Hartwell',
  'Ingram', 'Jessop', 'Kemble', 'Langley', 'Merrick', 'Norcott', 'Oakhurst', 'Pembroke', 'Quince', 'Radcliffe',
  'Selwyn', 'Thackeray', 'Underhill', 'Vane', 'Whitlock', 'Yardley', 'Abernathy', 'Bellamy', 'Chilcott', 'Davenport',
  'Ellery', 'Fenwick', 'Goddard', 'Hollis', 'Iredale', 'Jarvis', 'Kingsley', 'Lovell', 'Marlowe', 'Nesbitt',
  'Orme', 'Pritchard', 'Quimby', 'Rookwood', 'Stanhope', 'Tremayne', 'Upton', 'Vickers', 'Wainwright', 'Yeardley',
  'Alcott', 'Braithwaite', 'Crane', 'Dashwood', 'Everard', 'Fitzroy', 'Gresham', 'Havisham', 'Ives', 'Jellicoe',
  'Kirkbride', 'Lascelles', 'Mowbray', 'Nightingale', 'Osgood', 'Peverell', 'Quarles', 'Ravenscroft', 'Sedgwick', 'Tulkinghorn',
  'Urquhart', 'Varney', 'Wickham', 'Yaxley', 'Ainsworth', 'Bickerstaff', 'Culpepper', 'Drummond', 'Entwhistle', 'Farthing',
  'Glanville', 'Heathcote', 'Isherwood', 'Jephson', 'Kenworthy', 'Lethbridge', 'Musgrave', 'Netherby', 'Ollerton', 'Penhallow',
  'Redgrave', 'Sotheby', 'Trelawney', 'Usher', 'Venables', 'Winterbourne', 'Wolcott', 'Yelverton', 'Zouche', 'Pennyworth',
];
const HOME_KINDS = ['The {n} Residence', '{n} Manor', '{n} House', '{n} Cottage', '{n} Hall', '{n} Lodge', '{n} Villa', '{n} Grange', 'The {n} Homestead', '{n} Place'];


const keys = new Set();
const blocked = new Uint8Array(COLS * ROWS), road = new Uint8Array(COLS * ROWS);
const crypt = {}, tombs = [], cam = { x: 0, y: 0 };

let mode = 'title', paused = false;
let viewYaw = 0;   // the camera's turn about the vertical, in radians; 0 looks north. Set by the 3D view.
let river, roads, bridges;
let houses, actors, player, talk, clock, nightNum, logs, flashMsg, stats, endText, rally, deathNotice;

const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const TOWN_NAMES = shuffle(FAMILY_NAMES.slice()).slice(0, 17).map((n) => HOME_KINDS[rand(HOME_KINDS.length)].replace('{n}', n));
const cycle = () => TUNE.nightSeconds + TUNE.daySeconds;
const isNight = () => clock < TUNE.nightSeconds;
const timeToDawn = () => TUNE.nightSeconds - clock;
const timeToDusk = () => cycle() - clock;
const sunTime = () => clock - TUNE.nightSeconds;
const church = () => houses.find((h) => h.isHQ);
const hunterCount = () => actors.filter((e) => e.kind === 'hunter' && e.alive).length;

// ---------- map generation ----------

// The river and the roads are straight lines: a point plus a unit direction. side() is the signed distance
// from a line (its sign names the bank), off() the plain distance.
const side = (l, x, y) => (x - l.x) * l.dy - (y - l.y) * l.dx;
const off = (l, x, y) => Math.abs(side(l, x, y));
const inWater = (x, y) => off(river, x, y) < RIVER_HALF - 4 && !roads.some((r) => off(r, x, y) <= BRIDGE_HALF - 9);

function seeded(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One attempt at a map (see Design/procedural-maps.png). An imaginary hexagon sits in the middle of the map.
// The river runs through one pair of its opposing edges and a road through each of the other two pairs, so
// both roads cross the river, and each crossing gets a bridge. The crypt and the house of worship go at the
// far ends of opposite banks, and the homes anywhere that is dry and off the roads.
// Returns false when the draw does not work out (bridges too close, no room, a door cut off); the caller redraws.
function layout(rnd) {
  blocked.fill(0); road.fill(0); tombs.length = 0;
  const R = WORLD_H / Math.sqrt(3);   // flat edges of the hexagon lie on the top and bottom of the map
  const corner = (i) => ({ x: WORLD_W / 2 + R * Math.cos(i * Math.PI / 3), y: WORLD_H / 2 + R * Math.sin(i * Math.PI / 3) });
  const crossing = (edge) => {
    const a = corner(edge), b = corner(edge + 1), t = 0.2 + 0.6 * rnd();
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const through = (edge) => {
    const a = crossing(edge), b = crossing(edge + 3), len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x, y: a.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
  };
  const first = Math.floor(rnd() * 3);
  [river, ...roads] = [0, 1, 2].map((i) => through((first + i) % 3));

  bridges = [];
  for (const r of roads) {
    const sin = r.dx * river.dy - r.dy * river.dx;   // of the angle between road and river
    if (Math.abs(sin) < 0.7) return false;           // a shallow crossing would need a very long bridge
    const s = -side(river, r.x, r.y) / sin;
    // Long enough to span all the water under the road, plus a little of each bank.
    const half = (RIVER_HALF + BRIDGE_HALF * Math.sqrt(1 - sin * sin)) / Math.abs(sin) + 10;
    const b = { x: r.x + r.dx * s, y: r.y + r.dy * s, dx: r.dx, dy: r.dy, half };
    if (b.x < 4 * T || b.x > WORLD_W - 4 * T || b.y < 4 * T || b.y > WORLD_H - 4 * T) return false;
    bridges.push(b);
  }
  if (Math.hypot(bridges[0].x - bridges[1].x, bridges[0].y - bridges[1].y) < 8 * T) return false;

  // Walkers move tile to tile, so water tiles are a little wider than the river and bridge tiles a little
  // narrower than the bridge. keepOut marks every tile that water or a road touches at all.
  const keepOut = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < COLS * ROWS; i++) {
    const x = (i % COLS + 0.5) * T, y = (Math.floor(i / COLS) + 0.5) * T;
    const toRoad = Math.min(off(roads[0], x, y), off(roads[1], x, y)), toRiver = off(river, x, y);
    if (toRoad <= ROAD_HALF) road[i] = 1;
    if (toRiver < RIVER_HALF + 12 && toRoad > BRIDGE_HALF - 10) blocked[i] = WATER;
    // The railings run on past the water onto both banks, to the bridge's ends.
    for (const b of bridges) {
      const along = Math.abs((x - b.x) * b.dx + (y - b.y) * b.dy), across = Math.abs((x - b.x) * b.dy - (y - b.y) * b.dx);
      if (along < bridgeReach(b) + 8 && across > BRIDGE_HALF - 10 && across < BRIDGE_HALF + 20) blocked[i] = WATER;
    }
    if (toRiver < RIVER_HALF + 0.75 * T || toRoad < ROAD_HALF + 0.75 * T) keepOut[i] = 1;
  }

  // A building covers 3 x 2 tiles with its door on the tile below. It needs those, and the row above for its
  // roof, clear, and it keeps padX columns or padY rows between itself and every other building.
  const spots = [];
  const fits = (tx, ty, padX, padY) => {
    for (let y = ty - 1; y <= ty + 2; y++) for (let x = tx; x < tx + 3; x++) if (keepOut[y * COLS + x]) return false;
    return spots.every((s) => Math.abs(s.tx - tx) >= Math.max(s.padX, padX) || Math.abs(s.ty - ty) >= Math.max(s.padY, padY));
  };
  // With a bank given, takes the spot farthest from the river out of ten random ones on that bank.
  // `edge` is how many tiles to stay clear of the map's border.
  const place = (padX, padY, bank = 0, edge = 1) => {
    let best = null;
    for (let tries = 0, found = 0; tries < 400 && found < (bank ? 10 : 1); tries++) {
      const tx = edge + Math.floor(rnd() * (COLS - 2 - 2 * edge)), ty = edge + Math.floor(rnd() * (ROWS - 2 - 2 * edge));
      if (!fits(tx, ty, padX, padY)) continue;
      const reach = side(river, (tx + 1.5) * T, (ty + 1) * T) * bank;
      if (reach < 0) continue;
      found++;
      if (!best || reach > best.reach) best = { tx, ty, padX, padY, reach };
    }
    if (best) spots.push(best);
    return best;
  };
  const bank = rnd() < 0.5 ? 1 : -1;
  const cryptSpot = place(8, 7, bank, 3), churchSpot = cryptSpot && place(5, 4, -bank);   // wide padding leaves room for the graveyard
  if (!churchSpot) return false;
  for (let i = 0; i < HOMES; i++) if (!place(5, 4)) return false;

  const building = (s) => {
    for (let y = s.ty; y < s.ty + 2; y++) for (let x = s.tx; x < s.tx + 3; x++) blocked[y * COLS + x] = BUILDING;
    return { x: s.tx * T, y: s.ty * T, door: { x: (s.tx + 1.5) * T, y: (s.ty + 2.5) * T } };
  };
  Object.assign(crypt, building(cryptSpot));
  // The house of worship stands taller and deeper than its tiles: it covers the row behind it and the tiles either
  // side of its door, so walkers reach its door straight from the front and never cut through its walls.
  for (let x = churchSpot.tx; x < churchSpot.tx + 3; x++) blocked[(churchSpot.ty - 1) * COLS + x] = BUILDING;
  for (const x of [churchSpot.tx, churchSpot.tx + 2]) blocked[(churchSpot.ty + 2) * COLS + x] = BUILDING;
  // A cursed home's door swings out over the tile left of its doorstep, so walkers stay off that tile.
  for (const s of spots.slice(1)) if (s !== churchSpot) blocked[(s.ty + 2) * COLS + s.tx] = BUILDING;
  houses = spots.slice(1).map((s, i) => ({
    ...building(s),
    id: i + 1, name: TOWN_NAMES[i], at: TOWN_NAMES[i].replace(/^The /, 'the '),
    state: 'clean', isHQ: s === churchSpot,
    wary: false, claim: null, cursedNights: 0, vampire: null, hunterTimer: 0,
  }));

  // Tombstones stand around the crypt, never side by side, and never between the crypt and its door.
  for (let tries = 0; tombs.length < 8 && tries < 300; tries++) {
    const tx = cryptSpot.tx - 3 + Math.floor(rnd() * 9), ty = cryptSpot.ty - 2 + Math.floor(rnd() * 8);
    if (tx < 1 || ty < 1 || tx > COLS - 2 || ty > ROWS - 2 || keepOut[ty * COLS + tx]) continue;
    if (Math.abs(tx - cryptSpot.tx - 1) <= 2 && ty >= cryptSpot.ty - 1 && ty <= cryptSpot.ty + 4) continue;
    if (tombs.some((t) => Math.abs(t.tx - tx) < 2 && Math.abs(t.ty - ty) < 2)) continue;
    blocked[ty * COLS + tx] = TOMB;
    tombs.push({ tx, ty, x: (tx + 0.5) * T + rnd() * 8 - 4, y: (ty + 0.5) * T + 6 });
  }

  // Every door must be reachable from every other, on foot, over the bridges.
  Object.assign(crypt.door, fieldFrom(crypt.door));
  if (!houses.every((h) => crypt.door.cost[tileOf(h.door)] < Infinity)) return false;
  for (const h of houses) Object.assign(h.door, fieldFrom(h.door));
  return true;
}

let mapVersion = 0;   // counts maps built, so a renderer knows when to rebuild its scene
function buildMap() {
  mapVersion++;
  const seed = TUNE.seed || 1 + rand(1e9);
  for (let attempt = 0; !layout(seeded(seed + attempt)); attempt++);
  console.log(`Map seed ${seed}. Add ?seed=${seed} to the URL to build this map again.`);
}

function reset() {
  buildMap();
  actors = []; talk = null; logs = []; flashMsg = null; rally = null; deathNotice = null;
  clock = 0; nightNum = 1;
  stats = { invited: 0, slammed: 0, deaths: 0 };
  player = { x: crypt.door.x, y: crypt.door.y, state: 'walk', house: null, feed: 0, sun: 0, hunger: 0, fed: false, knocksTonight: 0 };
  church().state = 'hunter';
  spawnHunter();
  log('Night 1. You leave the crypt.');
}

function log(text) { logs.unshift({ text, at: performance.now() }); logs.length = Math.min(logs.length, 7); }
function flash(text, ms = 2200) { flashMsg = { text, at: performance.now(), ms }; }

// ---------- movement and pathfinding ----------

// The player collides with the 3D models' walls at ground level, measured from the models: each box is
// [left, right, top, bottom] in pixels from the building's top-left corner (the door point is at 48, 80).
// Walkers use the tile grid instead (see layout), which keeps them a little further off.
const WALLS = {
  house: [15, 81, 11, 71],
  crypt: [25, 71, 25, 71],
  church: [-1, 97, -17, 91],   // its front steps, down to 97, can be climbed
};
// A cursed house's door hangs open outwards, to the left of the doorway.
const OPEN_DOOR = [34, 42, 68, 86];
const TOMB_BOX = [-6.5, 6.5, -12, 0];   // round a tombstone's point
const PLAYER_R = 6;
const doorOpen = (h) => h.state === 'cursed' && !vampireInside(h);

// How far the bridge (deck, railings and the abutments at both ends) runs either side of the river's centre
// line along its road, in pixels. The 3D view builds it from 3 m spans plus a 3 m abutment at each end.
function bridgeReach(b) {
  const S = 3 / 32, spans = Math.ceil((2 * b.half * S - 6) / 3);
  return (spans * 3 + 6) / 2 / S;
}
// On a bridge, walkers keep to the deck between the railings.
function onRailing(x, y, r) {
  return bridges.some((b) => {
    const along = Math.abs((x - b.x) * b.dx + (y - b.y) * b.dy), across = Math.abs((x - b.x) * b.dy - (y - b.y) * b.dx);
    return along < bridgeReach(b) + r && across > BRIDGE_HALF - 9 && across < BRIDGE_HALF + r + 3;
  });
}

function blockedAt(px, py) {
  const tx = Math.floor(px / T), ty = Math.floor(py / T);
  return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS;
}
const inBox = (x, y, r, ox, oy, [x0, x1, y0, y1]) => x + r > ox + x0 && x - r < ox + x1 && y + r > oy + y0 && y - r < oy + y1;
function canStand(x, y) {
  const r = PLAYER_R;
  if (blockedAt(x - r, y - r) || blockedAt(x + r, y + r) || inWater(x, y) || onRailing(x, y, r)) return false;
  if (inBox(x, y, r, crypt.x, crypt.y, WALLS.crypt)) return false;
  for (const h of houses) {
    if (inBox(x, y, r, h.x, h.y, h.isHQ ? WALLS.church : WALLS.house)) return false;
    if (!h.isHQ && doorOpen(h) && inBox(x, y, r, h.x, h.y, OPEN_DOOR)) return false;
  }
  return !tombs.some((t) => inBox(x, y, r, t.x, t.y, TOMB_BOX));
}

const tileOf = (p) => Math.floor(p.y / T) * COLS + Math.floor(p.x / T);
const tileCentre = (i) => ({ x: (i % COLS + 0.5) * T, y: (Math.floor(i / COLS) + 0.5) * T });
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Calls visit(tile, stepLength) for each tile a walker can step to from `cur`. A diagonal step needs both
// tiles beside it free, so nobody cuts a corner of a house or of the river.
function eachStep(cur, visit) {
  const cx = cur % COLS, cy = (cur - cx) / COLS;
  for (const [dx, dy] of STEPS) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || blocked[ny * COLS + nx]) continue;
    if (dx && dy && (blocked[cy * COLS + nx] || blocked[ny * COLS + cx])) continue;
    visit(ny * COLS + nx, dx && dy ? Math.SQRT2 : 1);
  }
}

// Every walker is always heading for some door, so each door carries a map of the whole town, built once:
// `cost` is the cheapest way from each tile to the door, with grass dearer than road so that walkers keep to
// the roads where they can, and `len` is how long that way is in tiles.
function fieldFrom(door) {
  const cost = new Float32Array(COLS * ROWS).fill(Infinity), len = new Float32Array(COLS * ROWS).fill(Infinity);
  const start = tileOf(door), queue = [start];
  const weight = (i) => (road[i] ? 1 : TUNE.grassCost);
  cost[start] = len[start] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    eachStep(cur, (n, d) => {
      const c = cost[cur] + d * (weight(cur) + weight(n)) / 2;
      if (c >= cost[n] - 1e-3) return;
      cost[n] = c; len[n] = len[cur] + d;
      queue.push(n);
    });
  }
  return { cost, len };
}

// The walk from where `e` stands to a door, as tile centres, found by going downhill on the door's cost map.
function pathTo(e, door) {
  const path = [];
  let cur = tileOf(e);
  if (door.cost[cur] === Infinity) {
    // The player can stand where walkers cannot, such as the river's edge. Start from the nearest tile that can be walked.
    let best = -1, bestD = Infinity;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (door.cost[i] === Infinity) continue;
      const c = tileCentre(i), d = Math.hypot(c.x - e.x, c.y - e.y);
      if (d < bestD) { best = i; bestD = d; }
    }
    if (best < 0) return path;
    path.push(tileCentre(cur = best));
  }
  while (door.cost[cur] > 0) {
    let next = cur;
    eachStep(cur, (n) => { if (door.cost[n] < door.cost[next]) next = n; });
    if (next === cur) break;
    path.push(tileCentre(cur = next));
  }
  return path;
}

function follow(e, speed, dt) {
  let d = speed * dt;
  while (d > 0 && e.path.length) {
    const p = e.path[0], dx = p.x - e.x, dy = p.y - e.y, len = Math.hypot(dx, dy);
    if (len <= d) { e.x = p.x; e.y = p.y; e.path.shift(); d -= len; }
    else { e.x += dx / len * d; e.y += dy / len * d; d = 0; }
  }
  return e.path.length === 0;
}

// Walkers of the same kind never share a map tile, so they travel in single file like a party. One waits
// while the tile it is about to enter is held by another. Two meeting head-on swap tiles, and the drawing
// code keeps each to the right of its route so they pass side by side. Someone standing at a door (knocking,
// inspecting, purging) stays outside it at the road's edge and does not block the road.
function heading(e) {
  const p = e.path && e.path[0];
  if (!p) return null;
  const dx = p.x - e.x, dy = p.y - e.y, len = Math.hypot(dx, dy);
  return len < 0.01 ? null : { x: dx / len, y: dy / len };
}

const walkersOf = (e) => actors.filter((o) => o !== e && o.alive && o.kind === e.kind && !o.inside && o.path.length);

function mustWait(e) {
  if (!e.path.length) return false;
  const here = tileOf(e), want = tileOf(e.path[0]);
  if (want === here) return false;
  const mine = actors.indexOf(e);
  return walkersOf(e).some((o) => {
    const oHere = tileOf(o), oWant = tileOf(o.path[0]);
    if (oHere === want) return oWant !== here;           // held, unless the two are swapping places
    return oWant === want && actors.indexOf(o) < mine;   // both about to enter it: earlier one goes first
  });
}

// Nobody steps out of a building onto a tile another walker is standing on.
const doorBusy = (e) => walkersOf(e).some((o) => tileOf(o) === tileOf(e));

function step(e, speed, dt) {
  if (mustWait(e)) {
    e.waited = (e.waited || 0) + dt;
    if (e.waited < TUNE.maxQueueWait) return false;
  } else {
    e.waited = 0;
  }
  return follow(e, speed, dt);
}

// Walking time along the real route, bridges included. A little is added for waiting in single file.
function travelTime(from, door, speed) {
  const tiles = door.len[tileOf(from)];
  return (tiles < Infinity ? tiles * T * 1.1 : (Math.abs(from.x - door.x) + Math.abs(from.y - door.y)) * 1.15) / speed;
}

function setTarget(e, h) {
  e.target = h; h.claim = e;
  e.path = pathTo(e, h.door);
  e.state = 'go'; e.inside = false; e.den = null;
}
function releaseClaim(e) {
  if (e.target && e.target.claim === e) e.target.claim = null;
  e.target = null;
}
// A house or the crypt holds one vampire at a time. A vampire's den is where it is sleeping or heading to sleep.
const playerIn = (s) => player.state === 'inside' && player.house === s;
const denTaken = (s, e) => actors.some((o) => o !== e && o.alive && o.kind === 'vamp' && o.den === s);
const vampireInside = (s) => actors.some((o) => o.alive && o.kind === 'vamp' && o.inside && o.den === s);
// One caller to a door at a time: the player cannot knock while a vampire is knocking, nor a vampire while the player is.
const vampireKnocking = (h) => actors.some((o) => o.alive && o.kind === 'vamp' && o.state === 'knock' && o.target === h);

function chooseDen(e, avoidCrypt) {
  const reach = (s) => travelTime(e, s.door, TUNE.vampireSpeed);
  const cryptFree = !avoidCrypt && !playerIn(crypt) && !denTaken(crypt, e);
  if (e.home && !playerIn(e.home)) {
    return cryptFree && Math.random() < TUNE.npcCryptChance && reach(crypt) + 4 < timeToDawn() ? crypt : e.home;
  }
  // Home is gone or the player is in it: take the crypt or move into a cursed house nobody lives in.
  const options = houses.filter((h) => h.state === 'cursed' && !h.vampire && !playerIn(h));
  if (cryptFree) options.push(crypt);
  options.sort((a, b) => reach(a) - reach(b));
  return options[0] || null;
}

function goDen(e, den) {
  releaseClaim(e);
  if (den !== crypt && den !== e.home) {
    if (e.home) { e.home.vampire = null; e.home.cursedNights = 0; }
    e.home = den; den.vampire = e;
  }
  e.den = den;
  e.path = pathTo(e, den.door);
  e.state = 'return'; e.inside = false;
}

function goHome(e) {
  if (e.kind === 'vamp') return goDen(e, chooseDen(e) || e.home || crypt);
  releaseClaim(e);
  e.path = pathTo(e, e.home.door);
  e.state = 'return';
}
function arriveHome(e) { e.inside = true; e.state = 'home'; e.sun = 0; }

// ---------- house state changes ----------

function curse(h) {
  h.state = 'cursed'; h.cursedNights = 0; h.wary = false; h.claim = null;
  h.cursedAt = nightNum + clock / cycle();
  if (talk && talk.house === h && !talk.feeding) { talk = null; player.state = 'walk'; flash('Another vampire got in first.'); }
  if (!rally && houses.every((x) => x.isHQ || x.state === 'cursed')) startRally();
}

function spawnVampire(h) {
  const e = { kind: 'vamp', home: h, den: h, x: h.door.x, y: h.door.y, inside: true, state: 'home', alive: true, path: [], target: null, done: false, wait: 1 + Math.random() * 6, sun: 0, timer: 0, hunger: 0, fed: false };
  h.vampire = e; actors.push(e);
  log(`A new vampire rises in ${h.at}.`);
}
// Every hunter lives in the house of worship. A convert appears at the house that was just purged and follows
// the main hunter home.
function spawnHunter(recruitedAt, leader) {
  const home = church();
  const e = { kind: 'hunter', home, x: home.door.x, y: home.door.y, inside: true, state: 'home', alive: true, path: [], target: null, wait: 0, timer: 0, main: !recruitedAt, assigned: null, leader: leader || null, visits: 0 };
  actors.push(e);
  if (!recruitedAt) return;
  e.x = recruitedAt.door.x; e.y = recruitedAt.door.y; e.inside = false;
  e.atDoor = true; // waits by the door until the main hunter has walked on
  goHome(e);
}

function killVampire(e, why) {
  e.alive = false; releaseClaim(e);
  if (e.home) { e.home.vampire = null; e.home.cursedNights = 0; }
  log(`${e.home ? `The vampire from ${e.home.at}` : 'A homeless vampire'} ${why}.`);
}
function killHunter(e) {
  e.alive = false; releaseClaim(e);
  if (e.main) church().hunterTimer = TUNE.hqRespawnDays;
}

function resolvePurge(h, hunter) {
  const resident = h.vampire;
  const vamp = resident && resident.inside && resident.den === h ? resident : null;
  const playerHere = player.state === 'inside' && player.house === h;
  // The main hunter always beats a converted vampire and is the only hunter who can beat the player.
  let hunterWins = true;
  if (playerHere) hunterWins = hunter.main && Math.random() < TUNE.mainHunterBeatsPlayer;
  else if (vamp) hunterWins = hunter.main || Math.random() < TUNE.recruitBeatsVampire;
  if (!hunterWins) {
    killHunter(hunter);
    const who = hunter.main ? 'The main hunter' : 'A hunter';
    log(playerHere ? `${who} broke into ${h.at}. You killed him.` : `${who} died trying to purge ${h.at}.`);
    return;
  }
  if (vamp) { vamp.alive = false; releaseClaim(vamp); }
  else if (resident) resident.home = null;
  h.state = 'clean'; h.vampire = null; h.cursedNights = 0; h.claim = null;
  log(vamp ? `Hunters staked the vampire in ${h.at}.` : `Hunters purged ${h.at}.`);
  // Only the main hunter converts a household, and he does it every time.
  if (hunter.main) { spawnHunter(h, hunter); log(`The main hunter converts ${h.at}. A new hunter joins the house of worship.`); }
  if (playerHere) killPlayer(`The main hunter found you asleep in ${h.at}.`);
}

// ---------- NPC behaviour ----------

function pickVictim(e) {
  const options = houses
    .filter((h) => h.state === 'clean' && !h.wary && !h.claim)
    .filter((h) => travelTime(e, h.door, TUNE.vampireSpeed) + TUNE.npcKnockSeconds + travelTime(h.door, (e.home || crypt).door, TUNE.vampireSpeed) + 5 < timeToDawn())
    .sort((a, b) => travelTime(e, a.door, 1) - travelTime(e, b.door, 1));
  return options.length ? options[rand(Math.min(3, options.length))] : null;
}

function updateVampire(e, dt) {
  const night = isNight();
  if (e.inside) {
    if (!night || e.done) return;
    e.wait -= dt;
    if (e.wait > 0 || doorBusy(e)) return;
    const h = pickVictim(e);
    if (h) return setTarget(e, h);
    e.done = true;
    if (e.den === crypt) { const d = chooseDen(e, true); if (d) goDen(e, d); }
    return;
  }
  if (!night) {
    e.sun += dt;
    if (e.sun > TUNE.sunGraceSeconds) return killVampire(e, 'burned in the sun');
  }
  if (e.state !== 'return' && (!night || timeToDawn() < travelTime(e, (e.home || crypt).door, TUNE.vampireSpeed) + 4)) goHome(e);

  const retarget = () => { releaseClaim(e); const h = pickVictim(e); if (h) setTarget(e, h); else goHome(e); };
  if (e.state === 'go') {
    if (e.target.state !== 'clean' || e.target.wary) return retarget();
    if (!step(e, TUNE.vampireSpeed, dt)) return;
    if (talk && talk.house === e.target) return;   // the player is at this door: wait to see how it goes
    if (e.target.state === 'clean' && !e.target.wary) { e.state = 'knock'; e.timer = TUNE.npcKnockSeconds; }
    else retarget();
  } else if (e.state === 'knock') {
    e.timer -= dt;
    if (e.timer > 0) return;
    const h = e.target;
    if (h.state !== 'clean') return retarget();
    if (Math.random() < TUNE.npcInviteChance) {
      log(`A vampire was invited into ${h.at}.`);
      e.done = true; e.fed = true;
      curse(h);
      if (!e.home) { e.home = h; h.vampire = e; }
      goHome(e);
    } else {
      h.wary = true;
      retarget();
    }
  } else if (e.state === 'return') {
    if (!step(e, TUNE.vampireSpeed, dt)) return;
    if (playerIn(e.den) || denTaken(e.den, e)) {
      // Someone got here first. Try elsewhere, or wait at the door.
      const d = chooseDen(e);
      if (d && d !== e.den) goDen(e, d);
      return;
    }
    arriveHome(e);
    e.done = true; // once in for the day, it stays in until dusk
  }
}

// Hunters do not know where the vampires are. Each dawn every hunter is assigned one house at random, no two
// hunters the same one, with long-cursed houses more likely to be drawn. He walks there, purges it if it turns out to be cursed, and goes home.
function assignHunterVisits() {
  const pool = houses.filter((h) => !h.isHQ);
  // Suspicion grows: every full day a house has been cursed makes it more likely to be picked.
  const weight = (h) => (h.state === 'cursed' ? 1 + TUNE.hunterSuspicionPerDay * (nightNum - Math.floor(h.cursedAt)) : 1);
  for (const e of actors) {
    if (e.kind !== 'hunter') continue;
    e.wait = Math.random() * 4;
    e.assigned = null;
    if (!pool.length) continue;
    let roll = Math.random() * pool.reduce((sum, h) => sum + weight(h), 0);
    let i = 0;
    while (i < pool.length - 1 && (roll -= weight(pool[i])) >= 0) i++;
    e.assigned = pool.splice(i, 1)[0];
  }
}

// Converts are fickle. At the second house a convert visits (TUNE.convertVisitsBeforeRetiring) he moves in for good, whether he found it clean or
// has just purged it, and is out of the game. The main hunter never retires.
function finishVisit(e) {
  e.visits++;
  if (e.main || e.visits < TUNE.convertVisitsBeforeRetiring) return goHome(e);
  e.alive = false;
  log(`A hunter gives up the hunt and settles in ${e.target.at}.`);
}

function updateHunter(e, dt) {
  const day = !isNight();
  if (e.inside) {
    if (!day || !e.assigned || sunTime() < TUNE.hunterWakeDelay + e.wait || doorBusy(e)) return;
    e.target = e.assigned; e.assigned = null;
    e.path = pathTo(e, e.target.door);
    e.state = 'go'; e.inside = false;
    return;
  }
  if (e.state !== 'return' && (!day || timeToDusk() < travelTime(e, e.home.door, TUNE.hunterSpeed) + 2)) goHome(e);

  if (e.state === 'go') {
    if (!step(e, TUNE.hunterSpeed, dt)) return;
    // A cursed house is purged straight away. A clean one gets a look-over before he leaves.
    if (e.target.state === 'cursed') { e.state = 'purge'; e.timer = TUNE.purgeSeconds; }
    else { e.state = 'inspect'; e.timer = TUNE.inspectSeconds; }
  } else if (e.state === 'inspect') {
    e.timer -= dt;
    if (e.timer <= 0) finishVisit(e);
  } else if (e.state === 'purge') {
    e.timer -= dt;
    if (e.timer > 0) return;
    if (e.target.state === 'cursed') resolvePurge(e.target, e);
    if (e.alive) finishVisit(e);
  } else if (e.state === 'return') {
    // A new convert trails a few steps behind the hunter who made him.
    const lead = e.leader;
    if (lead && lead.alive && !lead.inside && Math.hypot(lead.x - e.x, lead.y - e.y) < TUNE.followGap) return;
    e.atDoor = false;
    if (step(e, TUNE.hunterSpeed, dt)) arriveHome(e);
  }
}

// ---------- day/night ----------

function onDusk() {
  nightNum++;
  log(`Night ${nightNum} falls.`);
  if (player.state === 'inside') { player.state = 'walk'; player.house = null; player.feed = 0; }
  deathNotice = null;
  player.knocksTonight = 0;
  for (const h of houses) {
    h.wary = false;
    if (h.state !== 'cursed') continue;
    h.cursedNights++;
    if (!h.vampire && h.cursedNights >= TUNE.nightsToSpawnVampire && !playerIn(h)) spawnVampire(h);
  }
  for (const e of actors) if (e.kind === 'vamp') { e.done = false; e.wait = 1 + Math.random() * 6; e.sun = 0; }
}

function onDawn() {
  log('Dawn. The hunters wake.');
  // Being invited into a house is the only way to feed.
  const starved = (v) => { const fed = v.fed; v.fed = false; v.hunger = fed ? 0 : v.hunger + 1; return v.hunger >= TUNE.nightsToStarve; };
  for (const e of actors) if (e.kind === 'vamp' && e.alive && starved(e)) killVampire(e, 'starved');
  if (starved(player)) killPlayer(`You starved after ${TUNE.nightsToStarve} nights without feeding.`);
  assignHunterVisits();
  if (!actors.some((e) => e.main && e.alive) && --church().hunterTimer <= 0) { spawnHunter(); log('A new main hunter takes up arms at the house of worship.'); }
}

// ---------- player ----------

function nearDoor() {
  return houses.find((h) => Math.hypot(player.x - h.door.x, player.y - h.door.y) < 28) || null;
}

const nearCrypt = () => Math.hypot(player.x - crypt.door.x, player.y - crypt.door.y) < 28;

function enterHouse(h) {
  player.state = 'inside'; player.house = h; player.sun = 0;
  player.x = h.door.x; player.y = h.door.y;
}

function interact(walkedIn) {
  if (rally) return;
  const p = player;
  if (p.state === 'inside') {
    if (walkedIn) return;
    if (p.feed > 0) return;
    if (!isNight()) return flash('The sun is up. You stay inside until dusk.');
    p.state = 'walk'; p.house = null;
    return;
  }
  if (p.state !== 'walk') return;
  if (nearCrypt()) return denTaken(crypt) ? flash('Another vampire has claimed the crypt.') : enterHouse(crypt);
  const h = nearDoor();
  if (!h) return;
  if (h.state === 'cursed') return vampireInside(h) ? flash('A vampire is already inside. One to a house.') : enterHouse(h);
  if (h.state === 'hunter') return flash('The house of worship. You cannot enter.');
  if (h.wary) return flash('They will not open the door again tonight.');
  if (!isNight()) return flash('The sun is up. Find shelter.');
  if (vampireKnocking(h)) return flash('Another vampire is already at this door.');
  startTalk(h);
}

// The invitation plays itself out in a modal, one line at a time: knock, the resident's question, the vampire's
// answer, then a refusal or an invitation. Nothing is chosen: the outcome is a coin toss decided at the knock.
// On an invitation the modal turns red and stays up while the player feeds.
const REFUSALS = ['The door slams. You hear the bolt.', '"Not tonight. Be on your way."', 'A long silence. Then the light inside goes out.', '"I think not." The shutter closes.'];
const INVITATIONS = ['"Come in, then. Come in."', '"You had better come in out of the dark."', 'The chain slides back. "Come in."', '"Well. Come in and sit down."'];

function startTalk(h) {
  const call = CALLS[rand(CALLS.length)];
  const won = Math.random() < (player.knocksTonight === 0 ? TUNE.firstKnockInviteChance : TUNE.playerInviteChance);
  player.knocksTonight++;
  talk = {
    house: h, t: 0, won, feeding: false,
    q: call[0], a: call[1][rand(call[1].length)],
    outcome: (won ? INVITATIONS : REFUSALS)[rand(4)],
  };
  player.state = 'talk';
}

function updateTalk(dt) {
  if (!talk || talk.feeding) return;
  talk.t += dt;
  if (talk.t < TUNE.talkBeatSeconds * 4.2) return;
  const h = talk.house;
  if (!talk.won) {
    h.wary = true; stats.slammed++;
    log(`${h.name} turned you away.`);
    talk = null; player.state = 'walk';
    return;
  }
  stats.invited++;
  player.fed = true;
  log(`You were invited into ${h.at}. It is cursed.`);
  talk.feeding = true;
  enterHouse(h);
  player.feed = TUNE.feedSeconds;
  curse(h);
}

// With every door shut for the night there is nothing left to do, so the player walks to the nearest free
// shelter unaided. Once inside, the clock runs fast until dawn (see autoSkip).
const anyDoorOpen = () => houses.some((h) => h.state === 'clean' && !h.wary);
const shelterFree = (s) => (s === crypt ? !denTaken(crypt) : s.state === 'cursed' && !vampireInside(s));

function seekShelter() {
  const p = player;
  const options = [crypt, ...houses].filter(shelterFree);
  if (!options.length) return;
  const dist = (s) => travelTime(p, s.door, 1);
  p.autoDen = options.reduce((best, s) => (dist(s) < dist(best) ? s : best));
  p.path = pathTo(p, p.autoDen.door);
  p.state = 'auto';
  flash('Every door is shut to you tonight. You return to shelter.', 4000);
}

// The clock runs fast through dead time: a night with no door left to knock on, and a day after the hunters
// have finished their visits (the walk home counts as finished).
const huntersDone = () => actors.every((e) => e.kind !== 'hunter' || e.state === 'return' || (e.inside && !e.assigned));
function autoSkip() {
  if (rally || talk) return false;
  if (isNight()) return !anyDoorOpen() && (player.state === 'inside' || player.state === 'auto');
  return player.state === 'inside' && huntersDone();
}

// Clock multiplier for this frame: the held key, or the automatic skip, which is gentler while anyone is
// still walking home.
function timeScale() {
  if (keys.has('Space') && !talk) return TUNE.fastForward;
  if (!autoSkip()) return 1;
  const walking = player.state !== 'inside' || actors.some((e) => !e.inside);
  return walking ? TUNE.returnFastForward : TUNE.fastForward;
}

function updatePlayer(dt) {
  const p = player;
  if (p.state === 'inside') {
    if (p.feed <= 0) return;
    p.feed -= dt;
    if (p.feed > 0) return;
    p.feed = 0; talk = null;
    // Fed: step back out, unless the sun is about to rise.
    if (!isNight() || !anyDoorOpen()) return;
    if (timeToDawn() > TUNE.dawnWarningSeconds) { p.state = 'walk'; p.house = null; }
    else flash('Dawn is close. You stay inside.');
    return;
  }
  if (p.state === 'walk') {
    // Keys follow the view: up walks away from the camera, right walks to the right of the screen.
    const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const iy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    const c = Math.cos(viewYaw), s = Math.sin(viewYaw), dx = ix * c + iy * s, dy = -ix * s + iy * c;
    if (dx || dy) {
      const step = TUNE.playerSpeed * dt / Math.hypot(dx, dy);
      if (canStand(p.x + dx * step, p.y)) p.x += dx * step;
      if (canStand(p.x, p.y + dy * step)) p.y += dy * step;
    }
  }
  if (p.state === 'walk' && isNight() && !anyDoorOpen()) seekShelter();
  if (p.state === 'auto' && follow(p, TUNE.playerSpeed, dt)) {
    if (shelterFree(p.autoDen)) enterHouse(p.autoDen); else p.state = 'walk';
  }
  if (!isNight()) {
    p.sun += dt;
    if (p.sun >= TUNE.sunGraceSeconds) killPlayer('The sun caught you in the open.');
  } else {
    p.sun = Math.max(0, p.sun - dt * 2);
  }
}

// Death is final only when no cursed house is left. Otherwise the player rises in the house that has been
// cursed longest: as the vampire it was due to raise, or by taking over the NPC vampire that lives there.
function killPlayer(text) {
  const cursed = houses.filter((h) => h.state === 'cursed');
  if (!cursed.length) return endGame(false, text);
  const h = cursed.reduce((oldest, x) => (x.cursedAt < oldest.cursedAt ? x : oldest));
  const npc = h.vampire && h.vampire.inside ? h.vampire : null;
  let den = h;
  if (npc) { den = npc.den; npc.alive = false; releaseClaim(npc); h.vampire = null; }
  if (!h.vampire) h.cursedNights = 0;
  talk = null; stats.deaths++;
  enterHouse(den);
  player.feed = 0; player.hunger = 0; player.fed = false; player.sun = 0;
  const where = den === crypt ? 'the crypt' : den.at;
  log(`${text} You live on in ${where}.`);
  deathNotice = { text: 'You have been destroyed, but your hunger goes on in another...', where, at: performance.now() };
}

// The endgame runs itself. With every house cursed the clock stops, and every vampire, the player included,
// walks to the house of worship and goes in. When the last one is inside, the hunters are dead.
function startRally() {
  rally = { broke: false, t: 0 };
  log('Every house is cursed. The vampires swarm the house of worship.');
  const door = church().door;
  for (const e of actors) {
    if (e.kind !== 'vamp') continue;
    releaseClaim(e);
    e.inside = false; e.den = null; e.state = 'rally';
    e.path = pathTo(e, door);
  }
  talk = null;
  player.state = 'rally'; player.house = null; player.feed = 0;
  player.path = pathTo(player, door);
}

function updateRally(dt) {
  if (rally.broke) {
    if ((rally.t -= dt) <= 0) endGame(true, 'The vampires broke into the house of worship. The main hunter is vanquished.');
    return;
  }
  let outside = 0;
  for (const e of actors) {
    if (e.kind !== 'vamp' || e.inside) continue;
    if (step(e, TUNE.vampireSpeed, dt)) e.inside = true; else outside++;
  }
  if (player.state === 'rally') {
    if (follow(player, TUNE.playerSpeed, dt)) { player.state = 'inside'; player.house = church(); } else outside++;
  }
  if (outside) return;
  rally.broke = true; rally.t = 2.5;
  actors = actors.filter((e) => e.kind !== 'hunter');
  church().state = 'cursed';
  log('The vampires break into the house of worship. The hunters are dead.');
}

function endGame(won, text) {
  if (mode !== 'play') return;
  mode = 'over'; talk = null;
  endText = { won, text };
}

function update(dt) {
  if (rally) return updateRally(dt);
  const wasNight = isNight();
  clock += dt;
  if (clock >= cycle()) { clock -= cycle(); onDusk(); }
  else if (wasNight && !isNight()) onDawn();
  updatePlayer(dt);
  updateTalk(dt);
  for (const e of actors) {
    if (!e.alive || mode !== 'play') continue;
    if (e.kind === 'vamp') updateVampire(e, dt); else updateHunter(e, dt);
  }
  actors = actors.filter((e) => e.alive);
}


// The view keeps the player in the middle and stops at the edges of the map.
// While the player is shut indoors the view drifts to whoever is doing something: a hunter or vampire at a
// door first, then the main hunter, then anyone else on the move. It stays with one walker until he goes in,
// unless someone else reaches a door. For the final swarm it settles on the house of worship.
function cameraSubject() {
  if (rally) return church().door;
  if (player.state !== 'inside' || player.feed > 0) return player;
  const drama = (e) => (e.state === 'purge' || e.state === 'knock' ? 3 : e.state === 'inspect' ? 2 : e.main ? 1.5 : 1);
  const out = actors.filter((e) => e.alive && !e.inside);
  const best = out.reduce((a, b) => (a && drama(a) >= drama(b) ? a : b), null);
  const held = out.includes(cam.focus) ? cam.focus : null;
  cam.focus = held && (drama(held) >= 2 || drama(best) < 2) ? held : best;
  return cam.focus || player;
}

// What the player can do at the door they are standing at. Shown in the footer, never on the map.
function doorPrompt() {
  if (player.state !== 'walk') return '';
  if (nearCrypt()) return denTaken(crypt) ? 'The crypt is taken.' : 'The crypt.  [E] enter';
  const h = nearDoor();
  if (!h) return '';
  if (h.state === 'cursed') return vampireInside(h) ? `${h.name}. A vampire is inside.` : `${h.name}.  [E] enter`;
  if (h.state === 'hunter') return 'The house of worship.';
  if (h.wary) return `${h.name}. Wary until tomorrow night.`;
  if (vampireKnocking(h)) return `${h.name}. Another vampire is at the door.`;
  return isNight() ? `${h.name}.  [E] knock` : h.name + '.';
}
