// Ava Voice — servidor local (Node >= 22).
// Serve a página e cria a sessão GPT-Live-1 trocando o SDP do browser pelo SDP de resposta.
// A chave fica só aqui. Rode:  node --env-file=.env server.mjs   (ou exporte OPENAI_API_KEY)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENAI_API_KEY;
const VOICE_MODEL = process.env.AVA_VOICE_MODEL || 'gpt-live-1';
const BACKEND_MODEL = process.env.AVA_BACKEND_MODEL || 'gpt-5.6-terra';
const VOICE = process.env.AVA_VOICE || 'Vesper';
const LIVE_URL = process.env.OPENAI_LIVE_URL || 'https://api.openai.com/v1/live/sessions';

if (!API_KEY) { console.error('OPENAI_API_KEY não definida. Crie um .env com OPENAI_API_KEY=sk-... e rode: node --env-file=.env server.mjs'); process.exit(1); }

const INSTRUCTIONS = await readFile(path.join(here, 'prompt-ava.md'), 'utf8');

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/voice.js': ['voice.js', 'text/javascript; charset=utf-8'],
  '/jelly-orb.js': ['../jelly-orb.js', 'text/javascript; charset=utf-8'],
  '/plasma-orb.js': ['../plasma-orb.js', 'text/javascript; charset=utf-8'],
  '/glass-orb.js': ['../glass-orb.js', 'text/javascript; charset=utf-8'],
  '/dots-orb.js': ['../dots-orb.js', 'text/javascript; charset=utf-8'],
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Sessão GPT-Live-1 com delegação "responses": o modelo de voz conversa; o backend raciocina e usa ferramentas.
// function sessionConfig(sdp) {
//   return {
//     session: {
//       model: VOICE_MODEL,
//       instructions: INSTRUCTIONS,
//       audio: { output: { voice: VOICE } },
//       delegation: {
//         type: 'responses',
//         responses: {
//           model: BACKEND_MODEL,
//           instructions: 'Você é o backend da Ava, assistente do Jean (VP de Engenharia da Woba). Responda em português do Brasil, de forma curta e concreta, para ser dita em voz alta. Use as ferramentas quando precisar de dado real; nunca invente números.',
//           tools: [
//             { type: 'web_search' },
//             {
//               type: 'function', name: 'set_expression',
//               description: 'Muda a expressão do rosto da Ava na tela por alguns segundos. Use quando a emoção da resposta for clara: feliz para boas notícias e agradecimentos, surpresa para algo inesperado, pensativa enquanto analisa, triste para más notícias ou desculpas, desconfiada para algo duvidoso, piscadinha para cumplicidade ou brincadeira, sonolenta para despedidas à noite, atenta quando pergunta algo, neutra para voltar ao normal.',
//               parameters: { type: 'object', properties: {
//                 expression: { type: 'string', enum: ['neutra', 'atenta', 'pensativa', 'feliz', 'surpresa', 'sonolenta', 'piscadinha', 'triste', 'desconfiada'] },
//                 duration_ms: { type: 'integer', description: 'Duração em ms (800 a 15000). Padrão 3000.' }
//               }, required: ['expression'], additionalProperties: false },
//             },
//             {
//               type: 'function', name: 'get_local_time',
//               description: 'Data e hora atuais no fuso do Jean (America/Sao_Paulo).',
//               parameters: { type: 'object', properties: {}, additionalProperties: false },
//             },
//           ],
//           tool_choice: 'auto',
//         },
//       },
//     },
//     transport: { type: 'webrtc', sdp },
//   };
// }

function sessionConfig(sdp) {
  return {
    session: {
      model: VOICE_MODEL,
      instructions: [
        INSTRUCTIONS,
        "The delegated backend is Ava running through the Pi harness.",
        "When the user explicitly asks to use or test the backend, delegate to it.",
        "Wait for the backend result before reporting its answer.",
        "Relay the result naturally without inventing actions or capabilities.",
      ].join("\n"),
      audio: {
        output: {
          voice: VOICE,
        },
      },
      delegation: {
        type: "client",
      },
    },
    transport: {
      type: "webrtc",
      sdp,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const origin = req.headers.origin;
  if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) return json(res, 403, { error: 'origem não permitida' });

  if (req.method === 'POST' && url.pathname === '/api/session') {
    let sdp;
    try { ({ sdp } = JSON.parse(await readBody(req))); } catch { return json(res, 400, { error: 'JSON inválido' }); }
    if (typeof sdp !== 'string' || !sdp.includes('m=audio')) return json(res, 400, { error: 'SDP inválido' });
    try {
      const r = await fetch(LIVE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(sessionConfig(sdp)),
      });
      const text = await r.text();
      if (!r.ok) { console.error('[live] erro', r.status, text.slice(0, 600)); return json(res, r.status, { error: 'falha ao criar sessão', status: r.status, detail: safeJson(text) }); }
      const data = safeJson(text);
      console.log('[live] sessão', data?.session?.id, 'voz', VOICE_MODEL, 'backend', BACKEND_MODEL);
      return json(res, 201, { id: data?.session?.id, sdp: data?.transport?.sdp });
    } catch (e) {
      console.error('[live] exceção', e);
      return json(res, 502, { error: String(e?.message || e) });
    }
  }

  if (req.method === 'GET' && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    try {
      const body = await readFile(path.join(here, file));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(body);
    } catch { return json(res, 404, { error: 'não encontrado' }); }
  }
  json(res, 404, { error: 'não encontrado' });
});

function safeJson(t) { try { return JSON.parse(t); } catch { return t; } }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ava Voice em http://localhost:${PORT}  (voz ${VOICE_MODEL} · backend ${BACKEND_MODEL})`);
});
