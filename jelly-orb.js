/*
 * JellyOrb — esfera de gel rosa brilhante com dois olhos brancos expressivos.
 * Mesma API dos outros orbes (setState, setLevel, attachMic, attachStream, attachAudio, detachAudio, setColor, dispose)
 * + setExpression(name, ms) e look(x, y). Requer THREE (r128+) como global.
 *
 *   const orb = JellyOrb.create(el, { color: '#ff2f93' });
 *   orb.setExpression('happy', 1500);   // neutral | wide | think | happy | surprised | sleepy | wink | sad | suspicious
 *   orb.look(0.3, -0.1);                // olhar (−1..1) — null volta ao automático
 *   orb.setEyeColor('#121016');         // olhos pretos (padrão: brancos)
 *   opções: { headphones: false } tira o fone; { headphoneColor: '#ffffff' } muda a cor dele; { backdrop: 'dark' } para fundo escuro
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

  var BODY_VERT = NOISE + '\n' + [
    'uniform float uTime, uAmp, uLevel;',
    'varying vec3 vN, vV;',
    'float field(vec3 p){ return snoise(p*1.3 + vec3(uTime*0.2, uTime*0.3, 0.0))*0.7 + snoise(p*2.6 - vec3(0.0, uTime*0.4, uTime*0.2))*0.3; }',
    'vec3 disp(vec3 n){ return n * (1.0 + field(n) * (uAmp + uLevel*0.05)); }',
    'void main(){',
    '  vec3 n = normalize(normal);',
    '  vec3 t1 = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
    '  vec3 t2 = cross(n, t1); float e = 0.03;',
    '  vec3 p0 = disp(n), pa = disp(normalize(n + t1*e)), pb = disp(normalize(n + t2*e));',
    '  vec3 nn = normalize(cross(pa - p0, pb - p0)); if (dot(nn, n) < 0.0) nn = -nn;',
    '  vN = normalize(normalMatrix * nn);',
    '  vec4 mv = modelViewMatrix * vec4(p0, 1.0); vV = -mv.xyz;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var BODY_FRAG = [
    'precision highp float;',
    'uniform vec3 uDeep, uMid, uRim; uniform float uGlow, uLevel;',
    'varying vec3 vN, vV;',
    'void main(){',
    '  vec3 N = normalize(vN); vec3 V = normalize(vV);',
    '  float ndv = max(dot(N, V), 0.0);',
    '  vec3 L = normalize(vec3(-0.55, 0.75, 0.55));',
    '  float lit = smoothstep(-0.7, 0.9, dot(N, L));',
    '  vec3 col = mix(uDeep, uMid, lit);',
    // borda translúcida mais clara (luz atravessando o gel)
    '  float rim = pow(1.0 - ndv, 2.4);',
    '  col = mix(col, uRim, rim * 0.8);',
    // luz rebatida do chão, embaixo
    '  col += uRim * 0.22 * pow(max(dot(N, normalize(vec3(0.0, -1.0, 0.35))), 0.0), 2.0);',
    // reflexos: um largo e suave, um pequeno e duro (verniz), e um menor à direita embaixo
    '  vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.0);',
    '  col += vec3(1.0) * (pow(nh, 70.0) * 0.55 + pow(nh, 700.0) * 1.0);',
    '  vec3 H2 = normalize(normalize(vec3(0.7, -0.45, 0.6)) + V);',
    '  col += vec3(1.0, 0.9, 0.96) * pow(max(dot(N, H2), 0.0), 40.0) * 0.28;',
    '  col *= uGlow; col += uRim * uLevel * 0.12;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // olho: esfera achatada, branca, cortada por pálpebras (y local) — vira meia-lua, risca, arco
  var EYE_VERT = [
    'varying vec3 vL, vN, vV;',
    'void main(){ vL = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }'
  ].join('\n');
  var EYE_FRAG = [
    'precision highp float;',
    'uniform float uTop, uBot, uTilt, uTopCurve, uBotCurve; uniform vec3 uColor;',
    'varying vec3 vL, vN, vV;',
    'void main(){',
    '  float y = vL.y + vL.x * uTilt; float xx = vL.x * vL.x;',
    '  float top = uTop + uTopCurve * xx, bot = uBot + uBotCurve * xx;',   // pálpebras curvas: arcos, meias-luas, risquinhos
    '  if (y > top || y < bot) discard;',
    '  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(vV); vec3 L = normalize(vec3(-0.5, 0.8, 0.6));',
    '  float lit = 0.84 + 0.16 * max(dot(N, L), 0.0);',
    '  float edge = smoothstep(top, top - 0.12, y) * smoothstep(bot, bot + 0.12, y);',
    '  vec3 col = uColor * lit * (0.93 + 0.07 * edge);',
    '  vec3 H = normalize(L + V); col += vec3(1.0) * (pow(max(dot(N, H), 0.0), 120.0) * 0.55 + pow(max(dot(N, H), 0.0), 900.0) * 0.6);',
    '  if (!gl_FrontFacing) col *= 0.93;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // Expressões: por olho [tamanho, escalaX, escalaY, pálpebra de cima, pálpebra de baixo, inclinação, curva de cima, curva de baixo];
  // olhar (gx, gy), separação, altura e pose do corpo [sobe/desce, inclina frente/trás]. Olhos simétricos salvo quando a assimetria é a expressão.
  var EXPR = {
    neutral:    { L: [0.19, 1.0, 1.1, 1, -1, 0, 0, 0],          R: [0.19, 1.0, 1.1, 1, -1, 0, 0, 0],          gaze: [0.0, 0.0],   sep: 0.24, h: 0.10, pose: [0, 0] },
    wide:       { L: [0.22, 1.0, 1.15, 1, -1, 0, 0, 0],         R: [0.22, 1.0, 1.15, 1, -1, 0, 0, 0],         gaze: [0.0, 0.0],   sep: 0.25, h: 0.12, pose: [0.02, -0.03] },
    // pensativa: olhar para cima e para o lado (e vagando), pálpebras meio baixas e arredondadas, cabeça erguida
    think:      { L: [0.18, 1.0, 1.0, 0.25, -1, 0.3, -0.35, 0], R: [0.19, 1.0, 1.05, 0.6, -1, 0, -0.45, 0],   gaze: [0.3, 0.3],   sep: 0.23, h: 0.11, pose: [0.02, -0.06] },
    // feliz: meia-lua de cima com pontas afinadas (sorriso dos olhos), corpo um pouco mais alto
    happy:      { L: [0.21, 1.15, 1.0, 1, 0.2, 0, 0, -0.35],    R: [0.21, 1.15, 1.0, 1, 0.2, 0, 0, -0.35],       gaze: [0.0, 0.05],  sep: 0.25, h: 0.10, pose: [0.03, 0] },
    surprised:  { L: [0.24, 1.0, 1.2, 1, -1, 0, 0, 0],          R: [0.24, 1.0, 1.2, 1, -1, 0, 0, 0],          gaze: [0.0, 0.05],  sep: 0.26, h: 0.13, pose: [0.02, -0.04] },
    sleepy:     { L: [0.2, 1.1, 0.9, -0.5, -1, 0, 0.15, 0],     R: [0.2, 1.1, 0.9, -0.5, -1, 0, 0.15, 0],     gaze: [0.0, -0.08], sep: 0.24, h: 0.07, pose: [-0.04, 0.06] },
    // piscadinha: um olho fechado em arco fino (⌒), o outro bem aberto
    wink:       { L: [0.22, 1.3, 1.0, -0.1, -0.5, 0, -0.7, -0.7], R: [0.22, 1.0, 1.12, 1, -1, 0, 0, 0],    gaze: [0.05, 0.0],  sep: 0.24, h: 0.10, pose: [0.01, 0] },
    // triste: cantos externos caídos (pálpebra inclinada para fora), olhar para baixo, corpo murcha
    sad:        { L: [0.19, 1.0, 1.05, 0.4, -1, 0.6, 0.3, 0],   R: [0.19, 1.0, 1.05, 0.4, -1, -0.6, 0.3, 0],  gaze: [0.0, -0.25], sep: 0.23, h: 0.06, pose: [-0.06, 0.1] },
    suspicious: { L: [0.19, 1.0, 1.0, 0.1, -1, 0, 0, 0],        R: [0.19, 1.0, 1.0, 0.1, -1, 0, 0, 0],        gaze: [-0.2, 0.0],  sep: 0.24, h: 0.10, pose: [0, 0.02] }
  };
  var STATES = {
    idle:      { expr: 'neutral',  amp: 0.02, glow: 1.0,  bob: 0.015, bobHz: 0.35, squash: 0.0 },
    listening: { expr: 'wide',     amp: 0.025, glow: 1.05, bob: 0.01, bobHz: 0.6, squash: 0.02 },
    thinking:  { expr: 'think',    amp: 0.035, glow: 1.0,  bob: 0.02,  bobHz: 0.9, squash: 0.0 },
    speaking:  { expr: 'happy',    amp: 0.03, glow: 1.08, bob: 0.012, bobHz: 0.5, squash: 0.06 },
    sleeping:  { expr: 'sleepy',   amp: 0.01, glow: 0.85, bob: 0.025, bobHz: 0.15, squash: -0.04 }
  };

  function create(container, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined') throw new Error('JellyOrb: THREE não encontrado');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    container.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50); camera.position.set(0, 0.08, opts.headphones !== false ? 7.0 : 6.4);
    var rig = new THREE.Group(); scene.add(rig);

    var mid = new THREE.Color(opts.color || '#ff2f93');
    var U = { uTime: { value: 0 }, uAmp: { value: 0.02 }, uLevel: { value: 0 }, uGlow: { value: 1 },
      uDeep: { value: mid.clone().offsetHSL(-0.02, 0.05, -0.16) }, uMid: { value: mid.clone() }, uRim: { value: mid.clone().offsetHSL(0.0, -0.1, 0.26) } };
    var body = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.ShaderMaterial({ uniforms: U, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG }));
    rig.add(body);

    // sombra de contato (suave, cor do gel)
    var S = 128, c = document.createElement('canvas'); c.width = c.height = S; var g = c.getContext('2d');
    var grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); grd.addColorStop(0, 'rgba(255,255,255,0.4)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    var shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: mid.clone().offsetHSL(0, 0, -0.25), transparent: true, depthWrite: false }));
    shadow.scale.set(2.4, 0.7, 1); shadow.position.set(0.05, -1.25, -0.4); scene.add(shadow);

    // fone de ouvido: arco por cima + duas conchas, preto com verniz (opcional)
    var phones = null;
    if (opts.headphones !== false) {
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      var key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(-2.5, 3.5, 3); scene.add(key);
      phones = new THREE.Group(); rig.add(phones);
      var pm = new THREE.MeshStandardMaterial({ color: opts.headphoneColor || 0x16131a, roughness: 0.32, metalness: 0.15 });
      var pad = new THREE.MeshStandardMaterial({ color: 0x2b2531, roughness: 0.9, metalness: 0.0 });
      var band = new THREE.Mesh(new THREE.TorusGeometry(1.13, 0.075, 20, 80, Math.PI), pm);
      band.rotation.x = -0.26; band.position.z = -0.12; phones.add(band);
      var cupGeo = new THREE.SphereGeometry(1, 40, 28);
      [-1, 1].forEach(function (sg) {
        var cup = new THREE.Mesh(cupGeo, pm); cup.scale.set(0.2, 0.36, 0.36); cup.position.set(sg * 1.1, -0.06, -0.14); phones.add(cup);
        var cushion = new THREE.Mesh(cupGeo, pad); cushion.scale.set(0.1, 0.28, 0.28); cushion.position.set(sg * 0.97, -0.06, -0.14); phones.add(cushion);
      });
    }

    // olhos
    var eyeGeo = new THREE.SphereGeometry(1, 48, 32);
    function makeEye() {
      var u = { uTop: { value: 1 }, uBot: { value: -1 }, uTilt: { value: 0 }, uTopCurve: { value: 0 }, uBotCurve: { value: 0 }, uColor: { value: new THREE.Color(opts.eyeColor || '#fff6fa') } };
      var m = new THREE.Mesh(eyeGeo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, side: THREE.DoubleSide }));
      m.userData.u = u; rig.add(m); return m;
    }
    var eyeL = makeEye(), eyeR = makeEye();
    // Todo movimento passa por molas criticamente amortecidas: começa e termina devagar, nunca "pula".
    // omega controla a rapidez (≈ 4/omega segundos para assentar).
    function Spring(init, omega) { this.x = init.slice(); this.v = init.map(function () { return 0; }); this.w = omega; }
    Spring.prototype.to = function (target, dt) {
      var w = this.w;
      for (var i = 0; i < this.x.length; i++) { var a = w * w * (target[i] - this.x[i]) - 2 * w * this.v[i]; this.v[i] += a * dt; this.x[i] += this.v[i] * dt; }
      return this.x;
    };
    var ex = {
      L: new Spring(EXPR.neutral.L, 6), R: new Spring(EXPR.neutral.R, 6),
      gaze: new Spring(EXPR.neutral.gaze, 4.5), pose: new Spring([0, 0], 3.2),
      geo: new Spring([EXPR.neutral.sep, EXPR.neutral.h], 5), sacc: new Spring([0, 0], 11)
    };
    var exOverride = null, exUntil = 0, lookAt = null, blink = 1, blinkT = -1, nextBlink = 2 + Math.random() * 3;
    var saccTarget = [0, 0], nextSaccade = 1.5, idleMood = null, idleMoodUntil = 0;

    function placeEye(mesh, p, side, gaze, sep, h, bl) {
      var gx = gaze[0] + ex.sacc.x[0], gy = gaze[1] + ex.sacc.x[1];
      var ang = side * sep + gx * 0.45, el = h + gy * 0.4;
      var r = 1.0;
      var x = Math.sin(ang) * Math.cos(el) * r, y = Math.sin(el) * r, z = Math.cos(ang) * Math.cos(el) * r;
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      mesh.rotateZ(p[5] * 0.35);
      var open = Math.max(0.05, bl);
      mesh.scale.set(p[0] * p[1], p[0] * p[2] * open, p[0] * 0.5);
      // pálpebras no espaço local (-1..1); o piscar fecha de cima
      var top = p[3], bot = p[4];
      if (bl < 1) top = Math.min(top, -1 + 2 * bl + 0.1);
      mesh.userData.u.uTop.value = top; mesh.userData.u.uBot.value = bot; mesh.userData.u.uTilt.value = p[5] * 0.6;
      mesh.userData.u.uTopCurve.value = p[6] * bl; mesh.userData.u.uBotCurve.value = p[7];
    }

    var NUM = ['amp', 'glow', 'bob', 'bobHz', 'squash'];
    function vec(st) { return NUM.map(function (k) { return st[k]; }); }
    var bodyS = new Spring(vec(STATES.idle), 3.5), cur = Object.assign({}, STATES.idle), stateName = 'idle', bobPhase = 0;
    var extLevel = 0, smoothLevel = 0, t0 = performance.now(), last = t0, running = true, raf = 0, shadowDark = false;
    function resize() { var w = container.clientWidth || 200, hh = container.clientHeight || w; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); }
    resize(); var ro = root.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(container);
    function lerp(a, b, k) { return a + (b - a) * k; }

    function frame() {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var now = performance.now(), dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000)); last = now;
      var t = (now - t0) / 1000;
      var bv = bodyS.to(vec(STATES[stateName]), dt);
      NUM.forEach(function (k, i) { cur[k] = bv[i]; });
      bobPhase += cur.bobHz * dt * Math.PI * 2;                        // fase integrada: mudar o ritmo não dá salto
      smoothLevel = extLevel > smoothLevel ? lerp(smoothLevel, extLevel, 1 - Math.pow(0.01, dt)) : lerp(smoothLevel, extLevel, 1 - Math.pow(0.15, dt));
      var lvl = reduced ? smoothLevel * 0.5 : smoothLevel;

      // expressão: override temporário > humor ocioso > estado
      if (exOverride && now > exUntil) exOverride = null;
      if (stateName === 'idle' && !exOverride) {
        if (now > idleMoodUntil) { idleMood = Math.random() < 0.25 ? ['think', 'happy', 'suspicious', 'surprised'][Math.floor(Math.random() * 4)] : null; idleMoodUntil = now + 4000 + Math.random() * 5000; }
      } else idleMood = null;
      var want = EXPR[exOverride || idleMood || STATES[stateName].expr];
      var gz = lookAt ? [lookAt[0] * 0.5, lookAt[1] * 0.5] : want.gaze.slice();
      if (!lookAt && want === EXPR.think) { gz[0] += Math.sin(t * 0.7) * 0.12; gz[1] += Math.cos(t * 0.45) * 0.06; }   // pensando: o olhar vaga
      var L = ex.L.to(want.L, dt), R = ex.R.to(want.R, dt), gaze = ex.gaze.to(gz, dt), pose = ex.pose.to(want.pose, dt), geo = ex.geo.to([want.sep, want.h], dt);
      // micro-movimentos do olhar (sacadas rápidas mas suaves) e piscar com ease
      nextSaccade -= dt; if (nextSaccade <= 0) { saccTarget = [(Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08]; nextSaccade = 1 + Math.random() * 3; }
      ex.sacc.to(saccTarget, dt);
      nextBlink -= dt; if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2.5 + Math.random() * 4; }
      if (blinkT >= 0) { blinkT += dt; var ph = blinkT / 0.24; blink = ph >= 1 ? 1 : 1 - Math.pow(Math.sin(ph * Math.PI), 1.4); if (ph >= 1) blinkT = -1; }
      placeEye(eyeL, L, -1, gaze, geo[0], geo[1], blink);
      placeEye(eyeR, R, 1, gaze, geo[0], geo[1], blink);

      U.uTime.value = reduced ? t * 0.3 : t; U.uAmp.value = reduced ? cur.amp * 0.4 : cur.amp; U.uLevel.value = lvl; U.uGlow.value = cur.glow;
      // corpo: flutua, achata ao falar (squash & stretch), inclina de leve para onde olha
      var sq = 1 + cur.squash * 0.5 + lvl * 0.08;
      rig.scale.set(sq, 1 / Math.sqrt(sq), sq);
      rig.position.y = Math.sin(bobPhase) * cur.bob + lvl * 0.05 + pose[0];
      rig.rotation.z = -gaze[0] * 0.15 + Math.sin(t * 0.4) * 0.02;
      rig.rotation.y = gaze[0] * 0.25; rig.rotation.x = -gaze[1] * 0.2 + pose[1];
      shadow.material.opacity = (shadowDark ? 0.55 : 0.9) - rig.position.y * 2 + (shadowDark ? lvl * 0.3 : 0); shadow.scale.set((shadowDark ? 3.2 : 2.4) * sq, shadowDark ? 1.1 : 0.7, 1);
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
      get expression() { return exOverride || idleMood || STATES[stateName].expr; },
      EXPRESSIONS: Object.keys(EXPR),
      setState: function (name) { if (!STATES[name]) throw new Error('JellyOrb: estado desconhecido ' + name); stateName = name; renderer.domElement.setAttribute('data-state', name); return api; },
      setExpression: function (name, ms) { if (name == null) { exOverride = null; return api; } if (!EXPR[name]) throw new Error('JellyOrb: expressão desconhecida ' + name); exOverride = name; exUntil = performance.now() + (ms || 2000); return api; },
      setBackdrop: function (mode) {   // 'light' (sombra de contato) | 'dark' (brilho colorido no chão)
        var dark = mode === 'dark';
        shadow.material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
        shadow.material.color.copy(mid).offsetHSL(0, 0, dark ? 0.05 : -0.25);
        shadow.material.needsUpdate = true; shadowDark = dark;
        U.uRim.value.copy(mid).offsetHSL(0.0, -0.1, dark ? 0.3 : 0.26);
        return api;
      },
      setEyeColor: function (hex) { eyeL.material.uniforms.uColor.value.set(hex); eyeR.material.uniforms.uColor.value.set(hex); return api; },
      look: function (x, y) { lookAt = (x == null) ? null : [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y || 0))]; return api; },
      setLevel: function (v) { extLevel = Math.max(0, Math.min(1, v || 0)); return api; },
      setColor: function (hex) { mid.set(hex); U.uMid.value.copy(mid); U.uDeep.value.copy(mid).offsetHSL(-0.02, 0.05, -0.16); U.uRim.value.copy(mid).offsetHSL(0.0, -0.1, shadowDark ? 0.3 : 0.26); shadow.material.color.copy(mid).offsetHSL(0, 0, shadowDark ? 0.05 : -0.25); return api; },
      attachMic: function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia indisponível'));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) { api.attachStream(stream); audio.stream = stream; return stream; });
      },
      attachStream: function (stream) { startMeter(ctxReady().createMediaStreamSource(stream)); return api; },
      attachAudio: function (el) { var cx = ctxReady(); if (!audio.src || audio.src.mediaElement !== el) { audio.src = cx.createMediaElementSource(el); audio.src.connect(cx.destination); } startMeter(audio.src); return api; },
      detachAudio: function () { stopMeter(); if (audio.stream) { audio.stream.getTracks().forEach(function (tr) { tr.stop(); }); audio.stream = null; } return api; },
      dispose: function () {
        running = false; cancelAnimationFrame(raf); api.detachAudio(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
        body.geometry.dispose(); body.material.dispose(); eyeGeo.dispose(); if (phones) phones.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); eyeL.material.dispose(); eyeR.material.dispose(); shadow.material.map.dispose(); shadow.material.dispose();
        renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    api.setState(opts.state || 'idle'); if (opts.backdrop) api.setBackdrop(opts.backdrop);
    return api;
  }

  root.JellyOrb = { create: create, STATES: STATES, EXPRESSIONS: EXPR };
})(typeof window !== 'undefined' ? window : this);
