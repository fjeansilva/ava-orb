# Ava Orb — avatares para o agente de voz

Seis módulos com a mesma API, para uma interface sem teclado e sem mouse: o orbe reage ao áudio (microfone quando ouve, voz do agente quando fala) e muda de postura a cada virada de turno.

| Módulo | Global | Visual |
| --- | --- | --- |
| `jelly-orb.js` | `JellyOrb` | Esfera de gel brilhante com dois olhos brancos simétricos e expressivos (9 expressões, piscar, olhar). **Escolhido para a Ava.** |
| `plasma-orb.js` | `PlasmaOrb` | Núcleo de luz líquida com anéis de energia (estilo "Smith") |
| `glass-orb.js` | `GlassOrb` | Bolha de vidro líquido iridescente (`dark: true` para fundo escuro) |
| `dots-orb.js` | `DotsOrb` | Pontos (`style: 'dots'`), wireframe neon (`'wire'`) ou ondas com aro (`'waves'`) |
| `fuzzy-orb.js` | `FuzzyOrb` | Pelúcia (descontinuado; mantido só para referência) |

`lab.html` mostra todos lado a lado, com 10 cores e as expressões do Gel. `voice/` é a conversa real com GPT-Live-1.

### Extras do JellyOrb

```js
orb.setExpression('happy', 1500);  // neutral | wide | think | happy | surprised | sleepy | wink | sad | suspicious
orb.look(0.3, -0.1);               // olhar (−1..1); look(null) volta ao automático
orb.setColor('#8a5bff');           // qualquer cor; sombra e borda derivam dela
```

## Arquivos

- `fuzzy-orb.js` — o componente (global `FuzzyOrb`, precisa de `THREE` r128+ carregado antes).
- `index.html` — demo: orbe grande + trilho de avatares de agentes, microfone com VAD simples, fala simulada via `speechSynthesis`.

## Uso

```html
<div id="orb" style="width:320px;height:320px"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="fuzzy-orb.js"></script>
<script>
  const orb = FuzzyOrb.create(document.getElementById('orb'), {
    color: '#c8395f',   // qualquer hex; as cores de ponta e borda derivam dela
    shells: 28,         // camadas de pelo (12–16 para avatares pequenos, 26–32 para o grande)
    furLength: 0.17,    // comprimento do pelo em fração do raio
    density: 9,         // fios por unidade — menor = fios maiores
    eyes: 'slits',      // 'slits' | 'none'
    headphones: true,   // fone de ouvido preto (false para tirar)
    liquid: 1,          // multiplicador da fluidez (1.3 = mais líquido)
    state: 'idle'
  });
</script>
```

### API

| Chamada | O que faz |
| --- | --- |
| `orb.setState(s)` | `idle`, `listening`, `thinking`, `speaking`, `sleeping`. Troca com interpolação suave (postura, olhos, liquidez, saturação). |
| `orb.setLevel(0..1)` | Amplitude de áudio externa. Sobe rápido, cai devagar. Use quando você já tem o nível (ex.: do WebRTC/LiveKit). |
| `orb.attachMic()` | Pede o microfone e passa a medir o RMS sozinho. Resolve com o `MediaStream` (reaproveite para o seu VAD/STT). |
| `orb.attachAudio(audioEl)` | Mede um `<audio>`/`<video>` — a voz do agente (TTS). |
| `orb.detachAudio()` | Para de medir e libera o microfone. |
| `orb.setColor(hex)` | Troca a cor em tempo real. |
| `orb.state` | Estado atual. O `<canvas>` também recebe `data-state` para estilizar em CSS. |
| `orb.dispose()` | Libera GPU, observers e áudio. |

### Fluxo típico com um agente de voz

```js
orb.setState('listening');  await orb.attachMic();        // turno do usuário
// VAD detecta fim de fala →
orb.setState('thinking');                                  // LLM/ferramentas rodando
// chegou áudio do TTS →
orb.setState('speaking');  orb.attachAudio(ttsAudioEl);    // boca sincronizada com a voz
// fim da fala →
orb.setState('listening'); await orb.attachMic();
```

Com GPT-Live/Realtime, Gemini Live ou LiveKit, use os eventos de turno do servidor para `setState` e o nível do track remoto para `setLevel`.

## Como funciona

- **Pelúcia**: a mesma esfera é desenhada N vezes (shells), cada camada empurrada ao longo da normal; uma textura de fios (triplanar, sem esticar nos polos) descarta pixels acima da altura de cada fio. Raízes mais escuras, pontas mais claras, brilho de veludo na borda (fresnel).
- **Líquido**: ruído simplex 3D desloca a superfície e recalcula a normal; a amplitude cresce com o nível de áudio; a região do rosto é atenuada para os olhos não derreterem.
- **Estados**: cada estado é um conjunto de alvos (liquidez, respiração, abertura dos olhos, inclinação, saturação) interpolados a cada frame.
- `prefers-reduced-motion` reduz a animação; a aba oculta pausa o loop.

## Limites

- Um `WebGLRenderer` por orbe: até ~8 orbes simultâneos por página é confortável; para mais, renderize só os visíveis (ou peça a versão com renderer compartilhado).
- Microfone exige HTTPS ou `localhost` e um gesto do usuário antes do `attachMic()`.
