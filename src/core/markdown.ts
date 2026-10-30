import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre', 'ul', 'ol', 'li', 'a',
      'h2', 'h3', 'h4', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del',
    ],
    allowedAttributes: { a: ['href', 'rel', 'target'], code: ['class'], th: ['align'], td: ['align'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener', target: '_blank' }),
    },
  });
}
