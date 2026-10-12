/*
 * Ava Voice — cliente WebRTC para GPT-Live-1, ligado ao FuzzyOrb.
 * Fluxo: mic → RTCPeerConnection → POST /api/session (o servidor troca o SDP) → áudio remoto + canal "oai-events".
 * Estados do orbe: full-duplex, então a prioridade é: Ava falando > usuário falando > backend trabalhando > ouvindo.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var orb = JellyOrb.create($('orb'), { color: '#f71c5a', eyeColor: '#121016', headphones: true, backdrop: 'light' });
  // Expressões: a Ava escolhe pelo que fala (léxico abaixo, por frase), e o backend pode pedir uma
  // explicitamente com a ferramenta set_expression. Estados de turno dão o padrão (atenta / pensativa / feliz).
  var EXPR_PT = { neutra: 'neutral', atenta: 'wide', pensativa: 'think', feliz: 'happy', surpresa: 'surprised', sonolenta: 'sleepy', piscadinha: 'wink', triste: 'sad', desconfiada: 'suspicious' };
  var EXPR_RULES = [
    { re: /\b(haha|hehe|rs+|kkk+|que bom|ótimo|ótima|legal|maravilha|perfeito|parabéns|boa!|adorei|feliz|com prazer|claro!)\b/i, expr: 'happy' },
    { re: /\b(uau|nossa|sério\?|caramba|eita|não acredito|surpre|de verdade\?|jura\?)/i, expr: 'surprised' },
    { re: /\b(hmm+|hum+|deixa eu (ver|pensar)|pensando|vou verificar|vou checar|estou vendo|um momento|só um segundo|calculando)\b/i, expr: 'think' },
    { re: /\b(desculp|infelizmente|sinto muito|que pena|não consegui|não deu|falhou|erro|lamento|triste)/i, expr: 'sad' },
    { re: /\b(será\?|duvido|tem certeza|hmm, não sei|suspeito|estranho|não confio|desconfi)/i, expr: 'suspicious' },
    { re: /\b(boa noite|dormir|cansad|sono|descansar|até amanhã|bocej)/i, expr: 'sleepy' },
    { re: /\b(piscadinha|fica entre nós|segredo|;\)|brincadeira|só entre a gente)/i, expr: 'wink' },
    { re: /\?\s*$/, expr: 'wide' }
  ];
  var avaSentence = '';
  function expressFromText(text) {
    for (var i = 0; i < EXPR_RULES.length; i++) if (EXPR_RULES[i].re.test(text)) { orb.setExpression(EXPR_RULES[i].expr, 2800); return EXPR_RULES[i].expr; }
    return null;
  }
  function onAvaDelta(delta) {
    avaSentence += delta;
    if (/[.!?…]\s*$/.test(avaSentence) || avaSentence.length > 140) { expressFromText(avaSentence); avaSentence = ''; }
  }
  var LABEL = { idle: 'ociosa', listening: 'ouvindo', thinking: 'pensando', speaking: 'falando', sleeping: 'desconectada' };

  var pc = null, dc = null, micStream = null, remoteAudio = $('remote'), sessionId = null;
  var ctx = null, remoteAnalyser = null, remoteBuf = null, micAnalyser = null, micBuf = null;
  var avaSpeaking = false, userSpeaking = false, pendingDelegations = 0, connected = false;
  var lastAva = 0, lastUser = 0;

  // ---------- transcrição ----------
  var transcript = $('transcript'), current = { who: null, el: null };
  function appendDelta(who, delta) {
    if (current.who !== who) {
      var row = document.createElement('div'); row.className = 'turn ' + who;
      var name = document.createElement('span'); name.className = 'who'; name.textContent = who === 'user' ? 'Jean' : 'Ava';
      var txt = document.createElement('span'); txt.className = 'txt';
      row.appendChild(name); row.appendChild(txt); transcript.appendChild(row);
      current = { who: who, el: txt };
    }
    current.el.textContent += delta;
    transcript.scrollTop = transcript.scrollHeight;
  }
  function note(text, kind) {
    var row = document.createElement('div'); row.className = 'turn note' + (kind ? ' ' + kind : ''); row.textContent = text;
    transcript.appendChild(row); transcript.scrollTop = transcript.scrollHeight; current = { who: null, el: null };
  }

  // ---------- estado do orbe ----------
  var status = $('status'), statusText = $('statusText');
  function setState(s) {
    if (orb.state === s) return;
    orb.setState(s); status.dataset.s = s; statusText.textContent = LABEL[s];
  }
  function reconcile() {
    if (!connected) return setState('sleeping');
    if (avaSpeaking) return setState('speaking');
    if (userSpeaking) return setState('listening');
    if (pendingDelegations > 0) return setState('thinking');
    setState('listening');
  }

  // ---------- medição de áudio (quem está falando) ----------
  function rms(an, buf) {
    an.getFloatTimeDomainData(buf); var s = 0;
    for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function meterLoop() {
    if (!connected) return;
    requestAnimationFrame(meterLoop);
    var now = performance.now();
    if (remoteAnalyser) {
      var ra = rms(remoteAnalyser, remoteBuf);
      if (ra > 0.015) lastAva = now;
      avaSpeaking = now - lastAva < 350;
      if (avaSpeaking) orb.setLevel(Math.min(1, (ra - 0.01) * 7));
    }
    if (micAnalyser && !avaSpeaking) {
      var ua = rms(micAnalyser, micBuf);
      if (ua > 0.02) lastUser = now;
      userSpeaking = now - lastUser < 600;
      orb.setLevel(userSpeaking ? Math.min(1, (ua - 0.012) * 6) : 0);
    }
    reconcile();
  }

  // ---------- eventos do canal de dados ----------
  var pendingCalls = {};  // response_id → [{call_id,name,arguments}]
  function onEvent(ev) {
    switch (ev.type) {
      case 'session.started':
        connected = true; sessionId = ev.session && ev.session.id || sessionId;
        note('Conectada. Pode falar.', 'ok'); reconcile(); break;
      case 'session.input_transcript.delta': appendDelta('user', ev.delta); lastUser = performance.now(); if (/\b(obrigad|valeu|boa noite|tchau)\b/i.test(ev.delta)) orb.setExpression(/noite|tchau/i.test(ev.delta) ? 'sleepy' : 'happy', 2500); break;
      case 'session.output_transcript.delta': appendDelta('ava', ev.delta); onAvaDelta(ev.delta); break;
      case 'session.delegation.created':
        // pendingDelegations++; reconcile();
        // note('Ava delegou uma tarefa ao backend…', 'dim'); if (orb.setExpression) orb.setExpression('think', 2500); break;
        note('Ava delegou uma tarefa ao backend…', 'dim');
        break;
      case 'response.event': onResponseEvent(ev); break;
      case 'session.usage.updated':
        if (ev.usage && typeof ev.usage.seconds === 'number') $('usage').textContent = Math.round(ev.usage.seconds) + ' s · ~US$ ' + (ev.usage.seconds / 60 * 0.05).toFixed(3);
        break;
      case 'session.closed':
        note('Sessão encerrada (' + (ev.reason || 'fim') + ').', 'dim'); teardown(); break;
      case 'error':
        note('Erro: ' + (ev.error && (ev.error.message || ev.error.code) || JSON.stringify(ev)), 'err'); if (orb.setExpression) orb.setExpression('sad', 2500); break;
      default: break;
    }
  }
  function onResponseEvent(ev) {
    var inner = ev.event || {};
    switch (inner.type) {
      case 'response.output_item.done':
        if (inner.item && inner.item.type === 'function_call') {
          (pendingCalls[inner.response_id] = pendingCalls[inner.response_id] || []).push(inner.item);
        }
        break;
      case 'response.completed':
      case 'response.done': {
        var calls = pendingCalls[inner.response && inner.response.id] || pendingCalls[inner.response_id] || [];
        delete pendingCalls[inner.response && inner.response.id]; delete pendingCalls[inner.response_id];
        if (calls.length) {
          // o backend pediu ferramentas: executa aqui, devolve e manda continuar
          calls.forEach(function (c) {
            var output = runTool(c.name, c.arguments);
            send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: output } });
          });
          send({ type: 'response.create' });
        } else {
          pendingDelegations = Math.max(0, pendingDelegations - 1); reconcile();
        }
        break;
      }
      default: break;
    }
  }
  // Ferramentas locais do app. Adicione as suas (DataHub, calendário, escalações) aqui e no server.mjs.
  function runTool(name, args) {
    try {
      if (name === 'set_expression') {
        var args2 = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {});
        var k = EXPR_PT[(args2.expression || '').toLowerCase()] || args2.expression;
        if (!orb.EXPRESSIONS || orb.EXPRESSIONS.indexOf(k) < 0) return 'expressão inválida; use: ' + Object.keys(EXPR_PT).join(', ');
        orb.setExpression(k, Math.min(15000, Math.max(800, args2.duration_ms || 3000)));
        return 'ok: ' + (args2.expression);
      }
      if (name === 'get_local_time') {
        return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date());
      }
      return 'ferramenta desconhecida: ' + name;
    } catch (e) { return 'erro: ' + e.message; }
  }
  function send(obj) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj));
  }

  // ---------- conexão ----------
  async function connect() {
    $('talk').dataset.busy = '1'; note('Conectando…', 'dim');
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 512; micBuf = new Float32Array(512);
      ctx.createMediaStreamSource(micStream).connect(micAnalyser);

      pc = new RTCPeerConnection();
      micStream.getAudioTracks().forEach(function (t) { pc.addTrack(t, micStream); });
      pc.ontrack = function (e) {
        var stream = e.streams[0] || new MediaStream([e.track]);
        remoteAudio.srcObject = stream; remoteAudio.play().catch(function () {});
        remoteAnalyser = ctx.createAnalyser(); remoteAnalyser.fftSize = 512; remoteBuf = new Float32Array(512);
        ctx.createMediaStreamSource(stream).connect(remoteAnalyser);
      };
      pc.onconnectionstatechange = function () {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') { note('Conexão perdida.', 'err'); teardown(); }
      };
      dc = pc.createDataChannel('oai-events');
      dc.onmessage = function (m) { try { onEvent(JSON.parse(m.data)); } catch (e) { console.warn('evento inválido', m.data); } };
      dc.onopen = function () { console.log('[ava] canal aberto'); };

      var offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await new Promise(function (resolve) {
        if (pc.iceGatheringState === 'complete') return resolve();
        var t = setTimeout(resolve, 2500);
        pc.onicegatheringstatechange = function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } };
      });

      var r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });
      var data = await r.json();
      if (!r.ok || !data.sdp) throw new Error(data.error ? data.error + (data.detail ? ' — ' + JSON.stringify(data.detail).slice(0, 300) : '') : 'sem SDP de resposta');
      sessionId = data.id;
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      connected = true; reconcile(); meterLoop();
      delete $('talk').dataset.busy; $('talk').setAttribute('aria-pressed', 'true'); $('talk').setAttribute('aria-label', 'Desligar microfone');
    } catch (e) {
      note('Não conectou: ' + e.message, 'err'); teardown();
    }
  }
  function teardown() {
    connected = false; avaSpeaking = userSpeaking = false; pendingDelegations = 0;
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    dc = null; remoteAnalyser = null; micAnalyser = null; orb.setLevel(0);
    delete $('talk').dataset.busy; $('talk').setAttribute('aria-pressed', 'false'); $('talk').setAttribute('aria-label', 'Ligar microfone'); reconcile();
  }
  function disconnect() {
    if (dc && dc.readyState === 'open') {
      send({ type: 'session.close' });
      setTimeout(function () { if (pc) teardown(); }, 2500);   // segurança se session.closed não chegar
    } else teardown();
  }

  // um único botão: liga o som (abre mic + sessão) ou desliga (encerra a sessão)
  $('talk').addEventListener('click', function () { if ($('talk').dataset.busy) return; if ($('talk').getAttribute('aria-pressed') === 'true') disconnect(); else connect(); });
  // Teclado é só atalho de acessibilidade: espaço conecta/encerra.
  document.addEventListener('keydown', function (e) { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('talk').click(); } });

  reconcile();
})();
