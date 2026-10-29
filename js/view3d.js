// three.js studio: mannequin, draped shirt, orbit camera, picking back into pattern space.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clothNormals } from './sim/drape.js';

const VIEWS = {
  front: [0, 0],
  back: [180, 0],
  left: [90, 0],
  right: [-90, 0],
  three: [32, 8],
};

// Coolmax-style mesh knit as a tiling normal map: rows of small holes on a hex grid.
function meshFabricNormalMap() {
  const S = 128;
  const h = new Float32Array(S * S);
  const cell = S / 8;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 1;
      for (let j = -1; j <= 9; j++) {
        const cy = j * cell * 0.866;
        const ox = j % 2 ? cell / 2 : 0;
        for (let i = -1; i <= 9; i++) {
          const cx = i * cell + ox;
          let dx = Math.abs(x - cx), dy = Math.abs(y - cy);
          dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy);
          const d = Math.hypot(dx, dy) / (cell * 0.32);
          if (d < 1.4) v = Math.min(v, Math.max(0, d - 0.4));
        }
      }
      h[y * S + x] = v;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = h[y * S + ((x - 1 + S) % S)], r = h[y * S + ((x + 1) % S)];
      const u = h[((y - 1 + S) % S) * S + x], d = h[((y + 1) % S) * S + x];
      let nx = (l - r) * 1.6, ny = (d - u) * 1.6, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const k = (y * S + x) * 4;
      img.data[k] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Dress the mannequin as a runner with vertex colours: dark half tights and shoes.
function runnerColors(positions) {
  const skin = new THREE.Color(0xd8d5ce).convertSRGBToLinear();
  const kit = new THREE.Color(0x26292b).convertSRGBToLinear();
  const shoe = new THREE.Color(0x3a3d40).convertSRGBToLinear();
  const out = new Float32Array(positions.length);
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < positions.length; i += 3) {
    const x = Math.abs(positions[i]), y = positions[i + 1];
    // tights from the waist to just above the knee, but not the hands hanging beside them
    const tights = smooth(66, 68, y) * (1 - smooth(103, 105, y)) * (1 - smooth(25, 27, x));
    const shoes = 1 - smooth(9, 10.5, y);
    const c = skin.clone().lerp(kit, tights).lerp(shoe, shoes);
    out[i] = c.r;
    out[i + 1] = c.g;
    out[i + 2] = c.b;
  }
  return out;
}

// The studio backdrop, painted from the page's theme tokens so it follows light/dark mode.
function studioBackdrop() {
  const css = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 150, 20, 256, 220, 420);
  g.addColorStop(0, tok('--studio-hi', '#e2e4df'));
  g.addColorStop(0.6, tok('--studio', '#d3d6d0'));
  g.addColorStop(1, tok('--studio-lo', '#c4c8c1'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Viewer3D {
  constructor(container) {
    this.container = container;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    // neutral tone mapping keeps garment colours true (a black shirt stays black, vinyl stays its colour)
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.38;
    const refreshBackdrop = () => {
      scene.background?.dispose?.();
      scene.background = studioBackdrop();
    };
    refreshBackdrop();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshBackdrop);
    new MutationObserver(refreshBackdrop).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const camera = (this.camera = new THREE.PerspectiveCamera(26, 1, 10, 3000));
    this.target = new THREE.Vector3(0, 118, 0);
    camera.position.set(0, 128, 330);
    const controls = (this.controls = new OrbitControls(camera, renderer.domElement));
    controls.target.copy(this.target);
    controls.enableDamping = true;
    controls.minDistance = 70;
    controls.maxDistance = 600;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.update();

    // studio lighting: warm key with soft shadows, cool fill, two rims to pick out the silhouette
    const key = new THREE.DirectionalLight(0xfff1e2, 2.5);
    key.position.set(150, 280, 230);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    Object.assign(key.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 50, far: 800 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.5;
    key.target.position.set(0, 100, 0);
    const fill = new THREE.DirectionalLight(0xdce6ff, 0.65);
    fill.position.set(-260, 150, 170);
    const rimL = new THREE.DirectionalLight(0xffffff, 1.5);
    rimL.position.set(-180, 260, -260);
    const rimR = new THREE.DirectionalLight(0xf3f6ff, 1.0);
    rimR.position.set(220, 200, -230);
    scene.add(key, key.target, fill, rimL, rimR);
    scene.add(new THREE.HemisphereLight(0xf6f7f3, 0x55584f, 0.35));

    const floor = new THREE.Mesh(new THREE.CircleGeometry(140, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.fabricNormal = meshFabricNormalMap();
    this.mannequinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.0 });
    // the shirt: print colour and finish come from the atlas; sheen gives knit fabric its soft
    // grazing-angle highlight
    this.clothOuter = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 1,
      normalMap: this.fabricNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      sheen: 0.7,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0x3c3f42),
      side: THREE.FrontSide,
    });
    this.clothInner = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.95,
      normalMap: this.fabricNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      side: THREE.BackSide,
    });

    // ambient occlusion darkens folds, armpits and where the shirt meets the body; skipped on
    // touch devices to keep phones smooth
    if (!window.matchMedia('(pointer: coarse)').matches) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }); // keep MSAA
      const composer = (this.composer = new EffectComposer(renderer, target));
      composer.addPass(new RenderPass(scene, camera));
      const gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 7, distanceExponent: 1.6, thickness: 3, scale: 1.1, samples: 16, distanceFallOff: 1 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
    }

    this.raycaster = new THREE.Raycaster();
    this.tween = null;
    this.autoRotate = false;
    this._resize = () => this.resize();
    new ResizeObserver(this._resize).observe(container);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this._tick();
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    // keep the whole figure in frame on tall narrow layouts
    this.camera.fov = w / h < 0.75 ? 34 : 26;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.start) / this.tween.ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const az = this.tween.az0 + (this.tween.az1 - this.tween.az0) * e;
      const el = this.tween.el0 + (this.tween.el1 - this.tween.el0) * e;
      const r = this.tween.r;
      this.camera.position.set(
        this.target.x + r * Math.cos(el) * Math.sin(az),
        this.target.y + r * Math.sin(el),
        this.target.z + r * Math.cos(el) * Math.cos(az),
      );
      if (t >= 1) this.tween = null;
    }
    this.controls.autoRotate = this.autoRotate && !this.tween;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.update();
    this.render();
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  _spherical() {
    const v = this.camera.position.clone().sub(this.controls.target);
    const r = v.length();
    return { r, az: Math.atan2(v.x, v.z), el: Math.asin(v.y / r) };
  }

  view(name, ms = 700) {
    const [azDeg, elDeg] = VIEWS[name] || VIEWS.front;
    const cur = this._spherical();
    let az1 = (azDeg * Math.PI) / 180;
    // shortest way around
    while (az1 - cur.az > Math.PI) az1 -= Math.PI * 2;
    while (az1 - cur.az < -Math.PI) az1 += Math.PI * 2;
    this.controls.target.copy(this.target);
    this.tween = { start: performance.now(), ms, az0: cur.az, az1, el0: cur.el, el1: (elDeg * Math.PI) / 180, r: Math.max(260, Math.min(cur.r, 380)) };
  }

  // Which panel is the camera mostly looking at?
  facing() {
    const { az } = this._spherical();
    return Math.cos(az) >= 0 ? 'front' : 'back';
  }

  setMannequin({ positions, normals, indices }) {
    if (this.mannequin) {
      this.scene.remove(this.mannequin);
      this.mannequin.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    else g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(runnerColors(positions), 3));
    const m = new THREE.Mesh(g, this.mannequinMat);
    m.castShadow = m.receiveShadow = true;
    this.mannequin = m;
    this.scene.add(m);
  }

  setCloth(cloth, positions, layout) {
    this.layout = layout;
    this.fabricNormal.repeat.set(layout.width / 1.6, layout.height / 1.6); // one tile ≈ 1.6 cm of fabric
    if (this.clothGroup) {
      this.scene.remove(this.clothGroup);
      this.clothGeometry.dispose();
    }
    this.cloth = cloth;
    const g = (this.clothGeometry = new THREE.BufferGeometry());
    const uv = new Float32Array(cloth.n * 2);
    for (let i = 0; i < cloth.n; i++) {
      const a = layout.toAtlas(cloth.panelOf[i] === 0 ? 'front' : 'back', cloth.uv2d[2 * i], cloth.uv2d[2 * i + 1]);
      uv[2 * i] = a.x / layout.width;
      uv[2 * i + 1] = 1 - a.y / layout.height;
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(cloth.indices, 1));
    const outer = new THREE.Mesh(g, this.clothOuter);
    const inner = new THREE.Mesh(g, this.clothInner);
    outer.castShadow = true;
    outer.receiveShadow = inner.receiveShadow = true;
    this.clothMesh = outer;
    this.clothGroup = new THREE.Group();
    this.clothGroup.add(outer, inner);
    this.scene.add(this.clothGroup);
    this.updateCloth(positions);
  }

  updateCloth(positions) {
    const g = this.clothGeometry;
    g.attributes.position.array.set(positions);
    g.attributes.position.needsUpdate = true;
    clothNormals(this.cloth, positions, g.attributes.normal.array);
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
  }

  setTextures(colorCanvas, finishCanvas) {
    this.colorTex?.dispose();
    this.finishTex?.dispose();
    const map = (this.colorTex = new THREE.CanvasTexture(colorCanvas));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const finish = (this.finishTex = new THREE.CanvasTexture(finishCanvas));
    finish.colorSpace = THREE.NoColorSpace;
    this.clothOuter.map = map;
    this.clothOuter.roughnessMap = finish;
    this.clothOuter.metalnessMap = finish;
    this.clothOuter.needsUpdate = true;
  }

  texturesChanged() {
    if (this.colorTex) this.colorTex.needsUpdate = true;
    if (this.finishTex) this.finishTex.needsUpdate = true;
  }

  setFabricColor(hex) {
    this.clothInner.color.set(hex).multiplyScalar(0.8);
    // sheen a little lighter than the fabric itself, subtler on pale fabrics
    const c = new THREE.Color(hex);
    this.clothOuter.sheenColor.copy(c).lerp(new THREE.Color(0xc8ccd0), 0.25).multiplyScalar(c.getHSL({}).l > 0.5 ? 0.35 : 1);
  }

  // Screen point -> pattern coordinates on the shirt (or null).
  pick(clientX, clientY) {
    if (!this.clothMesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.clothMesh, this.mannequin].filter(Boolean), false);
    if (!hits.length || hits[0].object !== this.clothMesh || !hits[0].uv) return null;
    const { uv } = hits[0];
    return this.layout.fromAtlas(uv.x * this.layout.width, (1 - uv.y) * this.layout.height);
  }

  screenshot() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }
}
