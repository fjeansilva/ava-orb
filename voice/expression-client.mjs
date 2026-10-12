const EXPRESSIONS = Object.freeze({ neutra: 'neutral', atenta: 'wide', pensativa: 'think', feliz: 'happy', surpresa: 'surprised', sonolenta: 'sleepy', piscadinha: 'wink', triste: 'sad', desconfiada: 'suspicious' });

export function createExpressionController(orb, now = () => performance.now()) {
  let explicitUntil = 0;
  return {
    apply({ expression, duration_ms = 3_000 }) {
      if (!Object.hasOwn(EXPRESSIONS, expression) || !Number.isInteger(duration_ms) || duration_ms < 800 || duration_ms > 15_000) {
        throw new Error('Invalid expression or duration.');
      }
      orb.setExpression(EXPRESSIONS[expression], duration_ms);
      explicitUntil = now() + duration_ms;
    },
    automatic(expression, durationMs) {
      if (now() < explicitUntil) return;
      orb.setExpression(expression, durationMs);
    },
    reset() { explicitUntil = 0; orb.setExpression(null); },
  };
}

export function connectExpressionEvents({ sessionId, token, apply, onError = console.warn, EventSourceImpl = EventSource, fetchImpl = fetch, now = Date.now }) {
  const path = `/api/orb/${encodeURIComponent(sessionId)}`;
  const source = new EventSourceImpl(`${path}/events?token=${encodeURIComponent(token)}`);
  const controller = new AbortController();
  let closed = false;

  function close() {
    closed = true;
    controller.abort();
    source.close();
  }

  source.onmessage = async ({ data }) => {
    if (closed) return;
    try {
      const command = JSON.parse(data);
      if (command?.type !== 'set_expression' || typeof command.id !== 'string' || !Number.isFinite(command.expiresAt)) return;
      let applied = false;
      if (now() < command.expiresAt) {
        try { apply(command); applied = true; }
        catch { /* Report the failed application without claiming success. */ }
      }
      const response = await fetchImpl(`${path}/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: command.id, applied }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
      });
      if (!response.ok) throw new Error('Orb expression acknowledgement failed.');
    } catch {
      if (!closed) onError('Could not acknowledge the Orb expression.');
    }
  };
  source.onerror = () => {
    if (closed) return;
    close();
    onError('Expression connection closed. Start a new voice session to reconnect.');
  };
  return { close };
}
