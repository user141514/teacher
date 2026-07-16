(function () {
  'use strict';

  if (typeof window.markdownit !== 'function') {
    throw new Error('Markdown renderer failed to load');
  }

  const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);
  const allowedTags = new Set([
    'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'HR', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG',
    'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL',
  ]);
  const allowedAttributes = {
    A: new Set(['href', 'referrerpolicy', 'rel', 'target', 'title']),
    CODE: new Set(['class']),
    OL: new Set(['start']),
    SPAN: new Set(['aria-label', 'class', 'role']),
  };

  function isSafeLink(url) {
    const normalized = String(url || '').trim();
    if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return false;
    const protocol = normalized.match(/^([a-z][a-z\d+.-]*):/i);
    return Boolean(protocol && allowedProtocols.has(`${protocol[1].toLowerCase()}:`));
  }

  const parser = window.markdownit({
    breaks: true,
    html: false,
    linkify: true,
    typographer: false,
  });
  parser.validateLink = isSafeLink;

  parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer nofollow');
    tokens[index].attrSet('referrerpolicy', 'no-referrer');
    return renderer.renderToken(tokens, index, options);
  };

  // Model-authored images must not trigger hidden cross-origin requests.
  parser.renderer.rules.image = (tokens, index) => {
    const alt = parser.utils.escapeHtml(tokens[index].content || '图片');
    return `<span class="markdown-image" role="img" aria-label="${alt}">图片：${alt}</span>`;
  };

  function sanitizeRenderedContent(root) {
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (!root.contains(element)) continue;

      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }

      const attributes = allowedAttributes[element.tagName] || new Set();
      for (const attribute of Array.from(element.attributes)) {
        if (!attributes.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      }

      if (element.tagName === 'A' && !isSafeLink(element.getAttribute('href'))) {
        element.replaceWith(document.createTextNode(element.textContent || ''));
      }
      if (element.tagName === 'CODE' && element.hasAttribute('class') &&
          !/^language-[\w-]+$/.test(element.getAttribute('class'))) {
        element.removeAttribute('class');
      }
      if (element.tagName === 'OL' && element.hasAttribute('start') &&
          !/^\d+$/.test(element.getAttribute('start'))) {
        element.removeAttribute('start');
      }
      if (element.tagName === 'SPAN' && !element.classList.contains('markdown-image')) {
        element.removeAttribute('class');
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
      }
    }
  }

  function renderMarkdown(target, source, options = {}) {
    const root = target;
    if (!(root instanceof Element)) {
      throw new TypeError('renderMarkdown target must be a DOM element');
    }

    const markdown = source == null ? '' : String(source);
    root.classList.add('markdown-body');
    root.classList.toggle('markdown-inline', options.inline === true);
    const template = document.createElement('template');
    template.innerHTML = options.inline === true
      ? parser.renderInline(markdown)
      : parser.render(markdown);
    sanitizeRenderedContent(template.content);
    root.replaceChildren(template.content);
    return root;
  }

  Object.defineProperty(window, 'renderMarkdown', {
    configurable: false,
    value: renderMarkdown,
    writable: false,
  });
}());
