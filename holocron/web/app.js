const canvas = document.querySelector("#map-canvas");
const ctx = canvas.getContext("2d");
const shell = document.querySelector("#map-shell");
const emptyState = document.querySelector("#map-empty");
const measurementLabel = document.querySelector("#measurement");

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
  layers: { background: true, objects: true, tokens: true, grid: true, lighting: false },
  tokens: [],
  walls: [],
  pings: [],
  combatants: [],
  activeTurn: 0,
  selectedCombatantId: null,
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

const tokenPresets = [
  { name: "Sith Trooper", type: "enemy", hp: 18, ac: 14 },
  { name: "Mercenary", type: "enemy", hp: 24, ac: 15 },
  { name: "Combat Droid", type: "enemy", hp: 32, ac: 16 },
  { name: "Jedi Ally", type: "ally", hp: 38, ac: 17 },
  { name: "Player", type: "player", hp: 40, ac: 16 },
  { name: "Civilian", type: "ally", hp: 8, ac: 10 },
];

const conditionRules = {
  blinded: { color: "#9aa6b2", rule: "Cannot see; attacks have disadvantage and incoming attacks have advantage." },
  frightened: { color: "#a875d2", rule: "Disadvantage on checks and attacks while the source of fear is visible." },
  grappled: { color: "#e3a24e", rule: "Speed becomes 0." },
  incapacitated: { color: "#ef6464", rule: "Cannot take actions or reactions." },
  poisoned: { color: "#74bd62", rule: "Disadvantage on attack rolls and ability checks." },
  prone: { color: "#d68a55", rule: "Crawl movement; attacks affected by attacker distance." },
  restrained: { color: "#d9b05f", rule: "Speed 0; attacks have disadvantage; incoming attacks have advantage." },
  shocked: { color: "#58b8e8", rule: "Cannot take reactions; limited action economy." },
  slowed: { color: "#6ca8cb", rule: "Movement and action economy are reduced." },
  stunned: { color: "#f07878", rule: "Incapacitated, cannot move, automatically fails STR and DEX saves." },
  unconscious: { color: "#7c8490", rule: "Incapacitated, prone, cannot move or speak, unaware." },
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function persist() {
  const clean = { ...state };
  delete clean.image;
  delete clean.imageUrl;
  delete clean.pointer;
  delete clean.measurement;
  delete clean.draggedToken;
  delete clean.creatureCache;
  localStorage.setItem("holocron.session", JSON.stringify(clean));
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
  ctx.fillStyle = "rgba(53, 208, 186, .05)";
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
  return type === "enemy" ? "#a64b53" : type === "player" ? "#35a99a" : "#78848e";
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function drawToken(token) {
  const point = screenPoint(token);
  const radius = Math.max(13, state.gridSize * state.zoom * .38);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = tokenColor(token.type);
  ctx.fill();
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
  ctx.fillText(initials(token.name), point.x, point.y);
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
    for (const wall of state.walls) {
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
  const visionToken = state.tokens.find((token) => token.selected)
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
  ctx.strokeStyle = "#35d0ba";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#35d0ba";
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
    ctx.strokeStyle = `rgba(53, 208, 186, ${1 - progress})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (state.pings.length) requestAnimationFrame(draw);
}

function draw() {
  const width = shell.clientWidth;
  const height = shell.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawBackdrop(width, height);
  if (state.image && state.layers.background) {
    ctx.save();
    ctx.translate(state.offset.x, state.offset.y);
    ctx.scale(state.zoom, state.zoom);
    ctx.drawImage(state.image, 0, 0);
    ctx.restore();
  }
  if (state.layers.grid) drawGrid(width, height);
  drawLighting(width, height);
  if (state.layers.objects) {
    drawWalls();
    drawPings();
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
    const fit = Math.min(shell.clientWidth / image.width, shell.clientHeight / image.height);
    state.zoom = Math.min(1, fit);
    state.offset = {
      x: (shell.clientWidth - image.width * state.zoom) / 2,
      y: (shell.clientHeight - image.height * state.zoom) / 2,
    };
    emptyState.hidden = true;
    updateZoom();
    draw();
  };
  image.src = state.imageUrl;
}

function addCombatant(source, point = null) {
  const combatant = {
    id: crypto.randomUUID(),
    name: source.name,
    type: source.type || "enemy",
    hp: Number(source.hp || 10),
    maxHp: Number(source.hp || 10),
    ac: Number(source.ac || 12),
    initiative: Math.floor(Math.random() * 20) + 1,
    conditions: [],
    actions: source.actions || [],
  };
  state.combatants.push(combatant);
  if (point) state.tokens.push({ ...point, combatantId: combatant.id, name: combatant.name, type: combatant.type });
  persist();
  renderInitiative();
  draw();
}

function renderInitiative() {
  const list = document.querySelector("#initiative-list");
  if (!state.combatants.length) {
    list.innerHTML = '<li class="initiative-empty">Add combatants or drag a token onto the map.</li>';
  } else {
    list.innerHTML = state.combatants.map((item, index) => `
      <li class="combatant ${index === state.activeTurn ? "active" : ""} ${item.id === state.selectedCombatantId ? "selected" : ""}" data-id="${item.id}">
        <span class="combatant-token ${item.type}">${initials(item.name)}</span>
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
}

function renderLibrary(items = tokenPresets) {
  state.creatureCache = items;
  document.querySelector("#token-library").innerHTML = items.map((item, index) => `
    <div class="library-entry" draggable="true" data-creature="${index}" title="Drag ${escapeHtml(item.name)} to the map">
      <span class="library-token ${item.type}">${initials(item.name)}</span>
      <span class="library-entry-info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.type || "creature")}</span></span>
      <span>CR ${item.cr ?? "—"}</span>
    </div>`).join("");
}

async function loadBestiary() {
  const search = document.querySelector("#bestiary-search").value.trim();
  const cr = document.querySelector("#bestiary-cr").value;
  const params = new URLSearchParams({ limit: "30" });
  if (search) params.set("q", search);
  if (cr) params.set("cr", cr);
  try {
    const response = await fetch(`/api/compendium/creatures?${params}`);
    if (!response.ok) throw new Error("Bestiary unavailable");
    const payload = await response.json();
    renderLibrary(payload.items);
    document.querySelector("#bestiary-count").textContent = `${payload.total} creatures`;
    const crSelect = document.querySelector("#bestiary-cr");
    if (crSelect.options.length === 1) {
      for (const value of payload.filters.challenge_ratings) {
        crSelect.add(new Option(`CR ${value}`, value));
      }
    }
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
  if (state.tool === "ping") state.pings.push({ ...point, created: Date.now() });
  if (state.tool === "select") {
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
  }
  draw();
});

canvas.addEventListener("pointerup", () => {
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
canvas.addEventListener("dragover", (event) => event.preventDefault());
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const index = event.dataTransfer.getData("application/holocron-token");
  if (index !== "") addCombatant(state.creatureCache[Number(index)], worldPoint(event));
});

let bestiaryTimer;
document.querySelector("#bestiary-search").addEventListener("input", () => {
  clearTimeout(bestiaryTimer);
  bestiaryTimer = setTimeout(loadBestiary, 180);
});
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
document.querySelector("#roll-initiative").addEventListener("click", () => {
  state.combatants.forEach((item) => { item.initiative = Math.floor(Math.random() * 20) + 1; });
  state.combatants.sort((a, b) => b.initiative - a.initiative);
  state.activeTurn = 0;
  state.selectedCombatantId = null;
  state.round = 1;
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

const defaultCharacter = {
  id: "player-1",
  name: "Kira Venn",
  species: "Human",
  baseAc: 10,
  resources: {
    hp: { label: "HP", value: 36, max: 42, color: "#e36969" },
    force: { label: "Force", value: 12, max: 16, color: "#58b8e8" },
    tech: { label: "Tech", value: 8, max: 10, color: "#e1ad4f" },
    hitDice: { label: "Hit Dice", value: 5, max: 7, color: "#8e79c6" },
  },
  alignment: 0,
  passiveInsight: 14,
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

function currentCharacter() {
  return characterState.characters.find((character) => character.id === characterState.activeId);
}

function saveCharacters() {
  localStorage.setItem("holocron.characters", JSON.stringify(characterState));
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
  const equippedItems = Object.values(character.equipped).map((id) => character.inventory.find((item) => item.id === id)).filter(Boolean);
  const ac = character.baseAc + equippedItems.reduce((total, item) => total + (item.ac || 0), 0);
  const attack = equippedItems.reduce((total, item) => total + (item.attack || 0), 0);
  const weight = character.inventory.reduce((total, item) => total + item.weight, 0);
  document.querySelector("#character-ac").textContent = ac;
  document.querySelector("#character-attack").textContent = `${attack >= 0 ? "+" : ""}${attack}`;
  document.querySelector("#character-weight").textContent = weight;
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
