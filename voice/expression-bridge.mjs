import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const EXPRESSIONS = new Set(['neutra', 'atenta', 'pensativa', 'feliz', 'surpresa', 'sonolenta', 'piscadinha', 'triste', 'desconfiada']);

function matches(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_048) throw new Error('Body too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Local application transport. These are not OpenAI/GPT-Live events.
export function createExpressionBridge({ token, timeoutMs = 5_000, attachTimeoutMs = 30_000 } = {}) {
  const sessions = new Map();

  function remove(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    clearTimeout(session.attachTimer);
    clearInterval(session.heartbeat);
    for (const pending of session.pending.values()) pending.finish(503, { error: 'Orb browser disconnected.' });
    session.stream?.end();
  }

  return {
    registerSession(sessionId) {
      if (!token) return undefined;
      if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) throw new Error('Invalid Live session ID.');
      remove(sessionId);
      const browserToken = randomBytes(32).toString('hex');
      const attachTimer = setTimeout(() => remove(sessionId), attachTimeoutMs);
      attachTimer.unref();
      sessions.set(sessionId, { browserToken, attachTimer, stream: null, heartbeat: null, pending: new Map() });
      return { token: browserToken };
    },

    async handle(req, res) {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/orb/')) return false;
      const route = /^\/api\/orb\/([\w-]+)\/(events|expression|ack)$/.exec(url.pathname);
      if (!route) { json(res, 404, { error: 'Unknown Orb route.' }); return true; }
      const [, sessionId, action] = route;
      const session = sessions.get(sessionId);
      const bearer = req.headers.authorization?.replace(/^Bearer /, '');
      const supplied = action === 'events' ? url.searchParams.get('token') : bearer;
      const expected = action === 'expression' ? token : session?.browserToken;
      if (!matches(supplied, expected)) { json(res, 401, { error: 'Unauthorized Orb request.' }); return true; }
      if (!session) { json(res, 404, { error: 'Unknown Orb session.' }); return true; }

      if (action === 'events' && req.method === 'GET') {
        if (session.stream) { json(res, 409, { error: 'An Orb browser is already attached.' }); return true; }
        clearTimeout(session.attachTimer);
        session.stream = res;
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write(': connected\n\n');
        session.heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
        session.heartbeat.unref();
        res.once('close', () => { if (sessions.get(sessionId) === session) remove(sessionId); });
        return true;
      }

      if (req.method !== 'POST' || action === 'events') { json(res, 405, { error: 'Method not allowed.' }); return true; }
      let body;
      try { body = await readJson(req); }
      catch { json(res, 400, { error: 'Invalid Orb request body.' }); return true; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { json(res, 400, { error: 'Expected an object.' }); return true; }

      if (action === 'ack') {
        const pending = session.pending.get(body.id);
        if (!pending) { json(res, 404, { error: 'Expression request expired or already acknowledged.' }); return true; }
        if (typeof body.applied !== 'boolean') { json(res, 400, { error: 'Missing application result.' }); return true; }
        if (body.applied) pending.finish(200, { applied: true, ...pending.request });
        else pending.finish(502, { error: 'Orb browser could not apply the expression.' });
        json(res, 200, { received: true });
        return true;
      }

      const { expression, duration_ms = 3_000 } = body;
      if (!EXPRESSIONS.has(expression) || !Number.isInteger(duration_ms) || duration_ms < 800 || duration_ms > 15_000 || Object.keys(body).some((key) => !['expression', 'duration_ms'].includes(key))) {
        json(res, 400, { error: 'Invalid expression or duration (800–15000 ms).' }); return true;
      }
      if (!session.stream || session.stream.destroyed) { json(res, 503, { error: 'Orb browser is not attached.' }); return true; }
      if (session.pending.size >= 16) { json(res, 429, { error: 'Too many pending expressions.' }); return true; }
      const id = randomUUID();
      const request = { expression, duration_ms };
      const timer = setTimeout(() => finish(504, { error: 'Orb browser did not acknowledge the expression in time.' }), timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        session.pending.delete(id);
        res.off('close', cleanup);
      }
      function finish(status, result) {
        cleanup();
        json(res, status, result);
      }
      session.pending.set(id, { request, finish });
      res.once('close', cleanup);
      session.stream.write(`data: ${JSON.stringify({ type: 'set_expression', id, ...request, expiresAt: Date.now() + timeoutMs })}\n\n`);
      return true;
    },

    close() { for (const id of sessions.keys()) remove(id); },
  };
}
