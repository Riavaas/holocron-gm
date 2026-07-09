import * as THREE from "/static/vendor/three.module.min.js";

const canvas = document.querySelector("#dice-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 2, .1, 100);
camera.position.set(0, 1.5, 6);
scene.add(new THREE.HemisphereLight(0x9be8dc, 0x111820, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.4, 48),
  new THREE.MeshStandardMaterial({ color: 0x10171b, roughness: .85 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.25;
scene.add(ground);

let die;
let velocity = 0;
let bounce = 0;

function geometryFor(sides) {
  if (sides === 6) return new THREE.BoxGeometry(1.6, 1.6, 1.6);
  if (sides === 8) return new THREE.OctahedronGeometry(1.2);
  if (sides === 12) return new THREE.DodecahedronGeometry(1.2);
  return new THREE.IcosahedronGeometry(1.2);
}

function setDie(sides) {
  if (die) scene.remove(die);
  die = new THREE.Mesh(
    geometryFor(sides),
    new THREE.MeshStandardMaterial({ color: 0x35d0ba, metalness: .65, roughness: .22, flatShading: true }),
  );
  die.userData.sides = sides;
  die.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  scene.add(die);
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function roll(sides) {
  setDie(sides);
  velocity = 1.1 + Math.random() * .8;
  bounce = 1.8;
  document.querySelector("#dice-result").textContent = "Rolling…";
  window.setTimeout(() => {
    const result = Math.floor(Math.random() * sides) + 1;
    document.querySelector("#dice-result").textContent = `D${sides} · ${result}`;
  }, 900);
}

function animate() {
  resize();
  if (die) {
    die.rotation.x += velocity * .07;
    die.rotation.y += velocity * .11;
    die.rotation.z += velocity * .04;
    velocity *= .975;
    bounce = Math.max(0, bounce - .045);
    die.position.y = -0.05 + Math.abs(Math.sin(bounce * 5)) * bounce * .55;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

document.querySelector(".dice-buttons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-die]");
  if (button) roll(Number(button.dataset.die));
});

setDie(20);
animate();
