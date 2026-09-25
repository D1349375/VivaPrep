import * as THREE from "/vendor/three.module.js";

const COLORS = {
  wall: 0xe9e1d5,
  wood: 0x78543c,
  woodLight: 0xb1835e,
  darkWood: 0x4a3328,
  metal: 0x474b49,
  glass: 0x9db8c4,
  paper: 0xece4d6,
  technical: { suit: 0x414b5b, shirt: 0xdce4e4, tie: 0x8a5145, skin: 0xd8a98c, hair: 0x302b2a },
  portfolio: { suit: 0x887a68, shirt: 0xf1e9dc, tie: 0x9e705f, skin: 0xe6b9a0, hair: 0x382c28 },
  logic: { suit: 0x344356, shirt: 0xdfe5ec, tie: 0x536f7f, skin: 0xd5a58a, hair: 0x7c7772 },
};

const standard = (color, roughness = 0.76, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(1, 24, 16);

function mesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], name = "") {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  item.scale.set(...scale);
  item.name = name;
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function block(parent, material, position, size, name = "") {
  return mesh(parent, boxGeo, material, position, size, name);
}

function orb(parent, material, position, size, name = "") {
  return mesh(parent, sphereGeo, material, position, size, name);
}

function link(parent, material, from, to, radius, radialSegments = 12) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius * 0.9, radius, direction.length(), radialSegments, 1);
  const item = new THREE.Mesh(geometry, material);
  item.position.copy(a).add(b).multiplyScalar(0.5);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function book(parent, x, y, z, height, hue) {
  const material = standard(hue, 0.9);
  const width = 0.13 + (height % 3) * 0.015;
  const item = block(parent, material, [x, y + height / 2, z], [width, height, 0.22]);
  item.rotation.z = ((height * 9) % 5 - 2) * 0.012;
  block(parent, standard(0xe1d2bd), [x, y + height * 0.76, z + 0.116], [width * 0.68, 0.018, 0.008]);
}

function addPlant(parent, x, y, z, scale = 1) {
  const pot = standard(0x9a6952), leaf = standard(0x6f8067, 0.85);
  const potMesh = mesh(parent, new THREE.CylinderGeometry(0.16 * scale, 0.12 * scale, 0.23 * scale, 16), pot, [x, y + 0.115 * scale, z]);
  potMesh.castShadow = true;
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7;
    const sprout = orb(parent, leaf, [x + Math.cos(angle) * 0.17 * scale, y + (0.40 + (i % 3) * 0.06) * scale, z + Math.sin(angle) * 0.08 * scale], [0.07 * scale, 0.22 * scale, 0.055 * scale]);
    sprout.rotation.z = Math.cos(angle) * 0.55;
    sprout.rotation.x = Math.sin(angle) * 0.5;
  }
  link(parent, standard(0x60745f), [x, y + 0.18 * scale, z], [x, y + 0.58 * scale, z], 0.018 * scale, 8);
}

function addBookcase(parent, x, z, colors) {
  const wood = standard(0x765239), shelf = standard(0x9b7250), back = standard(0x553c2d);
  const width = 2.85, height = 3.15;
  block(parent, back, [x, 2.52, z], [width, height, 0.4], "bookcase-back");
  block(parent, wood, [x - width / 2 + 0.08, 2.52, z + 0.25], [0.16, height, 0.42]);
  block(parent, wood, [x + width / 2 - 0.08, 2.52, z + 0.25], [0.16, height, 0.42]);
  for (const level of [1.12, 1.93, 2.74, 3.55]) {
    block(parent, shelf, [x, level, z + 0.25], [width, 0.12, 0.55]);
    let cursor = x - width / 2 + 0.2;
    let n = Math.round(12 + Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const h = 0.37 + Math.random() * 0.31;
      const w = 0.11 + Math.random() * 0.07;
      if (cursor + w > x + width / 2 - 0.17) break;
      book(parent, cursor + w / 2, level + 0.06, z + 0.04, h, colors[Math.floor(Math.random() * colors.length)]);
      cursor += w + 0.028;
    }
  }
  block(parent, wood, [x, 4.18, z + 0.23], [width + 0.12, 0.16, 0.58]);
}

function addRoom(scene) {
  const floor = standard(0xb8aa97, 0.92), wall = standard(COLORS.wall), trim = standard(0xd3c7b8), wood = standard(COLORS.wood), lightWood = standard(COLORS.woodLight);
  block(scene, floor, [0, -0.13, -0.5], [24, 0.25, 18], "room-floor");
  // A few broad floorboards add scale and keep the room from reading as a flat image.
  for (let i = -5; i <= 5; i++) {
    block(scene, standard(i % 2 ? 0xb4a48f : 0xc0b19d, 0.95), [i * 1.25, 0.005, 1.0], [1.22, 0.012, 7.0]);
  }
  block(scene, wall, [0, 3.08, -4.0], [22, 6.25, 0.25], "back-wall");
  block(scene, trim, [0, 0.28, -3.82], [22, 0.22, 0.12]);
  block(scene, trim, [0, 5.94, -3.82], [22, 0.14, 0.12]);
  // Tall left-side window, frames and daylight blue glass.
  const frame = standard(0x644834), glass = standard(COLORS.glass, 0.3, { metalness: 0.08, emissive: 0x26333a, emissiveIntensity: 0.12 });
  block(scene, frame, [-7.0, 3.75, -3.82], [3.65, 3.7, 0.22]);
  block(scene, glass, [-7.0, 3.75, -3.68], [3.34, 3.38, 0.06]);
  block(scene, frame, [-7.0, 3.75, -3.58], [0.075, 3.4, 0.12]);
  block(scene, frame, [-7.0, 3.75, -3.56], [3.42, 0.085, 0.12]);
  block(scene, frame, [-7.0, 3.75, -3.54], [0.09, 3.4, 0.14]);
  block(scene, frame, [-7.0, 2.80, -3.53], [3.4, 0.08, 0.14]);
  block(scene, frame, [-7.0, 4.70, -3.53], [3.4, 0.08, 0.14]);
  block(scene, lightWood, [-7.0, 1.87, -3.45], [3.85, 0.18, 0.55]);
  block(scene, standard(0xd9d0c2), [-7.0, 5.30, -3.78], [3.62, 0.12, 0.28]);

  const bookColors = [0x44595c, 0x8b4f40, 0x777a62, 0x34495e, 0xa2764a, 0x4b5a48, 0x6c4e63];
  addBookcase(scene, -3.45, -3.56, bookColors);
  addBookcase(scene, 3.90, -3.56, bookColors);
  addPlant(scene, -5.85, 1.2, -3.35, 1.2);
  addPlant(scene, 6.0, 1.25, -3.35, 0.95);

  // A daylight window gives the centered seats a lived-in office backdrop.
  const windowFrame = standard(0x674b37), windowGlass = standard(0x9db8c4, 0.32, { emissive: 0x435865, emissiveIntensity: 0.24 });
  block(scene, windowFrame, [-1.58, 4.0, -3.78], [2.22, 2.55, 0.14]);
  block(scene, windowGlass, [-1.58, 4.0, -3.69], [1.96, 2.29, 0.05]);
  block(scene, windowFrame, [-1.58, 4.0, -3.63], [0.075, 2.33, 0.10]);
  block(scene, windowFrame, [-1.58, 4.0, -3.62], [2.02, 0.075, 0.10]);
  block(scene, windowFrame, [-1.58, 3.35, -3.61], [2.02, 0.075, 0.10]);
  block(scene, lightWood, [-1.58, 2.69, -3.42], [2.42, 0.16, 0.48]);

  // Framed academic landscape on the wall.
  block(scene, standard(0x604638), [2.45, 4.53, -3.78], [1.38, 1.48, 0.15]);
  block(scene, standard(0xe7dfd1), [2.45, 4.53, -3.67], [1.19, 1.29, 0.05]);
  block(scene, standard(0x9aac9b), [2.45, 4.39, -3.62], [1.02, 0.77, 0.035]);
  const arch = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.78, 4), standard(0x98816a));
  arch.position.set(2.44, 4.69, -3.58); arch.scale.set(0.82, 0.82, 0.82); arch.rotation.y = Math.PI / 4; scene.add(arch);

  // Long meeting table; the apron and front lip occlude seated lower bodies.
  const top = standard(0x79523a, 0.43), apron = standard(0x694833), leg = standard(0x583d2d);
  block(scene, top, [0, 1.40, 0.40], [12.1, 0.18, 2.05], "meeting-table-top");
  block(scene, apron, [0, 1.10, 1.29], [11.85, 0.43, 0.16], "table-apron");
  for (const x of [-5.3, 5.3]) block(scene, leg, [x, 0.61, 0.40], [0.24, 1.05, 1.55], "table-leg");
  block(scene, lightWood, [0, 1.495, -0.15], [11.9, 0.025, 0.03]);
  // Small paper folders rest on top, in front of each seat.
  for (const x of [-3.0, 0, 3.0]) {
    block(scene, standard(COLORS.paper), [x, 1.505, 0.05], [0.72, 0.025, 0.52], "interviewer-notes");
    block(scene, standard(0xd0c8bb), [x, 1.522, 0.05], [0.48, 0.006, 0.012]);
    block(scene, standard(0xb6a895), [x, 1.522, 0.12], [0.54, 0.006, 0.01]);
  }
}

function addChair(scene, x) {
  const upholstery = standard(0x343c42, 0.9), frame = standard(0x504c46, 0.52, { metalness: 0.18 });
  block(scene, upholstery, [x, 1.92, -0.92], [0.96, 1.52, 0.19], "interviewer-chair-back");
  block(scene, upholstery, [x, 1.24, -0.62], [0.94, 0.19, 0.90], "interviewer-chair-seat");
  block(scene, frame, [x - 0.49, 1.58, -0.55], [0.075, 0.82, 0.72]);
  block(scene, frame, [x + 0.49, 1.58, -0.55], [0.075, 0.82, 0.72]);
  block(scene, frame, [x, 0.95, -0.62], [0.08, 0.56, 0.10]);
  block(scene, frame, [x, 0.68, -0.62], [0.68, 0.07, 0.68]);
}

function makeGlasses(parent, color = 0x363b3b) {
  const metal = standard(color, 0.38, { metalness: 0.4 });
  const ring = new THREE.TorusGeometry(0.105, 0.012, 8, 28);
  for (const x of [-0.12, 0.12]) {
    const lens = new THREE.Mesh(ring, metal);
    lens.position.set(x, 0.065, 0.272);
    parent.add(lens);
  }
  block(parent, metal, [0, 0.067, 0.273], [0.055, 0.018, 0.018]);
  for (const s of [-1, 1]) block(parent, metal, [s * 0.25, 0.065, 0.235], [0.09, 0.016, 0.016]).rotation.y = s * 0.25;
}

function addHead(parent, id, palette) {
  const skin = standard(palette.skin), hair = standard(palette.hair), white = standard(0xf5f3ed, 0.5), iris = standard(id === "portfolio" ? 0x614b41 : 0x433c36, 0.34), brow = standard(id === "logic" ? 0x625e5b : 0x49372f);
  const head = new THREE.Group();
  head.position.set(0, 2.52, 0.02);
  parent.add(head);
  orb(head, skin, [0, 0, 0], [0.31, 0.38, 0.285], "face");
  orb(head, skin, [-0.313, -0.005, 0.005], [0.068, 0.095, 0.05], "ear");
  orb(head, skin, [0.313, -0.005, 0.005], [0.068, 0.095, 0.05], "ear");
  for (const x of [-0.12, 0.12]) {
    orb(head, white, [x, 0.062, 0.244], [0.063, 0.046, 0.035], "eye-white");
    orb(head, iris, [x, 0.058, 0.276], [0.023, 0.03, 0.012], "eye");
    orb(head, standard(0x201f1d, 0.2), [x, 0.058, 0.285], [0.011, 0.016, 0.007]);
    block(head, brow, [x, 0.142, 0.25], [0.13, 0.024, 0.026]).rotation.z = x > 0 ? 0.08 : -0.08;
  }
  orb(head, skin, [0, -0.005, 0.285], [0.052, 0.11, 0.066], "nose");
  block(head, standard(0x985f57, 0.65), [0, -0.185, 0.262], [0.112, 0.018, 0.024], "mouth");
  // Hair cap plus temples create a readable silhouette without a flat portrait texture.
  orb(head, hair, [0, 0.20, -0.024], [0.325, 0.235, 0.298], "hair-cap");
  if (id === "portfolio") {
    orb(head, hair, [-0.275, -0.04, -0.008], [0.115, 0.34, 0.28], "bob-left");
    orb(head, hair, [0.275, -0.035, -0.008], [0.115, 0.35, 0.28], "bob-right");
    orb(head, hair, [-0.16, 0.25, 0.18], [0.19, 0.12, 0.14], "fringe").rotation.z = -0.17;
  } else {
    orb(head, hair, [-0.28, 0.02, -0.02], [0.09, 0.24, 0.25], "temple-left");
    orb(head, hair, [0.28, 0.025, -0.02], [0.09, 0.25, 0.25], "temple-right");
    orb(head, hair, [0.12, 0.21, 0.17], [0.22, 0.115, 0.13], "parted-fringe").rotation.z = 0.15;
  }
  if (id !== "portfolio") makeGlasses(head, id === "technical" ? 0x313a40 : 0x44423f);
  return head;
}

function makeArm(actorRoot, side, palette, id) {
  const suit = standard(palette.suit), sleeve = standard(palette.suit), shirt = standard(palette.shirt), skin = standard(palette.skin);
  const shoulder = new THREE.Group();
  shoulder.position.set(side * 0.36, 2.00, 0.0);
  actorRoot.add(shoulder);
  orb(shoulder, suit, [side * 0.035, -0.055, 0], [0.21, 0.23, 0.22], "shoulder");
  link(shoulder, sleeve, [0, -0.05, 0], [side * 0.055, -0.37, 0.06], 0.105);
  const cuff = block(shoulder, shirt, [side * 0.05, -0.365, 0.065], [0.18, 0.09, 0.18], "cuff");
  cuff.rotation.z = side * -0.10;
  const forearm = new THREE.Group();
  forearm.position.set(side * 0.055, -0.37, 0.06);
  shoulder.add(forearm);
  link(forearm, sleeve, [0, 0, 0], [side * -0.025, -0.10, 0.42], 0.082);
  orb(forearm, skin, [side * -0.025, -0.105, 0.45], [0.11, 0.07, 0.15], "hand");
  for (let i = 0; i < 3; i++) {
    const finger = orb(forearm, skin, [side * -0.08 + i * 0.045, -0.13, 0.545], [0.024, 0.024, 0.085], "finger");
    finger.rotation.x = -0.16;
  }
  if (id === "technical" && side === 1) {
    const pen = block(forearm, standard(0x584c45, 0.32), [0.0, -0.07, 0.48], [0.025, 0.025, 0.22], "pen");
    pen.rotation.x = -0.42;
  }
  return { shoulder, forearm };
}

function makeInterviewer(scene, id) {
  const palette = COLORS[id];
  const root = new THREE.Group();
  root.name = `${id}-interviewer-object`;
  scene.add(root);
  const suit = standard(palette.suit), shirt = standard(palette.shirt), tie = standard(palette.tie), skin = standard(palette.skin), dark = standard(0x262b2e);
  // Seated jacket and shoulders; the shared table apron hides the waist consistently.
  const torso = mesh(root, new THREE.CylinderGeometry(0.30, 0.39, 0.92, 12, 1), suit, [0, 1.68, -0.04], [1, 1, 0.62], "jacket-torso");
  torso.rotation.z = Math.PI;
  orb(root, suit, [-0.32, 2.00, -0.015], [0.22, 0.22, 0.23], "left-shoulder");
  orb(root, suit, [0.32, 2.00, -0.015], [0.22, 0.22, 0.23], "right-shoulder");
  // Shirt bib and two lapels on the camera-facing side.
  block(root, shirt, [0, 1.82, 0.204], [0.28, 0.61, 0.045], "shirt-front");
  const lapelGeo = new THREE.BufferGeometry();
  lapelGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.31,2.09,0.23, -0.025,2.00,0.244, -0.12,1.65,0.25, 0.31,2.09,0.23, 0.025,2.00,0.244, 0.12,1.65,0.25], 3));
  lapelGeo.setIndex([0,1,2,3,5,4]); lapelGeo.computeVertexNormals();
  mesh(root, lapelGeo, standard(id === "portfolio" ? 0x9a8b79 : id === "technical" ? 0x586372 : 0x46566b), [0,0,0], [1,1,1], "jacket-lapels");
  block(root, tie, [0, 1.80, 0.246], [0.095, 0.37, 0.04], "tie");
  const knot = mesh(root, new THREE.CylinderGeometry(0.055, 0.07, 0.09, 5), tie, [0, 2.005, 0.252], [1,1,0.6], "tie-knot"); knot.rotation.z = Math.PI;
  link(root, skin, [0, 2.14, 0.0], [0, 2.33, 0.02], 0.11, 16);
  const head = addHead(root, id, palette);
  const arms = { left: makeArm(root, -1, palette, id), right: makeArm(root, 1, palette, id) };
  // Legs and shoes are present as actual seated geometry; the tabletop naturally occludes them.
  const pants = standard(id === "portfolio" ? 0x62594f : 0x343b44);
  for (const side of [-1, 1]) {
    const thigh = block(root, pants, [side * 0.20, 1.05, 0.20], [0.31, 0.28, 0.78], "seated-leg");
    thigh.rotation.x = -0.12;
    orb(root, dark, [side * 0.20, 0.90, 0.57], [0.16, 0.10, 0.30], "shoe");
  }
  if (id === "portfolio") {
    // A modest scarf detail marks the portfolio interviewer.
    orb(root, standard(0xb58670), [0, 2.04, 0.24], [0.13, 0.09, 0.055], "scarf-detail");
  }
  root.userData = { id, head, arms, torso, state: "listening", phase: id === "technical" ? 0 : id === "portfolio" ? 2.2 : 4.1 };
  return root;
}

export class InterviewScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe5ddd0);
    this.scene.fog = new THREE.Fog(0xe5ddd0, 13, 28);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 70);
    this.camera.position.set(0, 2.55, 10.3);
    this.camera.lookAt(0, 2.08, -0.25);
    this.renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "room-scene-canvas";
    this.renderer.domElement.setAttribute("aria-label", "3D 面試室與可替換面試官角色");
    this.renderer.domElement.setAttribute("role", "img");
    this.active = false;
    this.actors = new Map();
    this.resizeObserver = null;
    this.lastFrame = 0;
    this.mounted = false;
    this.onVisibilityChange = () => {
      if (document.visibilityState === "visible" && this.active && !this.frameId) this.frameId = requestAnimationFrame(this.animate);
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.scene.add(new THREE.HemisphereLight(0xfff5e8, 0x627078, 2.1));
    const key = new THREE.DirectionalLight(0xffe2bf, 2.6);
    key.position.set(-4.8, 7.0, 5.4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.00018;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd7e8f0, 1.15); fill.position.set(5, 4.5, 2.0); this.scene.add(fill);
    const windowLight = new THREE.PointLight(0xf8e3c6, 72, 17, 2); windowLight.position.set(-6.6, 4.0, -1.8); this.scene.add(windowLight);

    addRoom(this.scene);
    this.characters = new Map();
    this.chairs = new Map();
    for (const [idx, id] of ["technical", "portfolio", "logic"].entries()) {
      const x = [-2.9, 0, 2.9][idx];
      const chair = new THREE.Group();
      chair.name = `${id}-chair-object`;
      this.scene.add(chair);
      addChair(chair, 0);
      chair.position.x = x;
      this.chairs.set(id, chair);
      this.characters.set(id, makeInterviewer(this.scene, id));
      this.characters.get(id).position.x = x;
    }
    this.updateActors([], "portfolio", "listening");
    this.animate = this.animate.bind(this);
  }

  mount(container, roster, speakerId, speakerState = "speaking", otherStates = {}) {
    if (!container) return;
    if (!this.mounted) {
      this.renderer.domElement.style.opacity = "0";
      container.appendChild(this.renderer.domElement);
      requestAnimationFrame(() => { this.renderer.domElement.style.opacity = "1"; });
      this.mounted = true;
    } else if (this.renderer.domElement.parentElement !== container) {
      container.appendChild(this.renderer.domElement);
    }
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.updateActors(roster, speakerId, speakerState, otherStates);
    this.active = true;
    if (!this.frameId) this.frameId = requestAnimationFrame(this.animate);
  }

  setActive(value) {
    this.active = value;
    if (value && !this.frameId) this.frameId = requestAnimationFrame(this.animate);
  }

  resize() {
    if (!this.mounted) return;
    const width = this.renderer.domElement.parentElement?.clientWidth || window.innerWidth;
    const height = this.renderer.domElement.parentElement?.clientHeight || window.innerHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < 600 ? 33 : 30;
    this.camera.position.z = width < 600 ? 10.6 : 10.3;
    this.camera.updateProjectionMatrix();
    this.positionActors();
    this.renderer.render(this.scene, this.camera);
  }

  positionActors() {
    const actors = [...this.actors.values()];
    const visibleHalfWidth = this.camera.position.z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const spread = Math.min(2.9, visibleHalfWidth * 0.52);
    const seats = actors.length === 1 ? [0] : actors.length === 2 ? [-spread * 0.62, spread * 0.62] : [-spread, 0, spread];
    actors.forEach((person, idx) => {
      person.position.x = seats[idx] ?? 0;
      const chair = this.chairs.get(person.userData.id);
      if (chair) chair.position.x = seats[idx] ?? 0;
    });
  }

  updateActors(roster, speakerId, speakerState = "speaking", otherStates = {}) {
    const list = Array.isArray(roster) ? roster : [];
    this.actors.clear();
    for (const [id, actor] of this.characters) {
      const idx = list.findIndex((person) => person.id === id);
      actor.visible = idx >= 0;
      const chair = this.chairs.get(id);
      if (chair) chair.visible = idx >= 0;
      if (idx < 0) continue;
      actor.userData.state = id === speakerId ? speakerState : (otherStates[id] || "listening");
      this.actors.set(id, actor);
    }
    this.positionActors();
  }

  animate(timestamp) {
    if (!this.active) { this.frameId = 0; return; }
    if (document.visibilityState === "hidden") { this.frameId = 0; return; }
    if (timestamp - this.lastFrame < 1000 / 30) { this.frameId = requestAnimationFrame(this.animate); return; }
    this.lastFrame = timestamp;
    const time = timestamp / 1000;
    for (const actor of this.actors.values()) {
      const { id, head, arms, torso, state, phase } = actor.userData;
      const t = time + phase;
      const speaking = state === "speaking" || state === "follow_up";
      const thinking = state === "considering" || state === "reading_notes";
      const breath = Math.sin(t * 1.65) * 0.012;
      torso.scale.y = 1 + breath;
      const targetHeadX = state === "reading_notes" ? 0.20 : speaking ? Math.sin(t * 2.25) * 0.055 : thinking ? 0.10 : Math.sin(t * 0.82) * 0.025;
      const targetHeadZ = state === "considering" ? (id === "logic" ? -0.13 : 0.07) : Math.sin(t * 0.61) * 0.02;
      head.rotation.x = THREE.MathUtils.damp(head.rotation.x, targetHeadX, 3.6, 1 / 60);
      head.rotation.z = THREE.MathUtils.damp(head.rotation.z, targetHeadZ, 3.0, 1 / 60);
      const gesture = speaking ? Math.sin(t * (id === "portfolio" ? 1.7 : 2.6)) : 0;
      let raise = speaking ? (id === "logic" ? -0.36 : -0.23) + gesture * 0.14 : thinking && id === "logic" ? -0.2 : -0.045;
      let open = id === "technical" ? -0.12 : id === "portfolio" ? -0.05 : 0.13;
      if (state === "follow_up") { raise -= 0.18; open += 0.12; }
      for (const side of [-1, 1]) {
        const targetX = side === 1 ? raise : (speaking && id === "portfolio" ? -0.11 + gesture * 0.045 : 0.015);
        const targetZ = side === 1 ? open : -open * 0.5;
        const arm = arms[side === 1 ? "right" : "left"];
        arm.shoulder.rotation.x = THREE.MathUtils.damp(arm.shoulder.rotation.x, targetX, 3.2, 1 / 60);
        arm.shoulder.rotation.z = THREE.MathUtils.damp(arm.shoulder.rotation.z, targetZ, 3.2, 1 / 60);
        arm.forearm.rotation.x = THREE.MathUtils.damp(arm.forearm.rotation.x, speaking ? -0.10 + gesture * 0.07 : 0, 3.0, 1 / 60);
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.animate);
  }
}
