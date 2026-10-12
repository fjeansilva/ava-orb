/*
 * DotsOrb — esfera líquida feita de pontos (malha de meio-tom monocromática, estilo vetor).
 * Mesma API do FuzzyOrb / PlasmaOrb / GlassOrb. Requer THREE (r128+) como global.
 *
 *   const orb = DotsOrb.create(el, { color: '#dff6ff', density: 220 });                       // pontos monocromáticos
 *   const orb = DotsOrb.create(el, { style: 'wire', gradient: ['#4c8bff', '#ff3bd6'] });   // wireframe neon
 *   const orb = DotsOrb.create(el, { style: 'waves', gradient: ['#5df2e6', '#ff4fd8'] });  // ondas + aro neon
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

  var VERT = NOISE + '\n' + [
    'uniform float uTime, uAmp, uLevel, uScale, uFold, uSize, uPR;',
    'varying float vB;',
    'float field(vec3 p){',
    '  float base = snoise(p*1.1 + vec3(uTime*0.13, uTime*0.2, 0.0))*0.55 + snoise(p*2.2 - vec3(0.0, uTime*0.27, uTime*0.16))*0.3;',
    '  float fold = 1.0 - abs(snoise(p*1.7 + vec3(uTime*0.09, -uTime*0.18, uTime*0.05)));',
    '  return base + (fold*fold - 0.5) * uFold + snoise(p*5.5 + uTime*0.8) * 0.08 * uLevel;',
    '}',
    'vec3 disp(vec3 n){ return n * (uScale + field(n) * (uAmp + uLevel*0.16)); }',
    'void main(){',
    '  vec3 n = normalize(position);',
    '  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
    '  vec3 t2 = cross(n, t1); float e = 0.02;',
    '  vec3 p0 = disp(n), pa = disp(normalize(n + t1*e)), pb = disp(normalize(n + t2*e));',
    '  vec3 nn = normalize(cross(pa - p0, pb - p0)); if (dot(nn, n) < 0.0) nn = -nn;',
    '  vec3 N = normalize(normalMatrix * nn);',
    '  vec4 mv = modelViewMatrix * vec4(p0, 1.0);',
    '  vec3 V = normalize(-mv.xyz);',
    '  float ndv = max(dot(N, V), 0.0);',
    '  vec3 L = normalize(vec3(-0.5, 0.7, 0.6));',
    '  float diff = max(dot(N, L), 0.0);',
    '  float rim = pow(1.0 - ndv, 2.0);',
    // brilho: luz + borda; pontos de costas ficam fracos (dá a transparência de malha)
    '  float facing = smoothstep(-0.2, 0.35, dot(N, V));',
    '  vB = (0.08 + diff*0.75 + rim*0.6) * mix(0.12, 1.0, facing);',
    '  gl_PointSize = uSize * uPR * (0.6 + 0.9*vB) * (4.2 / -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform vec3 uColor; uniform float uGlow;',
    'varying float vB;',
    'void main(){',
    '  vec2 d = gl_PointCoord - 0.5; float r = length(d);',
    '  float a = smoothstep(0.5, 0.28, r);',
    '  float b = clamp(vB, 0.0, 1.4) * uGlow;',
    '  gl_FragColor = vec4(uColor * b, a * min(1.0, b));',
    '}'
  ].join('\n');

  // linhas (wireframe / ondas): mesmo campo líquido, cor por gradiente, brilho por luz e borda
  var LINE_VERT = NOISE + '\n' + [
    'uniform float uTime, uAmp, uLevel, uScale, uFold;',
    'uniform vec3 uColA, uColB;',
    'varying vec3 vC; varying float vB;',
    'float field(vec3 p){',
    '  float base = snoise(p*1.1 + vec3(uTime*0.13, uTime*0.2, 0.0))*0.55 + snoise(p*2.2 - vec3(0.0, uTime*0.27, uTime*0.16))*0.3;',
    '  float fold = 1.0 - abs(snoise(p*1.7 + vec3(uTime*0.09, -uTime*0.18, uTime*0.05)));',
    '  return base + (fold*fold - 0.5) * uFold + snoise(p*5.5 + uTime*0.8) * 0.08 * uLevel;',
    '}',
    'vec3 disp(vec3 n){ return n * (uScale + field(n) * (uAmp + uLevel*0.16)); }',
    'void main(){',
    '  vec3 n = normalize(position);',
    '  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
    '  vec3 t2 = cross(n, t1); float e = 0.02;',
    '  vec3 p0 = disp(n), pa = disp(normalize(n + t1*e)), pb = disp(normalize(n + t2*e));',
    '  vec3 nn = normalize(cross(pa - p0, pb - p0)); if (dot(nn, n) < 0.0) nn = -nn;',
    '  vec3 N = normalize(normalMatrix * nn);',
    '  vec4 mv = modelViewMatrix * vec4(p0, 1.0); vec3 V = normalize(-mv.xyz);',
    '  float ndv = dot(N, V);',
    '  float rim = pow(1.0 - clamp(ndv, 0.0, 1.0), 1.5);',
    '  float facing = smoothstep(-0.3, 0.3, ndv);',
    '  vB = (0.5 + rim*1.1) * mix(0.3, 1.0, facing);',
    '  vC = mix(uColA, uColB, clamp((n.x - n.y) * 0.5 + 0.5, 0.0, 1.0));',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var LINE_FRAG = [
    'precision highp float; uniform float uGlow; varying vec3 vC; varying float vB;',
    'void main(){ float b = clamp(vB, 0.0, 1.5) * uGlow; gl_FragColor = vec4(vC * b, min(1.0, b)); }'
  ].join('\n');

  // geometria de linhas: 'wire' = paralelos + meridianos; 'waves' = só paralelos
  function lineGeometry(style, lat, lon) {
    var pos = [];
    function P(i, j) { var ph = Math.PI * i / lat, th = 2 * Math.PI * j / lon; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; }
    for (var i = 1; i < lat; i++) for (var j = 0; j < lon; j++) { var a = P(i, j), b = P(i, (j + 1) % lon); pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
    if (style === 'wire') for (var jj = 0; jj < lon; jj += 2) for (var ii = 0; ii < lat; ii++) { var c = P(ii, jj), d = P(ii + 1, jj); pos.push(c[0], c[1], c[2], d[0], d[1], d[2]); }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
  }

  var STATES = {
    idle:      { amp: 0.11, fold: 0.16, scale: 1.0,  glow: 1.0,  pulseHz: 0.22, pulse: 0.02, spin: 0.1 },
    listening: { amp: 0.14, fold: 0.2,  scale: 1.04, glow: 1.15, pulseHz: 0.45, pulse: 0.015, spin: 0.05 },
    thinking:  { amp: 0.2,  fold: 0.3,  scale: 0.97, glow: 1.0,  pulseHz: 0.8,  pulse: 0.02, spin: 0.6 },
    speaking:  { amp: 0.16, fold: 0.22, scale: 1.02, glow: 1.3,  pulseHz: 0.35, pulse: 0.015, spin: 0.15 },
    sleeping:  { amp: 0.04, fold: 0.05, scale: 0.92, glow: 0.45, pulseHz: 0.1,  pulse: 0.03, spin: 0.03 }
  };

  function create(container, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined') throw new Error('DotsOrb: THREE não encontrado');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pr = Math.min(root.devicePixelRatio || 1, 2);
    var renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(pr); renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    container.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50); camera.position.set(0, 0, 6.2);
    var rig = new THREE.Group(); scene.add(rig);

    var density = opts.density || 220;
    var sphere = new THREE.SphereGeometry(1, density, Math.round(density * 0.7));
    var geo = new THREE.BufferGeometry(); geo.setAttribute('position', sphere.getAttribute('position'));
    var U = { uTime: { value: 0 }, uAmp: { value: 0.11 }, uLevel: { value: 0 }, uScale: { value: 1 }, uFold: { value: 0.16 }, uSize: { value: opts.size || 2.2 }, uPR: { value: pr }, uGlow: { value: 1 }, uColor: { value: new THREE.Color(opts.color || '#e6f7ff') } };
    var style = opts.style || 'dots';
    var grad = opts.gradient || ['#4c8bff', '#ff3bd6'];
    var LU = { uTime: U.uTime, uAmp: U.uAmp, uLevel: U.uLevel, uScale: U.uScale, uFold: U.uFold, uGlow: U.uGlow, uColA: { value: new THREE.Color(grad[0]) }, uColB: { value: new THREE.Color(grad[1]) } };
    var lines = null, rim = null;
    if (style === 'wire' || style === 'waves') {
      lines = new THREE.LineSegments(lineGeometry(style, style === 'wire' ? 36 : 44, style === 'wire' ? 72 : 96),
        new THREE.ShaderMaterial({ uniforms: LU, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      rig.add(lines);
      // no wireframe a malha de pontos vira só uma poeira esparsa nos vértices; nas ondas some
      if (style === 'wire') { density = 60; U.uSize.value = opts.size || 1.6; }
      if (style === 'waves') {
        // aro neon no contorno, sempre virado para a câmera
        var RU = { uGlow: { value: 1 }, uColA: LU.uColA, uColB: LU.uColB };
        rim = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.16, 180, 1), new THREE.ShaderMaterial({ uniforms: RU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          vertexShader: 'varying vec2 vXY; void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'precision highp float; uniform float uGlow; uniform vec3 uColA, uColB; varying vec2 vXY; void main(){ float r = length(vXY); float t = (r - 0.98) / 0.18; float line = pow(1.0 - abs(t - 0.35) / 0.35, 2.0); float soft = smoothstep(0.0, 0.3, t) * smoothstep(1.0, 0.4, t); float a = (max(line, 0.0) * 0.9 + soft * 0.25) * uGlow; float ang = atan(vXY.y, vXY.x); vec3 c = mix(uColA, uColB, smoothstep(-0.9, 0.9, cos(ang - 0.7))); gl_FragColor = vec4(c * a, a); }' }));
        rim.userData.u = RU; scene.add(rim);
      }
    }
    var halo = null;
    if (style === 'wire' || style === 'waves') {
      var HS = 256, hc = document.createElement('canvas'); hc.width = hc.height = HS; var hg = hc.getContext('2d');
      var hgr = hg.createRadialGradient(HS / 2, HS / 2, 0, HS / 2, HS / 2, HS / 2); hgr.addColorStop(0, 'rgba(255,255,255,0.9)'); hgr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); hgr.addColorStop(1, 'rgba(255,255,255,0)');
      hg.fillStyle = hgr; hg.fillRect(0, 0, HS, HS);
      halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hc), color: new THREE.Color(grad[0]).lerp(new THREE.Color(grad[1]), 0.5), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.set(3.4, 3.4, 1); halo.position.z = -0.5; rig.add(halo);
    }
    if (style === 'wire') { sphere = new THREE.SphereGeometry(1, density, Math.round(density * 0.7)); geo = new THREE.BufferGeometry(); geo.setAttribute('position', sphere.getAttribute('position')); }
    var pts = null;
    if (style !== 'waves') {
      pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      if (style === 'wire') U.uColor.value.set(grad[1]).lerp(new THREE.Color('#ffffff'), 0.5);
      rig.add(pts);
    }

    var cur = Object.assign({}, STATES.idle), target = Object.assign({}, STATES.idle), stateName = 'idle';
    var extLevel = 0, smoothLevel = 0, t0 = performance.now(), last = t0, running = true, raf = 0;
    function resize() { var w = container.clientWidth || 200, h = container.clientHeight || w; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    resize(); var ro = root.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(container);
    function lerp(a, b, k) { return a + (b - a) * k; }
    function frame() {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var now = performance.now(), dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000)); last = now;
      var t = (now - t0) / 1000, k = 1 - Math.pow(0.02, dt);
      for (var key in target) cur[key] = lerp(cur[key], target[key], k);
      smoothLevel = extLevel > smoothLevel ? lerp(smoothLevel, extLevel, 1 - Math.pow(0.001, dt)) : lerp(smoothLevel, extLevel, 1 - Math.pow(0.1, dt));
      var lvl = reduced ? smoothLevel * 0.5 : smoothLevel, tt = reduced ? t * 0.35 : t;
      U.uTime.value = tt; U.uAmp.value = reduced ? cur.amp * 0.4 : cur.amp; U.uFold.value = cur.fold; U.uLevel.value = lvl; U.uGlow.value = cur.glow;
      U.uScale.value = cur.scale + Math.sin(t * Math.PI * 2 * cur.pulseHz) * cur.pulse + lvl * 0.05;
      rig.rotation.y = t * 0.1 * cur.spin + Math.sin(t * 0.2) * 0.12; rig.rotation.x = Math.sin(t * 0.15) * 0.08;
      if (rim) { rim.scale.setScalar(U.uScale.value * (1 + lvl * 0.03)); rim.userData.u.uGlow.value = 0.8 * cur.glow + lvl * 0.5; }
      if (halo) { halo.material.opacity = 0.22 * cur.glow + lvl * 0.15; }
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVis);
    function onVis() { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }

    var audio = { ctx: null, analyser: null, data: null, stream: null, timer: 0, src: null };
    function startMeter(node) {
      stopMeter();
      audio.analyser = audio.ctx.createAnalyser(); audio.analyser.fftSize = 1024; audio.analyser.smoothingTimeConstant = 0.6;
      audio.data = new Float32Array(audio.analyser.fftSize); node.connect(audio.analyser);
      (function tick() {
        audio.timer = requestAnimationFrame(tick); audio.analyser.getFloatTimeDomainData(audio.data);
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
      setState: function (name) { if (!STATES[name]) throw new Error('DotsOrb: estado desconhecido ' + name); stateName = name; target = Object.assign({}, STATES[name]); renderer.domElement.setAttribute('data-state', name); return api; },
      setLevel: function (v) { extLevel = Math.max(0, Math.min(1, v || 0)); return api; },
      setColor: function (hex, hex2) { U.uColor.value.set(hex); LU.uColA.value.set(hex); if (hex2) LU.uColB.value.set(hex2); if (halo) halo.material.color.set(hex).lerp(new THREE.Color(hex2 || hex), 0.5); return api; },
      attachMic: function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia indisponível'));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) { api.attachStream(stream); audio.stream = stream; return stream; });
      },
      attachStream: function (stream) { startMeter(ctxReady().createMediaStreamSource(stream)); return api; },
      attachAudio: function (el) { var c = ctxReady(); if (!audio.src || audio.src.mediaElement !== el) { audio.src = c.createMediaElementSource(el); audio.src.connect(c.destination); } startMeter(audio.src); return api; },
      detachAudio: function () { stopMeter(); if (audio.stream) { audio.stream.getTracks().forEach(function (tr) { tr.stop(); }); audio.stream = null; } return api; },
      dispose: function () {
        running = false; cancelAnimationFrame(raf); api.detachAudio(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
        geo.dispose(); if (pts) pts.material.dispose(); if (lines) { lines.geometry.dispose(); lines.material.dispose(); } if (rim) { rim.geometry.dispose(); rim.material.dispose(); } if (halo) { halo.material.map.dispose(); halo.material.dispose(); } renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    api.setState(opts.state || 'idle');
    return api;
  }

  root.DotsOrb = { create: create, STATES: STATES };
})(typeof window !== 'undefined' ? window : this);
