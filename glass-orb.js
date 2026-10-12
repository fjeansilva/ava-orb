/*
 * GlassOrb — esfera líquida transparente e iridescente (bolha holográfica / vidro líquido).
 * Mesma API do FuzzyOrb e PlasmaOrb. Requer THREE (r128+) como global.
 *
 *   const orb = GlassOrb.create(el, { tint: '#ffffff', iridescence: 1.0, dark: false });
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
    'uniform float uTime, uAmp, uLevel, uScale, uFold;',
    'varying vec3 vN, vV, vP, vW;',
    // líquido: ondas lentas + dobras (ruído em crista) que escorrem pela superfície
    'float field(vec3 p){',
    '  float base = snoise(p*1.0 + vec3(uTime*0.15, uTime*0.22, 0.0))*0.55 + snoise(p*2.1 - vec3(0.0, uTime*0.3, uTime*0.17))*0.3;',
    '  float fold = 1.0 - abs(snoise(p*1.8 + vec3(uTime*0.1, -uTime*0.2, uTime*0.05)));',
    '  return base + (fold*fold - 0.5) * uFold + snoise(p*5.0 + uTime*0.9) * 0.08 * uLevel;',
    '}',
    'vec3 disp(vec3 n){ return n * (uScale + field(n) * (uAmp + uLevel*0.16)); }',
    'void main(){',
    '  vec3 n = normalize(normal);',
    '  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
    '  vec3 t2 = cross(n, t1); float e = 0.02;',
    '  vec3 p0 = disp(n), pa = disp(normalize(n + t1*e)), pb = disp(normalize(n + t2*e));',
    '  vec3 nn = normalize(cross(pa - p0, pb - p0)); if (dot(nn, n) < 0.0) nn = -nn;',
    '  vP = n; vW = nn; vN = normalize(normalMatrix * nn);',
    '  vec4 mv = modelViewMatrix * vec4(p0, 1.0); vV = -mv.xyz;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var FRAG = NOISE + '\n' + [
    'precision highp float;',
    'uniform float uTime, uIrid, uDark, uLevel, uBack, uGlow;',
    'uniform vec3 uTint, uAccent;',
    'uniform mat3 uViewInv;',
    'varying vec3 vN, vV, vP, vW;',
    // ambiente procedural: estúdio claro (ou escuro) com duas luzes
    'vec3 env(vec3 d){',
    '  float up = smoothstep(-0.35, 0.65, d.y);',
    '  vec3 light = mix(vec3(0.52,0.55,0.66), vec3(1.0,1.0,1.0), up);',
    '  light *= 0.78 + 0.22 * smoothstep(0.0, 0.35, abs(d.y));',
    '  vec3 darkc = mix(vec3(0.03,0.03,0.06), vec3(0.12,0.14,0.22), up);',
    '  vec3 c = mix(light, darkc, uDark);',
    '  c += vec3(1.0) * pow(max(dot(d, normalize(vec3(-0.45,0.8,0.4))), 0.0), 60.0) * 1.2;',
    '  c += vec3(1.0) * pow(max(dot(d, normalize(vec3(-0.45,0.8,0.4))), 0.0), 400.0) * 2.5;',
    '  c += vec3(0.85,0.95,1.0) * pow(max(dot(d, normalize(vec3(0.7,0.25,0.5))), 0.0), 24.0) * 0.6;',
    '  c += uAccent * pow(max(dot(d, normalize(vec3(0.2,-0.6,0.6))), 0.0), 10.0) * 0.35;',
    '  return c;',
    '}',
    // paleta cossenoidal: arco-íris pastel do filme fino
    'vec3 palette(float t){ return 0.5 + 0.5*cos(6.28318*(t + vec3(0.0, 0.33, 0.67))); }',
    'void main(){',
    '  vec3 N = normalize(vN); vec3 V = normalize(vV);',
    '  if (uBack > 0.5) N = -N;',
    '  float ndv = clamp(dot(N, V), 0.0, 1.0);',
    '  float F = 0.06 + 0.94 * pow(1.0 - ndv, 3.5);',
    '  vec3 R = uViewInv * reflect(-V, N);',
    '  vec3 T = uViewInv * refract(-V, N, 1.0/1.33);',
    '  vec3 refl = env(R); vec3 refr = env(T);',
    // espessura do filme varia com o líquido → bandas iridescentes que escorrem
    '  float thick = snoise(vP*0.9 + vec3(0.0, uTime*0.12, uTime*0.05))*0.5 + 0.5;',
    '  vec3 irid = mix(palette(ndv*0.8 + thick*0.9 + uTime*0.02), vec3(1.0), 0.2);',
    // dobras internas (cáusticas): linhas claras onde o ruído cruza zero
    '  float ridge = pow(1.0 - min(1.0, abs(snoise(vP*2.2 - vec3(uTime*0.12, uTime*0.2, 0.0)))*2.0), 12.0);',
    '  float ridge2 = pow(1.0 - min(1.0, abs(snoise(vP*1.6 + vec3(uTime*0.08, 0.0, uTime*0.1)))*2.4), 12.0);',
    '  vec3 col = refr * (1.0 - F) * uTint + refl * F;',
    '  float iridW = uIrid * (0.12 + 0.88 * pow(1.0 - ndv, 1.6));',
    '  col = mix(col, col * irid * 1.7, iridW);',
    '  col += irid * (ridge * 0.3 + ridge2 * 0.2) * (0.5 + 0.5*uIrid);',
    '  col += uAccent * uLevel * 0.25;',
    '  col *= uGlow * (1.0 + uDark * 1.1);',
    '  float alpha = mix(0.3, 0.97, F) + (ridge + ridge2) * (0.2 + uDark * 0.3) + uDark * 0.25;',
    '  if (uBack > 0.5) alpha *= 0.45;',
    '  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));',
    '}'
  ].join('\n');

  var STATES = {
    idle:      { amp: 0.09, fold: 0.10, scale: 1.0,  glow: 1.0,  pulseHz: 0.22, pulse: 0.02, spin: 0.08 },
    listening: { amp: 0.12, fold: 0.14, scale: 1.04, glow: 1.08, pulseHz: 0.45, pulse: 0.015, spin: 0.04 },
    thinking:  { amp: 0.18, fold: 0.24, scale: 0.97, glow: 1.0,  pulseHz: 0.8,  pulse: 0.02, spin: 0.5 },
    speaking:  { amp: 0.14, fold: 0.18, scale: 1.02, glow: 1.15, pulseHz: 0.35, pulse: 0.015, spin: 0.12 },
    sleeping:  { amp: 0.04, fold: 0.04, scale: 0.92, glow: 0.65, pulseHz: 0.1,  pulse: 0.03, spin: 0.02 }
  };

  function create(container, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined') throw new Error('GlassOrb: THREE não encontrado');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    container.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50); camera.position.set(0, 0, 6.2);
    var rig = new THREE.Group(); scene.add(rig);

    var U = {
      uTime: { value: 0 }, uAmp: { value: 0.09 }, uLevel: { value: 0 }, uScale: { value: 1 }, uFold: { value: 0.1 },
      uIrid: { value: opts.iridescence != null ? opts.iridescence : 1.0 }, uDark: { value: opts.dark ? 1 : 0 }, uGlow: { value: 1 },
      uTint: { value: new THREE.Color(opts.tint || '#ffffff') }, uAccent: { value: new THREE.Color(opts.accent || '#7ad7ff') },
      uViewInv: { value: new THREE.Matrix3() }, uBack: { value: 0 }
    };
    var geo = new THREE.SphereGeometry(1, 160, 120);
    function mat(back) {
      var u = {}; for (var k in U) u[k] = U[k]; u.uBack = { value: back ? 1 : 0 };
      return new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: back ? THREE.BackSide : THREE.FrontSide });
    }
    var back = new THREE.Mesh(geo, mat(true)); back.renderOrder = 1; rig.add(back);
    var front = new THREE.Mesh(geo, mat(false)); front.renderOrder = 2; rig.add(front);

    // sombra suave embaixo (só no modo claro) para a bolha "pousar"
    var shadow = null;
    if (!opts.dark) {
      var S = 128, c = document.createElement('canvas'); c.width = c.height = S; var g = c.getContext('2d');
      var grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); grd.addColorStop(0, 'rgba(40,40,70,0.35)'); grd.addColorStop(1, 'rgba(40,40,70,0)');
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
      shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      shadow.scale.set(2.6, 0.9, 1); shadow.position.set(0.05, -1.35, -0.5); shadow.renderOrder = 0; rig.add(shadow);
    }

    var cur = Object.assign({}, STATES.idle), target = Object.assign({}, STATES.idle), stateName = 'idle';
    var extLevel = 0, smoothLevel = 0, t0 = performance.now(), last = t0, running = true, raf = 0;
    function resize() { var w = container.clientWidth || 200, h = container.clientHeight || w; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    resize(); var ro = root.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(container);
    function lerp(a, b, k) { return a + (b - a) * k; }
    var m3 = new THREE.Matrix3();

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
      rig.rotation.y = t * 0.12 * cur.spin + Math.sin(t * 0.2) * 0.1; rig.rotation.x = Math.sin(t * 0.17) * 0.06;
      rig.position.y = Math.sin(t * 0.8) * 0.02 + lvl * 0.03;
      camera.updateMatrixWorld(); m3.setFromMatrix4(camera.matrixWorld); U.uViewInv.value.copy(m3);
      if (shadow) { shadow.material.opacity = 0.9 * cur.glow; shadow.scale.set(2.6 * U.uScale.value, 0.9, 1); }
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
      setState: function (name) { if (!STATES[name]) throw new Error('GlassOrb: estado desconhecido ' + name); stateName = name; target = Object.assign({}, STATES[name]); renderer.domElement.setAttribute('data-state', name); return api; },
      setLevel: function (v) { extLevel = Math.max(0, Math.min(1, v || 0)); return api; },
      setColor: function (hex) { U.uAccent.value.set(hex); return api; },
      setTint: function (hex) { U.uTint.value.set(hex); return api; },
      attachMic: function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia indisponível'));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) { api.attachStream(stream); audio.stream = stream; return stream; });
      },
      attachStream: function (stream) { startMeter(ctxReady().createMediaStreamSource(stream)); return api; },
      attachAudio: function (el) { var c = ctxReady(); if (!audio.src || audio.src.mediaElement !== el) { audio.src = c.createMediaElementSource(el); audio.src.connect(c.destination); } startMeter(audio.src); return api; },
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

  root.GlassOrb = { create: create, STATES: STATES };
})(typeof window !== 'undefined' ? window : this);
