// Teluk Rimba — tiny hand-written WebGL2 engine (no external library).
// One lit shader (lambert + fog) and one unlit shader (lamp heads, signals),
// merged static geometry + instanced meshes, so a whole city draws in ~12 calls.

export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye, center, up) {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  let xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4TRS(x, y, z, rotY, sx, sy, sz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const m = new Float32Array(16);
  m[0] = c * sx; m[1] = 0; m[2] = -s * sx; m[3] = 0;
  m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0;
  m[8] = s * sz; m[9] = 0; m[10] = c * sz; m[11] = 0;
  m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
}

export function compileProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader compile: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program link: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

const FOG_FS = `
  precision mediump float;
  varying vec3 vColor; varying float vDist;
  uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
  vec3 applyFog(vec3 col) {
    float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    return mix(col, uFogColor, f);
  }
`;

const LIT_VS = `
  attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
  uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorldPos;
  void main() {
    vec4 wp = uModel * vec4(aPos, 1.0);
    vColor = aColor;
    vNormal = mat3(uModel) * aNormal;
    vWorldPos = wp.xyz;
    vec4 vp = uView * wp;
    vDist = -vp.z;
    gl_Position = uProj * vp;
  }
`;

const LIT_INST_VS = `
  attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
  attribute vec4 aMat0; attribute vec4 aMat1; attribute vec4 aMat2; attribute vec4 aMat3;
  attribute vec3 aTint;
  uniform mat4 uProj; uniform mat4 uView;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorldPos;
  void main() {
    mat4 m = mat4(aMat0, aMat1, aMat2, aMat3);
    vec4 wp = m * vec4(aPos, 1.0);
    vColor = aColor * aTint;
    vNormal = mat3(m) * aNormal;
    vWorldPos = wp.xyz;
    vec4 vp = uView * wp;
    vDist = -vp.z;
    gl_Position = uProj * vp;
  }
`;

const LIT_FS = FOG_FS + `
  varying vec3 vNormal; varying vec3 vWorldPos;
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;
  uniform vec3 uSpotPos; uniform vec3 uSpotDir; uniform vec3 uSpotColor; uniform float uSpotOn;
  void main() {
    vec3 n = normalize(vNormal);
    float diff = max(dot(n, -uSunDir), 0.0);
    vec3 col = vColor * (uAmbient + uSunColor * diff);
    // Player headlight spotlight (the one real light): a warm cone that
    // genuinely lights the road and walls ahead of the player car at
    // night. uSpotOn is 0 whenever the player is not driving at night.
    if (uSpotOn > 0.5) {
      vec3 toF = vWorldPos - uSpotPos;
      float sDist = length(toF);
      float sCos = dot(toF / max(sDist, 0.001), normalize(uSpotDir));
      float sCone = smoothstep(0.80, 0.92, sCos);
      float sAtt = clamp(1.0 - sDist / 22.0, 0.0, 1.0);
      col += vColor * uSpotColor * sCone * sAtt * 1.6;
    }
    gl_FragColor = vec4(applyFog(col), 1.0);
  }
`;

const UNLIT_INST_VS = `
  attribute vec3 aPos; attribute vec3 aColor;
  attribute vec4 aMat0; attribute vec4 aMat1; attribute vec4 aMat2; attribute vec4 aMat3;
  attribute vec3 aTint;
  uniform mat4 uProj; uniform mat4 uView;
  varying vec3 vColor; varying float vDist;
  void main() {
    mat4 m = mat4(aMat0, aMat1, aMat2, aMat3);
    vec4 wp = m * vec4(aPos, 1.0);
    vColor = aColor * aTint;
    vec4 vp = uView * wp;
    vDist = -vp.z;
    gl_Position = uProj * vp;
  }
`;

const UNLIT_FS = FOG_FS + `
  void main() {
    gl_FragColor = vec4(applyFog(vColor), 1.0);
  }
`;

export function createPrograms(gl) {
  return {
    lit: compileProgram(gl, LIT_VS, LIT_FS),
    litInst: compileProgram(gl, LIT_INST_VS, LIT_FS),
    unlitInst: compileProgram(gl, UNLIT_INST_VS, UNLIT_FS),
    transp: compileProgram(gl, TRANSP_VS, TRANSP_FS),
    transpInst: compileProgram(gl, TRANSP_INST_VS, TRANSP_FS),
    sky: compileProgram(gl, SKY_VS, SKY_FS),
  };
}

// Sky dome: vertical gradient (horizon -> zenith) + a soft warm glow
// around the sun at dawn/dusk. No fog, no lighting — the dome IS the sky.
const SKY_VS = `
  attribute vec3 aPos; attribute vec3 aColor;
  uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;
  varying vec3 vLocal;
  void main() {
    vLocal = aPos;
    gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
  }
`;

const SKY_FS = `
  precision mediump float;
  varying vec3 vLocal;
  uniform vec3 uTopColor; uniform vec3 uHorizonColor;
  uniform vec3 uSunDirTo; uniform vec3 uSunGlow;
  void main() {
    vec3 dir = normalize(vLocal);
    float h = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.6));
    float g = max(dot(dir, uSunDirTo), 0.0);
    col += uSunGlow * (pow(g, 24.0) * 0.7 + pow(g, 6.0) * 0.18);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TRANSP_VS = `
  attribute vec3 aPos; attribute vec3 aColor;
  uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;
  varying vec3 vColor; varying float vDist;
  void main() {
    vec4 wp = uModel * vec4(aPos, 1.0);
    vColor = aColor;
    vec4 vp = uView * wp;
    vDist = -vp.z;
    gl_Position = uProj * vp;
  }
`;

const TRANSP_INST_VS = `
  attribute vec3 aPos; attribute vec3 aColor;
  attribute vec4 aMat0; attribute vec4 aMat1; attribute vec4 aMat2; attribute vec4 aMat3;
  attribute vec3 aTint;
  uniform mat4 uProj; uniform mat4 uView;
  varying vec3 vColor; varying float vDist;
  void main() {
    mat4 m = mat4(aMat0, aMat1, aMat2, aMat3);
    vec4 wp = m * vec4(aPos, 1.0);
    vColor = aColor * aTint;
    vec4 vp = uView * wp;
    vDist = -vp.z;
    gl_Position = uProj * vp;
  }
`;

const TRANSP_FS = FOG_FS + `
  uniform float uAlpha;
  void main() {
    gl_FragColor = vec4(applyFog(vColor), uAlpha);
  }
`;

// Geometry: plain arrays {pos:[], nrm:[], col:[], idx?} (non-indexed unless idx given).
export function emptyGeom() {
  return { pos: [], nrm: [], col: [], idx: [] };
}

function pushTri(g, a, b, c, n, ca, cb, cc) {
  g.pos.push(...a, ...b, ...c);
  g.nrm.push(...n, ...n, ...n);
  g.col.push(...ca, ...cb, ...cc);
}

function pushQuad(g, a, b, c, d, n, col) {
  pushTri(g, a, b, c, n, col, col, col);
  pushTri(g, a, c, d, n, col, col, col);
}

// Box with subdivided faces; front/back/side faces carry a window grid
// pattern — windows on EVERY face now (not just front/back), in varied
// shades (dark glass / sky reflection / warm lit) picked deterministically
// per cell, never on the ground floor (shop fronts stay plain) or the top
// floor under the roof. sideCols sizes the side-face grid (the sides are
// d deep, so they need their own column count, not the front's).
// Windows are INSET: the wall cell stays, and the glass quad sits slightly
// proud inside it, so each window reads as a window (~1-2 m) instead of a
// giant dark rectangle the full cell wide. Glass is 78% of the cell (Mu:
// 56% read too small) — a clear window with a wall border around it.
// horizontal band every 4th row and side faces are shaded a touch darker,
// so facades read as buildings, not plain blocks.
export function subdividedBox(w, h, d, segFront = 6, segRows = 10, sideCols = 2) {
  const g = emptyGeom();
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const glassDark = [0.3, 0.34, 0.42];
  const glassReflect = [0.7, 0.8, 0.95]; // sky reflection
  const glassWarm = [0.95, 0.8, 0.5]; // lit / curtained window
  const roof = [0.42, 0.42, 0.46];
  // winFn: glass colour for a window cell, null for plain wall. Windows on
  // every other column/row, never on the ground floor or the top floor.
  const winFn = (i, j) => {
    if (!(j > 0 && j < segRows - 1 && i % 2 === 0 && j % 2 === 0)) return null;
    const hv = ((i * 31 + j * 17 + segFront * 7) % 100 + 100) % 100;
    return hv < 60 ? glassDark : hv < 85 ? glassReflect : glassWarm;
  };
  // wallFn: wall colour for a cell — a subtle darker band every 4th row,
  // side faces a touch darker than front/back for depth.
  const wallFn = (shade) => (i, j) => {
    const s = shade * (j % 4 === 3 ? 0.88 : 1.0);
    return [s, s, s];
  };
  const face = (corners, normal, nx, ny, win, wall, windowed) => {
    const [o, u, v] = corners;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = [o[0] + u[0] * (i / nx) + v[0] * (j / ny), o[1] + u[1] * (i / nx) + v[1] * (j / ny), o[2] + u[2] * (i / nx) + v[2] * (j / ny)];
        const b = [o[0] + u[0] * ((i + 1) / nx) + v[0] * (j / ny), o[1] + u[1] * ((i + 1) / nx) + v[1] * (j / ny), o[2] + u[2] * ((i + 1) / nx) + v[2] * (j / ny)];
        const c = [o[0] + u[0] * ((i + 1) / nx) + v[0] * ((j + 1) / ny), o[1] + u[1] * ((i + 1) / nx) + v[1] * ((j + 1) / ny), o[2] + u[2] * ((i + 1) / nx) + v[2] * ((j + 1) / ny)];
        const dd = [o[0] + u[0] * (i / nx) + v[0] * ((j + 1) / ny), o[1] + u[1] * (i / nx) + v[1] * ((j + 1) / ny), o[2] + u[2] * (i / nx) + v[2] * ((j + 1) / ny)];
        const glass = windowed ? win(i, j) : null;
        pushQuad(g, a, b, c, dd, normal, wall(i, j));
        if (glass) {
          // Inset glass quad, 78% of the cell, 0.005 proud of the wall
          // (local units — a few cm once instanced, no z-fighting).
          // Big enough to read as a real window, with a visible wall
          // border around each one (Mu: the 56% quads read too small).
          const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const ad = [dd[0] - a[0], dd[1] - a[1], dd[2] - a[2]];
          const off = [normal[0] * 0.005, normal[1] * 0.005, normal[2] * 0.005];
          const p2 = (fu, fv) => [a[0] + ab[0] * fu + ad[0] * fv + off[0], a[1] + ab[1] * fu + ad[1] * fv + off[1], a[2] + ab[2] * fu + ad[2] * fv + off[2]];
          pushQuad(g, p2(0.11, 0.11), p2(0.89, 0.11), p2(0.89, 0.89), p2(0.11, 0.89), normal, glass);
        }
      }
    }
  };
  const frontWall = wallFn(1.0);
  const sideWall = wallFn(0.94);
  // +z front, -z back, +x right, -x left, +y roof, -y floor
  face([[-hw, -hh, hd], [w, 0, 0], [0, h, 0]], [0, 0, 1], segFront, segRows, winFn, frontWall, true);
  face([[hw, -hh, -hd], [-w, 0, 0], [0, h, 0]], [0, 0, -1], segFront, segRows, winFn, frontWall, true);
  face([[hw, -hh, hd], [0, 0, -d], [0, h, 0]], [1, 0, 0], sideCols, segRows, winFn, sideWall, true);
  face([[-hw, -hh, -hd], [0, 0, d], [0, h, 0]], [-1, 0, 0], sideCols, segRows, winFn, sideWall, true);
  face([[-hw, hh, hd], [w, 0, 0], [0, 0, -d]], [0, 1, 0], 1, 1, null, () => roof, false);
  face([[-hw, -hh, -hd], [w, 0, 0], [0, 0, d]], [0, -1, 0], 1, 1, null, () => [0.3, 0.3, 0.3], false);
  return g;
}

// Plain box, single colour per face set (used for roofs, trunks, poles...).
export function plainBox(w, h, d, color, topColor = null) {
  const g = emptyGeom();
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const top = topColor || color;
  pushQuad(g, [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], [0, 0, 1], color);
  pushQuad(g, [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [0, 0, -1], color);
  pushQuad(g, [hw, -hh, -hd], [hw, -hh, hd], [hw, hh, hd], [hw, hh, -hd], [1, 0, 0], color);
  pushQuad(g, [-hw, -hh, hd], [-hw, -hh, -hd], [-hw, hh, -hd], [-hw, hh, hd], [-1, 0, 0], color);
  pushQuad(g, [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 1, 0], top);
  pushQuad(g, [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], [0, -1, 0], color);
  return g;
}

// Vertical prism (axis Y): a rounded column — heads, limbs and trunks
// read as round instead of square. Faces are centred on the axes (a flat
// face points +Z, so a face reads as a face, not an edge).
export function prismY(sides, r, h, color) {
  const g = emptyGeom();
  const hh = h / 2;
  const pt = (k, y) => {
    const a = ((k + 0.5) / sides) * Math.PI * 2; // half-step: faces on the axes
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  for (let k = 0; k < sides; k++) {
    const a0 = pt(k, -hh), a1 = pt(k + 1, -hh), b0 = pt(k, hh), b1 = pt(k + 1, hh);
    const mid = ((k + 1) / sides) * Math.PI * 2;
    const n = [Math.cos(mid), 0, Math.sin(mid)];
    pushQuad(g, a1, a0, b0, b1, n, color); // side (winding faces outward)
    pushTri(g, [0, hh, 0], b1, b0, [0, 1, 0], color, color, color); // top cap
    pushTri(g, [0, -hh, 0], a0, a1, [0, -1, 0], color, color, color); // bottom cap
  }
  return g;
}

export function mergeGeoms(list) {
  const g = emptyGeom();
  for (const s of list) {
    g.pos.push(...s.pos); g.nrm.push(...s.nrm); g.col.push(...s.col);
  }
  return g;
}

export function translateGeom(g, x, y, z) {
  for (let i = 0; i < g.pos.length; i += 3) {
    g.pos[i] += x; g.pos[i + 1] += y; g.pos[i + 2] += z;
  }
  return g;
}

// Upload a static (non-instanced) mesh; returns {vao, count, tris}.
export function createMesh(gl, prog, geom) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bind = (loc, data, size) => {
    if (loc < 0) return; // e.g. aNormal is absent from the unlit shader
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  bind(gl.getAttribLocation(prog, 'aPos'), geom.pos, 3);
  bind(gl.getAttribLocation(prog, 'aNormal'), geom.nrm, 3);
  bind(gl.getAttribLocation(prog, 'aColor'), geom.col, 3);
  gl.bindVertexArray(null);
  return { vao, count: geom.pos.length / 3, tris: geom.pos.length / 9, instanced: false };
}

// Upload an instanced mesh from a base geometry + per-instance matrices/tints.
export function createInstancedMesh(gl, prog, geom, matrices, tints) {
  const mesh = createMesh(gl, prog, geom);
  const vao = mesh.vao;
  gl.bindVertexArray(vao);
  const matData = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => matData.set(m, i * 16));
  const matBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, matBuf);
  gl.bufferData(gl.ARRAY_BUFFER, matData, gl.STATIC_DRAW);
  const tintBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tints.flat()), gl.STATIC_DRAW);
  bindInstanceAttribs(gl, prog, matBuf, tintBuf);
  gl.bindVertexArray(null);
  mesh.instanced = true;
  mesh.instances = matrices.length;
  return mesh;
}

function bindInstanceAttribs(gl, prog, matBuf, tintBuf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, matBuf);
  for (let k = 0; k < 4; k++) {
    const loc = gl.getAttribLocation(prog, 'aMat' + k);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, k * 16);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
  const tintLoc = gl.getAttribLocation(prog, 'aTint');
  gl.enableVertexAttribArray(tintLoc);
  gl.vertexAttribPointer(tintLoc, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(tintLoc, 1);
}

// Dynamic instanced mesh: matrices/tints re-uploaded every frame (vehicles,
// peds, rain). Capacity is preallocated; update sets the visible count.
export function createDynamicInstancedMesh(gl, prog, geom, capacity) {
  const mesh = createMesh(gl, prog, geom);
  const vao = mesh.vao;
  gl.bindVertexArray(vao);
  const matBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, matBuf);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 64, gl.DYNAMIC_DRAW);
  const tintBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 12, gl.DYNAMIC_DRAW);
  bindInstanceAttribs(gl, prog, matBuf, tintBuf);
  gl.bindVertexArray(null);
  mesh.instanced = true;
  mesh.dynamic = true;
  mesh.capacity = capacity;
  mesh.instances = 0;
  mesh._matBuf = matBuf;
  mesh._tintBuf = tintBuf;
  return mesh;
}

export function updateDynamicInstancedMesh(gl, mesh, matrices, tints) {
  const n = Math.min(matrices.length, mesh.capacity);
  const matData = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) matData.set(matrices[i], i * 16);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh._matBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, matData);
  const tintData = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = tints[i] || [1, 1, 1];
    tintData[i * 3] = t[0]; tintData[i * 3 + 1] = t[1]; tintData[i * 3 + 2] = t[2];
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh._tintBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, tintData);
  mesh.instances = n;
}

export function drawMesh(gl, prog, mesh, uniforms) {
  gl.useProgram(prog);
  for (const [name, value] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) continue;
    if (value.length === 16) gl.uniformMatrix4fv(loc, false, value);
    else if (value.length === 3) gl.uniform3fv(loc, value);
    else gl.uniform1f(loc, value);
  }
  gl.bindVertexArray(mesh.vao);
  if (mesh.instanced) gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, mesh.instances);
  else gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  gl.bindVertexArray(null);
  return mesh.tris * (mesh.instanced ? mesh.instances : 1);
}
