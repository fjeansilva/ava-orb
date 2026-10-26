import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTranscriptText } from './transcript-links.mjs';

function element() {
  return {
    ownerDocument: {
      createTextNode: text => ({ textContent: text }),
      createElement: tag => ({ tag }),
    },
    replaceChildren(...nodes) { this.nodes = nodes; },
  };
}

test('source citations become safe clickable links without rendering HTML', () => {
  const el = element();
  renderTranscriptText(el, '<img src=x onerror=alert(1)> See [Source](https://example.com/news).');
  const link = el.nodes.find(node => node.tag === 'a');
  assert.deepEqual(link, { tag: 'a', href: 'https://example.com/news', textContent: 'Source', target: '_blank', rel: 'noopener noreferrer' });
  assert.equal(el.nodes[0].textContent, '<img src=x onerror=alert(1)> See ');
  renderTranscriptText(el, 'See [Source](https://example.com/Thing_(name)).');
  assert.equal(el.nodes.find(node => node.tag === 'a').href, 'https://example.com/Thing_(name)');
});

test('bare links retain punctuation and rerender from the full accumulated transcript', () => {
  const el = element();
  renderTranscriptText(el, 'See https://example.');
  renderTranscriptText(el, 'See https://example.com/wiki/Thing_(name).');
  assert.equal(el.nodes.find(node => node.tag === 'a').href, 'https://example.com/wiki/Thing_(name)');
  assert.equal(el.nodes.map(node => node.textContent).join(''), 'See https://example.com/wiki/Thing_(name).');
});

test('unsupported schemes and credential-bearing links remain plain text', () => {
  const el = element();
  const text = '[bad](javascript:alert(1)) https://user:password@example.com';
  renderTranscriptText(el, text);
  assert.equal(el.nodes.some(node => node.tag === 'a'), false);
  assert.equal(el.nodes.map(node => node.textContent).join(''), text);
});
