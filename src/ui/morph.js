// Updates an element to match new HTML while keeping the nodes that did not change.
// Replacing innerHTML on every refresh swaps the button under the pointer: its hover shade restarts
// and a press that spans the swap never becomes a click. Here a button stays the same element, and only
// its text and attributes are patched.

const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && a.getAttribute('type') === b.getAttribute('type')));

function syncAttributes(el, next) {
  for (const { name } of [...el.attributes]) if (!next.hasAttribute(name)) el.removeAttribute(name);
  for (const { name, value } of next.attributes) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function patch(el, next) {
  const have = el.childNodes;
  const want = next.childNodes;
  let i = 0;
  for (; i < want.length; i++) {
    const w = want[i];
    const h = have[i];
    if (!h) {
      el.appendChild(w.cloneNode(true));
    } else if (!same(h, w)) {
      el.replaceChild(w.cloneNode(true), h);
    } else if (w.nodeType === 1) {
      syncAttributes(h, w);
      // A hidden input's value, a focused field and a toggled <details> belong to the player: leave them be.
      if (w.tagName !== 'INPUT' && w.tagName !== 'TEXTAREA' && w.tagName !== 'SELECT') patch(h, w);
    } else if (h.data !== w.data) {
      h.data = w.data;
    }
  }
  while (el.childNodes.length > want.length) el.lastChild.remove();
}

export function morph(el, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  patch(el, t.content);
}
