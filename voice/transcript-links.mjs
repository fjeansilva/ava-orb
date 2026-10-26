// Render links without interpreting transcript text as HTML.
export function renderTranscriptText(element, text) {
  const document = element.ownerDocument;
  const nodes = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/(?:[^()\s<>]|\([^()\s<>]*\))+)\)|https?:\/\/[^\s<>"']+/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(document.createTextNode(text.slice(cursor, match.index)));
    const raw = match[2] || match[0];
    let href = match[2] ? raw : raw.replace(/[.,;!?]+$/, "");
    while (href.endsWith(")") && (href.match(/\)/g)?.length || 0) > (href.match(/\(/g)?.length || 0)) href = href.slice(0, -1);
    try {
      const url = new URL(href);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid source URL.");
      const link = document.createElement("a");
      link.href = url.href;
      link.textContent = match[1] || href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      nodes.push(link);
      if (!match[2]) nodes.push(document.createTextNode(raw.slice(href.length)));
    } catch { nodes.push(document.createTextNode(match[0])); }
    cursor = match.index + match[0].length;
  }
  nodes.push(document.createTextNode(text.slice(cursor)));
  element.replaceChildren(...nodes);
}
