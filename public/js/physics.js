// Va chạm đơn giản: người chơi là hình tròn trên mặt phẳng XZ, vật cản là hộp
// chữ nhật cao từ `bottom` (mặc định 0) tới `top`. Hộp thấp hơn STEP thì bước lên được
// (bậc thềm, sân khấu, bậc cầu thang); hộp có `bottom` cao hơn đầu thì đi bên dưới được (sàn tầng trên).
export const HEAD = 1.7;
export const STEP = 0.45;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Lề rút camera sau khi chạm vật chắn (mét). */
const CAM_MARGIN = 0.38;
const CAM_MIN = 0.75;

function rayBoxInterval(o, d, b, maxT) {
  let t0 = 0, t1 = maxT;
  const pad = 0.04;
  const axes = [
    [o.x, d.x, b.minX - pad, b.maxX + pad],
    [o.y, d.y, (b.bottom || 0) - pad * 0.5, b.top + pad * 0.5],
    [o.z, d.z, b.minZ - pad, b.maxZ + pad],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return null;
      continue;
    }
    let a = (lo - oo) / dd, c = (hi - oo) / dd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

function pointInBoxXZ(x, z, b, pad = 0.05) {
  return x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
}

export class Collision {
  constructor(boxes, bounds) {
    this.boxes = boxes;
    this.bounds = bounds;
  }

  groundAt(x, z, feetY) {
    let g = 0;
    for (const b of this.boxes) {
      if (b.top > g && b.top <= feetY + STEP && x > b.minX - 0.05 && x < b.maxX + 0.05 && z > b.minZ - 0.05 && z < b.maxZ + 0.05) g = b.top;
    }
    return g;
  }

  resolve(p, feetY, r) {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const b of this.boxes) {
        if (b.top <= feetY + STEP || (b.bottom || 0) >= feetY + HEAD) continue;
        const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          p.x += dx * k;
          p.z += dz * k;
        } else {
          const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) p.x = b.minX - r;
          else if (m === rr) p.x = b.maxX + r;
          else if (m === t) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    const B = this.bounds;
    p.x = clamp(p.x, B.minX, B.maxX);
    p.z = clamp(p.z, B.minZ, B.maxZ);
  }

  rayDist(o, d, maxDist) {
    return this.camQuery(o, d, maxDist).dist;
  }

  /**
   * Mọi vật chắn trên đoạn mắt → camera đều rút boom (vật chắn nằm ngoài đoạn nhìn).
   * Sàn/trần mỏng phía trên mắt: rút mạnh + gợi ý nâng pitch nhẹ.
   * @returns {{ dist: number, pitchLift: number, yLift: number }}
   */
  camQuery(o, d, maxDist) {
    let best = maxDist;
    let pitchLift = 0;
    let yLift = 0;
    const eyeY = o.y;

    for (const b of this.boxes) {
      const bot = b.bottom || 0;
      const h = b.top - bot;

      // Chỉ bỏ bề mặt đi bộ hoàn toàn dưới điểm nhìn (không chắn tầm ra sau/lên).
      if (b.top <= eyeY - 0.25) continue;

      // Mắt đang “đứng trong” khối thấp dưới chân (bậc đang đứng) — không coi là chắn camera.
      if (h <= 0.55 && pointInBoxXZ(o.x, o.z, b) && bot <= eyeY && b.top >= eyeY - 1.6 && b.top <= eyeY + 0.05) {
        continue;
      }

      const hit = rayBoxInterval(o, d, b, best);
      if (!hit) continue;
      let [t0, t1] = hit;

      // Gốc tia nằm trong hộp: rút về sát nhân vật để thoát khối chắn.
      if (t0 <= 1e-4 && t1 > 0) {
        best = Math.min(best, CAM_MIN);
        if (h <= 0.6 && bot > eyeY - 0.4) {
          pitchLift = Math.max(pitchLift, 0.35);
          yLift = Math.max(yLift, clamp((bot - 0.2 - eyeY) * 0.5, 0, 0.45));
        }
        continue;
      }

      if (t0 > 0 && t0 < best) {
        best = Math.max(CAM_MIN, t0 - CAM_MARGIN);
        // Trần/sàn mỏng hoặc bất kỳ vật trên cao: ưu tiên rút + hơi ngẩng để khỏi kẹt.
        if (bot >= eyeY - 0.2) {
          const clearance = bot - eyeY;
          pitchLift = Math.max(pitchLift, clamp(0.5 - clearance * 0.18, 0.06, 0.55));
          if (clearance > 0.2 && clearance < 1.8) {
            yLift = Math.max(yLift, clamp(clearance * 0.28, 0, 0.45));
          }
        }
      }
    }

    // Trần phía trên: boom không được đâm xuyên mặt dưới sàn dù tia gần song song.
    for (const b of this.boxes) {
      const bot = b.bottom || 0;
      const h = b.top - bot;
      if (h > 0.65 || bot < eyeY - 0.15) continue;
      if (!pointInBoxXZ(o.x + d.x * best, o.z + d.z * best, b, 0.12)
        && !pointInBoxXZ(o.x, o.z, b, 0.12)) continue;
      const headroom = bot - 0.2 - eyeY;
      if (d.y > 0.025 && headroom > 0) {
        best = Math.min(best, Math.max(CAM_MIN, headroom / d.y));
        pitchLift = Math.max(pitchLift, clamp(0.55 - headroom * 0.25, 0.12, 0.6));
      } else if (headroom <= 0.35) {
        best = Math.min(best, Math.max(CAM_MIN, maxDist * 0.42));
        pitchLift = Math.max(pitchLift, 0.4);
      }
    }

    return { dist: best, pitchLift, yLift };
  }
}
