// Markdown → safe HTML. Notes come from other people, and this origin holds
// your private keys, so every bit of rendered HTML goes through DOMPurify.

import { Marked } from './marked.esm.js';
import DOMPurify from './purify.es.mjs';

const marked = new Marked({ gfm: true, breaks: true });

const BLOCK = {
  FORBID_TAGS: ['style', 'form', 'button', 'select', 'textarea', 'option', 'dialog', 'template', 'svg', 'math'],
  FORBID_ATTR: ['style', 'class', 'id', 'name', 'srcset'],
  ALLOW_DATA_ATTR: false,
};
const INLINE = {
  ALLOWED_TAGS: ['a', 'strong', 'b', 'em', 'i', 'code', 'del', 's', 'mark', 'kbd', 'sub', 'sup', 'br'],
  ALLOWED_ATTR: ['href', 'title'],
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
  }
  if (node.nodeName === 'IMG') {
    node.setAttribute('loading', 'lazy');
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
  if (node.nodeName === 'INPUT') {
    // The only inputs markdown produces are task-list checkboxes; force anything else into one.
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
  }
});

export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(String(md ?? '')), BLOCK);
}

export function renderInline(md) {
  return DOMPurify.sanitize(marked.parseInline(String(md ?? '')), INLINE);
}
