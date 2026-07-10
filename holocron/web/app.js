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
  tool: "select",
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
state.assetFilterMode = null;
state.imageBookFilters = null;

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
  return item?.imageUrl || item?.primary_image?.url || item?.url || "";
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
  const ratio = window.devicePixelRatio || 1;
  const fog = document.createElement("canvas");
  fog.width = width * ratio;
  fog.height = height * ratio;
  const fogCtx = fog.getContext("2d");
  fogCtx.scale(ratio, ratio);
  fogCtx.fillStyle = "rgba(0, 2, 5, .92)";
  fogCtx.fillRect(0, 0, width, height);
  fogCtx.globalCompositeOperation = "destination-out";
  const visiblePoints = isPlayerView ? [playerVisionToken()].filter(Boolean) : state.explored;
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
  const visionToken = (isPlayerView ? playerVisionToken() : null)
    || state.tokens.find((token) => token.selected)
    || state.tokens.find((token) => token.combatantId === state.selectedCombatantId);
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
  updateZoom();
}

function loadMapFromUrl(url, options = {}) {
  if (!url || state.imageUrl === url) return;
  const image = new Image();
  image.onload = () => {
    state.image = image;
    state.imageUrl = url;
    if (options.fit) fitMapImage(image);
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
  const combatant = {
    id: crypto.randomUUID(),
    name: source.name,
    type: source.type || "enemy",
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
  };
  state.combatants.push(combatant);
  if (point) state.tokens.push({
    ...point,
    combatantId: combatant.id,
    characterId: source.characterId || null,
    name: combatant.name,
    type: combatant.type,
    imageUrl: combatant.imageUrl,
  });
  persist();
  renderInitiative();
  draw();
}

function addMapAsset(source, point = mapCenterPoint()) {
  if (!source || !imageUrlFor(source)) return;
  state.tokens.push({
    ...point,
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
  return item.type || "creature";
}

function libraryBadge(item) {
  if (item.assetKind === "pdf-image") return `p.${item.page ?? "?"}`;
  return `CR ${item.cr ?? "—"}`;
}

function libraryActions(item, index) {
  const badge = `<span class="library-entry-badge">${escapeHtml(libraryBadge(item))}</span>`;
  if (item.assetKind !== "pdf-image") return badge;
  return `<span class="library-entry-actions">${badge}<button class="library-entry-map" data-map-background="${index}" title="Use as map background" aria-label="Use as map background">▣</button></span>`;
}

function renderLibrary(items = tokenPresets) {
  state.creatureCache = items;
  document.querySelector("#token-library").innerHTML = items.map((item, index) => `
    <div class="library-entry" draggable="true" tabindex="0" data-creature="${index}" title="Drag or double-click ${escapeHtml(item.name)} to add it to the map">
      ${tokenMarkup(item, "library-token")}
      <span class="library-entry-info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(librarySubtitle(item))}</span></span>
      ${libraryActions(item, index)}
    </div>`).join("");
}

function mapCenterPoint() {
  return {
    x: (shell.clientWidth / 2 - state.offset.x) / state.zoom,
    y: (shell.clientHeight / 2 - state.offset.y) / state.zoom,
  };
}

async function configureAssetFilter(mode, payload = null) {
  const filter = document.querySelector("#bestiary-cr");
  if (state.assetFilterMode !== mode) {
    state.assetFilterMode = mode;
    filter.innerHTML = mode === "creatures"
      ? '<option value="">All CR</option>'
      : mode === "images"
        ? '<option value="">All books</option>'
        : '<option value="">All</option>';
    filter.value = "";
  }
  filter.disabled = mode === "tokens";
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
}

async function loadBestiary() {
  const mode = document.querySelector("#asset-library-mode").value;
  const search = document.querySelector("#bestiary-search").value.trim();
  const params = new URLSearchParams({ limit: mode === "tokens" ? "60" : mode === "images" ? "40" : "30" });
  await configureAssetFilter(mode);
  const filterValue = document.querySelector("#bestiary-cr").value;
  document.querySelector("#bestiary-search").placeholder = mode === "tokens" ? "Search token, faction…" : mode === "images" ? "Search book, page, source…" : "Search creature, faction…";
  if (search) params.set("q", search);
  if (mode === "creatures" && filterValue) params.set("cr", filterValue);
  if (mode === "images" && filterValue) params.set("book", filterValue);
  try {
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
    document.querySelector("#bestiary-count").textContent = `${payload.total} ${mode === "tokens" ? "tokens" : mode === "images" ? "images" : "creatures"}`;
  } catch {
    renderLibrary();
    document.querySelector("#bestiary-count").textContent = "Offline presets";
  }
}

function updateZoom() {
  document.querySelector("#zoom-output").textContent = `${Math.round(state.zoom * 100)}%`;
  persist();
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
  persist();
  draw();
}));

document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => {
  state.tool = button.dataset.tool;
  document.querySelectorAll("[data-tool]").forEach((item) => item.classList.toggle("active", item === button));
  persist();
}));

canvas.addEventListener("pointerdown", (event) => {
  const point = worldPoint(event);
  state.pointer = point;
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
  if (!state.pointer) return;
  const point = worldPoint(event);
  if (state.measurement) state.measurement.end = point;
  if (state.draggedToken) {
    state.draggedToken.x = Math.round(point.x / state.gridSize) * state.gridSize + state.gridSize / 2;
    state.draggedToken.y = Math.round(point.y / state.gridSize) * state.gridSize + state.gridSize / 2;
    if (state.layers.fog) state.explored.push({ x: state.draggedToken.x, y: state.draggedToken.y });
  }
  draw();
});

canvas.addEventListener("pointerup", () => {
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

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const before = { x: (cursor.x - state.offset.x) / state.zoom, y: (cursor.y - state.offset.y) / state.zoom };
  state.zoom = Math.min(3, Math.max(.25, state.zoom * (event.deltaY < 0 ? 1.1 : .9)));
  state.offset = { x: cursor.x - before.x * state.zoom, y: cursor.y - before.y * state.zoom };
  updateZoom();
  draw();
}, { passive: false });

document.querySelector("#zoom-in").addEventListener("click", () => { state.zoom = Math.min(3, state.zoom * 1.2); updateZoom(); draw(); });
document.querySelector("#zoom-out").addEventListener("click", () => { state.zoom = Math.max(.25, state.zoom / 1.2); updateZoom(); draw(); });
document.querySelector("#reset-view").addEventListener("click", () => { state.zoom = 1; state.offset = { x: 0, y: 0 }; updateZoom(); draw(); });
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
document.querySelector("#token-library").addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-background]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  setMapBackgroundFromLibrary(state.creatureCache[Number(button.dataset.mapBackground)]);
});
document.querySelector("#token-library").addEventListener("dblclick", (event) => {
  if (event.target.closest("[data-map-background]")) return;
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
document.querySelector("#asset-library-mode").addEventListener("change", loadBestiary);
document.querySelector("#bestiary-cr").addEventListener("change", loadBestiary);

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
loadBestiary();
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

function markdownToHtml(markdown) {
  let html = escapeHtml(markdown);
  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]]+)\]\]/g, '<button class="wiki-link" data-wiki="$1">$1</button>');
  return html.split(/\n{2,}/).map((block) =>
    /^<h[1-3]>/.test(block) ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`
  ).join("");
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

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  const view = button.dataset.view;
  document.querySelector("#battlemap-view").hidden = view !== "battlemap";
  document.querySelector("#notes-view").hidden = view !== "notes";
  document.querySelector("#characters-view").hidden = view !== "characters";
  document.querySelector("#compendium-view").hidden = view !== "compendium";
  document.querySelector("#books-view").hidden = view !== "books";
  document.querySelector("#toolkit-view").hidden = view !== "toolkit";
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
  if (view === "battlemap") resizeCanvas();
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

function renderCharacters() {
  const character = currentCharacter();
  if (!character) return;
  document.querySelector("#character-list").innerHTML = characterState.characters.map((item) => `
    <button class="character-list-item" data-character-id="${item.id}">
      <i>${initials(item.name)}</i><strong>${escapeHtml(item.name)}<span>${escapeHtml(item.species)}</span></strong>
    </button>`).join("");
  document.querySelector("#character-name").textContent = character.name;
  document.querySelector("#character-species").value = character.species;
  document.querySelector(".silhouette").dataset.species = character.species;
  const equippedItems = Object.values(character.equipped).map((id) => character.inventory.find((item) => item.id === id)).filter(Boolean);
  const ac = character.baseAc + equippedItems.reduce((total, item) => total + (item.ac || 0), 0);
  const attack = equippedItems.reduce((total, item) => total + (item.attack || 0), 0);
  const weight = character.inventory.reduce((total, item) => total + item.weight, 0);
  document.querySelector("#character-ac").textContent = ac;
  document.querySelector("#character-attack").textContent = `${attack >= 0 ? "+" : ""}${attack}`;
  document.querySelector("#character-weight").textContent = weight;
  document.querySelector("#character-credits").textContent = `${character.credits || 0} cr`;
  document.querySelector("#cargo-capacity").textContent = `${weight} / ${character.cargoCapacity || 100} lb`;
  document.querySelector("#sell-selected-item").disabled = !characterState.selectedItemId;
  document.querySelectorAll("[data-slot]").forEach((slot) => {
    const item = character.inventory.find((candidate) => candidate.id === character.equipped[slot.dataset.slot]);
    slot.querySelector("strong").textContent = item?.name || "Empty";
    slot.classList.toggle("target", Boolean(characterState.selectedItemId && character.inventory.find((candidate) => candidate.id === characterState.selectedItemId)?.slot === slot.dataset.slot));
  });
  document.querySelector("#character-stash").innerHTML = character.inventory
    .filter((item) => !Object.values(character.equipped).includes(item.id))
    .map((item) => `
      <button class="stash-item ${item.id === characterState.selectedItemId ? "selected" : ""}" data-item-id="${item.id}">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.slot ? escapeHtml(item.slot) : "cargo"} · ${item.weight} lb${item.ac ? ` · +${item.ac} AC` : ""}${item.attack ? ` · +${item.attack} attack` : ""}</span>
      </button>`).join("");
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
}

document.querySelector("#character-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-character-id]");
  if (!button) return;
  characterState.activeId = button.dataset.characterId;
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
document.querySelector("#new-character").addEventListener("click", () => document.querySelector("#character-dialog").showModal());
document.querySelector("#deploy-character").addEventListener("click", () => {
  const character = currentCharacter();
  if (!character) return;
  const existing = state.combatants.find((combatant) => combatant.characterId === character.id || combatant.name === character.name);
  if (!existing) {
    const equippedItems = Object.values(character.equipped).map((id) => character.inventory.find((item) => item.id === id)).filter(Boolean);
    const ac = character.baseAc + equippedItems.reduce((total, item) => total + (item.ac || 0), 0);
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
document.querySelector("#add-inventory-item").addEventListener("click", () => document.querySelector("#inventory-dialog").showModal());
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
  character.inventory = [];
  character.equipped = {};
  character.credits = 500;
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
  currentCharacter().inventory.push({
    id: crypto.randomUUID(),
    name: data.name,
    weight: Number(data.weight),
    value: Number(data.value),
    slot: data.slot || null,
  });
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
document.querySelector("#sell-selected-item").addEventListener("click", () => {
  const character = currentCharacter();
  const item = character.inventory.find((candidate) => candidate.id === characterState.selectedItemId);
  if (!item) return;
  character.credits = (character.credits || 0) + Math.floor((item.value || 0) / 2);
  character.inventory = character.inventory.filter((candidate) => candidate.id !== item.id);
  characterState.selectedItemId = null;
  saveCharacters();
  renderCharacters();
});

renderCharacters();

function citationLabel(result) {
  const pages = result.page_start
    ? `p. ${result.page_start}${result.page_end && result.page_end !== result.page_start ? `–${result.page_end}` : ""}`
    : "page unknown";
  return `${result.source_title} · ${pages}`;
}

async function searchCompendium(query) {
  const input = document.querySelector("#compendium-search");
  query = (query ?? input.value).trim();
  if (!query) return;
  input.value = query;
  const results = document.querySelector("#compendium-results");
  results.innerHTML = '<p class="loading-line">Searching local index…</p>';
  document.querySelector("#results-count").textContent = "Searching";
  try {
    const response = await fetch(`/api/rules/search?q=${encodeURIComponent(query)}&limit=30`);
    if (!response.ok) throw new Error("Search failed");
    const items = await response.json();
    document.querySelector("#results-count").textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;
    results.innerHTML = items.map((item) => `
      <article class="search-result">
        <header><h3>${escapeHtml(item.section_title || item.source_title)}</h3><span>${escapeHtml(item.knowledge_type.replaceAll("_", " "))}</span></header>
        <p>${escapeHtml(item.excerpt)}</p>
        <footer>${escapeHtml(citationLabel(item))}</footer>
      </article>`).join("") || '<p class="loading-line">No indexed source matched this query.</p>';
  } catch {
    document.querySelector("#results-count").textContent = "Unavailable";
    results.innerHTML = '<p class="loading-line">The local index is unavailable. Run the ingestion command to rebuild it.</p>';
  }
}

document.querySelector("#run-compendium-search").addEventListener("click", () => searchCompendium());
document.querySelector("#compendium-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchCompendium();
});
document.querySelector(".compendium-nav").addEventListener("click", (event) => {
  const preset = event.target.closest("[data-query]");
  if (!preset) return;
  document.querySelectorAll(".compendium-preset").forEach((item) => item.classList.toggle("active", item === preset));
  searchCompendium(preset.dataset.query);
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

searchCompendium("combat");

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

loadBooks();

const npcNames = {
  Human: ["Mara Venn", "Cal Jorren", "Tessa Rook", "Dain Ordo"],
  Zabrak: ["Vesh Korr", "Sira Drenn", "Keth Marr", "Ralo Vex"],
  Duros: ["Noro Daal", "Bane Ceto", "Luro Senn", "Dree Vanto"],
  "Twi'lek": ["Nima Vao", "Kora Syndulla", "Tann Ryl", "Veya Numa"],
  Wookiee: ["Rrakkorr", "Chevraaka", "Tarfful", "Kallabow"],
  Rodian: ["Greevo", "Neesh Ko", "Varko", "Seln Vee"],
  Chiss: ["Ar'alani", "Kres'ten", "Mitth'oro", "Vurawn"],
};
const npcRoles = ["Smuggler", "Bounty Hunter", "Officer", "Mechanic", "Informant", "Force Adept"];
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
};
const flavorTone = {
  tense: "Nobody speaks above a murmur; every sudden movement draws a hand toward a holster.",
  mysterious: "A detail refuses to fit, as though someone carefully edited this place after the fact.",
  lively: "Voices overlap in a dozen languages, turning the space into a restless current of opportunity.",
  grim: "Everything useful has already been stripped away, leaving only stains and old promises.",
};
let generatedEncounter = [];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function generateNpc() {
  const species = document.querySelector("#npc-species").value || randomItem(Object.keys(npcNames));
  const role = document.querySelector("#npc-role").value || randomItem(npcRoles);
  const name = randomItem(npcNames[species]);
  const attributes = ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((label) => ({
    label, value: 8 + Math.floor(Math.random() * 11),
  }));
  document.querySelector("#npc-output").innerHTML = `
    <canvas id="npc-portrait-canvas" class="npc-portrait" width="144" height="144"></canvas>
    <div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(species)} · ${escapeHtml(role)}</p><p>${escapeHtml(randomItem(npcQuirks))}</p></div>`;
  drawNpcPortrait(species, name);
  document.querySelector("#npc-attributes").innerHTML = attributes.map((attribute) =>
    `<span>${attribute.label}<strong>${attribute.value}</strong></span>`
  ).join("");
  document.querySelector("#npc-hook").textContent = randomItem(npcHooks);
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

function generateLoot() {
  const cr = Math.max(0, Number(document.querySelector("#toolkit-cr").value) || 0);
  const credits = Math.round((150 + cr * 275 + Math.random() * 400) / 10) * 10;
  const modCount = Math.max(1, Math.ceil(cr / 7));
  const mods = Array.from({ length: modCount }, () => randomItem(lootMods));
  document.querySelector("#loot-output").innerHTML = `
    <div class="loot-line"><span>Credits</span><strong>${credits.toLocaleString()} cr</strong></div>
    <div class="loot-line"><span>Modifications</span><strong>${escapeHtml(mods.join(", "))}</strong></div>
    <div class="loot-line"><span>Consumables</span><strong>${1 + Math.floor(cr / 4)}× ${escapeHtml(randomItem(consumables))}</strong></div>
    <div class="loot-line"><span>Salvage grade</span><strong>${cr < 5 ? "Standard" : cr < 12 ? "Prototype" : "Military restricted"}</strong></div>`;
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
    document.querySelector("#encounter-output").innerHTML = generatedEncounter.map((item) => `
      <div class="encounter-suggestion"><strong>${escapeHtml(item.name)}</strong><span>CR ${escapeHtml(item.cr)} · HP ${item.hp}</span></div>`
    ).join("");
    document.querySelector("#send-encounter").disabled = false;
  } catch {
    document.querySelector("#encounter-output").innerHTML = '<p class="loading-line">Bestiary unavailable.</p>';
  }
}

function generateFlavor() {
  const scene = document.querySelector("#flavor-scene").value;
  const tone = document.querySelector("#flavor-tone").value;
  document.querySelector("#flavor-output").textContent = `${randomItem(flavorParts[scene])} ${flavorTone[tone]}`;
  document.querySelector("#session-spark").textContent = randomItem(npcHooks);
}

document.querySelector("#generate-npc").addEventListener("click", generateNpc);
document.querySelector("#generate-loot").addEventListener("click", generateLoot);
document.querySelector("#generate-encounter").addEventListener("click", generateEncounter);
document.querySelector("#generate-flavor").addEventListener("click", generateFlavor);
document.querySelector("#send-encounter").addEventListener("click", () => {
  generatedEncounter.forEach((creature) => addCombatant(creature));
  document.querySelector('[data-view="battlemap"]').click();
});
document.querySelector("#flavor-to-note").addEventListener("click", () => {
  const flavor = document.querySelector("#flavor-output").textContent.trim();
  if (!flavor) return;
  createNote(`Scene flavor · ${noteTimestamp()}`, `# Scene flavor\n\n${flavor}`);
  document.querySelector('[data-view="notes"]').click();
});

generateNpc();
generateLoot();
generateFlavor();

function playSoundEffect(type) {
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  oscillator.connect(gain).connect(audio.destination);
  if (type === "blaster") {
    oscillator.type = "sawtooth"; oscillator.frequency.setValueAtTime(900, now); oscillator.frequency.exponentialRampToValueAtTime(90, now + .18);
    gain.gain.setValueAtTime(.35, now); gain.gain.exponentialRampToValueAtTime(.001, now + .2);
  } else if (type === "saber") {
    oscillator.type = "sawtooth"; oscillator.frequency.setValueAtTime(75, now); oscillator.frequency.linearRampToValueAtTime(130, now + .5);
    gain.gain.setValueAtTime(.18, now); gain.gain.exponentialRampToValueAtTime(.001, now + .65);
  } else if (type === "alarm") {
    oscillator.type = "square"; oscillator.frequency.setValueAtTime(440, now); oscillator.frequency.setValueAtTime(660, now + .22); oscillator.frequency.setValueAtTime(440, now + .44);
    gain.gain.setValueAtTime(.15, now); gain.gain.exponentialRampToValueAtTime(.001, now + .7);
  } else {
    oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(65, now); oscillator.frequency.exponentialRampToValueAtTime(28, now + .7);
    gain.gain.setValueAtTime(.3, now); gain.gain.exponentialRampToValueAtTime(.001, now + .75);
  }
  oscillator.start(now);
  oscillator.stop(now + .8);
}

document.querySelector(".soundboard-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sound]");
  if (button) playSoundEffect(button.dataset.sound);
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
  select.innerHTML = playerCharacters.map((character) =>
    `<option value="${character.id}">${escapeHtml(character.name)} · ${escapeHtml(character.species)}</option>`
  ).join("");
  if (playerCharacters.some((character) => character.id === selectedPlayerId)) select.value = selectedPlayerId;
  const player = playerCharacters.find((character) => character.id === selectedPlayerId);
  document.querySelector("#player-gate").hidden = playerJoined;
  document.querySelector("#player-hud").hidden = !playerJoined || !player;
  if (!player) return;
  document.querySelector("#player-name").textContent = player.name;
  document.querySelector("#player-credits").textContent = `${player.credits || 0} cr`;
  document.querySelector("#player-resources").innerHTML = Object.values(player.resources || {}).map((resource) => `
    <div class="player-resource" style="--resource-color:${resource.color}">
      <strong>${resource.value}/${resource.max}</strong><span>${escapeHtml(resource.label)}</span>
    </div>`).join("");
  const equippedIds = new Set(Object.values(player.equipped || {}));
  document.querySelector("#player-inventory").innerHTML = (player.inventory || []).map((item) => `
    <div class="player-inventory-item">${equippedIds.has(item.id) ? "Equipped · " : ""}${escapeHtml(item.name)} · ${item.weight} lb</div>
  `).join("");
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
      if (payload.version === playerStateVersion || !Object.keys(payload.state).length) return;
      playerStateVersion = payload.version;
      const bundle = payload.state;
      const mapState = bundle.map || bundle;
      playerCharacters = bundle.characters || [];
      const transient = {
        image: state.image,
        imageUrl: state.imageUrl,
        creatureCache: state.creatureCache,
      };
      Object.assign(state, mapState, transient);
      state.layers = { ...defaults.layers, ...(mapState.layers || {}), lighting: true, fog: true };
      if (mapState.mapImageUrl) loadMapFromUrl(mapState.mapImageUrl);
      renderPlayerIdentity();
      resizeCanvas();
    } catch {
      // Keep the last received state visible while the GM reconnects.
    }
  }, 500);
}
