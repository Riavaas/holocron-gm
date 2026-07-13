const canvas = document.querySelector("#map-canvas");
const ctx = canvas.getContext("2d");
const shell = document.querySelector("#map-shell");
const emptyState = document.querySelector("#map-empty");
const measurementLabel = document.querySelector("#measurement");
const isPlayerView = window.location.pathname === "/player";
let activeCampaignId = localStorage.getItem("holocron.activeCampaign");
let activeCampaignName = "Default Campaign";
let campaignSaveTimer;
let sharedCharacters = [];
let playerCharacters = [];
let selectedPlayerId = localStorage.getItem("holocron.playerCharacter");
let playerJoined = false;

const defaults = {
  gridSize: 64,
  unitValue: 5,
  unitName: "ft",
  travelSpeed: 0,
  ambientDarkness: 85,
  visionType: "normal",
  visionRange: 6,
  zoom: 1,
  offset: { x: 0, y: 0 },
  mapLocked: false,
  mapFitMode: "fit",
  mapFocus: false,
  tool: "select",
  snapToGrid: true,
  layers: { background: true, objects: true, tokens: true, grid: true, lighting: false, fog: false },
  tokens: [],
  walls: [],
  pings: [],
  notePins: [],
  doors: [],
  explored: [],
  combatants: [],
  activeTurn: 0,
  selectedCombatantId: null,
  combatLog: [],
  round: 1,
  panelLayout: {
    mode: "anchored",
    hidden: [],
    panels: {
      left: { anchor: "left", x: 12, y: 12, width: 280, height: 720 },
      right: { anchor: "right", x: 0, y: 12, width: 340, height: 720 },
    },
  },
  soundPlaylist: [],
  activeTrackId: null,
  quests: [],
  activeQuestId: null,
  assetLibraryView: "normal",
  assetLibraryPosition: null,
};

const saved = JSON.parse(localStorage.getItem("holocron.session") || "null");
const state = { ...defaults, ...saved, layers: { ...defaults.layers, ...(saved?.layers || {}) } };
state.image = null;
state.imageUrl = null;
state.pointer = null;
state.measurement = null;
state.draggedToken = null;
state.creatureCache = [];
state.pendingNotePin = null;
state.panStart = null;
state.assetFilterMode = null;
state.imageBookFilters = null;
  state.panelLayout = {
  ...defaults.panelLayout,
  ...(state.panelLayout || {}),
  hidden: Array.isArray(state.panelLayout?.hidden) ? state.panelLayout.hidden : [],
  panels: {
    ...defaults.panelLayout.panels,
    ...(state.panelLayout?.panels || {}),
  },
};

if (isPlayerView) document.body.classList.add("player-mode");

const tokenPresets = [
  { name: "Sith Trooper", type: "enemy", hp: 18, ac: 14 },
  { name: "Mercenary", type: "enemy", hp: 24, ac: 15 },
  { name: "Combat Droid", type: "enemy", hp: 32, ac: 16 },
  { name: "Jedi Ally", type: "ally", hp: 38, ac: 17 },
  { name: "Player", type: "player", hp: 40, ac: 16 },
  { name: "Civilian", type: "ally", hp: 8, ac: 10 },
];

const conditionRules = {
  blinded: { color: "#757575", rule: "Cannot see; attacks have disadvantage and incoming attacks have advantage." },
  frightened: { color: "#6d4c41", rule: "Disadvantage on checks and attacks while the source of fear is visible." },
  grappled: { color: "#9e9d24", rule: "Speed becomes 0." },
  incapacitated: { color: "#c40f0f", rule: "Cannot take actions or reactions." },
  poisoned: { color: "#558b2f", rule: "Disadvantage on attack rolls and ability checks." },
  prone: { color: "#795548", rule: "Crawl movement; attacks affected by attacker distance." },
  restrained: { color: "#827717", rule: "Speed 0; attacks have disadvantage; incoming attacks have advantage." },
  shocked: { color: "#0d99cc", rule: "Cannot take reactions; limited action economy." },
  slowed: { color: "#607d8b", rule: "Movement and action economy are reduced." },
  stunned: { color: "#d32f2f", rule: "Incapacitated, cannot move, automatically fails STR and DEX saves." },
  unconscious: { color: "#424242", rule: "Incapacitated, prone, cannot move or speak, unaware." },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

const tokenImageCache = new Map();

function imageUrlFor(item) {
  return item?.imageUrl || item?.matched_token?.url || item?.primary_image?.url || item?.url || "";
}

function tokenMarkup(item, className) {
  const url = imageUrlFor(item);
  const type = escapeHtml(item?.type || "");
  if (url) {
    return `<span class="${className} ${type} has-image"><img src="${escapeHtml(url)}" alt=""></span>`;
  }
  return `<span class="${className} ${type}">${initials(item?.name || "?")}</span>`;
}

function sessionSnapshot() {
  const clean = { ...state };
  delete clean.image;
  delete clean.imageUrl;
  delete clean.pointer;
  delete clean.measurement;
  delete clean.draggedToken;
  delete clean.creatureCache;
  delete clean.pendingNotePin;
  delete clean.panStart;
  delete clean.assetFilterMode;
  delete clean.imageBookFilters;
  return clean;
}

function publishLiveSession(clean = sessionSnapshot()) {
  if (isPlayerView) return;
  const publicMap = {
    ...clean,
    notePins: [],
    combatLog: [],
    selectedCombatantId: null,
    combatants: clean.combatants.map((combatant) => ({
      id: combatant.id,
      characterId: combatant.characterId || null,
      name: combatant.name,
      type: combatant.type,
      conditions: combatant.conditions || [],
    })),
  };
  fetch("/api/session/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: {
        campaignId: activeCampaignId,
        map: publicMap,
        characters: sharedCharacters,
      },
    }),
  }).catch(() => {});
}

function persist() {
  const clean = sessionSnapshot();
  localStorage.setItem("holocron.session", JSON.stringify(clean));
  publishLiveSession(clean);
  scheduleCampaignSave();
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = shell.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (state.image && ["fit", "fill", "center"].includes(state.mapFitMode)) applyMapFitMode(state.mapFitMode, false);
  draw();
}

function worldPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.offset.x) / state.zoom,
    y: (event.clientY - rect.top - state.offset.y) / state.zoom,
  };
}

function screenPoint(point) {
  return {
    x: point.x * state.zoom + state.offset.x,
    y: point.y * state.zoom + state.offset.y,
  };
}

function drawBackdrop(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#11171b");
  gradient.addColorStop(1, "#080b0e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(175, 198, 214, .08)";
  for (let x = 0; x < width; x += 240) {
    ctx.fillRect(x, 0, 1, height);
  }
}

function drawGrid(width, height) {
  const size = state.gridSize * state.zoom;
  if (size < 5) return;
  const startX = ((state.offset.x % size) + size) % size;
  const startY = ((state.offset.y % size) + size) % size;
  ctx.beginPath();
  for (let x = startX; x < width; x += size) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = startY; y < height; y += size) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.strokeStyle = "rgba(164, 190, 193, .25)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function tokenColor(type) {
  if (type === "enemy") return "#c40f0f";
  if (type === "player") return "#0d99cc";
  if (type === "asset") return "#9e9e9e";
  return "#757575";
}

function snapPoint(point, options = {}) {
  if (options.free || !state.snapToGrid) return { x: point.x, y: point.y };
  return {
    x: Math.round(point.x / state.gridSize) * state.gridSize + state.gridSize / 2,
    y: Math.round(point.y / state.gridSize) * state.gridSize + state.gridSize / 2,
  };
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function loadTokenImage(url) {
  if (!url) return null;
  if (tokenImageCache.has(url)) return tokenImageCache.get(url);
  const image = new Image();
  image.onload = draw;
  image.src = url;
  tokenImageCache.set(url, image);
  return image;
}

function drawToken(token) {
  if (isPlayerView && !tokenVisibleToPlayer(token)) return;
  const point = screenPoint(token);
  const radius = Math.max(13, state.gridSize * state.zoom * .38);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  const portrait = loadTokenImage(token.imageUrl);
  if (portrait?.complete && portrait.naturalWidth) {
    ctx.save();
    ctx.clip();
    const side = Math.min(portrait.naturalWidth, portrait.naturalHeight);
    const sx = (portrait.naturalWidth - side) / 2;
    const sy = (portrait.naturalHeight - side) / 2;
    ctx.drawImage(portrait, sx, sy, side, side, point.x - radius, point.y - radius, radius * 2, radius * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = tokenColor(token.type);
    ctx.fill();
  }
  ctx.strokeStyle = token.selected ? "#fff" : "#b8c0c7";
  ctx.lineWidth = token.selected ? 3 : 1.5;
  ctx.stroke();
  const combatant = state.combatants.find((item) => item.id === token.combatantId);
  const conditions = combatant?.conditions || [];
  conditions.slice(0, 3).forEach((condition, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + 4 + index * 4, 0, Math.PI * 2);
    ctx.strokeStyle = conditionRules[condition]?.color || "#fff";
    ctx.lineWidth = 3;
    ctx.stroke();
  });
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${Math.max(9, radius * .55)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (!portrait?.complete || !portrait.naturalWidth) ctx.fillText(initials(token.name), point.x, point.y);
}

function playerVisionToken() {
  const player = playerCharacters.find((character) => character.id === selectedPlayerId);
  if (!player) return null;
  return state.tokens.find((token) => token.characterId === player.id)
    || state.tokens.find((token) => token.name.toLowerCase() === player.name.toLowerCase())
    || null;
}

function tokenVisibleToPlayer(token) {
  const origin = playerVisionToken();
  if (!origin) return false;
  if (token === origin) return true;
  const distance = Math.hypot(token.x - origin.x, token.y - origin.y);
  if (distance < 0.0001) return true;
  if (distance > state.visionRange * state.gridSize) return false;
  const direction = { x: (token.x - origin.x) / distance, y: (token.y - origin.y) / distance };
  return ![...state.walls, ...state.doors.filter((door) => !door.open)].some((wall) => {
    const hit = rayWallIntersection(origin, direction, wall);
    return hit !== null && hit < distance;
  });
}

function drawWalls() {
  ctx.strokeStyle = "#f0a34a";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  for (const wall of state.walls) {
    const a = screenPoint(wall.start);
    const b = screenPoint(wall.end);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawDoors() {
  for (const door of state.doors) {
    const a = screenPoint(door.start);
    const b = screenPoint(door.end);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = door.open ? "#0d99cc" : "#9e9d24";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = "#0b0d10";
    ctx.beginPath();
    ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPersistentFog(width, height) {
  if (!state.layers.fog) return;
  const playerOrigin = isPlayerView ? playerVisionToken() : null;
  if (isPlayerView && !playerOrigin) return;
  const ratio = window.devicePixelRatio || 1;
  const fog = document.createElement("canvas");
  fog.width = width * ratio;
  fog.height = height * ratio;
  const fogCtx = fog.getContext("2d");
  fogCtx.scale(ratio, ratio);
  fogCtx.fillStyle = "rgba(0, 2, 5, .92)";
  fogCtx.fillRect(0, 0, width, height);
  fogCtx.globalCompositeOperation = "destination-out";
  const visiblePoints = isPlayerView ? [playerOrigin] : state.explored;
  for (const point of visiblePoints) {
    const screen = screenPoint(point);
    fogCtx.beginPath();
    fogCtx.arc(screen.x, screen.y, state.visionRange * state.gridSize * state.zoom, 0, Math.PI * 2);
    fogCtx.fill();
  }
  ctx.drawImage(fog, 0, 0, width, height);
}

function rayWallIntersection(origin, direction, wall) {
  const segment = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y };
  const denominator = direction.x * segment.y - direction.y * segment.x;
  if (Math.abs(denominator) < .00001) return null;
  const delta = { x: wall.start.x - origin.x, y: wall.start.y - origin.y };
  const rayDistance = (delta.x * segment.y - delta.y * segment.x) / denominator;
  const segmentPosition = (delta.x * direction.y - delta.y * direction.x) / denominator;
  if (rayDistance < 0 || segmentPosition < 0 || segmentPosition > 1) return null;
  return rayDistance;
}

function visibilityPolygon(origin, radius) {
  const points = [];
  const rayCount = 180;
  for (let index = 0; index < rayCount; index++) {
    const angle = index / rayCount * Math.PI * 2;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    let distance = radius;
    for (const wall of [...state.walls, ...state.doors.filter((door) => !door.open)]) {
      const hit = rayWallIntersection(origin, direction, wall);
      if (hit !== null) distance = Math.min(distance, hit);
    }
    points.push(screenPoint({
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
    }));
  }
  return points;
}

function drawLighting(width, height) {
  if (!state.layers.lighting) return;
  const opacity = Math.max(0, Math.min(1, state.ambientDarkness / 100));
  const visionToken = isPlayerView
    ? playerVisionToken()
    : state.tokens.find((token) => token.selected)
      || state.tokens.find((token) => token.combatantId === state.selectedCombatantId);
  if (isPlayerView && !visionToken) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  if (visionToken) {
    const range = state.visionType === "blinded" ? state.gridSize * .5 : state.visionRange * state.gridSize;
    const polygon = visibilityPolygon(visionToken, range);
    if (polygon.length) {
      ctx.moveTo(polygon[0].x, polygon[0].y);
      polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
    }
  }
  const darknessColor = state.visionType === "darkvision" ? "29, 38, 45" : "0, 2, 5";
  ctx.fillStyle = `rgba(${darknessColor}, ${opacity})`;
  ctx.fill("evenodd");
  if (visionToken && state.visionType === "thermal") {
    const center = screenPoint(visionToken);
    ctx.beginPath();
    ctx.arc(center.x, center.y, state.visionRange * state.gridSize * state.zoom, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180, 55, 45, .08)";
    ctx.fill();
  }
  ctx.restore();
}

function drawMeasurement() {
  if (!state.measurement) return;
  const start = screenPoint(state.measurement.start);
  const end = screenPoint(state.measurement.end);
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = "#c40f0f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#c40f0f";
  for (const point of [start, end]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const result = measurementResult();
  measurementLabel.hidden = false;
  measurementLabel.textContent = result;
  measurementLabel.style.left = `${Math.min(end.x + 10, shell.clientWidth - 150)}px`;
  measurementLabel.style.top = `${Math.min(end.y + 10, shell.clientHeight - 40)}px`;
}

function drawPings() {
  const now = Date.now();
  state.pings = state.pings.filter((ping) => now - ping.created < 1500);
  for (const ping of state.pings) {
    const point = screenPoint(ping);
    const progress = (now - ping.created) / 1500;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 12 + progress * 35, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(196, 15, 15, ${1 - progress})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (state.pings.length) requestAnimationFrame(draw);
}

function drawNotePins() {
  for (const pin of state.notePins) {
    const point = screenPoint(pin);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#1e1e1e";
    ctx.strokeStyle = "#afc6d6";
    ctx.lineWidth = 2;
    ctx.fillRect(-8, -8, 16, 16);
    ctx.strokeRect(-8, -8, 16, 16);
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.font = "700 9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", point.x, point.y);
  }
}

function updateMapEmptyState() {
  emptyState.hidden = Boolean(
    state.image
    || state.tokens.length
    || state.walls.length
    || state.doors.length
    || state.notePins.length
    || state.pings.length,
  );
}

function draw() {
  const width = shell.clientWidth;
  const height = shell.clientHeight;
  ctx.clearRect(0, 0, width, height);
  updateMapEmptyState();
  drawBackdrop(width, height);
  if (state.image && state.layers.background) {
    ctx.save();
    ctx.translate(state.offset.x, state.offset.y);
    ctx.scale(state.zoom, state.zoom);
    ctx.drawImage(state.image, 0, 0);
    ctx.restore();
  }
  if (state.layers.grid) drawGrid(width, height);
  drawPersistentFog(width, height);
  drawLighting(width, height);
  if (state.layers.objects) {
    drawDoors();
    drawPings();
    if (!isPlayerView) {
      drawWalls();
      drawNotePins();
    }
  }
  if (state.layers.tokens) state.tokens.forEach(drawToken);
  drawMeasurement();
}

function measurementResult() {
  const { start, end } = state.measurement;
  const pixels = Math.hypot(end.x - start.x, end.y - start.y);
  const squares = pixels / state.gridSize;
  const distance = squares * state.unitValue;
  let text = `${distance.toFixed(distance < 10 ? 1 : 0)} ${state.unitName} · ${squares.toFixed(1)} sq`;
  if (state.travelSpeed > 0) {
    let miles = distance;
    if (state.unitName === "ft") miles /= 5280;
    if (state.unitName === "m") miles /= 1609.344;
    if (state.unitName === "km") miles /= 1.609344;
    const hours = miles / state.travelSpeed;
    const minutes = hours * 60;
    text += minutes < 120 ? ` · ${Math.max(1, Math.round(minutes))} min` : ` · ${hours.toFixed(1)} hr`;
  }
  return text;
}

function loadMap(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    state.image = image;
    fitMapImage(image);
    emptyState.hidden = true;
    draw();
  };
  image.src = state.imageUrl;
  if (activeCampaignId) {
    fetch(`/api/campaigns/${activeCampaignId}/map`, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    }).then((response) => response.json()).then((payload) => {
      state.mapImageUrl = `${payload.url}?v=${Date.now()}`;
      persist();
    }).catch(() => {});
  }
}

function fitMapImage(image) {
  const fit = Math.min(shell.clientWidth / image.width, shell.clientHeight / image.height);
  state.zoom = Math.min(1, fit);
  state.offset = {
    x: (shell.clientWidth - image.width * state.zoom) / 2,
    y: (shell.clientHeight - image.height * state.zoom) / 2,
  };
  state.mapFitMode = "fit";
  updateZoom();
}

function fillMapImage(image = state.image) {
  if (!image) return;
  const fill = Math.max(shell.clientWidth / image.width, shell.clientHeight / image.height);
  state.zoom = Math.min(3, Math.max(.25, fill));
  state.offset = {
    x: (shell.clientWidth - image.width * state.zoom) / 2,
    y: (shell.clientHeight - image.height * state.zoom) / 2,
  };
  state.mapFitMode = "fill";
  updateZoom();
}

function centerMapImage(image = state.image) {
  if (!image) return;
  state.zoom = 1;
  state.offset = {
    x: (shell.clientWidth - image.width) / 2,
    y: (shell.clientHeight - image.height) / 2,
  };
  state.mapFitMode = "center";
  updateZoom();
}

function applyMapFitMode(mode, updateControls = true) {
  if (!state.image) return;
  if (mode === "fit") fitMapImage(state.image);
  if (mode === "fill") fillMapImage(state.image);
  if (mode === "center") centerMapImage(state.image);
  if (updateControls) syncMapActionControls();
}

function loadMapFromUrl(url, options = {}) {
  if (!url || state.imageUrl === url) return;
  const image = new Image();
  image.onload = () => {
    state.image = image;
    state.imageUrl = url;
    if (options.fit) fitMapImage(image);
    else if (["fit", "fill", "center"].includes(state.mapFitMode)) applyMapFitMode(state.mapFitMode, false);
    syncMapActionControls();
    emptyState.hidden = true;
    draw();
  };
  image.src = url;
}

function combatActionProfile(name, cr = 1) {
  const normalized = name.toLowerCase();
  const bonus = 3 + Math.ceil(cr / 2);
  const baseDamage = `${Math.max(1, Math.ceil(cr / 3))}d8+${Math.max(1, Math.ceil(cr / 2))}`;
  if (normalized.includes("multiattack")) return { name, kind: "attack", attacks: 2, bonus, damage: baseDamage };
  if (normalized.includes("grenade") || normalized.includes("explosive")) return { name, kind: "save", save: "DEX", dc: 11 + Math.ceil(cr / 2), damage: `${Math.max(2, Math.ceil(cr / 2))}d6+1`, half: true };
  if (normalized.includes("stinger") || normalized.includes("poison")) return { name, kind: "attack", attacks: 1, bonus, damage: baseDamage, condition: "poisoned" };
  if (normalized.includes("claw") || normalized.includes("slam")) return { name, kind: "attack", attacks: normalized.includes("claw") ? 2 : 1, bonus, damage: `${Math.max(1, Math.ceil(cr / 4))}d6+${Math.max(1, Math.ceil(cr / 2))}` };
  if (normalized.includes("bite")) return { name, kind: "attack", attacks: 1, bonus, damage: baseDamage, condition: "prone" };
  if (normalized.includes("blaster") || normalized.includes("rifle") || normalized.includes("pistol")) return { name, kind: "attack", attacks: 1, bonus: bonus + 1, damage: `${Math.max(1, Math.ceil(cr / 3))}d8+${Math.max(2, Math.ceil(cr / 2))}` };
  if (normalized.includes("force") || normalized.includes("tech") || normalized.includes("breath")) return { name, kind: "save", save: "WIS", dc: 11 + Math.ceil(cr / 2), damage: baseDamage, half: false };
  return { name, kind: "attack", attacks: 1, bonus, damage: baseDamage };
}

function addCombatant(source, point = null) {
  const cr = Number(source.cr) || 1;
  const actionNames = source.actions?.length ? source.actions.slice(0, 8) : ["Attack"];
  const defenses = {
    vulnerabilities: source.damage_vulnerabilities || source.stat_block?.damage_vulnerabilities || [],
    resistances: source.damage_resistances || source.stat_block?.damage_resistances || [],
    immunities: source.damage_immunities || source.stat_block?.damage_immunities || [],
    conditionImmunities: source.condition_immunities || source.stat_block?.condition_immunities || [],
  };
  const combatant = {
    id: crypto.randomUUID(),
    name: source.name,
    type: source.type || "enemy",
    sourceSlug: source.slug || null,
    hp: Number(source.hp || 10),
    maxHp: Number(source.hp || 10),
    ac: Number(source.ac || 12),
    initiative: Math.floor(Math.random() * 20) + 1,
    conditions: [],
    actions: actionNames,
    actionProfiles: actionNames.map((name) => combatActionProfile(name, cr)),
    attackBonus: 3 + Math.ceil(cr / 2),
    saveDc: 10 + Math.ceil(cr / 2),
    damage: `${Math.max(1, Math.ceil(cr / 3))}d8+${Math.max(1, Math.ceil(cr / 2))}`,
    imageUrl: imageUrlFor(source),
    matchedToken: source.matched_token || null,
    assetMatch: source.asset_match || null,
    statBlock: source.stat_block || null,
    traits: source.traits || source.stat_block?.traits || [],
    reactions: source.reactions || source.stat_block?.reactions || [],
    legendaryActions: source.legendary_actions || source.stat_block?.legendary_actions || [],
    senses: source.senses || source.stat_block?.senses || [],
    languages: source.languages || source.stat_block?.languages || [],
    defenses,
  };
  state.combatants.push(combatant);
  state.selectedCombatantId = combatant.id;
  if (point) state.tokens.push({
    ...snapPoint(point),
    combatantId: combatant.id,
    characterId: source.characterId || null,
    name: combatant.name,
    type: combatant.type,
    imageUrl: combatant.imageUrl,
    selected: true,
  });
  state.tokens.forEach((token) => {
    if (token.combatantId !== combatant.id) token.selected = false;
  });
  persist();
  renderInitiative();
  draw();
}

function panelElement(panelId) {
  return document.querySelector(panelId === "left" ? ".left-panel" : ".right-panel");
}

function panelLayout(panelId) {
  state.panelLayout.panels[panelId] ||= { ...defaults.panelLayout.panels[panelId] };
  return state.panelLayout.panels[panelId];
}

function clampPanel(panel, rect) {
  const width = Number(panel.width || 300);
  const height = Math.min(Number(panel.height || 620), Math.max(260, rect.height - 24));
  panel.width = Math.max(240, Math.min(width, rect.width - 24));
  panel.height = Math.max(260, height);
  panel.x = Math.max(8, Math.min(Number(panel.x || 8), rect.width - panel.width - 8));
  panel.y = Math.max(8, Math.min(Number(panel.y || 8), rect.height - panel.height - 8));
}

function placeAnchoredPanel(panelId, panel, rect) {
  if (panel.anchor === "left") {
    panel.x = 12;
    panel.y = 12;
    panel.height = rect.height - 24;
  } else if (panel.anchor === "right") {
    panel.width ||= panelId === "left" ? 280 : 330;
    panel.x = rect.width - panel.width - 12;
    panel.y = 12;
    panel.height = rect.height - 24;
  } else if (panel.anchor === "bottom") {
    panel.width ||= Math.min(rect.width - 24, panelId === "left" ? 420 : 520);
    panel.x = panelId === "left" ? 12 : rect.width - panel.width - 12;
    panel.y = rect.height - panel.height - 12;
  }
}

function anchorPanel(panelId, anchor) {
  const workspace = document.querySelector("#battlemap-view");
  const rect = workspace.getBoundingClientRect();
  const panel = panelLayout(panelId);
  panel.anchor = anchor;
  if (anchor === "left") {
    panel.width = panelId === "left" ? 280 : 330;
    panel.height = rect.height - 24;
    panel.x = 12;
    panel.y = 12;
  } else if (anchor === "right") {
    panel.width = panelId === "left" ? 280 : 330;
    panel.height = rect.height - 24;
    panel.x = rect.width - panel.width - 12;
    panel.y = 12;
  } else if (anchor === "bottom") {
    panel.width = Math.min(rect.width - 24, panelId === "left" ? 420 : 520);
    panel.height = Math.min(360, rect.height - 24);
    panel.x = panelId === "left" ? 12 : rect.width - panel.width - 12;
    panel.y = rect.height - panel.height - 12;
  }
  clampPanel(panel, rect);
  applyPanelLayout();
  persist();
}

function applyPanelLayout() {
  const workspace = document.querySelector("#battlemap-view");
  state.panelLayout.hidden ||= [];
  const floating = state.panelLayout.mode === "floating";
  workspace.classList.toggle("window-layout", floating);
  document.querySelector("#toggle-window-layout")?.classList.toggle("active", floating);
  for (const panelId of ["left", "right"]) {
    const element = panelElement(panelId);
    if (!element) continue;
    if (!floating) element.removeAttribute("style");
    if (state.panelLayout.hidden.includes(panelId)) {
      element.style.display = "none";
      continue;
    }
    element.style.display = "";
    const panel = panelLayout(panelId);
    if (!floating) {
      continue;
    }
    const rect = workspace.getBoundingClientRect();
    placeAnchoredPanel(panelId, panel, rect);
    clampPanel(panel, rect);
    element.style.left = `${panel.x}px`;
    element.style.top = `${panel.y}px`;
    element.style.width = `${panel.width}px`;
    element.style.height = `${panel.height}px`;
  }
  renderPanelLauncher();
  resizeCanvas();
}

function installPanelChrome() {
  if (isPlayerView) return;
  const labels = { left: "Map tools", right: "Encounter" };
  for (const panelId of ["left", "right"]) {
    const element = panelElement(panelId);
    if (!element || element.querySelector(".panel-window-bar")) continue;
    const bar = document.createElement("div");
    bar.className = "panel-window-bar";
    bar.dataset.panelDrag = panelId;
    bar.innerHTML = `
      <strong>${labels[panelId]}</strong>
      <span>
        <button data-panel-anchor="${panelId}:left" title="Anchor left">L</button>
        <button data-panel-anchor="${panelId}:right" title="Anchor right">R</button>
        <button data-panel-anchor="${panelId}:bottom" title="Anchor bottom">B</button>
        <button data-panel-close="${panelId}" title="Hide window">×</button>
      </span>`;
    element.prepend(bar);
  }
}

function setupPanelLayoutControls() {
  if (isPlayerView) return;
  installPanelChrome();
  let resizeTimer;
  const resizeObserver = new ResizeObserver((entries) => {
    if (state.panelLayout.mode !== "floating") return;
    const workspaceRect = document.querySelector("#battlemap-view").getBoundingClientRect();
    for (const entry of entries) {
      const panelId = entry.target.classList.contains("left-panel") ? "left" : "right";
      const panel = panelLayout(panelId);
      const rect = entry.target.getBoundingClientRect();
      panel.width = Math.round(rect.width);
      panel.height = Math.round(rect.height);
      panel.x = Math.round(rect.left - workspaceRect.left);
      panel.y = Math.round(rect.top - workspaceRect.top);
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      localStorage.setItem("holocron.session", JSON.stringify(sessionSnapshot()));
      scheduleCampaignSave();
    }, 250);
  });
  resizeObserver.observe(panelElement("left"));
  resizeObserver.observe(panelElement("right"));
  document.querySelector("#toggle-window-layout").addEventListener("click", () => {
    state.panelLayout.mode = state.panelLayout.mode === "floating" ? "anchored" : "floating";
    applyPanelLayout();
    persist();
  });
  document.querySelector("#reset-window-layout").addEventListener("click", () => {
    state.panelLayout = JSON.parse(JSON.stringify(defaults.panelLayout));
    applyPanelLayout();
    persist();
  });
  document.querySelector("#battlemap-view").addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-panel-close]");
    if (closeButton) {
      state.panelLayout.mode = "floating";
      if (!state.panelLayout.hidden.includes(closeButton.dataset.panelClose)) state.panelLayout.hidden.push(closeButton.dataset.panelClose);
      applyPanelLayout();
      persist();
      return;
    }
    const restoreButton = event.target.closest("[data-panel-restore]");
    if (restoreButton) {
      state.panelLayout.mode = "floating";
      state.panelLayout.hidden = state.panelLayout.hidden.filter((panelId) => panelId !== restoreButton.dataset.panelRestore);
      applyPanelLayout();
      persist();
      return;
    }
    const assetButton = event.target.closest("[data-open-asset-library]");
    if (assetButton) {
      openAssetLibrary();
      return;
    }
    const button = event.target.closest("[data-panel-anchor]");
    if (!button) return;
    const [panelId, anchor] = button.dataset.panelAnchor.split(":");
    state.panelLayout.mode = "floating";
    anchorPanel(panelId, anchor);
  });
  document.querySelector("#battlemap-view").addEventListener("pointerdown", (event) => {
    const bar = event.target.closest("[data-panel-drag]");
    if (!bar || event.target.closest("button") || state.panelLayout.mode !== "floating") return;
    const panelId = bar.dataset.panelDrag;
    const panel = panelLayout(panelId);
    const start = { x: event.clientX, y: event.clientY, panelX: panel.x, panelY: panel.y };
    bar.setPointerCapture(event.pointerId);
    panel.anchor = "free";
    const move = (moveEvent) => {
      panel.x = start.panelX + moveEvent.clientX - start.x;
      panel.y = start.panelY + moveEvent.clientY - start.y;
      applyPanelLayout();
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      persist();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
  });
  applyPanelLayout();
}

function renderPanelLauncher() {
  const launcher = document.querySelector("#panel-launcher");
  const menu = document.querySelector("#panel-launcher-menu");
  if (!launcher || !menu) return;
  const labels = { left: "Map tools", right: "Encounter", assets: "Asset Library" };
  const hidden = state.panelLayout.hidden || [];
  const assetsOpen = document.querySelector("#bestiary-dialog")?.open;
  launcher.classList.toggle("has-hidden", hidden.length > 0 || !assetsOpen);
  menu.innerHTML = ["left", "right", "assets"].map((panelId) => {
    const active = panelId === "assets" ? assetsOpen : !hidden.includes(panelId);
    const restoreAttr = panelId === "assets" ? "data-open-asset-library" : `data-panel-restore="${panelId}"`;
    return `<button ${restoreAttr} class="${active ? "active" : ""}" ${active ? "disabled" : ""}><strong>${labels[panelId]}</strong><span>${active ? "in use" : "hidden"}</span></button>`;
  }).join("");
}

document.querySelector("#panel-launcher-toggle")?.addEventListener("click", () => {
  const menu = document.querySelector("#panel-launcher-menu");
  menu.hidden = !menu.hidden;
  renderPanelLauncher();
});

function addMapAsset(source, point = mapCenterPoint()) {
  if (!source || !imageUrlFor(source)) return;
  state.tokens.push({
    ...snapPoint(point),
    id: crypto.randomUUID(),
    name: source.name || "Map asset",
    type: "asset",
    imageUrl: imageUrlFor(source),
  });
  persist();
  draw();
}

function setMapBackgroundFromLibrary(source) {
  const url = imageUrlFor(source);
  if (!url) return;
  state.mapImageUrl = url;
  loadMapFromUrl(url, { fit: true });
  persist();
}

function addLibraryItem(source, point = mapCenterPoint()) {
  if (source?.assetKind === "pdf-image") {
    addMapAsset(source, point);
    return;
  }
  addCombatant(source, point);
}

function renderInitiative() {
  const list = document.querySelector("#initiative-list");
  if (!state.combatants.length) {
    list.innerHTML = '<li class="initiative-empty">Add combatants or drag a token onto the map.</li>';
  } else {
    list.innerHTML = state.combatants.map((item, index) => `
      <li class="combatant ${index === state.activeTurn ? "active" : ""} ${item.id === state.selectedCombatantId ? "selected" : ""}" data-id="${item.id}">
        ${tokenMarkup(item, "combatant-token")}
        <span class="combatant-info"><strong>${escapeHtml(item.name)}</strong><span>INIT ${item.initiative} · AC ${item.ac}${item.conditions?.length ? ` · ${item.conditions.length} FX` : ""}</span></span>
        <span class="hp-control">
          <button data-hp="-1" title="Reduce HP">−</button>
          <output>${item.hp}/${item.maxHp}</output>
          <button data-hp="1" title="Restore HP">＋</button>
        </span>
      </li>`).join("");
  }
  document.querySelector("#round-number").textContent = state.round;
  renderCombatantInspector();
  renderCombatLog();
}

function selectedCombatant() {
  return state.combatants.find((item) => item.id === state.selectedCombatantId);
}

function listText(value) {
  if (Array.isArray(value) && value.length) return value.map((item) => {
    if (item && typeof item === "object") return [item.name, item.text || item.description].filter(Boolean).join(": ");
    return String(item);
  }).join(", ");
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key.toUpperCase()} ${item}`).join(", ");
  return value ? String(value) : "—";
}

function renderStatBlock(combatant) {
  const block = combatant.statBlock;
  const defenses = combatant.defenses || {};
  if (!block) {
    return `
      <div class="stat-block-empty">
        <strong>${escapeHtml(combatant.name)}</strong>
        <span>AC ${combatant.ac} · HP ${combatant.maxHp} · quick combat profile</span>
      </div>`;
  }
  const actionList = (block.actions || combatant.actions || []).slice(0, 8);
  const traitList = (block.traits || combatant.traits || []).slice(0, 6);
  const reactionList = (block.reactions || combatant.reactions || []).slice(0, 4);
  const tokenDetails = [
    combatant.matchedToken?.name,
    combatant.assetMatch?.reason,
    combatant.assetMatch?.score,
  ].filter(Boolean);
  const tokenSource = combatant.matchedToken?.name
    ? `<div class="stat-source">Token asset: ${escapeHtml(tokenDetails.join(" · "))}</div>`
    : "";
  return `
    <div class="stat-block-header">
      <strong>${escapeHtml(combatant.name)}</strong>
      <span>${escapeHtml(block.size || "")} ${escapeHtml(block.type || combatant.type || "")}${block.alignment ? `, ${escapeHtml(block.alignment)}` : ""}</span>
    </div>
    <div class="stat-grid">
      <span><b>AC</b>${escapeHtml(block.armor_class || combatant.ac)}</span>
      <span><b>HP</b>${escapeHtml(block.hit_points || combatant.maxHp)}</span>
      <span><b>CR</b>${escapeHtml(block.challenge_rating || "—")}</span>
      <span><b>Speed</b>${escapeHtml(block.speed || "—")}</span>
    </div>
    <div class="stat-line"><b>Abilities</b><span>${escapeHtml(listText(block.abilities))}</span></div>
    <div class="stat-line"><b>Saves</b><span>${escapeHtml(listText(block.saving_throws))}</span></div>
    <div class="stat-line"><b>Skills</b><span>${escapeHtml(listText(block.skills))}</span></div>
    <div class="stat-line"><b>Senses</b><span>${escapeHtml(listText(block.senses || combatant.senses))}</span></div>
    <div class="stat-line"><b>Languages</b><span>${escapeHtml(listText(block.languages || combatant.languages))}</span></div>
    <div class="stat-line"><b>Defenses</b><span>${escapeHtml([
      defenses.vulnerabilities?.length ? `Vuln ${listText(defenses.vulnerabilities)}` : "",
      defenses.resistances?.length ? `Res ${listText(defenses.resistances)}` : "",
      defenses.immunities?.length ? `Imm ${listText(defenses.immunities)}` : "",
      defenses.conditionImmunities?.length ? `Cond ${listText(defenses.conditionImmunities)}` : "",
    ].filter(Boolean).join(" · ") || "—")}</span></div>
    ${traitList.length ? `<div class="stat-line"><b>Traits</b><span>${escapeHtml(listText(traitList))}</span></div>` : ""}
    ${actionList.length ? `<div class="stat-line"><b>Actions</b><span>${escapeHtml(listText(actionList))}</span></div>` : ""}
    ${reactionList.length ? `<div class="stat-line"><b>Reactions</b><span>${escapeHtml(listText(reactionList))}</span></div>` : ""}
    ${tokenSource}
  `;
}

function renderCombatantInspector() {
  const inspector = document.querySelector("#combatant-inspector");
  const combatant = selectedCombatant();
  inspector.hidden = !combatant;
  if (!combatant) return;
  combatant.conditions ||= [];
  document.querySelector("#inspector-name").textContent = combatant.name;
  document.querySelector("#condition-chips").innerHTML = combatant.conditions.map((condition) =>
    `<button class="condition-chip" data-remove-condition="${condition}" title="Remove condition">${escapeHtml(condition)}</button>`
  ).join("");
  const restrictions = combatant.conditions.map((condition) => conditionRules[condition]?.rule).filter(Boolean);
  document.querySelector("#action-restriction").textContent = restrictions.join(" ") || "No active restrictions.";
  const targets = state.combatants.filter((item) => item.id !== combatant.id);
  document.querySelector("#combat-target").innerHTML = targets.map((target) =>
    `<option value="${target.id}">${escapeHtml(target.name)} · AC ${target.ac}</option>`
  ).join("") || '<option value="">No target</option>';
  const blocked = combatant.conditions.some((condition) => ["incapacitated", "stunned", "unconscious"].includes(condition));
  const actions = combatant.actions.length ? combatant.actions.slice(0, 5) : ["Attack"];
  combatant.actionProfiles ||= actions.map((name) => combatActionProfile(name));
  document.querySelector("#combat-actions").innerHTML = combatant.actionProfiles.slice(0, 5).map((action, index) => {
    const detail = action.kind === "save" ? `${action.save} DC ${action.dc}` : `+${action.bonus} · ${action.damage}`;
    return `<button class="combat-action" data-action-index="${index}" ${blocked || !targets.length ? "disabled" : ""}>${escapeHtml(action.name)} · ${detail}</button>`;
  }).join("");
  document.querySelector("#stat-block").innerHTML = renderStatBlock(combatant);
}

function rollDice(expression) {
  const match = String(expression).match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
  if (!match) return 0;
  const [, count, sides, bonus = 0] = match.map(Number);
  let total = bonus;
  for (let index = 0; index < count; index++) total += Math.floor(Math.random() * sides) + 1;
  return total;
}

function addCombatLog(message) {
  state.combatLog ||= [];
  state.combatLog.unshift({ id: crypto.randomUUID(), message, createdAt: Date.now() });
  state.combatLog = state.combatLog.slice(0, 50);
  persist();
  renderCombatLog();
}

function renderCombatLog() {
  document.querySelector("#combat-log").innerHTML = (state.combatLog || []).map((entry) =>
    `<div class="combat-log-entry">${entry.message}</div>`
  ).join("") || '<p class="initiative-empty">No rolls yet.</p>';
}

function librarySubtitle(item) {
  if (item.assetKind === "pdf-image") return item.detail || "PDF art";
  return item.matched_token ? `${item.type || "creature"} · token mapped` : item.type || "creature";
}

function libraryBadge(item) {
  if (item.assetKind === "pdf-image") return `p.${item.page ?? "?"}`;
  return `CR ${item.cr ?? "—"}`;
}

function libraryActions(item, index) {
  const badge = `<span class="library-entry-badge">${escapeHtml(libraryBadge(item))}</span>`;
  const addButton = `<button class="library-entry-add" data-add-creature="${index}" title="Add to encounter" aria-label="Add to encounter">＋</button>`;
  const detailButton = `<button class="library-entry-map" data-open-creature="${index}" title="Open creature sheet" aria-label="Open creature sheet">ⓘ</button>`;
  if (item.assetKind !== "pdf-image") return `<span class="library-entry-actions">${badge}${item.stat_block ? detailButton : ""}${addButton}</span>`;
  return `<span class="library-entry-actions">${badge}${addButton}<button class="library-entry-map" data-map-background="${index}" title="Use as map background" aria-label="Use as map background">▣</button></span>`;
}

function renderLibrary(items = tokenPresets) {
  state.creatureCache = items;
  document.querySelector("#token-library").innerHTML = items.length ? items.map((item, index) => `
    <div class="library-entry" draggable="true" tabindex="0" data-creature="${index}" title="Drag or double-click ${escapeHtml(item.name)} to add it to the map">
      ${tokenMarkup(item, "library-token")}
      <span class="library-entry-info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(librarySubtitle(item))}</span></span>
      ${libraryActions(item, index)}
    </div>`).join("") : '<p class="loading-line">No matching local assets.</p>';
}

function mapCenterPoint() {
  return {
    x: (shell.clientWidth / 2 - state.offset.x) / state.zoom,
    y: (shell.clientHeight / 2 - state.offset.y) / state.zoom,
  };
}

async function configureAssetFilter(mode, payload = null) {
  const filter = document.querySelector("#bestiary-cr");
  const typeFilter = document.querySelector("#bestiary-type");
  if (state.assetFilterMode !== mode) {
    state.assetFilterMode = mode;
    filter.innerHTML = mode === "creatures"
      ? '<option value="">All CR</option>'
      : mode === "images"
        ? '<option value="">All books</option>'
        : '<option value="">All</option>';
    filter.value = "";
    typeFilter.innerHTML = '<option value="">All types</option>';
    typeFilter.value = "";
  }
  filter.disabled = mode === "tokens";
  typeFilter.disabled = mode !== "creatures";
  filter.setAttribute("aria-label", mode === "images" ? "PDF book" : "Challenge rating");
  if (mode === "images" && !state.imageBookFilters) {
    const response = await fetch("/api/assets/images/summary");
    const summary = response.ok ? await response.json() : { books: {} };
    state.imageBookFilters = Object.entries(summary.books || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([slug, count]) => ({ slug, count }));
  }
  if (mode === "images" && filter.options.length === 1) {
    for (const item of state.imageBookFilters || []) {
      filter.add(new Option(`${item.slug} (${item.count})`, item.slug));
    }
  }
  if (mode === "creatures" && payload?.filters?.challenge_ratings && filter.options.length === 1) {
    for (const value of payload.filters.challenge_ratings) {
      filter.add(new Option(`CR ${value}`, value));
    }
  }
  if (mode === "creatures" && payload?.filters?.types && typeFilter.options.length === 1) {
    for (const value of payload.filters.types) typeFilter.add(new Option(value, value));
  }
}

async function loadBestiary() {
  const mode = document.querySelector("#asset-library-mode").value;
  const search = document.querySelector("#bestiary-search").value.trim();
  const params = new URLSearchParams({ limit: mode === "images" ? "40" : "60" });
  document.querySelector("#bestiary-search").placeholder = mode === "tokens" ? "Search token, faction…" : mode === "images" ? "Search book, page, source…" : "Search creature, faction…";
  try {
    await configureAssetFilter(mode);
    const filterValue = document.querySelector("#bestiary-cr").value;
    const typeValue = document.querySelector("#bestiary-type").value;
    if (search) params.set("q", search);
    if (mode === "creatures" && filterValue) params.set("cr", filterValue);
    if (mode === "creatures" && typeValue) params.set("type", typeValue);
    if (mode === "images" && filterValue) params.set("book", filterValue);
    const endpoint = mode === "tokens"
      ? `/api/assets/external?asset_type=tokens&${params}`
      : mode === "images"
        ? `/api/assets/images?${params}`
        : `/api/compendium/creatures?${params}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error("Asset library unavailable");
    const payload = await response.json();
    const items = mode === "tokens"
      ? payload.items.map((item) => ({ ...item, type: "enemy", imageUrl: item.url, cr: null, hp: 10, ac: 12, actions: ["Attack"] }))
      : mode === "images"
        ? payload.items.map((item) => ({
          ...item,
          assetKind: "pdf-image",
          name: `${item.book || "PDF art"} · image ${item.image_index || 1}`,
          type: "asset",
          imageUrl: item.url,
          detail: `${item.source_file || item.book || "Source"} · page ${item.page}`,
        }))
        : payload.items;
    await configureAssetFilter(mode, payload);
    renderLibrary(items);
    const label = `${payload.total} ${mode === "tokens" ? "tokens" : mode === "images" ? "images" : "creatures"}`;
    document.querySelector("#bestiary-count").textContent = label;
    document.querySelector("#asset-library-summary").textContent = `${label} · showing ${items.length}`;
  } catch {
    const query = search.toLowerCase();
    const offlineItems = mode === "images"
      ? []
      : tokenPresets.filter((item) => !query || `${item.name} ${item.type}`.toLowerCase().includes(query));
    renderLibrary(offlineItems);
    const label = mode === "images" ? "PDF art unavailable" : `${offlineItems.length}/${tokenPresets.length} local presets`;
    document.querySelector("#bestiary-count").textContent = label;
    document.querySelector("#asset-library-summary").textContent = mode === "images"
      ? "Local PDF art could not be loaded. Check the asset manifest and server logs."
      : `${label} · server catalog unavailable`;
  }
}

function updateZoom() {
  document.querySelector("#zoom-output").textContent = `${Math.round(state.zoom * 100)}%`;
  persist();
}

function ensureQuestState() {
  if (state.quests?.length) {
    state.quests.forEach((quest) => {
      quest.folders ||= ["NPC", "Loot", "Encounters detail", "Main Quest", "Side quests", "Activities", "Random Events", "Locations", "Points of interest"];
      quest.files ||= [];
      quest.files.forEach((file) => { file.folder = inferQuestFileFolder(file, quest.folders); });
      const seenFiles = new Set();
      quest.files = quest.files.filter((file) => {
        const key = `${(file.folder || "General").toLowerCase()}::${String(file.title || "").toLowerCase()}`;
        if (!seenFiles.has(key)) {
          seenFiles.add(key);
          return true;
        }
        return false;
      });
    });
    state.activeQuestId ||= state.quests[0].id;
    return;
  }
  state.quests = [{
    id: "episode-3",
    title: "Episode 3: Untitled Operation",
    folders: ["NPC", "Loot", "Encounters detail", "Main Quest", "Side quests", "Activities", "Random Events", "Locations", "Points of interest"],
    files: [],
  }];
  state.activeQuestId = state.quests[0].id;
}

document.querySelector("#grid-size").value = state.gridSize;
document.querySelector("#grid-output").textContent = `${state.gridSize} px`;
document.querySelector("#unit-value").value = state.unitValue;
document.querySelector("#unit-name").value = state.unitName;
document.querySelector("#travel-speed").value = state.travelSpeed;
document.querySelector("#ambient-darkness").value = state.ambientDarkness;
document.querySelector("#darkness-output").textContent = `${state.ambientDarkness}%`;
document.querySelector("#vision-type").value = state.visionType;
document.querySelector("#vision-range").value = state.visionRange;
document.querySelector("#snap-to-grid").checked = state.snapToGrid;
document.querySelectorAll("[data-layer]").forEach((input) => { input.checked = state.layers[input.dataset.layer]; });

document.querySelector("#map-file").addEventListener("change", (event) => loadMap(event.target.files[0]));
const dropZone = document.querySelector("#drop-zone");
["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop", (event) => loadMap(event.dataTransfer.files[0]));

document.querySelector("#grid-size").addEventListener("input", (event) => {
  state.gridSize = Number(event.target.value);
  document.querySelector("#grid-output").textContent = `${state.gridSize} px`;
  persist();
  draw();
});
document.querySelector("#unit-value").addEventListener("input", (event) => {
  state.unitValue = Math.max(.1, Number(event.target.value) || 1);
  persist();
  draw();
});
document.querySelector("#unit-name").addEventListener("change", (event) => { state.unitName = event.target.value; persist(); draw(); });
document.querySelector("#travel-speed").addEventListener("change", (event) => { state.travelSpeed = Number(event.target.value); persist(); draw(); });
document.querySelector("#snap-to-grid").addEventListener("change", (event) => {
  state.snapToGrid = event.target.checked;
  persist();
});
document.querySelector("#ambient-darkness").addEventListener("input", (event) => {
  state.ambientDarkness = Number(event.target.value);
  document.querySelector("#darkness-output").textContent = `${state.ambientDarkness}%`;
  persist();
  draw();
});
document.querySelector("#vision-type").addEventListener("change", (event) => { state.visionType = event.target.value; persist(); draw(); });
document.querySelector("#vision-range").addEventListener("input", (event) => {
  state.visionRange = Math.max(1, Number(event.target.value) || 1);
  persist();
  draw();
});
document.querySelectorAll("[data-layer]").forEach((input) => input.addEventListener("change", () => {
  state.layers[input.dataset.layer] = input.checked;
  syncMapActionControls();
  persist();
  draw();
}));

function updateMapCursor() {
  canvas.dataset.cursor = state.panStart ? "panning" : state.tool === "pan" ? "pan" : state.tool === "select" ? "select" : state.tool === "eraser" ? "erase" : "draw";
}

function syncMapActionControls() {
  const workspace = document.querySelector("#battlemap-view");
  workspace.classList.toggle("map-focus", Boolean(state.mapFocus));
  shell.classList.toggle("map-locked", Boolean(state.mapLocked));
  document.querySelectorAll('[data-map-action="fit"]').forEach((button) => button.classList.toggle("active", state.mapFitMode === "fit"));
  document.querySelectorAll('[data-map-action="fill"]').forEach((button) => button.classList.toggle("active", state.mapFitMode === "fill"));
  document.querySelectorAll('[data-map-action="center"]').forEach((button) => button.classList.toggle("active", state.mapFitMode === "center"));
  document.querySelectorAll('[data-map-action="immersive"]').forEach((button) => button.classList.toggle("active", state.mapFitMode === "fill" && state.mapFocus && state.mapLocked && !state.layers.grid));
  document.querySelectorAll('[data-map-action="grid"]').forEach((button) => button.classList.toggle("active", Boolean(state.layers.grid)));
  document.querySelectorAll('[data-map-action="lock"]').forEach((button) => {
    button.classList.toggle("active", Boolean(state.mapLocked));
    button.textContent = state.mapLocked ? "U" : "L";
    button.title = state.mapLocked ? "Unlock map image" : "Lock map image";
  });
  document.querySelectorAll('[data-map-action="focus"]').forEach((button) => {
    const focused = Boolean(state.mapFocus);
    button.classList.toggle("active", focused);
    button.textContent = focused ? "><" : "[]";
    button.title = focused ? "Exit map focus" : "Focus map";
  });
  const contextLock = document.querySelector('#map-context-menu [data-map-action="lock"]');
  if (contextLock) contextLock.textContent = state.mapLocked ? "Unlock map image" : "Lock map image";
  const contextFocus = document.querySelector('#map-context-menu [data-map-action="focus"]');
  if (contextFocus) contextFocus.textContent = state.mapFocus ? "Exit map focus" : "Focus map";
  const pill = document.querySelector("#map-state-pill");
  if (pill) {
    const fitLabel = state.mapFitMode === "fill" ? "viewport filled" : state.mapFitMode === "fit" ? "full map visible" : state.mapFitMode === "center" ? "100% centered" : "custom view";
    const gridLabel = state.layers.grid ? "grid on" : "grid off";
    const lockLabel = state.mapLocked ? "locked" : "unlocked";
    pill.textContent = `${fitLabel} · ${gridLabel} · ${lockLabel}`;
    pill.hidden = !state.image && !state.tokens.length;
  }
}

document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => {
  state.tool = button.dataset.tool;
  document.querySelectorAll("[data-tool]").forEach((item) => item.classList.toggle("active", item === button));
  updateMapCursor();
  persist();
}));

document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === state.tool));
updateMapCursor();
syncMapActionControls();

canvas.addEventListener("pointerdown", (event) => {
  document.querySelector("#map-context-menu").hidden = true;
  if (!state.mapLocked && (state.tool === "pan" || event.button === 1)) {
    state.panStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: state.offset.x,
      offsetY: state.offset.y,
    };
    canvas.setPointerCapture(event.pointerId);
    updateMapCursor();
    return;
  }
  const point = worldPoint(event);
  state.pointer = point;
  if (state.tool === "eraser") {
    eraseMapElement(point);
    state.pointer = null;
    persist();
    draw();
    return;
  }
  if (state.tool === "measure") state.measurement = { start: point, end: point };
  if (state.tool === "wall") state.measurement = { start: point, end: point, wall: true };
  if (state.tool === "door") state.measurement = { start: point, end: point, door: true };
  if (state.tool === "ping") state.pings.push({ ...point, created: Date.now() });
  if (state.tool === "note") openNotePinDialog(null, point);
  if (state.tool === "select") {
    const door = [...state.doors].reverse().find((item) => {
      const length = Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) || 1;
      const t = Math.max(0, Math.min(1, ((point.x - item.start.x) * (item.end.x - item.start.x) + (point.y - item.start.y) * (item.end.y - item.start.y)) / (length * length)));
      return Math.hypot(point.x - (item.start.x + t * (item.end.x - item.start.x)), point.y - (item.start.y + t * (item.end.y - item.start.y))) < 10 / state.zoom;
    });
    if (door) {
      door.open = !door.open;
      persist();
      draw();
      state.pointer = null;
      return;
    }
    const pin = [...state.notePins].reverse().find((item) => Math.hypot(item.x - point.x, item.y - point.y) < 16 / state.zoom);
    if (pin) {
      openNotePinDialog(pin);
      state.pointer = null;
      return;
    }
    const hit = [...state.tokens].reverse().find((token) => Math.hypot(token.x - point.x, token.y - point.y) < state.gridSize * .5);
    state.tokens.forEach((token) => { token.selected = token === hit; });
    state.draggedToken = hit || null;
    if (hit) {
      state.selectedCombatantId = hit.combatantId;
      renderInitiative();
    }
  }
  canvas.setPointerCapture(event.pointerId);
  draw();
});

canvas.addEventListener("pointermove", (event) => {
  if (state.panStart) {
    state.offset = {
      x: state.panStart.offsetX + event.clientX - state.panStart.clientX,
      y: state.panStart.offsetY + event.clientY - state.panStart.clientY,
    };
    state.mapFitMode = "custom";
    syncMapActionControls();
    draw();
    return;
  }
  if (!state.pointer) return;
  const point = worldPoint(event);
  if (state.measurement) state.measurement.end = point;
  if (state.draggedToken) {
    const destination = snapPoint(point, { free: event.altKey });
    state.draggedToken.x = destination.x;
    state.draggedToken.y = destination.y;
    if (state.layers.fog) state.explored.push({ x: state.draggedToken.x, y: state.draggedToken.y });
  }
  draw();
});

canvas.addEventListener("pointerup", () => {
  if (state.panStart) {
    state.panStart = null;
    updateMapCursor();
    persist();
    draw();
    return;
  }
  if (state.measurement?.door) {
    state.doors.push({ id: crypto.randomUUID(), start: state.measurement.start, end: state.measurement.end, open: false });
    state.measurement = null;
    measurementLabel.hidden = true;
  }
  if (state.measurement?.wall) {
    state.walls.push({ start: state.measurement.start, end: state.measurement.end });
    state.measurement = null;
    measurementLabel.hidden = true;
  }
  state.pointer = null;
  state.draggedToken = null;
  persist();
  draw();
});

canvas.addEventListener("pointercancel", () => {
  state.pointer = null;
  state.draggedToken = null;
  state.panStart = null;
  updateMapCursor();
});

canvas.addEventListener("wheel", (event) => {
  if (state.mapLocked) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const before = { x: (cursor.x - state.offset.x) / state.zoom, y: (cursor.y - state.offset.y) / state.zoom };
  state.zoom = Math.min(3, Math.max(.25, state.zoom * (event.deltaY < 0 ? 1.1 : .9)));
  state.offset = { x: cursor.x - before.x * state.zoom, y: cursor.y - before.y * state.zoom };
  state.mapFitMode = "custom";
  updateZoom();
  syncMapActionControls();
  draw();
}, { passive: false });

const mapContextMenu = document.querySelector("#map-context-menu");
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const rect = shell.getBoundingClientRect();
  mapContextMenu.style.left = `${Math.min(event.clientX - rect.left, shell.clientWidth - 184)}px`;
  mapContextMenu.style.top = `${Math.min(event.clientY - rect.top, shell.clientHeight - 170)}px`;
  mapContextMenu.hidden = false;
});
function handleMapAction(button) {
  if (!button) return;
  const action = button.dataset.mapAction;
  if (state.mapLocked && ["fit", "fill", "center"].includes(action)) return;
  if (action === "immersive") {
    if (state.image) fillMapImage();
    state.layers.grid = false;
    document.querySelector('[data-layer="grid"]').checked = false;
    state.mapLocked = true;
    state.mapFocus = true;
    document.querySelector("#battlemap-view").classList.add("map-focus");
    resizeCanvas();
  }
  if (action === "fit" && state.image) applyMapFitMode("fit");
  if (action === "fill") fillMapImage();
  if (action === "center") centerMapImage();
  if (action === "grid") {
    state.layers.grid = !state.layers.grid;
    document.querySelector('[data-layer="grid"]').checked = state.layers.grid;
  }
  if (action === "lock") {
    state.mapLocked = !state.mapLocked;
  }
  if (action === "focus") {
    state.mapFocus = !state.mapFocus;
    document.querySelector("#battlemap-view").classList.toggle("map-focus", state.mapFocus);
    resizeCanvas();
  }
  syncMapActionControls();
  persist();
  draw();
}
mapContextMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-action]");
  if (!button) return;
  handleMapAction(button);
  mapContextMenu.hidden = true;
});
document.querySelector(".map-toolbar").addEventListener("click", (event) => handleMapAction(event.target.closest("[data-map-action]")));
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#map-context-menu") && !event.target.closest("#map-canvas")) mapContextMenu.hidden = true;
});

document.querySelector("#zoom-in").addEventListener("click", () => {
  if (state.mapLocked) return;
  state.zoom = Math.min(3, state.zoom * 1.2);
  state.mapFitMode = "custom";
  updateZoom();
  syncMapActionControls();
  persist();
  draw();
});
document.querySelector("#zoom-out").addEventListener("click", () => {
  if (state.mapLocked) return;
  state.zoom = Math.max(.25, state.zoom / 1.2);
  state.mapFitMode = "custom";
  updateZoom();
  syncMapActionControls();
  persist();
  draw();
});
document.querySelector("#reset-view").addEventListener("click", () => {
  if (state.mapLocked) return;
  if (state.image) fillMapImage();
  else {
    state.zoom = 1;
    state.offset = { x: 0, y: 0 };
    state.mapFitMode = "custom";
    updateZoom();
  }
  syncMapActionControls();
  persist();
  draw();
});
document.querySelector("#clear-measurement").addEventListener("click", () => {
  state.measurement = null;
  state.walls = [];
  measurementLabel.hidden = true;
  persist();
  draw();
});

document.querySelector("#token-library").addEventListener("dragstart", (event) => {
  const entry = event.target.closest("[data-creature]");
  if (entry) event.dataTransfer.setData("application/holocron-token", entry.dataset.creature);
});

function distanceToSegment(point, segment) {
  const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) || 1;
  const t = Math.max(0, Math.min(1, ((point.x - segment.start.x) * (segment.end.x - segment.start.x) + (point.y - segment.start.y) * (segment.end.y - segment.start.y)) / (length * length)));
  return Math.hypot(point.x - (segment.start.x + t * (segment.end.x - segment.start.x)), point.y - (segment.start.y + t * (segment.end.y - segment.start.y)));
}

function eraseMapElement(point) {
  const threshold = Math.max(16 / state.zoom, state.gridSize * .22);
  const targets = [
    ...state.tokens.map((item, index) => ({ type: "tokens", index, distance: Math.hypot(item.x - point.x, item.y - point.y) })),
    ...state.notePins.map((item, index) => ({ type: "notePins", index, distance: Math.hypot(item.x - point.x, item.y - point.y) })),
    ...state.pings.map((item, index) => ({ type: "pings", index, distance: Math.hypot(item.x - point.x, item.y - point.y) })),
    ...state.walls.map((item, index) => ({ type: "walls", index, distance: distanceToSegment(point, item) })),
    ...state.doors.map((item, index) => ({ type: "doors", index, distance: distanceToSegment(point, item) })),
  ].sort((a, b) => a.distance - b.distance);
  const target = targets[0];
  if (!target || target.distance > threshold) return;
  if (target.type === "tokens") {
    const [token] = state.tokens.splice(target.index, 1);
    if (token?.combatantId) state.combatants = state.combatants.filter((combatant) => combatant.id !== token.combatantId);
    renderInitiative();
    return;
  }
  state[target.type].splice(target.index, 1);
}
document.querySelector("#token-library").addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-open-creature]");
  if (detailButton) {
    event.preventDefault();
    event.stopPropagation();
    openCreatureDetail(state.creatureCache[Number(detailButton.dataset.openCreature)]);
    return;
  }
  const addButton = event.target.closest("[data-add-creature]");
  if (addButton) {
    event.preventDefault();
    event.stopPropagation();
    addLibraryItem(state.creatureCache[Number(addButton.dataset.addCreature)], mapCenterPoint());
    return;
  }
  const button = event.target.closest("[data-map-background]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  setMapBackgroundFromLibrary(state.creatureCache[Number(button.dataset.mapBackground)]);
});

function applyAssetLibraryView() {
  const dialog = document.querySelector("#bestiary-dialog");
  dialog.classList.toggle("compact-view", state.assetLibraryView === "compact");
  dialog.classList.toggle("minimized-view", state.assetLibraryView === "minimized");
  document.querySelectorAll("[data-library-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.libraryView === state.assetLibraryView);
  });
}

function applyAssetLibraryPosition() {
  const dialog = document.querySelector("#bestiary-dialog");
  if (!state.assetLibraryPosition) return;
  const position = state.assetLibraryPosition;
  const width = dialog.offsetWidth || Number(position.width) || 760;
  const height = dialog.offsetHeight || Number(position.height) || 640;
  const left = Math.max(12, Math.min(Number(position.left) || 32, window.innerWidth - width - 12));
  const top = Math.max(70, Math.min(Number(position.top) || 76, window.innerHeight - height - 12));
  dialog.style.left = `${left}px`;
  dialog.style.top = `${top}px`;
  dialog.style.right = "auto";
  dialog.style.bottom = "auto";
  dialog.style.margin = "0";
}

function rememberAssetLibraryPosition() {
  const dialog = document.querySelector("#bestiary-dialog");
  if (!dialog.open) return;
  const rect = dialog.getBoundingClientRect();
  state.assetLibraryPosition = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function openAssetLibrary() {
  const dialog = document.querySelector("#bestiary-dialog");
  if (!dialog.open) dialog.show();
  applyAssetLibraryView();
  requestAnimationFrame(() => {
    applyAssetLibraryPosition();
    renderPanelLauncher();
  });
}

function closeAssetLibrary() {
  const dialog = document.querySelector("#bestiary-dialog");
  rememberAssetLibraryPosition();
  try {
    if (dialog.open) dialog.close();
  } catch {
    dialog.removeAttribute("open");
  }
  if (dialog.open) dialog.removeAttribute("open");
  persist();
  renderPanelLauncher();
}

document.querySelector("#bestiary-dialog").addEventListener("click", (event) => {
  if (event.target.closest("#close-bestiary")) {
    closeAssetLibrary();
    return;
  }
  const view = event.target.closest("[data-library-view]");
  if (!view) return;
  state.assetLibraryView = view.dataset.libraryView;
  applyAssetLibraryView();
  rememberAssetLibraryPosition();
  persist();
  renderPanelLauncher();
});

document.querySelectorAll("[data-library-view]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.assetLibraryView = button.dataset.libraryView;
    applyAssetLibraryView();
    rememberAssetLibraryPosition();
    persist();
    renderPanelLauncher();
  });
});

document.querySelector("#bestiary-dialog").addEventListener("pointerdown", (event) => {
  const dragBar = event.target.closest("[data-dialog-drag]");
  const dialog = document.querySelector("#bestiary-dialog");
  if (!dragBar || event.target.closest("button")) return;
  const rect = dialog.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
  dragBar.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    dialog.style.left = `${start.left + moveEvent.clientX - start.x}px`;
    dialog.style.top = `${start.top + moveEvent.clientY - start.y}px`;
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.margin = "0";
  };
  const up = () => {
    rememberAssetLibraryPosition();
    persist();
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
});
applyAssetLibraryView();
window.addEventListener("resize", () => {
  if (document.querySelector("#bestiary-dialog")?.open) applyAssetLibraryPosition();
});
document.querySelector("#token-library").addEventListener("dblclick", (event) => {
  if (event.target.closest("[data-map-background], [data-add-creature]")) return;
  const entry = event.target.closest("[data-creature]");
  if (!entry) return;
  addLibraryItem(state.creatureCache[Number(entry.dataset.creature)], mapCenterPoint());
});
document.querySelector("#token-library").addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const entry = event.target.closest("[data-creature]");
  if (!entry) return;
  event.preventDefault();
  addLibraryItem(state.creatureCache[Number(entry.dataset.creature)], mapCenterPoint());
});
canvas.addEventListener("dragover", (event) => event.preventDefault());
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const index = event.dataTransfer.getData("application/holocron-token");
  if (index !== "") addLibraryItem(state.creatureCache[Number(index)], worldPoint(event));
});

let bestiaryTimer;
document.querySelector("#bestiary-search").addEventListener("input", () => {
  clearTimeout(bestiaryTimer);
  bestiaryTimer = setTimeout(loadBestiary, 180);
});
document.querySelector("#asset-library-mode").addEventListener("change", () => {
  clearTimeout(bestiaryTimer);
  document.querySelector("#bestiary-search").value = "";
  document.querySelector("#bestiary-cr").value = "";
  document.querySelector("#bestiary-type").value = "";
  loadBestiary();
});
document.querySelector("#bestiary-cr").addEventListener("change", loadBestiary);
document.querySelector("#bestiary-type").addEventListener("change", loadBestiary);
const bestiaryDialog = document.querySelector("#bestiary-dialog");
document.querySelector("#open-bestiary").addEventListener("click", () => {
  openAssetLibrary();
  loadBestiary();
  document.querySelector("#bestiary-search").focus();
});
document.querySelector("#close-bestiary").addEventListener("click", (event) => {
  event.stopPropagation();
  closeAssetLibrary();
});

let creatureDetailItem = null;
function openCreatureDetail(item) {
  if (!item) return;
  creatureDetailItem = item;
  const imageUrl = imageUrlFor(item);
  const adapted = {
    ...item,
    maxHp: item.hp,
    statBlock: item.stat_block,
    defenses: {
      vulnerabilities: item.damage_vulnerabilities || [],
      resistances: item.damage_resistances || [],
      immunities: item.damage_immunities || [],
      conditionImmunities: item.condition_immunities || [],
    },
    matchedToken: item.matched_token,
    assetMatch: item.asset_match,
  };
  document.querySelector("#creature-detail-title").textContent = item.name;
  document.querySelector("#creature-detail-content").innerHTML = `
    <div class="creature-detail-layout">
      <div>${imageUrl ? `<img class="creature-detail-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}">` : '<div class="creature-detail-image"></div>'}<p class="citation">${escapeHtml(item.source || "SW5e")} · p.${escapeHtml(item.page || "?")}</p></div>
      <div class="creature-detail-copy">${renderStatBlock(adapted)}</div>
    </div>`;
  document.querySelector("#creature-detail-dialog").showModal();
}
document.querySelector("#deploy-creature-detail").addEventListener("click", () => {
  if (creatureDetailItem) addLibraryItem(creatureDetailItem, mapCenterPoint());
  document.querySelector("#creature-detail-dialog").close();
});

const dialog = document.querySelector("#combatant-dialog");
document.querySelector("#add-combatant").addEventListener("click", () => dialog.showModal());
document.querySelector("#close-combatant-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#combatant-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  addCombatant(Object.fromEntries(form.entries()));
  event.currentTarget.reset();
  dialog.close();
});

document.querySelector("#initiative-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-hp]");
  const row = event.target.closest("[data-id]");
  if (!row) return;
  const combatant = state.combatants.find((item) => item.id === row.dataset.id);
  state.selectedCombatantId = combatant.id;
  if (button) combatant.hp = Math.max(0, Math.min(combatant.maxHp, combatant.hp + Number(button.dataset.hp)));
  persist();
  renderInitiative();
});
document.querySelector("#toggle-condition").addEventListener("click", () => {
  const combatant = selectedCombatant();
  const condition = document.querySelector("#condition-select").value;
  if (!combatant || !condition) return;
  combatant.conditions ||= [];
  if (combatant.conditions.includes(condition)) {
    combatant.conditions = combatant.conditions.filter((item) => item !== condition);
  } else {
    combatant.conditions.push(condition);
  }
  persist();
  renderInitiative();
  draw();
});
document.querySelector("#condition-chips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-condition]");
  const combatant = selectedCombatant();
  if (!chip || !combatant) return;
  combatant.conditions = combatant.conditions.filter((item) => item !== chip.dataset.removeCondition);
  persist();
  renderInitiative();
  draw();
});
document.querySelector("#roll-check").addEventListener("click", () => {
  const combatant = selectedCombatant();
  if (!combatant) return;
  const result = Math.floor(Math.random() * 20) + 1;
  const output = document.querySelector("#roll-result");
  output.hidden = false;
  output.textContent = `${combatant.name} rolled ${result}${result === 20 ? " · Critical" : result === 1 ? " · Critical failure" : ""}`;
});
document.querySelector("#combat-actions").addEventListener("click", (event) => {
  const actor = selectedCombatant();
  const target = state.combatants.find((item) => item.id === document.querySelector("#combat-target").value);
  if (!actor || !target) return;
  const actionButton = event.target.closest("[data-action-index]");
  if (!actionButton) return;
  const action = actor.actionProfiles[Number(actionButton.dataset.actionIndex)];
  if (action.kind === "save") {
    const roll = Math.floor(Math.random() * 20) + 1;
    const success = roll >= action.dc;
    const rolledDamage = rollDice(action.damage);
    const damage = success ? (action.half ? Math.floor(rolledDamage / 2) : 0) : rolledDamage;
    target.hp = Math.max(0, target.hp - damage);
    addCombatLog(`<strong>${escapeHtml(target.name)}</strong> rolls ${roll} on ${action.save}: ${success ? "save" : "failure"} · ${damage} damage from ${escapeHtml(action.name)}.`);
  } else {
    const rolls = [];
    let totalDamage = 0;
    for (let index = 0; index < (action.attacks || 1); index++) {
      const die = Math.floor(Math.random() * 20) + 1;
      const total = die + action.bonus;
      const hit = die === 20 || (die !== 1 && total >= target.ac);
      const damage = hit ? rollDice(action.damage) : 0;
      totalDamage += damage;
      rolls.push(`${total}${hit ? " hit" : " miss"}`);
    }
    target.hp = Math.max(0, target.hp - totalDamage);
    if (totalDamage && action.condition) {
      target.conditions ||= [];
      if (!target.conditions.includes(action.condition)) target.conditions.push(action.condition);
    }
    addCombatLog(`<strong>${escapeHtml(actor.name)}</strong> uses ${escapeHtml(action.name)}: ${rolls.join(", ")} · ${totalDamage} damage${action.condition && totalDamage ? ` · ${action.condition}` : ""}.`);
  }
  persist();
  renderInitiative();
});
document.querySelector("#clear-combat-log").addEventListener("click", () => {
  state.combatLog = [];
  persist();
  renderCombatLog();
});
document.querySelector("#roll-initiative").addEventListener("click", () => {
  state.combatants.forEach((item) => { item.initiative = Math.floor(Math.random() * 20) + 1; });
  state.combatants.sort((a, b) => b.initiative - a.initiative);
  state.activeTurn = 0;
  state.selectedCombatantId = null;
  state.round = 1;
  state.combatLog = [];
  persist();
  renderInitiative();
});
document.querySelector("#next-turn").addEventListener("click", () => {
  if (!state.combatants.length) return;
  state.activeTurn++;
  if (state.activeTurn >= state.combatants.length) { state.activeTurn = 0; state.round++; }
  persist();
  renderInitiative();
});
document.querySelector("#previous-turn").addEventListener("click", () => {
  if (!state.combatants.length) return;
  state.activeTurn--;
  if (state.activeTurn < 0) { state.activeTurn = state.combatants.length - 1; state.round = Math.max(1, state.round - 1); }
  persist();
  renderInitiative();
});
document.querySelector("#clear-encounter").addEventListener("click", () => {
  state.combatants = [];
  state.tokens = [];
  state.activeTurn = 0;
  state.round = 1;
  persist();
  renderInitiative();
  draw();
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("resize", applyPanelLayout);
setupPanelLayoutControls();
document.querySelector("#bestiary-count").textContent = "Open catalog";
renderInitiative();
resizeCanvas();

const noteDefaults = {
  activeId: null,
  notes: [],
};
const noteState = { ...noteDefaults, ...JSON.parse(localStorage.getItem("holocron.notes") || "null") };
let noteSaveTimer;

function noteTimestamp(value = Date.now()) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(value);
}

function saveNotes() {
  localStorage.setItem("holocron.notes", JSON.stringify(noteState));
  document.querySelector("#save-status").textContent = "Saved locally";
  scheduleCampaignSave();
}

function activeNote() {
  return noteState.notes.find((note) => note.id === noteState.activeId);
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, '<button class="wiki-link" data-wiki="$1">$1</button>');
}

function markdownToHtml(markdown) {
  const output = [];
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) output.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^(?:\*|-)\s+(.+)$/);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      output.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return output.join("");
}

function createNote(title = "Untitled note", content = "") {
  const note = {
    id: crypto.randomUUID(),
    title,
    content,
    updatedAt: Date.now(),
    versions: [],
  };
  noteState.notes.unshift(note);
  noteState.activeId = note.id;
  commitNoteVersion(note);
  saveNotes();
  renderNotes();
  document.querySelector("#note-title").focus();
}

function commitNoteVersion(note) {
  note.versions ||= [];
  const latest = note.versions[0];
  if (latest?.title === note.title && latest?.content === note.content) return;
  note.versions.unshift({
    id: crypto.randomUUID(),
    title: note.title,
    content: note.content,
    createdAt: Date.now(),
  });
  note.versions = note.versions.slice(0, 50);
}

function renderNoteList() {
  const query = document.querySelector("#note-search").value.trim().toLowerCase();
  const notes = noteState.notes.filter((note) =>
    `${note.title} ${note.content}`.toLowerCase().includes(query)
  );
  document.querySelector("#note-list").innerHTML = notes.map((note) => `
    <button data-note-id="${note.id}" class="${note.id === noteState.activeId ? "active" : ""}">
      <strong>${escapeHtml(note.title)}</strong>
      <span>${noteTimestamp(note.updatedAt)}</span>
    </button>`).join("") || '<p class="initiative-empty">No matching notes.</p>';
}

function renderVersionList(note) {
  const versions = note?.versions || [];
  document.querySelector("#version-count").textContent = `${versions.length} version${versions.length === 1 ? "" : "s"}`;
  document.querySelector("#version-list").innerHTML = versions.map((version, index) => `
    <button data-version-id="${version.id}" class="${index === 0 ? "current" : ""}" title="Restore this version">
      <strong>${escapeHtml(version.title)}</strong>
      <span>${noteTimestamp(version.createdAt)}</span>
    </button>`).join("");
}

function renderNotes() {
  renderNoteList();
  const note = activeNote();
  if (!note && noteState.notes.length) {
    noteState.activeId = noteState.notes[0].id;
    return renderNotes();
  }
  document.querySelector("#note-title").value = note?.title || "";
  document.querySelector("#note-editor").value = note?.content || "";
  document.querySelector("#note-preview").innerHTML = note ? markdownToHtml(note.content) : "";
  document.querySelector("#note-title").disabled = !note;
  document.querySelector("#note-editor").disabled = !note;
  document.querySelector("#delete-note").disabled = !note;
  renderVersionList(note);
}

function scheduleNoteSave() {
  const note = activeNote();
  if (!note) return;
  note.title = document.querySelector("#note-title").value.trim() || "Untitled note";
  note.content = document.querySelector("#note-editor").value;
  note.updatedAt = Date.now();
  document.querySelector("#note-preview").innerHTML = markdownToHtml(note.content);
  document.querySelector("#save-status").textContent = "Saving…";
  renderNoteList();
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    commitNoteVersion(note);
    saveNotes();
    renderVersionList(note);
  }, 500);
}

let compendiumInitialized = false;
let booksInitialized = false;
let toolkitInitialized = false;
let soundInitialized = false;
let questsInitialized = false;
let charactersInitialized = false;

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  const view = button.dataset.view;
  document.querySelector("#battlemap-view").hidden = view !== "battlemap";
  document.querySelector("#notes-view").hidden = view !== "notes";
  document.querySelector("#characters-view").hidden = view !== "characters";
  document.querySelector("#compendium-view").hidden = view !== "compendium";
  document.querySelector("#books-view").hidden = view !== "books";
  document.querySelector("#toolkit-view").hidden = view !== "toolkit";
  document.querySelector("#sound-view").hidden = view !== "sound";
  document.querySelector("#quests-view").hidden = view !== "quests";
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
  if (view === "battlemap") resizeCanvas();
  if (view === "characters" && !charactersInitialized) {
    charactersInitialized = true;
    loadPregens();
  }
  if (view === "compendium" && !compendiumInitialized) {
    compendiumInitialized = true;
    searchCompendium("combat");
  }
  if (view === "books" && !booksInitialized) {
    booksInitialized = true;
    loadBooks();
  }
  if (view === "toolkit" && !toolkitInitialized) {
    toolkitInitialized = true;
    generateNpc();
    generateLoot();
    generateShopkeeper();
    generateFlavor();
    loadExternalResources();
  }
  if (view === "sound" && !soundInitialized) {
    soundInitialized = true;
    renderSoundAmbiance();
  }
  if (view === "quests" && !questsInitialized) {
    questsInitialized = true;
    ensureQuestState();
    renderQuests();
  }
}));
document.querySelector("#new-note").addEventListener("click", () => createNote());
document.querySelector("#note-search").addEventListener("input", renderNoteList);
document.querySelector("#note-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-note-id]");
  if (!button) return;
  noteState.activeId = button.dataset.noteId;
  saveNotes();
  renderNotes();
});
document.querySelector("#note-title").addEventListener("input", scheduleNoteSave);
document.querySelector("#note-editor").addEventListener("input", scheduleNoteSave);
document.querySelector("#note-preview").addEventListener("click", (event) => {
  const link = event.target.closest("[data-wiki]");
  if (!link) return;
  const existing = noteState.notes.find((note) => note.title.toLowerCase() === link.dataset.wiki.toLowerCase());
  if (existing) {
    noteState.activeId = existing.id;
    saveNotes();
    renderNotes();
  } else {
    createNote(link.dataset.wiki, `# ${link.dataset.wiki}\n\n`);
  }
});
document.querySelector("#version-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-version-id]");
  const note = activeNote();
  const version = note?.versions.find((item) => item.id === button?.dataset.versionId);
  if (!version) return;
  note.title = version.title;
  note.content = version.content;
  note.updatedAt = Date.now();
  commitNoteVersion(note);
  saveNotes();
  renderNotes();
});
document.querySelector("#delete-note").addEventListener("click", () => {
  const note = activeNote();
  if (!note) return;
  noteState.notes = noteState.notes.filter((item) => item.id !== note.id);
  noteState.activeId = noteState.notes[0]?.id || null;
  saveNotes();
  renderNotes();
});

if (!noteState.notes.length) {
  createNote("Session notes", "# Session notes\n\n## Scene\n\nLink related lore with [[Dantooine Enclave]].");
} else {
  renderNotes();
}

const notePinDialog = document.querySelector("#note-pin-dialog");

function openNotePinDialog(pin, point = null) {
  const select = document.querySelector("#pin-note-select");
  select.innerHTML = noteState.notes.map((note) =>
    `<option value="${note.id}">${escapeHtml(note.title)}</option>`
  ).join("");
  state.pendingNotePin = pin
    ? { id: pin.id, x: pin.x, y: pin.y }
    : { id: null, x: point.x, y: point.y };
  select.value = pin?.noteId || noteState.activeId;
  document.querySelector("#pin-snippet").value = pin?.snippet || "";
  document.querySelector("#delete-note-pin").hidden = !pin;
  notePinDialog.showModal();
}

document.querySelector("#close-note-pin").addEventListener("click", () => {
  state.pendingNotePin = null;
  notePinDialog.close();
});
document.querySelector("#note-pin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const pending = state.pendingNotePin;
  if (!pending) return;
  const pin = {
    id: pending.id || crypto.randomUUID(),
    x: pending.x,
    y: pending.y,
    noteId: document.querySelector("#pin-note-select").value,
    snippet: document.querySelector("#pin-snippet").value.trim(),
  };
  const index = state.notePins.findIndex((item) => item.id === pin.id);
  if (index >= 0) state.notePins[index] = pin;
  else state.notePins.push(pin);
  state.pendingNotePin = null;
  persist();
  draw();
  notePinDialog.close();
});
document.querySelector("#delete-note-pin").addEventListener("click", () => {
  if (!state.pendingNotePin?.id) return;
  state.notePins = state.notePins.filter((pin) => pin.id !== state.pendingNotePin.id);
  state.pendingNotePin = null;
  persist();
  draw();
  notePinDialog.close();
});
document.querySelector("#open-pin-note").addEventListener("click", () => {
  const noteId = document.querySelector("#pin-note-select").value;
  if (!noteId) return;
  noteState.activeId = noteId;
  saveNotes();
  renderNotes();
  notePinDialog.close();
  document.querySelector('[data-view="notes"]').click();
});

const defaultCharacter = {
  id: "player-1",
  name: "Kira Venn",
  species: "Human",
  className: "Sentinel",
  subclass: "Path of Synthesis",
  level: 7,
  baseAc: 10,
  resources: {
    hp: { label: "HP", value: 36, max: 42, color: "#c40f0f" },
    force: { label: "Force", value: 12, max: 16, color: "#0d99cc" },
    tech: { label: "Tech", value: 8, max: 10, color: "#9e9d24" },
    hitDice: { label: "Hit Dice", value: 5, max: 7, color: "#757575" },
  },
  alignment: 0,
  passiveInsight: 14,
  credits: 1200,
  cargoCapacity: 100,
  gmHooks: "Former contact inside the Exchange. Protects their sibling at any cost.",
  sharedNote: "Agreements, debts and promises confirmed by both player and GM.",
  playerSecretNote: "",
  playerSecretSealed: "",
  template: "human-male",
  equipped: {},
  inventory: [
    { id: "armor-1", name: "Reinforced Fiber Armor", slot: "chest", weight: 12, ac: 4 },
    { id: "weapon-1", name: "Modified Blaster", slot: "mainHand", weight: 3, attack: 2 },
    { id: "shield-1", name: "Light Shield", slot: "offHand", weight: 4, ac: 1 },
    { id: "head-1", name: "Tactical Visor", slot: "head", weight: 1, attack: 1 },
    { id: "cyber-1", name: "Reflex Augment", slot: "cybernetic", weight: 0, ac: 1 },
    { id: "cargo-1", name: "Medpac ×3", slot: null, weight: 3 },
  ],
};
const characterState = JSON.parse(localStorage.getItem("holocron.characters") || "null") || {
  activeId: defaultCharacter.id,
  selectedItemId: null,
  characters: [defaultCharacter],
};
let pregenCatalog = [];

function normalizeCharacter(character) {
  const validTemplates = new Set(["human-male", "human-female", "zabrak-male", "zabrak-female"]);
  character.resources ||= structuredClone(defaultCharacter.resources);
  character.equipped ||= {};
  character.inventory ||= [];
  character.sharedNote ||= "";
  character.playerSecretNote ||= "";
  character.playerSecretSealed ||= "";
  if (!validTemplates.has(character.template)) character.template = character.species === "Zabrak" ? "zabrak-male" : "human-male";
  character.cargoCapacity ||= 100;
  character.baseAc ||= 10;
  character.gmHooks ||= "";
  character.className ||= "Fighter";
  character.subclass ||= "";
  character.level = Math.max(1, Math.min(20, Number(character.level || 1)));
  return character;
}

characterState.characters.forEach(normalizeCharacter);

function safeCharacterTemplate(character) {
  const validTemplates = new Set(["human-male", "human-female", "zabrak-male", "zabrak-female"]);
  if (validTemplates.has(character?.template)) return character.template;
  const fallback = character?.species === "Zabrak" ? "zabrak-male" : "human-male";
  if (character) character.template = fallback;
  return fallback;
}

function publicCharacter(character) {
  return {
    id: character.id,
    name: character.name,
    species: character.species,
    resources: character.resources,
    credits: character.credits || 0,
    equipped: character.equipped,
    inventory: character.inventory,
    baseAc: character.baseAc,
    level: character.level || 1,
    className: character.className || "",
    subclass: character.subclass || "",
    sharedNote: character.sharedNote || "",
  };
}

sharedCharacters = characterState.characters.map(publicCharacter);

function currentCharacter() {
  return characterState.characters.find((character) => character.id === characterState.activeId);
}

function saveCharacters() {
  localStorage.setItem("holocron.characters", JSON.stringify(characterState));
  sharedCharacters = characterState.characters.map(publicCharacter);
  publishLiveSession();
  scheduleCampaignSave();
}

function alignmentLabel(value) {
  if (value <= -7) return "Radiant";
  if (value <= -3) return "Light";
  if (value >= 7) return "Corrupted";
  if (value >= 3) return "Dark";
  return "Balanced";
}

function characterArmorClass(character, equippedItems) {
  const armorValues = equippedItems
    .map((item) => Number.parseInt(item.armorClass, 10))
    .filter(Number.isFinite);
  const armorBase = Math.max(character.baseAc || 10, ...armorValues);
  return armorBase + equippedItems.reduce((total, item) => total + Number(item.ac || item.acBonus || 0), 0);
}

function ensureSelectOption(select, value) {
  if (!select || !value || [...select.options].some((option) => option.value === value)) return;
  select.add(new Option(value, value));
}

function classProgressionProfile(character) {
  const level = Math.max(1, Math.min(20, Number(character.level || 1)));
  const className = String(character.className || "Fighter");
  const lowerClass = className.toLowerCase();
  const isForce = /consular|guardian|sentinel/.test(lowerClass);
  const isTech = /engineer|scholar|scout|operative/.test(lowerClass);
  const isManeuver = /berserker|fighter|monk|operative|scholar|sentinel|scout/.test(lowerClass);
  const profBonus = 2 + Math.floor((level - 1) / 4);
  const powerLevel = level >= 17 ? "5th" : level >= 13 ? "4th" : level >= 9 ? "3rd" : level >= 5 ? "2nd" : isForce || isTech ? "1st" : "None";
  const maneuverDice = isManeuver ? Math.min(6, Math.max(2, 2 + Math.floor((level - 1) / 4))) : 0;
  const hitDice = /consular|scholar/.test(lowerClass) ? "d6" : /engineer|operative|scout|sentinel/.test(lowerClass) ? "d8" : "d10";
  const source = isForce && isTech ? "Force + Tech" : isForce ? "Force" : isTech ? "Tech" : "Martial";
  const nextTier = level < 5 ? 5 : level < 9 ? 9 : level < 13 ? 13 : level < 17 ? 17 : 20;
  return {
    source,
    level,
    profBonus,
    hitDice,
    powerLevel,
    maneuverDice,
    prompts: [
      `${source} chassis, proficiency +${profBonus}, ${level}${hitDice} hit dice.`,
      isForce || isTech ? `Prepare ${source.toLowerCase()} powers up to ${powerLevel} level.` : "Track attacks, stances and equipment-driven actions.",
      isManeuver ? `Reserve ${maneuverDice} maneuver dice; refresh rules depend on the exact archetype.` : "No default maneuver dice from this class profile.",
      level < 20 ? `Next progression checkpoint: level ${nextTier}.` : "Level 20 capstone tier.",
    ],
  };
}

function renderCharacterProgression(character) {
  const profile = classProgressionProfile(character);
  document.querySelector("#character-build-source").textContent = profile.source;
  document.querySelector("#character-progression").innerHTML = `
    <div class="progression-stat"><span>Level</span><strong>${profile.level}</strong></div>
    <div class="progression-stat"><span>Prof.</span><strong>+${profile.profBonus}</strong></div>
    <div class="progression-stat"><span>Hit dice</span><strong>${profile.hitDice}</strong></div>
    <div class="progression-stat"><span>Powers</span><strong>${profile.powerLevel}</strong></div>
    <div class="progression-stat"><span>Maneuvers</span><strong>${profile.maneuverDice || "-"}</strong></div>
    <ul>${profile.prompts.map((prompt) => `<li>${escapeHtml(prompt)}</li>`).join("")}</ul>`;
}

function selectedCharacterItem(character = currentCharacter()) {
  return character?.inventory.find((item) => item.id === characterState.selectedItemId) || null;
}

function itemEquippedSlot(character, item) {
  if (!character || !item) return "";
  return Object.entries(character.equipped || {}).find(([, id]) => id === item.id)?.[0] || "";
}

function renderSelectedItemPanel(character, item) {
  const panel = document.querySelector("#selected-item-panel");
  if (!item) {
    panel.innerHTML = `
      <div class="selected-item-empty">
        <strong>No item selected</strong>
        <span>Pick cargo, then click a matching anatomy slot or use quick actions here.</span>
      </div>`;
    return;
  }
  const equippedSlot = itemEquippedSlot(character, item);
  const targetSlot = item.slot || equippedSlot || "";
  const detail = [item.category, item.rarity, item.damage, item.armorClass].filter(Boolean).join(" · ");
  panel.innerHTML = `
    <article>
      <small>SELECTED ITEM</small>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(detail || item.description || "Cargo item")}</p>
      <dl>
        <dt>Slot</dt><dd>${escapeHtml(equippedSlot || targetSlot || "Cargo")}</dd>
        <dt>Weight</dt><dd>${Number(item.weight || 0)} lb</dd>
        <dt>Value</dt><dd>${Number(item.value || 0).toLocaleString()} cr</dd>
        <dt>Status</dt><dd>${equippedSlot ? "Equipped" : "In stash"}</dd>
      </dl>
      <div class="selected-item-actions">
        <button data-character-item-action="equip" ${targetSlot && !equippedSlot ? "" : "disabled"}>Equip</button>
        <button data-character-item-action="unequip" ${equippedSlot ? "" : "disabled"}>Unequip</button>
        <button data-character-item-action="open">Sheet</button>
        <button data-character-item-action="sell">Sell</button>
      </div>
    </article>`;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(encoded) {
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

async function derivePlayerNoteKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPlayerNote(password, note) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePlayerNoteKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(note));
  return `aesgcm:${JSON.stringify({ salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) })}`;
}

async function decryptPlayerNote(password, sealed) {
  if (!sealed.startsWith("aesgcm:")) {
    const decoded = decodeURIComponent(escape(atob(sealed)));
    const [storedPassword, ...noteParts] = decoded.split(":");
    if (storedPassword !== password) throw new Error("Wrong password");
    return noteParts.join(":");
  }
  const payload = JSON.parse(sealed.slice("aesgcm:".length));
  const key = await derivePlayerNoteKey(password, base64ToBytes(payload.salt));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
  return new TextDecoder().decode(plaintext);
}

function renderCharacters() {
  const character = currentCharacter();
  if (!character) return;
  const picker = document.querySelector("#character-picker");
  picker.innerHTML = characterState.characters.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${escapeHtml(item.species)}</option>`).join("");
  picker.value = character.id;
  document.querySelector("#character-name").textContent = character.name;
  document.querySelector("#character-species").value = character.species;
  ensureSelectOption(document.querySelector("#character-class"), character.className);
  document.querySelector("#character-class").value = character.className;
  document.querySelector("#character-level").value = character.level || 1;
  document.querySelector("#character-subclass").value = character.subclass || "";
  const template = safeCharacterTemplate(character);
  document.querySelector("#character-template").value = template;
  document.querySelector("#character-template-image").src = `/assets/character_templates/inventory-${template}.png`;
  const equippedItems = Object.values(character.equipped).map((id) => character.inventory.find((item) => item.id === id)).filter(Boolean);
  const ac = characterArmorClass(character, equippedItems);
  const attack = equippedItems.reduce((total, item) => total + (item.attack || 0), 0);
  const weight = character.inventory.reduce((total, item) => total + item.weight, 0);
  const equippedIds = new Set(Object.values(character.equipped));
  const cargoItems = character.inventory.filter((item) => !equippedIds.has(item.id));
  const selectedItem = selectedCharacterItem(character);
  if (characterState.selectedItemId && !selectedItem) characterState.selectedItemId = null;
  document.querySelector("#character-ac").textContent = ac;
  document.querySelector("#character-attack").textContent = `${attack >= 0 ? "+" : ""}${attack}`;
  document.querySelector("#character-weight").textContent = weight;
  document.querySelector("#character-credits").textContent = `${character.credits || 0} cr`;
  document.querySelector("#cargo-capacity").textContent = `${weight} / ${character.cargoCapacity || 100} lb`;
  document.querySelector("#sell-selected-item").disabled = !characterState.selectedItemId;
  document.querySelectorAll("[data-slot]").forEach((slot) => {
    const item = character.inventory.find((candidate) => candidate.id === character.equipped[slot.dataset.slot]);
    slot.querySelector("strong").textContent = item?.name || "Empty";
    slot.classList.toggle("filled", Boolean(item));
    slot.classList.toggle("target", Boolean(characterState.selectedItemId && character.inventory.find((candidate) => candidate.id === characterState.selectedItemId)?.slot === slot.dataset.slot));
  });
  document.querySelectorAll("[data-body-fill]").forEach((part) => {
    const slots = part.dataset.bodyFill === "hands" ? ["hands", "mainHand", "offHand"] : [part.dataset.bodyFill];
    part.classList.toggle("filled", slots.some((slot) => Boolean(character.equipped[slot])));
  });
  document.querySelector("#character-stash").innerHTML = character.inventory
    .filter((item) => !equippedIds.has(item.id))
    .map((item) => `
      <button class="stash-item ${item.id === characterState.selectedItemId ? "selected" : ""}" data-item-id="${item.id}">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.slot ? escapeHtml(item.slot) : "cargo"} · ${item.weight} lb${item.ac ? ` · +${item.ac} AC` : ""}${item.attack ? ` · +${item.attack} attack` : ""}</span>
      </button>`).join("") || `<p class="stash-empty">${character.inventory.length ? "All carried gear is currently equipped." : "No cargo yet. Add gear from the SW5e catalog or create a custom item."}</p>`;
  document.querySelector("#stash-summary").textContent = `${equippedItems.length} equipped · ${cargoItems.length} cargo`;
  document.querySelector(".character-roster .notes-sidebar-header").title = `${equippedItems.length} equipped · ${cargoItems.length} cargo`;
  renderSelectedItemPanel(character, selectedItem);
  document.querySelector("#resource-rings").innerHTML = Object.entries(character.resources).map(([key, resource]) => `
    <div class="resource-ring" style="--fill:${Math.max(0, Math.min(100, resource.value / resource.max * 100))}%;--ring-color:${resource.color}">
      <div class="resource-ring-inner">
        <strong>${resource.value}/${resource.max}</strong><small>${resource.label}</small>
        <span class="resource-ring-controls"><button data-resource="${key}" data-delta="-1">−</button><button data-resource="${key}" data-delta="1">＋</button></span>
      </div>
    </div>`).join("");
  document.querySelector("#alignment-slider").value = character.alignment;
  document.querySelector("#alignment-output").textContent = alignmentLabel(character.alignment);
  document.querySelector("#passive-insight").value = character.passiveInsight;
  document.querySelector("#gm-hooks").value = character.gmHooks;
  document.querySelector("#shared-character-note").value = character.sharedNote;
  document.querySelector("#player-secret-note").value = character.playerSecretSealed ? "[sealed]" : character.playerSecretNote;
  document.querySelector("#player-secret-note").disabled = Boolean(character.playerSecretSealed);
  document.querySelector("#seal-player-note").disabled = Boolean(character.playerSecretSealed);
  document.querySelector("#unlock-player-note").disabled = !character.playerSecretSealed;
  renderCharacterProgression(character);
}

function characterFromPregen(pregen) {
  const character = structuredClone(defaultCharacter);
  const selectedLevel = pregen.levels?.find((level) => level.level === pregen.max_level) || pregen.levels?.[0];
  character.id = crypto.randomUUID();
  character.name = pregen.name;
  character.species = pregen.species || "Human";
  character.className = pregen.class || "";
  character.subclass = pregen.subclass || "";
  character.level = selectedLevel?.level || pregen.max_level || 1;
  character.template = character.species === "Zabrak" ? "zabrak-male" : "human-male";
  character.inventory = [];
  character.equipped = {};
  character.credits = 500 + character.level * 150;
  character.gmHooks = `Imported from ${pregen.archive}: ${selectedLevel?.path || pregen.name}`;
  character.sharedNote = `${character.species} ${character.className}${character.subclass ? ` - ${character.subclass}` : ""}, level ${character.level}.`;
  character.resources.hp.max = Math.max(10, 8 + character.level * 7);
  character.resources.hp.value = character.resources.hp.max;
  character.resources.force.value = character.className?.match(/consular|guardian|sentinel/i) ? Math.max(2, character.level * 2) : 0;
  character.resources.force.max = character.resources.force.value;
  character.resources.tech.value = character.className?.match(/engineer|scholar|scout|operative/i) ? Math.max(2, character.level * 2) : 0;
  character.resources.tech.max = character.resources.tech.value;
  character.resources.hitDice.value = character.level;
  character.resources.hitDice.max = character.level;
  return normalizeCharacter(character);
}

async function loadPregens() {
  const select = document.querySelector("#pregen-select");
  try {
    const response = await fetch("/api/characters/pregens");
    if (!response.ok) throw new Error("Pregens unavailable");
    const payload = await response.json();
    pregenCatalog = payload.items || [];
    document.querySelector("#pregen-count").textContent = `${pregenCatalog.length} sheets`;
    select.innerHTML = pregenCatalog.map((pregen, index) =>
      `<option value="${index}">${escapeHtml(pregen.name)} · Lv ${pregen.max_level} · ${escapeHtml(pregen.archive)}</option>`
    ).join("") || '<option value="">No pregen ZIPs found</option>';
  } catch {
    document.querySelector("#pregen-count").textContent = "Unavailable";
    select.innerHTML = '<option value="">Pregen ZIPs unavailable</option>';
  }
}

document.querySelector("#character-picker").addEventListener("change", (event) => {
  characterState.activeId = event.target.value;
  characterState.selectedItemId = null;
  saveCharacters();
  renderCharacters();
});
document.querySelector("#character-stash").addEventListener("click", (event) => {
  const item = event.target.closest("[data-item-id]");
  if (!item) return;
  characterState.selectedItemId = characterState.selectedItemId === item.dataset.itemId ? null : item.dataset.itemId;
  renderCharacters();
});
document.querySelector(".paper-doll").addEventListener("click", (event) => {
  const slot = event.target.closest("[data-slot]");
  const character = currentCharacter();
  if (!slot || !character) return;
  const selected = character.inventory.find((item) => item.id === characterState.selectedItemId);
  if (selected?.slot === slot.dataset.slot) {
    character.equipped[slot.dataset.slot] = selected.id;
    characterState.selectedItemId = null;
  } else if (!selected && character.equipped[slot.dataset.slot]) {
    delete character.equipped[slot.dataset.slot];
  }
  saveCharacters();
  renderCharacters();
});
document.querySelector("#resource-rings").addEventListener("click", (event) => {
  const button = event.target.closest("[data-resource]");
  const character = currentCharacter();
  if (!button || !character) return;
  const resource = character.resources[button.dataset.resource];
  resource.value = Math.max(0, Math.min(resource.max, resource.value + Number(button.dataset.delta)));
  saveCharacters();
  renderCharacters();
});
document.querySelector("#character-species").addEventListener("change", (event) => {
  currentCharacter().species = event.target.value;
  saveCharacters();
  renderCharacters();
});
document.querySelector("#character-class").addEventListener("change", (event) => {
  currentCharacter().className = event.target.value;
  saveCharacters();
  renderCharacters();
});
document.querySelector("#character-level").addEventListener("input", (event) => {
  currentCharacter().level = Math.max(1, Math.min(20, Number(event.target.value || 1)));
  saveCharacters();
  renderCharacters();
});
document.querySelector("#character-subclass").addEventListener("input", (event) => {
  currentCharacter().subclass = event.target.value;
  saveCharacters();
  renderCharacters();
});
document.querySelector("#character-template").addEventListener("change", (event) => {
  currentCharacter().template = event.target.value;
  saveCharacters();
  renderCharacters();
});
document.querySelector("#alignment-slider").addEventListener("input", (event) => {
  currentCharacter().alignment = Number(event.target.value);
  document.querySelector("#alignment-output").textContent = alignmentLabel(currentCharacter().alignment);
  saveCharacters();
});
document.querySelector("#passive-insight").addEventListener("input", (event) => {
  currentCharacter().passiveInsight = Number(event.target.value);
  saveCharacters();
});
document.querySelector("#gm-hooks").addEventListener("input", (event) => {
  currentCharacter().gmHooks = event.target.value;
  saveCharacters();
});
document.querySelector("#shared-character-note").addEventListener("input", (event) => {
  currentCharacter().sharedNote = event.target.value;
  saveCharacters();
});
document.querySelector("#player-secret-note").addEventListener("input", (event) => {
  if (currentCharacter().playerSecretSealed) return;
  currentCharacter().playerSecretNote = event.target.value;
  saveCharacters();
});
document.querySelector("#seal-player-note").addEventListener("click", async () => {
  const character = currentCharacter();
  const password = document.querySelector("#player-note-password").value;
  if (!character || !password || !character.playerSecretNote) return;
  try {
    character.playerSecretSealed = await encryptPlayerNote(password, character.playerSecretNote);
    character.playerSecretNote = "";
    document.querySelector("#player-note-password").value = "";
    saveCharacters();
    renderCharacters();
  } catch {
    document.querySelector("#player-note-password").value = "";
    document.querySelector("#player-note-password").placeholder = "Encryption unavailable";
  }
});
document.querySelector("#unlock-player-note").addEventListener("click", async () => {
  const character = currentCharacter();
  const passwordInput = document.querySelector("#player-note-password");
  const password = passwordInput.value;
  if (!character || !password || !character.playerSecretSealed) return;
  try {
    character.playerSecretNote = await decryptPlayerNote(password, character.playerSecretSealed);
    character.playerSecretSealed = "";
    passwordInput.value = "";
    passwordInput.placeholder = "Player note password";
    saveCharacters();
    renderCharacters();
  } catch {
    passwordInput.value = "";
    passwordInput.placeholder = "Seal unreadable";
  }
});
document.querySelector("#clear-player-note-seal").addEventListener("click", () => {
  const character = currentCharacter();
  if (!character) return;
  character.playerSecretSealed = "";
  character.playerSecretNote = "";
  saveCharacters();
  renderCharacters();
});
document.querySelector("#new-character").addEventListener("click", () => document.querySelector("#character-dialog").showModal());
document.querySelector("#import-pregen").addEventListener("click", () => {
  const pregen = pregenCatalog[Number(document.querySelector("#pregen-select").value)];
  if (!pregen) return;
  const character = characterFromPregen(pregen);
  characterState.characters.push(character);
  characterState.activeId = character.id;
  characterState.selectedItemId = null;
  saveCharacters();
  renderCharacters();
});
document.querySelector("#deploy-character").addEventListener("click", () => {
  const character = currentCharacter();
  if (!character) return;
  const existing = state.combatants.find((combatant) => combatant.characterId === character.id || combatant.name === character.name);
  if (!existing) {
    const equippedItems = Object.values(character.equipped).map((id) => character.inventory.find((item) => item.id === id)).filter(Boolean);
    const ac = characterArmorClass(character, equippedItems);
    const point = {
      x: (shell.clientWidth / 2 - state.offset.x) / state.zoom,
      y: (shell.clientHeight / 2 - state.offset.y) / state.zoom,
    };
    addCombatant({
      name: character.name,
      type: "player",
      hp: character.resources.hp.max,
      ac,
      characterId: character.id,
      actions: ["Weapon attack"],
    }, point);
    state.combatants[state.combatants.length - 1].characterId = character.id;
  }
  document.querySelector('[data-view="battlemap"]').click();
  persist();
  draw();
});
document.querySelector("#delete-character").addEventListener("click", () => {
  if (characterState.characters.length <= 1) return;
  const currentId = characterState.activeId;
  characterState.characters = characterState.characters.filter((character) => character.id !== currentId);
  characterState.activeId = characterState.characters[0].id;
  characterState.selectedItemId = null;
  saveCharacters();
  renderCharacters();
});
let itemCatalogCache = [];
let itemCatalogTimer;
let compendiumItemCache = [];
let compendiumSearchCache = [];
let activeDetailItem = null;
const equipmentBrowser = { offset: 0, limit: 48, total: 0, categoriesLoaded: false };

function inferredItemSlot(item) {
  const category = String(item.category || "").toLowerCase();
  const classification = String(item.armor_classification || "").toLowerCase();
  if (classification === "shield" || category.includes("shield")) return "offHand";
  if (category === "armor" || category.includes("clothing")) return "chest";
  if (category === "weapon") return "mainHand";
  return null;
}

function addCatalogItemToCharacter(source) {
  const character = currentCharacter();
  if (!source || !character) return null;
  const item = {
    id: crypto.randomUUID(),
    catalogId: source.id,
    name: source.name,
    description: source.description || "",
    category: source.category,
    weight: Number(source.weight || 0),
    value: Number(source.cost || 0),
    slot: inferredItemSlot(source),
    armorClass: source.armor_class || "",
    damage: source.damage || "",
    rarity: source.rarity || "",
    properties: source.properties || [],
  };
  character.inventory.push(item);
  characterState.selectedItemId = item.id;
  saveCharacters();
  renderCharacters();
  return item;
}

function sellSelectedCharacterItem() {
  const character = currentCharacter();
  const item = selectedCharacterItem(character);
  if (!character || !item) return;
  const equippedSlot = itemEquippedSlot(character, item);
  if (equippedSlot) delete character.equipped[equippedSlot];
  character.credits = (character.credits || 0) + Math.floor((item.value || 0) / 2);
  character.inventory = character.inventory.filter((candidate) => candidate.id !== item.id);
  characterState.selectedItemId = null;
  saveCharacters();
  renderCharacters();
}

function renderItemCatalog(items, total) {
  itemCatalogCache = items;
  document.querySelector("#item-library-summary").textContent = `${total} matching items · showing ${items.length}`;
  document.querySelector("#item-library-results").innerHTML = items.map((item, index) => {
    const detail = [item.category, item.rarity, item.damage, item.armor_class].filter(Boolean).join(" · ");
    const description = item.description ? item.description.replace(/\s+/g, " ").slice(0, 180) : "No short description available.";
    return `<article class="item-entry" data-open-library-item="${index}">
      <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(detail)} · ${Number(item.cost || 0).toLocaleString()} cr · ${item.weight || 0} lb</span><small>${escapeHtml(description)}</small></div>
      <span class="item-entry-actions">
        <button class="library-entry-map" data-open-library-item="${index}" title="Open item sheet" aria-label="Open ${escapeHtml(item.name)}">⌕</button>
        <button class="library-entry-add" data-add-item="${index}" title="Add to inventory" aria-label="Add ${escapeHtml(item.name)} to inventory">＋</button>
      </span>
    </article>`;
  }).join("") || '<p class="loading-line">No item matched these filters.</p>';
}

async function loadItemCatalog() {
  const search = document.querySelector("#item-library-search").value.trim();
  const category = document.querySelector("#item-library-category").value;
  const params = new URLSearchParams({ limit: "120" });
  if (search) params.set("q", search);
  if (category) params.set("category", category);
  document.querySelector("#item-library-summary").textContent = "Loading SW5e catalog…";
  try {
    const response = await fetch(`/api/catalog/items?${params}`);
    if (!response.ok) throw new Error("Catalog unavailable");
    const payload = await response.json();
    const categorySelect = document.querySelector("#item-library-category");
    if (categorySelect.options.length === 1) {
      for (const value of payload.categories) categorySelect.add(new Option(value, value));
      categorySelect.value = category;
    }
    renderItemCatalog(payload.items, payload.total);
  } catch {
    document.querySelector("#item-library-summary").textContent = "Catalog unavailable. Check the local server connection.";
    document.querySelector("#item-library-results").innerHTML = "";
  }
}

document.querySelector("#add-inventory-item").addEventListener("click", () => {
  document.querySelector("#item-library-dialog").showModal();
  loadItemCatalog();
});
document.querySelector("#item-library-search").addEventListener("input", () => {
  clearTimeout(itemCatalogTimer);
  itemCatalogTimer = setTimeout(loadItemCatalog, 180);
});
document.querySelector("#item-library-category").addEventListener("change", loadItemCatalog);
document.querySelector("#add-custom-item").addEventListener("click", () => {
  document.querySelector("#item-library-dialog").close();
  document.querySelector("#inventory-dialog").showModal();
});
document.querySelector("#item-library-results").addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-library-item]");
  if (open && !event.target.closest("[data-add-item]")) {
    openItemDetail(itemCatalogCache[Number(open.dataset.openLibraryItem)]);
    return;
  }
  const button = event.target.closest("[data-add-item]");
  if (!button) return;
  const source = itemCatalogCache[Number(button?.dataset.addItem)];
  if (!addCatalogItemToCharacter(source)) return;
  button.textContent = "✓";
  button.disabled = true;
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(`#${button.dataset.closeDialog}`).close();
}));
document.querySelector("#character-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const character = structuredClone(defaultCharacter);
  character.id = crypto.randomUUID();
  character.name = data.name;
  character.species = data.species;
  character.className = data.className || "Fighter";
  character.subclass = data.subclass || "";
  character.level = Math.max(1, Math.min(20, Number(data.level || 1)));
  character.template = data.species === "Zabrak" ? "zabrak-male" : "human-male";
  character.inventory = [];
  character.equipped = {};
  character.credits = 500;
  character.sharedNote = `${character.species} ${character.className}${character.subclass ? ` - ${character.subclass}` : ""}, level ${character.level}.`;
  characterState.characters.push(character);
  characterState.activeId = character.id;
  saveCharacters();
  renderCharacters();
  event.currentTarget.reset();
  document.querySelector("#character-dialog").close();
});
document.querySelector("#inventory-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const item = {
    id: crypto.randomUUID(),
    name: data.name,
    weight: Number(data.weight),
    value: Number(data.value),
    slot: data.slot || null,
  };
  currentCharacter().inventory.push(item);
  characterState.selectedItemId = item.id;
  saveCharacters();
  renderCharacters();
  event.currentTarget.reset();
  document.querySelector("#inventory-dialog").close();
});
document.querySelector(".credit-control").addEventListener("click", (event) => {
  const button = event.target.closest("[data-credit-delta]");
  if (!button) return;
  currentCharacter().credits = Math.max(0, (currentCharacter().credits || 0) + Number(button.dataset.creditDelta));
  saveCharacters();
  renderCharacters();
});
document.querySelector("#selected-item-panel").addEventListener("click", (event) => {
  const button = event.target.closest("[data-character-item-action]");
  const character = currentCharacter();
  const item = selectedCharacterItem(character);
  if (!button || !character || !item) return;
  const action = button.dataset.characterItemAction;
  if (action === "equip") {
    const slot = item.slot || itemEquippedSlot(character, item);
    if (!slot) return;
    character.equipped[slot] = item.id;
    characterState.selectedItemId = item.id;
    saveCharacters();
    renderCharacters();
  }
  if (action === "unequip") {
    const slot = itemEquippedSlot(character, item);
    if (slot) delete character.equipped[slot];
    characterState.selectedItemId = item.id;
    saveCharacters();
    renderCharacters();
  }
  if (action === "open") openItemDetail(item);
  if (action === "sell") sellSelectedCharacterItem();
});
document.querySelector("#sell-selected-item").addEventListener("click", () => {
  sellSelectedCharacterItem();
});

renderCharacters();

function citationLabel(result) {
  const pages = result.page_start
    ? `p. ${result.page_start}${result.page_end && result.page_end !== result.page_start ? `–${result.page_end}` : ""}`
    : "page unknown";
  return `${result.source_title} · ${pages}`;
}

function compendiumResultTitle(item) {
  const heading = String(item.excerpt || "").match(/^#\s+([^\n#]+)/)?.[1]?.trim();
  if (heading && !heading.includes("|")) return heading;
  return item.section_title || item.source_title;
}

function compendiumExcerptHtml(excerpt) {
  if (/\|\s*:?-{3,}/.test(excerpt)) {
    return "<p>This result is a reference index. Use the source citation to open the corresponding structured entry.</p>";
  }
  return markdownToHtml(excerpt);
}

function compendiumResultMeta(item) {
  const page = item.page_start
    ? `p. ${item.page_start}${item.page_end && item.page_end !== item.page_start ? `-${item.page_end}` : ""}`
    : "page unknown";
  return [
    item.knowledge_type?.replaceAll("_", " "),
    item.source_title,
    page,
  ].filter(Boolean);
}

async function searchCompendium(query) {
  const input = document.querySelector("#compendium-search");
  query = (query ?? input.value).trim();
  if (!query) return;
  input.value = query;
  const results = document.querySelector("#compendium-results");
  document.querySelector("#equipment-filters").hidden = true;
  results.classList.remove("equipment-card-grid");
  results.classList.add("rules-card-grid");
  results.innerHTML = '<p class="loading-line">Searching local index…</p>';
  document.querySelector("#results-count").textContent = "Searching";
  try {
    const response = await fetch(`/api/rules/search?q=${encodeURIComponent(query)}&limit=30`);
    if (!response.ok) throw new Error("Search failed");
    const items = await response.json();
    compendiumSearchCache = items;
    document.querySelector("#results-count").textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;
    results.innerHTML = items.map((item, index) => `
      <article class="search-result">
        <header><h3>${escapeHtml(compendiumResultTitle(item))}</h3><button class="text-button" data-save-rule-result="${index}" type="button">Save</button></header>
        <div class="result-meta">${compendiumResultMeta(item).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
        <div class="markdown-body">${compendiumExcerptHtml(item.excerpt)}</div>
        <footer>${escapeHtml(citationLabel(item))}</footer>
      </article>`).join("") || '<p class="loading-line">No indexed source matched this query.</p>';
  } catch {
    document.querySelector("#results-count").textContent = "Unavailable";
    results.innerHTML = '<p class="loading-line">The local index is unavailable. Run the ingestion command to rebuild it.</p>';
  }
}

function itemPropertyLabel(property) {
  if (!property) return "";
  if (typeof property === "string") return property;
  return property.name || property.content || property.description || String(property);
}

const itemPropertyGlossary = {
  ammunition: "Consumes ammunition; track shots or power cells when scarcity matters.",
  auto: "Can fire bursts or sustained volleys when the weapon rules allow it.",
  burst: "Targets an area rather than a single creature; usually calls for a saving throw.",
  cartridge: "Consumes a cartridge or magazine; track reloads when ammunition matters.",
  cell: "Uses an energy cell or similar power source as ammunition.",
  brutal: "Extra damage dice from critical hits or similar triggers are more dangerous.",
  conceal: "Can be hidden on the body more easily than a normal weapon.",
  dexterity: "Can use Dexterity for attack and damage when the rules allow finesse handling.",
  disarming: "Can pressure, knock loose, or interact with held objects.",
  double: "Has two striking ends or attack surfaces.",
  finesse: "Can use Strength or Dexterity for attack and damage.",
  fixed: "Designed for mounted, braced, or emplacement use.",
  heavy: "Awkward for smaller creatures and usually requires more commitment to wield.",
  keen: "Improves critical threat or precision depending on the weapon entry.",
  light: "Easy to handle in the off hand or with two-weapon fighting rules.",
  luminous: "Emits light or has a visible energy signature.",
  piercing: "Built to punch through defenses or cover more effectively.",
  penetrating: "Ignores or reduces defenses according to the property value.",
  powercell: "Uses a power cell; the range in parentheses is normal/long range.",
  range: "Uses a normal and long range; attacks beyond normal range are harder.",
  reach: "Extends melee reach beyond adjacent targets.",
  reload: "Can fire a limited number of shots before an action or interaction reloads it.",
  returning: "Can come back to the wielder after being thrown.",
  special: "Has item-specific rules; open the compendium/source entry for the full text.",
  strength: "Uses Strength for attack and damage or has a Strength requirement.",
  thrown: "Can be used as a ranged attack by throwing it.",
  twohanded: "Requires two hands while attacking.",
  versatile: "Can be wielded one-handed or two-handed, often changing damage.",
};

function propertyKey(property) {
  return String(property || "").toLowerCase().replace(/[^a-z]/g, "");
}

function itemPropertyHelp(property) {
  const normalized = propertyKey(property);
  const key = Object.keys(itemPropertyGlossary).find((candidate) => normalized.startsWith(candidate));
  return key ? itemPropertyGlossary[key] : "Open this property in the compendium for the full rule text.";
}

function propertyChipMarkup(property) {
  const label = itemPropertyLabel(property);
  const help = itemPropertyHelp(label);
  return `<button data-property-search="${escapeHtml(label)}" title="${escapeHtml(help)}" aria-label="${escapeHtml(`${label}: ${help}`)}">${escapeHtml(label)}</button>`;
}

function catalogLabel(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/SW5e/g, "SW5e")
    .trim();
}

function itemDetailMarkup(item) {
  const properties = (item.properties || []).map(itemPropertyLabel).filter(Boolean);
  const description = (item.description || "").replace(/\s+/g, " ").trim() || "No description available in the local SW5e catalog.";
  const lines = [
    ["Category", catalogLabel(item.category)],
    ["Kind", item.kind],
    ["Rarity", item.rarity],
    ["Cost", `${Number(item.cost || 0).toLocaleString()} cr`],
    ["Weight", `${item.weight || 0} lb`],
    ["Damage", item.damage],
    ["Damage type", item.damage_type],
    ["Armor class", item.armor_class],
    ["Weapon class", item.weapon_classification],
    ["Armor class", item.armor_classification],
    ["Source", item.source],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  return `
    <dl class="item-detail-stats">${lines.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
    <div class="property-chips detail">${properties.map(propertyChipMarkup).join("") || '<span>No listed properties</span>'}</div>
    ${properties.length ? `<div class="property-help-list">${properties.map((property) => `<p><strong>${escapeHtml(property)}</strong><span>${escapeHtml(itemPropertyHelp(property))}</span></p>`).join("")}</div>` : ""}
    <p>${escapeHtml(description)}</p>`;
}

function openItemDetail(item) {
  if (!item) return;
  activeDetailItem = item;
  document.querySelector("#item-detail-title").textContent = item.name;
  document.querySelector("#item-detail-content").innerHTML = itemDetailMarkup(item);
  document.querySelector("#item-detail-dialog").showModal();
}

function saveRuleResultAsNote(index) {
  const item = compendiumSearchCache[Number(index)];
  if (!item) return;
  const title = compendiumResultTitle(item);
  createNote(`Rule · ${title}`, `# ${title}

${item.excerpt || ""}

## Source

${citationLabel(item)}
`);
  document.querySelector('[data-view="notes"]').click();
}

function saveCompendiumItemAsNote(index) {
  const item = compendiumItemCache[Number(index)];
  if (!item) return;
  const properties = (item.properties || []).map(itemPropertyLabel).filter(Boolean);
  const lines = [
    `- Category: ${catalogLabel(item.category)}`,
    item.kind ? `- Kind: ${item.kind}` : "",
    item.rarity ? `- Rarity: ${item.rarity}` : "",
    `- Cost: ${Number(item.cost || 0).toLocaleString()} cr`,
    `- Weight: ${item.weight || 0} lb`,
    item.damage ? `- Damage: ${item.damage}` : "",
    item.armor_class ? `- Armor class: ${item.armor_class}` : "",
    item.source ? `- Source: ${item.source}` : "",
  ].filter(Boolean).join("\n");
  createNote(`Item · ${item.name}`, `# ${item.name}

${lines}

## Properties

${properties.length ? properties.map((property) => `- **${property}:** ${itemPropertyHelp(property)}`).join("\n") : "- No listed properties"}

## Description

${item.description || "No description available in the local SW5e catalog."}
`);
  document.querySelector('[data-view="notes"]').click();
}

async function renderEquipmentCompendium() {
  const input = document.querySelector("#compendium-search");
  const category = document.querySelector("#compendium-item-category").value;
  const kind = document.querySelector("#compendium-item-kind").value;
  const params = new URLSearchParams({ limit: String(equipmentBrowser.limit), offset: String(equipmentBrowser.offset) });
  if (input.value.trim()) params.set("q", input.value.trim());
  if (category) params.set("category", category);
  if (kind) params.set("kind", kind);
  const results = document.querySelector("#compendium-results");
  document.querySelector("#equipment-filters").hidden = false;
  results.classList.add("equipment-card-grid");
  results.classList.remove("rules-card-grid");
  results.innerHTML = '<p class="loading-line">Loading SW5e equipment cards...</p>';
  document.querySelector("#results-count").textContent = "Loading equipment";
  try {
    const response = await fetch(`/api/catalog/items?${params}`);
    if (!response.ok) throw new Error("Catalog unavailable");
    const payload = await response.json();
    equipmentBrowser.total = payload.total;
    compendiumItemCache = payload.items;
    compendiumSearchCache = [];
    if (!equipmentBrowser.categoriesLoaded) {
      const select = document.querySelector("#compendium-item-category");
      for (const value of payload.categories) select.add(new Option(catalogLabel(value), value));
      equipmentBrowser.categoriesLoaded = true;
    }
    const start = payload.total ? equipmentBrowser.offset + 1 : 0;
    const end = Math.min(equipmentBrowser.offset + payload.items.length, payload.total);
    document.querySelector("#results-count").textContent = `${start}-${end} of ${payload.total} equipment result${payload.total === 1 ? "" : "s"}`;
    document.querySelector("#equipment-prev").disabled = equipmentBrowser.offset <= 0;
    document.querySelector("#equipment-next").disabled = equipmentBrowser.offset + equipmentBrowser.limit >= payload.total;
    results.innerHTML = payload.items.map((item, index) => {
      const properties = (item.properties || []).map(itemPropertyLabel).filter(Boolean);
      const detail = [catalogLabel(item.category), item.rarity, item.damage, item.armor_class].filter(Boolean).join(" · ");
      return `<article class="equipment-card" data-open-item="${index}">
        <header><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.kind)}</span></header>
        <p>${escapeHtml(detail || item.source || "SW5e catalog")}</p>
        <dl><dt>Cost</dt><dd>${Number(item.cost || 0).toLocaleString()} cr</dd><dt>Weight</dt><dd>${item.weight || 0} lb</dd></dl>
        <div class="property-chips">${properties.slice(0, 8).map(propertyChipMarkup).join("")}</div>
        <small>${escapeHtml((item.description || "").replace(/\s+/g, " ").slice(0, 260))}</small>
        <footer><button class="secondary-button" data-save-item-result="${index}" type="button">Save item note</button></footer>
      </article>`;
    }).join("") || '<p class="loading-line">No matching equipment.</p>';
  } catch {
    document.querySelector("#results-count").textContent = "Unavailable";
    results.innerHTML = '<p class="loading-line">The SW5e item catalog is unavailable. Refresh the local catalog when the network is available.</p>';
  }
}

document.querySelector("#run-compendium-search").addEventListener("click", () => {
  if (document.querySelector(".compendium-preset.active")?.dataset.compendiumMode === "equipment") {
    equipmentBrowser.offset = 0;
    renderEquipmentCompendium();
  }
  else searchCompendium();
});
document.querySelector("#compendium-search").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (document.querySelector(".compendium-preset.active")?.dataset.compendiumMode === "equipment") {
    equipmentBrowser.offset = 0;
    renderEquipmentCompendium();
  }
  else searchCompendium();
});
document.querySelector(".compendium-nav").addEventListener("click", (event) => {
  const preset = event.target.closest("[data-query]");
  const modePreset = event.target.closest("[data-compendium-mode]");
  const target = preset || modePreset;
  if (!target) return;
  document.querySelectorAll(".compendium-preset").forEach((item) => item.classList.toggle("active", item === target));
  if (modePreset?.dataset.compendiumMode === "equipment") {
    document.querySelector("#compendium-search").value = "";
    equipmentBrowser.offset = 0;
    renderEquipmentCompendium();
    return;
  }
  searchCompendium(preset.dataset.query);
});
document.querySelector("#compendium-item-category").addEventListener("change", () => {
  equipmentBrowser.offset = 0;
  renderEquipmentCompendium();
});
document.querySelector("#compendium-item-kind").addEventListener("change", () => {
  equipmentBrowser.offset = 0;
  renderEquipmentCompendium();
});
document.querySelector("#equipment-prev").addEventListener("click", () => {
  equipmentBrowser.offset = Math.max(0, equipmentBrowser.offset - equipmentBrowser.limit);
  renderEquipmentCompendium();
});
document.querySelector("#equipment-next").addEventListener("click", () => {
  const lastPage = Math.max(0, Math.floor((equipmentBrowser.total - 1) / equipmentBrowser.limit) * equipmentBrowser.limit);
  equipmentBrowser.offset = Math.min(lastPage, equipmentBrowser.offset + equipmentBrowser.limit);
  renderEquipmentCompendium();
});
document.querySelector("#compendium-results").addEventListener("click", (event) => {
  const saveRule = event.target.closest("[data-save-rule-result]");
  if (saveRule) {
    event.stopPropagation();
    saveRuleResultAsNote(saveRule.dataset.saveRuleResult);
    return;
  }
  const saveItem = event.target.closest("[data-save-item-result]");
  if (saveItem) {
    event.stopPropagation();
    saveCompendiumItemAsNote(saveItem.dataset.saveItemResult);
    return;
  }
  const property = event.target.closest("[data-property-search]");
  if (property) {
    searchCompendium(`weapon property ${property.dataset.propertySearch}`);
    document.querySelector("#item-detail-dialog")?.close();
    return;
  }
  const card = event.target.closest("[data-open-item]");
  if (card) openItemDetail(compendiumItemCache[Number(card.dataset.openItem)]);
});
document.querySelector("#item-detail-content").addEventListener("click", (event) => {
  const property = event.target.closest("[data-property-search]");
  if (!property) return;
  document.querySelector("#item-detail-dialog").close();
  searchCompendium(`weapon property ${property.dataset.propertySearch}`);
});
document.querySelector("#item-detail-add").addEventListener("click", () => {
  if (!addCatalogItemToCharacter(activeDetailItem)) return;
  document.querySelector("#item-detail-add").textContent = "Added";
  setTimeout(() => { document.querySelector("#item-detail-add").textContent = "Add to active character"; }, 900);
});
document.querySelector("#rules-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = document.querySelector("#rules-question").value.trim();
  if (!question) return;
  const answer = document.querySelector("#rules-answer");
  answer.innerHTML = '<p class="loading-line">Consulting local sources…</p>';
  try {
    const response = await fetch("/api/rules/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, limit: 8 }),
    });
    if (!response.ok) throw new Error("Rules lookup failed");
    const payload = await response.json();
    if (!payload.found) {
      answer.innerHTML = "<p>No matching rule was found in the local index.</p>";
      return;
    }
    answer.innerHTML = `<p>${escapeHtml(payload.answer)}</p>${payload.citations.map((citation) =>
      `<p class="citation">${escapeHtml(citationLabel(citation))}</p>`
    ).join("")}`;
  } catch {
    answer.innerHTML = "<p>The rules assistant could not reach the local index.</p>";
  }
});

let bookCatalog = [];
let activeBookId = null;

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderBookList() {
  const query = document.querySelector("#book-search").value.trim().toLowerCase();
  const books = bookCatalog.filter((book) => `${book.title} ${book.filename}`.toLowerCase().includes(query));
  document.querySelector("#book-list").innerHTML = books.map((book) => `
    <button class="book-entry ${book.id === activeBookId ? "active" : ""}" data-book-id="${escapeHtml(book.id)}">
      <i>PDF</i>
      <span><strong>${escapeHtml(book.title)}</strong><span>${formatBytes(book.size_bytes)}</span></span>
    </button>`).join("") || '<p class="loading-line">No matching sourcebook.</p>';
}

function openBook(book) {
  activeBookId = book.id;
  const frame = document.querySelector("#book-frame");
  const external = document.querySelector("#open-book-tab");
  frame.src = book.url;
  frame.hidden = false;
  document.querySelector("#reader-empty").hidden = true;
  document.querySelector("#reader-title").textContent = book.title;
  document.querySelector("#reader-size").textContent = formatBytes(book.size_bytes);
  external.href = book.url;
  external.hidden = false;
  renderBookList();
}

async function loadBooks() {
  const list = document.querySelector("#book-list");
  list.innerHTML = '<p class="loading-line">Loading local library…</p>';
  try {
    const response = await fetch("/api/books");
    if (!response.ok) throw new Error("Book library unavailable");
    const payload = await response.json();
    bookCatalog = payload.items;
    document.querySelector("#books-count").textContent = `${payload.total} books`;
    renderBookList();
  } catch {
    document.querySelector("#books-count").textContent = "Unavailable";
    list.innerHTML = '<p class="loading-line">The local book directory is unavailable.</p>';
  }
}

document.querySelector("#book-search").addEventListener("input", renderBookList);
document.querySelector("#book-list").addEventListener("click", (event) => {
  const entry = event.target.closest("[data-book-id]");
  const book = bookCatalog.find((item) => item.id === entry?.dataset.bookId);
  if (book) openBook(book);
});

const npcNames = {
  Human: ["Mara Venn", "Cal Jorren", "Tessa Rook", "Dain Ordo"],
  Zabrak: ["Vesh Korr", "Sira Drenn", "Keth Marr", "Ralo Vex"],
  Duros: ["Noro Daal", "Bane Ceto", "Luro Senn", "Dree Vanto"],
  "Twi'lek": ["Nima Vao", "Kora Syndulla", "Tann Ryl", "Veya Numa"],
  Wookiee: ["Rrakkorr", "Chevraaka", "Tarfful", "Kallabow"],
  Rodian: ["Greevo", "Neesh Ko", "Varko", "Seln Vee"],
  Chiss: ["Ar'alani", "Kres'ten", "Mitth'oro", "Vurawn"],
};
const speciesNamePatterns = {
  Human: { given: ["Mar", "Cal", "Tess", "Dain", "Korr", "Jessa", "Talon"], family: ["Venn", "Jorren", "Rook", "Ordo", "Vale", "Kestis"] },
  Zabrak: { given: ["Vesh", "Sira", "Keth", "Ralo", "Maul", "Eeth"], family: ["Korr", "Drenn", "Marr", "Vex", "Dath", "Irid"] },
  Duros: { given: ["Noro", "Bane", "Luro", "Dree", "Cad", "Shriv"], family: ["Daal", "Ceto", "Senn", "Vanto", "Tuun"] },
  "Twi'lek": { given: ["Nima", "Kora", "Tann", "Veya", "Lyn", "Oola"], family: ["Vao", "Syndulla", "Ryl", "Numa", "Taa"] },
  Wookiee: { chunks: ["rrak", "chev", "tar", "ful", "kalla", "bow", "warr", "kro", "bacca"] },
  Rodian: { given: ["Gree", "Neesh", "Var", "Seln", "Gre", "Wald"], family: ["vo", "Ko", "ko", "Vee", "Nata", "Dosh"] },
  Chiss: { core: ["Aral", "Kres", "Mitth", "Vur", "Thraw", "Sev"], suffix: ["ani", "ten", "oro", "awn", "uru", "res"] },
  Bothan: { given: ["Borsk", "Karka", "Trae", "Vri", "Nial", "Sian"], family: ["Fey'lya", "Kre'fey", "Soth", "Ba'tra", "Gor"] },
  "Mon Calamari": { given: ["Ack", "Ibt", "Meen", "Perit", "Gial", "Radd"], family: ["bar", "isam", "Koth", "Aqua", "Noss"] },
  Nautolan: { given: ["Kit", "Nahd", "Taro", "Vool", "Noss", "Plo"], family: ["Fisto", "Vebb", "Takka", "Ruun", "Kaal"] },
  Mirialan: { given: ["Lumin", "Barr", "Viss", "Sora", "Mira", "Kira"], family: ["ara", "iss", "Tann", "Offee", "Unduli"] },
  Togruta: { given: ["Ahsoka", "Shaak", "Roshti", "Kalti", "Aru", "Tano"], family: ["Tano", "Ti", "Venn", "Mon", "Ree"] },
  Trandoshan: { given: ["Boss", "Garn", "Ssk", "Krul", "Dosh", "Nak"], family: ["k", "trand", "orr", "Score", "Bossk"] },
  Weequay: { given: ["Hondo", "Sora", "Quay", "Tasu", "Vrek", "Nys"], family: ["Ohnaka", "Bulq", "Keth", "Nara", "Hask"] },
  Ithorian: { given: ["Momaw", "Tendau", "Roron", "Fandom", "Bol", "Orr"], family: ["Nadon", "Bendin", "Corobb", "Ree", "Thuun"] },
};
const npcRoles = ["Smuggler", "Bounty Hunter", "Officer", "Mechanic", "Informant", "Force Adept"];
const npcRoleTerms = {
  "Smuggler": ["smuggler", "pirate", "scoundrel", "thief"],
  "Bounty Hunter": ["hunter", "mercenary", "assassin", "bounty"],
  "Officer": ["officer", "captain", "commander", "trooper"],
  "Mechanic": ["engineer", "mechanic", "technician", "slicer"],
  "Informant": ["spy", "scout", "agent", "crime"],
  "Force Adept": ["jedi", "sith", "force", "adept"],
};
const npcRoleTemplates = {
  "Smuggler": { ac: 14, hp: 28, cr: "1", actions: ["Hold-out Blaster", "Dirty Trick", "Cunning Escape"], abilities: { str: "10", dex: "16", con: "12", int: "13", wis: "11", cha: "15" } },
  "Bounty Hunter": { ac: 16, hp: 45, cr: "3", actions: ["Multiattack", "Carbine Shot", "Wrist Launcher", "Net Snare"], abilities: { str: "13", dex: "16", con: "14", int: "12", wis: "14", cha: "10" } },
  "Officer": { ac: 15, hp: 36, cr: "2", actions: ["Commanding Shot", "Tactical Order", "Call Reinforcements"], abilities: { str: "11", dex: "14", con: "13", int: "15", wis: "12", cha: "16" } },
  "Mechanic": { ac: 13, hp: 24, cr: "1/2", actions: ["Ion Spanner", "Patch Droid", "Overload Device"], abilities: { str: "10", dex: "13", con: "12", int: "16", wis: "12", cha: "10" } },
  "Informant": { ac: 13, hp: 18, cr: "1/4", actions: ["Concealed Holdout", "Disengage", "Signal Contact"], abilities: { str: "8", dex: "15", con: "10", int: "14", wis: "14", cha: "13" } },
  "Force Adept": { ac: 15, hp: 38, cr: "3", actions: ["Saber Strike", "Force Push", "Mind Trick", "Deflect"], abilities: { str: "11", dex: "15", con: "13", int: "12", wis: "16", cha: "14" } },
};
const npcQuirks = [
  "Never sits with their back to a door.",
  "Collects obsolete navigation chips.",
  "Speaks to droids more politely than organics.",
  "Owes a dangerous favor to the Exchange.",
  "Recognizes one of the heroes from an old bounty.",
  "Refuses to draw a weapon inside a starship.",
];
const npcHooks = [
  "Has the access code the party needs, but wants a rival's ledger erased first.",
  "Carries a damaged holorecording that implicates a local official.",
  "Is being followed by a probe droid and does not know it.",
  "Can arrange transport through a blockade for a personal concession.",
  "Knows where the missing shipment landed, but the site is occupied.",
];
const npcDistinctions = [
  "Keeps one glove sealed and refuses to explain the scar beneath it.",
  "Has a droid caller welded into an old military medal.",
  "Wears faction colors that have been carefully desaturated.",
  "Carries a cracked sabacc card as a warning token.",
  "Has a voice modulator tuned half an octave too low.",
  "Never removes a visor etched with a dead squad's tally marks.",
];
const npcSecrets = [
  "Quietly feeds information to a rival cell when civilian lives are at stake.",
  "Is carrying forged credentials that will fail under a military-grade scan.",
  "Knows the location of a hidden cache, but not who else is watching it.",
  "Was paid to delay the party, not kill them.",
  "Recognized a party member's ship transponder before the conversation began.",
  "Needs help escaping a debt that is about to become violent.",
];
const lootMods = ["hair-trigger assembly", "balanced hilt", "enhanced power cell", "reinforced plating", "stealth field module", "targeting optic"];
const consumables = ["premium medpac", "adrenal stim", "fragmentation grenade", "repair kit", "shield generator charge", "antitoxin"];
const flavorParts = {
  cantina: [
    "A cracked jizz-box pushes a tired rhythm through the room while sabacc cards snap against a stained table.",
    "Blue smoke hangs beneath the ceiling fans, cut by the red blink of a bounty puck changing hands.",
    "The bartender polishes the same glass as three armed crews pretend not to watch the entrance.",
  ],
  location: [
    "Wind drives metallic dust through the abandoned concourse, ringing softly against shuttered kiosks.",
    "Faded Republic markings show beneath newer gang sigils, each layer telling a different occupation.",
    "The corridor lights wake one by one ahead of you, although the facility should have no power.",
  ],
  hazard: [
    "The deck bucks as a ruptured conduit spits white arcs across the only clear route.",
    "A low warning tone accelerates while the air takes on the sharp taste of ozone.",
    "Hairline fractures race across the viewport, each vibration widening the black lines.",
  ],
  starship: [
    "The hyperdrive settles into an uneven growl, and every loose panel begins to hum in sympathy.",
    "Cold starlight spills across the cockpit as the navicomputer rejects another route.",
    "Somewhere beyond the bulkhead, a maintenance droid starts screaming in binary.",
  ],
  temple: [
    "Dust lifts from the mosaic floor as symbols ignite in sequence beneath your feet.",
    "A stone door stands open by the width of a hand, breathing air colder than the chamber.",
    "The ruined altar reflects faces that are not standing in front of it.",
  ],
  wilderness: [
    "Tall silver grass bends against the wind while something large keeps pace beyond the ridge.",
    "The local wildlife falls silent in a widening circle around the trail.",
    "Rain beads on the sensor dish, turning every distant heat signature into a question.",
  ],
  city: [
    "Air traffic paints moving bands of light across towers patched with a century of repairs.",
    "Market calls, repulsorlifts, and police announcements compete beneath an elevated transit line.",
    "A surveillance drone pauses above the crowd and rotates directly toward you.",
  ],
  underworld: [
    "A coded knock travels through three doors before the final lock releases.",
    "Every booth has a privacy field, and every privacy field has someone trying to defeat it.",
    "Fresh bounty notices glow beside older ones scratched out with a vibroknife.",
  ],
  battlefield: [
    "Ash rolls across the broken position as artillery flashes beyond the horizon.",
    "A damaged walker burns without sound until the next shockwave reaches you.",
    "The comm channel is crowded with half-finished orders and coordinates that no longer exist.",
  ],
  space: [
    "The stars vanish behind the silhouette of something too large for the passive sensors.",
    "Debris turns slowly in the searchlights, each fragment carrying the same scorched insignia.",
    "A weak distress signal repeats from a point the navicomputer marks as empty space.",
  ],
  investigation: [
    "The room has been cleaned carefully, except for one object placed back at the wrong angle.",
    "Security footage skips the same eleven seconds on every available recording.",
    "A witness repeats a perfect story while watching the exit instead of you.",
  ],
  celebration: [
    "Lantern droids scatter colored light over a crowd singing three different versions of the same anthem.",
    "Fireworks bloom above the district while vendors hand out spiced drinks and counterfeit medals.",
    "For a few minutes, strangers dance together as though the war ended yesterday.",
  ],
};
const flavorTone = {
  tense: "Nobody speaks above a murmur; every sudden movement draws a hand toward a holster.",
  mysterious: "A detail refuses to fit, as though someone carefully edited this place after the fact.",
  lively: "Voices overlap in a dozen languages, turning the space into a restless current of opportunity.",
  grim: "Everything useful has already been stripped away, leaving only stains and old promises.",
  serene: "For once, the silence feels complete rather than threatening, and there is time to notice small things.",
  ominous: "A slow pattern repeats at the edge of hearing, close enough to promise that something is approaching.",
  hopeful: "One small sign of repair survives here, proof that somebody still expects a future.",
  chaotic: "Plans collapse into overlapping movement, shouted warnings, and opportunities that will last only seconds.",
};
const flavorDetails = [
  "A smell of hot circuitry, old rain, and cheap disinfectant clings to everything.",
  "One nearby surface vibrates in a rhythm that does not match the machinery around it.",
  "A small crowd keeps glancing toward the same locked door, then away again.",
  "The lighting flickers through a warning color for half a second before returning to normal.",
  "A battered service droid pauses, records the party, and pretends it did not.",
  "Someone has scratched a symbol into the nearest panel recently enough that the edges are bright.",
];
const flavorPressures = {
  cantina: ["A patron recognizes a bounty code and starts quietly leaving.", "The music cuts out when a private booth overloads."],
  location: ["A patrol route is due to cross this area in under a minute.", "A hidden speaker begins asking for obsolete clearance codes."],
  hazard: ["The danger will spread unless someone sacrifices time or position.", "A safer route appears, but it leads away from the objective."],
  starship: ["A subsystem failure forces a choice between speed, stealth, and shields.", "A docking clamp releases before anyone gives the command."],
  temple: ["The chamber responds to emotion before it responds to touch.", "A sealed passage opens only while someone remains separated from the group."],
  wilderness: ["Weather closes in fast enough to erase tracks and sensor returns.", "A territorial creature is close, but not yet committed to attacking."],
  city: ["A public announcement names the wrong suspect with convincing evidence.", "Traffic control freezes the district for a security sweep."],
  underworld: ["A broker offers help at exactly the wrong price.", "A rival crew arrives with proof they were invited too."],
  battlefield: ["A dying transmission reveals a flanking route before it cuts out.", "The ground itself is unstable from repeated bombardment."],
  space: ["A sensor ghost matches the party's vector too precisely.", "Power rationing turns every scan into a visible beacon."],
  investigation: ["The clue is real, but it was planted to make the party move quickly.", "A witness is about to disappear into a crowd or transport queue."],
  celebration: ["The crowd hides an extraction team moving in parade formation.", "A ceremonial countdown is also the timer on someone else's plan."],
};
const flavorObjects = [
  "a locked datapad with one message preview still visible",
  "a half-repaired astromech projecting corrupted route data",
  "a crate marked with a faction stencil that has been chemically scrubbed",
  "a comm bead broadcasting on a channel nobody admits using",
  "a sabacc token warm enough to suggest a hidden transmitter",
  "a broken holo-emitter looping the same three seconds of footage",
];
let generatedEncounter = [];
let generatedNpc = null;
let generatedLootItems = [];
let generatedShopWares = [];
let lastLootPayload = null;
let lastShopkeeperPayload = null;
let npcBestiaryCache = null;
const npcPortraitCache = new Map();

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function generateSpeciesName(species) {
  const pattern = speciesNamePatterns[species];
  if (!pattern) return randomItem(npcNames[species] || npcNames.Human);
  if (pattern.chunks) {
    const first = randomItem(pattern.chunks);
    const second = randomItem(pattern.chunks.filter((chunk) => chunk !== first));
    return `${first}${second}`.replace(/^./, (letter) => letter.toUpperCase());
  }
  if (pattern.core) return `${randomItem(pattern.core)}'${randomItem(pattern.suffix)}`;
  return `${randomItem(pattern.given)} ${randomItem(pattern.family)}`;
}

async function loadNpcBestiary() {
  if (npcBestiaryCache) return npcBestiaryCache;
  try {
    const response = await fetch("/api/compendium/creatures?limit=200");
    const payload = response.ok ? await response.json() : { items: [] };
    npcBestiaryCache = payload.items || [];
  } catch {
    npcBestiaryCache = [];
  }
  return npcBestiaryCache;
}

async function loadNpcPortraitAsset(species, role) {
  const cacheKey = `${species}:${role}`;
  if (npcPortraitCache.has(cacheKey)) return npcPortraitCache.get(cacheKey);
  const queries = [
    `${species} ${role}`,
    species,
  ].filter(Boolean);
  for (const query of queries) {
    try {
      const response = await fetch(`/api/assets/external?asset_type=tokens&q=${encodeURIComponent(query)}&limit=12`);
      const payload = response.ok ? await response.json() : { items: [] };
      const illustrated = (payload.items || []).filter((item) => imageUrlFor(item));
      if (illustrated.length) {
        const picked = randomItem(illustrated);
        npcPortraitCache.set(cacheKey, picked);
        return picked;
      }
    } catch {
      // Keep falling back through the candidate sources.
    }
  }
  npcPortraitCache.set(cacheKey, null);
  return null;
}

function roleTemplate(role) {
  const template = npcRoleTemplates[role] || npcRoleTemplates.Smuggler;
  return {
    name: `${role} profile`,
    type: "humanoid",
    hp: template.hp,
    ac: template.ac,
    cr: template.cr,
    actions: [...template.actions],
    abilities: { ...template.abilities },
    stat_block: {
      size: "Medium",
      type: "humanoid",
      alignment: "unaligned",
      armor_class: template.ac,
      hit_points: template.hp,
      challenge_rating: template.cr,
      abilities: { ...template.abilities },
      actions: template.actions.map((name) => ({ name, text: `${name} follows the generated NPC's role profile.` })),
    },
    source: "Generated role profile",
  };
}

async function generateNpc() {
  const species = document.querySelector("#npc-species").value || randomItem(Object.keys(speciesNamePatterns));
  const role = document.querySelector("#npc-role").value || randomItem(npcRoles);
  const name = Math.random() < 0.35 && npcNames[species] ? randomItem(npcNames[species]) : generateSpeciesName(species);
  const catalog = await loadNpcBestiary();
  const terms = npcRoleTerms[role] || [];
  const humanoidTypes = new Set(["human", "humanoid"]);
  const roleMatches = catalog.filter((item) => {
    const haystack = `${item.name} ${item.type} ${(item.roles || []).join(" ")} ${(item.factions || []).join(" ")}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
  const humanoidRoleMatches = roleMatches.filter((item) => humanoidTypes.has(item.type));
  const speciesMatches = catalog.filter((item) => item.name.toLowerCase().includes(species.toLowerCase()) || String(item.type || "").toLowerCase().includes(species.toLowerCase()));
  const speciesRoleMatches = speciesMatches.filter((item) => roleMatches.includes(item));
  const candidatePool = speciesRoleMatches.length ? speciesRoleMatches : humanoidRoleMatches;
  const candidate = candidatePool.length ? randomItem(candidatePool) : roleTemplate(role);
  const abilities = candidate?.abilities || candidate?.stat_block?.abilities || {};
  const attributes = ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((label) => {
    const parsed = Number.parseInt(String(abilities[label.toLowerCase()] || ""), 10);
    return { label, value: Number.isFinite(parsed) ? parsed : 8 + Math.floor(Math.random() * 11) };
  });
  const portraitAsset = await loadNpcPortraitAsset(species, role);
  const portraitUrl = imageUrlFor(portraitAsset) || (candidate.source === "Generated role profile" ? "" : imageUrlFor(candidate));
  const actions = candidate?.actions?.slice(0, 4) || ["Blaster attack"];
  const quirk = randomItem(npcQuirks);
  const hook = randomItem(npcHooks);
  const distinction = randomItem(npcDistinctions);
  const secret = randomItem(npcSecrets);
  generatedNpc = candidate
    ? { ...candidate, name, type: "enemy", creatureType: candidate.type, npcRole: role, npcSpecies: species, npcQuirk: quirk, npcHook: hook, npcDistinction: distinction, npcSecret: secret, imageUrl: portraitUrl }
    : { name, type: "enemy", hp: 12, ac: 12, cr: "1/4", actions, abilities, npcRole: role, npcSpecies: species, npcQuirk: quirk, npcHook: hook, npcDistinction: distinction, npcSecret: secret, imageUrl: portraitUrl };
  document.querySelector("#npc-output").innerHTML = `
    ${portraitUrl ? `<img class="npc-portrait" src="${escapeHtml(portraitUrl)}" alt="${escapeHtml(name)}">` : '<canvas id="npc-portrait-canvas" class="npc-portrait" width="144" height="144"></canvas>'}
    <div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(species)} · ${escapeHtml(role)}</p><p>${escapeHtml(quirk)}</p>${candidate ? `<small>Template: ${escapeHtml(candidate.name)} · CR ${escapeHtml(candidate.cr || "—")}</small>` : "<small>Template: local fallback</small>"}</div>`;
  if (!portraitUrl) drawNpcPortrait(species, name);
  document.querySelector("#npc-attributes").innerHTML = attributes.map((attribute) =>
    `<span>${attribute.label}<strong>${attribute.value}</strong></span>`
  ).join("");
  document.querySelector("#npc-combat-profile").innerHTML = `
    <div class="npc-profile-stats"><span>AC<strong>${candidate?.ac || 12}</strong></span><span>HP<strong>${candidate?.hp || 12}</strong></span><span>CR<strong>${escapeHtml(candidate?.cr || "1/4")}</strong></span></div>
    <div class="npc-profile-actions"><strong>Actions</strong> · ${escapeHtml(actions.join(", "))}</div>`;
  document.querySelector("#npc-hook").textContent = hook;
  document.querySelector("#npc-storyline").innerHTML = `
    <p><strong>Distinction</strong> ${escapeHtml(distinction)}</p>
    <p><strong>GM secret</strong> ${escapeHtml(secret)}</p>`;
  document.querySelector("#npc-open-sheet").disabled = false;
  document.querySelector("#npc-save-note").disabled = false;
  document.querySelector("#npc-to-encounter").disabled = false;
}

let externalResources = [];
let externalResourceMeta = { statuses: {}, categories: {} };

function populateExternalResourceCategories() {
  const categorySelect = document.querySelector("#external-resource-category");
  const current = categorySelect.value;
  const options = Object.entries(externalResourceMeta.categories || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, total]) => `<option value="${escapeHtml(category)}">${escapeHtml(category)} (${total})</option>`)
    .join("");
  categorySelect.innerHTML = `<option value="">All categories</option>${options}`;
  if ([...categorySelect.options].some((option) => option.value === current)) {
    categorySelect.value = current;
  }
}

function renderExternalResources() {
  const search = document.querySelector("#external-resource-search").value.trim().toLowerCase();
  const status = document.querySelector("#external-resource-status").value;
  const category = document.querySelector("#external-resource-category").value;
  const matches = externalResources.filter((item) => {
    const haystack = `${item.resource} ${item.category} ${item.intended_use} ${item.status} ${item.url}`.toLowerCase();
    return (!status || item.status === status)
      && (!category || item.category === category)
      && (!search || haystack.includes(search));
  });
  document.querySelector("#external-resource-count").textContent = `${matches.length}/${externalResources.length}`;
  const statusSummary = Object.entries(externalResourceMeta.statuses || {})
    .map(([label, total]) => `<span>${escapeHtml(label)} <strong>${total}</strong></span>`)
    .join("");
  document.querySelector("#external-resource-summary").innerHTML = statusSummary
    || '<span>No tracked resources yet</span>';
  document.querySelector("#external-resource-list").innerHTML = matches.slice(0, 24).map((item) => `
    <a class="external-resource-entry ${item.status === "Imported locally" ? "imported" : ""}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
      <strong>${escapeHtml(item.resource)}</strong>
      <span>${escapeHtml(item.category)} · ${escapeHtml(item.status)}</span>
      <small>${escapeHtml(item.intended_use)}</small>
    </a>
  `).join("") || '<p class="loading-line">No matching resource.</p>';
}

async function loadExternalResources() {
  try {
    const response = await fetch("/api/assets/resource-backlog?limit=1000");
    if (!response.ok) throw new Error("Resource backlog unavailable");
    const payload = await response.json();
    externalResources = payload.items;
    externalResourceMeta = { statuses: payload.statuses || {}, categories: payload.categories || {} };
    populateExternalResourceCategories();
    renderExternalResources();
  } catch {
    document.querySelector("#external-resource-count").textContent = "Unavailable";
    document.querySelector("#external-resource-summary").innerHTML = "";
    document.querySelector("#external-resource-list").innerHTML = '<p class="loading-line">Resource backlog unavailable.</p>';
  }
}

function drawNpcPortrait(species, name) {
  const portrait = document.querySelector("#npc-portrait-canvas");
  const portraitCtx = portrait.getContext("2d");
  const hue = [...name].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;
  const skin = species === "Duros" ? "#4b9a9d" : species === "Twi'lek" ? "#6f89b8" : species === "Rodian" ? "#739755" : `hsl(${hue}, 28%, 55%)`;
  const gradient = portraitCtx.createRadialGradient(54, 42, 10, 72, 72, 90);
  gradient.addColorStop(0, `hsl(${hue}, 30%, 30%)`);
  gradient.addColorStop(1, "#0b1114");
  portraitCtx.fillStyle = gradient;
  portraitCtx.fillRect(0, 0, 144, 144);
  portraitCtx.fillStyle = skin;
  portraitCtx.beginPath();
  portraitCtx.ellipse(72, 72, species === "Duros" ? 42 : 34, species === "Duros" ? 47 : 43, 0, 0, Math.PI * 2);
  portraitCtx.fill();
  if (species === "Zabrak") {
    portraitCtx.fillStyle = "#d8c3a4";
    for (let x = 46; x <= 98; x += 13) {
      portraitCtx.beginPath(); portraitCtx.moveTo(x, 35); portraitCtx.lineTo(x + 6, 12); portraitCtx.lineTo(x + 11, 38); portraitCtx.fill();
    }
  }
  if (species === "Twi'lek") {
    portraitCtx.strokeStyle = skin; portraitCtx.lineWidth = 15; portraitCtx.lineCap = "round";
    portraitCtx.beginPath(); portraitCtx.moveTo(48, 82); portraitCtx.quadraticCurveTo(27, 116, 36, 137); portraitCtx.stroke();
    portraitCtx.beginPath(); portraitCtx.moveTo(96, 82); portraitCtx.quadraticCurveTo(117, 116, 108, 137); portraitCtx.stroke();
  }
  portraitCtx.fillStyle = "#10191c";
  portraitCtx.beginPath(); portraitCtx.ellipse(58, 67, species === "Duros" ? 10 : 6, 5, 0, 0, Math.PI * 2); portraitCtx.fill();
  portraitCtx.beginPath(); portraitCtx.ellipse(86, 67, species === "Duros" ? 10 : 6, 5, 0, 0, Math.PI * 2); portraitCtx.fill();
  portraitCtx.strokeStyle = "#222"; portraitCtx.lineWidth = 3;
  portraitCtx.beginPath(); portraitCtx.moveTo(58, 97); portraitCtx.quadraticCurveTo(72, 104, 87, 97); portraitCtx.stroke();
}

async function generateLoot() {
  const cr = Math.max(0, Number(document.querySelector("#toolkit-cr").value) || 0);
  const extraCategory = document.querySelector("#extra-loot-category").value;
  const maxRarity = document.querySelector("#extra-loot-rarity").value;
  const output = document.querySelector("#loot-output");
  output.innerHTML = '<p class="loading-line">Searching the SW5e catalog…</p>';
  try {
    const params = new URLSearchParams({ cr, count: Math.max(3, Math.min(7, 3 + Math.floor(cr / 5))) });
    if (extraCategory) {
      params.set("extra_category", extraCategory);
      params.set("max_rarity", maxRarity);
    }
    const response = await fetch(`/api/catalog/items/loot?${params}`);
    if (!response.ok) throw new Error("Loot catalog unavailable");
    const payload = await response.json();
    lastLootPayload = payload;
    generatedLootItems = payload.items || [];
    document.querySelector("#save-loot-note").disabled = generatedLootItems.length === 0;
    const summaryChips = [
      ...(payload.summary?.rarities || []).map(([name, count]) => `${name} ${count}`),
      ...(payload.summary?.categories || []).slice(0, 3).map(([name, count]) => `${catalogLabel(name)} ${count}`),
    ].map((label) => `<span>${escapeHtml(label)}</span>`).join("");
    const items = generatedLootItems.map((item, index) => {
      const detail = [catalogLabel(item.category), item.rarity, item.damage].filter(Boolean).join(" · ");
      return `<div class="loot-line interactive-loot" data-open-loot-item="${index}">
        <span>${escapeHtml(item.name)}</span>
        <strong>${escapeHtml(detail || item.source || "SW5e")}</strong>
        <span class="loot-actions">
          <button data-open-loot-item="${index}" title="Open item sheet" type="button">⌕</button>
          <button data-add-loot-item="${index}" title="Add to active character" type="button">＋</button>
        </span>
      </div>`;
    }).join("");
    output.innerHTML = `
      <div class="loot-line"><span>Credits</span><strong>${payload.credits.toLocaleString()} cr</strong></div>
      ${summaryChips ? `<div class="loot-summary">${summaryChips}</div>` : ""}
      ${items}
      <div class="loot-line"><span>Field supplies</span><strong>${1 + Math.floor(cr / 4)}× ${escapeHtml(randomItem(consumables))}</strong></div>
      <div class="loot-line"><span>Salvage lead</span><strong>${escapeHtml(randomItem(lootMods))}</strong></div>`;
  } catch {
    lastLootPayload = null;
    generatedLootItems = [];
    document.querySelector("#save-loot-note").disabled = true;
    output.innerHTML = '<p class="loading-line">The SW5e loot catalog is unavailable.</p>';
  }
}

async function generateShopkeeper() {
  const params = new URLSearchParams({
    settlement: document.querySelector("#shop-size").value,
    allegiance: document.querySelector("#shop-allegiance").value,
    wealth: document.querySelector("#shop-wealth").value,
  });
  const output = document.querySelector("#shopkeeper-output");
  output.innerHTML = '<p class="loading-line">Stocking the shelves...</p>';
  try {
    const response = await fetch(`/api/catalog/items/shopkeeper?${params}`);
    if (!response.ok) throw new Error("Shop unavailable");
    const payload = await response.json();
    lastShopkeeperPayload = payload;
    generatedShopWares = payload.wares || [];
    document.querySelector("#save-shopkeeper-note").disabled = generatedShopWares.length === 0;
    const departments = (payload.departments || []).map(([name, count]) => `<span>${escapeHtml(catalogLabel(name))}<strong>${count}</strong></span>`).join("");
    const priceLabel = payload.price_modifier ? `${Math.round(Number(payload.price_modifier) * 100)}% street price` : "table price";
    output.innerHTML = `
      <div class="shopkeeper-title"><strong>${escapeHtml(payload.name)}</strong><span>${escapeHtml(payload.settlement)} · ${escapeHtml(payload.allegiance)} · ${escapeHtml(payload.wealth)} · ${escapeHtml(priceLabel)}</span></div>
      <p class="shopkeeper-pitch">${escapeHtml(payload.pitch || "A practical merchant with a rotating stock of local wares.")}</p>
      ${payload.policy ? `<p class="shopkeeper-policy">${escapeHtml(payload.policy)}</p>` : ""}
      ${departments ? `<div class="shopkeeper-departments">${departments}</div>` : ""}
      ${generatedShopWares.map((item, index) => {
        const detail = [catalogLabel(item.category), item.rarity, item.damage].filter(Boolean).join(" · ");
        const cost = item.shop_cost ?? item.cost;
        return `<div class="loot-line interactive-loot" data-open-shop-item="${index}">
          <span>${escapeHtml(item.name)}</span>
          <strong>${escapeHtml(detail || "SW5e")} · ${Number(cost || 0).toLocaleString()} cr</strong>
          <span class="loot-actions">
            <button data-open-shop-item="${index}" title="Open item sheet" type="button">⌕</button>
            <button data-add-shop-item="${index}" title="Add to active character" type="button">＋</button>
          </span>
        </div>`;
      }).join("")}`;
  } catch {
    lastShopkeeperPayload = null;
    generatedShopWares = [];
    document.querySelector("#save-shopkeeper-note").disabled = true;
    output.innerHTML = '<p class="loading-line">Shopkeeper catalog unavailable.</p>';
  }
}

function itemNoteLine(item) {
  const detail = [catalogLabel(item.category), item.rarity, item.damage].filter(Boolean).join(" | ");
  const cost = item.shop_cost ?? item.cost;
  const costText = Number(cost || 0) > 0 ? ` | ${Number(cost).toLocaleString()} cr` : "";
  return `- **${item.name}**${detail ? ` (${detail})` : ""}${costText}`;
}

function saveLootAsNote() {
  if (!lastLootPayload || !generatedLootItems.length) return;
  const cr = Math.max(0, Number(document.querySelector("#toolkit-cr").value) || 0);
  const summary = lastLootPayload.summary?.rarities?.map(([name, count]) => `${name} ${count}`).join(", ") || "mixed";
  createNote(`Loot parcel · CR ${cr} · ${noteTimestamp()}`, `# Loot parcel

- Target CR: ${cr}
- Credits: ${Number(lastLootPayload.credits || 0).toLocaleString()} cr
- Summary: ${summary}

## Items

${generatedLootItems.map(itemNoteLine).join("\n")}
`);
  document.querySelector('[data-view="notes"]').click();
}

function saveShopkeeperAsNote() {
  if (!lastShopkeeperPayload || !generatedShopWares.length) return;
  const departments = (lastShopkeeperPayload.departments || [])
    .map(([name, count]) => `- ${catalogLabel(name)}: ${count}`)
    .join("\n");
  createNote(`${lastShopkeeperPayload.name} · wares · ${noteTimestamp()}`, `# ${lastShopkeeperPayload.name}

- Settlement: ${lastShopkeeperPayload.settlement}
- Allegiance: ${lastShopkeeperPayload.allegiance}
- Wealth: ${lastShopkeeperPayload.wealth}
- Price modifier: ${Math.round(Number(lastShopkeeperPayload.price_modifier || 1) * 100)}%

${lastShopkeeperPayload.pitch || ""}

## Policy

${lastShopkeeperPayload.policy || "No special policy."}

## Departments

${departments || "- Mixed stock"}

## Wares

${generatedShopWares.map(itemNoteLine).join("\n")}
`);
  document.querySelector('[data-view="notes"]').click();
}

async function generateEncounter() {
  const targetCr = Math.max(0, Number(document.querySelector("#toolkit-cr").value) || 0);
  const partySize = Math.max(1, Number(document.querySelector("#toolkit-party-size").value) || 1);
  try {
    const response = await fetch("/api/compendium/creatures?limit=200");
    const payload = await response.json();
    const candidates = payload.items.filter((item) => Number(item.cr) <= Math.max(1, targetCr));
    const count = Math.max(1, Math.min(6, Math.ceil(partySize / 2)));
    generatedEncounter = Array.from({ length: count }, () => randomItem(candidates));
    document.querySelector("#encounter-output").innerHTML = generatedEncounter.map((item, index) => `
      <div class="encounter-suggestion" data-open-encounter-creature="${index}">
        ${tokenMarkup(item, "encounter-token")}
        <span><strong>${escapeHtml(item.name)}</strong><small>CR ${escapeHtml(item.cr)} · HP ${item.hp} · AC ${item.ac}</small></span>
        <span class="encounter-actions-mini">
          <button data-open-encounter-creature="${index}" title="Open stat block" type="button">⌕</button>
          <button data-add-encounter-creature="${index}" title="Add this creature" type="button">＋</button>
        </span>
      </div>`
    ).join("");
    document.querySelector("#send-encounter").disabled = false;
  } catch {
    document.querySelector("#encounter-output").innerHTML = '<p class="loading-line">Bestiary unavailable.</p>';
  }
}

function generateFlavor() {
  const scene = document.querySelector("#flavor-scene").value;
  const tone = document.querySelector("#flavor-tone").value;
  const hook = randomItem(npcHooks);
  const lines = [
    randomItem(flavorParts[scene]),
    flavorTone[tone],
    `Sensory tell: ${randomItem(flavorDetails)}`,
    `Immediate pressure: ${randomItem(flavorPressures[scene] || flavorPressures.location)}`,
    `Interactive object: ${randomItem(flavorObjects)}`,
  ];
  document.querySelector("#flavor-output").innerHTML = lines
    .map((line, index) => index < 2 ? `<p>${escapeHtml(line)}</p>` : `<p><strong>${escapeHtml(line.split(":")[0])}:</strong>${escapeHtml(line.slice(line.indexOf(":") + 1))}</p>`)
    .join("");
  document.querySelector("#session-spark").textContent = hook;
}

document.querySelector("#generate-npc").addEventListener("click", generateNpc);
document.querySelector("#npc-to-encounter").addEventListener("click", () => {
  if (!generatedNpc) return;
  addCombatant(generatedNpc, mapCenterPoint());
  document.querySelector('[data-view="battlemap"]').click();
});
document.querySelector("#npc-open-sheet").addEventListener("click", () => {
  if (!generatedNpc) return;
  openCreatureDetail(generatedNpc);
});
document.querySelector("#npc-save-note").addEventListener("click", () => {
  if (!generatedNpc) return;
  const content = `# ${generatedNpc.name}

${generatedNpc.npcSpecies || "Unknown species"} ${generatedNpc.npcRole || "NPC"}

## Table Read
${generatedNpc.npcQuirk || ""}

## Hook
${generatedNpc.npcHook || ""}

## Distinction
${generatedNpc.npcDistinction || ""}

## GM Secret
${generatedNpc.npcSecret || ""}

## Combat Template
${generatedNpc.source || "Local generated profile"} · CR ${generatedNpc.cr || "1/4"} · AC ${generatedNpc.ac || 12} · HP ${generatedNpc.hp || 12}

Actions: ${(generatedNpc.actions || ["Blaster attack"]).join(", ")}`;
  createNote(`NPC · ${generatedNpc.name}`, content);
  document.querySelector('[data-view="notes"]').click();
});
document.querySelector("#generate-loot").addEventListener("click", generateLoot);
document.querySelector("#save-loot-note").addEventListener("click", saveLootAsNote);
document.querySelector("#generate-shopkeeper").addEventListener("click", generateShopkeeper);
document.querySelector("#save-shopkeeper-note").addEventListener("click", saveShopkeeperAsNote);
document.querySelector("#generate-encounter").addEventListener("click", generateEncounter);
document.querySelector("#generate-flavor").addEventListener("click", generateFlavor);
document.querySelector("#encounter-output").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-encounter-creature]");
  const open = event.target.closest("[data-open-encounter-creature]");
  if (add) {
    event.stopPropagation();
    const creature = generatedEncounter[Number(add.dataset.addEncounterCreature)];
    if (!creature) return;
    addCombatant(creature, mapCenterPoint());
    add.textContent = "✓";
    add.disabled = true;
    return;
  }
  if (open) {
    const creature = generatedEncounter[Number(open.dataset.openEncounterCreature)];
    if (creature) openCreatureDetail(creature);
  }
});
document.querySelector("#loot-output").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-loot-item]");
  const open = event.target.closest("[data-open-loot-item]");
  if (add) {
    event.stopPropagation();
    if (!addCatalogItemToCharacter(generatedLootItems[Number(add.dataset.addLootItem)])) return;
    add.textContent = "✓";
    add.disabled = true;
    return;
  }
  if (open) openItemDetail(generatedLootItems[Number(open.dataset.openLootItem)]);
});
document.querySelector("#shopkeeper-output").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-shop-item]");
  const open = event.target.closest("[data-open-shop-item]");
  if (add) {
    event.stopPropagation();
    if (!addCatalogItemToCharacter(generatedShopWares[Number(add.dataset.addShopItem)])) return;
    add.textContent = "✓";
    add.disabled = true;
    return;
  }
  if (open) openItemDetail(generatedShopWares[Number(open.dataset.openShopItem)]);
});
document.querySelector("#external-resource-search").addEventListener("input", renderExternalResources);
document.querySelector("#external-resource-status").addEventListener("change", renderExternalResources);
document.querySelector("#external-resource-category").addEventListener("change", renderExternalResources);
document.querySelector("#send-encounter").addEventListener("click", () => {
  generatedEncounter.forEach((creature) => addCombatant(creature));
  document.querySelector('[data-view="battlemap"]').click();
});
document.querySelector("#flavor-to-note").addEventListener("click", () => {
  const output = document.querySelector("#flavor-output");
  const flavor = [...output.querySelectorAll("p")].map((line) => line.textContent.trim()).join("\n\n") || output.textContent.trim();
  if (!flavor) return;
  createNote(`Scene flavor · ${noteTimestamp()}`, `# Scene flavor\n\n${flavor}`);
  document.querySelector('[data-view="notes"]').click();
});

let soundAudioContext;
let soundMasterGain;
let activeSoundSceneId = null;
const activeSoundNodes = new Set();
const activeAudioElements = new Set();
const activeSceneTimers = new Set();

const soundScenes = {
  docking: [
    { at: 0, type: "door" },
    { at: 650, type: "comms" },
    { at: 1500, type: "hyperdrive" },
    { at: 3200, type: "comms" },
  ],
  duel: [
    { at: 0, type: "saber" },
    { at: 450, type: "saber" },
    { at: 1050, type: "saber" },
    { at: 1600, tone: [110, 42, .55, "sawtooth", .2] },
    { at: 2300, type: "saber" },
  ],
  cantina: [
    { at: 0, type: "cantina" },
    { at: 950, type: "cantina" },
    { at: 1800, type: "comms" },
    { at: 2900, type: "cantina" },
  ],
  crisis: [
    { at: 0, type: "alarm" },
    { at: 600, type: "storm" },
    { at: 1350, type: "alarm" },
    { at: 2350, type: "hyperdrive" },
  ],
  wilderness: [
    { at: 0, type: "storm" },
    { at: 1200, tone: [260, 190, .32, "triangle", .08] },
    { at: 2100, type: "comms" },
    { at: 3400, type: "storm" },
  ],
  battle: [
    { at: 0, type: "blaster" },
    { at: 220, type: "blaster" },
    { at: 520, type: "blaster" },
    { at: 900, type: "alarm" },
    { at: 1550, type: "hyperdrive" },
  ],
};

function ensureSoundboard() {
  soundAudioContext ||= new AudioContext();
  if (!soundMasterGain) {
    soundMasterGain = soundAudioContext.createGain();
    soundMasterGain.gain.value = Number(document.querySelector("#soundboard-volume").value) / 100;
    soundMasterGain.connect(soundAudioContext.destination);
  }
  soundAudioContext.resume();
  return soundAudioContext;
}

function trackSoundNode(node) {
  activeSoundNodes.add(node);
  node.addEventListener("ended", () => activeSoundNodes.delete(node), { once: true });
  return node;
}

function soundTone(startFrequency, endFrequency, duration, type = "sine", volume = .2, delay = 0) {
  const audio = ensureSoundboard();
  const start = audio.currentTime + delay;
  const oscillator = trackSoundNode(audio.createOscillator());
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.001, start + duration);
  oscillator.connect(gain).connect(soundMasterGain);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function soundNoise(duration, volume = .12, frequency = 1000, delay = 0) {
  const audio = ensureSoundboard();
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  const source = trackSoundNode(audio.createBufferSource());
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  const start = audio.currentTime + delay;
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.001, start + duration);
  source.connect(filter).connect(gain).connect(soundMasterGain);
  source.start(start);
  source.stop(start + duration);
}

function playSoundEffect(type) {
  if (type === "blaster") {
    soundTone(1450, 85, .22, "sawtooth", .42);
    soundNoise(.18, .2, 2400);
  } else if (type === "saber") {
    soundTone(72, 128, .85, "sawtooth", .22);
    soundTone(144, 95, .7, "sine", .12, .08);
  } else if (type === "alarm") {
    [0, .24, .48].forEach((delay, index) => soundTone(index % 2 ? 720 : 470, index % 2 ? 500 : 650, .2, "square", .16, delay));
  } else if (type === "door") {
    soundNoise(.8, .28, 380);
    soundTone(82, 28, .85, "triangle", .3);
  } else if (type === "hyperdrive") {
    soundNoise(1.4, .18, 1400);
    soundTone(55, 1500, 1.2, "sawtooth", .22);
    soundTone(110, 2200, .8, "sine", .13, .35);
  } else if (type === "comms") {
    soundNoise(.65, .08, 3200);
    [0, .14, .3].forEach((delay) => soundTone(920, 640, .09, "square", .13, delay));
  } else if (type === "storm") {
    soundNoise(1.8, .24, 850);
    soundTone(48, 28, 1.7, "sine", .2);
  } else if (type === "cantina") {
    [330, 392, 440, 523, 392].forEach((frequency, index) => soundTone(frequency, frequency * .98, .18, "triangle", .14, index * .14));
  }
}

function renderSoundSceneState() {
  document.querySelectorAll("[data-sound-scene]").forEach((button) => {
    button.classList.toggle("active", button.dataset.soundScene === activeSoundSceneId);
  });
}

function stopSoundSceneTimers() {
  for (const timer of activeSceneTimers) clearTimeout(timer);
  activeSceneTimers.clear();
  activeSoundSceneId = null;
  renderSoundSceneState();
}

function scheduleSoundSceneStep(step) {
  const timer = setTimeout(() => {
    activeSceneTimers.delete(timer);
    if (step.type) playSoundEffect(step.type);
    if (step.tone) soundTone(...step.tone);
    if (step.noise) soundNoise(...step.noise);
  }, step.at);
  activeSceneTimers.add(timer);
}

function playSoundScene(sceneId) {
  const scene = soundScenes[sceneId];
  if (!scene) return;
  stopSoundSceneTimers();
  activeSoundSceneId = sceneId;
  renderSoundSceneState();
  for (const step of scene) scheduleSoundSceneStep(step);
  const endAt = Math.max(...scene.map((step) => step.at)) + 2200;
  const doneTimer = setTimeout(() => {
    activeSceneTimers.delete(doneTimer);
    activeSoundSceneId = null;
    renderSoundSceneState();
  }, endAt);
  activeSceneTimers.add(doneTimer);
}

function playSoundFile(url) {
  const audio = new Audio(url);
  audio.volume = Number(document.querySelector("#soundboard-volume").value) / 100;
  audio.addEventListener("ended", () => activeAudioElements.delete(audio), { once: true });
  activeAudioElements.add(audio);
  audio.play().catch(() => activeAudioElements.delete(audio));
}

document.querySelector(".soundboard-grid").addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-sound-url]");
  const synthButton = event.target.closest("[data-sound]");
  if (fileButton) playSoundFile(fileButton.dataset.soundUrl);
  else if (synthButton) playSoundEffect(synthButton.dataset.sound);
});
document.querySelector(".sound-scenes").addEventListener("click", (event) => {
  const sceneButton = event.target.closest("[data-sound-scene]");
  if (sceneButton) playSoundScene(sceneButton.dataset.soundScene);
});
document.querySelector("#soundboard-volume").addEventListener("input", (event) => {
  if (soundMasterGain) soundMasterGain.gain.value = Number(event.target.value) / 100;
  for (const audio of activeAudioElements) audio.volume = Number(event.target.value) / 100;
});
document.querySelector("#stop-sounds").addEventListener("click", () => {
  stopSoundSceneTimers();
  for (const node of activeSoundNodes) {
    try { node.stop(); } catch { /* Already stopped. */ }
  }
  activeSoundNodes.clear();
  for (const audio of activeAudioElements) {
    audio.pause();
    audio.currentTime = 0;
  }
  activeAudioElements.clear();
});

const realmSoundBoards = [
  { name: "Darth Vader", url: "https://www.realmofdarkness.net/sb/sw-vader/" },
  { name: "Sound Effects", url: "https://www.realmofdarkness.net/sb/category/sw/sw-sfx" },
  { name: "Droids", url: "https://www.realmofdarkness.net/sb/category/sw/droids" },
  { name: "Creatures", url: "https://www.realmofdarkness.net/sb/category/sw/creatures" },
  { name: "Podracers", url: "https://www.realmofdarkness.net/sb/category/sw/podracers" },
  { name: "Jedi & Rebellion", url: "https://www.realmofdarkness.net/sb/category/sw/jedi-rebellion" },
  { name: "Empire & Villains", url: "https://www.realmofdarkness.net/sb/category/sw/empire-villains" },
];
const ambiancePresets = [
  {
    id: "combat",
    name: "Combat",
    tracks: [
      ["Battle tempo", "sw5e star wars combat music"],
      ["Duel pressure", "star wars duel ambience music"],
      ["Extraction chase", "star wars chase music ambience"],
    ],
  },
  {
    id: "cantina",
    name: "Cantina",
    tracks: [
      ["Cantina crowd", "star wars cantina ambience"],
      ["Underworld lounge", "sci fi cantina music"],
      ["Sabacc table", "star wars cantina jazz ambience"],
    ],
  },
  {
    id: "exploration",
    name: "Exploration",
    tracks: [
      ["Ancient ruins", "star wars ancient temple ambience"],
      ["Outer Rim wilderness", "sci fi alien planet ambience"],
      ["Investigation pulse", "sci fi detective ambience"],
    ],
  },
  {
    id: "space",
    name: "Space travel",
    tracks: [
      ["Hyperspace drift", "star wars hyperspace ambience"],
      ["Starship interior", "sci fi spaceship ambience"],
      ["Deep space tension", "deep space ambient music sci fi"],
    ],
  },
];

function youtubeIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
    const match = parsed.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

async function resolveYoutubeTitle(url) {
  try {
    const response = await fetch(`/api/media/youtube-title?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error("Title unavailable");
    const payload = await response.json();
    return payload.title || "";
  } catch {
    return "";
  }
}

function renderSoundAmbiance() {
  document.querySelector("#realm-sound-links").innerHTML = realmSoundBoards.map((board) => `
    <a href="${escapeHtml(board.url)}" target="_blank" rel="noopener">
      <strong>${escapeHtml(board.name)}</strong><span>Open source board</span>
    </a>`).join("");
  document.querySelector("#ambiance-presets").innerHTML = ambiancePresets.map((preset) => `
    <button type="button" data-ambiance-preset="${escapeHtml(preset.id)}">
      <strong>${escapeHtml(preset.name)}</strong><span>${preset.tracks.length} tracks</span>
    </button>`).join("");
  const activeTrack = state.soundPlaylist.find((track) => track.id === state.activeTrackId) || state.soundPlaylist[0];
  if (activeTrack) {
    state.activeTrackId = activeTrack.id;
    if (activeTrack.videoId) {
      document.querySelector("#youtube-player").removeAttribute("srcdoc");
      document.querySelector("#youtube-player").src = `https://www.youtube.com/embed/${escapeHtml(activeTrack.videoId)}?rel=0`;
    } else {
      document.querySelector("#youtube-player").removeAttribute("src");
      document.querySelector("#youtube-player").srcdoc = `<body style="margin:0;background:#070909;color:#f5f5f5;font:16px system-ui;display:grid;place-items:center;text-align:center"><div><strong>${escapeHtml(activeTrack.title)}</strong><br><span style="color:#a9b0b6">Open the playlist search result, then paste the chosen video link.</span></div></body>`;
    }
  } else {
    document.querySelector("#youtube-player").removeAttribute("src");
    document.querySelector("#youtube-player").removeAttribute("srcdoc");
  }
  document.querySelector("#youtube-playlist").innerHTML = state.soundPlaylist.map((track) => `
    <article class="playlist-track ${track.id === state.activeTrackId ? "active" : ""}">
      <button data-play-track="${track.id}"><strong>${escapeHtml(track.title)}</strong><span>${track.videoId ? "YouTube video" : "YouTube search"}</span></button>
      <button class="icon-button" data-move-track="${track.id}" data-direction="-1" title="Move up">↑</button>
      <button class="icon-button" data-move-track="${track.id}" data-direction="1" title="Move down">↓</button>
      <button class="icon-button" data-rename-track="${track.id}" title="Rename track">T</button>
      <button class="icon-button" data-remove-track="${track.id}" title="Remove track">×</button>
    </article>`).join("") || '<p class="loading-line">Add curated music links when ready.</p>';
  persist();
}

function addAmbiancePreset(presetId) {
  const preset = ambiancePresets.find((item) => item.id === presetId);
  if (!preset) return;
  const existingUrls = new Set(state.soundPlaylist.map((track) => track.url));
  for (const [title, query] of preset.tracks) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    if (existingUrls.has(url)) continue;
    state.soundPlaylist.push({
      id: crypto.randomUUID(),
      title,
      url,
      videoId: "",
      searchQuery: query,
    });
    existingUrls.add(url);
  }
  state.activeTrackId = state.soundPlaylist.find((track) => track.searchQuery === preset.tracks[0][1])?.id || state.soundPlaylist[0]?.id || null;
  renderSoundAmbiance();
}

document.querySelector("#youtube-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#youtube-url");
  const url = input.value.trim();
  const videoId = youtubeIdFromUrl(url);
  if (!videoId) return;
  const resolved = await resolveYoutubeTitle(url);
  const title = prompt("Playlist name", resolved || `YouTube track ${state.soundPlaylist.length + 1}`);
  if (!title) return;
  const track = { id: crypto.randomUUID(), videoId, title, url };
  state.soundPlaylist.push(track);
  state.activeTrackId = track.id;
  input.value = "";
  renderSoundAmbiance();
});

document.querySelector("#add-youtube-track").addEventListener("click", () => document.querySelector("#youtube-url").focus());
document.querySelector("#ambiance-presets").addEventListener("click", (event) => {
  const preset = event.target.closest("[data-ambiance-preset]");
  if (preset) addAmbiancePreset(preset.dataset.ambiancePreset);
});
document.querySelector("#youtube-playlist").addEventListener("click", (event) => {
  const play = event.target.closest("[data-play-track]");
  const remove = event.target.closest("[data-remove-track]");
  const rename = event.target.closest("[data-rename-track]");
  const move = event.target.closest("[data-move-track]");
  if (play) {
    state.activeTrackId = play.dataset.playTrack;
    const track = state.soundPlaylist.find((item) => item.id === play.dataset.playTrack);
    if (track && !track.videoId && track.url) window.open(track.url, "_blank", "noopener");
  }
  if (remove) {
    state.soundPlaylist = state.soundPlaylist.filter((track) => track.id !== remove.dataset.removeTrack);
    if (state.activeTrackId === remove.dataset.removeTrack) state.activeTrackId = state.soundPlaylist[0]?.id || null;
  }
  if (rename) {
    const track = state.soundPlaylist.find((item) => item.id === rename.dataset.renameTrack);
    const nextTitle = track ? prompt("Playlist name", track.title) : "";
    if (track && nextTitle) track.title = nextTitle.trim();
  }
  if (move) {
    const index = state.soundPlaylist.findIndex((track) => track.id === move.dataset.moveTrack);
    const direction = Number(move.dataset.direction);
    const nextIndex = index + direction;
    if (index >= 0 && nextIndex >= 0 && nextIndex < state.soundPlaylist.length) {
      const [track] = state.soundPlaylist.splice(index, 1);
      state.soundPlaylist.splice(nextIndex, 0, track);
    }
  }
  if (play || remove || rename || move) renderSoundAmbiance();
});

function renderQuests() {
  ensureQuestState();
  const active = state.quests.find((quest) => quest.id === state.activeQuestId) || state.quests[0];
  state.activeQuestId = active?.id || null;
  document.querySelector("#quest-active-title").textContent = active?.title || "Episode workspace";
  document.querySelector("#quest-list").innerHTML = state.quests.map((quest) => `
    <article class="quest-entry">
      <button data-quest-id="${quest.id}" class="${quest.id === state.activeQuestId ? "active" : ""}"><strong>${escapeHtml(quest.title)}</strong><span>${quest.folders.length} folders · ${quest.files.length} files</span></button>
      <div>${quest.folders.map((folder) => `<button data-open-quest-folder="${quest.id}:${escapeHtml(folder)}">${escapeHtml(folder)}</button>`).join("")}</div>
    </article>`).join("");
  document.querySelector("#quest-file-windows").innerHTML = active.files.map((file) => `
    <article class="quest-file-window" data-quest-file="${file.id}">
      <header><span>${escapeHtml(file.folder || "General")}</span><input data-quest-title="${file.id}" value="${escapeHtml(file.title)}"><button class="icon-button" data-close-quest-file="${file.id}">×</button></header>
      <textarea data-quest-content="${file.id}" spellcheck="true">${escapeHtml(file.content)}</textarea>
      <div class="note-preview" data-quest-preview="${file.id}">${markdownToHtml(file.content)}</div>
    </article>`).join("") || '<p class="loading-line">Open a quest folder to create a working file window.</p>';
  persist();
}

function questFileTemplate(folder, questTitle = "Episode") {
  const templates = {
    NPC: `# NPC

## Recurring cast
- Name: role, leverage, visible tell, secret.

## New faces
- [[Bounty Hunter]] contact:
- [[Officer]] opposition:
- Local civilian witness:

## Use at table
- Voice / posture:
- What they want:
- What they know:
- What they hide:`,
    Loot: `# Loot

## Planned rewards
- Credits:
- Equipment:
- Enhanced or special item:

## Encounter drops
- Combat loot:
- Salvage:
- Clues hidden in inventory:

## References
Use [[equipment]], [[weapon properties]], or item names from the compendium.`,
    "Encounters detail": `# Encounters detail

## Encounter name
- Goal:
- Enemy plan:
- Terrain feature:
- Complication:
- Reinforcement trigger:

## Mechanical notes
- Conditions:
- Cover / hazards:
- Victory beyond destruction:

## Stat blocks
Link templates with [[stormtrooper]], [[droid]], or specific creature names.`,
    "Main Quest": `# ${questTitle}

## Premise
The party is pulled into the problem because...

## Objective
- Primary objective:
- Secondary objective:
- Optional moral pressure:

## Beats
1. Opening pressure:
2. Investigation / travel:
3. Escalation:
4. Confrontation:
5. Fallout:

## Clues
- Clue A:
- Clue B:
- Clue C:

## Links
[[NPC]] [[Encounters detail]] [[Locations]] [[Loot]]`,
    "Side quests": `# Side quests

## Side thread
- Hook:
- Who asks:
- Risk:
- Reward:
- How it complicates the main quest:

## Optional scenes
- Social:
- Exploration:
- Combat:
- Downtime:`,
    Activities: `# Activities

## Downtime
- Crafting:
- Shopping:
- Gambling / cantina:
- Training:
- Travel montage:

## Skill scenes
- Skill:
- DC:
- Consequence on failure:
- Cool success detail:`,
    "Random Events": `# Random Events

Roll or pick when pace slows.

1. Patrol, checkpoint, or inspection.
2. Distress signal.
3. Rival crew appears.
4. Environmental hazard.
5. Market opportunity.
6. Personal message for a character.

## Escalation dial
- Quiet:
- Tense:
- Dangerous:`,
    Locations: `# Locations

## Location
- First impression:
- Sensory detail:
- Security:
- Hidden route:
- Useful NPC:

## Map notes
- Grid on map already:
- Fill viewport:
- Lighting / fog:
- Tokens to pre-place:`,
    "Points of interest": `# Points of interest

## POI
- What players see:
- What investigation reveals:
- What it connects to:
- Treasure / clue:
- Danger:

## Compendium links
Use [[conditions]], [[skills]], [[cover]], or item/rule names.`,
  };
  return templates[folder] || `# ${folder}

Link NPCs, loot, compendium entries or other files with [[double brackets]].`;
}

function inferQuestFileFolder(file, folders = []) {
  const current = file.folder || "General";
  if (current !== "General") return current;
  const title = String(file.title || "").toLowerCase();
  const match = folders.find((folder) => title === `${folder.toLowerCase()} notes` || title === folder.toLowerCase());
  return match || current;
}

function normalizeQuestLinkLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+notes$/, "")
    .replace(/\s+/g, " ");
}

function addQuestFile(quest, folder, title = `${folder} notes`) {
  const existing = quest.files.find((file) => {
    const inferredFolder = inferQuestFileFolder(file, quest.folders);
    return inferredFolder.toLowerCase() === folder.toLowerCase() && file.title.toLowerCase() === title.toLowerCase();
  });
  if (existing) {
    existing.folder = folder;
    return existing;
  }
  const file = {
    id: crypto.randomUUID(),
    folder,
    title,
    content: questFileTemplate(folder, quest.title),
  };
  quest.files.push(file);
  return file;
}

function openQuestWikiLink(label) {
  ensureQuestState();
  const quest = state.quests.find((item) => item.id === state.activeQuestId) || state.quests[0];
  if (!quest) return false;
  const target = normalizeQuestLinkLabel(label);
  if (!target) return false;
  let file = quest.files.find((item) => {
    const title = normalizeQuestLinkLabel(item.title);
    const folder = normalizeQuestLinkLabel(inferQuestFileFolder(item, quest.folders));
    return title === target || folder === target;
  });
  if (!file) {
    const folder = quest.folders.find((item) => normalizeQuestLinkLabel(item) === target);
    if (folder) file = addQuestFile(quest, folder);
  }
  if (!file) return false;
  renderQuests();
  requestAnimationFrame(() => {
    const element = document.querySelector(`[data-quest-file="${file.id}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    element?.classList.add("quest-link-target");
    setTimeout(() => element?.classList.remove("quest-link-target"), 900);
  });
  return true;
}

function isGenericQuestFile(file) {
  const content = String(file?.content || "").trim();
  return !content
    || /^# New quest file\s*$/i.test(content)
    || /Link NPCs, loot, compendium entries or other files with \[\[double brackets\]\]\./i.test(content);
}

document.querySelector("#new-quest-episode").addEventListener("click", () => {
  const title = prompt("Episode title", `Episode ${state.quests.length + 1}: Untitled Quest`);
  if (!title) return;
  state.quests.unshift({
    id: crypto.randomUUID(),
    title,
    folders: ["NPC", "Loot", "Encounters detail", "Main Quest", "Side quests", "Activities", "Random Events", "Locations", "Points of interest"],
    files: [],
  });
  renderQuests();
});
document.querySelector("#quest-list").addEventListener("click", (event) => {
  const questButton = event.target.closest("[data-quest-id]");
  if (questButton && !event.target.closest("[data-open-quest-folder]")) {
    state.activeQuestId = questButton.dataset.questId;
    renderQuests();
    return;
  }
  const folderButton = event.target.closest("[data-open-quest-folder]");
  if (!folderButton) return;
  const [questId, folder] = folderButton.dataset.openQuestFolder.split(":");
  const quest = state.quests.find((item) => item.id === questId);
  if (!quest) return;
  state.activeQuestId = quest.id;
  if (!quest.files.some((file) => inferQuestFileFolder(file, quest.folders).toLowerCase() === folder.toLowerCase())) addQuestFile(quest, folder);
  renderQuests();
});
document.querySelector("#quest-file-windows").addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-quest-file]");
  if (close) {
    const quest = state.quests.find((item) => item.id === state.activeQuestId) || state.quests[0];
    quest.files = quest.files.filter((file) => file.id !== close.dataset.closeQuestFile);
    renderQuests();
    return;
  }
  const wiki = event.target.closest("[data-wiki]");
  if (wiki) {
    if (openQuestWikiLink(wiki.dataset.wiki)) return;
    document.querySelector('[data-view="compendium"]').click();
    searchCompendium(wiki.dataset.wiki);
  }
});
document.querySelector("#quest-file-windows").addEventListener("input", (event) => {
  const titleInput = event.target.closest("[data-quest-title]");
  const contentInput = event.target.closest("[data-quest-content]");
  const quest = state.quests.find((item) => item.id === state.activeQuestId) || state.quests[0];
  if (!quest) return;
  const fileId = titleInput?.dataset.questTitle || contentInput?.dataset.questContent;
  const file = quest.files.find((item) => item.id === fileId);
  if (!file) return;
  if (titleInput) file.title = titleInput.value.trim() || "Untitled";
  if (contentInput) {
    file.content = contentInput.value;
    const preview = document.querySelector(`[data-quest-preview="${file.id}"]`);
    if (preview) preview.innerHTML = markdownToHtml(file.content);
  }
  persist();
});
document.querySelector("#quest-file-windows").addEventListener("focusout", (event) => {
  if (!event.target.closest("[data-quest-title], [data-quest-content]")) return;
  renderQuests();
});
document.querySelector("#open-quest-file").addEventListener("click", () => {
  ensureQuestState();
  const quest = state.quests.find((item) => item.id === state.activeQuestId) || state.quests[0];
  quest.files.push({
    id: crypto.randomUUID(),
    folder: "General",
    title: "New quest file",
    content: "# New quest file\n\n",
  });
  renderQuests();
});
document.querySelector("#scaffold-quest-files").addEventListener("click", () => {
  ensureQuestState();
  const quest = state.quests.find((item) => item.id === state.activeQuestId) || state.quests[0];
  for (const folder of quest.folders) {
    const title = `${folder} notes`;
    const existing = quest.files.find((file) => inferQuestFileFolder(file, quest.folders).toLowerCase() === folder.toLowerCase() && file.title.toLowerCase() === title.toLowerCase());
    if (existing && isGenericQuestFile(existing)) existing.content = questFileTemplate(folder, quest.title);
    else if (!existing) addQuestFile(quest, folder, title);
  }
  renderQuests();
});

let lastAssistantAnswer = "";

function liveAssistantContext() {
  const note = activeNote();
  return {
    round: state.round,
    activeTurn: state.combatants[state.activeTurn]?.name || null,
    combatants: state.combatants.map((item) => ({
      name: item.name, hp: item.hp, maxHp: item.maxHp, ac: item.ac, conditions: item.conditions,
    })),
    characters: characterState.characters.map((character) => ({
      name: character.name,
      species: character.species,
      resources: character.resources,
      alignment: character.alignment,
      gmHooks: character.gmHooks,
    })),
    currentNote: note ? { title: note.title, content: note.content.slice(0, 3000) } : null,
  };
}

function appendAssistantMessage(role, text) {
  const message = document.createElement("p");
  message.className = `assistant-message ${role}`;
  message.textContent = text;
  const container = document.querySelector("#assistant-messages");
  container.append(message);
  container.scrollTop = container.scrollHeight;
}

async function updateAssistantStatus() {
  try {
    const response = await fetch("/api/assistant/status");
    const payload = await response.json();
    document.querySelector("#assistant-status").textContent = payload.configured
      ? `OpenAI connected · ${payload.model}`
      : "Local fallback · set OPENAI_API_KEY for generative assistance";
  } catch {
    document.querySelector("#assistant-status").textContent = "Assistant service unavailable";
  }
}

document.querySelector("#assistant-toggle").addEventListener("click", () => {
  document.querySelector("#assistant-drawer").hidden = false;
  updateAssistantStatus();
  document.querySelector("#assistant-input").focus();
});
document.querySelector("#close-assistant").addEventListener("click", () => {
  document.querySelector("#assistant-drawer").hidden = true;
});
document.querySelector("#assistant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#assistant-input");
  const message = input.value.trim();
  if (!message) return;
  appendAssistantMessage("user", message);
  input.value = "";
  appendAssistantMessage("system", "Working…");
  const pending = document.querySelector("#assistant-messages .assistant-message:last-child");
  try {
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context: liveAssistantContext() }),
    });
    if (!response.ok) throw new Error("OpenAI unavailable");
    const payload = await response.json();
    lastAssistantAnswer = payload.answer;
    pending.className = "assistant-message assistant";
    pending.textContent = payload.answer;
  } catch {
    const response = await fetch("/api/rules/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: message, limit: 5 }),
    });
    const payload = await response.json();
    lastAssistantAnswer = payload.found ? payload.answer : "OpenAI is not configured, and the local rules index found no answer.";
    pending.className = "assistant-message assistant";
    pending.textContent = lastAssistantAnswer;
  }
  document.querySelector("#assistant-to-note").disabled = !lastAssistantAnswer;
});
document.querySelector("#assistant-to-note").addEventListener("click", () => {
  if (!lastAssistantAnswer) return;
  createNote(`AI handout · ${noteTimestamp()}`, `# Handout\n\n${lastAssistantAnswer}`);
  document.querySelector("#assistant-drawer").hidden = true;
  document.querySelector('[data-view="notes"]').click();
});

function campaignSnapshot() {
  return {
    session: sessionSnapshot(),
    notes: noteState,
    characters: characterState,
  };
}

async function saveCampaignNow() {
  if (!activeCampaignId || isPlayerView) return;
  document.querySelector("#campaign-save-status").textContent = "Saving…";
  const response = await fetch(`/api/campaigns/${activeCampaignId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: activeCampaignName, state: campaignSnapshot() }),
  });
  document.querySelector("#campaign-save-status").textContent = response.ok ? "Saved" : "Save failed";
}

function scheduleCampaignSave() {
  if (!activeCampaignId || isPlayerView) return;
  document.querySelector("#campaign-save-status").textContent = "Unsaved";
  clearTimeout(campaignSaveTimer);
  campaignSaveTimer = setTimeout(saveCampaignNow, 700);
}

async function loadCampaign(campaignId) {
  const response = await fetch(`/api/campaigns/${campaignId}`);
  if (!response.ok) return;
  const campaign = await response.json();
  activeCampaignId = campaign.id;
  activeCampaignName = campaign.name;
  localStorage.setItem("holocron.activeCampaign", campaign.id);
  const snapshot = campaign.state || {};
  if (snapshot.session) {
    const transient = {
      image: null, imageUrl: null, pointer: null, measurement: null,
      draggedToken: null, creatureCache: state.creatureCache, pendingNotePin: null,
    };
    Object.assign(state, defaults, snapshot.session, transient);
    state.layers = { ...defaults.layers, ...(snapshot.session.layers || {}) };
    localStorage.setItem("holocron.session", JSON.stringify(sessionSnapshot()));
  }
  if (snapshot.notes) {
    Object.keys(noteState).forEach((key) => delete noteState[key]);
    Object.assign(noteState, snapshot.notes);
    localStorage.setItem("holocron.notes", JSON.stringify(noteState));
  }
  if (snapshot.characters) {
    Object.keys(characterState).forEach((key) => delete characterState[key]);
    Object.assign(characterState, snapshot.characters);
    localStorage.setItem("holocron.characters", JSON.stringify(characterState));
    sharedCharacters = characterState.characters.map(publicCharacter);
  }
  state.mapImageUrl = campaign.map_filename ? `/api/campaigns/${campaign.id}/map?v=${Date.now()}` : null;
  if (state.mapImageUrl) loadMapFromUrl(state.mapImageUrl);
  else {
    state.image = null;
    state.imageUrl = null;
    updateMapEmptyState();
  }
  document.querySelector("#campaign-select").value = campaign.id;
  document.querySelector("#export-campaign").href = `/api/campaigns/${campaign.id}/export`;
  renderNotes();
  renderCharacters();
  renderInitiative();
  publishLiveSession();
  syncMapActionControls();
  resizeCanvas();
}

async function refreshCampaignList(selectId = activeCampaignId) {
  const response = await fetch("/api/campaigns");
  const payload = await response.json();
  const select = document.querySelector("#campaign-select");
  select.innerHTML = payload.items.map((campaign) =>
    `<option value="${campaign.id}">${escapeHtml(campaign.name)}</option>`
  ).join("");
  if (selectId) select.value = selectId;
  return payload.items;
}

async function createCampaign(name) {
  const response = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, state: campaignSnapshot() }),
  });
  const campaign = await response.json();
  activeCampaignId = campaign.id;
  activeCampaignName = campaign.name;
  await refreshCampaignList(campaign.id);
  await loadCampaign(campaign.id);
}

async function initializeCampaigns() {
  if (isPlayerView) return;
  const campaigns = await refreshCampaignList();
  const selected = campaigns.find((campaign) => campaign.id === activeCampaignId) || campaigns[0];
  if (selected) await loadCampaign(selected.id);
  else await createCampaign("Default Campaign");
}

document.querySelector("#campaign-select").addEventListener("change", (event) => loadCampaign(event.target.value));
document.querySelector("#save-campaign").addEventListener("click", saveCampaignNow);
document.querySelector("#new-campaign").addEventListener("click", () => document.querySelector("#campaign-dialog").showModal());
document.querySelector("#campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name");
  event.currentTarget.reset();
  document.querySelector("#campaign-dialog").close();
  await createCampaign(name);
});
document.querySelector("#delete-campaign").addEventListener("click", async () => {
  const campaignId = document.querySelector("#campaign-select").value;
  if (!campaignId) return;
  await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
  activeCampaignId = null;
  localStorage.removeItem("holocron.activeCampaign");
  const campaigns = await refreshCampaignList();
  if (campaigns.length) await loadCampaign(campaigns[0].id);
  else await createCampaign("Default Campaign");
});
document.querySelector("#import-campaign").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const bundle = JSON.parse(await file.text());
  const response = await fetch("/api/campaigns/actions/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  if (response.ok) {
    const campaign = await response.json();
    await refreshCampaignList(campaign.id);
    await loadCampaign(campaign.id);
  }
  event.target.value = "";
});

initializeCampaigns();

function renderPlayerIdentity() {
  if (!isPlayerView) return;
  const select = document.querySelector("#player-character-select");
  select.innerHTML = playerCharacters.length ? playerCharacters.map((character) =>
    `<option value="${character.id}">${escapeHtml(character.name)} · ${escapeHtml(character.species)}</option>`
  ).join("") : '<option value="">Waiting for GM characters</option>';
  document.querySelector("#join-as-player").disabled = !playerCharacters.length;
  if (playerCharacters.some((character) => character.id === selectedPlayerId)) select.value = selectedPlayerId;
  const player = playerCharacters.find((character) => character.id === selectedPlayerId);
  if (playerJoined && !player) playerJoined = false;
  document.querySelector("#player-gate").hidden = playerJoined;
  document.querySelector("#player-hud").hidden = !playerJoined || !player;
  if (!player) return;
  const visibleTokens = state.tokens.filter(tokenVisibleToPlayer);
  const originToken = playerVisionToken();
  const activeCombatant = state.combatants[state.activeTurn];
  const activeToken = activeCombatant ? state.tokens.find((token) => token.combatantId === activeCombatant.id) : null;
  const activeVisible = activeCombatant && (!activeToken || tokenVisibleToPlayer(activeToken));
  document.querySelector("#player-name").textContent = player.name;
  document.querySelector("#player-round").textContent = state.round || 1;
  document.querySelector("#player-visible-count").textContent = `${visibleTokens.length} visible`;
  document.querySelector("#player-sync-status").textContent = `Synced ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  document.querySelector("#player-character-summary").innerHTML = `
    <span>${escapeHtml(player.species || "Unknown species")}</span>
    <strong>Level ${escapeHtml(player.level || 1)} ${escapeHtml(player.className || "Adventurer")}</strong>
    ${player.subclass ? `<small>${escapeHtml(player.subclass)}</small>` : ""}`;
  const sharedNote = document.querySelector("#player-shared-note");
  sharedNote.hidden = !String(player.sharedNote || "").trim();
  sharedNote.innerHTML = player.sharedNote ? `<small>Player / GM note</small><p>${escapeHtml(player.sharedNote)}</p>` : "";
  const turnCard = document.querySelector("#player-turn-card");
  turnCard.hidden = !activeVisible;
  if (activeVisible) turnCard.innerHTML = `<span>Current turn</span><strong>${escapeHtml(activeCombatant.name)}</strong>`;
  const visionWarning = document.querySelector("#player-vision-warning");
  visionWarning.hidden = Boolean(originToken);
  visionWarning.textContent = originToken ? "" : "No linked token on the battlemap yet. Ask the GM to deploy your character.";
  document.querySelector("#player-visible-list").innerHTML = visibleTokens.length ? `
    <small>Visible actors</small>
    ${visibleTokens.map((token) => {
      const combatant = state.combatants.find((item) => item.id === token.combatantId);
      const conditions = (combatant?.conditions || []).join(", ");
      const active = combatant && activeCombatant?.id === combatant.id;
      return `<div class="player-visible-token ${active ? "active" : ""}">
        <strong>${escapeHtml(token.name)}</strong>
        <span>${escapeHtml(token.type || "token")}${conditions ? ` · ${escapeHtml(conditions)}` : ""}</span>
      </div>`;
    }).join("")}` : "";
  document.querySelector("#player-credits").textContent = `${player.credits || 0} cr`;
  document.querySelector("#player-resources").innerHTML = Object.values(player.resources || {}).map((resource) => `
    <div class="player-resource" style="--resource-color:${resource.color}">
      <strong>${resource.value}/${resource.max}</strong><span>${escapeHtml(resource.label)}</span>
    </div>`).join("") || '<p class="loading-line">No tracked resources.</p>';
  const equippedIds = new Set(Object.values(player.equipped || {}));
  document.querySelector("#player-inventory").innerHTML = (player.inventory || []).map((item) => `
    <div class="player-inventory-item">${equippedIds.has(item.id) ? "Equipped · " : ""}${escapeHtml(item.name)} · ${item.weight} lb</div>
  `).join("") || '<p class="loading-line">No visible inventory yet.</p>';
}

document.querySelector("#join-as-player").addEventListener("click", () => {
  selectedPlayerId = document.querySelector("#player-character-select").value;
  if (!selectedPlayerId) return;
  localStorage.setItem("holocron.playerCharacter", selectedPlayerId);
  playerJoined = true;
  renderPlayerIdentity();
  draw();
});
document.querySelector("#change-player").addEventListener("click", () => {
  playerJoined = false;
  renderPlayerIdentity();
});

if (isPlayerView) {
  document.querySelector("#player-gate").hidden = false;
  let playerStateVersion = -1;
  setInterval(async () => {
    try {
      const response = await fetch("/api/session/state");
      const payload = await response.json();
      if (!Object.keys(payload.state).length) {
        document.querySelector("#player-sync-status").textContent = "Waiting for GM";
        renderPlayerIdentity();
        return;
      }
      if (payload.version === playerStateVersion) return;
      playerStateVersion = payload.version;
      const bundle = payload.state;
      const mapState = bundle.map || bundle;
      playerCharacters = bundle.characters || [];
      document.querySelector("#player-sync-status").textContent = "Syncing…";
      const transient = {
        image: state.image,
        imageUrl: state.imageUrl,
        creatureCache: state.creatureCache,
      };
      Object.assign(state, mapState, transient);
      state.layers = { ...defaults.layers, ...(mapState.layers || {}), lighting: true, fog: true };
      if (mapState.mapImageUrl) loadMapFromUrl(mapState.mapImageUrl);
      renderPlayerIdentity();
      syncMapActionControls();
      resizeCanvas();
    } catch {
      // Keep the last received state visible while the GM reconnects.
      document.querySelector("#player-sync-status").textContent = "Connection lost";
    }
  }, 500);
}
