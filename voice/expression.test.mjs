import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createExpressionBridge } from './expression-bridge.mjs';
import { createExpressionController, connectExpressionEvents } from './expression-client.mjs';

async function fixture(t, options = {}) {
  const bridge = createExpressionBridge({ token: 'backend-secret', ...options });
  const server = createServer((req, res) => { void bridge.handle(req, res).catch((error) => { res.statusCode = 500; res.end(error.message); }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const controllers = [];
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    bridge.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    bridge, base,
    async browser(id) {
      const { token } = bridge.registerSession(id);
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(`${base}/api/orb/${id}/events?token=${token}`, { signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      return {
        token, controller,
        async next() {
          for (;;) {
            const boundary = buffer.indexOf('\n\n');
            if (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (frame.startsWith('data: ')) return JSON.parse(frame.slice(6));
              continue;
            }
            const { value, done } = await reader.read();
            if (done) throw new Error('Expression stream closed.');
            buffer += decoder.decode(value, { stream: true });
          }
        },
      };
    },
    post(id, action, body, token = 'backend-secret', signal) {
      return fetch(`${base}/api/orb/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal });
    },
  };
}

test('expression is sent only to its session and success requires that browser acknowledgement', async (t) => {
  const f = await fixture(t);
  const a = await f.browser('live_a');
  const b = await f.browser('live_b');
  let completed = false;
  const result = f.post('live_a', 'expression', { expression: 'feliz' }).then((response) => { completed = true; return response; });
  const command = await a.next();
  assert.equal(command.type, 'set_expression');
  assert.equal(command.duration_ms, 3000);
  assert.equal(completed, false);
  assert.equal((await f.post('live_b', 'ack', { id: command.id, applied: true }, b.token)).status, 404);
  assert.equal((await f.post('live_a', 'ack', { id: command.id, applied: true }, b.token)).status, 401);
  assert.equal(completed, false);
  assert.equal((await f.post('live_a', 'ack', { id: command.id, applied: true }, a.token)).status, 200);
  assert.deepEqual(await (await result).json(), { applied: true, expression: 'feliz', duration_ms: 3000 });
  assert.equal((await f.post('live_a', 'ack', { id: command.id, applied: true }, a.token)).status, 404);
});

test('invalid input and unauthenticated callers cannot issue expressions', async (t) => {
  const f = await fixture(t);
  const browser = await f.browser('live_a');
  assert.equal((await f.post('live_a', 'expression', { expression: 'feliz' }, browser.token)).status, 401);
  for (const request of [{ expression: 'unknown' }, { expression: 'feliz', duration_ms: 799 }, { expression: 'feliz', duration_ms: 15001 }, { expression: 'feliz', duration_ms: 1234.5 }, { expression: 'feliz', extra: true }]) {
    assert.equal((await f.post('live_a', 'expression', request)).status, 400);
  }
  assert.equal((await fetch(`${f.base}/api/orb/live_a/events?token=wrong`)).status, 401);
  assert.equal((await f.post('missing', 'expression', { expression: 'feliz' })).status, 404);
});

test('browser failure, timeout and disconnection do not become successful tool results', async (t) => {
  const f = await fixture(t, { timeoutMs: 100 });
  const browser = await f.browser('live_a');
  const failed = f.post('live_a', 'expression', { expression: 'feliz' });
  const command = await browser.next();
  await f.post('live_a', 'ack', { id: command.id, applied: false }, browser.token);
  assert.equal((await failed).status, 502);
  const timedOut = f.post('live_a', 'expression', { expression: 'triste' });
  const expired = await browser.next();
  assert.equal((await timedOut).status, 504);
  assert.equal((await f.post('live_a', 'ack', { id: expired.id, applied: true }, browser.token)).status, 404);
  const disconnected = f.post('live_a', 'expression', { expression: 'neutra' });
  await browser.next();
  browser.controller.abort();
  assert.equal((await disconnected).status, 503);
});

test('explicit expressions last for their requested duration before automatic expressions resume', () => {
  let time = 0;
  const calls = [];
  const controller = createExpressionController({ setExpression: (...args) => calls.push(args) }, () => time);
  controller.apply({ expression: 'piscadinha', duration_ms: 800 });
  controller.automatic('sad', 2500);
  time = 799;
  controller.automatic('think', 2500);
  assert.deepEqual(calls, [['wink', 800]]);
  time = 800;
  controller.automatic('happy', 2500);
  assert.deepEqual(calls[1], ['happy', 2500]);
  assert.throws(() => controller.apply({ expression: 'constructor' }), /Invalid/);
  assert.throws(() => controller.apply({ expression: 'feliz', duration_ms: 15001 }), /Invalid/);
  controller.apply({ expression: 'neutra' });
  assert.deepEqual(calls[2], ['neutral', 3000]);
  controller.reset();
  controller.automatic('sleepy', 1000);
  assert.deepEqual(calls.at(-1), ['sleepy', 1000]);
});

test('browser applies commands before acknowledgement, refuses expired commands, and closes on teardown', async () => {
  let source;
  class FakeSource { constructor(url) { this.url = url; source = this; } close() { this.closed = true; } }
  const applied = [], acknowledgements = [];
  const connection = connectExpressionEvents({
    sessionId: 'live_a', token: 'browser-secret', EventSourceImpl: FakeSource, now: () => 100,
    apply: (command) => applied.push(command.expression),
    fetchImpl: async (_url, options) => {
      const ack = JSON.parse(options.body);
      if (ack.applied) assert.deepEqual(applied, ['feliz']);
      acknowledgements.push(ack);
      return Response.json({ received: true });
    },
  });
  await source.onmessage({ data: JSON.stringify({ type: 'set_expression', id: 'one', expression: 'feliz', expiresAt: 200 }) });
  await source.onmessage({ data: JSON.stringify({ type: 'set_expression', id: 'two', expression: 'triste', expiresAt: 100 }) });
  assert.deepEqual(acknowledgements, [{ id: 'one', applied: true }, { id: 'two', applied: false }]);
  connection.close();
  await source.onmessage({ data: JSON.stringify({ type: 'set_expression', id: 'three', expression: 'feliz', expiresAt: 200 }) });
  assert.equal(source.closed, true);
  assert.equal(acknowledgements.length, 2);
});
