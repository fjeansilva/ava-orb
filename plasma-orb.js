/*
 * PlasmaOrb — núcleo de luz líquida com anéis de energia (estilo "programa de computador").
 * Mesma API do FuzzyOrb: create(el, opts) → { setState, setLevel, attachMic, attachStream, attachAudio, detachAudio, setColor, dispose, state, level }
 * Requer THREE (r128+) como global.
 *
 *   const orb = PlasmaOrb.create(el, { color: '#38c6ff', core: '#ffd9a0' });
 */
(function (root) {
  'use strict';

  var NOISE = [
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    ' const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    ' vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);',
    ' vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);',
    ' vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;',
    ' i=mod289(i);',
    ' vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    ' float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;',
    ' vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);',
    ' vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);',
    ' vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);',
    ' vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));',
    ' vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    ' vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);',
    ' vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    ' p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;',
    ' vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;',
    ' return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}'
  ].join('\n');

  // ---- núcleo líquido ----
  var CORE_VERT = NOISE + '\n' + [
    'uniform float uTime, uAmp, uLevel, uScale;',
    'varying vec3 vN, vV, vP;',
    'float field(vec3 p){',
    '  return snoise(p*1.1 + vec3(uTime*0.18, uTime*0.27, 0.0))*0.6',
    '       + snoise(p*2.3 - vec3(0.0, uTime*0.41, uTime*0.22))*0.3',
    '       + snoise(p*4.6 + vec3(uTime*0.7))*0.1*(0.3 + uLevel);',
    '}',
    'vec3 disp(vec3 p){ return p * (uScale + field(p) * (uAmp + uLevel*0.18)); }',
    'void main(){',
    '  vec3 n = normalize(normal);',
    '  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
    '  vec3 t2 = cross(n, t1); float e = 0.025;',
    '  vec3 p0 = disp(n), pa = disp(normalize(n + t1*e)), pb = disp(normalize(n + t2*e));',
    '  vec3 nn = normalize(cross(pa - p0, pb - p0)); if (dot(nn, n) < 0.0) nn = -nn;',
    '  vP = n; vN = normalize(normalMatrix * nn);',
    '  vec4 mv = modelViewMatrix * vec4(p0, 1.0); vV = -mv.xyz;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var CORE_FRAG = NOISE + '\n' + [
    'precision highp float;',
    'uniform float uTime, uGlow, uWarm, uLevel, uBack;',
    'uniform vec3 uColor, uCore, uWhite;',
    'varying vec3 vN, vV, vP;',
    'void main(){',
    '  vec3 N = normalize(vN); vec3 V = normalize(vV);',
    '  float ndv = max(dot(N, V), 0.0);',
    '  float fres = pow(1.0 - ndv, 1.6);',
    // veias de luz: linhas finas onde o ruído cruza zero, deslizando pela superfície
    '  float v1 = snoise(vP*2.6 + vec3(0.0, uTime*0.25, uTime*0.1));',
    '  float v2 = snoise(vP*4.2 - vec3(uTime*0.2, 0.0, uTime*0.15));',
    '  float veins = pow(1.0 - min(1.0, abs(v1)*2.2), 6.0)*0.8 + pow(1.0 - min(1.0, abs(v2)*2.6), 8.0)*0.5;',
    // centro morno (quase transparente), borda ciano, veias brancas
    '  vec3 col = mix(uCore * uWarm, uColor, fres);',
    '  float alpha = (0.08 + 0.55*fres) * uGlow;',
    '  col += uWhite * veins * (0.35 + 0.6*fres) * uGlow;',
    '  alpha += veins * 0.35 * uGlow;',
    '  alpha *= mix(1.0, 0.55, uBack);',
    '  col += uColor * uLevel * 0.35;',
    '  gl_FragColor = vec4(col * alpha, alpha);',
    '}'
  ].join('\n');

  // ---- anéis ----
  var RING_VERT = [
    'varying vec2 vXY;',
    'void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');
  var RING_FRAG = NOISE + '\n' + [
    'precision highp float;',
    'uniform float uTime, uInner, uOuter, uSpin, uSeed, uGlow, uDash, uLevel;',
    'uniform vec3 uColor;',
    'varying vec2 vXY;',
    'void main(){',
    '  float r = length(vXY); float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);',
    '  float a = atan(vXY.y, vXY.x) + uTime * uSpin;',
    '  float radial = smoothstep(0.0, 0.35, t) * smoothstep(1.0, 0.55, t);',
    '  float n = snoise(vec3(cos(a)*2.2, sin(a)*2.2, uSeed + uTime*0.15)) * 0.5 + 0.5;',
    '  float seg = smoothstep(0.25, 0.6, snoise(vec3(cos(a)*uDash, sin(a)*uDash, uSeed*3.0)) * 0.5 + 0.5);',
    '  float arc = mix(n, n * seg, 0.65);',
    '  float sharp = pow(1.0 - abs(t - 0.5) * 2.0, 3.0);',          // linha fina no meio do anel
    '  float alpha = (radial * 0.45 + sharp * 0.9) * arc * uGlow * 1.7 * (0.75 + uLevel*0.5);',
    '  vec3 col = mix(uColor, vec3(1.0), sharp * 0.45);',
    '  gl_FragColor = vec4(col * alpha, alpha);',
    '}'
  ].join('\n');

  var STATES = {
    idle:      { glow: 0.85, amp: 0.10, scale: 1.0,  spin: 0.6, spread: 1.0,  warm: 1.0, pulseHz: 0.25, pulse: 0.03, haze: 0.8, drift: 0.3 },
    listening: { glow: 1.15, amp: 0.14, scale: 1.04, spin: 0.9, spread: 1.08, warm: 1.1, pulseHz: 0.5,  pulse: 0.02, haze: 1.0, drift: 0.5 },
    thinking:  { glow: 1.0,  amp: 0.20, scale: 0.96, spin: 2.2, spread: 0.94, warm: 0.8, pulseHz: 0.9,  pulse: 0.03, haze: 0.9, drift: 1.2 },
    speaking:  { glow: 1.3,  amp: 0.16, scale: 1.02, spin: 1.1, spread: 1.04, warm: 1.25, pulseHz: 0.35, pulse: 0.02, haze: 1.15, drift: 0.6 },
    sleeping:  { glow: 0.35, amp: 0.05, scale: 0.9,  spin: 0.15, spread: 0.85, warm: 0.5, pulseHz: 0.12, pulse: 0.04, haze: 0.35, drift: 0.1 }
  };

  var glowTex = null;
  function glowTexture() {
    if (glowTex) return glowTex;
    var S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    glowTex = new THREE.CanvasTexture(c); return glowTex;
  }

  function create(container, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined') throw new Error('PlasmaOrb: THREE não encontrado');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var color = new THREE.Color(opts.color || '#3ec9ff');
    var core = new THREE.Color(opts.core || '#ffd3a1');
    var deep = color.clone().offsetHSL(0.04, 0, -0.18);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50); camera.position.set(0, 0, 8.2);
    var rig = new THREE.Group(); scene.add(rig);

    // névoa de fundo (duas camadas) e brilho morno do núcleo
    var spriteMat = function (c, op) { return new THREE.SpriteMaterial({ map: glowTexture(), color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }); };
    var haze = new THREE.Sprite(spriteMat(deep, 0.55)); haze.scale.set(7.5, 7.5, 1); haze.position.z = -1.5; rig.add(haze);
    var haze2 = new THREE.Sprite(spriteMat(color, 0.35)); haze2.scale.set(4.2, 4.2, 1); haze2.position.z = -0.8; rig.add(haze2);
    var coreGlow = new THREE.Sprite(spriteMat(core, 0.6)); coreGlow.scale.set(2.4, 2.4, 1); coreGlow.position.z = -0.3; rig.add(coreGlow);

    // núcleo líquido: costas (interior) e frente
    var coreU = {
      uTime: { value: 0 }, uAmp: { value: 0.1 }, uLevel: { value: 0 }, uScale: { value: 1 }, uGlow: { value: 1 }, uWarm: { value: 1 },
      uColor: { value: color.clone() }, uCore: { value: core.clone() }, uWhite: { value: new THREE.Color(0xeaf7ff) }, uBack: { value: 0 }
    };
    var coreGeo = new THREE.SphereGeometry(1, 128, 96);
    function coreMat(back) {
      var u = {}; for (var k in coreU) u[k] = coreU[k]; u.uBack = { value: back ? 1 : 0 };
      return new THREE.ShaderMaterial({ uniforms: u, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: back ? THREE.BackSide : THREE.FrontSide });
    }
    var coreBack = new THREE.Mesh(coreGeo, coreMat(true)); coreBack.renderOrder = 1; rig.add(coreBack);
    var coreFront = new THREE.Mesh(coreGeo, coreMat(false)); coreFront.renderOrder = 2; rig.add(coreFront);

    // anéis: raio, largura, giro, inclinação, cor
    var RINGS = [
      { r: 1.55, w: 0.22, spin: 0.35, tilt: [0.18, -0.10], dash: 3.0, col: color, glow: 0.9 },
      { r: 1.95, w: 0.30, spin: -0.22, tilt: [0.30, 0.12], dash: 5.0, col: color, glow: 0.8 },
      { r: 2.35, w: 0.45, spin: 0.14, tilt: [0.42, -0.22], dash: 7.0, col: deep, glow: 0.7 },
      { r: 2.8, w: 0.55, spin: -0.09, tilt: [0.5, 0.3], dash: 9.0, col: deep, glow: 0.45 }
    ];
    var rings = RINGS.map(function (d, i) {
      var inner = d.r - d.w / 2, outer = d.r + d.w / 2;
      var u = { uTime: { value: 0 }, uInner: { value: inner }, uOuter: { value: outer }, uSpin: { value: d.spin }, uSeed: { value: i * 7.3 }, uGlow: { value: d.glow }, uDash: { value: d.dash }, uLevel: { value: 0 }, uColor: { value: d.col.clone() } };
      var m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 1), new THREE.ShaderMaterial({ uniforms: u, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.rotation.set(d.tilt[0], d.tilt[1], 0); m.renderOrder = 3 + i; m.userData = { d: d, u: u, baseR: d.r }; rig.add(m);
      return m;
    });
    // ondas emitidas na fala: anéis que nascem no núcleo e se expandem
    var waves = [];
    function emitWave() {
      if (waves.length > 5) return;
      var u = { uTime: { value: 0 }, uInner: { value: 0.9 }, uOuter: { value: 1.1 }, uSpin: { value: 0 }, uSeed: { value: Math.random() * 50 }, uGlow: { value: 0.9 }, uDash: { value: 2.0 }, uLevel: { value: 0 }, uColor: { value: color.clone() } };
      var m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 120, 1), new THREE.ShaderMaterial({ uniforms: u, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.rotation.set(0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3, 0); m.renderOrder = 8; m.userData = { t: 0, u: u }; rig.add(m); waves.push(m);
    }

    // poeira de luz
    var N = 220, pos = new Float32Array(N * 3), seeds = [];
    for (var i = 0; i < N; i++) { var rr = 1.4 + Math.random() * 2.2, th = Math.random() * Math.PI * 2, ph = (Math.random() - 0.5) * 1.2; seeds.push({ r: rr, th: th, ph: ph, sp: 0.1 + Math.random() * 0.25 }); }
    var dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTexture(), color: color, size: 0.09, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    dust.renderOrder = 9; rig.add(dust);

    var cur = Object.assign({}, STATES.idle), target = Object.assign({}, STATES.idle), stateName = 'idle';
    var extLevel = 0, smoothLevel = 0, lastWave = 0, t0 = performance.now(), last = t0, running = true, raf = 0;

    function resize() { var w = container.clientWidth || 200, h = container.clientHeight || w; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    resize(); var ro = root.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(container);
    function lerp(a, b, k) { return a + (b - a) * k; }

    function frame() {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var now = performance.now(), dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000)); last = now;
      var t = (now - t0) / 1000, k = 1 - Math.pow(0.02, dt);
      for (var key in target) cur[key] = lerp(cur[key], target[key], k);
      var want = extLevel;
      smoothLevel = want > smoothLevel ? lerp(smoothLevel, want, 1 - Math.pow(0.001, dt)) : lerp(smoothLevel, want, 1 - Math.pow(0.1, dt));
      var lvl = reduced ? smoothLevel * 0.5 : smoothLevel, tt = reduced ? t * 0.35 : t;
      var pulse = Math.sin(t * Math.PI * 2 * cur.pulseHz) * cur.pulse;

      coreU.uTime.value = tt; coreU.uAmp.value = reduced ? cur.amp * 0.4 : cur.amp; coreU.uLevel.value = lvl;
      coreU.uScale.value = cur.scale + pulse + lvl * 0.06; coreU.uGlow.value = cur.glow; coreU.uWarm.value = cur.warm;
      coreGlow.material.opacity = 0.45 * cur.glow * cur.warm + lvl * 0.3; coreGlow.scale.setScalar(2.4 * (cur.scale + pulse) + lvl * 0.6);
      haze.material.opacity = 0.5 * cur.haze; haze2.material.opacity = 0.3 * cur.haze + lvl * 0.15;

      rings.forEach(function (m, i) {
        var u = m.userData.u, d = m.userData.d;
        u.uTime.value = tt * cur.spin; u.uLevel.value = lvl; u.uGlow.value = d.glow * cur.glow;
        var s = cur.spread + Math.sin(t * 0.6 + i) * 0.015 + lvl * 0.03 * (i + 1);
        m.scale.setScalar(s);
        m.rotation.x = d.tilt[0] + Math.sin(t * 0.21 + i) * 0.05 * cur.drift;
        m.rotation.y = d.tilt[1] + Math.cos(t * 0.17 + i * 2.0) * 0.06 * cur.drift;
      });
      // fala: a cada pico de nível nasce uma onda
      if (lvl > 0.45 && now - lastWave > 260 && stateName === 'speaking') { emitWave(); lastWave = now; }
      for (var w = waves.length - 1; w >= 0; w--) {
        var wv = waves[w]; wv.userData.t += dt; var p = wv.userData.t / 1.6;
        if (p >= 1) { rig.remove(wv); wv.geometry.dispose(); wv.material.dispose(); waves.splice(w, 1); continue; }
        wv.scale.setScalar(1 + p * 2.4); wv.userData.u.uGlow.value = (1 - p) * (1 - p) * 0.9; wv.userData.u.uTime.value = tt;
      }
      var arr = dust.geometry.attributes.position.array;
      for (var j = 0; j < N; j++) { var sd = seeds[j], a = sd.th + t * sd.sp * (0.5 + cur.drift); arr[j * 3] = Math.cos(a) * sd.r; arr[j * 3 + 1] = Math.sin(a) * sd.r * 0.55 + Math.sin(t * 0.7 + j) * 0.08; arr[j * 3 + 2] = Math.sin(a) * sd.r * 0.35 * sd.ph; }
      dust.geometry.attributes.position.needsUpdate = true; dust.material.opacity = 0.5 * cur.glow;

      rig.rotation.y = Math.sin(t * 0.11) * 0.08; rig.rotation.x = Math.cos(t * 0.09) * 0.05;
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVis);
    function onVis() { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }

    // ---- áudio ----
    var audio = { ctx: null, analyser: null, data: null, stream: null, timer: 0, src: null };
    function startMeter(node) {
      stopMeter();
      audio.analyser = audio.ctx.createAnalyser(); audio.analyser.fftSize = 1024; audio.analyser.smoothingTimeConstant = 0.6;
      audio.data = new Float32Array(audio.analyser.fftSize); node.connect(audio.analyser);
      (function tick() {
        audio.timer = requestAnimationFrame(tick);
        audio.analyser.getFloatTimeDomainData(audio.data);
        var sum = 0; for (var i = 0; i < audio.data.length; i++) sum += audio.data[i] * audio.data[i];
        extLevel = Math.min(1, Math.max(0, (Math.sqrt(sum / audio.data.length) - 0.012) * 6.5));
      })();
    }
    function stopMeter() { if (audio.timer) cancelAnimationFrame(audio.timer); audio.timer = 0; extLevel = 0; }
    function ctxReady() { audio.ctx = audio.ctx || new (root.AudioContext || root.webkitAudioContext)(); if (audio.ctx.state === 'suspended') audio.ctx.resume(); return audio.ctx; }

    var api = {
      el: renderer.domElement,
      get state() { return stateName; },
      get level() { return extLevel; },
      setState: function (name) {
        if (!STATES[name]) throw new Error('PlasmaOrb: estado desconhecido ' + name);
        stateName = name; target = Object.assign({}, STATES[name]); renderer.domElement.setAttribute('data-state', name); return api;
      },
      setLevel: function (v) { extLevel = Math.max(0, Math.min(1, v || 0)); return api; },
      setColor: function (hex, coreHex) {
        color.set(hex); deep.copy(color).offsetHSL(0.04, 0, -0.18); if (coreHex) core.set(coreHex);
        coreU.uColor.value.copy(color); coreU.uCore.value.copy(core);
        haze.material.color.copy(deep); haze2.material.color.copy(color); coreGlow.material.color.copy(core); dust.material.color.copy(color);
        rings.forEach(function (m, i) { m.userData.u.uColor.value.copy(i < 2 ? color : deep); });
        return api;
      },
      attachMic: function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia indisponível'));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) { api.attachStream(stream); audio.stream = stream; return stream; });
      },
      attachStream: function (stream) { startMeter(ctxReady().createMediaStreamSource(stream)); return api; },
      attachAudio: function (el) {
        var c = ctxReady();
        if (!audio.src || audio.src.mediaElement !== el) { audio.src = c.createMediaElementSource(el); audio.src.connect(c.destination); }
        startMeter(audio.src); return api;
      },
      detachAudio: function () { stopMeter(); if (audio.stream) { audio.stream.getTracks().forEach(function (tr) { tr.stop(); }); audio.stream = null; } return api; },
      dispose: function () {
        running = false; cancelAnimationFrame(raf); api.detachAudio(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
        rig.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    api.setState(opts.state || 'idle');
    return api;
  }

  root.PlasmaOrb = { create: create, STATES: STATES };
})(typeof window !== 'undefined' ? window : this);
