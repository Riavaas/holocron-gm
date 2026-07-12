import * as THREE from "/static/vendor/three.module.min.js";

const canvas = document.querySelector("#dice-canvas");
const faceResult = document.querySelector("#dice-face-result");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
camera.position.set(0, 1.05, 5.8);
camera.lookAt(0, .05, 0);
scene.add(new THREE.HemisphereLight(0xafc6d6, 0x20262a, 2.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(3, 5, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xc40f0f, 2);
rimLight.position.set(-4, 2, -2);
scene.add(rimLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.7, 64),
  new THREE.MeshStandardMaterial({ color: 0x151a1e, roughness: .88, metalness: .08 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.45;
scene.add(ground);

let die;
let velocity = 0;
let bounce = 0;
let resultTimer;

function geometryFor(sides) {
  if (sides === 6) return new THREE.BoxGeometry(1.55, 1.55, 1.55);
  if (sides === 8) return new THREE.OctahedronGeometry(1.22);
  if (sides === 12) return new THREE.DodecahedronGeometry(1.22);
  return new THREE.IcosahedronGeometry(1.22);
}

function numberedTexture(value) {
  const label = document.createElement("canvas");
  label.width = 192;
  label.height = 192;
  const labelContext = label.getContext("2d");
  labelContext.fillStyle = "rgba(10, 12, 14, .82)";
  labelContext.beginPath();
  labelContext.arc(96, 96, 58, 0, Math.PI * 2);
  labelContext.fill();
  labelContext.strokeStyle = "rgba(255, 255, 255, .75)";
  labelContext.lineWidth = 5;
  labelContext.stroke();
  labelContext.fillStyle = "#ffffff";
  labelContext.font = "800 76px system-ui";
  labelContext.textAlign = "center";
  labelContext.textBaseline = "middle";
  labelContext.fillText(String(value), 96, 101);
  const texture = new THREE.CanvasTexture(label);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function faceCenters(geometry) {
  const readable = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = readable.getAttribute("position");
  const groups = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);
    const normal = edgeA.subVectors(b, a).cross(edgeB.subVectors(c, a)).normalize();
    const center = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const key = `${normal.x.toFixed(2)}:${normal.y.toFixed(2)}:${normal.z.toFixed(2)}`;
    const group = groups.get(key) || { center: new THREE.Vector3(), count: 0 };
    group.center.add(center);
    group.count += 1;
    groups.set(key, group);
  }
  if (readable !== geometry) readable.dispose();
  return [...groups.values()].map((group) => group.center.multiplyScalar(1 / group.count));
}

function disposeDie() {
  if (!die) return;
  die.traverse((child) => {
    child.geometry?.dispose?.();
    if (child.material?.map) child.material.map.dispose();
    child.material?.dispose?.();
  });
  scene.remove(die);
}

function setDie(sides) {
  disposeDie();
  die = new THREE.Group();
  const geometry = geometryFor(sides);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xc40f0f, metalness: .42, roughness: .3, flatShading: true }),
  );
  die.add(mesh);
  const labelScale = sides >= 20 ? .34 : sides >= 12 ? .39 : .46;
  faceCenters(geometry).slice(0, sides).forEach((center, index) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: numberedTexture(index + 1),
      transparent: true,
      depthTest: true,
      depthWrite: false,
    }));
    sprite.position.copy(center.multiplyScalar(1.045));
    sprite.scale.set(labelScale, labelScale, 1);
    die.add(sprite);
  });
  die.userData.sides = sides;
  die.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  scene.add(die);
}

function resize() {
  const width = Math.floor(canvas.clientWidth);
  const height = Math.floor(canvas.clientHeight);
  if (width < 2 || height < 2) return false;
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  return true;
}

function roll(sides) {
  clearTimeout(resultTimer);
  setDie(sides);
  velocity = 1.15 + Math.random() * .8;
  bounce = 1.55;
  document.querySelector("#dice-result").textContent = "Rolling…";
  faceResult.textContent = "…";
  resultTimer = window.setTimeout(() => {
    const result = Math.floor(Math.random() * sides) + 1;
    document.querySelector("#dice-result").textContent = `D${sides} · ${result}`;
    faceResult.textContent = result;
  }, 900);
}

function animate() {
  const visible = resize();
  if (die) {
    die.rotation.x += velocity * .07;
    die.rotation.y += velocity * .11;
    die.rotation.z += velocity * .04;
    velocity *= .975;
    bounce = Math.max(0, bounce - .04);
    die.position.y = -.05 + Math.abs(Math.sin(bounce * 5)) * bounce * .5;
  }
  if (visible) renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

document.querySelector(".dice-buttons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-die]");
  if (button) roll(Number(button.dataset.die));
});

setDie(20);
animate();
