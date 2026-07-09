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
  zoom: 1,
  offset: { x: 0, y: 0 },
  tool: "select",
  layers: { background: true, objects: true, tokens: true, grid: true },
  tokens: [],
  walls: [],
  pings: [],
  combatants: [],
  activeTurn: 0,
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
      <li class="combatant ${index === state.activeTurn ? "active" : ""}" data-id="${item.id}">
        <span class="combatant-token ${item.type}">${initials(item.name)}</span>
        <span class="combatant-info"><strong>${item.name}</strong><span>INIT ${item.initiative} · AC ${item.ac}</span></span>
        <span class="hp-control">
          <button data-hp="-1" title="Reduce HP">−</button>
          <output>${item.hp}/${item.maxHp}</output>
          <button data-hp="1" title="Restore HP">＋</button>
        </span>
      </li>`).join("");
  }
  document.querySelector("#round-number").textContent = state.round;
}

function renderLibrary(items = tokenPresets) {
  state.creatureCache = items;
  document.querySelector("#token-library").innerHTML = items.map((item, index) => `
    <div class="library-entry" draggable="true" data-creature="${index}" title="Drag ${item.name} to the map">
      <span class="library-token ${item.type}">${initials(item.name)}</span>
      <span class="library-entry-info"><strong>${item.name}</strong><span>${item.type || "creature"}</span></span>
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
  if (!button || !row) return;
  const combatant = state.combatants.find((item) => item.id === row.dataset.id);
  combatant.hp = Math.max(0, Math.min(combatant.maxHp, combatant.hp + Number(button.dataset.hp)));
  persist();
  renderInitiative();
});
document.querySelector("#roll-initiative").addEventListener("click", () => {
  state.combatants.forEach((item) => { item.initiative = Math.floor(Math.random() * 20) + 1; });
  state.combatants.sort((a, b) => b.initiative - a.initiative);
  state.activeTurn = 0;
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
