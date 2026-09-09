// Anotações gerais da tarefa: HTML de conjunto fechado, guardado como blob opaco no backend.
// As imagens NÃO viajam embutidas — cada <img> guarda só o id do anexo (data-attachment-id) e o
// `src` real (um objectURL do blob baixado com o token do usuário) é resolvido em tempo de tela.

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'UL', 'OL', 'LI', 'H3', 'BLOCKQUOTE', 'IMG', 'A', 'DIV', 'SPAN',
]);

/** Tags que não têm papel próprio na anotação — o conteúdo sobe pro nó pai. */
const UNWRAP_TAGS = new Set(['DIV', 'SPAN']);

const TAG_ALIASES: Record<string, string> = { STRIKE: 'S', DEL: 'S' };

const ALLOWED_ATTRS: Record<string, string[]> = {
  IMG: ['data-attachment-id', 'alt'],
  A: ['href', 'target', 'rel'],
};

export const ATTACHMENT_ID_ATTR = 'data-attachment-id';

function isSafeHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('mailto:');
}

function sanitizeElement(el: Element, doc: Document): void {
  for (const child of Array.from(el.children)) sanitizeElement(child, doc);

  const tag = el.tagName.toUpperCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Script/style e afins somem inteiros; o resto vira só o texto que continha.
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
      el.remove();
      return;
    }
    unwrap(el);
    return;
  }

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const allowed = ALLOWED_ATTRS[tag] ?? [];
    if (!allowed.includes(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href' && !isSafeHref(attr.value)) el.removeAttribute(attr.name);
  }

  if (tag === 'IMG' && !el.getAttribute(ATTACHMENT_ID_ATTR)) {
    // Imagem sem anexo por trás (ex.: colada de outro site) não tem como ser servida depois.
    el.remove();
    return;
  }

  if (tag === 'A') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }

  if (UNWRAP_TAGS.has(tag)) {
    unwrap(el);
    return;
  }

  const alias = TAG_ALIASES[tag];
  if (alias) replaceTag(el, alias, doc);
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function replaceTag(el: Element, tag: string, doc: Document): void {
  const replacement = doc.createElement(tag);
  while (el.firstChild) replacement.appendChild(el.firstChild);
  el.replaceWith(replacement);
}

/** Limpa HTML vindo do contenteditable ou de uma colagem externa, deixando só o subconjunto seguro. */
export function sanitizeNotesHtml(html: string | null | undefined): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const child of Array.from(doc.body.children)) sanitizeElement(child, doc);
  return doc.body.innerHTML.trim();
}

/** Texto puro da anotação — usado pra saber se está vazia e pra prévias curtas. */
export function notesToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  // Blocos viram espaço, senão "<p>a</p><p>b</p>" colaria como "ab".
  const spaced = html.replace(/<\/(p|li|h3|blockquote|ul|ol)>|<br\s*\/?>/gi, ' ');
  const doc = new DOMParser().parseFromString(`<body>${spaced}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Uma anotação só com imagens não tem texto, mas continua sendo conteúdo. */
export function isNotesEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return notesToPlainText(html).length === 0 && attachmentIdsInNotes(html).length === 0;
}

export function attachmentIdsInNotes(html: string | null | undefined): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const ids: string[] = [];
  for (const img of Array.from(doc.querySelectorAll(`img[${ATTACHMENT_ID_ATTR}]`))) {
    const id = img.getAttribute(ATTACHMENT_ID_ATTR);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Remove as imagens mantendo o texto — usado ao duplicar tarefa, já que os anexos não são copiados. */
export function stripNotesImages(html: string | null | undefined): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const img of Array.from(doc.querySelectorAll('img'))) img.remove();
  return sanitizeNotesHtml(doc.body.innerHTML);
}

/** Troca `data-attachment-id` por `src` de verdade, pra exibir. Não altera o HTML guardado. */
export function withResolvedImages(html: string, urlFor: (attachmentId: string) => string | null): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const img of Array.from(doc.querySelectorAll(`img[${ATTACHMENT_ID_ATTR}]`))) {
    const url = urlFor(img.getAttribute(ATTACHMENT_ID_ATTR) ?? '');
    if (url) img.setAttribute('src', url);
    else img.removeAttribute('src');
  }
  return doc.body.innerHTML;
}
