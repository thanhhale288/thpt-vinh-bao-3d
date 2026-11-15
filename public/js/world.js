// Dựng toàn bộ khuôn viên bằng code (không dùng file mô hình). /* build 20251113s */
// Toạ độ: +z hướng ra đường Nguyễn Bỉnh Khiêm (cổng trường), đơn vị mét.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';
import {
  installClassroomSystem,
  isClassRoomCode,
  ensureClassroomShell,
  furnishClassroom,
  installClassroomDoor,
  registerClassroomMeta,
} from './classroom.js';
import { installYardPlay } from './yardPlay.js';

const FH = 3.6; // chiều cao một tầng

const matCache = new Map();
function M(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}

function texMat(map, opts = {}) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...opts });
}

function xform(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// Gom các khối cùng vật liệu thành một mesh để giảm draw call.
class Batch {
  constructor() {
    this.groups = new Map();
  }
  add(mat, geom, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
  }
  flush(parent) {
    for (const [mat, list] of this.groups) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.castShadow = !mat.userData.noShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      list.forEach(g => g.dispose());
    }
    this.groups.clear();
  }
}

// Hệ toạ độ cục bộ của một công trình (xoay quanh trục Y).
class Frame {
  constructor(x, z, ry = 0) {
    this.m = xform(x, 0, z, ry);
  }
  at(x, y, z, ry = 0, rx = 0, rz = 0) {
    return this.m.clone().multiply(xform(x, y, z, ry, rx, rz));
  }
  rect(minX, maxX, minZ, maxZ) {
    const pts = [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(this.m));
    return {
      minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
      minZ: Math.min(...pts.map(p => p.z)), maxZ: Math.max(...pts.map(p => p.z)),
    };
  }
}

const WORLD = new Frame(0, 0, 0);
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cbox: new THREE.BoxGeometry(1, 1, 1),
  ico: new THREE.IcosahedronGeometry(1, 1),
  pyramid: new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  wheel: new THREE.TorusGeometry(0.32, 0.03, 6, 18),
};

export function buildWorld(scene) {
  const W = {
    colliders: [],
    interact: [],
    collectibles: [],
    rects: [],
    updaters: [],
    classroomDoors: [],
    classroomRooms: [],
    ladders: [],
  };
  const batch = new Batch();
  const root = new THREE.Group();
  scene.add(root);

  const tex = {
    yard: T.terrazzoTexture(),
    granite: T.graniteTexture(),
    sidewalk: T.tileTexture('#a8584a', '#6f6a63', 6, 3),
    floor: T.tileTexture('#d8cfbf', '#a59d90', 4, 9),
    grass: T.grassTexture(),
    asphalt: T.asphaltTexture(),
    facade: T.facadeTexture(true),
    facadeBack: T.facadeTexture(false),
    balustrade: T.balustradeTexture(),
    fence: T.fencePanelTexture(),
    house: T.houseFacadeTexture(),
    breezeStair: T.breezeBlockStairTexture(),
  };

  const mats = {
    wall: M(0xf2d98c),
    trim: M(0xa8452f),
    yellowTrim: M(0xe2b955),
    column: M(0xfbf4df),
    gateYellow: M(0xf3cf55),
    darkRed: M(0x8e2a22),
    tileRoof: M(0xb5462e),
    white: M(0xf6f3ea),
    grey: M(0x9b9b96),
    dark: M(0x2b2b2b),
    wood: M(0x7a4a2a),
    trunk: M(0x7d6048),
    palmTrunk: M(0xb7b0a2),
    leaf: M(0x3f7d2c, { flatShading: true }),
    leafDark: M(0x2f6a25, { flatShading: true }),
    palmLeaf: M(0x4f8f2f, { flatShading: true }),
    flower: M(0xe23d22, { flatShading: true }),
    flower2: M(0xf0662a, { flatShading: true }),
    bush: M(0x3d8a35, { flatShading: true }),
    soil: M(0x6b4a33),
    shedRoof: M(0x4b7eb3, { side: THREE.DoubleSide }),
    pole: M(0xdedede, { metalness: 0.6, roughness: 0.35 }),
    floorTile: texMat(tex.floor),
    yard: texMat(tex.yard),
    sidewalk: texMat(tex.sidewalk),
    asphalt: texMat(tex.asphalt, { roughness: 0.95 }),
    facade: texMat(tex.facade),
    facadeBack: texMat(tex.facadeBack),
    balustrade: texMat(tex.balustrade, { alphaTest: 0.5, side: THREE.DoubleSide }),
    fence: texMat(tex.fence),
    house: texMat(tex.house, { alphaTest: 0.5 }),
    breezeStair: texMat(tex.breezeStair, { transparent: true, alphaTest: 0.42, side: THREE.DoubleSide }),
    stairWall: M(0xecd178, { roughness: 0.9 }),
    stairParapet: M(0xd8cfbf, { roughness: 0.88 }),
    stairRiser: M(0xd8cfbf),
  };

  // ---------- helpers ----------
  function addCollider(F, minX, maxX, minZ, maxZ, top, bottom = 0, noCam = false) {
    W.colliders.push({ ...F.rect(minX, maxX, minZ, maxZ), top, bottom, noCam });
  }
  // Hộp có đáy tại y (không phải tâm). collide=true → thêm vật cản.
  function box(mat, F, w, h, d, x, y, z, { ry = 0, collide = false } = {}) {
    batch.add(mat, GEO.box, F.at(x, y, z, ry).multiply(new THREE.Matrix4().makeScale(w, h, d)));
    if (collide) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      addCollider(F, x - hw, x + hw, z - hd, z + hd, y + h, y);
    }
  }
  function cyl(mat, F, r, h, x, y, z, rTopScale = 1) {
    const g = new THREE.CylinderGeometry(r * rTopScale, r, h, 10).translate(0, h / 2, 0);
    batch.add(mat, g, F.at(x, y, z));
  }
  function blob(mat, F, x, y, z, sx, sy, sz) {
    batch.add(mat, GEO.ico, F.at(x, y, z).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)));
  }
  function plane(mat, F, w, h, x, y, z, ry = 0, su = 1, sv = 1) {
    const g = uvScale(new THREE.PlaneGeometry(w, h), su, sv);
    batch.add(mat, g, F.at(x, y, z, ry));
  }
  // Mặt phẳng riêng (không gộp) — dùng cho biển chữ có texture riêng.
  function sign(texture, w, h, x, y, z, ry = 0, doubleSided = false) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), texMat(texture, { side: doubleSided ? THREE.DoubleSide : THREE.FrontSide }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    root.add(m);
    return m;
  }
  function ground(mat, x, z, w, d, y, tileSize) {
    const g = uvScale(new THREE.PlaneGeometry(w, d), w / tileSize, d / tileSize);
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  }
  function archPanel(mat, F, w, h, x, y, z) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-w / 2, h);
    s.lineTo(w / 2, h);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2 - 0.12, 0);
    s.absellipse(0, 0, w / 2 - 0.12, h - 0.18, 0, Math.PI, false);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false, curveSegments: 14 });
    batch.add(mat, g, F.at(x, y, z));
  }

  // ---------- mặt đất, sân, đường ----------
  ground(texMat(tex.grass, { roughness: 1 }), 0, 30, 520, 520, -0.06, 4);
  // toàn bộ sân trong tường rào lát gạch terrazzo hồng
  ground(mats.yard, 0, -4, 124, 80, 0.015, 0.8);
  ground(mats.sidewalk, 0, 38.15, 300, 3.7, 0.03, 0.9);
  ground(mats.asphalt, 0, 44, 300, 8, 0.02, 6);
  ground(texMat(T.tileTexture('#bdb9b0', '#9d988f', 4, 5)), 0, 50.5, 300, 5, 0.03, 0.7);

  // ---------- dãy nhà học ----------
  function roomPlate(F, name, lx, ly, lz, bw) {
    if (!name) return;
    const code = String(name).toUpperCase().replace(/\s/g, '');
    const isClass = isClassRoomCode(code);
    const label = isClass ? `LỚP ${code}` : String(name).toUpperCase();
    const tex = T.signTexture(label, {
      w: 800, h: 200, bg: isClass ? '#1f4fa0' : '#2e6b3a', fg: '#ffffff', border: '#ffffff', size: isClass ? 88 : 50,
    });
    const pw = Math.min(1.65, bw * 0.42);
    const ph = pw * (200 / 800);
    const mat = texMat(tex, { side: THREE.DoubleSide });
    mat.depthWrite = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
    mesh.applyMatrix4(F.at(lx, ly, lz));
    mesh.renderOrder = 4;
    mesh.receiveShadow = false;
    root.add(mesh);
  }
  function buildBlock(o) {
    const F = new Frame(o.x, o.z, o.ry);
    const { L, D, floors } = o;
    const H = floors * FH, C = 2.4;
    const bays = Math.max(2, Math.round(L / 4)), bw = L / bays;
    const front = D / 2, roomFront = D / 2 - C;
    const stairPink = mats.yard;
    const stairTrim = mats.floorTile;
    const trim = o.trim || mats.trim, colMat = o.columns || mats.column, solid = o.parapet === 'solid';
    const wallMat = o.wall || mats.wall;
    const facadeMat = o.facade || mats.facade;
    const facadeBack = o.facadeBack || mats.facadeBack;

    // khối phòng học, chừa các gian sảnh cầu thang (o.halls: toạ độ x mép trái của gian)
    const halls = o.halls || [], roomSlots = [];
    let segStart = -L / 2;
    for (const edge of [...halls.slice().sort((a, b) => a - b), L / 2]) {
      const a = segStart, b = edge;
      if (b - a > 0.01) {
        const nBays = Math.round((b - a) / bw);
        const roomBase = roomSlots.length;
        plane(facadeMat, F, b - a, H, (a + b) / 2, H / 2, roomFront + 0.01, 0, (b - a) / bw, floors);
        for (let k = 0; k < nBays; k += 2) roomSlots.push(a + k * bw);
        for (let bi = 0; bi < nBays; bi++) {
          const xc = a + (bi + 0.5) * bw;
          const roomIdx = roomBase + bi / 2;
          const isClassBay = bi % 2 === 0 && (o.rooms || []).some(names => isClassRoomCode(names?.[roomIdx]));
          box(wallMat, F, bw, H, D - C, xc, 0, -C / 2, { collide: !isClassBay });
        }
      }
      segStart = edge + bw;
    }
    plane(facadeBack, F, L, H, 0, H / 2, -D / 2 - 0.01, Math.PI, bays, floors);
    // nền hành lang tầng 1
    box(mats.floorTile, F, L + 0.4, 0.3, C + 0.2, 0, 0, front - C / 2 + 0.1, { collide: true });
    // sàn các tầng + mái
    for (let f = 1; f < floors; f++) box(trim, F, L + 0.3, 0.32, C + 0.15, 0, f * FH - 0.32, front - C / 2 + 0.075);
    box(trim, F, L + 0.6, 0.35, D + 0.5, 0, H, 0);
    const hatches = []; // lỗ mái phía trên thang sắt (toạ độ cục bộ)
    box(wallMat, F, L + 0.6, 0.9, 0.2, 0, H + 0.35, D / 2 + 0.15);
    box(wallMat, F, L + 0.6, 0.9, 0.2, 0, H + 0.35, -D / 2 - 0.15);
    for (const s of [-1, 1]) box(wallMat, F, 0.2, 0.9, D + 0.5, s * (L / 2 + 0.2), H + 0.35, 0);
    box(trim, F, L + 0.75, 0.12, 0.34, 0, H + 1.25, D / 2 + 0.15);
    // cột hành lang
    for (let i = 0; i <= bays; i++) {
      const x = -L / 2 + i * bw;
      box(colMat, F, 0.42, H, 0.42, x, 0, front - 0.21, { collide: true });
    }
    for (let i = 0; i < bays; i++) {
      const xc = -L / 2 + (i + 0.5) * bw, w = bw - 0.42;
      for (let f = 1; f < floors; f++) {
        if (solid) {
          // lan can xây đặc + tay vịn sắt mảnh
          box(wallMat, F, w, 0.8, 0.14, xc, f * FH, front - 0.18);
          box(mats.grey, F, w, 0.04, 0.05, xc, f * FH + 1.05, front - 0.18);
          for (let k = 1; k < 4; k++) box(mats.grey, F, 0.03, 0.25, 0.03, xc - w / 2 + (k * w) / 4, f * FH + 0.8, front - 0.18);
        } else {
          plane(mats.balustrade, F, w, 0.95, xc, f * FH + 0.475, front - 0.18, 0, w / 0.9, 1);
          box(mats.column, F, bw, 0.08, 0.22, xc, f * FH + 0.95, front - 0.18);
        }
      }
      if (o.arches !== false) archPanel(wallMat, F, w, 1.3, xc, H - 1.3, front - 0.24);
    }
    // sàn hành lang các tầng trên + lan can: đi lại được trên tầng (va chạm có đáy)
    for (let f = 1; f < floors; f++) {
      addCollider(F, -L / 2 - 0.15, L / 2 + 0.15, roomFront - 0.05, front + 0.15, f * FH, f * FH - 0.32);
      addCollider(F, -L / 2, L / 2, front - 0.3, front - 0.05, f * FH + 1.05, f * FH, true);
    }
    // cầu thang ở một đầu nhà: hai đợt, chiếu nghỉ giữa tầng phía sau, chiếu tới phía hành lang
    const se = o.stairEnd || 1, endStair = o.stairs !== false;
    for (const s of [-1, 1]) {
      if (endStair && s === se) continue;
      box(wallMat, F, 0.25, H - 0.3, C - 0.4, s * (L / 2 - 0.1), 0.3, front - C / 2 - 0.2, { collide: true });
    }
    if (endStair) {
      const sw = 3, x0 = se * (L / 2 + 0.15), xc = x0 + se * sw / 2;
      const lane = [x0 + se * 0.75, x0 + se * 2.25];
      const zLand = front - C, zBack = -D / 2 + 1.2, n = 9, tread = (zLand - zBack) / n;
      const level = k => (k === 0 ? 0.3 : k * FH);
      // tường bao ba mặt (mặt giáp hành lang để trống), sàn tầng 1, mái
      box(wallMat, F, 0.2, H + 0.9, D, x0 + se * (sw + 0.1), 0, 0, { collide: true });
      box(wallMat, F, sw + 0.2, H + 0.9, 0.2, xc, 0, -D / 2 - 0.1, { collide: true });
      box(wallMat, F, sw + 0.2, H + 0.9, 0.2, xc, 0, front + 0.1, { collide: true });
      plane(facadeBack, F, sw, H, xc, H / 2, front + 0.21, 0, 1, floors);
      plane(facadeBack, F, D, H, x0 + se * (sw + 0.21), H / 2, 0, se * Math.PI / 2, 2, floors);
      box(trim, F, sw + 0.5, 0.35, D + 0.5, xc, H, 0);
      box(mats.floorTile, F, sw, 0.3, D, xc, 0, 0, { collide: true });
      // vách giữa hai đợt thang
      box(wallMat, F, 0.12, H, zLand - zBack, x0 + se * 1.5, 0, (zLand + zBack) / 2);
      const step = (lx, zc, top) => {
        box(stairPink, F, 1.5, 0.21, tread + 0.05, lx, top - 0.21, zc);
        box(stairTrim, F, 1.58, 0.05, 0.09, lx, top - 0.03, zc + tread / 2 - 0.05);
        addCollider(F, lx - 0.75, lx + 0.75, zc - tread / 2, zc + tread / 2, top, top - 0.3, true);
      };
      const slab = (z0, z1, top) => {
        box(stairPink, F, sw, 0.28, z1 - z0, xc, top - 0.28, (z0 + z1) / 2);
        box(stairTrim, F, sw + 0.08, 0.05, 0.14, xc, top - 0.03, z1 - 0.07);
        addCollider(F, Math.min(x0, x0 + se * sw), Math.max(x0, x0 + se * sw), z0, z1, top, top - 0.3, true);
      };
      for (let f = 0; f < floors - 1; f++) {
        const yA = level(f), yB = level(f + 1), mid = (yA + yB) / 2;
        for (let i = 1; i <= n; i++) step(lane[0], zLand - (i - 0.5) * tread, yA + (i * (mid - yA)) / n);
        slab(-D / 2, zBack, mid);
        for (let i = 1; i <= n; i++) step(lane[1], zBack + (i - 0.5) * tread, mid + (i * (yB - mid)) / n);
        slab(zLand, front, yB);
      }
      W.rects.push({ ...F.rect(Math.min(x0, x0 + se * sw), Math.max(x0, x0 + se * sw), -D / 2, D / 2), kind: 'building' });
      W.stairs = W.stairs || [];
      const entry = new THREE.Vector3(lane[0], 0, front - C / 2).applyMatrix4(F.m);
      W.stairs.push({ x: entry.x, z: entry.z });
    }
    // biển tên lớp/phòng — căn giữa ô lớp (cùng trục cửa), texture riêng từng biển (tránh lỗi UV atlas)
    (o.rooms || []).forEach((names, f) => names.forEach((name, i) => {
      if (!name || i >= roomSlots.length) return;
      const xc = roomSlots[i] + bw * 0.5;
      // Biển trên vách cửa lớp (mặt hướng hành lang), mọi tầng — không đặt trước lan can.
      const plateY = f === 0 ? 2.9 : f * FH + 2.58;
      const plateZ = roomFront + 0.09;
      roomPlate(F, name, xc, plateY, plateZ, bw);
      const code = String(name).toUpperCase().replace(/\s/g, '');
      if (isClassRoomCode(code)) {
        const slot = roomSlots[Math.min(i, roomSlots.length - 1)] + bw * 0.5;
        const shell = { xc: slot, bw, D, roomFront, floorIndex: f };
        ensureClassroomShell(F, W, mats, batch, wallMat, shell);
        furnishClassroom(root, F, W, { ...shell, className: code });
        installClassroomDoor(root, F, W, { xc: slot, roomFront, floorIndex: f, className: code });
        registerClassroomMeta(W, F, { ...shell, className: code });
        const zRoom = (-D / 2 + 0.35 + roomFront - 0.25) / 2;
        const cen = new THREE.Vector3(slot, f * FH + 1.2, zRoom).applyMatrix4(F.m);
        W.interact.push({
          x: cen.x,
          z: cen.z,
          r: 2.8,
          label: `Lớp ${code} (tầng ${f + 1})`,
          title: `Phòng ${code}`,
          text: `Phòng học lớp ${code}, tầng ${f + 1}. Đứng trước cửa hành lang, nhấn E để mở cửa rồi bước vào. Bàn ghế, bảng xanh, TV theo phòng học THPT Vĩnh Bảo.`,
        });
      }
    }));
    // Sảnh cầu thang hai đợt (terrazzo hồng, viền beige, vách gạch bông — tham khảo 12 Trần Phú).
    for (const hx of halls) {
      const x0 = hx + 0.21, x1 = hx + bw - 0.21, hw = x1 - x0, xc = (x0 + x1) / 2;
      const lw = hw / 2 - 0.14;
      const zBack = -D / 2 + 1.05;
      const zHall = roomFront + 0.05;
      const zWallFace = zBack + 0.17;                      // mặt vách gạch bông (collider mỏng, không chặn chiếu nghỉ)
      const zLandBack = zBack + 0.38;                       // chiếu nghỉ trước vách — đủ chỗ tới chân thang sắt
      const zMid = zLandBack + 1.18;                        // mép trước chiếu nghỉ = nối hai đợt thang
      const n = 11;
      const tread = (zHall - zMid) / n;
      const level = k => (k === 0 ? 0.32 : k * FH);
      const lane = [x0 + lw / 2 + 0.06, x1 - lw / 2 - 0.06];
      const stairStep = (lx, lw_, zc, treadLen, top, nosingZ, riserZ, outerX) => {
        box(stairPink, F, lw_, 0.22, treadLen + 0.02, lx, top - 0.22, zc);
        box(stairTrim, F, 0.12, 0.055, treadLen + 0.06, outerX, top - 0.025, zc);
        box(stairTrim, F, lw_, 0.055, 0.09, lx, top - 0.025, nosingZ);
        box(mats.stairRiser, F, lw_ + 0.02, 0.2, 0.022, lx, top - 0.1, riserZ);
        addCollider(F, lx - lw_ / 2, lx + lw_ / 2, zc - treadLen / 2 - 0.02, zc + treadLen / 2 + 0.02, top, top - 0.28, true);
      };
      const landing = (z0, z1, top, rails = true) => {
        const depth = z1 - z0, zc = (z0 + z1) / 2;
        box(stairPink, F, hw, 0.3, depth, xc, top - 0.3, zc);
        const bd = 0.16;
        box(stairTrim, F, hw, 0.055, bd, xc, top - 0.02, z0 + bd / 2);
        box(stairTrim, F, hw, 0.055, bd, xc, top - 0.02, z1 - bd / 2);
        box(stairTrim, F, bd, 0.055, depth, x0 + bd / 2, top - 0.02, zc);
        box(stairTrim, F, bd, 0.055, depth, x1 - bd / 2, top - 0.02, zc);
        if (rails) box(mats.stairParapet, F, hw, 0.06, 0.1, xc, top + 0.68, z0 + 0.08);
        addCollider(F, x0, x1, z0, z1, top, top - 0.34, true);
      };
      // khối sảnh: tường vàng nhạt, đáy vách gạch bông, thang sắt sát vách
      box(stairPink, F, hw, 0.34, D - C + 0.2, xc, 0, (-D / 2 + roomFront) / 2, { collide: true });
      box(stairTrim, F, hw + 0.08, 0.07, 0.18, xc, 0.02, zHall + 0.06);
      box(mats.stairWall, F, hw, H, 0.18, xc, 0, -D / 2 + 0.12, { collide: true });
      plane(mats.breezeStair, F, hw - 0.12, H, xc, H / 2, zBack + 0.19, 0, (hw - 0.12) / 2.05, H / 2.05);
      addCollider(F, x0, x1, zWallFace - 0.05, zWallFace + 0.05, H, 0, true); // chỉ mặt phẳng vách, không nuốt chiếu nghỉ
      box(mats.stairWall, F, 0.16, H, roomFront - zBack + 0.5, x0 + 0.08, 0, (roomFront + zBack) / 2);
      box(mats.stairWall, F, 0.16, H, roomFront - zBack + 0.5, x1 - 0.08, 0, (roomFront + zBack) / 2);
      // Lan can giữa hai đợt: tường lửng xây chạy dốc theo bậc + tay vịn (có va chạm từng bậc).
      const railH = 0.9;
      const flightRail = (rx, zS, yS, zE, yE) => {
        const dz = zE - zS, dy = yE - yS, len = Math.hypot(dz, dy);
        const sgn = dz < 0 ? -1 : 1, ang = -Math.atan2(dy * sgn, dz * sgn);
        const zc = (zS + zE) / 2, yc = (yS + yE) / 2;
        batch.add(mats.stairParapet, GEO.cbox, F.at(rx, yc + railH / 2, zc, 0, ang).multiply(new THREE.Matrix4().makeScale(0.12, railH, len)));
        batch.add(stairTrim, GEO.cbox, F.at(rx, yc + railH + 0.03, zc, 0, ang).multiply(new THREE.Matrix4().makeScale(0.2, 0.07, len + 0.06)));
      };
      const ladderX = xc, ladderZ = zBack + 0.3;          // thang sắt giữa vách gạch bông
      const ladderF = Math.max(0, floors - 2);              // đợt thang tầng 2 → 3 (tầng trên cùng)
      const midA = (level(ladderF) + level(ladderF + 1)) / 2; // chân thang = chiếu nghỉ của đợt đó
      const roofTop = H + 0.35, railTop = roofTop + 1.0;
      for (const side of [-1, 1]) box(mats.pole, F, 0.05, railTop - midA, 0.05, ladderX + side * 0.22, midA, ladderZ);
      for (let y = midA + 0.35; y < railTop - 0.1; y += 0.35) box(mats.pole, F, 0.44, 0.03, 0.04, ladderX, y, ladderZ);
      // lỗ chui lên mái + viền
      const hz0 = ladderZ - 0.2, hz1 = ladderZ + 0.78, hx0 = ladderX - 0.45, hx1 = ladderX + 0.45;
      hatches.push({ x0: hx0, x1: hx1, z0: hz0, z1: hz1 });
      box(M(0x222222), F, hx1 - hx0, 0.02, hz1 - hz0, ladderX, roofTop + 0.005, (hz0 + hz1) / 2);
      box(mats.grey, F, hx1 - hx0 + 0.16, 0.12, 0.08, ladderX, roofTop, hz1 + 0.04);
      const hang = new THREE.Vector3(ladderX, 0, ladderZ + 0.38).applyMatrix4(F.m);
      const topOut = new THREE.Vector3(ladderX, 0, hz1 + 0.55).applyMatrix4(F.m);
      const botOut = new THREE.Vector3(ladderX, 0, ladderZ + 0.75).applyMatrix4(F.m);
      const face = Math.atan2(-(hang.x - new THREE.Vector3(ladderX, 0, ladderZ).applyMatrix4(F.m).x), -(hang.z - new THREE.Vector3(ladderX, 0, ladderZ).applyMatrix4(F.m).z));
      W.ladders.push({ x: hang.x, z: hang.z, y0: midA, y1: roofTop, top: { x: topOut.x, z: topOut.z }, bottom: { x: botOut.x, z: botOut.z }, face });
      landing(zHall - 0.18, zHall + 0.22, level(0), false);
      for (let f = 0; f < floors - 1; f++) {
        const yA = level(f), yB = level(f + 1), mid = (yA + yB) / 2;
        const outer0 = lane[0] - lw / 2 - 0.05;
        const outer1 = lane[1] + lw / 2 + 0.05;
        for (let i = 1; i <= n; i++) {
          const zc = zHall - (i - 0.5) * tread;
          const top = yA + (i * (mid - yA)) / n;
          const nosing = zc - tread / 2 + 0.04;
          stairStep(lane[0], lw, zc, tread, top, nosing, zc - tread / 2 - 0.02, outer0);
        }
        landing(zLandBack - 0.04, zMid + tread * 0.45, mid, false);
        for (let i = 1; i <= n; i++) {
          const zc = zMid + (i - 0.5) * tread;
          const top = mid + (i * (yB - mid)) / n;
          const nosing = zc + tread / 2 - 0.04;
          stairStep(lane[1], lw, zc, tread, top, nosing, zc + tread / 2 + 0.02, outer1);
        }
        landing(zHall - 0.22, zHall + 0.2, yB, false);
        box(mats.trim, F, hw + 0.04, 0.08, 0.22, xc, yB - 0.04, zHall + 0.14);
        // lan can giữa: mỗi đợt một bức lửng dốc theo mũi bậc
        flightRail(xc - 0.07, zHall, yA, zMid, mid);
        flightRail(xc + 0.07, zMid, mid, zHall, yB);
        for (let i = 1; i <= n; i++) {
          const z0 = zHall - i * tread, z1 = z0 + tread;
          if (z1 <= zMid + 0.08 && z0 >= zLandBack - 0.08) continue; // chiếu nghỉ giữa: đi ngang sang đợt kia
          if (f > 0 && z1 <= zHall + 0.22 && z0 >= zHall - 0.28) continue; // chiếu nghỉ hành lang tầng trên
          const h0 = yA + (i * (mid - yA)) / n;
          const h1 = mid + ((n + 1 - i) * (yB - mid)) / n;
          addCollider(F, xc - 0.13, xc, z0, z1, h0 + railH, h0 - 0.3, true);
          addCollider(F, xc, xc + 0.13, z0, z1, h1 + railH, h1 - 0.3, true);
        }
      }
      W.stairHalls = W.stairHalls || [];
      const wp = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(F.m); return [+v.x.toFixed(2), +v.z.toFixed(2)]; };
      W.stairHalls.push({ lane0: wp(lane[0], zHall + 0.6), lane0Mid: wp(lane[0], zMid), lane1Mid: wp(lane[1], zMid), lane1Hall: wp(lane[1], zHall + 0.6), floors, FH });
      W.stairs = W.stairs || [];
      const entryX = hx < 0 ? lane[1] : lane[0];
      const entry = new THREE.Vector3(entryX, 0, zHall + 0.12).applyMatrix4(F.m);
      W.stairs.push({ x: entry.x, z: entry.z });
      W.interact.push({
        x: entry.x, z: entry.z, r: 3.2,
        label: 'Cầu thang lên tầng trên',
        title: 'Sảnh cầu thang',
        text: '① Từ hành lang vào sảnh, đi thẳng vào trong (theo hướng nhìn) xuống đợt 1. ② Chiếu nghỉ sát vách gạch bông — đi ngang sang đợt 2. ③ Lên tầng trên, lặp lại. Thang sắt lên mái chỉ ở chiếu nghỉ tầng 2→3 (sau khi lên tầng 3 một đoạn rồi quay lại chiếu nghỉ sâu trong): đứng sát thang, bấm E để bám, rồi W/S leo, Space buông tay.',
      });
    }
    // sàn mái đi được (chừa lỗ thang sắt) + lan can mái có va chạm
    {
      const rx0 = -L / 2 - 0.2, rx1 = L / 2 + 0.2, rz0 = -D / 2 - 0.1, rz1 = D / 2 + 0.1, top = H + 0.35, bot = H + 0.04;
      let cx = rx0;
      for (const h of hatches.slice().sort((a, b) => a.x0 - b.x0)) {
        if (h.x0 > cx) addCollider(F, cx, h.x0, rz0, rz1, top, bot, true);
        addCollider(F, h.x0, h.x1, rz0, h.z0, top, bot, true);
        addCollider(F, h.x0, h.x1, h.z1, rz1, top, bot, true);
        cx = h.x1;
      }
      addCollider(F, cx, rx1, rz0, rz1, top, bot, true);
      addCollider(F, -L / 2 - 0.3, L / 2 + 0.3, D / 2 + 0.05, D / 2 + 0.25, top + 0.9, top - 0.05, true);
      addCollider(F, -L / 2 - 0.3, L / 2 + 0.3, -D / 2 - 0.25, -D / 2 - 0.05, top + 0.9, top - 0.05, true);
      for (const sx of [-1, 1]) addCollider(F, sx * (L / 2 + 0.1) - 0.1, sx * (L / 2 + 0.1) + 0.1, -D / 2 - 0.25, D / 2 + 0.25, top + 0.9, top - 0.05, true);
    }
    W.rects.push({ ...F.rect(-L / 2, L / 2, -D / 2, D / 2), kind: 'building' });
    return { F, H, front, bays, bw };
  }

  // Nhà học chính (theo ảnh trên website trường): 3 tầng, sảnh giữa, biển tên trên nóc.
  const AZ = -36;
  // hai sảnh cầu thang ngay hai bên sân khấu (ảnh khai giảng 2023: bên trái; ảnh bế giảng 2022: bên phải)
  const seq = (pre, a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${pre}${a + i}`);
  // Khối 12 = A, khối 11 = B, khối 10 = C (theo biển lớp trong ảnh 2026); thứ tự phòng là giả định.
  const A = buildBlock({ x: 0, z: AZ, ry: 0, L: 88, D: 10, floors: 3, stairs: false, halls: [-16, 12],
    rooms: [seq('12A', 1, 9), seq('11B', 1, 9), seq('10C', 1, 9)] });
  {
    const { F, H, front } = A;
    const pd = 3.2, pz = front + pd / 2;
    for (const s of [-1, 1]) box(mats.wall, F, 1.0, H + 1.6, pd, s * 4.5, 0, pz, { collide: true });
    for (const s of [-1, 1]) {
      cyl(mats.column, F, 0.3, H, s * 1.9, 0, front + pd - 0.4);
      addCollider(F, s * 1.9 - 0.3, s * 1.9 + 0.3, front + pd - 0.7, front + pd - 0.1, H);
    }
    for (let f = 1; f <= 3; f++) box(mats.trim, F, 10, 0.34, pd + 0.1, 0, f * FH - (f === 3 ? 0 : 0.34), pz);
    box(mats.floorTile, F, 10, 0.3, pd, 0, 0, pz, { collide: true });
    box(mats.floorTile, F, 8, 0.2, 0.5, 0, 0, front + pd + 0.25);
    box(mats.floorTile, F, 8, 0.1, 0.5, 0, 0, front + pd + 0.75);
    for (let f = 1; f < 3; f++) plane(mats.balustrade, F, 7.4, 0.95, 0, f * FH + 0.475, front + pd - 0.12, 0, 7.4 / 0.9, 1);
    box(mats.wall, F, 10, 1.7, 0.4, 0, H + 0.1, front + pd - 0.2);
    box(mats.trim, F, 10.4, 0.2, pd + 0.4, 0, H + 1.8, pz);
    sign(T.signTexture('TRƯỜNG TRUNG HỌC PHỔ THÔNG VĨNH BẢO', { w: 2048, h: 240, bg: '#f7efd9', fg: '#c62828', border: null, size: 150 }),
      9.4, 1.1, 0, H + 0.95, AZ + front + pd + 0.02);
    // cột cờ trên nóc sảnh
    cyl(mats.pole, F, 0.05, 4.2, 0, H + 2.0, pz);
    W.roofFlag = { x: 0, y: H + 5.9, z: AZ + pz };
    // băng rôn dọc hai bên sảnh
    const banners = [['DẠY', 'TỐT'], ['HỌC', 'TỐT']];
    [-1, 1].forEach((s, i) => sign(T.verticalBannerTexture(banners[i]), 1.2, 6.2, s * 7, FH + 3.35, AZ + front + 0.12));
    // băng rôn xanh lời Bác ở lan can tầng 3 (theo ảnh lễ bế giảng 2022)
    sign(T.signTexture([
      { text: '“Non sông Việt Nam có trở nên tươi đẹp hay không, dân tộc Việt Nam có bước tới đài vinh quang để sánh vai', size: 44, weight: 'normal' },
      { text: 'với các cường quốc năm châu được hay không, chính là nhờ một phần lớn ở công học tập của các em.” — HỒ CHÍ MINH', size: 44, weight: 'normal' },
    ], { w: 2400, h: 150, bg: '#1f3f9a', fg: '#ffffff', border: null }), 15, 0.9, -22, 2 * FH + 0.5, AZ + front + 0.02);
    W.interact.push({
      x: 0, z: AZ + front - 1.2, r: 4,
      label: 'Hành lang các lớp',
      title: 'Phòng học',
      text: 'Các lớp 12A, 11B, 10C: đứng trước cửa, nhấn E để mở, rồi bước vào. Không xuyên tường. Lên tầng 2, 3 bằng cầu thang hai bên sảnh.',
    });
    W.interact.push({
      x: 0, z: AZ, r: 14, minY: 9.6,
      label: 'Mái nhà học chính',
      title: 'Trên nóc trường',
      text: 'Nhìn xuống sân trong, sảnh và cây xanh. Đứng sát lỗ thang sắt, bấm E để leo xuống. Cẩn thận lan can mé mái!',
    });
  }
  // Nhà vệ sinh học sinh — bên phải dãy nhà học chính, quay cửa ra sân trong
  {
    const x0 = 45.5, x1 = 53.5, z0 = -38.8, z1 = -33.2, h = 3.15, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    const wcWall = M(0xe6eef2, { roughness: 0.9 });
    box(wcWall, WORLD, w, h, d, xc, 0, zc, { collide: true });
    box(mats.floorTile, WORLD, w + 0.1, 0.22, d + 0.1, xc, 0, zc);
    box(mats.trim, WORLD, w + 0.25, 0.18, d + 0.25, xc, h, zc);
    batch.add(mats.tileRoof, GEO.pyramid, xform(xc, h + 0.12, zc).multiply(new THREE.Matrix4().makeScale(w + 0.35, 0.75, d + 0.25)));
    box(wcWall, WORLD, 0.14, h - 0.4, d - 0.6, xc, 0.35, zc);
    for (const [dx, label, bg] of [[-1.85, 'NAM', '#1565c0'], [1.85, 'NỮ', '#ad1457']]) {
      const dx_ = dx;
      box(mats.wood, WORLD, 0.95, 2.05, 0.08, xc + dx_, 0.35, z1 + 0.02);
      box(M(0xf5f5f5), WORLD, 0.88, 0.45, 0.06, xc + dx_, 1.55, z1 + 0.03);
      sign(T.signTexture(label, { w: 220, h: 100, bg, fg: '#ffffff', border: '#ffffff' }), 0.5, 0.32, xc + dx_, 2.5, z1 + 0.05);
    }
    sign(T.signTexture('NHÀ VỆ SINH', { w: 640, h: 110, bg: '#546e7a', fg: '#ffffff', border: '#cfd8dc' }), 2.0, 0.36, xc, h + 0.08, z1 + 0.04);
    box(mats.grey, WORLD, 0.12, 2.2, 0.12, x0 + 0.25, 0, z0 + 0.35, { collide: true });
    box(mats.grey, WORLD, 0.12, 2.2, 0.12, x1 - 0.25, 0, z0 + 0.35, { collide: true });
    W.rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, kind: 'building' });
    W.interact.push({
      x: xc, z: z1 + 1.8, r: 3.2,
      label: 'Nhà vệ sinh',
      title: 'Nhà vệ sinh học sinh',
      text: 'Khối nhà một tầng sát dãy nhà học chính, cửa quay ra sân trong. Hai khoang Nam / Nữ quen thuộc với học sinh giữa các tiết, sau giờ ra chơi và giữa kỳ thi.\n\nBạn có thể bước quanh để nhớ lại hàng chờ trước cửa, tiếng nước và những cuộc trò chuyện ngắn giữa sân trường.',
    });
  }
  // Hai dãy nhà hai bên sân rộng: trái 3 tầng, phải 2 tầng (bố cục phỏng đoán, giữ sân thoáng).
  buildBlock({ x: -55, z: -8, ry: Math.PI / 2, L: 48, D: 9, floors: 3, rooms: [
    [...seq('12A', 10, 12), 'Phòng Tin học 1', 'Phòng Tin học 2', 'Thư viện'],
    [...seq('11B', 10, 12), 'Phòng TN Vật lí', 'Phòng TN Hóa học', 'Phòng TN Sinh học'],
    [...seq('10C', 10, 12), 'Phòng Ngoại ngữ', 'Phòng Đa năng', 'Phòng Đoàn TN'],
  ] });
  buildBlock({ x: 55, z: -8, ry: -Math.PI / 2, L: 48, D: 9, floors: 2, rooms: [
    ['Phòng Hiệu trưởng', 'Phòng Phó HT', 'Văn phòng', 'Phòng Hội đồng', 'Phòng Kế toán', 'Phòng Y tế'],
    ['Tổ Toán', 'Tổ Ngữ văn', 'Tổ Ngoại ngữ', 'Tổ Lý – Tin', 'Tổ Hóa – Sinh', 'Tổ Sử – Địa'],
  ] });
  // Hai dãy nhà 2 tầng phía trước, quay ra cổng; giữa là lối đi có cổng chào (theo ảnh 2022).
  const frontRooms = { [-1]: [['Phòng Truyền thống', 'Phòng Công đoàn', 'Phòng Thiết bị'], ['Phòng Bộ môn 1', 'Phòng Bộ môn 2', 'Phòng Bộ môn 3']],
    1: [['Phòng Đọc', 'Phòng Tư vấn HS', 'Phòng Giám thị'], ['Phòng Bộ môn 4', 'Phòng Bộ môn 5', 'Phòng Bộ môn 6']] };
  for (const s of [-1, 1]) buildBlock({ x: s * 17.5, z: 11.5, ry: 0, L: 25, D: 9, floors: 2, stairEnd: s, parapet: 'solid', arches: false, trim: mats.yellowTrim, columns: mats.wall, rooms: frontRooms[s] });
  {
    const green = M(0x3f9a4a, { metalness: 0.4, roughness: 0.5 });
    for (const s of [-1, 1]) box(green, WORLD, 0.25, 6.0, 0.25, s * 4.6, 0, 16.6, { collide: true });
    box(green, WORLD, 9.5, 0.22, 0.22, 0, 5.9, 16.6);
    box(green, WORLD, 9.5, 0.12, 0.12, 0, 5.15, 16.6);
    for (let i = 0; i < 8; i++) batch.add(green, GEO.cbox, xform(-4.1 + i * 1.17, 5.6, 16.6, 0, 0, i % 2 ? 0.75 : -0.75).multiply(new THREE.Matrix4().makeScale(0.07, 0.95, 0.07)));
    sign(T.signTexture('NHIỆT LIỆT CHÀO MỪNG CÁC THẦY CÔ GIÁO, CỰU HỌC SINH VỀ THĂM TRƯỜNG', { w: 2200, h: 200, bg: '#f2b8c6', fg: '#b3261e', border: '#ffffff' }),
      9.0, 0.85, 0, 4.55, 16.76, 0, true);
    // mái che lối đi giữa hai dãy nhà
    box(M(0xcfd6da, { metalness: 0.3 }), WORLD, 9.4, 0.06, 9.6, 0, 3.4, 11.8);
    for (const s of [-1, 1]) for (const z of [7.4, 11.8]) box(mats.grey, WORLD, 0.1, 3.4, 0.1, s * 4.5, 0, z, { collide: true });
    W.interact.push({
      x: 0, z: 18.2, r: 3.6, label: 'Xem cổng chào',
      title: 'Lối vào sân trong',
      text: 'Giữa hai dãy nhà 2 tầng phía trước là lối đi có mái che dẫn vào sân trong rộng, lát gạch hồng. Cổng chào khung thép xanh treo băng rôn “Nhiệt liệt chào mừng các thầy cô giáo, cựu học sinh về thăm trường”.\n\nNhìn qua lối đi là nhà học chính 3 tầng và sân khấu phía trước. Cờ treo trên nóc sảnh, không có cột cờ giữa sân.',
    });
    // chậu cây cảnh trước hai dãy nhà
    const pot = M(0xa2532f);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
      const x = s * (7 + i * 5.2), z = 16.9;
      batch.add(pot, new THREE.CylinderGeometry(0.42, 0.3, 0.55, 12).translate(0, 0.275, 0), xform(x, 0, z));
      blob(i % 2 ? mats.bush : mats.leafDark, WORLD, x, 0.95, z, 0.5, 0.45, 0.5);
      W.colliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, top: 1.2 });
    }
  }

  // ---------- tường rào & cổng (theo ảnh cổng trường) ----------
  function fenceRun(a, b, z, alongZ = false) {
    const len = Math.abs(b - a), n = Math.max(1, Math.round(len / 3.2)), step = len / n;
    const ry = alongZ ? Math.PI / 2 : 0;
    const pos = t => (alongZ ? [z, a + Math.sign(b - a) * t] : [a + Math.sign(b - a) * t, z]);
    for (let i = 0; i < n; i++) {
      const [x, zz] = pos((i + 0.5) * step);
      box(mats.gateYellow, WORLD, step, 0.55, 0.34, x, 0, zz, { ry });
      box(mats.fence, WORLD, step - 0.45, 1.25, 0.18, x, 0.55, zz, { ry });
      box(mats.gateYellow, WORLD, step, 0.12, 0.38, x, 1.8, zz, { ry });
    }
    for (let i = 0; i <= n; i++) {
      const [x, zz] = pos(i * step);
      box(mats.gateYellow, WORLD, 0.5, 2.25, 0.5, x, 0, zz);
      box(mats.white, WORLD, 0.64, 0.1, 0.64, x, 2.25, zz);
      blob(mats.white, WORLD, x, 2.47, zz, 0.15, 0.15, 0.15);
    }
    const [x0, z0] = pos(0), [x1, z1] = pos(len);
    W.colliders.push({ minX: Math.min(x0, x1) - 0.3, maxX: Math.max(x0, x1) + 0.3, minZ: Math.min(z0, z1) - 0.3, maxZ: Math.max(z0, z1) + 0.3, top: 2.6 });
  }
  fenceRun(-62, -6.6, 36);
  fenceRun(6.6, 62, 36);
  fenceRun(36, -44, -62, true);
  fenceRun(36, -44, 62, true);
  fenceRun(-62, 62, -44);

  // Cổng chính theo ảnh 2022 (chụp từ ngoài và từ trong): khung cổng ốp đá granite xám,
  // biển tên chữ vàng trên nền đá, bảng LED chữ đỏ chạy bên dưới; mặt trong viền vàng có băng rôn đỏ.
  // Phía trên là tháp vàng có cửa sổ tròn, mái cong hếch, đỉnh lợp ngói đỏ. Hai bên là cổng phụ.
  const gz = 36;
  const granite = texMat(tex.granite);
  const cream = M(0xeee2b0, { metalness: 0.3, roughness: 0.5 });
  const upturn = (x, y, len, depth, side) => {
    // đầu đao cong hếch lên ở hai đầu mái
    batch.add(mats.gateYellow, GEO.cbox, xform(x + side * len * 0.42, y + len * 0.2, gz, 0, 0, side * 0.42).multiply(new THREE.Matrix4().makeScale(len, 0.2, depth)));
    blob(mats.gateYellow, WORLD, x + side * len * 0.86, y + len * 0.42, gz, 0.12, 0.12, depth * 0.48);
  };
  const eave = (w, y, depth) => {
    box(mats.gateYellow, WORLD, w, 0.24, depth, 0, y, gz);
    box(mats.trim, WORLD, w + 0.02, 0.07, depth + 0.02, 0, y - 0.05, gz);
    for (const s of [-1, 1]) upturn(s * w / 2, y + 0.12, 1.1, depth, s);
  };
  // trụ cổng chính: lõi vàng (mặt trong), ốp granite mặt ngoài
  for (const s of [-1, 1]) {
    box(mats.gateYellow, WORLD, 1.5, 5.4, 1.6, s * 2.95, 0, gz, { collide: true });
    box(granite, WORLD, 1.56, 5.4, 0.9, s * 2.95, 0, gz + 0.38);
  }
  // xà ngang: mặt ngoài granite + biển tên + bảng LED; mặt trong vàng + băng rôn đỏ
  box(mats.gateYellow, WORLD, 4.4, 1.6, 1.4, 0, 3.8, gz);
  box(granite, WORLD, 7.5, 1.6, 0.5, 0, 3.8, gz + 0.6);
  sign(T.signTexture([
    { text: 'SỞ GIÁO DỤC & ĐÀO TẠO HẢI PHÒNG', size: 44 },
    { text: 'TRƯỜNG TRUNG HỌC PHỔ THÔNG VĨNH BẢO', size: 120 },
    { text: 'Số 30 đường Nguyễn Bỉnh Khiêm – Thị trấn Vĩnh Bảo – Hải Phòng', size: 40, weight: 'normal' },
  ], { w: 2048, h: 360, bg: '#4a4b4a', fg: '#e2c06a', border: null }), 6.8, 1.2, 0, 4.6, gz + 0.86);
  box(M(0x1a1a1a), WORLD, 4.3, 0.6, 0.12, 0, 3.18, gz + 0.78);
  const led = T.ledTexture('CHÀO MỪNG CÁC THẦY CÔ GIÁO VÀ CỰU HỌC SINH VỀ THĂM TRƯỜNG  ★  ');
  sign(led, 4.1, 0.48, 0, 3.48, gz + 0.85);
  W.updaters.push(t => { led.offset.x = (t * 0.06) % 1; });
  sign(T.signTexture(['HÔM NAY CHÚNG EM TỰ HÀO VỀ TRƯỜNG', 'NGÀY MAI TRƯỜNG TỰ HÀO VỀ CHÚNG EM'], { w: 1400, h: 260, bg: '#c62828', fg: '#ffffff', border: '#ffd54a' }),
    4.2, 0.8, 0, 4.5, gz - 0.71, Math.PI);
  // tháp cổng: cửa sổ tròn, mái cong nhiều tầng, đỉnh ngói đỏ
  eave(9.0, 5.4, 2.8);
  box(mats.gateYellow, WORLD, 3.6, 2.4, 1.5, 0, 5.64, gz);
  const roundWin = texMat(T.roundWindowTexture(), { alphaTest: 0.5 });
  for (const [zf, ry] of [[gz + 0.76, 0], [gz - 0.76, Math.PI]]) plane(roundWin, WORLD, 1.5, 1.5, 0, 6.85, zf, ry);
  eave(6.4, 8.04, 2.3);
  box(mats.gateYellow, WORLD, 2.4, 1.0, 1.2, 0, 8.28, gz);
  eave(3.4, 9.28, 1.9);
  batch.add(mats.tileRoof, GEO.pyramid, xform(0, 9.5, gz).multiply(new THREE.Matrix4().makeScale(2.5, 1.1, 1.35)));
  box(mats.gateYellow, WORLD, 1.3, 0.14, 0.16, 0, 10.5, gz);
  blob(mats.gateYellow, WORLD, 0, 10.72, gz, 0.15, 0.22, 0.15);
  // cánh cổng song sắt màu kem, mở vào trong
  for (const s of [-1, 1]) {
    const x = s * 2.12, z0 = gz - 0.75, len = 2.05;
    for (const y of [0.15, 1.2, 2.3]) box(cream, WORLD, 0.06, 0.07, len, x, y, z0 - len / 2);
    for (let i = 0; i <= 12; i++) box(cream, WORLD, 0.035, 2.2, 0.035, x, 0.15, z0 - i * (len / 12));
    W.colliders.push({ minX: x - 0.06, maxX: x + 0.06, minZ: z0 - len, maxZ: z0, top: 2.4 });
  }
  // cổng phụ hai bên: khung vàng, xà granite, cửa song sắt kem đóng
  for (const s of [-1, 1]) {
    const cx = s * 4.85;
    box(mats.gateYellow, WORLD, 0.6, 3.7, 1.0, s * 6.3, 0, gz, { collide: true });
    box(mats.gateYellow, WORLD, 2.9, 0.7, 1.0, s * 5.15, 3.0, gz);
    box(granite, WORLD, 2.9, 0.7, 0.3, s * 5.15, 3.0, gz + 0.4);
    box(mats.gateYellow, WORLD, 3.1, 0.12, 1.2, s * 5.15, 3.7, gz);
    for (const y of [0.1, 1.15, 2.3]) box(cream, WORLD, 2.3, 0.07, 0.06, cx, y, gz);
    for (let i = 0; i <= 10; i++) box(cream, WORLD, 0.035, 2.25, 0.035, cx - 1.15 + i * 0.23, 0.1, gz);
    W.colliders.push({ minX: cx - 1.2, maxX: cx + 1.2, minZ: gz - 0.1, maxZ: gz + 0.1, top: 2.5 });
  }
  // phòng bảo vệ nhỏ ngay phía trong cổng, bên trái lối vào (chỗ thầy Thanh đứng trực)
  {
    const x0 = -9.2, x1 = -5.2, z0 = 30.9, z1 = 34.7, h = 2.9, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
    const glass = M(0x3d5560, { roughness: 0.25, metalness: 0.2 });
    box(mats.gateYellow, WORLD, x1 - x0, h, z1 - z0, xc, 0, zc, { collide: true });
    box(mats.grey, WORLD, x1 - x0 + 0.1, 0.3, z1 - z0 + 0.1, xc, 0, zc);
    box(mats.trim, WORLD, x1 - x0 + 0.6, 0.18, z1 - z0 + 0.6, xc, h, zc);
    batch.add(mats.tileRoof, GEO.pyramid, xform(xc, h + 0.18, zc).multiply(new THREE.Matrix4().makeScale(3.2, 1.1, 3.0)));
    // cửa ra vào quay về lối đi, cửa sổ nhìn ra cổng và ra sân
    box(mats.wood, WORLD, 0.06, 2.1, 0.95, x1 + 0.02, 0.3, zc - 0.9);
    box(M(0xfbf6e6), WORLD, 0.05, 1.0, 1.5, x1 + 0.02, 1.1, zc + 0.75);
    box(glass, WORLD, 0.07, 0.85, 1.35, x1 + 0.03, 1.18, zc + 0.75);
    box(M(0xfbf6e6), WORLD, 1.8, 1.0, 0.05, xc, 1.1, z1 + 0.02);
    box(glass, WORLD, 1.65, 0.85, 0.07, xc, 1.18, z1 + 0.03);
    box(M(0xfbf6e6), WORLD, 1.8, 1.0, 0.05, xc, 1.1, z0 - 0.02);
    box(glass, WORLD, 1.65, 0.85, 0.07, xc, 1.18, z0 - 0.03);
    sign(T.signTexture('PHÒNG BẢO VỆ', { w: 512, h: 110, bg: '#1f4fa0', fg: '#ffffff', border: '#ffffff' }), 1.5, 0.32, x1 + 0.04, 2.55, zc + 0.2, Math.PI / 2);
    W.rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, kind: 'building' });
  }

  // biển khẩu hiệu bên phải cổng
  for (const x of [11.2, 18.8]) box(mats.grey, WORLD, 0.14, 3.7, 0.14, x, 0, 35.6, { collide: true });
  sign(T.signTexture('KỶ CƯƠNG – TÌNH THƯƠNG – TRÁCH NHIỆM', { w: 1600, h: 220 }), 7.8, 1.05, 15, 3.15, 35.72, 0, true);
  W.interact.push({
    x: 0, z: 36.5, r: 4.5, label: 'Xem cổng trường',
    title: 'Cổng trường THPT Vĩnh Bảo',
    text: 'Số 30 đường Nguyễn Bỉnh Khiêm, thị trấn Vĩnh Bảo, Hải Phòng.\n\nCổng trường ốp granite, biển chữ vàng, đèn đỏ, tháp vàng cửa sổ tròn. Bên kia đường là sân bóng cỏ nhân tạo, khán đài vàng và quán Tuấn Thảo ở góc phía Tây.',
  });
  W.interact.push({
    x: 15, z: 37.6, r: 3, label: 'Đọc khẩu hiệu',
    title: 'Kỷ cương – Tình thương – Trách nhiệm',
    text: 'Khẩu hiệu quen thuộc treo trên tường rào trước cổng trường.\n\n“Nhà trường luôn xây dựng một môi trường sư phạm trong lành, có kỷ cương nghiêm, nền nếp tốt; có đội ngũ giáo viên tâm huyết, hết lòng thương yêu, chăm sóc học sinh.” — trích trang giới thiệu của trường.',
  });

  // Quầy ăn vặt trên vỉa hè gạch (z ≈ 38.15) — người bán đứng phía cổng, xe quay ra đường
  {
    const cartZ = 38.72;
    const stripe = texMat(T.tileTexture('#ff7043', '#ffffff', 6, 11), { roughness: 0.85 });
    function snackCart(x, signText, bg) {
      const metal = M(0x757575, { metalness: 0.45, roughness: 0.55 });
      const wood = M(0x8d6e3a);
      box(metal, WORLD, 0.08, 0.62, 1.35, x - 0.55, 0.31, cartZ);
      box(metal, WORLD, 0.08, 0.62, 1.35, x + 0.55, 0.31, cartZ);
      for (const s of [-1, 1]) {
        batch.add(metal, new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12).rotateX(Math.PI / 2), xform(x + s * 0.62, 0.18, cartZ + 0.42));
        batch.add(metal, new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12).rotateX(Math.PI / 2), xform(x + s * 0.62, 0.18, cartZ - 0.42));
      }
      box(wood, WORLD, 1.65, 0.06, 1.25, x, 0.62, cartZ);
      box(M(0xf5f5f5), WORLD, 1.62, 0.42, 0.55, x, 0.98, cartZ - 0.32);
      box(M(0xffcc80), WORLD, 1.5, 0.08, 0.45, x, 1.22, cartZ - 0.05);
      sign(T.signTexture(signText, { w: 720, h: 160, bg: bg, fg: '#ffffff', border: '#ffeb3b', size: 72 }), 1.38, 0.42, x, 1.52, cartZ - 0.78);
      cyl(M(0xb0bec5), WORLD, 0.045, 2.35, x - 0.55, 0, cartZ);
      cyl(M(0xb0bec5), WORLD, 0.045, 2.35, x + 0.55, 0, cartZ);
      const awning = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.05), stripe);
      awning.position.set(x, 2.45, cartZ - 0.2);
      awning.rotation.set(0.12, 0, 0);
      awning.receiveShadow = true;
      root.add(awning);
      blob(M(0xff5722), WORLD, x, 1.08, cartZ - 0.18, 0.35, 0.28, 0.22);
      W.colliders.push({ minX: x - 1.05, maxX: x + 1.05, minZ: cartZ - 0.75, maxZ: cartZ + 0.55, top: 2.5 });
    }
    snackCart(-15, 'BÁNH RÁN · TRÀ TẮC', '#c62828');
    snackCart(-8.5, 'TRÀ SỮA VỈA HÈ', '#ad1457');
    snackCart(11, 'ĂN VẶT BÀ NĂM', '#ef6c00');
    box(mats.sidewalk, WORLD, 5.5, 0.04, 2.2, -15, 0.04, 38.15);
    box(mats.sidewalk, WORLD, 5.5, 0.04, 2.2, -8.5, 0.04, 38.15);
    box(mats.sidewalk, WORLD, 5.5, 0.04, 2.2, 11, 0.04, 38.15);
  }

  // ---------- sân khấu trước nhà học chính (ảnh lễ khai giảng ~2022) ----------
  {
    const z0 = -25.9, z1 = -19.4, top = 1.1, sw = 18;
    box(M(0xb3261e), WORLD, sw, top - 0.06, z1 - z0, 0, 0, (z0 + z1) / 2, { collide: true });
    box(mats.floorTile, WORLD, sw + 0.1, 0.06, z1 - z0 + 0.1, 0, top - 0.06, (z0 + z1) / 2, { collide: true });
    for (const s of [-1, 1]) {
      box(mats.floorTile, WORLD, 3, 0.74, 0.6, s * 6.5, 0, z1 + 0.3, { collide: true });
      box(mats.floorTile, WORLD, 3, 0.37, 0.6, s * 6.5, 0, z1 + 0.9, { collide: true });
    }
    box(mats.gateYellow, WORLD, 15.6, 4.9, 0.4, 0, top, z0 + 0.2, { collide: true });
    for (const s of [-1, 1]) box(mats.gateYellow, WORLD, 0.6, 4.9, 0.7, s * 7.9, top, z0 + 0.35, { collide: true });
    sign(T.ceremonyBackdropTexture(), 15.0, 4.4, 0, top + 2.35, z0 + 0.41);
    box(mats.trim, WORLD, 16.8, 0.2, 2.2, 0, top + 4.9, z0 + 0.6);
    batch.add(mats.tileRoof, GEO.pyramid, xform(0, top + 5.1, z0 + 0.6).multiply(new THREE.Matrix4().makeScale(12.2, 1.1, 1.6)));
    for (let i = 0; i < 28; i++) blob(i % 2 ? mats.flower : M(0xffffff), WORLD, -8.1 + i * 0.6, top + 4.82, z0 + 1.68, 0.3, 0.18, 0.05);
    // tượng Bác trên bệ, bên trái phông
    box(mats.white, WORLD, 0.7, 1.2, 0.7, -5.6, top, z0 + 1.1, { collide: true });
    const bronze = M(0x9b7a45, { metalness: 0.55, roughness: 0.45 });
    box(bronze, WORLD, 0.7, 0.42, 0.36, -5.6, top + 1.2, z0 + 1.1);
    blob(bronze, WORLD, -5.6, top + 1.86, z0 + 1.1, 0.19, 0.24, 0.2);
    blob(bronze, WORLD, -5.6, top + 1.66, z0 + 1.2, 0.1, 0.14, 0.08);
    // lẵng hoa chân phông
    for (let x = -7; x <= 7; x += 0.7) {
      if (Math.abs(x + 5.6) < 0.6) continue;
      box(mats.wood, WORLD, 0.35, 0.5, 0.35, x, top, z0 + 0.75);
      blob([mats.flower, mats.flower2, M(0xf6d34a), M(0xf48fb1)][Math.round(x * 10) % 4 & 3], WORLD, x, top + 0.75, z0 + 0.75, 0.38, 0.3, 0.3);
    }
    // bục phát biểu
    box(mats.wood, WORLD, 0.9, 1.15, 0.7, 4.2, top, -22.6, { collide: true });
    box(M(0x6a3b1f), WORLD, 1.0, 0.08, 0.8, 4.2, top + 1.15, -22.6);
    blob(mats.flower, WORLD, 4.2, top + 0.65, -22.22, 0.3, 0.25, 0.08);
    // trống trường trên sân khấu
    const drumF = new Frame(-6.8, -21.6, 0);
    for (const s of [-1, 1]) box(mats.wood, drumF, 0.12, 1.1, 0.12, s * 0.62, top, 0);
    box(mats.wood, drumF, 1.4, 0.1, 0.5, 0, top + 0.45, 0);
    batch.add(M(0xb3261e), new THREE.CylinderGeometry(0.55, 0.55, 0.85, 22).rotateX(Math.PI / 2), drumF.at(0, top + 1.1, 0));
    for (const s of [-1, 1]) batch.add(M(0xe8d6b0), new THREE.CylinderGeometry(0.52, 0.52, 0.02, 22).rotateX(Math.PI / 2), drumF.at(0, top + 1.1, s * 0.43));
    addCollider(drumF, -0.7, 0.7, -0.5, 0.5, top + 1.7);
    W.interact.push({ x: -6.8, z: -20.3, r: 2.4, label: 'Đánh trống vào lớp', action: 'drum' });
    // cây cảnh tròn hai bên sân khấu
    for (const s of [-1, 1]) {
      const x = s * 10.6, z = -23.5;
      box(mats.white, WORLD, 1.6, 0.4, 1.6, x, 0, z);
      cyl(mats.trunk, WORLD, 0.14, 1.2, x, 0.4, z, 0.8);
      blob(mats.leafDark, WORLD, x, 1.9, z, 1.25, 0.95, 1.25);
      blob(mats.leaf, WORLD, x, 2.9, z, 0.85, 0.7, 0.85);
      blob(mats.leafDark, WORLD, x, 3.55, z, 0.45, 0.4, 0.45);
      W.colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.8, maxZ: z + 0.8, top: 3 });
    }
    W.rects.push({ minX: -9, maxX: 9, minZ: z0, maxZ: z1 + 1.2, kind: 'stage' });
    W.interact.push({
      x: 0, z: -17.6, r: 4.5, label: 'Xem sân khấu',
      title: 'Sân khấu trường',
      text: 'Sân khấu xây ngay trước nhà học chính, phông nền màu vàng đỏ như lễ khai giảng, bên trái là tượng Bác Hồ, trống trường ở góc sân khấu. Sân trường rộng phía trước — không có cột cờ giữa sân.',
    });
  }
  // băng rôn trên dãy nhà bên phải (theo ảnh buổi ngoại khoá)
  sign(T.signTexture('HIỀN TÀI LÀ NGUYÊN KHÍ QUỐC GIA', { w: 2000, h: 150, bg: '#c62828', fg: '#ffffff', border: '#ffd54a' }), 16, 1.2, 50.25, 4.35, -8, -Math.PI / 2);
  // ---------- bảng vàng ----------
  for (const x of [-21.4, -18.6]) box(mats.grey, WORLD, 0.15, 3.8, 0.15, x, 0, -28.6, { collide: true });
  box(mats.trim, WORLD, 2.6, 3.2, 0.15, -20, 0.5, -28.5, { collide: true });
  sign(T.honorBoardTexture('BẢNG VÀNG TRUYỀN THỐNG', [
    'Thành lập tháng 9/1961 – Cấp 3 Vĩnh Bảo',
    '19/9/1970: Trường phổ thông cấp 3 Vĩnh Bảo',
    'Huân chương Lao động hạng Ba (1996)',
    'Huân chương Lao động hạng Nhì (2006)',
    'Huân chương Lao động hạng Nhất (2011)',
    'Trường chuẩn Quốc gia mức độ 2 (2020)',
    '“Ngôi trường của những thủ khoa”',
  ]), 2.3, 2.85, -20, 2.1, -28.4);
  W.interact.push({
    x: -20, z: -27, r: 2.8, label: 'Đọc bảng vàng',
    title: 'Bảng vàng truyền thống',
    text: '• Tháng 9/1961: thành lập trường Cấp 3 Vĩnh Bảo.\n• 19/9/1970: mang tên Trường phổ thông cấp 3 Vĩnh Bảo (QĐ 317/QĐ của UBND TP Hải Phòng), sau đổi thành Trường THPT Vĩnh Bảo.\n• Huân chương Lao động hạng Ba (1996), hạng Nhì (2006), hạng Nhất (2011).\n• Đạt chuẩn Quốc gia mức độ 2 năm 2020.\n• 2006–2010: 5 năm liền có thủ khoa đại học — “Ngôi trường của những thủ khoa”.\n\nNguồn: website thptvinhbao.haiphong.edu.vn và báo Thương hiệu & Công luận.',
  });

  W.interact.push({
    x: 18, z: -28.2, r: 3, label: 'Xem nhà học chính',
    title: 'Nhà học chính',
    text: 'Dãy nhà 3 tầng sơn vàng kem, viền đỏ nâu, hành lang lan can con tiện, tầng trên cùng có các ô vòm. Biển tên “Trường Trung học phổ thông Vĩnh Bảo” đặt trên nóc sảnh giữa — cờ treo ở đây, không dựng cột cờ giữa sân.\n\nPhía trước là sân khấu lễ; lan can tầng 3 treo băng rôn xanh lời Bác.',
  });

  // ---------- nhà xe ----------
  {
    const x0 = 30, x1 = 52, z0 = 24, z1 = 33;
    for (const x of [x0, (x0 + x1) / 2, x1]) for (const z of [z0, z1]) {
      box(mats.grey, WORLD, 0.14, 2.8, 0.14, x, 0, z, { collide: true });
    }
    batch.add(mats.shedRoof, new THREE.PlaneGeometry(x1 - x0 + 1, z1 - z0 + 1.2), xform((x0 + x1) / 2, 2.95, (z0 + z1) / 2, 0, -Math.PI / 2 + 0.08));
    box(mats.floorTile, WORLD, x1 - x0, 0.06, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2);
    const colors = [0x2d6cb5, 0xc23b3b, 0x2f8f5b, 0x333333, 0xe0a030, 0x8a4fb0, 0xd0d0d0];
    let k = 0;
    for (const zr of [25.9, 31.1]) {
      for (let x = x0 + 1.2; x < x1 - 0.6; x += 0.85) {
        const F = new Frame(x, zr, (k % 3) * 0.04);
        const col = M(colors[k++ % colors.length]);
        for (const s of [-1, 1]) batch.add(mats.dark, GEO.wheel, F.at(0, 0.35, s * 0.52, Math.PI / 2));
        box(col, F, 0.05, 0.05, 0.85, 0, 0.72, 0);
        batch.add(col, new THREE.BoxGeometry(0.05, 0.05, 0.75), F.at(0, 0.52, 0.12, 0, 0.55));
        box(col, F, 0.05, 0.55, 0.05, 0, 0.35, -0.3);
        box(col, F, 0.05, 0.6, 0.05, 0, 0.4, 0.45);
        box(mats.dark, F, 0.14, 0.05, 0.26, 0, 0.92, -0.3);
        box(mats.dark, F, 0.5, 0.04, 0.04, 0, 1.0, 0.45);
        if (k % 2) box(M(0xe8e8e8), F, 0.32, 0.22, 0.26, 0, 0.82, 0.65);
      }
      W.colliders.push({ minX: x0 + 0.6, maxX: x1 - 0.6, minZ: zr - 0.95, maxZ: zr + 0.95, top: 1.0 });
    }
    W.rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, kind: 'shed' });
    W.interact.push({
      x: 34, z: 28.5, r: 3, label: 'Xem nhà xe',
      title: 'Nhà xe',
      text: 'Những hàng xe đạp, xe đạp điện xếp kín mỗi sáng. Học sinh Vĩnh Bảo đạp xe từ khắp các xã trong huyện tới trường, dọc theo đường 10 và những con đường làng.',
    });
    W.interact.push({
      x: 41, z: 28.5, r: 5.5, label: 'Lấy xe đạp',
      action: 'bikeToggle',
      title: 'Lấy xe đạp',
      text: 'Chọn một chiếc trong dãy xe, bấm E để lấy. Đạp bằng WASD — nhanh hơn đi bộ. Bấm B hoặc quay lại nhà xe + E để trả xe. Nhớ: trong sân trường nên xuống xe dắt bộ qua cổng!',
    });
  }

  // ---------- cây xanh ----------
  function palm(x, z, h = 9) {
    cyl(mats.palmTrunk, WORLD, 0.3, h, x, 0, z, 0.7);
    cyl(M(0x6f9a3a), WORLD, 0.24, 1.3, x, h, z, 0.8);
    const top = new THREE.Vector3(x, h + 1.25, z);
    for (let k = 0; k < 11; k++) {
      const yaw = (k / 11) * Math.PI * 2 + (k % 3) * 0.15;
      const p = top.clone();
      [[0.15, 1.5, 0.75], [0.6, 1.4, 0.6], [1.05, 1.2, 0.4]].forEach(([pitch, len, wd]) => {
        const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        const c = p.clone().addScaledVector(dir, len / 2);
        batch.add(mats.palmLeaf, GEO.cbox, xform(c.x, c.y, c.z, yaw, pitch).multiply(new THREE.Matrix4().makeScale(wd, 0.03, len)));
        p.addScaledVector(dir, len);
      });
    }
    W.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, top: h });
  }
  function flameTree(x, z, s = 1) {
    cyl(mats.trunk, WORLD, 0.32 * s, 3.0 * s, x, 0, z, 0.75);
    // tán phượng xoè rộng, lá xanh lẫn chùm hoa đỏ cam
    for (let k = 0; k < 16; k++) {
      const a = k * 2.399 + x, r = (0.6 + ((k * 7) % 5) * 0.55) * s;
      const m = k % 4 === 0 ? mats.leafDark : k % 4 === 1 ? mats.leaf : k % 4 === 2 ? mats.flower : mats.flower2;
      const sz = (1.0 + (k % 3) * 0.25) * s;
      blob(m, WORLD, x + Math.cos(a) * r, (3.5 + ((k * 5) % 4) * 0.25 - r * 0.12) * s, z + Math.sin(a) * r, sz * 1.15, sz * 0.55, sz * 1.15);
    }
    blob(mats.flower, WORLD, x, 4.25 * s, z, 1.6 * s, 0.7 * s, 1.6 * s);
    W.colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, top: 4 });
  }
  function roundTree(x, z, s = 1) {
    cyl(mats.trunk, WORLD, 0.25 * s, 2.6 * s, x, 0, z, 0.7);
    blob(mats.leafDark, WORLD, x, 3.6 * s, z, 1.9 * s, 1.6 * s, 1.9 * s);
    blob(mats.leaf, WORLD, x + 0.8 * s, 4.3 * s, z + 0.3 * s, 1.3 * s, 1.1 * s, 1.3 * s);
    blob(mats.leaf, WORLD, x - 0.7 * s, 4.1 * s, z - 0.5 * s, 1.2 * s, 1.0 * s, 1.2 * s);
    W.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, top: 4 });
  }
  function treeBed(x, z, r = 1.3) {
    box(mats.white, WORLD, r * 2, 0.3, r * 2, x, 0, z);
    box(mats.soil, WORLD, r * 2 - 0.2, 0.31, r * 2 - 0.2, x, 0, z);
  }
  function placeYardTree(x, z, type = 'flame', s = 1) {
    const bed = type === 'palm' ? 0.85 : 1.0 + (s - 1) * 0.3;
    treeBed(x, z, bed);
    if (type === 'palm') palm(x, z, 7.2 + (Math.abs(x * 3 + z) % 4) * 0.6);
    else if (type === 'round') roundTree(x, z, s);
    else flameTree(x, z, s);
  }

  for (const x of [-34, -26, -18, -11]) palm(x, 38.2, 9 + (x % 2));
  for (const x of [10.5, 22, 30]) flameTree(x, 38.4, 1.0);
  for (const z of [30, 23]) for (const x of [-6, 6]) { treeBed(x, z, 0.8); palm(x, z, 8.5 + (z % 3)); }
  for (const [x, z, s] of [[-30, 28, 1.1], [-20, 20, 0.95], [20, 20, 1.0], [-22, -12, 1.0], [24, -12, 1.0], [34, 6, 0.95], [-14, 6, 0.9]]) {
    treeBed(x, z);
    flameTree(x, z, s);
  }
  // Vài cây bồn giữa sân (ảnh lễ 2026 — rải thưa, sân vẫn rộng trống)
  for (const [x, z, t, s] of [
    [-13, -7, 'round', 0.9],
    [11, -6, 'flame', 0.95],
    [4, -11, 'round', 0.85],
    [-7, 5, 'flame', 0.88],
    [15, 4, 'round', 0.88],
  ]) placeYardTree(x, z, t, s);
  for (const [x, z] of [[-68, -10], [-68, 10], [-68, 26], [68, -12], [68, 8], [68, 24], [-30, -50], [-10, -51], [12, -50], [32, -51]]) roundTree(x, z, 1.1);
  // Vườn cây bên trái sân trong: cây cổ thụ (dưới gốc treo kẻng), bồn cây viền gạch, ghế đá, cau (theo ảnh 2022).
  {
    const x = -34, z = 4;
    treeBed(x, z, 1.8);
    cyl(mats.trunk, WORLD, 0.75, 3.2, x, 0, z, 0.75);
    // ba cành lớn vươn chếch lên
    [[0.6, 0.0], [0.55, 2.2], [0.5, 4.2]].forEach(([tilt, yaw]) => {
      batch.add(mats.trunk, new THREE.CylinderGeometry(0.28, 0.45, 4.2, 8).translate(0, 2.1, 0), xform(x, 2.8, z, yaw, tilt));
    });
    // tán rộng, không đều
    for (let k = 0; k < 14; k++) {
      const a = k * 2.399, r = 1.5 + (k % 4) * 1.1;
      blob(k % 3 ? mats.leaf : mats.leafDark, WORLD, x + Math.cos(a) * r, 6.2 + (k % 3) * 0.6 - r * 0.15, z + Math.sin(a) * r, 2.0, 1.1, 2.0);
    }
    // cành ngang thấp treo kẻng
    batch.add(mats.trunk, new THREE.CylinderGeometry(0.12, 0.2, 2.8, 8).rotateZ(Math.PI / 2 - 0.12), xform(x + 1.6, 2.9, z));
    const kx = x + 2.5;
    cyl(M(0x333333), WORLD, 0.012, 0.85, kx, 2.15, z);
    const iron = M(0x4a3f37, { metalness: 0.6, roughness: 0.55 });
    box(iron, WORLD, 0.16, 0.8, 0.05, kx, 1.35, z);
    box(iron, WORLD, 0.05, 0.8, 0.14, kx, 1.35, z);
    box(iron, WORLD, 0.1, 0.8, 0.1, kx, 1.35, z + 0.06);
    batch.add(iron, new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6).rotateZ(0.3), xform(x + 0.9, 0.75, z + 0.5));
    W.colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.8, maxZ: z + 0.8, top: 4 });
    W.colliders.push({ minX: kx - 0.12, maxX: kx + 0.12, minZ: z - 0.12, maxZ: z + 0.12, top: 2.9 });
    W.interact.push({ x: kx + 0.5, z, r: 2.2, label: 'Đánh kẻng ra chơi', action: 'keng' });
    // bồn cây viền gạch đỏ + cau (ảnh 2022 — vườn bên trái)
    const brick = M(0xa8452f);
    for (const [bx, bz] of [[-39, -5], [-39, 13]]) {
      box(brick, WORLD, 4, 0.45, 3, bx, 0, bz, { collide: true });
      box(mats.soil, WORLD, 3.7, 0.46, 2.7, bx, 0, bz);
      for (let i = -1; i <= 1; i++) blob(mats.bush, WORLD, bx + i * 1.1, 0.75, bz + 0.8, 0.6, 0.4, 0.5);
      palm(bx, bz - 0.4, 6.5);
    }
    // ghế đá
    for (const bz of [-2, 10]) {
      box(mats.grey, WORLD, 0.5, 0.42, 1.8, -29.6, 0, bz);
      box(M(0xb7b4ad), WORLD, 0.6, 0.08, 2.0, -29.6, 0.42, bz, { collide: true });
    }
  }

  // bồn hoa trước nhà học chính
  for (const x of [-32, -26, 26, 32]) {
    box(mats.white, WORLD, 5, 0.35, 1.2, x, 0, -29.6);
    for (let i = -2; i <= 2; i++) blob(i % 2 ? mats.bush : mats.flower2, WORLD, x + i * 0.95, 0.5, -29.6, 0.5, 0.35, 0.5);
    W.colliders.push({ minX: x - 2.5, maxX: x + 2.5, minZ: -30.2, maxZ: -29.0, top: 0.6 });
  }
  // Phượng góc sân phải (ảnh — một vài cây phượng rìa sân, không dày đặc)
  placeYardTree(28, 12, 'flame', 1.0);
  placeYardTree(32, -18, 'flame', 0.95);

  // ---------- đường Nguyễn Bỉnh Khiêm & khu thể thao đối diện cổng (Google Street View 4/2026) ----------
  // Bên trường: vỉa hè gạch đỏ, cau vua gần cổng, cây bồn tròn viền đỏ, cột điện.
  // Đường nhựa 2 làn, vạch giữa vàng đứt, vạch sơn vàng trước cổng.
  // Bên kia: vỉa hè đá xám, cây non chống cọc, đèn cột đôi cầu tròn, đèn đường cao, hàng rào sắt xanh hoa văn;
  // sau đó là sân bóng cỏ nhân tạo, khán đài vàng, cột đèn cao áp, lưới chắn, nhà thi đấu mái vòm.
  // Đầu sân phía Tây là nhà dân và quán Tuấn Thảo; phía Đông là phố đông nhà.
  {
    const yellowPaint = M(0xe0b23a);
    for (let x = -150; x <= 150; x += 6) box(yellowPaint, WORLD, 3, 0.012, 0.15, x, 0.022, 44);
    for (const [x0, lane] of [[-15, 42], [10, 46]]) for (let i = 0; i < 6; i++) box(yellowPaint, WORLD, 0.45, 0.012, 3.2, x0 + i * 0.9, 0.022, lane);
    for (const z of [40, 48]) box(M(0xb9b6ae), WORLD, 300, 0.16, 0.25, 0, 0, z);

    // --- vỉa hè đối diện ---
    const fenceGreen = M(0x1f4a2e, { metalness: 0.4, roughness: 0.5 });
    const ornament = texMat(T.ornamentFenceTexture(), { alphaTest: 0.5, side: THREE.DoubleSide });
    plane(ornament, WORLD, 120, 1.25, 0, 0.62, 53.1, 0, 120 / 2.6, 1);
    for (let x = -60; x <= 60; x += 2.6) {
      box(fenceGreen, WORLD, 0.16, 1.45, 0.16, x, 0, 53.1);
      blob(fenceGreen, WORLD, x, 1.52, 53.1, 0.11, 0.11, 0.11);
    }
    W.colliders.push({ minX: -60.2, maxX: 60.2, minZ: 52.9, maxZ: 53.3, top: 1.5 });
    const globe = M(0xf4f1e6, { emissive: 0xfff3d0, emissiveIntensity: 0.25 });
    for (let x = -56; x <= 56; x += 16) {
      // đèn cột đôi cầu tròn màu xanh
      cyl(fenceGreen, WORLD, 0.08, 3.5, x, 0, 52.5, 0.7);
      box(fenceGreen, WORLD, 0.9, 0.06, 0.06, x, 3.3, 52.5);
      for (const s of [-1, 1]) {
        cyl(fenceGreen, WORLD, 0.03, 0.25, x + s * 0.42, 3.05, 52.5);
        blob(globe, WORLD, x + s * 0.42, 2.95, 52.5, 0.2, 0.2, 0.2);
      }
      W.colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: 52.38, maxZ: 52.62, top: 3.5 });
    }
    for (let x = -60; x <= 60; x += 16) {
      // cây non trong bồn vuông, chống ba cọc tre
      const tx = x + 8;
      box(M(0xa9a59c), WORLD, 1.5, 0.12, 1.5, tx, 0, 50.4);
      box(mats.soil, WORLD, 1.3, 0.13, 1.3, tx, 0, 50.4);
      cyl(mats.trunk, WORLD, 0.07, 3.4, tx, 0, 50.4, 0.6);
      // cây mới trồng: tán thưa, lá nhỏ xanh nhạt
      const young = M(0x7fb25a, { flatShading: true });
      for (let k = 0; k < 6; k++) blob(young, WORLD, tx + Math.cos(k * 2.1) * 0.45, 2.6 + k * 0.28, 50.4 + Math.sin(k * 2.1) * 0.45, 0.28, 0.2, 0.28);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        batch.add(M(0x9b7b55), new THREE.CylinderGeometry(0.025, 0.025, 2.0, 5).translate(0, 1.0, 0), xform(tx + Math.cos(a) * 0.55, 0, 50.4 + Math.sin(a) * 0.55, -a + Math.PI / 2, 0, 0.28));
      }
      W.colliders.push({ minX: tx - 0.75, maxX: tx + 0.75, minZ: 49.65, maxZ: 51.15, top: 0.6 });
    }
    // đèn đường cao, cần vươn ra lòng đường
    for (let x = -96; x <= 96; x += 32) {
      cyl(M(0xa7a9ab, { metalness: 0.5 }), WORLD, 0.1, 9, x, 0, 48.5, 0.6);
      batch.add(M(0xa7a9ab, { metalness: 0.5 }), new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6).rotateX(Math.PI / 2 - 0.25), xform(x, 8.9, 47.5));
      box(M(0xdedede), WORLD, 0.3, 0.12, 0.7, x, 9.05, 46.4);
      W.colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: 48.35, maxZ: 48.65, top: 9 });
    }

    // --- sân bóng ---
    ground(M(0xc3c0b8), 0, 90.5, 122, 75, 0.012, 4);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(100, 64), texMat(T.pitchTexture(), { roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, 0.02, 90.5);
    pitch.receiveShadow = true;
    root.add(pitch);
    const netMat = texMat(T.netTexture(), { alphaTest: 0.3, side: THREE.DoubleSide, transparent: true });
    netMat.userData.noShadow = true;
    for (const s of [-1, 1]) {
      // khung thành
      const gx = s * 48.05;
      for (const dz of [-3.66, 3.66]) box(mats.white, WORLD, 0.12, 2.44, 0.12, gx, 0, 90.5 + dz);
      box(mats.white, WORLD, 0.12, 0.12, 7.44, gx, 2.38, 90.5);
      plane(netMat, WORLD, 7.3, 2.44, gx + s * 1.5, 1.22, 90.5, Math.PI / 2, 7.3, 2.4);
      // lưới chắn bóng cao sau khung thành
      for (let z = 66; z <= 115; z += 7) cyl(M(0x8d8f91), WORLD, 0.07, 10, s * 52.5, 0, z, 0.8);
      plane(netMat, WORLD, 49, 10, s * 52.5, 5, 90.5, Math.PI / 2, 49 / 2, 10 / 2);
    }
    // cột đèn cao áp dạng giàn
    for (const [x, z] of [[-55, 58], [55, 58], [-55, 123], [55, 123]]) {
      const lattice = M(0x9a9ea2, { metalness: 0.5 });
      batch.add(lattice, new THREE.CylinderGeometry(0.25, 0.7, 24, 4).translate(0, 12, 0), xform(x, 0, z, Math.PI / 4));
      const lampHead = M(0xe8e8e8, { emissive: 0xfffbe0, emissiveIntensity: 0.15 });
      batch.add(lampHead, GEO.cbox, xform(x - Math.sign(x) * 0.6, 24.5, z - Math.sign(z - 90) * 0.6, Math.atan2(-x, -(z - 90)), -0.4).multiply(new THREE.Matrix4().makeScale(3.4, 2.2, 0.35)));
    }
    // khán đài bê tông vàng, mặt bậc nâu đỏ
    const standYellow = M(0xe0b546), seats = M(0x9a5a48), stairGrey = M(0xb0aca4);
    function stand(F, len, tiers) {
      for (let t = 0; t < tiers; t++) {
        box(standYellow, F, len, 0.45 * (t + 1), 0.8, 0, 0, -t * 0.8 - 0.4);
        box(seats, F, len - 0.4, 0.06, 0.5, 0, 0.45 * (t + 1), -t * 0.8 - 0.5);
      }
      for (let i = -2; i <= 2; i++) box(stairGrey, F, 1.0, 0.45 * tiers + 0.02, tiers * 0.8, (i * len) / 5, 0, -tiers * 0.4);
      box(standYellow, F, len, 0.45 * tiers + 1.3, 0.3, 0, 0, -tiers * 0.8 - 0.15);
      W.rects.push({ ...F.rect(-len / 2, len / 2, -tiers * 0.8 - 0.3, 0), kind: 'stand' });
    }
    stand(new Frame(-56, 90.5, Math.PI / 2), 52, 8);
    stand(new Frame(56, 90.5, -Math.PI / 2), 52, 8);
    const far = new Frame(0, 124.5, Math.PI);
    stand(far, 76, 10);
    // khán đài A có mái che, cột vàng
    for (let i = -3; i <= 3; i++) box(standYellow, far, 0.45, 8.5, 0.45, i * 3.6, 0, -9.2);
    batch.add(M(0xd7d2c6, { metalness: 0.3 }), GEO.box, far.at(0, 8.4, -5, 0, 0.1).multiply(new THREE.Matrix4().makeScale(24, 0.25, 10)));
    box(standYellow, far, 24.4, 0.7, 0.3, 0, 8.6, -0.1);
    // nhà thi đấu mái vòm + toà nhà trắng cao phía xa
    {
      const hx = -24, hz = 150;
      box(M(0xd8dde2), WORLD, 44, 8, 30, hx, 0, hz);
      batch.add(M(0x9aa5ae, { metalness: 0.5, roughness: 0.4 }), new THREE.CylinderGeometry(22.5, 22.5, 31, 32, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.32, 1), xform(hx, 8, hz));
      box(M(0xf2f2ee), WORLD, 16, 30, 14, 24, 0, 168);
      plane(mats.house, WORLD, 15, 28, 24, 15, 160.98, Math.PI, 3, 9);
    }
    // tường vàng thấp quanh khu sân
    box(M(0xe3c46a), WORLD, 0.3, 2.2, 70, -60.5, 0, 90.5);
    box(M(0xe3c46a), WORLD, 0.3, 2.2, 70, 60.5, 0, 90.5);

    // --- nhà dân hai đầu đường ---
    const walls = [['#f1e2c6', 0xf1e2c6], ['#d9e4ea', 0xd9e4ea], ['#f2cbb7', 0xf2cbb7], ['#e9e3a8', 0xe9e3a8], ['#dcd3ea', 0xdcd3ea], ['#f7f4ec', 0xf7f4ec], ['#cfe3c8', 0xcfe3c8], ['#a9c6e8', 0xa9c6e8]];
    const shops = [null, { text: 'TẠP HOÁ', bg: '#c62828', fg: '#fff' }, null, { text: 'VĂN PHÒNG PHẨM', bg: '#1565c0', fg: '#fff' }, { text: 'PHOTO – IN ẤN', bg: '#2e7d32', fg: '#fff' }, null, { text: 'TRÀ SỮA', bg: '#ad1457', fg: '#fff' }, { text: 'CƠM VĂN PHÒNG', bg: '#e65100', fg: '#fff' }];
    let hk = 0;
    function shopHouse(x, front, w, floors, faceZ) {
      const [css, hex] = walls[hk % walls.length], shop = shops[(hk * 3) % shops.length];
      hk++;
      const h = floors * 3.4, d = 12, cz = front - faceZ * d / 2;
      box(M(hex), WORLD, w - 0.15, h, d, x, 0, cz, { collide: true });
      sign(T.shopHouseTexture(floors, css, shop), w - 0.3, h, x, h / 2, front + faceZ * 0.02, faceZ > 0 ? 0 : Math.PI);
      if (hk % 3 === 0) batch.add(mats.tileRoof, GEO.pyramid, xform(x, h, cz).multiply(new THREE.Matrix4().makeScale(w * 0.72, 1.8, d * 0.72)));
      else box(M(hex), WORLD, w - 0.15, 0.9, 0.2, x, h, front - faceZ * 0.1);
    }
    for (const [x0, x1, front, faceZ] of [[62, 150, 54.5, -1], [-150, -76, 54.5, -1], [64, 150, 35.5, 1], [-150, -64, 35.5, 1]]) {
      let x = x0;
      while (x < x1) {
        const w = 4.2 + ((hk * 7) % 3) * 0.6, floors = 2 + ((hk * 5) % 3) + (hk % 4 === 0 ? 1 : 0);
        shopHouse(x + w / 2, front, w, floors, faceZ);
        x += w;
      }
    }
    // ô tô đỗ bên lề phía trường (ảnh: xe đỏ đỗ gần đầu phố)
    for (const [x, col] of [[70, 0xd32f2f], [76, 0xc62828], [92, 0xeeeeee]]) {
      box(M(col, { metalness: 0.4, roughness: 0.35 }), WORLD, 4.2, 0.8, 1.8, x, 0.3, 41.3, { collide: true });
      box(M(col, { metalness: 0.4, roughness: 0.35 }), WORLD, 2.4, 0.65, 1.7, x - 0.2, 1.1, 41.3);
      box(M(0x2f3a44, { roughness: 0.2 }), WORLD, 2.3, 0.5, 1.75, x - 0.2, 1.15, 41.3);
      for (const dx of [-1.3, 1.3]) for (const dz of [-0.85, 0.85]) batch.add(mats.dark, new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12).rotateX(Math.PI / 2), xform(x + dx, 0.33, 41.3 + dz));
    }

    // --- quán Tuấn Thảo: góc phía Tây, cạnh giàn hoa giấy tím; nhà vàng mái ngói cũ phía sau ---
    {
      const bx = -67, front = 54.5;
      box(M(0xe8b49a), WORLD, 11, 10.2, 12, bx, 0, front + 6, { collide: true });
      box(M(0xc9573e, { metalness: 0.3 }), WORLD, 8, 3, 9, bx + 1, 10.2, front + 7);
      batch.add(M(0xb23a2a, { metalness: 0.3 }), GEO.cbox, xform(bx + 1, 13.4, front + 7, 0, 0, 0.12).multiply(new THREE.Matrix4().makeScale(8.6, 0.12, 9.6)));
      for (let f = 1; f < 3; f++) {
        box(M(0x3d4b55), WORLD, 7, 1.6, 0.1, bx, f * 3.4 + 0.9, front - 0.04);
        box(M(0xf4efe6), WORLD, 9, 0.9, 0.5, bx, f * 3.4 + 0.2, front - 0.25);
      }
      box(M(0x8f9396), WORLD, 8, 2.8, 0.1, bx, 0, front - 0.04);
      sign(T.signTexture([{ text: 'BIA HƠI', size: 46 }, { text: 'TUẤN THẢO', size: 92 }], { w: 1400, h: 300, bg: '#efe7da', fg: '#b3261e', border: '#3d4b55' }), 9.5, 1.6, bx, 3.35, front - 0.35, Math.PI);
      // giàn hoa giấy tím
      const purple = M(0x9b3fb0, { flatShading: true }), purple2 = M(0xc25bd0, { flatShading: true });
      for (let k = 0; k < 10; k++) blob(k % 2 ? purple : purple2, WORLD, -60 + Math.cos(k) * 1.5, 2.2 + (k % 4) * 0.9, 57 + k * 0.7, 1.4, 1.0, 1.2);
      // nhà vàng 2 tầng mái ngói đỏ
      box(M(0xe8c66a), WORLD, 9, 6.6, 8, -66, 0, 74, { collide: true });
      batch.add(mats.tileRoof, GEO.pyramid, xform(-66, 6.6, 74).multiply(new THREE.Matrix4().makeScale(7, 2.2, 6.2)));
      W.interact.push({
        x: bx + 4, z: 51.5, r: 5, label: 'Xem quán Tuấn Thảo',
        title: 'Quán bia Tuấn Thảo',
        text: 'Ngôi nhà 4 tầng ở góc đầu sân bóng phía Tây, đối diện trường bên kia đường Nguyễn Bỉnh Khiêm, cạnh giàn hoa giấy tím.',
      });
    }
    W.rects.push({ minX: -50, maxX: 50, minZ: 58.5, maxZ: 122.5, kind: 'field' });
    W.interact.push({
      x: 0, z: 51.6, r: 6, label: 'Xem sân bóng',
      title: 'Sân bóng đối diện cổng trường',
      text: 'Bên kia đường là sân bóng cỏ nhân tạo, khán đài bê tông vàng ba phía, cột đèn cao áp và lưới chắn bóng; phía xa là nhà thi đấu mái vòm. Vỉa hè lát đá xám, hàng rào sắt xanh hoa văn, đèn cột đôi cầu tròn và hàng cây non mới trồng.',
    });
  }

  // cây bồn tròn viền đỏ + cột điện dọc vỉa hè phía trường
  {
    for (const x of [-46, -54, 38, 46, 54]) {
      batch.add(M(0xb5462e), new THREE.CylinderGeometry(0.9, 0.9, 0.25, 16).translate(0, 0.125, 0), xform(x, 0, 38.9));
      batch.add(mats.soil, new THREE.CylinderGeometry(0.78, 0.78, 0.26, 16).translate(0, 0.13, 0), xform(x, 0, 38.9));
      roundTree(x, 38.9, 1.05);
    }
    const poleMat = M(0xb5b2aa);
    const tops = [];
    for (const x of [-84, -60, -40, 20, 40, 64, 88]) {
      batch.add(poleMat, new THREE.CylinderGeometry(0.12, 0.2, 9, 8).translate(0, 4.5, 0), xform(x, 0, 39.7));
      box(poleMat, WORLD, 0.1, 0.12, 1.6, x, 8.3, 39.7);
      tops.push(x);
      W.colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: 39.5, maxZ: 39.9, top: 9 });
    }
    const pts = [];
    for (let i = 0; i < tops.length - 1; i++) for (const dz of [-0.7, 0, 0.7]) {
      const a = tops[i], b = tops[i + 1], n = 8;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, sag = t => 8.4 - Math.sin(t * Math.PI) * 0.6;
        pts.push(a + (b - a) * t0, sag(t0), 39.7 + dz, a + (b - a) * t1, sag(t1), 39.7 + dz);
      }
    }
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
    root.add(wires);
  }

  // ---------- trang lưu bút (vật phẩm sưu tầm) ----------
  const memories = [
    [-24, 0.3, -32.2, 'Hành lang lớp học', 'Giờ ra chơi ồn ã trên hành lang, những lần đứng ngóng thầy cô vào lớp, tiếng ve ngoài cửa sổ.'],
    [0, 0, -13, 'Sáng thứ Hai', 'Cả trường xếp hàng ngay ngắn trước sân khấu chào cờ, hát Quốc ca, nghe tổng kết thi đua — những buổi sáng đầu tuần không thể quên.'],
    [42, 0, 28.5, 'Nhà xe', 'Chiếc xe đạp cũ dựng trong nhà xe, chở bao ước mơ trên những con đường làng về trường.'],
    [-51.7, 0.3, 0, 'Bục giảng', 'Bụi phấn trắng trên bục giảng, những người lái đò thầm lặng đưa biết bao thế hệ học trò sang sông.'],
    [2, 1.1, -21.5, 'Ngày bế giảng', 'Đứng trên sân khấu ngày chia tay, những dòng lưu bút viết vội, hẹn nhau ngày gặp lại.'],
    [27, 0, 38.6, 'Mùa phượng', 'Phượng đỏ rực trước cổng trường — mùa thi đến, mùa chia tay cũng đến.'],
    [12, 0, 24, 'Huy hiệu Đoàn', 'Huy hiệu Đoàn đeo lệch tim — nhắc nhở “Sơ vin tươm tất” mỗi sáng.'],
    [-30, 0.3, 14, 'Tem thi đua', 'Tem Sao xanh lớp mình dán trên cột báo màu sân trong.'],
    [38, 0, -12, 'Vé văn nghệ', 'Tờ vé cắt cổ mùa văn nghệ cuối năm — ký tên bạn bè trên mặt sau.'],
    [6, 0, -33, 'Ảnh lớp cũ', 'Tấm ảnh lớp nhòe màu — biết bao kỷ niệm ngày chụp trước sân khấu.'],
  ];
  const glow = T.glowTexture();
  const coverColors = [0xe57399, 0x4f8fd8, 0x58b368, 0xf0a63a, 0x9b6bd0, 0xe25555, 0xd84315, 0x00897b, 0x6d4c41, 0x5c6bc0];
  memories.forEach(([x, y, z, title, text], i) => {
    const g = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: coverColors[i], emissive: coverColors[i], emissiveIntensity: 0.35 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.065, 0.28), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2 }));
    pages.position.x = 0.02;
    cover.castShadow = true;
    g.add(cover, pages);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
    halo.scale.set(1.6, 1.6, 1);
    g.add(halo);
    g.position.set(x, y + 0.9, z);
    g.rotation.x = 0.4;
    root.add(g);
    W.collectibles.push({ x, z, baseY: y + 0.9, group: g, title, text, taken: false });
  });

  // ---------- cờ bay ----------
  const flagTex = T.flagTexture();
  function makeFlag(w, h, px, py, pz) {
    const geo = new THREE.PlaneGeometry(w, h, 18, 10).translate(w / 2, -h / 2, 0);
    const base = geo.attributes.position.array.slice();
    const mesh = new THREE.Mesh(geo, texMat(flagTex, { side: THREE.DoubleSide, roughness: 0.7 }));
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    root.add(mesh);
    W.updaters.push(t => {
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const x = base[i], k = x / w;
        p[i + 2] = Math.sin(x * 2.4 - t * 5.5) * 0.18 * k + Math.sin(x * 4.1 - t * 7.3) * 0.05 * k;
        p[i + 1] = base[i + 1] - k * k * 0.12;
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    });
  }
  makeFlag(1.5, 1.0, W.roofFlag.x + 0.05, W.roofFlag.y, W.roofFlag.z);

  W.rects.push({ minX: -6.6, maxX: -2.2, minZ: 34.6, maxZ: 37.4, kind: 'gate' }, { minX: 2.2, maxX: 6.6, minZ: 34.6, maxZ: 37.4, kind: 'gate' });

  batch.flush(root);
  installClassroomSystem(scene, W, root);
  installYardPlay(scene, W, root);
  W.interact.push({
    x: 8, z: 18, r: 4,
    label: 'Sút bóng (chạy tới bóng)',
    title: 'Sân đá banh',
    text: 'Bóng trắng trên sân — chạy sát và sút bằng chuyển động (WASD + Shift). Bóng lăn trong sân trong, không ra đường.',
  });
  return W;
}
