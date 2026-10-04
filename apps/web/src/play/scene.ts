import * as THREE from 'three';

export const ROOM_SPEC = {
  scale: 1,
  room: { width: 11, depth: 8, height: 2.6, wall: 0.14, floor: 0.12 },
  clearance: { wallGap: 0.03, walk: 0.9, doorSwing: 0.8, cribAccess: 0.65, cameraWall: 0.5, cameraFloor: 0.45, cameraCeiling: 0.65 },
  palette: {
    wall: 0xbdb4a8, floor: 0xc9c6c1, trim: 0x82796f, metal: 0x1a1a1a,
    oatmeal: 0xd6cbb9, cream: 0xe8e1d5, taupe: 0xa89a89, paleGray: 0xd0d0cd,
    wood: 0x877564, plant: 0x526c4d, pot: 0x9d8d7c, glass: 0xa8c5cb,
    light: 0xffd6a1, artA: 0xc88e73, artB: 0x839c94, artC: 0xd5bd91,
  },
  materials: { wallRoughness: 0.92, floorRoughness: 0.58, metalness: 0.8, metalRoughness: 0.42, fabricRoughness: 0.96 },
  floor: { plankWidth: 0.17, plankLength: 1.8, joint: 0.012 },
  door: { width: 0.9, height: 2.05 },
  window: { width: 1.6, height: 1.3, sill: 0.9, x: 0, z: -3.98 },
  play: { minX: -0.9, maxX: 5.2, minZ: -2.8, maxZ: 3.0 },
  furniture: {
    crib: { x: -4.0, z: 3.55, length: 1.4, width: 0.72, height: 0.95 },
    dogBed: { x: 4.55, z: 3.55, length: 1.0, width: 0.7, height: 0.16 },
    sofa: { x: -2.3, z: 0, width: 2.1, depth: 0.9, height: 0.85, seat: 0.45 },
    console: { x: -5.22, z: 0, width: 1.7, depth: 0.42, height: 0.5 },
    tv: { x: -5.39, z: 0, width: 1.38, height: 0.78, centerY: 1.18 },
    shelf: { x: -5.23, z: -1.9, width: 0.9, depth: 0.32, height: 1.75 },
    chandelier: { x: 2.0, z: 0, bottom: 2.22 },
    feeder: { x: 5.2, z: 3.15, radius: 0.13 },
    water: { x: 5.25, z: 3.55, radius: 0.16, height: 0.62 },
  },
} as const;

const P = ROOM_SPEC.palette;
const R = ROOM_SPEC.room;
const F = ROOM_SPEC.furniture;
const MAT = ROOM_SPEC.materials;
const FLOOR_TOP = 0;
const roomMaterial = (color: number, roughness: number = MAT.wallRoughness, metalness: number = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(scene: THREE.Scene, name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
}

function cylinder(scene: THREE.Scene, name: string, radius: number, height: number, position: [number, number, number], material: THREE.Material, segments = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
  mesh.name = name;
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
}

function plankTexture() {
  const pixelsPerMeter = 100;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(R.width * pixelsPerMeter);
  canvas.height = Math.ceil(R.depth * pixelsPerMeter);
  const ctx = canvas.getContext('2d')!;
  const plankPx = ROOM_SPEC.floor.plankWidth * pixelsPerMeter;
  const lengthPx = ROOM_SPEC.floor.plankLength * pixelsPerMeter;
  const gapPx = ROOM_SPEC.floor.joint * pixelsPerMeter;
  const colors = ['#c9c6c1', '#c5c3be', '#cecbc6', '#c7c5c0', '#cbc8c3'];
  for (let row = 0, y = 0; y < canvas.height; row++, y += plankPx) {
    const offset = row % 2 ? lengthPx * 0.48 : 0;
    for (let x = -offset, index = 0; x < canvas.width; x += lengthPx, index++) {
      ctx.fillStyle = colors[(row * 3 + index * 2) % colors.length];
      ctx.fillRect(x + gapPx / 2, y + gapPx / 2, lengthPx - gapPx, plankPx - gapPx);
      ctx.strokeStyle = 'rgba(104, 99, 92, 0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + gapPx / 2, y + gapPx / 2, lengthPx - gapPx, plankPx - gapPx);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(x + gapPx, y + plankPx * 0.28);
      ctx.lineTo(x + lengthPx - gapPx, y + plankPx * 0.28);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addWindow(scene: THREE.Scene) {
  const { width, height, sill, x, z } = ROOM_SPEC.window;
  const midY = sill + height / 2;
  const glass = new THREE.MeshBasicMaterial({ color: P.glass, transparent: true, opacity: 0.45 });
  const trim = roomMaterial(P.cream, 0.8);
  box(scene, 'window-glazing', [width, height, 0.035], [x, midY, z], glass);
  box(scene, 'window-sill', [width + 0.16, 0.06, 0.15], [x, sill, z + 0.12], trim);
  for (const side of [-1, 1]) box(scene, 'window-jamb', [0.055, height + 0.1, 0.09], [x + side * width / 2, midY, z + 0.1], trim);
  box(scene, 'window-head', [width + 0.1, 0.055, 0.09], [x, sill + height, z + 0.1], trim);
  box(scene, 'window-mullion', [0.035, height, 0.04], [x, midY, z + 0.12], trim);
  box(scene, 'window-crossbar', [width, 0.035, 0.04], [x, midY, z + 0.12], trim);
}

function addBaseboards(scene: THREE.Scene) {
  const trim = roomMaterial(P.trim, 0.8);
  box(scene, 'baseboard-back', [R.width, 0.12, 0.035], [0, 0.06, -R.depth / 2 + R.wall / 2 + 0.018], trim);
  box(scene, 'baseboard-left', [0.035, 0.12, R.depth], [-R.width / 2 + R.wall / 2 + 0.018, 0.06, 0], trim);
  box(scene, 'baseboard-right', [0.035, 0.12, R.depth], [R.width / 2 - R.wall / 2 - 0.018, 0.06, 0], trim);
  const doorLeft = -ROOM_SPEC.door.width / 2;
  const doorRight = ROOM_SPEC.door.width / 2;
  for (const x of [doorLeft, doorRight]) box(scene, 'door-casing', [0.06, ROOM_SPEC.door.height, 0.06], [x, ROOM_SPEC.door.height / 2, R.depth / 2 - R.wall / 2], trim);
  box(scene, 'door-head-casing', [ROOM_SPEC.door.width + 0.12, 0.06, 0.06], [0, ROOM_SPEC.door.height, R.depth / 2 - R.wall / 2], trim);
}

function addPlant(scene: THREE.Scene, x: number, z: number, scale = 1) {
  const potHeight = 0.28 * scale;
  const potRadius = 0.17 * scale;
  const foliage = roomMaterial(P.plant, 0.9);
  const pot = roomMaterial(P.pot, 0.82);
  cylinder(scene, 'plant-pot', potRadius, potHeight, [x, potHeight / 2, z], pot);
  for (const [dx, dy, dz, sx, sy, sz] of [
    [-0.2, 0.58, 0, 0.16, 0.43, 0.12], [0.17, 0.68, 0.04, 0.18, 0.49, 0.13],
    [-0.04, 0.89, -0.03, 0.17, 0.45, 0.12], [0.24, 0.53, -0.08, 0.14, 0.36, 0.11],
  ] as const) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), foliage);
    leaf.scale.set(sx * scale, sy * scale, sz * scale);
    leaf.position.set(x + dx * scale, dy * scale, z + dz * scale);
    leaf.name = 'plant-leaf';
    scene.add(leaf);
  }
}

function addArt(scene: THREE.Scene, x: number, width: number, height: number, color: number) {
  const z = -R.depth / 2 + R.wall / 2 + 0.025;
  const y = 1.52;
  const frame = roomMaterial(P.metal, 0.48, 0.55);
  box(scene, 'art-frame', [width, height, 0.045], [x, y, z], frame);
  box(scene, 'art-print', [width - 0.075, height - 0.075, 0.012], [x, y, z + 0.03], roomMaterial(color, 0.92));
}

function addTvZone(scene: THREE.Scene) {
  const console = F.console;
  const metal = roomMaterial(P.metal, MAT.metalRoughness, MAT.metalness);
  const wood = roomMaterial(P.wood, 0.7);
  const x = console.x;
  const z = console.z;
  box(scene, 'tv-console-top', [console.depth, 0.055, console.width], [x, console.height - 0.028, z], wood);
  box(scene, 'tv-console-carcass', [console.depth - 0.06, console.height - 0.12, console.width - 0.12], [x + 0.015, (console.height - 0.12) / 2, z], wood);
  for (const dz of [-console.width / 2 + 0.06, console.width / 2 - 0.06]) {
    for (const dx of [-console.depth / 2 + 0.05, console.depth / 2 - 0.05]) cylinder(scene, 'console-leg', 0.018, console.height - 0.02, [x + dx, (console.height - 0.02) / 2, z + dz], metal, 10);
  }
  const tv = F.tv;
  box(scene, 'television', [0.06, tv.height, tv.width], [tv.x, tv.centerY, tv.z], roomMaterial(0x101315, 0.3, 0.2));
  box(scene, 'television-screen', [0.012, tv.height - 0.06, tv.width - 0.06], [tv.x + 0.037, tv.centerY, tv.z], new THREE.MeshBasicMaterial({ color: 0x28383a }));
}

function addSideTableAndToys(scene: THREE.Scene) {
  const metal = roomMaterial(P.metal, MAT.metalRoughness, MAT.metalness);
  const wood = roomMaterial(P.wood, 0.74);
  const tableX = F.sofa.x;
  const tableZ = 1.52;
  box(scene, 'sofa-side-table-top', [0.42, 0.045, 0.42], [tableX, 0.53, tableZ], wood);
  for (const dx of [-0.16, 0.16]) for (const dz of [-0.16, 0.16]) cylinder(scene, 'side-table-leg', 0.012, 0.52, [tableX + dx, 0.26, tableZ + dz], metal, 8);
  box(scene, 'toy-basket', [0.58, 0.34, 0.42], [-4.65, 0.17, -0.55], roomMaterial(P.taupe, 0.88));
  const toy = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), roomMaterial(P.artA, 0.8));
  toy.position.set(-4.58, 0.43, -0.55);
  toy.name = 'toy-in-basket';
  scene.add(toy);
}

function addPetStation(scene: THREE.Scene) {
  const metal = roomMaterial(P.metal, 0.38, MAT.metalness);
  const feeder = F.feeder;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(feeder.radius, feeder.radius * 0.78, 0.09, 20, 1, true), metal);
  bowl.position.set(feeder.x, 0.045, feeder.z);
  bowl.name = 'metal-dog-feeder';
  scene.add(bowl);

  const water = F.water;
  cylinder(scene, 'water-dispenser-base', water.radius, 0.12, [water.x, 0.06, water.z], metal);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(water.radius * 0.58, water.radius * 0.7, water.height, 20), new THREE.MeshStandardMaterial({ color: P.glass, transparent: true, opacity: 0.6, roughness: 0.2, metalness: 0.1 }));
  bottle.position.set(water.x, 0.12 + water.height / 2, water.z);
  bottle.name = 'water-dispenser-bottle';
  scene.add(bottle);
}

function addSofa(scene: THREE.Scene) {
  const { x, z, width, depth, seat, height } = F.sofa;
  const fabric = roomMaterial(P.oatmeal, MAT.fabricRoughness);
  const cushion = roomMaterial(P.cream, MAT.fabricRoughness);
  const metal = roomMaterial(P.metal, MAT.metalRoughness, MAT.metalness);
  const legX = x;
  for (const dz of [-width / 2 + 0.13, width / 2 - 0.13]) {
    for (const dx of [-depth / 2 + 0.1, depth / 2 - 0.1]) cylinder(scene, 'sofa-leg', 0.025, seat, [legX + dx, seat / 2, z + dz], metal, 10);
  }
  box(scene, 'sofa-seat-base', [depth, 0.18, width], [x, seat - 0.09, z], fabric);
  box(scene, 'sofa-seat-cushion', [depth - 0.12, 0.14, width - 0.16], [x - 0.015, seat + 0.07, z], cushion);
  box(scene, 'sofa-back', [0.2, height - seat, width], [x + depth / 2 - 0.1, seat + (height - seat) / 2, z], fabric);
  for (const side of [-1, 1]) box(scene, 'sofa-arm', [depth, 0.46, 0.16], [x, seat + 0.23, z + side * (width / 2 - 0.08)], fabric);
  box(scene, 'sofa-throw', [0.42, 0.04, 0.62], [x - 0.06, seat + 0.17, z + width * 0.26], roomMaterial(P.paleGray, MAT.fabricRoughness));
  box(scene, 'sofa-pillow', [0.2, 0.32, 0.34], [x + 0.22, seat + 0.29, z - width * 0.28], cushion);
}

function addCrib(scene: THREE.Scene) {
  const { x, z, length, width, height } = F.crib;
  const metal = roomMaterial(P.metal, MAT.metalRoughness, MAT.metalness);
  const bedding = roomMaterial(P.cream, MAT.fabricRoughness);
  const railHeight = height - 0.45;
  box(scene, 'crib-mattress', [length - 0.12, 0.08, width - 0.12], [x, 0.45, z], bedding);
  for (const dx of [-length / 2 + 0.025, length / 2 - 0.025]) box(scene, 'crib-end-rail', [0.04, railHeight, width], [x + dx, 0.45 + railHeight / 2, z], metal);
  for (const dz of [-width / 2 + 0.025, width / 2 - 0.025]) {
    box(scene, 'crib-side-rail', [length, 0.045, 0.045], [x, height - 0.08, z + dz], metal);
    for (let i = 1; i < 9; i++) cylinder(scene, 'crib-spindle', 0.012, railHeight - 0.06, [x - length / 2 + length * i / 9, 0.45 + railHeight / 2, z + dz], metal, 8);
  }
  for (const dx of [-length / 2 + 0.07, length / 2 - 0.07]) for (const dz of [-width / 2 + 0.07, width / 2 - 0.07]) cylinder(scene, 'crib-post', 0.025, height, [x + dx, height / 2, z + dz], metal, 10);
}

function addDogBed(scene: THREE.Scene) {
  const { x, z, length, width, height } = F.dogBed;
  const fabric = roomMaterial(P.taupe, MAT.fabricRoughness);
  box(scene, 'dog-bed-base', [length, height, width], [x, height / 2, z], fabric);
  box(scene, 'dog-bed-cushion', [length - 0.12, 0.08, width - 0.12], [x, height + 0.035, z], roomMaterial(P.cream, MAT.fabricRoughness));
}

function addShelf(scene: THREE.Scene) {
  const { x, z, width, depth, height } = F.shelf;
  const metal = roomMaterial(P.metal, MAT.metalRoughness, MAT.metalness);
  const timber = roomMaterial(P.wood, 0.72);
  for (const dx of [-depth / 2 + 0.025, depth / 2 - 0.025]) {
    for (const dz of [-width / 2 + 0.025, width / 2 - 0.025]) box(scene, 'shelf-upright', [0.03, height, 0.03], [x + dx, height / 2, z + dz], metal);
  }
  for (let level = 0; level < 5; level++) {
    const y = 0.08 + level * (height - 0.14) / 4;
    box(scene, 'shelf-board', [depth, 0.035, width], [x, y, z], timber);
    if (level === 1) for (let book = 0; book < 3; book++) box(scene, 'shelf-book', [0.16, 0.2 + book * 0.015, 0.12], [x, y + 0.12, z - 0.23 + book * 0.15], roomMaterial([0x85786c, 0xb5a992, 0x777d78][book], 0.86));
  }
  addPlant(scene, x, z, 0.42);
}

function addChandelier(scene: THREE.Scene) {
  const { x, z, bottom } = F.chandelier;
  const metal = roomMaterial(P.metal, MAT.metalRoughness, MAT.metalness);
  const stemTop = R.height - 0.04;
  cylinder(scene, 'chandelier-canopy', 0.1, 0.035, [x, stemTop, z], metal);
  cylinder(scene, 'chandelier-stem', 0.014, stemTop - bottom, [x, (stemTop + bottom) / 2, z], metal, 12);
  const ringY = bottom + 0.12;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.018, 8, 28), metal);
  ring.position.set(x, ringY, z);
  ring.rotation.x = Math.PI / 2;
  ring.name = 'chandelier-ring';
  scene.add(ring);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    cylinder(scene, 'chandelier-arm', 0.012, 0.34, [x + Math.cos(angle) * 0.18, ringY, z + Math.sin(angle) * 0.18], metal, 10).rotation.z = Math.PI / 2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: P.light, emissive: P.light, emissiveIntensity: 0.8, roughness: 0.35 }));
    bulb.position.set(x + Math.cos(angle) * 0.37, ringY - 0.035, z + Math.sin(angle) * 0.37);
    bulb.name = 'chandelier-bulb';
    scene.add(bulb);
  }
  const light = new THREE.PointLight(P.light, 28, 12, 2);
  light.position.set(x, ringY - 0.08, z);
  light.name = 'warm-room-light';
  scene.add(light);
}

function addContactShadow(scene: THREE.Scene, x: number, z: number, width: number, depth: number) {
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x27231f, transparent: true, opacity: 0.08, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(x, 0.004, z);
  shadow.scale.set(width / 2, depth / 2, 1);
  shadow.name = 'soft-contact-shadow';
  scene.add(shadow);
}

export interface RoomCollider { minX: number; maxX: number; minZ: number; maxZ: number; }
export interface RoomScene { scene: THREE.Scene; colliders: RoomCollider[]; update(dt: number): void; dispose(): void; }

export function createRoomScene(_low = false): RoomScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe7e3dc);
  const floorMaterial = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: MAT.floorRoughness, metalness: 0 });
  box(scene, 'room-floor', [R.width, R.floor, R.depth], [0, -R.floor / 2, 0], floorMaterial);
  const wallMaterial = roomMaterial(P.wall, MAT.wallRoughness);
  // The ceiling remains part of the house shell, but does not occlude an interior orbit view.
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: P.wall, roughness: MAT.wallRoughness, side: THREE.BackSide });
  const window = ROOM_SPEC.window;
  const backSideWidth = (R.width - window.width) / 2;
  const upperWallHeight = R.height - window.sill - window.height;
  box(scene, 'back-wall-left', [backSideWidth, R.height, R.wall], [window.x - window.width / 2 - backSideWidth / 2, R.height / 2, -R.depth / 2], wallMaterial);
  box(scene, 'back-wall-right', [backSideWidth, R.height, R.wall], [window.x + window.width / 2 + backSideWidth / 2, R.height / 2, -R.depth / 2], wallMaterial);
  box(scene, 'back-wall-below-window', [window.width, window.sill, R.wall], [window.x, window.sill / 2, -R.depth / 2], wallMaterial);
  box(scene, 'back-wall-above-window', [window.width, upperWallHeight, R.wall], [window.x, window.sill + window.height + upperWallHeight / 2, -R.depth / 2], wallMaterial);
  box(scene, 'left-wall', [R.wall, R.height, R.depth], [-R.width / 2, R.height / 2, 0], wallMaterial);
  box(scene, 'right-wall', [R.wall, R.height, R.depth], [R.width / 2, R.height / 2, 0], wallMaterial);
  const sideWidth = (R.width - ROOM_SPEC.door.width) / 2;
  box(scene, 'entry-wall-left', [sideWidth, R.height, R.wall], [-(ROOM_SPEC.door.width + sideWidth) / 2, R.height / 2, R.depth / 2], wallMaterial);
  box(scene, 'entry-wall-right', [sideWidth, R.height, R.wall], [(ROOM_SPEC.door.width + sideWidth) / 2, R.height / 2, R.depth / 2], wallMaterial);
  box(scene, 'entry-wall-lintel', [ROOM_SPEC.door.width, R.height - ROOM_SPEC.door.height, R.wall], [0, ROOM_SPEC.door.height + (R.height - ROOM_SPEC.door.height) / 2, R.depth / 2], wallMaterial);
  box(scene, 'ceiling', [R.width, 0.08, R.depth], [0, R.height + 0.04, 0], ceilingMaterial);
  addBaseboards(scene);
  addWindow(scene);
  addArt(scene, -3.15, 0.72, 0.82, P.artA);
  addArt(scene, 3.05, 0.92, 0.7, P.artB);
  addArt(scene, 4.38, 0.42, 0.58, P.artC);

  addTvZone(scene);
  addSofa(scene);
  addSideTableAndToys(scene);
  addPetStation(scene);
  addCrib(scene);
  addDogBed(scene);
  addShelf(scene);
  addPlant(scene, -2.3, -3.32, 1.05);
  addPlant(scene, 2.55, -3.38, 0.82);
  addPlant(scene, 4.8, -3.28, 0.72);
  addChandelier(scene);
  addContactShadow(scene, F.sofa.x, F.sofa.z, 1.1, 2.3);
  addContactShadow(scene, F.crib.x, F.crib.z, 1.5, 0.82);
  addContactShadow(scene, F.dogBed.x, F.dogBed.z, 1.05, 0.76);
  const colliders: RoomCollider[] = [
    { minX: F.sofa.x - F.sofa.depth / 2 - .12, maxX: F.sofa.x + F.sofa.depth / 2 + .12, minZ: F.sofa.z - F.sofa.width / 2 - .12, maxZ: F.sofa.z + F.sofa.width / 2 + .12 },
    { minX: F.crib.x - F.crib.length / 2 - .1, maxX: F.crib.x + F.crib.length / 2 + .1, minZ: F.crib.z - F.crib.width / 2 - .1, maxZ: F.crib.z + F.crib.width / 2 + .1 },
    { minX: F.console.x - F.console.depth / 2 - .1, maxX: F.console.x + F.console.depth / 2 + .1, minZ: F.console.z - F.console.width / 2 - .1, maxZ: F.console.z + F.console.width / 2 + .1 },
    { minX: F.shelf.x - F.shelf.depth / 2 - .1, maxX: F.shelf.x + F.shelf.depth / 2 + .1, minZ: F.shelf.z - F.shelf.width / 2 - .1, maxZ: F.shelf.z + F.shelf.width / 2 + .1 },
    { minX: F.sofa.x - .33, maxX: F.sofa.x + .33, minZ: 1.18, maxZ: 1.86 },
    { minX: -2.58, maxX: -2.02, minZ: -3.58, maxZ: -3.05 },
    { minX: 2.28, maxX: 2.82, minZ: -3.58, maxZ: -3.05 },
    { minX: 4.58, maxX: 5.02, minZ: -3.5, maxZ: -3.06 },
  ];

  const hemisphere = new THREE.HemisphereLight(0xfff5e6, 0x625c52, 1.35);
  hemisphere.name = 'soft-ambient-fill';
  scene.add(hemisphere);
  const daylight = new THREE.DirectionalLight(0xffebd0, 1.5);
  daylight.position.set(1.5, 4.5, -2.5);
  daylight.name = 'window-daylight';
  scene.add(daylight);
  return {
    scene,
    colliders,
    update: (_dt: number) => {},
    dispose: () => scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else if (mesh.material) mesh.material.dispose();
    }),
  };
}

export function validateRoomLayout() {
  const { minX, maxX, minZ, maxZ } = ROOM_SPEC.play;
  const playArea = (maxX - minX) * (maxZ - minZ);
  const floorArea = R.width * R.depth;
  const furniture = [
    { name: 'sofa', minX: F.sofa.x - F.sofa.depth / 2, maxX: F.sofa.x + F.sofa.depth / 2, minZ: F.sofa.z - F.sofa.width / 2, maxZ: F.sofa.z + F.sofa.width / 2 },
    { name: 'crib', minX: F.crib.x - F.crib.length / 2, maxX: F.crib.x + F.crib.length / 2, minZ: F.crib.z - F.crib.width / 2, maxZ: F.crib.z + F.crib.width / 2 },
    { name: 'dog bed', minX: F.dogBed.x - F.dogBed.length / 2, maxX: F.dogBed.x + F.dogBed.length / 2, minZ: F.dogBed.z - F.dogBed.width / 2, maxZ: F.dogBed.z + F.dogBed.width / 2 },
    { name: 'shelf', minX: F.shelf.x - F.shelf.depth / 2, maxX: F.shelf.x + F.shelf.depth / 2, minZ: F.shelf.z - F.shelf.width / 2, maxZ: F.shelf.z + F.shelf.width / 2 },
    { name: 'TV console', minX: F.console.x - F.console.depth / 2, maxX: F.console.x + F.console.depth / 2, minZ: F.console.z - F.console.width / 2, maxZ: F.console.z + F.console.width / 2 },
    { name: 'side table', minX: F.sofa.x - .21, maxX: F.sofa.x + .21, minZ: 1.31, maxZ: 1.73 },
    { name: 'feeder', minX: F.feeder.x - F.feeder.radius, maxX: F.feeder.x + F.feeder.radius, minZ: F.feeder.z - F.feeder.radius, maxZ: F.feeder.z + F.feeder.radius },
    { name: 'water dispenser', minX: F.water.x - F.water.radius, maxX: F.water.x + F.water.radius, minZ: F.water.z - F.water.radius, maxZ: F.water.z + F.water.radius },
  ];
  const inside = (item: typeof furniture[number]) => item.minX >= -R.width / 2 && item.maxX <= R.width / 2 && item.minZ >= -R.depth / 2 && item.maxZ <= R.depth / 2;
  const outsidePlay = (item: typeof furniture[number]) => item.maxX <= minX || item.minX >= maxX || item.maxZ <= minZ || item.minZ >= maxZ;
  const overlaps = furniture.flatMap((item, index) => furniture.slice(index + 1).filter((other) => item.minX < other.maxX && item.maxX > other.minX && item.minZ < other.maxZ && item.maxZ > other.minZ).map((other) => [item.name, other.name] as const));
  return {
    playArea,
    playAreaRatio: playArea / floorArea,
    furnitureInsideRoom: furniture.every(inside),
    furnitureOutsidePlayZone: furniture.every(outsidePlay),
    noFurnitureOverlaps: overlaps.length === 0,
    overlaps,
    sofaToTvViewingDistance: Math.abs(F.sofa.x - F.sofa.depth / 2 - F.tv.x),
    chandelierBottom: F.chandelier.bottom,
    checks: furniture.map((item) => ({ name: item.name, insideRoom: inside(item), outsidePlayZone: outsidePlay(item) })),
  };
}
