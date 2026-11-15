import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createCharacter, lookFromProfile, nameTag, speechBubble } from './character.js';
import { setupProfileForm, loadProfile, DEFAULT_PROFILE, tagLines, isProfileComplete, profileClassCode, classCodeFromParts } from './profile.js';
import { Collision } from './physics.js';
import { drumSound, chimeSound, kengSound, clapSound, unlockAudio } from './sound.js';
import { createMultiplayer } from './multiplayer.js';
import { createVoice } from './voice.js';
import { toggleClassroomDoor } from './classroom.js';
import { mountBike, dismountBike, syncBikeVisual } from './bike.js';
import {
  tickSoccer, tickFlagCeremony, openGallery, closeGallery,
} from './yardPlay.js';

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('shot') });
let pixelCap = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(pixelCap);
function tunePerfForCrowd(n) {
  const cap = n > 22 ? 1.35 : n > 14 ? 1.6 : Math.min(devicePixelRatio, 2);
  if (Math.abs(cap - pixelCap) > 0.05) {
    pixelCap = cap;
    renderer.setPixelRatio(pixelCap);
  }
}
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);
const canvas = renderer.domElement;
canvas.tabIndex = 0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd6e7f3, 90, 320);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(600, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x3b8be0) }, bottom: { value: new THREE.Color(0xe4eef5) } },
    vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 bottom; varying vec3 vDir;',
      'void main(){',
      '  float h = clamp(vDir.y * 1.5 + 0.04, 0.0, 1.0);',
      '  gl_FragColor = vec4(mix(bottom, top, pow(h, 0.65)), 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  }),
);
scene.add(sky);

const clouds = new THREE.Group();
{
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdde6ee, emissiveIntensity: 0.55, fog: false, flatShading: true });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.3, r = 220 + (i % 4) * 50;
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((k - 2) * 9 + (k % 2) * 3, (k % 2) * 4, (k % 3) * 4);
      m.scale.set(12 + (k % 3) * 4, 6 + (k % 2) * 3, 9);
      c.add(m);
    }
    c.position.set(Math.cos(a) * r, 90 + (i % 5) * 14, Math.sin(a) * r);
    c.lookAt(0, c.position.y, 0);
    clouds.add(c);
  }
  scene.add(clouds);
}

scene.add(new THREE.HemisphereLight(0xdfefff, 0x7a6a4a, 1.15));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 220 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(38, 70, 30);

// ---------- world ----------
const world = buildWorld(scene);
let collected = 0;
const TOTAL = world.collectibles.length;
$('total').textContent = TOTAL;
function pushStats() {
  if (!started) return;
  mp.reportStats?.(collected, mp.notes?.length ?? 0);
}
const exteriorBounds = { minX: -95, maxX: 95, minZ: -43.4, maxZ: 52.6 };
const col = new Collision(world.colliders, exteriorBounds);

// ---------- player ----------
const player = {
  pos: new THREE.Vector3(0, 0, 48),
  vel: new THREE.Vector3(),
  feetY: 0, vy: 0, grounded: true, facing: Math.PI,
  char: null,
  pose: null, // 'sit' | 'lie' | 'dance'
  onBike: false,
  bike: null,
};
const POSE_LABEL = { sit: 'Ngồi', lie: 'Nằm', dance: 'Nhảy múa' };
const POSE_CYCLE = ['sit', 'lie', 'dance'];
const POSE_VISUAL_DROP = { sit: 0.54, lie: 0.2 };
let playerClapT = 0;
let lastClapAt = 0;

function toggleBikeAtShed() {
  const shedX = 41, shedZ = 28.5, shedR = 5.5;
  const atShed = Math.hypot(player.pos.x - shedX, player.pos.z - shedZ) < shedR + 1;
  if (player.onBike) {
    if (!atShed) {
      toast('Về nhà xe (bên phải sân) để trả xe, hoặc bấm B để xuống xe tạm.', 3200);
      return;
    }
    dismountBike(player, scene, player.char.root, player.feetY, player.facing);
    toast('Đã trả xe vào nhà xe.', 2400);
    return;
  }
  if (!atShed) {
    toast('Đến giữa nhà xe (hàng xe bên phải) rồi bấm E.', 2800);
    return;
  }
  if (player.pose) clearPlayerPose();
  const colors = [0x2d6cb5, 0xc23b3b, 0x2f8f5b, 0xe0a030];
  const c = colors[Math.floor(Math.random() * colors.length)];
  mountBike(player, scene, c, player.char.root);
  toast('Đã lấy xe — WASD đạp, Shift chạy nhanh. B = xuống xe.', 4200);
}

function dismountBikeAnywhere() {
  if (!player.onBike) return;
  dismountBike(player, scene, player.char.root, player.feetY, player.facing);
  toast('Đã xuống xe.', 1800);
}

function triggerClap() {
  if (!started) return;
  const now = performance.now();
  if (now - lastClapAt < 280) return;
  lastClapAt = now;
  unlockAudio();
  clapSound(4);
  playerClapT = 2.4;
  mp?.act?.('clap');
}

function clearPlayerPose() {
  if (!player.pose) return;
  player.pose = null;
  toast('Đứng dậy', 1200);
}

function setPlayerPose(name) {
  if (!started || !player.grounded) return;
  if (dialogOpen || menuOpen || bookOpen || chatOpen || classOpen) return;
  if (player.pose === name) {
    clearPlayerPose();
    return;
  }
  player.pose = name;
  player.vel.set(0, 0, 0);
  toast(`${POSE_LABEL[name]} — bấm lại phím hoặc đi / nhảy để đứng`, 2400);
}

function cyclePlayerPose() {
  const i = player.pose ? POSE_CYCLE.indexOf(player.pose) : -1;
  const next = POSE_CYCLE[(i + 1) % POSE_CYCLE.length];
  if (player.pose === next) clearPlayerPose();
  else setPlayerPose(next);
}
let profile = loadProfile() || DEFAULT_PROFILE;
function applyProfile(p) {
  profile = p;
  if (player.char) scene.remove(player.char.root);
  player.char = createCharacter(lookFromProfile(p));
  player.char.root.add(nameTag(tagLines(p)));
  scene.add(player.char.root);
  const [l1, l2] = tagLines(p);
  $('hudName').textContent = l1;
  $('hudInfo').textContent = l2;
  for (const n of npcs) n.greeted = false;
  mp?.hello();
  mp?.syncClassFromProfile?.({ auto: true });
}

// ---------- NPCs (nhân vật hư cấu) ----------
const NPC_DEFS = [
  { name: 'Lan', kind: 'aodai', x: -8, z: 4, lines: ['Hôm nay thứ Hai nên tụi mình mặc áo dài đấy!', 'Cậu đã tìm thấy trang lưu bút nào chưa? Nghe nói có một trang ở chỗ nhà xe.'] },
  { name: 'Minh', kind: 'boy', x: 2, z: 21, bag: 0x333333, lines: ['Chiều nay lớp mình đá bóng với 12A2, cậu ra cổ vũ nhé!', 'Trống trên sân khấu là để vào lớp, còn kẻng treo ở gốc cây cổ thụ bên trái sân trong là báo ra chơi đấy.'] },
  { name: 'Hoa', kind: 'aodai', x: -20, z: 19, static: true, face: Math.PI / 2, lines: ['Mùa phượng nở là mùa thi… nhanh thật.', 'Tớ đang ôn thi học sinh giỏi Văn, run quá!'] },
  { name: 'Trang', kind: 'girl', x: -18.6, z: 19, static: true, face: -Math.PI / 2, lines: ['Hoa ơi, chép giùm tớ bài Lí hôm qua nhé.', 'Trường mình được gọi là “ngôi trường của những thủ khoa” đó cậu biết không?'] },
  { name: 'Tuấn', kind: 'boy', x: 14, z: 28, bag: 0x8a2d2d, lines: ['Sáng nào tớ cũng đạp xe hơn 5 cây số tới trường.', 'Cuối cổng có biển “Kỷ cương – Tình thương – Trách nhiệm”, cậu đọc chưa?'] },
  { name: 'Ngọc', kind: 'aodai', x: 20, z: -4, lines: ['Tuần sau trường mình tập văn nghệ trên sân khấu kia.', 'Băng rôn trên dãy nhà bên phải ghi “Hiền tài là nguyên khí quốc gia” — câu đó khắc trên bia Văn Miếu đấy.'] },
  { name: 'Dũng', kind: 'boy', x: -4, z: 26, bag: 0x2f6f3f, lines: ['Sáng thứ Hai cả trường xếp hàng chào cờ trước sân khấu ở sân trong.', 'Ra ngoài cổng mà xem hàng cau vua với cây phượng, đẹp lắm.'] },
  // trực cổng: thầy Thanh và đội Sao Đỏ
  { name: 'Thầy Thanh', kind: 'boy', shirt: 0xf4f6f8, pants: 0x2f3542, x: -4.3, z: 34.5, teacher: true, gateWatch: true, gatePatrol: true, homeX0: -16, homeX1: 10, homeZ0: 30.5, homeZ1: 41.5, face: 0.25,
    lines: ['Sơ vin vào em, tóc tai gọn gàng vào!', 'Đi học đúng giờ, mặc đúng đồng phục, đeo huy hiệu Đoàn đầy đủ nhé.', 'Xe đạp phải dắt bộ qua cổng, để đúng chỗ trong nhà xe.', 'Ngoài cổng đông quá — nhớ trật tự, đừng chen hàng quán ăn vặt.'],
    greet: 'Sơ vin vào em, tóc tai gọn gàng vào!' },
  { name: 'Bạn Sao Đỏ', kind: 'boy', armband: true, x: -2.9, z: 33.6, static: true, face: Math.PI / 2,
    lines: ['Đội Sao Đỏ trực cổng đây, đi muộn là bị ghi tên đấy nhé!', 'Nhớ đeo huy hiệu Đoàn trước ngực trái nha bạn.'],
    greet: 'Chào bạn! Sơ vin chưa? Huy hiệu đâu rồi?' },
  { name: 'Bạn Sao Đỏ', kind: 'aodai', armband: true, x: 2.9, z: 33.6, static: true, face: -Math.PI / 2,
    lines: ['Hôm nay lớp nào đi muộn nhiều nhất là bị trừ điểm thi đua đấy.', 'Dép lê là không được vào trường đâu nhé!'],
    greet: 'Vào nhanh lên bạn ơi, sắp đánh trống rồi!' },
  { name: 'Bác bảo vệ', kind: 'boy', shirt: 0xa9d4ef, pants: 0x2e3328, cap: 0x4f5c3e, x: 5.2, z: 35, staff: true, gatePatrol: true, homeX0: -14, homeX1: 16, homeZ0: 30, homeZ1: 42, face: -Math.PI / 2,
    lines: ['Xuống xe dắt bộ vào nhé, trong sân trường không được đi xe!', 'Xe để vào nhà xe bên phải, khoá cẩn thận vào các cháu.', 'Đi muộn là bác đóng cổng đấy nhé!', 'Quán ngoài cổng bán được, nhưng đừng ăn quá tại chỗ — rác vứt vào thùng nhé.'],
    greet: 'Xuống xe dắt bộ vào nhé, trong sân trường không được đi xe!' },
  { name: 'Cô Hằng', kind: 'girl', x: -15, z: 38.08, static: true, face: 0, vendor: true,
    menu: ['• Bánh rán mặn: 2k/cái · 5 cái 10k', '• Trà tắc / sữa đậu: 8k', '• Xiên que: 10–15k'],
    lines: ['Bánh rán mặn nóng hổi nè, 5 cái 10k!', 'Trà tắc, sữa đậu — uống nhanh rồi vào trường kẻo trễ.', 'Hay mua xiên que về cho bọn lớp 10, cô chiết cho.'],
    greet: 'Bánh rán vừa rán xong đây! Có muốn thử không?' },
  { name: 'Chú Tư', kind: 'boy', shirt: 0xe8eaf0, pants: 0x424242, x: -8.5, z: 38.05, static: true, face: 0, vendor: true,
    menu: ['• Trà sữa trân châu: 15k · topping +3k', '• Bánh tráng nướng: 12k', '• Trứng cút lộn: 6k'],
    lines: ['Trà sữa trân châu 15k — trà vỉa hè ngon nhất dòng!', 'Có bánh tráng nướng, trứng cút lộn xanh.', 'Chiều vắng khách thì chú dọn sớm, đừng trông mãi nhé.'],
    greet: 'Trà sữa một ly không em? Thêm topping 3k.' },
  { name: 'Bà Năm', kind: 'aodai', x: 11, z: 38.06, static: true, face: 0, vendor: true,
    menu: ['• Kem que / sữa chua hộp: 8–12k', '• Xiên que, nem chua: 10k', '• Kẹo kéo / bánh gạo: 5k'],
    lines: ['Kem que, kẹo kéo, sữa chua hộp — bọn học sinh hay mua nhất.', 'Bà có xiên que: thịt xiên, nem chua rán.', 'Trời lạnh bà bán khoai lang nướng luôn.'],
    greet: 'Ăn vặt gì không cháu? Kẹo que còn nhiều.' },
  { name: 'Thầy chủ nhiệm', kind: 'boy', shirt: 0x9fc3e6, pants: 0x4a4a4a, x: -13, z: -19, static: true, teacher: true, face: 0.6, lines: ['Chào em! Nhớ học bài cũ trước khi vào lớp nhé.', 'Trường mình thành lập từ tháng 9 năm 1961 đấy, đã hơn 65 năm rồi.'] },
];
const npcs = NPC_DEFS.map(d => {
  const char = createCharacter({ kind: d.kind, bag: d.bag ?? null, shirt: d.shirt, pants: d.pants, armband: d.armband, cap: d.cap, badge: d.teacher || d.staff ? false : undefined });
  scene.add(char.root);
  return { ...d, char, pos: new THREE.Vector3(d.x, 0, d.z), feetY: 0, facing: d.face ?? Math.random() * 6, target: null, wait: Math.random() * 3, stuck: 0, talkT: 0, lineIdx: 0, bellT: 0 };
});

const onStage = v => v.x > -12 && v.x < 12 && v.z > -27 && v.z < -17.5;

function pickTarget(n) {
  if (n.gatePatrol) {
    const { homeX0, homeX1, homeZ0, homeZ1 } = n;
    return new THREE.Vector3(
      homeX0 + Math.random() * (homeX1 - homeX0),
      0,
      homeZ0 + Math.random() * (homeZ1 - homeZ0),
    );
  }
  // trống vào lớp: kéo về hành lang các dãy nhà
  if (n.bellT > 0 && n.mode === 'class') {
    const spots = [[-40 + Math.random() * 26, -32.2], [14 + Math.random() * 26, -32.2], [-51.7, -28 + Math.random() * 40], [51.7, -28 + Math.random() * 40]];
    const [x, z] = spots[Math.floor(Math.random() * spots.length)];
    return new THREE.Vector3(x, 0, z);
  }
  let v;
  // sân trước (giữa cổng và hai dãy nhà) hoặc sân trong (trước nhà chính)
  do v = new THREE.Vector3(-44 + Math.random() * 88, 0, -26 + Math.random() * 58);
  while (onStage(v) || (Math.abs(v.x) > 4.5 && Math.abs(v.x) < 30.5 && v.z > 6.5 && v.z < 17)); // tránh sân khấu và hai dãy nhà trước
  return v;
}

// ---------- input ----------
const keys = new Set();
let jumpQueued = false;
let jumpQueuedUntil = 0;
const JUMP_BUFFER_MS = 200;
function queueJump() {
  jumpQueued = true;
  jumpQueuedUntil = performance.now() + JUMP_BUFFER_MS;
}
let yaw = 0, pitch = 0.3, dist = 7, camD = 7;
let started = false, dialogOpen = false, menuOpen = false, mapOn = true, bookOpen = false, chatOpen = false, classOpen = false;
let galleryOpen = false, boardOpen = false;

function uiBlocksGame() {
  return menuOpen || bookOpen || chatOpen || classOpen || dialogOpen || galleryOpen || boardOpen
    || (!$('intro').hidden && !started);
}
function formFocusBlocksKeys() {
  const ae = document.activeElement;
  if (!ae || ae === document.body || ae === canvas) return false;
  const tag = ae.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  return !ae.closest('[hidden]');
}
function releaseGameFocus() {
  const ae = document.activeElement;
  if (ae?.blur && ae !== document.body) ae.blur();
}

let ctrlHeld = false;
addEventListener('keydown', e => {
  // Ctrl: hiện chuột (bấm/giữ). Thả Ctrl → khóa lại nếu không đang mở UI cần click/gõ.
  if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && started && !isTouchPlay()) {
    if (!e.repeat) { ctrlHeld = true; exitLookLock(); }
    return;
  }
  if (!started || menuOpen || formFocusBlocksKeys()) return;
  if (e.code === 'KeyE' || e.code === 'Enter') { if (!e.repeat) use(); e.preventDefault(); return; }
  if (e.code === 'Escape') { closeDialog(); return; }
  if (e.code === 'KeyM') { mapOn = !mapOn; $('minimap').hidden = !mapOn; return; }
  if (e.code === 'KeyT' && started && !menuOpen) { openChat(); e.preventDefault(); return; }
  if (e.code === 'KeyC' && started && !menuOpen) { openClass(); e.preventDefault(); return; }
  if (e.code === 'Space') { queueJump(); e.preventDefault(); return; }
  if (e.code === 'Digit1' && !e.repeat) { setPlayerPose('sit'); e.preventDefault(); return; }
  if (e.code === 'Digit2' && !e.repeat) { setPlayerPose('lie'); e.preventDefault(); return; }
  if (e.code === 'Digit3' && !e.repeat) { setPlayerPose('dance'); e.preventDefault(); return; }
  if ((e.code === 'Digit4' || e.code === 'KeyV') && !e.repeat) { triggerClap(); e.preventDefault(); return; }
  if (e.code === 'KeyB' && !e.repeat) { dismountBikeAnywhere(); e.preventDefault(); return; }
  if (e.code === 'Digit0' && !e.repeat) { clearPlayerPose(); e.preventDefault(); return; }
  keys.add(e.code);
});
addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    if (!e.getModifierState('Control')) {
      ctrlHeld = false;
      if (started && !uiBlocksGame() && !isTouchPlay()) requestLookLock();
    }
  }
});
addEventListener('blur', () => { keys.clear(); ctrlHeld = false; });

const joy = { id: null, x: 0, y: 0 };
const JOY_R = 52;
const look = { id: null, x: 0, y: 0 };
const joyEl = $('joy');
const LOOK_SENS = 0.0024;

function isTouchPlay() {
  return document.body.classList.contains('touch');
}
function pointerLocked() {
  return document.pointerLockElement === canvas;
}
function exitLookLock() {
  if (document.pointerLockElement) document.exitPointerLock?.();
}
function requestLookLock() {
  if (!started || uiBlocksGame() || isTouchPlay() || pointerLocked() || ctrlHeld) return;
  try {
    const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && typeof p.catch === 'function') p.catch(() => canvas.requestPointerLock?.());
  } catch {
    canvas.requestPointerLock?.();
  }
}
/** Popup đóng bằng E/Esc: giữ khóa chuột. UI cần gõ/click thì thả. */
function maybeRelock() {
  if (started && !uiBlocksGame() && !isTouchPlay() && !ctrlHeld) requestLookLock();
}

function joyCenter() {
  const r = joyEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function setJoyFromPointer(cx, cy) {
  const c = joyCenter();
  let dx = cx - c.x;
  let dy = cy - c.y;
  const l = Math.hypot(dx, dy);
  const max = JOY_R - 4;
  if (l > max) { dx *= max / l; dy *= max / l; }
  joy.x = dx / max;
  joy.y = dy / max;
  $('knob').style.transform = `translate(${dx}px, ${dy}px)`;
}
function resetJoy() {
  joy.id = null;
  joy.x = 0;
  joy.y = 0;
  $('knob').style.transform = '';
}

function ptrOnUi(el) {
  return el?.closest?.('#hud, #guestbook, #classPanel, #talkInvite, #talkPanel, #chatBar, #dialog, #galleryView, #leaderboard, #intro, #minimap, #mobileBar, #touchBtns, #joy, button, input, textarea, select, a, label');
}

const pinchPts = new Map();
const pinch = { base: null, dist0: 7 };
function syncPinchBase() {
  if (pinchPts.size !== 2) { pinch.base = null; return; }
  const [a, b] = [...pinchPts.values()];
  pinch.base = Math.hypot(a.x - b.x, a.y - b.y);
  pinch.dist0 = dist;
}
function applyPinch() {
  if (pinchPts.size !== 2 || pinch.base == null || pinch.base < 1) return;
  const [a, b] = [...pinchPts.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  dist = clamp(pinch.dist0 * (d / pinch.base), 2.5, 18);
}
function trackPinch(e, down) {
  if (!started || e.pointerType !== 'touch') return;
  if (down && ptrOnUi(e.target)) return;
  if (down) pinchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  else pinchPts.delete(e.pointerId);
  syncPinchBase();
}
function applyLookDelta(dx, dy, k = LOOK_SENS) {
  yaw -= dx * k;
  pitch = clamp(pitch + dy * k * 0.8, -0.15, 1.3);
}

joyEl.addEventListener('pointerdown', e => {
  if (!started || uiBlocksGame() || !isTouchPlay()) return;
  unlockAudio();
  e.preventDefault();
  e.stopPropagation();
  joy.id = e.pointerId;
  setJoyFromPointer(e.clientX, e.clientY);
  try { joyEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
canvas.addEventListener('pointerdown', e => {
  trackPinch(e, true);
  if (!started || uiBlocksGame() || ptrOnUi(e.target)) return;
  unlockAudio();
  // Desktop: pointer lock (FPS) — không cần giữ kéo
  if (e.pointerType !== 'touch' && !isTouchPlay()) {
    requestLookLock();
    return;
  }
  // Touch: kéo nửa phải màn hình để xoay
  if (e.clientX < innerWidth * 0.42) return;
  if (look.id === null) {
    Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
  }
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
addEventListener('pointermove', e => {
  if (pinchPts.has(e.pointerId)) {
    pinchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    applyPinch();
  }
  if (e.pointerId === joy.id) setJoyFromPointer(e.clientX, e.clientY);
  else if (e.pointerId === look.id) {
    applyLookDelta(e.clientX - look.x, e.clientY - look.y, 0.008);
    look.x = e.clientX;
    look.y = e.clientY;
  }
});
addEventListener('mousemove', e => {
  if (!pointerLocked() || uiBlocksGame()) return;
  applyLookDelta(e.movementX, e.movementY);
});
document.addEventListener('pointerlockchange', () => {
  canvas.classList.toggle('looking', pointerLocked());
});
function endPointer(e) {
  trackPinch(e, false);
  if (e.pointerId === joy.id) resetJoy();
  if (e.pointerId === look.id) look.id = null;
}
addEventListener('pointerup', endPointer);
addEventListener('pointercancel', endPointer);
addEventListener('wheel', e => {
  if (!started || uiBlocksGame() || ptrOnUi(e.target)) return;
  dist = clamp(dist + e.deltaY * 0.01, 2.5, 18);
  e.preventDefault();
}, { passive: false });
$('btnUse').addEventListener('pointerdown', e => { e.preventDefault(); use(); });
$('btnJump').addEventListener('pointerdown', e => { e.preventDefault(); queueJump(); unlockAudio(); });
const mbMap = $('mbMap');
if (mbMap) mbMap.addEventListener('click', () => { mapOn = !mapOn; $('minimap').hidden = !mapOn; });
const mbPose = $('mbPose');
if (mbPose) mbPose.addEventListener('click', () => { unlockAudio(); cyclePlayerPose(); });
const mbChat = $('mbChat');
if (mbChat) mbChat.addEventListener('click', () => openChat());
const mbClass = $('mbClass');
if (mbClass) mbClass.addEventListener('click', () => (classOpen ? closeClass() : openClass()));
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

function syncOrientationUi() {
  const touch = isTouchPlay();
  const portrait = touch && matchMedia('(orientation: portrait)').matches;
  document.body.classList.toggle('portrait', portrait);
  document.body.classList.toggle('landscape', touch && !portrait);
  const hint = $('rotateHint');
  // Chỉ chặn khi đang chơi — màn tạo nhân vật vẫn xem được khi dọc
  if (hint) hint.hidden = !(portrait && started);
}
function lockLandscape() {
  const o = screen.orientation;
  if (!o?.lock) return;
  o.lock('landscape').catch(() => {});
}
syncOrientationUi();
matchMedia('(orientation: portrait)').addEventListener('change', syncOrientationUi);
addEventListener('orientationchange', syncOrientationUi);
addEventListener('resize', syncOrientationUi);

// ---------- UI ----------
let toastTimer;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function showDialog(title, text, kicker = '') {
  $('dlgKicker').textContent = kicker;
  $('dlgTitle').textContent = title;
  $('dlgText').textContent = text;
  $('dialog').hidden = false;
  dialogOpen = true;
}
function closeDialog() {
  $('dialog').hidden = true;
  dialogOpen = false;
  maybeRelock();
}
$('dlgClose').addEventListener('click', closeDialog);

function renderGuestbook(list) {
  const ul = $('gbList');
  ul.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Chưa có lời nhắn — hãy là người đầu tiên!';
    ul.appendChild(li);
    return;
  }
  for (const n of list) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${escapeHtml(n.name)}</b> — ${escapeHtml(n.text)}<small>${escapeHtml(n.info || '')}</small>`;
    ul.appendChild(li);
  }
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function openGuestbook() {
  bookOpen = true;
  $('guestbook').hidden = false;
  renderGuestbook(mp.notes);
  // Không auto-focus ô gõ — giữ pointer lock, đóng bằng E. Muốn gõ: giữ Ctrl → click ô.
}
function closeGuestbook() {
  bookOpen = false;
  $('guestbook').hidden = true;
  releaseGameFocus();
  maybeRelock();
}
const NEAR_CHAT_MAX = 24;
function appendNearChat(who, text, me = false) {
  const log = $('nearChatLog');
  if (!log) return;
  const li = document.createElement('li');
  if (me) li.className = 'me';
  li.innerHTML = `<b>${escapeHtml(who)}</b>: ${escapeHtml(text)}`;
  log.appendChild(li);
  while (log.children.length > NEAR_CHAT_MAX) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function openChat() {
  exitLookLock();
  chatOpen = true;
  $('chatBar').hidden = false;
  $('chatInput').focus();
}
function closeChat() {
  chatOpen = false;
  $('chatBar').hidden = true;
  releaseGameFocus();
  maybeRelock();
}
let netHintShown = false;
let lastOnlineN = 1;
function setNetStatus(s) {
  const dot = $('netDot');
  dot.className = 'dot ' + (s === 'online' ? 'on' : s === 'connecting' ? 'wait' : s === 'solo' ? 'solo' : 'off');
  const box = dot.closest('.online');
  if (box) {
    if (s === 'online') box.title = 'Đã vào sân chung — đứng gần (sân, cổng, hành lang) để thấy nhân vật';
    else if (s === 'solo') box.title = 'Chơi một mình — dùng npm run dev (cổng 8787), không mở ?nosync';
    else if (s === 'connecting') box.title = 'Đang nối máy chủ…';
    else box.title = 'Mất kết nối — tự thử lại sau vài giây';
  }
  if (s === 'solo') $('onlineN').textContent = '1';
  else if (s === 'offline') $('onlineN').textContent = '!';
}
function visibleRemotes() {
  let n = 0;
  for (const r of mp.remotes.values()) if (r.seeded && r.char?.root?.visible) n++;
  return n;
}
function setOnline(n) {
  lastOnlineN = n;
  $('onlineN').textContent = String(n);
  tunePerfForCrowd(n);
  if (!netHintShown && n > 1) {
    netHintShown = true;
    const v = visibleRemotes();
    toast(
      v > 0
        ? `Có ${n} người trên sân — đang thấy ${v} bạn gần đây.`
        : `Có ${n} người online — đi cổng/sân/hành lang chính để gặp (khoảng 70m).`,
      5200,
    );
  }
}

function remoteBell(kind) {
  if (kind === 'drum') {
    drumSound();
    toast('Ai đó vừa đánh trống — vào lớp!');
    for (const n of npcs) if (!n.static) { n.bellT = 14; n.mode = 'class'; n.target = pickTarget(n); n.wait = 0; }
  } else if (kind === 'keng') {
    kengSound();
    toast('Ai đó vừa đánh kẻng — ra chơi!');
    for (const n of npcs) if (!n.static) { n.bellT = 12; n.mode = 'play'; n.target = pickTarget(n); n.wait = 0; }
  }
}

const mp = createMultiplayer({
  scene,
  col,
  getProfile: () => profile,
  getPlayer: () => player,
  callbacks: {
    onStatus: setNetStatus,
    onOnline: setOnline,
    onNotes(list) {
      renderGuestbook(list);
      pushStats();
    },
    onError: msg => toast(msg, 3500),
    onChat(m) {
      if (m.id === mp.myId) {
        sayOwn(m.text);
        return;
      }
      const r = mp.remotes.get(m.id);
      const who = r?.profile?.name || 'Bạn';
      const short = who.split(/\s+/).pop() || who;
      appendNearChat(short, m.text);
      if (!chatOpen) toast(`${short}: ${m.text}`, 3200);
    },
    onAct(m) {
      const r = mp.remotes.get(m.id);
      if (m.kind === 'clap' && r) {
        r.clapT = 2.2;
        return;
      }
      remoteBell(m.kind);
    },
    onClassJoined(cls, history, members, meta = {}) {
      classUnread = 0;
      updateClassBadge();
      showClassRoom(cls, history, members);
      setClsJoinStatus(`Đã vào lớp ${cls.className} · ${cls.year}–${+cls.year + 3}`);
      const msg = meta.auto
        ? `Tự động vào lớp ${cls.className} · niên khóa ${cls.year}–${+cls.year + 3}`
        : `Đã vào lớp ${cls.className} · niên khóa ${cls.year}–${+cls.year + 3}`;
      if (!classOpen) toast(msg, meta.auto ? 3800 : 3000);
    },
    onClassMembers: renderClassMembers,
    onClassMsg(msg) {
      appendClassMsg(msg);
      if (msg.from !== mp.myId) sayOwnOnRemote(msg);
      if (!classOpen && msg.from !== mp.myId) {
        classUnread++;
        updateClassBadge();
        toast(`[Lớp ${mp.classInfo?.className}] ${msg.name.split(/\s+/).pop()}: ${msg.text}`, 3500);
      }
    },
    onClassErr(msg) {
      setClsJoinStatus(msg, true);
      toast(msg, 3800);
      if (!mp.classInfo) showClassSetup();
    },
    onTalkReq: showTalkInvite,
    onTalkStart: startTalk,
    onTalkDecline(m) {
      const r = mp.remotes.get(m.id);
      toast(m.why === 'busy' ? `${remoteName(r)} đang trò chuyện với người khác.` : `${remoteName(r)} chưa muốn trò chuyện lúc này.`, 3500);
    },
    onTalkMsg(m) {
      if (!talk || m.from !== talk.peer) return;
      const label = m.name?.split(/\s+/).pop() || talk.name;
      appendTalk(label, m.text);
    },
    onTalkEnd() {
      if (!talk) return;
      toast(`${talk.name} đã kết thúc trò chuyện.`, 3000);
      closeTalk();
    },
    onRtc: d => voice.onSignal(d),
    onJoin(m) {
      const who = m.profile?.name?.split(/\s+/).pop() || 'ai đó';
      toast(`${who} vừa vào sân trường`, 2200);
    },
  },
});
$('bookBtn').addEventListener('click', () => (bookOpen ? closeGuestbook() : openGuestbook()));
$('bxhBtn')?.addEventListener('click', () => (boardOpen ? closeLeaderboard() : openLeaderboard()));
function closeGalleryUi() {
  galleryOpen = false;
  closeGallery();
  releaseGameFocus();
  maybeRelock();
}
$('galClose')?.addEventListener('click', closeGalleryUi);
$('galClose2')?.addEventListener('click', closeGalleryUi);
$('lbClose')?.addEventListener('click', closeLeaderboard);
$('lbClose2')?.addEventListener('click', closeLeaderboard);

function renderLeaderboard(rows) {
  const ol = $('lbList');
  if (!ol) return;
  ol.replaceChildren();
  if (!rows?.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Chưa có điểm — thu thập lưu bút khi chơi online để lên bảng.';
    ol.appendChild(li);
    return;
  }
  rows.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${i + 1}. ${escapeHtml(r.name)}</b> — ${r.pages} trang · ${r.notes} lời nhắn<small>${escapeHtml(r.info || '')}</small>`;
    ol.appendChild(li);
  });
}
async function openLeaderboard() {
  boardOpen = true;
  $('leaderboard').hidden = false;
  renderLeaderboard([]);
  try {
    const r = await fetch('/api/leaderboard');
    if (r.ok) renderLeaderboard(await r.json());
    else renderLeaderboard([]);
  } catch {
    toast('Chưa tải được BXH — chạy npm run dev', 3500);
  }
}
function closeLeaderboard() {
  boardOpen = false;
  $('leaderboard').hidden = true;
  releaseGameFocus();
  maybeRelock();
}
$('gbClose').addEventListener('click', closeGuestbook);
$('gbForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('gbInput').value.trim();
  if (!text) return;
  if (mp.note(text)) {
    $('gbInput').value = '';
    toast('Đã gửi lời nhắn lên sổ chung');
    setTimeout(pushStats, 400);
  } else toast('Chưa kết nối máy chủ — chạy npm run dev hoặc deploy Workers', 4000);
});
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  if (mp.chat(text)) {
    $('chatInput').value = '';
    const me = profile.name?.split(/\s+/).pop() || 'Bạn';
    appendNearChat(me, text, true);
    $('chatInput').focus();
  } else toast('Chưa kết nối máy chủ', 3000);
});
$('chatClose').addEventListener('click', closeChat);

// ---------- trò chuyện riêng 1-1 (mời → đồng ý) + gọi thoại ----------
let talk = null, invite = null, inviteTimer = 0, ownBubble = null, ownBubbleTimer = 0;
const remoteName = r => (r?.profile ? tagLines(r.profile)[0] : 'Bạn ấy');
function sayOwn(text) {
  if (ownBubble) player.char.root.remove(ownBubble);
  ownBubble = speechBubble(text);
  ownBubble.position.y += 0.45;
  player.char.root.add(ownBubble);
  clearTimeout(ownBubbleTimer);
  ownBubbleTimer = setTimeout(() => { player.char.root.remove(ownBubble); ownBubble = null; }, 7000);
}
function sayOwnOnRemote(m) {
  const r = mp.remotes.get(m.from);
  if (r) r.chat = { text: m.text, until: performance.now() + 7_000 };
}
function showTalkInvite(m) {
  if (talk || invite) { mp.talkAnswer(m.from, false); return; }
  exitLookLock();
  invite = m;
  $('tiText').textContent = `${m.name} (${m.info}) muốn trò chuyện với bạn.`;
  $('talkInvite').hidden = false;
  chimeSound();
  clearTimeout(inviteTimer);
  inviteTimer = setTimeout(() => answerInvite(false), 30000);
}
function answerInvite(ok) {
  if (!invite) return;
  mp.talkAnswer(invite.from, ok);
  invite = null;
  clearTimeout(inviteTimer);
  $('talkInvite').hidden = true;
  releaseGameFocus();
  if (!ok) maybeRelock();
}
$('tiYes').addEventListener('click', () => answerInvite(true));
$('tiNo').addEventListener('click', () => answerInvite(false));
function appendTalk(name, text, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  if (name) {
    const b = document.createElement('b');
    b.textContent = name + ': ';
    li.append(b, text);
  } else li.textContent = text;
  $('tpLog').appendChild(li);
  $('tpLog').scrollTop = $('tpLog').scrollHeight;
}
function startTalk(m) {
  exitLookLock();
  talk = { peer: m.peer, name: m.name };
  $('tpTitle').textContent = `Đang trò chuyện với ${m.name}`;
  $('tpLog').replaceChildren();
  appendTalk('', `${m.name} · ${m.info}. Tin nhắn chỉ hai bạn thấy.`, 'sys');
  $('talkPanel').hidden = false;
  toast(`Bắt đầu trò chuyện với ${m.name}`, 2500);
}
function closeTalk() {
  voice.reset();
  talk = null;
  $('talkPanel').hidden = true;
  $('tpRing').hidden = true;
  releaseGameFocus();
  maybeRelock();
}
$('tpForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('tpInput').value.trim();
  if (!text || !talk) return;
  if (mp.talkMsg(text)) {
    $('tpInput').value = '';
    appendTalk('Bạn', text, 'me');
  }
});
$('tpEnd').addEventListener('click', () => { mp.talkEnd(); closeTalk(); });
const voice = createVoice({
  signal: d => mp.rtc(d),
  onState(st) {
    const label = { idle: '', 'ringing-out': 'Đang gọi, chờ bạn ấy nghe…', 'ringing-in': '', connecting: 'Đang kết nối thoại…', live: '● Đang thoại', failed: 'Không kết nối được thoại' }[st];
    $('tpCallState').textContent = label;
    $('tpCall').textContent = st === 'idle' || st === 'failed' ? '📞 Gọi thoại' : '✖ Tắt thoại';
    $('tpMute').hidden = st !== 'live';
    $('tpRing').hidden = st !== 'ringing-in';
    if (st === 'ringing-in') { $('tpRingText').textContent = `${talk?.name || 'Bạn ấy'} đang gọi thoại`; chimeSound(); }
    if (st === 'failed') { toast('Không kết nối được thoại — mạng có thể đang chặn. Vẫn nhắn tin được nhé.', 4500); setTimeout(() => voice.hangup(), 1500); }
  },
});
$('tpCall').addEventListener('click', async () => {
  try {
    if (voice.state === 'idle' || voice.state === 'failed') await voice.call();
    else voice.hangup();
  } catch (e) { toast(e.message || 'Không bật được micro', 4000); }
});
$('tpAccept').addEventListener('click', async () => {
  try { await voice.accept(); } catch (e) { voice.decline(); toast(e.message || 'Không bật được micro', 4000); }
});
$('tpRefuse').addEventListener('click', () => voice.decline());
let muted = false;
$('tpMute').addEventListener('click', () => {
  muted = !muted;
  voice.setMuted(muted);
  $('tpMute').textContent = muted ? '🔇 Bật mic' : '🎤 Tắt mic';
});

// ---------- lớp học: tạo lớp, mời bạn, trò chuyện trong lớp ----------
let classUnread = 0;
const inviteLink = code => `${location.origin}${location.pathname}?lop=${encodeURIComponent(code)}`;
const fmtTime = ts => new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
function updateClassBadge() {
  $('classBadge').hidden = !classUnread;
  $('classBadge').textContent = classUnread > 9 ? '9+' : String(classUnread);
}
let clsJoinTimer = 0;
function setClsJoinStatus(text, err = false) {
  const el = $('clsJoinStatus');
  if (!el) return;
  if (!text) { el.hidden = true; el.textContent = ''; el.classList.remove('error'); return; }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('error', err);
}
function tryAutoClassJoin() {
  clearTimeout(clsJoinTimer);
  clsJoinTimer = setTimeout(() => {
    if (!mp.myId) {
      setClsJoinStatus('Chưa kết nối máy chủ — đợi chấm xanh online rồi thử lại.', true);
      return;
    }
    const name = $('clsName').value.trim().toUpperCase();
    const year = $('clsYear').value;
    if (!name || !year) {
      setClsJoinStatus('');
      return;
    }
    const code = classCodeFromParts(name, year);
    if (!code) {
      setClsJoinStatus('Lớp hoặc niên khóa chưa đúng (VD 12A12, năm 2011).', true);
      return;
    }
    if (mp.classInfo?.code === code) {
      setClsJoinStatus('Đã ở trong phòng lớp này.');
      return;
    }
    setClsJoinStatus('Đang vào lớp…');
    if (!mp.classCreate(name, year)) setClsJoinStatus('Mất kết nối — thử lại sau.', true);
  }, 450);
}
function fillClassSetup() {
  const sel = $('clsYear');
  if (!sel.options.length) {
    for (let y = new Date().getFullYear(); y >= 1961; y--) sel.add(new Option(`${y} – ${y + 3}`, y));
  }
  if (profile.className) $('clsName').value = profile.className;
  if (profile.year) sel.value = profile.year;
  $('clsOffline').hidden = !!mp.myId;
}
function showClassSetup() {
  fillClassSetup();
  $('clsSetup').hidden = false;
  $('clsRoom').hidden = true;
  tryAutoClassJoin();
}
function showClassRoom(cls, history, members) {
  $('clsSetup').hidden = true;
  $('clsRoom').hidden = false;
  $('clsTitle').textContent = `Lớp ${cls.className} · Niên khóa ${cls.year}–${+cls.year + 3}`;
  $('clsLink').value = inviteLink(cls.code);
  $('clsShare').hidden = !navigator.share;
  $('clsLog').replaceChildren();
  setClsJoinStatus('');
  if (!history.length) appendClassSys(`Phòng lớp ${cls.code}: ai chọn cùng tên lớp và niên khóa khi online sẽ tự vào đây.`);
  history.forEach(appendClassMsg);
  renderClassMembers(members);
}
function renderClassMembers(members) {
  $('clsMembers').textContent = members.length ? members.map(m => m.name).join(', ') : 'chỉ mình bạn';
}
function appendClassSys(text) {
  const li = document.createElement('li');
  li.className = 'sys';
  li.textContent = text;
  $('clsLog').appendChild(li);
}
function appendClassMsg(msg) {
  const li = document.createElement('li');
  if (msg.from && msg.from === mp.myId) li.className = 'me';
  const b = document.createElement('b'), small = document.createElement('small');
  b.textContent = msg.name;
  small.textContent = `${msg.info || ''} · ${fmtTime(msg.ts)}`;
  li.append(b, ': ', msg.text, small);
  const log = $('clsLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.appendChild(li);
  if (atBottom || li.className === 'me') log.scrollTop = log.scrollHeight;
}
function openClass() {
  exitLookLock();
  classOpen = true;
  keys.clear();
  classUnread = 0;
  updateClassBadge();
  if (mp.classInfo) {
    $('clsRoom').hidden = false;
    $('clsSetup').hidden = true;
  } else showClassSetup();
  $('classPanel').hidden = false;
  (mp.classInfo ? $('clsMsg') : $('clsName')).focus();
  $('clsLog').scrollTop = $('clsLog').scrollHeight;
}
function closeClass() {
  classOpen = false;
  $('classPanel').hidden = true;
  releaseGameFocus();
  maybeRelock();
}
$('classBtn').addEventListener('click', () => (classOpen ? closeClass() : openClass()));
$('clsClose').addEventListener('click', closeClass);
$('clsCreateForm').addEventListener('submit', e => { e.preventDefault(); tryAutoClassJoin(); });
$('clsName')?.addEventListener('input', tryAutoClassJoin);
$('clsName')?.addEventListener('change', tryAutoClassJoin);
$('clsYear')?.addEventListener('change', tryAutoClassJoin);
$('clsJoinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('clsCode').value.trim();
  if (!code) { $('clsCode').focus(); return; }
  if (!mp.classJoin(code)) toast('Chưa kết nối máy chủ', 3000);
});
$('clsMsgForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('clsMsg').value.trim();
  if (!text) return;
  if (mp.classMsg(text)) {
    $('clsMsg').value = '';
    $('clsMsg').focus();
  } else toast('Chưa kết nối máy chủ', 3000);
});
$('clsCopy').addEventListener('click', async () => {
  const link = $('clsLink').value;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    $('clsLink').select();
    document.execCommand('copy');
  }
  toast('Đã sao chép link mời — gửi cho bạn bè qua Zalo, Messenger…', 3000);
});
$('clsShare').addEventListener('click', () => {
  const c = mp.classInfo;
  navigator.share?.({ title: `Lớp ${c.className} (${c.year}–${+c.year + 3}) – THPT Vĩnh Bảo`, text: `Vào lớp ${c.className} niên khóa ${c.year}–${+c.year + 3} trên sân trường THPT Vĩnh Bảo 3D nhé!`, url: inviteLink(c.code) }).catch(() => {});
});
$('clsLeave').addEventListener('click', () => {
  mp.classLeave();
  showClassSetup();
  toast('Đã rời lớp');
});
// mở bằng link mời: hiện lời mời ở màn hình đầu
{
  const code = params.get('lop');
  if (code) {
    const note = $('inviteNote');
    note.hidden = false;
    note.textContent = `Bạn được mời vào lớp ${code.toUpperCase()}. Điền thông tin nhân vật rồi vào trường, game sẽ tự đưa bạn vào lớp.`;
    fetch(`/api/class?code=${encodeURIComponent(code.toUpperCase())}`).then(r => (r.ok ? r.json() : null)).then(c => {
      if (c?.className) note.textContent = `Bạn được mời vào lớp ${c.className} · niên khóa ${c.year}–${+c.year + 3} (lớp do ${c.createdBy} tạo, ${c.online} bạn đang online). Điền thông tin nhân vật rồi vào trường để vào lớp.`;
    }).catch(() => {});
  }
}

let current = null;
function nearest() {
  let best = null, bd = Infinity;
  for (const it of world.interact) {
    if (it.minY != null && player.feetY < it.minY) continue;
    if (it.maxY != null && player.feetY > it.maxY) continue;
    const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
    if (d < it.r && d < bd) {
      let label = it.label;
      if (it.action === 'bikeToggle') label = player.onBike ? 'Trả xe đạp (E)' : 'Lấy xe đạp (E)';
      best = { ...it, label };
      bd = d;
    }
  }
  for (const d of world.classroomDoors || []) {
    const expectY = (d.floor - 1) * 3.6 + 0.3;
    if (Math.abs(player.feetY - expectY) > 1.05) continue;
    const dist = Math.hypot(d.ix - player.pos.x, d.iz - player.pos.z);
    if (dist < 1.7 && dist - 0.6 < bd) {
      best = {
        label: d.open ? `Đóng cửa lớp ${d.className} (E)` : `Mở cửa lớp ${d.className} (E)`,
        action: 'classroom-door',
        doorId: d.id,
      };
      bd = dist - 0.6;
    }
  }
  for (const n of npcs) {
    const d = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
    const near = n.vendor ? 2.35 : 2.2;
    if (d < near && d - (n.vendor ? 0.75 : 1) < bd) {
      best = { label: n.vendor ? `Mua / trò chuyện — ${n.name}` : `Trò chuyện với ${n.name}`, npc: n };
      bd = d - (n.vendor ? 0.75 : 1);
    }
  }
  if (!talk) for (const r of mp.remotes.values()) {
    const d = Math.hypot(r.pos.x - player.pos.x, r.pos.z - player.pos.z);
    if (r.seeded && d < 2.8 && d - 1.2 < bd) { best = { label: `Mời ${remoteName(r)} trò chuyện`, remote: r }; bd = d - 1.2; }
  }
  return best;
}

// Lời chào chung cho mọi người chơi (không dùng thông tin cá nhân).
function greeting(n) {
  if (n.greet) return n.greet;
  return n.teacher
    ? 'Chào em! Về thăm trường đấy à? Nhớ ghé qua lớp cũ nhé.'
    : 'Chào bạn! Về thăm trường à? Lâu lắm mới gặp!';
}

function use() {
  unlockAudio();
  if (bookOpen) { closeGuestbook(); return; }
  if (boardOpen) { closeLeaderboard(); return; }
  if (galleryOpen) { closeGalleryUi(); return; }
  if (dialogOpen) { closeDialog(); return; }
  if (!current) return;
  if (current.action === 'classroom-door') {
    const opened = toggleClassroomDoor(world, current.doorId);
    toast(opened ? 'Cửa đã mở — bước vào lớp!' : 'Đã đóng cửa lớp.', 2400);
    return;
  }
  if (current.remote) {
    if (mp.talkRequest(current.remote.id)) toast(`Đã gửi lời mời tới ${remoteName(current.remote)}, chờ bạn ấy đồng ý…`, 3500);
    else toast('Chưa kết nối máy chủ', 3000);
    return;
  }
  if (current.action === 'bikeToggle') {
    toggleBikeAtShed();
    return;
  }
  if (current.action === 'drum') {
    drumSound();
    toast('Tùng! Tùng! Tùng! — Vào lớp thôi các bạn ơi!');
    for (const n of npcs) if (!n.static) { n.bellT = 14; n.mode = 'class'; n.target = pickTarget(n); n.wait = 0; }
    mp.act('drum');
    return;
  }
  if (current.action === 'keng') {
    kengSound();
    toast('Keng! Keng! Keng! — Ra chơi rồi!');
    for (const n of npcs) if (!n.static) { n.bellT = 12; n.mode = 'play'; n.target = pickTarget(n); n.wait = 0; }
    mp.act('keng');
    return;
  }
  if (current.action === 'gallery') {
    openGallery(current.image, current.title, current.text);
    galleryOpen = true;
    return;
  }
  if (current.npc) {
    const n = current.npc;
    n.talkT = 4;
    const line = n.greeted ? n.lines[n.lineIdx++ % n.lines.length] : greeting(n);
    n.greeted = true;
    const text = n.vendor && n.menu?.length
      ? `${line}\n\n— Bảng giá —\n${n.menu.join('\n')}\n\n(Ẩm thực ảo — chúc bạn ngon miệng khi về thăm trường!)`
      : line;
    npcSay(n, line);
    showDialog(n.name, text, n.vendor ? 'Quán vỉa hè · trước cổng' : 'Trò chuyện');
    if (n.vendor) {
      unlockAudio();
      chimeSound();
      toast('Món ăn chỉ lưu ký ức trong game — không tính tiền thật nhé!', 3800);
    }
    return;
  }
  if (current.title) showDialog(current.title, current.text, 'Khám phá');
}

// ---------- minimap ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
const MAP = { minX: -72, maxX: 72, minZ: -48, maxZ: 64 };
function mapXY(x, z) {
  const s = Math.min(mm.width / (MAP.maxX - MAP.minX), mm.height / (MAP.maxZ - MAP.minZ));
  return [(x - MAP.minX) * s + (mm.width - (MAP.maxX - MAP.minX) * s) / 2, (z - MAP.minZ) * s + (mm.height - (MAP.maxZ - MAP.minZ) * s) / 2, s];
}
function rect(r, color) {
  const [x0, y0] = mapXY(r.minX, r.minZ), [x1, y1] = mapXY(r.maxX, r.maxZ);
  mctx.fillStyle = color;
  mctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
function drawMap() {
  mctx.fillStyle = '#5f8f45';
  mctx.fillRect(0, 0, mm.width, mm.height);
  rect({ minX: -62, maxX: 62, minZ: -44, maxZ: 36 }, '#d4a293');
  rect({ minX: -100, maxX: 100, minZ: 40, maxZ: 48 }, '#55595f');
  rect({ minX: -100, maxX: 100, minZ: 36.3, maxZ: 40 }, '#a8584a');
  rect({ minX: -100, maxX: 100, minZ: 48, maxZ: 53 }, '#bdb9b0');
  const colors = { field: '#5aa944', stand: '#e0b546', building: '#f2d98c', stage: '#7a4a2a', shed: '#4b7eb3', gate: '#f3cf55' };
  for (const r of world.rects) rect(r, colors[r.kind] || '#ccc');
  mctx.strokeStyle = '#f3cf55';
  mctx.lineWidth = 1.5;
  const [a, b] = mapXY(-62, -44), [c, d] = mapXY(62, 36);
  mctx.strokeRect(a, b, c - a, d - b);
  for (const it of world.collectibles) {
    if (it.taken) continue;
    const [x, y] = mapXY(it.x, it.z);
    mctx.fillStyle = '#ffe14d';
    mctx.beginPath();
    mctx.arc(x, y, 3, 0, Math.PI * 2);
    mctx.fill();
  }
  const [px, py] = mapXY(player.pos.x, player.pos.z);
  mctx.save();
  mctx.translate(px, py);
  mctx.rotate(-player.facing + Math.PI);
  mctx.fillStyle = '#e53935';
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 1.5;
  mctx.beginPath();
  mctx.moveTo(0, -7);
  mctx.lineTo(5, 5);
  mctx.lineTo(-5, 5);
  mctx.closePath();
  mctx.fill();
  mctx.stroke();
  mctx.restore();
  for (const r of mp.remotes.values()) {
    if (!r.seeded) continue;
    const [rx, ry] = mapXY(r.pos.x, r.pos.z);
    mctx.fillStyle = '#1565c0';
    mctx.beginPath();
    mctx.arc(rx, ry, 3, 0, Math.PI * 2);
    mctx.fill();
  }
}

// ---------- loop ----------
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const tmp = new THREE.Vector3();

// Thang sắt: đứng sát thang + W (hoặc S khi ở trên mái) để bám; khi bám thì W/S leo, thả phím vẫn bám,
// lên tới đỉnh tự bước ra mái, xuống tới chân tự đứng lên chiếu nghỉ, Nhảy (Space) để buông tay.
function climbLadder(dt, ox, oz) {
  const p = player.pos;
  const up = keys.has('KeyW') || keys.has('ArrowUp') || joy.y < -0.3;
  const dn = keys.has('KeyS') || keys.has('ArrowDown') || joy.y > 0.3;
  const blocked = dialogOpen || menuOpen || bookOpen || chatOpen || classOpen || !started;
  if (!player.ladder && !blocked && performance.now() >= (player.ladderLockUntil || 0)) {
    for (const ld of world.ladders || []) {
      const dHang = Math.hypot(ox - ld.x, oz - ld.z);
      const dBot = ld.bottom ? Math.hypot(ox - ld.bottom.x, oz - ld.bottom.z) : dHang;
      const atBottom = Math.abs(player.feetY - ld.y0) < 0.55 && up && Math.min(dHang, dBot) < 0.95;
      // trên mái: bước tới sát lỗ chui là tự bám thang (không rơi tụt xuống)
      const atTop = player.feetY > ld.y1 - 1.2 && player.feetY < ld.y1 + 0.5 && dHang < 0.8;
      if (atBottom || atTop) {
        player.ladder = ld;
        player.feetY = atTop ? ld.y1 - 0.3 : ld.y0 + 0.05;
        if (player.pose) clearPlayerPose();
        break;
      }
    }
  }
  const ld = player.ladder;
  if (!ld) return false;
  player.vel.set(0, 0, 0);
  player.vy = 0;
  p.x += (ld.x - p.x) * Math.min(1, dt * 14);
  p.z += (ld.z - p.z) * Math.min(1, dt * 14);
  player.facing = ld.face;
  const dir = blocked ? 0 : (up ? 1 : 0) - (dn ? 1 : 0);
  player.feetY += dir * 2.8 * dt;
  const jump = jumpQueued || performance.now() < jumpQueuedUntil;
  jumpQueued = false;
  const dismount = (x, z, grounded) => {
    p.x = x;
    p.z = z;
    player.ladder = null;
    player.grounded = grounded;
    player.ladderLockUntil = performance.now() + 700; // không bám lại ngay sau khi vừa rời thang
  };
  if (player.feetY >= ld.y1) {
    // ra khỏi lỗ mái, đứng lên sàn mái
    player.feetY = ld.y1;
    dismount(ld.top.x, ld.top.z, true);
  } else if (player.feetY <= ld.y0) {
    player.feetY = ld.y0;
    dismount(ld.bottom.x, ld.bottom.z, true);
  } else if (jump) {
    jumpQueuedUntil = 0;
    dismount(ld.bottom.x, ld.bottom.z, false);
  }
  player.char.root.position.set(p.x, player.feetY, p.z);
  player.char.root.rotation.y = player.facing;
  player.char.update(dt, dir ? 2.2 : 0, false, 0, null);
  return !!player.ladder || player.grounded;
}

function updatePlayer(dt) {
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  ix += joy.x;
  iz -= joy.y;
  const l = Math.hypot(ix, iz);
  if (l > 1) { ix /= l; iz /= l; }
  if (dialogOpen || menuOpen || bookOpen || chatOpen || classOpen || !started) ix = iz = 0;
  const wantMove = Math.hypot(ix, iz) > 0.08;
  if (player.pose && wantMove) clearPlayerPose();
  if (player.pose === 'sit' || player.pose === 'lie') ix = iz = 0;
  if (player.onBike && player.pose) clearPlayerPose();
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(joy.x, joy.y) > 0.95;
  const sp = player.onBike ? (run ? 11 : 7.2) : (run ? 6.5 : 3.3);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const wx = (rx * ix + fx * iz) * sp, wz = (rz * ix + fz * iz) * sp;
  const k = Math.min(1, dt * (player.grounded ? 10 : 3));
  player.vel.x += (wx - player.vel.x) * k;
  player.vel.z += (wz - player.vel.z) * k;

  const p = player.pos, ox = p.x, oz = p.z;
  p.x += player.vel.x * dt;
  p.z += player.vel.z * dt;
  col.resolve(p, player.feetY, 0.32);

  // ---- thang sắt: bám / leo / ra mái ----
  if (player.onBike && (keys.has('Space') || performance.now() < jumpQueuedUntil)) {
    jumpQueuedUntil = 0;
    jumpQueued = false;
  }
  if (climbLadder(dt, ox, oz)) {
    if (player.onBike) dismountBike(player, scene, player.char.root, player.feetY, player.facing);
    return;
  }
  const g = col.groundAt(p.x, p.z, player.feetY);
  const wantJump = !player.onBike && (jumpQueued || performance.now() < jumpQueuedUntil);
  if (wantJump && player.pose) clearPlayerPose();
  if (wantJump && player.grounded && !dialogOpen && started && !player.pose) { player.vy = 6.2; player.grounded = false; jumpQueuedUntil = 0; }
  jumpQueued = false;
  player.vy -= 17.5 * dt;
  player.feetY += player.vy * dt;
  if (player.feetY <= g) { player.feetY = g; player.vy = 0; player.grounded = true; }
  else player.grounded = player.feetY - g < 0.05;
  const moved = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-4);
  if (moved > 0.3) player.facing = angLerp(player.facing, Math.atan2(player.vel.x, player.vel.z), Math.min(1, dt * 12));
  const visY = player.pose && POSE_VISUAL_DROP[player.pose]
    ? Math.max(g, player.feetY - POSE_VISUAL_DROP[player.pose])
    : player.feetY;
  if (player.onBike) {
    syncBikeVisual(player, g, dt, moved);
  } else {
    player.char.root.position.set(p.x, visY, p.z);
    player.char.root.rotation.y = player.facing;
  }
  const airborne = !player.onBike && !player.pose && player.feetY - g > 0.08;
  if (playerClapT > 0) playerClapT = Math.max(0, playerClapT - dt);
  const animPose = playerClapT > 0 ? 'clap' : (player.onBike ? 'bike' : player.pose);
  const animSpeed = animPose === 'dance' ? 2.2 : animPose === 'clap' ? 1.1 : animPose === 'bike' ? Math.max(moved, 0.35) : moved;
  player.char.update(dt, animSpeed, airborne && !animPose, player.vy, animPose);
}

// bong bóng lời nói trên đầu NPC
function npcSay(n, text, ms = 5500) {
  if (n.bubble) n.char.root.remove(n.bubble);
  n.bubble = speechBubble(text);
  n.char.root.add(n.bubble);
  n.bubbleUntil = performance.now() + ms;
  n.talkT = Math.max(n.talkT, 3);
}
// thầy Thanh nhắc học sinh khi đi qua cổng
let gateSaidAt = -1e9;
function gateWatch() {
  const t = npcs.find(n => n.gateWatch), guard = npcs.find(n => n.staff);
  if (!t || !started) return;
  const now = performance.now();
  if (Math.hypot(player.pos.x, player.pos.z - 34) < 4.5 && now - gateSaidAt > 25000) {
    gateSaidAt = now;
    npcSay(t, t.lines[0]);
    toast(`Thầy Thanh: ${t.lines[0]}`, 3000);
    if (guard) setTimeout(() => {
      npcSay(guard, guard.lines[0]);
      toast(`Bác bảo vệ: ${guard.lines[0]}`, 3500);
    }, 3000);
  }
}

function updateNPCs(dt) {
  for (const n of npcs) {
    let speed = 0;
    const toP = Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z);
    if (n.bellT > 0) n.bellT -= dt;
    if (n.talkT > 0) {
      n.talkT -= dt;
      n.facing = angLerp(n.facing, toP, Math.min(1, dt * 8));
    } else if (n.static) {
      n.facing = angLerp(n.facing, n.face, Math.min(1, dt * 3));
    } else if (n.wait > 0) {
      n.wait -= dt;
    } else if (n.mode === 'ceremony' && n.target) {
      tmp.subVectors(n.target, n.pos).setY(0);
      const d = tmp.length();
      if (d > 0.55) {
        const v = 2.3;
        const ox = n.pos.x, oz = n.pos.z;
        n.pos.addScaledVector(tmp.normalize(), v * dt);
        col.resolve(n.pos, n.feetY, 0.3);
        const pd = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
        if (pd < 0.65) { n.pos.x = ox; n.pos.z = oz; }
        speed = Math.hypot(n.pos.x - ox, n.pos.z - oz) / dt;
        n.facing = angLerp(n.facing, Math.atan2(tmp.x, tmp.z), Math.min(1, dt * 8));
      } else {
        n.facing = angLerp(n.facing, toP, Math.min(1, dt * 4));
      }
    } else {
      n.target ??= pickTarget(n);
      tmp.subVectors(n.target, n.pos).setY(0);
      const d = tmp.length();
      if (d < 0.5) {
        n.target = null;
        n.wait = n.bellT > 0 && n.mode === 'class' ? 6 : n.bellT > 0 ? 0.3 : 2 + Math.random() * 5;
      } else {
        const v = n.gatePatrol ? 1.05 : n.bellT > 0 ? 2.6 : 1.3;
        const ox = n.pos.x, oz = n.pos.z;
        n.pos.addScaledVector(tmp.normalize(), v * dt);
        col.resolve(n.pos, n.feetY, 0.3);
        const pd = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
        if (pd < 0.65) { n.pos.x = ox; n.pos.z = oz; }
        speed = Math.hypot(n.pos.x - ox, n.pos.z - oz) / dt;
        if (speed < v * 0.3) n.stuck += dt; else n.stuck = 0;
        if (n.stuck > 1.2) { n.target = null; n.stuck = 0; n.wait = 0.5; }
        n.facing = angLerp(n.facing, Math.atan2(tmp.x, tmp.z), Math.min(1, dt * 8));
      }
    }
    if (n.clapT > 0) n.clapT = Math.max(0, n.clapT - dt);
    n.feetY = col.groundAt(n.pos.x, n.pos.z, n.feetY);
    n.char.root.position.set(n.pos.x, n.feetY, n.pos.z);
    n.char.root.rotation.y = n.facing;
    const nPose = n.clapT > 0 ? 'clap' : null;
    n.char.update(dt, nPose ? 1.1 : speed, false, 0, nPose);
    if (n.bubble && performance.now() > n.bubbleUntil) { n.char.root.remove(n.bubble); n.bubble = null; }
  }
}

function updateCollectibles(t, dt) {
  world.collectibles.forEach((c, i) => {
    if (c.taken) return;
    c.group.rotation.y += dt * 1.6;
    c.group.position.y = c.baseY + Math.sin(t * 2.2 + i) * 0.12;
    const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
    if (d < 1.1 && Math.abs(player.feetY - (c.baseY - 0.9)) < 1.3) {
      c.taken = true;
      c.group.visible = false;
      collected++;
      $('count').textContent = collected;
      chimeSound();
      const done = collected === TOTAL
        ? `\n\n🎉 Bạn đã tìm đủ ${TOTAL} trang lưu bút! Cảm ơn bạn đã về thăm mái trường THPT Vĩnh Bảo.`
        : '';
      showDialog(c.title, c.text + done, `Trang lưu bút ${collected}/${TOTAL}`);
      pushStats();
    }
  });
}

function updateCamera(dt) {
  const target = tmp.set(player.pos.x, player.feetY + 1.45, player.pos.z);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const hit = Math.max(0.8, col.rayDist(target, dir, dist) - 0.3);
  camD += (hit - camD) * Math.min(1, dt * (hit < camD ? 25 : 4));
  camera.position.copy(target).addScaledVector(dir, camD);
  camera.position.y = Math.max(0.35, camera.position.y);
  camera.lookAt(target);
}

const SHOTS = {
  gate: [[0, 3.2, 52], [0, 4, 30]],
  yard: [[-24, 9, 30], [6, 4, -12]],
  aerial: [[70, 70, 95], [0, 0, 5]],
  building: [[14, 4.5, -2], [0, 6, -20]],
  stage: [[6, 4.5, 12], [0, 3, -10]],
  keng: [[-20, 3.2, 20], [-26, 2, 12]],
  gateclose: [[-3, 3, 47], [0, 5.5, 36]],
  gatein: [[3, 2.5, 24], [0, 4.5, 36]],
  front: [[-12, 4, 33], [0, 4, 10]],
  inner: [[18, 6, 5], [-6, 3, -12]],
  garden: [[-14, 4, 4], [-28, 3, -3]],
};

// ?cam=x,y,z,tx,ty,tz — camera cố định để chụp màn hình kiểm tra
const CAM = (() => { const c = params.get('cam')?.split(',').map(Number); return c?.length === 6 ? [c.slice(0, 3), c.slice(3)] : null; })();
const clock = new THREE.Clock();
let mapTick = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  updatePlayer(dt);
  updateNPCs(dt);
  gateWatch();
  updateCollectibles(t, dt);
  tickSoccer(world, col, player, dt);
  if (started) {
    tickFlagCeremony({ player, npcs, toast, drumSound, mp }, dt);
    try { mp.tick(dt); } catch (e) { console.error(e); }
  }
  for (const u of world.updaters) u(t);
  const shot = SHOTS[params.get('shot')] || CAM;
  if (shot) {
    camera.position.set(...shot[0]);
    camera.lookAt(...shot[1]);
  } else updateCamera(dt);

  const sx = Math.round(player.pos.x / 4) * 4, sz = Math.round(player.pos.z / 4) * 4;
  sun.target.position.set(shot ? 0 : sx, 0, shot ? 5 : sz);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
  sky.position.copy(camera.position);
  clouds.position.set(camera.position.x, 0, camera.position.z);
  clouds.rotation.y = t * 0.004;

  if (!$('intro').hidden) profileForm.tick(dt);
  if (started) {
    current = nearest();
    if (current) $('promptText').textContent = current.label;
    $('prompt').hidden = !current || dialogOpen || galleryOpen || boardOpen;
    if ((mapTick += dt) > 0.1 && mapOn) { mapTick = 0; drawMap(); }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function start() {
  started = true;
  $('intro').hidden = true;
  document.body.classList.add('playing');
  bookOpen = false;
  chatOpen = false;
  classOpen = false;
  menuOpen = false;
  $('guestbook').hidden = true;
  $('classPanel').hidden = true;
  $('chatBar').hidden = true;
  releaseGameFocus();
  toast(`Chào mừng bạn về trường! Tìm ${TOTAL} kỷ vật đang phát sáng, sút bóng & xem album ảnh thật nhé.`, 5200);
  pushStats();
  if (isTouchPlay()) {
    lockLandscape();
    syncOrientationUi();
    setTimeout(() => toast('Chơi ngang: joystick trái · kéo nửa phải xoay camera · hai ngón zoom.', 5200), 1200);
  } else {
    setTimeout(() => toast('Chuột xoay góc nhìn · giữ Ctrl hiện chuột · Esc thả chuột · popup (E) không cần chuột.', 5200), 1200);
    requestLookLock();
  }
  mp.connect();
  canvas.focus?.();
}

const profileForm = setupProfileForm({
  onSubmit(p) {
    unlockAudio();
    applyProfile(p);
    if (!started) start();
    else {
      menuOpen = false;
      $('intro').hidden = true;
      $('intro').classList.remove('ingame');
      toast('Đã cập nhật nhân vật.');
      maybeRelock();
    }
  },
});
const showStep = step => {
  $('stepWelcome').hidden = step !== 1;
  $('stepProfile').hidden = step !== 2;
};
function refreshResumeWelcome() {
  const saved = loadProfile();
  const show = isProfileComplete(saved) && !params.has('new');
  const block = $('resumeBlock');
  if (!block) return;
  if (show) {
    const [line1, line2] = tagLines(saved);
    $('resumeHello').textContent = `Chơi tiếp với nhân vật đã lưu: ${line1}${line2 ? ` · ${line2}` : ''}`;
    block.hidden = false;
  } else {
    block.hidden = true;
  }
}
$('resumeBtn')?.addEventListener('click', () => {
  unlockAudio();
  const saved = loadProfile();
  if (!isProfileComplete(saved)) { showStep(2); return; }
  applyProfile(saved);
  start();
});
$('newCharBtn')?.addEventListener('click', () => {
  unlockAudio();
  $('resumeBlock').hidden = true;
  showStep(2);
  profileForm.open();
  $('pfName').focus();
});
$('nextBtn').addEventListener('click', () => { unlockAudio(); showStep(2); $('pfName').focus(); });
$('backBtn').addEventListener('click', () => { showStep(1); refreshResumeWelcome(); });
refreshResumeWelcome();
$('profileBtn').addEventListener('click', () => {
  exitLookLock();
  menuOpen = true;
  keys.clear();
  profileForm.open();
  $('pfEyebrow').textContent = 'Đổi nhân vật';
  $('startBtn').textContent = 'Lưu & tiếp tục';
  $('intro').classList.add('ingame');
  showStep(2);
  $('intro').hidden = false;
});
addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (chatOpen) { closeChat(); return; }
  if (classOpen) { closeClass(); return; }
  if (bookOpen) { closeGuestbook(); return; }
  if (galleryOpen) { closeGalleryUi(); return; }
  if (boardOpen) { closeLeaderboard(); return; }
  if (menuOpen) {
    menuOpen = false;
    $('intro').hidden = true;
    $('intro').classList.remove('ingame');
    maybeRelock();
  }
});

applyProfile(profile);
window.game = { player, npcs, world, keys, mp, get profile() { return profile; } };
if (params.has('start') || params.has('shot')) start();
frame();
