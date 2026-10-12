/*
 * FuzzyOrb — esfera felpuda / líquida para avatar de agente de voz.
 * Requer THREE (r128+) como global. Sem dependências além disso.
 *
 *   const orb = FuzzyOrb.create(document.getElementById('orb'), { color: '#c8395f' });
 *   orb.setState('listening' | 'thinking' | 'speaking' | 'idle' | 'sleeping');
 *   orb.setLevel(0..1);           // amplitude de áudio (mic ou TTS)
 *   orb.attachMic();              // mede o microfone e chama setLevel sozinho
 *   orb.attachAudio(audioEl);     // mede o <audio> da fala do agente
 *   orb.setColor('#7b4fe0');
 *   opções: { headphones: false } tira o fone; { eyes: 'none' } tira os olhos; { liquid: 1.3 } aumenta a fluidez
 *   orb.dispose();
 */
(function (root) {
  'use strict';

  var NOISE_GLSL = [
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

  var VERT = NOISE_GLSL + '\n' + [
    'uniform float uTime, uShell, uFur, uLiquid, uLevel, uBreath, uSway;',
    'varying vec3 vN, vV, vP;',
    'varying float vLiq;',
    // deslocamento "líquido": ruído de baixa frequência ao longo da normal,
    // atenuado na frente (onde ficam os olhos) para o rosto não derreter
    'float liquid(vec3 p){',
    '  float n = snoise(p*0.8 + vec3(uTime*0.14, uTime*0.24, 0.0))*0.62',
    '          + snoise(p*1.5 + vec3(0.0, uTime*0.36, uTime*0.2))*0.38',
    '          + snoise(p*3.0 - vec3(uTime*0.5, 0.0, uTime*0.3))*0.1',
    '          + snoise(p*6.0 + vec3(uTime*1.2))*0.08*uLevel;',
    '  float faceMask = 1.0 - smoothstep(0.45, 0.95, dot(normalize(p), vec3(0.0,0.08,1.0)));',
    '  return n * (0.45 + 0.55*faceMask);',
    '}',
    'vec3 displace(vec3 p, vec3 n){',
    '  float amp = uLiquid * (0.13 + uLevel*0.2);',
    '  return p + n * (liquid(p)*amp + uBreath);',
    '}',
    'void main(){',
    '  vec3 n = normalize(normal);',
    '  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
    '  vec3 t2 = cross(n, t1);',
    '  float e = 0.03;',
    '  vec3 p0 = displace(position, n);',
    '  vec3 pa = displace(normalize(position + t1*e), normalize(position + t1*e));',
    '  vec3 pb = displace(normalize(position + t2*e), normalize(position + t2*e));',
    '  vec3 nn = normalize(cross(pa - p0, pb - p0));',
    '  if (dot(nn, n) < 0.0) nn = -nn;',
    // pelos: empurra cada camada para fora; as pontas caem um pouco e balançam
    '  float s = uShell;',
    '  vec3 p = p0 + nn * s * uFur * (1.0 + uLevel*0.35);',
    '  p.y -= s*s * uFur * 0.35;',
    '  p.x += sin(uTime*1.4 + position.y*3.0 + position.z*2.0) * 0.035 * s*s * uSway;',
    '  p.z += cos(uTime*1.1 + position.x*3.0) * 0.025 * s*s * uSway;',
    '  vLiq = liquid(position);',
    '  vP = position;',
    '  vN = normalize(normalMatrix * nn);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vV = -mv.xyz;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform sampler2D uNoise;',
    'uniform float uShell, uDensity, uSat;',
    'uniform vec3 uColor, uTip, uRim;',
    'varying vec3 vN, vV, vP;',
    'varying float vLiq;',
    'float strand(){',
    // triplanar: evita esticar nos polos da esfera
    '  vec3 w = abs(normalize(vP)); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);',
    '  float hx = texture2D(uNoise, vP.yz * uDensity).r;',
    '  float hy = texture2D(uNoise, vP.xz * uDensity).r;',
    '  float hz = texture2D(uNoise, vP.xy * uDensity).r;',
    '  return hx*w.x + hy*w.y + hz*w.z;',
    '}',
    'void main(){',
    '  float h = strand();',
    '  float alpha = 1.0;',
    '  if (uShell > 0.0) {',
    '    if (h < uShell) discard;',
    '    alpha = smoothstep(uShell, uShell + 0.18, h);',
    '  }',
    '  vec3 N = normalize(vN); vec3 V = normalize(vV);',
    '  vec3 L = normalize(vec3(-0.45, 0.85, 0.55));',
    '  float diff = max(dot(N, L), 0.0) * 0.55 + 0.45;',
    '  float ao = mix(0.62, 1.0, pow(uShell, 0.6));',   // raízes mais escuras = profundidade
    '  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);',
    '  vec3 base = mix(uColor, uTip, uShell * 0.85);',
    '  float fiber = 0.74 + 0.36*h;',                      // cada fio com um brilho: a textura de nap
    '  vec3 col = base * diff * ao * fiber;',
    '  col += uRim * rim * (0.4 + 0.7*uShell);',       // brilho de veludo na borda
    '  col += vec3(0.04) * vLiq;',
    '  float g = dot(col, vec3(0.299,0.587,0.114));',
    '  col = mix(vec3(g), col, uSat);',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  var STATES = {
    idle:      { liquid: 0.7, level: 0.0,  breath: 0.012, breathHz: 0.18, sway: 0.6, eyeOpen: 1.0,  eyeUp: 0.0,  tilt: 0.0,  lean: 0.0,  spin: 0.08, sat: 1.0 },
    listening: { liquid: 0.9,  level: 0.0,  breath: 0.008, breathHz: 0.30, sway: 0.9, eyeOpen: 1.18, eyeUp: 0.02, tilt: 0.0,  lean: 0.18, spin: 0.0,  sat: 1.0 },
    thinking:  { liquid: 1.0,  level: 0.25, breath: 0.010, breathHz: 0.22, sway: 1.2, eyeOpen: 0.75, eyeUp: 0.07, tilt: 0.16, lean: -0.1, spin: 0.35, sat: 1.0 },
    speaking:  { liquid: 1.0,  level: 0.0,  breath: 0.006, breathHz: 0.40, sway: 1.0, eyeOpen: 1.0,  eyeUp: 0.0,  tilt: 0.0,  lean: 0.08, spin: 0.0,  sat: 1.0 },
    sleeping:  { liquid: 0.35, level: 0.0,  breath: 0.02,  breathHz: 0.10, sway: 0.3, eyeOpen: 0.06, eyeUp: -0.03, tilt: 0.0, lean: -0.15, spin: 0.0, sat: 0.35 }
  };

  var sharedNoiseTex = null;
  function noiseTexture() {
    if (sharedNoiseTex) return sharedNoiseTex;
    var S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    var ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    // fios: pontos com alturas aleatórias, suavizados levemente para não virar ruído de TV
    var seed = 1337;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var h = new Float32Array(S * S);
    for (var i = 0; i < S * S; i++) h[i] = 0;
    var dots = 15000;
    for (var k = 0; k < dots; k++) {
      var x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), v = 0.35 + rnd() * 0.65, r = rnd() < 0.15 ? 2 : 1;
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        var xx = (x + dx + S) % S, yy = (y + dy + S) % S, f = v * (1 - (Math.abs(dx) + Math.abs(dy)) * 0.22);
        if (f > h[yy * S + xx]) h[yy * S + xx] = f;
      }
    }
    for (var j = 0; j < S * S; j++) { var g = Math.max(0, Math.min(1, h[j])) * 255; d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = g; d[j * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    sharedNoiseTex = t;
    return t;
  }

  function lighten(c, k) { var o = c.clone(); var hsl = {}; o.getHSL(hsl); o.setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.min(1, hsl.l + k)); return o; }
  function darken(c, k) { var o = c.clone(); var hsl = {}; o.getHSL(hsl); o.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(0, hsl.l - k)); return o; }

  function create(container, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined') throw new Error('FuzzyOrb: THREE não encontrado');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var shells = opts.shells || 26;
    var fur = opts.furLength != null ? opts.furLength : 0.17;
    var density = opts.density || 9;
    var eyesKind = opts.eyes || 'slits';
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    camera.position.set(0, 0.05, opts.headphones !== false ? 6.3 : 5.6);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(-2, 3.5, 3); scene.add(key);

    var group = new THREE.Group(); scene.add(group);
    var body = new THREE.Group(); group.add(body);
    var geo = new THREE.SphereGeometry(1, 96, 72);
    var baseColor = new THREE.Color(opts.color || '#c8395f');
    var uniforms = {
      uTime: { value: 0 }, uFur: { value: fur }, uLiquid: { value: 0.45 }, uLevel: { value: 0 },
      uBreath: { value: 0 }, uSway: { value: 0.6 }, uDensity: { value: density }, uSat: { value: 1 },
      uNoise: { value: noiseTexture() },
      uColor: { value: darken(baseColor, 0.04) }, uTip: { value: lighten(baseColor, 0.14) }, uRim: { value: lighten(baseColor, 0.3) }
    };
    var mats = [];
    for (var i = 0; i <= shells; i++) {
      var s = i / shells;
      var u = {}; for (var k in uniforms) u[k] = uniforms[k];
      u.uShell = { value: s };
      var m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: i > 0, depthWrite: i === 0, side: THREE.FrontSide });
      var mesh = new THREE.Mesh(geo, m); mesh.renderOrder = i; body.add(mesh); mats.push(m);
    }

    // olhos: duas fendas verticais pretas e brilhantes, assentadas sobre a pelúcia
    var eyes = new THREE.Group(); group.add(eyes);
    var eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.45, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.08 });
    var eyeL, eyeR;
    if (eyesKind !== 'none') {
      var eg = new THREE.SphereGeometry(1, 32, 24);
      eyeL = new THREE.Mesh(eg, eyeMat); eyeR = new THREE.Mesh(eg, eyeMat);
      eyes.add(eyeL); eyes.add(eyeR);
    }
    var eyeR0 = 1 + fur * 0.8, eyeSep = 0.28, eyeY = 0.1, eyeSize = { x: 0.085, y: 0.2, z: 0.05 };
    function placeEyes(open, up) {
      if (!eyeL) return;
      var ang = Math.asin(eyeSep);
      var y = eyeY + up;
      eyeL.position.set(-Math.sin(ang) * eyeR0, y, Math.cos(ang) * eyeR0 * Math.sqrt(1 - y * y * 0.6));
      eyeR.position.set(Math.sin(ang) * eyeR0, y, Math.cos(ang) * eyeR0 * Math.sqrt(1 - y * y * 0.6));
      eyeL.lookAt(0, 0, 0); eyeR.lookAt(0, 0, 0);
      eyeL.scale.set(eyeSize.x, eyeSize.y * open, eyeSize.z); eyeR.scale.set(eyeSize.x, eyeSize.y * open, eyeSize.z);
    }

    // fone de ouvido: arco por cima e duas conchas, preto fosco (opcional)
    var phones = null, phoneMat = null;
    if (opts.headphones !== false) {
      phones = new THREE.Group(); group.add(phones);
      phoneMat = new THREE.MeshStandardMaterial({ color: 0x07060a, roughness: 1.0, metalness: 0.0 });
      var bandR = 1 + fur + 0.1;
      var band = new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.095, 18, 72, Math.PI), phoneMat);
      band.rotation.x = -0.22; band.position.z = -0.1; phones.add(band);
      var cupGeo = new THREE.SphereGeometry(1, 40, 28);
      [-1, 1].forEach(function (sgn) {
        var cup = new THREE.Mesh(cupGeo, phoneMat);
        cup.scale.set(0.2, 0.36, 0.36); cup.position.set(sgn * (1 + fur + 0.06), -0.06, -0.12);
        phones.add(cup);
        var pad = new THREE.Mesh(cupGeo, new THREE.MeshStandardMaterial({ color: 0x15121a, roughness: 1 }));
        pad.scale.set(0.09, 0.28, 0.28); pad.position.set(sgn * (1 + fur - 0.06), -0.06, -0.12);
        phones.add(pad);
      });
    }

    var cur = Object.assign({}, STATES.idle), target = Object.assign({}, STATES.idle), stateName = 'idle';
    var extLevel = 0, smoothLevel = 0, blink = 1, nextBlink = 2 + Math.random() * 3, blinkT = -1;
    var t0 = performance.now(), last = t0, running = true, raf = 0;

    function resize() {
      var w = container.clientWidth || 200, h = container.clientHeight || w;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    var ro = root.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(container);

    function lerp(a, b, k) { return a + (b - a) * k; }
    function frame() {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var now = performance.now();
      var dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000)); last = now;
      var t = (now - t0) / 1000;
      var k = 1 - Math.pow(0.02, dt);
      for (var key in target) cur[key] = lerp(cur[key], target[key], k);
      // nível de áudio: sobe rápido, desce devagar
      var want = Math.max(cur.level, extLevel);
      smoothLevel = want > smoothLevel ? lerp(smoothLevel, want, 1 - Math.pow(0.001, dt)) : lerp(smoothLevel, want, 1 - Math.pow(0.08, dt));
      var lvl = reduced ? smoothLevel * 0.5 : smoothLevel;
      uniforms.uTime.value = reduced ? t * 0.3 : t;
      uniforms.uLiquid.value = (reduced ? cur.liquid * 0.4 : cur.liquid) * (opts.liquid || 1);
      uniforms.uLevel.value = lvl;
      uniforms.uSway.value = cur.sway;
      uniforms.uSat.value = cur.sat;
      uniforms.uBreath.value = Math.sin(t * Math.PI * 2 * cur.breathHz) * cur.breath + lvl * 0.03;
      // piscar
      if (eyeL) {
        nextBlink -= dt;
        if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2.5 + Math.random() * 4; }
        if (blinkT >= 0) { blinkT += dt; var ph = blinkT / 0.22; blink = ph < 0.5 ? 1 - ph * 2 : (ph < 1 ? (ph - 0.5) * 2 : 1); if (ph >= 1) blinkT = -1; }
        var open = Math.max(0.06, cur.eyeOpen * (0.06 + 0.94 * blink));
        placeEyes(open, cur.eyeUp + Math.sin(t * 0.7) * 0.006);
      }
      // postura: inclina, se aproxima quando ouve, gira devagar quando ocioso
      group.rotation.z = cur.tilt + Math.sin(t * 0.5) * 0.02;
      group.rotation.x = -cur.lean * 0.5 + Math.sin(t * 0.37) * 0.015;
      body.rotation.y = Math.sin(t * 0.25) * 0.18 * cur.spin;
      group.position.z = cur.lean * 0.35;
      group.position.y = Math.sin(t * 1.1) * 0.01 + lvl * 0.04;
      var sq = 1 + lvl * 0.05;
      group.scale.set(sq, 1 / Math.sqrt(sq), sq);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVis);
    function onVis() { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }

    var audio = { ctx: null, analyser: null, data: null, stream: null, timer: 0, src: null };
    function startMeter(node) {
      stopMeter();
      audio.analyser = audio.ctx.createAnalyser(); audio.analyser.fftSize = 1024; audio.analyser.smoothingTimeConstant = 0.6;
      audio.data = new Float32Array(audio.analyser.fftSize);
      node.connect(audio.analyser);
      function tick() {
        audio.timer = requestAnimationFrame(tick);
        audio.analyser.getFloatTimeDomainData(audio.data);
        var sum = 0; for (var i = 0; i < audio.data.length; i++) sum += audio.data[i] * audio.data[i];
        var rms = Math.sqrt(sum / audio.data.length);
        extLevel = Math.min(1, Math.max(0, (rms - 0.012) * 6.5));   // ruído de fundo abaixo de ~0.012 vira 0
      }
      tick();
    }
    function stopMeter() { if (audio.timer) cancelAnimationFrame(audio.timer); audio.timer = 0; extLevel = 0; }

    var api = {
      el: renderer.domElement,
      get state() { return stateName; },
      setState: function (name) {
        if (!STATES[name]) throw new Error('FuzzyOrb: estado desconhecido ' + name);
        stateName = name; target = Object.assign({}, STATES[name]);
        renderer.domElement.setAttribute('data-state', name);
        return api;
      },
      setLevel: function (v) { extLevel = Math.max(0, Math.min(1, v || 0)); return api; },
      setColor: function (hex) {
        var c = new THREE.Color(hex);
        uniforms.uColor.value.copy(darken(c, 0.04)); uniforms.uTip.value.copy(lighten(c, 0.14)); uniforms.uRim.value.copy(lighten(c, 0.3));
        return api;
      },
      attachMic: function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia indisponível'));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
          api.attachStream(stream); audio.stream = stream;
          return stream;
        });
      },
      // qualquer MediaStream: microfone já aberto, ou a faixa remota do WebRTC (voz do agente)
      attachStream: function (stream) {
        audio.ctx = audio.ctx || new (root.AudioContext || root.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        startMeter(audio.ctx.createMediaStreamSource(stream));
        return api;
      },
      // nível atual medido (0..1), útil para VAD simples fora do componente
      get level() { return extLevel; },
      attachAudio: function (el) {
        audio.ctx = audio.ctx || new (root.AudioContext || root.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        if (!audio.src || audio.src.mediaElement !== el) { audio.src = audio.ctx.createMediaElementSource(el); audio.src.connect(audio.ctx.destination); }
        startMeter(audio.src);
        return api;
      },
      detachAudio: function () {
        stopMeter();
        if (audio.stream) { audio.stream.getTracks().forEach(function (tr) { tr.stop(); }); audio.stream = null; }
        return api;
      },
      dispose: function () {
        running = false; cancelAnimationFrame(raf); api.detachAudio();
        if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
        mats.forEach(function (m) { m.dispose(); }); geo.dispose(); eyeMat.dispose(); if (phoneMat) phoneMat.dispose();
        renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    api.setState(opts.state || 'idle');
    return api;
  }

  root.FuzzyOrb = { create: create, STATES: STATES };
})(typeof window !== 'undefined' ? window : this);
