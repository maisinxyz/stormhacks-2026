// The Play room: a low-poly, toon-shaded dog playroom seen in first person.
// The shell (11 x 8 m) and the dog's walkable area (engine: +-4.75 x +-3.45) are fixed; everything else is scenery
// built from a handful of flat-shaded primitives. Pets are drawn by the engine and are not part of this scene.
import * as THREE from 'three';

export const ROOM_SPEC = {
  room: { width: 11, depth: 8, height: 2.6, wall: 0.14 },
  door: { width: 0.9, height: 2.05 },
  window: { width: 2.2, height: 1.3, sill: 0.75 },
  /** Where the player stands when the room opens (just inside the door, looking at the window). */
  start: { x: 0, z: 2.9 },
  bed: { x: 3.9, z: -2.7 },
  bowl: { x: 4.95, z: 1.0 },
  chest: { x: -4.85, z: -1.3 },
  rug: { x: 0.4, z: -0.4, radius: 1.5 },
  sofa: { x: -4.85, z: 1.6, depth: 0.9, width: 2.0 },
  shelf: { x: -3.3, z: -3.72, width: 1.2, depth: 0.36, height: 1.5 },
  /** Agility hoop: the dog runs along x through it. */
  hoop: { x: -1.9, z: -1.7, y: 0.56, radius: 0.42 },
  /** Dog tunnel lying along x. */
  tunnel: { x: 2.4, z: 2.05, length: 1.8, radius: 0.42 },
} as const;

const PAL = {
  wall: 0xffe9a8, trim: 0xfff8ec, ceiling: 0xfff6e0, floorA: '#bfe8d2', floorB: '#ffd9bf',
  tomato: 0xf2664f, blush: 0xffb199, wood: 0xe0a96d, darkWood: 0xb9773f, teal: 0x5ec4b6, sun: 0xffd35c,
  coral: 0xff9e80, cream: 0xfff3dc, sky: 0x7ccfe0, leaf: 0x6cc06a, darkLeaf: 0x3f9a5b, pink: 0xff8fa3,
  red: 0xff5d5d, white: 0xffffff, blue: 0x58b4f0, deepBlue: 0x3c8ad9, purple: 0x9b7be0, glass: 0xcdefff,
  water: 0x66c7f4, bone: 0xfff1d6, ink: 0x4a3b3b,
};
const R = ROOM_SPEC.room, S = ROOM_SPEC;

export interface RoomCollider { minX: number; maxX: number; minZ: number; maxZ: number; }
export interface RoomScene {
  scene: THREE.Scene;
  /** Things the dog and the player both walk around. */
  colliders: RoomCollider[];
  /** Extra obstacles for the player only (the dog walks under or through these). */
  playerColliders: RoomCollider[];
  update(dt: number): void;
  dispose(): void;
}

/** Three flat light bands: the cartoon look. */
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 212, 212, 212, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas'), n = 2;
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? PAL.floorA : PAL.floorB; g.fillRect(x, y, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(R.width / 2, R.depth / 2); // 1 m tiles
  return t;
}

export function createRoomScene(_low = false): RoomScene {
  const scene = new THREE.Scene(), ramp = toonRamp(), mats = new Map<number, THREE.MeshToonMaterial>();
  const toon = (color: number) => { let m = mats.get(color); if (!m) mats.set(color, m = new THREE.MeshToonMaterial({ color, gradientMap: ramp })); return m; };
  /** Faceted: every face gets its own normal. */
  const flat = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  type V3 = [number, number, number];
  const put = (geo: THREE.BufferGeometry, color: number | THREE.Material, pos: V3, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geo, typeof color === 'number' ? toon(color) : color);
    m.position.set(...pos); parent.add(m);
    return m;
  };
  const box = (size: V3, color: number | THREE.Material, pos: V3, parent?: THREE.Object3D) => put(new THREE.BoxGeometry(...size), color, pos, parent);
  const cyl = (rTop: number, rBottom: number, h: number, color: number | THREE.Material, pos: V3, sides = 7, parent?: THREE.Object3D) => put(flat(new THREE.CylinderGeometry(rTop, rBottom, h, sides)), color, pos, parent);
  const blob = (r: number, color: number | THREE.Material, pos: V3, scale: V3 = [1, 1, 1], parent?: THREE.Object3D) => { const m = put(flat(new THREE.IcosahedronGeometry(r, 0)), color, pos, parent); m.scale.set(...scale); return m; };
  const shadow = (x: number, z: number, w: number, d: number) => {
    const m = put(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0x8a5a3c, transparent: true, opacity: 0.16, depthWrite: false }), [x, 0.004, z]);
    m.rotation.x = -Math.PI / 2; m.scale.set(w / 2, d / 2, 1);
  };
  const colliders: RoomCollider[] = [], playerColliders: RoomCollider[] = [];
  const solid = (x: number, z: number, w: number, d: number, list = colliders) => list.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // ---------- shell ----------
  const floor = put(new THREE.PlaneGeometry(R.width, R.depth), new THREE.MeshToonMaterial({ map: checkerTexture(), gradientMap: ramp }), [0, 0, 0]);
  floor.rotation.x = -Math.PI / 2;
  box([R.width, 0.08, R.depth], new THREE.MeshBasicMaterial({ color: PAL.ceiling }), [0, R.height + 0.04, 0]);
  const W = S.window, sideW = (R.width - W.width) / 2, topH = R.height - W.sill - W.height, zb = -R.depth / 2, zf = R.depth / 2;
  for (const s of [-1, 1]) box([sideW, R.height, R.wall], PAL.wall, [s * (W.width / 2 + sideW / 2), R.height / 2, zb]);
  box([W.width, W.sill, R.wall], PAL.wall, [0, W.sill / 2, zb]);
  box([W.width, topH, R.wall], PAL.wall, [0, W.sill + W.height + topH / 2, zb]);
  for (const s of [-1, 1]) box([R.wall, R.height, R.depth], PAL.wall, [s * R.width / 2, R.height / 2, 0]);
  const D = S.door, doorSide = (R.width - D.width) / 2;
  for (const s of [-1, 1]) box([doorSide, R.height, R.wall], PAL.wall, [s * (D.width + doorSide) / 2, R.height / 2, zf]);
  box([D.width, R.height - D.height, R.wall], PAL.wall, [0, D.height + (R.height - D.height) / 2, zf]);
  // chunky baseboards
  box([R.width, 0.16, 0.05], PAL.trim, [0, 0.08, zb + 0.09]); box([R.width, 0.16, 0.05], PAL.trim, [0, 0.08, zf - 0.09]);
  for (const s of [-1, 1]) box([0.05, 0.16, R.depth], PAL.trim, [s * (R.width / 2 - 0.09), 0.08, 0]);
  // door and doormat
  box([D.width, D.height, 0.06], PAL.teal, [0, D.height / 2, zf - 0.04]);
  blob(0.05, PAL.sun, [0.3, 1.0, zf - 0.1]);
  box([0.9, 0.02, 0.5], PAL.coral, [0, 0.01, zf - 0.45]);

  // ---------- window: frame, a little outdoors, and the patch of sun it throws on the floor ----------
  const midY = W.sill + W.height / 2;
  box([W.width + 0.2, 0.08, 0.24], PAL.trim, [0, W.sill, zb + 0.1]);
  box([W.width + 0.16, 0.09, 0.12], PAL.trim, [0, W.sill + W.height, zb + 0.06]);
  for (const s of [-1, 1]) box([0.09, W.height, 0.12], PAL.trim, [s * W.width / 2, midY, zb + 0.06]);
  box([0.06, W.height, 0.06], PAL.trim, [0, midY, zb + 0.04]); box([W.width, 0.06, 0.06], PAL.trim, [0, midY, zb + 0.04]);
  const basic = (color: number) => new THREE.MeshBasicMaterial({ color });
  put(new THREE.PlaneGeometry(8, 5), basic(0x9edcff), [0, 1.6, zb - 1.2]);
  put(new THREE.CircleGeometry(0.34, 10), basic(0xfff2a8), [0.75, 1.75, zb - 1.1]);
  for (const [x, r, c] of [[-1.5, 1.3, 0x8fd694], [0.6, 1.6, 0x7ccf8a], [2.4, 1.1, 0x9be0a0]] as const) put(new THREE.CircleGeometry(r, 9), basic(c), [x, -0.15, zb - 1.0]);
  const sunPatch = put(new THREE.PlaneGeometry(W.width, 1.7), new THREE.MeshBasicMaterial({ color: 0xfff6b8, transparent: true, opacity: 0.32, depthWrite: false }), [0.25, 0.006, zb + 1.55]);
  sunPatch.rotation.x = -Math.PI / 2;

  // ---------- bunting along the back wall ----------
  const flags = [PAL.tomato, PAL.sun, PAL.teal, PAL.pink, PAL.blue, PAL.purple];
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.11, 0, 0, 0.11, 0, 0, 0, -0.24, 0]), 3)); tri.computeVertexNormals();
  for (let i = 0; i < 26; i++) {
    const u = i / 25, x = -5 + u * 10, sag = Math.sin(u * Math.PI * 3) ** 2 * 0.16;
    put(tri, toon(flags[i % flags.length]), [x, 2.42 - sag, zb + 0.09]).rotation.z = Math.cos(u * Math.PI * 3) * 0.25;
  }
  // pictures
  const picture = (x: number, y: number, w: number, h: number, bg: number, draw: (g: THREE.Group) => void) => {
    const g = new THREE.Group(); g.position.set(x, y, zb + 0.08); g.rotation.z = (x % 2) * 0.04; scene.add(g);
    box([w, h, 0.04], PAL.white, [0, 0, 0], g); box([w - 0.1, h - 0.1, 0.02], bg, [0, 0, 0.02], g);
    draw(g);
  };
  picture(-2.2, 1.55, 0.7, 0.6, 0x2f3b6b, g => { put(new THREE.CircleGeometry(0.15, 9), basic(0xfff2a8), [0.05, 0.03, 0.035], g); put(new THREE.CircleGeometry(0.13, 9), basic(0x2f3b6b), [0.12, 0.07, 0.036], g); }); // moon
  picture(2.3, 1.6, 0.8, 0.55, PAL.sky, g => { const f = put(new THREE.CircleGeometry(0.14, 8), basic(PAL.tomato), [-0.03, 0, 0.035], g); f.scale.set(1.5, 1, 1); put(tri, basic(PAL.tomato), [0.22, 0.11, 0.035], g).rotation.z = -Math.PI / 2; }); // fish
  picture(3.6, 1.45, 0.45, 0.5, PAL.pink, g => { for (const s of [-1, 1]) put(new THREE.CircleGeometry(0.06, 7), basic(PAL.bone), [s * 0.09, 0, 0.035], g); put(new THREE.PlaneGeometry(0.18, 0.06), basic(PAL.bone), [0, 0, 0.035], g); }); // bone

  // ---------- paper lantern ----------
  cyl(0.008, 0.008, 0.36, PAL.ink, [0, R.height - 0.18, 0], 4);
  blob(0.3, new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), [0, R.height - 0.6, 0], [1, 0.85, 1]);

  // ---------- round rug (the dog's play spot) ----------
  const rug = (r: number, color: number, y: number) => { const m = put(new THREE.CircleGeometry(r, 12), toon(color), [S.rug.x, y, S.rug.z]); m.rotation.x = -Math.PI / 2; };
  rug(S.rug.radius, PAL.coral, 0.008); rug(S.rug.radius * 0.72, PAL.cream, 0.011); rug(S.rug.radius * 0.42, PAL.sky, 0.014);

  // ---------- tent bed (sleep) ----------
  {
    const g = new THREE.Group(); g.position.set(S.bed.x, 0, S.bed.z); scene.add(g);
    for (const s of [-1, 1]) box([1.4, 0.04, 1.2], s > 0 ? PAL.teal : PAL.sun, [0, 0.505, s * 0.325], g).rotation.x = s;
    for (const x of [-0.72, 0.72]) for (const s of [-1, 1]) cyl(0.022, 0.022, 1.3, PAL.wood, [x, 0.56, s * 0.3], 5, g).rotation.x = s * 0.5;
    cyl(0.5, 0.56, 0.12, PAL.blush, [0, 0.06, 0], 8, g).scale.set(1.15, 1, 0.9);
    cyl(0.01, 0.01, 0.3, PAL.wood, [-0.7, 1.2, 0], 4, g);
    put(tri, toon(PAL.tomato), [-0.7, 1.33, 0], g).rotation.set(0, 0, Math.PI / 2);
    shadow(S.bed.x, S.bed.z, 1.6, 1.5);
    solid(S.bed.x, S.bed.z, 1.5, 1.4, playerColliders);
  }

  // ---------- food and water (hunger) + treat jars above ----------
  {
    const { x, z } = S.bowl;
    box([0.5, 0.015, 0.9], PAL.pink, [x, 0.008, z]);
    cyl(0.16, 0.12, 0.09, PAL.red, [x, 0.05, z - 0.2], 7); cyl(0.12, 0.12, 0.02, PAL.darkWood, [x, 0.09, z - 0.2], 7); // kibble
    cyl(0.16, 0.12, 0.09, PAL.blue, [x, 0.05, z + 0.2], 7); cyl(0.12, 0.12, 0.02, PAL.water, [x, 0.09, z + 0.2], 7);
    solid(x + 0.05, z, 0.5, 0.9);
    const sx = R.width / 2 - 0.2, sz = -0.8;
    box([0.26, 0.05, 1.1], PAL.wood, [sx, 1.05, sz]);
    for (const dz of [-0.4, 0.4]) box([0.2, 0.2, 0.04], PAL.darkWood, [sx + 0.02, 0.95, sz + dz]);
    [PAL.red, PAL.sun, PAL.teal].forEach((lid, i) => {
      const jz = sz - 0.34 + i * 0.34;
      cyl(0.09, 0.09, 0.2, new THREE.MeshToonMaterial({ color: PAL.glass, gradientMap: ramp, transparent: true, opacity: 0.55 }), [sx, 1.18, jz], 7);
      cyl(0.07, 0.07, 0.1, PAL.darkWood, [sx, 1.14, jz], 6); cyl(0.1, 0.1, 0.04, lid, [sx, 1.3, jz], 7);
    });
  }

  // ---------- toy chest (play) ----------
  {
    const { x, z } = S.chest;
    box([0.6, 0.42, 0.95], PAL.purple, [x, 0.21, z]);
    for (const dz of [-0.4, 0.4]) box([0.62, 0.44, 0.06], PAL.sun, [x, 0.21, z + dz]);
    const lid = box([0.08, 0.6, 0.95], PAL.purple, [x - 0.27, 0.68, z]); lid.rotation.z = 0.18;
    blob(0.13, PAL.tomato, [x + 0.05, 0.47, z - 0.2]); blob(0.1, PAL.sun, [x - 0.02, 0.46, z + 0.12]); cyl(0.03, 0.03, 0.34, PAL.bone, [x + 0.1, 0.5, z + 0.28], 5).rotation.x = 1.1;
    shadow(x, z, 0.9, 1.2); solid(x, z, 0.7, 1.05);
  }

  // ---------- squashy sofa (for the humans) ----------
  {
    const { x, z, depth, width } = S.sofa;
    box([depth, 0.26, width], PAL.tomato, [x, 0.25, z]);
    box([0.24, 0.62, width], PAL.tomato, [x - depth / 2 + 0.12, 0.56, z]);
    for (const s of [-1, 1]) box([depth, 0.42, 0.24], PAL.tomato, [x, 0.4, z + s * (width / 2 - 0.12)]);
    for (const s of [-1, 1]) box([depth - 0.3, 0.14, width / 2 - 0.3], PAL.blush, [x + 0.1, 0.45, z + s * (width / 4 - 0.07)]);
    blob(0.2, PAL.sun, [x - 0.1, 0.66, z - 0.45], [1, 1, 0.5]).rotation.y = 0.5;
    for (const dx of [-0.32, 0.32]) for (const dz of [-0.85, 0.85]) cyl(0.04, 0.03, 0.12, PAL.darkWood, [x + dx, 0.06, z + dz], 5);
    shadow(x, z, 1.1, 2.2); solid(x, z, depth + 0.15, width + 0.15);
  }

  // ---------- lopsided bookshelf ----------
  {
    const { x, z, width, depth, height } = S.shelf, g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.z = 0.035; scene.add(g);
    for (const s of [-1, 1]) box([0.06, height, depth], PAL.wood, [s * (width / 2 - 0.03), height / 2, 0], g);
    const books = [PAL.tomato, PAL.teal, PAL.sun, PAL.purple, PAL.blue, PAL.pink];
    for (let level = 0; level < 4; level++) {
      const y = 0.06 + level * (height - 0.1) / 3;
      box([width, 0.05, depth], PAL.wood, [0, y, 0], g);
      if (level === 3) continue;
      for (let b = 0; b < 5; b++) { const h = 0.22 + ((b * 7 + level * 3) % 5) * 0.03; box([0.09, h, 0.22], books[(b + level * 2) % books.length], [-0.4 + b * 0.13, y + 0.025 + h / 2, 0], g).rotation.z = b === 4 ? -0.3 : 0; }
    }
    blob(0.12, PAL.leaf, [0.3, height + 0.16, 0], [1, 1.3, 1], g); cyl(0.09, 0.07, 0.1, PAL.pink, [0.3, height + 0.07, 0], 6, g);
    solid(x, z, width + 0.1, depth + 0.3);
  }

  // ---------- agility hoop: striped ring on a stand, the dog jumps through along x ----------
  {
    const { x, z, y, radius } = S.hoop;
    for (let i = 0; i < 8; i++) {
      const arc = put(flat(new THREE.TorusGeometry(radius, 0.05, 5, 3, Math.PI / 4)), i % 2 ? PAL.white : PAL.red, [x, y, z]);
      arc.rotation.set(0, Math.PI / 2, 0); arc.rotateZ(i * Math.PI / 4);
    }
    cyl(0.03, 0.03, y - radius, PAL.white, [x, (y - radius) / 2, z], 5);
    box([0.5, 0.05, 0.12], PAL.blue, [x, 0.025, z]); box([0.12, 0.05, 0.5], PAL.blue, [x, 0.025, z]);
    solid(x, z, 0.2, 0.2, playerColliders);
  }

  // ---------- dog tunnel ----------
  {
    const { x, z, length, radius } = S.tunnel;
    const tube = put(flat(new THREE.CylinderGeometry(radius, radius, length, 8, 1, true)), new THREE.MeshToonMaterial({ color: PAL.blue, gradientMap: ramp, side: THREE.DoubleSide }), [x, radius - 0.04, z]);
    tube.rotation.z = Math.PI / 2;
    for (const dx of [-length / 2, 0, length / 2]) put(flat(new THREE.TorusGeometry(radius + 0.02, 0.045, 5, 8)), PAL.deepBlue, [x + dx, radius - 0.04, z]).rotation.y = Math.PI / 2;
    shadow(x, z, length + 0.2, radius * 2.2);
    solid(x, z, length, radius * 2);
  }

  // ---------- wobbly plants ----------
  const plants: THREE.Group[] = [];
  const plant = (x: number, z: number, s: number) => {
    cyl(0.2 * s, 0.15 * s, 0.16 * s, PAL.pink, [x, 0.08 * s, z], 6); cyl(0.21 * s, 0.2 * s, 0.1 * s, PAL.white, [x, 0.2 * s, z], 6);
    const g = new THREE.Group(); g.position.set(x, 0.24 * s, z); scene.add(g); plants.push(g);
    cyl(0.03 * s, 0.04 * s, 0.5 * s, PAL.darkLeaf, [0, 0.25 * s, 0], 5, g);
    for (const [dx, dy, dz, r] of [[0, 0.62, 0, 0.26], [-0.2, 0.42, 0.05, 0.19], [0.2, 0.46, -0.06, 0.2], [0.03, 0.34, 0.2, 0.16]] as const) blob(r * s, dy > 0.5 ? PAL.leaf : PAL.darkLeaf, [dx * s, dy * s, dz * s], [1, 1.25, 1], g);
    shadow(x, z, 0.7 * s, 0.7 * s); solid(x, z, 0.45 * s, 0.45 * s);
  };
  plant(-4.95, -3.45, 1.2); plant(1.75, -3.55, 0.9); plant(4.9, 3.4, 1.05);

  // ---------- dust motes drifting in the window light ----------
  const N = 36, mote = new Float32Array(N * 3), seed = Array.from({ length: N }, (_, i) => i * 1.618);
  const motes = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(mote, 3)), new THREE.PointsMaterial({ color: 0xfffbe0, size: 0.03, transparent: true, opacity: 0.8, depthWrite: false }));
  scene.add(motes);

  scene.add(new THREE.HemisphereLight(0xfff6dd, 0xffe2c4, 1.5));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  sunLight.position.set(2.5, 5, 3.5);
  scene.add(sunLight);

  let t = 0;
  return {
    scene, colliders, playerColliders,
    update: (dt: number) => {
      t += dt;
      plants.forEach((p, i) => { p.rotation.z = Math.sin(t * 1.1 + i * 2) * 0.05; p.rotation.x = Math.cos(t * 0.9 + i) * 0.035; });
      for (let i = 0; i < N; i++) {
        const s = seed[i];
        mote[i * 3] = Math.sin(s * 3.1 + t * 0.07) * 1.4 + 0.2;
        mote[i * 3 + 1] = ((s * 0.37 + t * 0.04) % 1) * 1.9 + 0.1;
        mote[i * 3 + 2] = zb + 0.4 + ((s * 0.71) % 1) * 2.4 + Math.sin(t * 0.2 + s) * 0.1;
      }
      motes.geometry.attributes.position.needsUpdate = true;
    },
    dispose: () => scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose()); else mesh.material?.dispose();
    }),
  };
}
