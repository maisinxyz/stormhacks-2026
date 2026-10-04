import * as THREE from 'three';

export const ROOM_TOKENS = { floor: 0xb89067, floorLine: 0xd9bd91, wall: 0xf4ead7, baseboard: 0xd7b88f, rug: 0xc9a6a0, bed: 0x8fabb0, fabric: 0xbcd0cb, wood: 0x9a6d4e, green: 0x769671, light: 0xffe6ae };
const mat = (color: number, roughness = .9) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

function box(scene: THREE.Scene, size: [number, number, number], position: [number, number, number], color: number, name: string) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color)); mesh.position.set(...position); mesh.name = name; scene.add(mesh); return mesh; }
function cylinder(scene: THREE.Scene, radius: number, height: number, position: [number, number, number], color: number, name: string) { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32), mat(color)); mesh.position.set(...position); mesh.name = name; scene.add(mesh); return mesh; }

function floorTexture() { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const x = canvas.getContext('2d')!; x.fillStyle = '#b89067'; x.fillRect(0, 0, 256, 256); x.strokeStyle = '#d9bd91'; x.globalAlpha = .45; for (let i = 0; i < 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); } const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 3); return texture; }

export interface RoomScene { scene: THREE.Scene; update(dt: number): void; dispose(): void; }
export function createRoomScene(low = false): RoomScene {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, .12, 4), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1 })); floor.position.y = -.06; floor.name = 'room-floor'; scene.add(floor);
  box(scene, [4, 2.6, .12], [0, 1.3, -2], ROOM_TOKENS.wall, 'back-wall'); box(scene, [.12, 2.6, 4], [-2, 1.3, 0], ROOM_TOKENS.wall, 'left-wall'); box(scene, [.12, 2.6, 4], [2, 1.3, 0], ROOM_TOKENS.wall, 'right-wall');
  box(scene, [4.05, .12, .12], [0, .08, -1.92], ROOM_TOKENS.baseboard, 'baseboard');
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .018, 48), mat(ROOM_TOKENS.rug)); rug.position.set(0, .015, .15); rug.name = 'play-rug'; scene.add(rug);
  box(scene, [1.1, .18, .75], [-1.05, .12, -1.18], ROOM_TOKENS.bed, 'dog-bed'); const pillow = new THREE.Mesh(new THREE.SphereGeometry(.38, 20, 10), mat(ROOM_TOKENS.fabric)); pillow.scale.set(1.3, .32, .8); pillow.position.set(-1.05, .28, -1.18); scene.add(pillow);
  cylinder(scene, .2, .08, [1.25, .04, -1.3], 0xe4dfd1, 'food-bowl'); cylinder(scene, .16, .08, [1.7, .04, -1.3], 0x9fc0c5, 'water-bowl');
  box(scene, [.48, .42, .38], [-1.55, .22, .75], ROOM_TOKENS.wood, 'toy-bin'); cylinder(scene, .09, .06, [-1.55, .47, .75], 0xd25e54, 'ball');
  if (!low) { box(scene, [.75, 1.05, .06], [0, 1.55, -1.92], 0xb3d1d2, 'window'); box(scene, [.08, 1.05, .08], [-.38, 1.55, -1.88], ROOM_TOKENS.baseboard, 'window-frame'); box(scene, [.08, 1.05, .08], [.38, 1.55, -1.88], ROOM_TOKENS.baseboard, 'window-frame'); const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), new THREE.MeshBasicMaterial({ color: ROOM_TOKENS.light, transparent: true, opacity: .16, side: THREE.DoubleSide })); shaft.rotation.x = -Math.PI / 2; shaft.position.set(.15, .01, -.55); scene.add(shaft); cylinder(scene, .22, .75, [1.35, .38, .95], ROOM_TOKENS.green, 'plant-pot'); cylinder(scene, .48, .7, [1.35, .88, .95], ROOM_TOKENS.green, 'plant'); box(scene, [.45, .8, .35], [.85, .4, -.9], ROOM_TOKENS.wood, 'side-table'); }
  const hemi = new THREE.HemisphereLight(0xffefd0, 0x58717a, 1.8); scene.add(hemi); const key = new THREE.DirectionalLight(0xffd8a8, 2.2); key.position.set(-2, 4, 2); scene.add(key);
  return { scene, update: (_dt: number) => {}, dispose: () => { scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose()); else if (m.material) m.material.dispose(); }); } };
}
