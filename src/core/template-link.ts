export const TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{21}$/;

const MAX_INPUT = 2048;
const MAX_PROMPT = 1000;

function assertId(id: string): void {
  if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) {
    throw new TypeError(`Invalid template id: ${String(id)}`);
  }
}

function validId(id: string | null): string | null {
  return id !== null && TEMPLATE_ID_RE.test(id) ? id : null;
}

export function parseTemplateRef(input: string): string | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT) return null;
  const s = input.trim();
  if (TEMPLATE_ID_RE.test(s)) return s;
  if (!URL.canParse(s)) return null;
  const u = new URL(s);
  if (u.username || u.password || u.port || u.hash) return null;
  // `new URL` drops an empty fragment marker; reject a literal trailing '#'.
  if (s.includes('#')) return null;

  if (u.protocol === 'grokbot:' || u.protocol === 'sand:') {
    if (u.hostname !== 'app' || u.pathname !== '/v1/bot-template') return null;
    return validId(u.searchParams.get('id'));
  }
  if (u.protocol !== 'https:') return null;

  if (u.hostname === 'cursor.com') {
    if (
      u.pathname === '/grok-bot/link/v1/bot-template' ||
      u.pathname === '/sand/link/v1/bot-template'
    ) {
      return validId(u.searchParams.get('id'));
    }
    return null;
  }
  if (u.hostname === 'x.ai' || u.hostname === 'www.x.ai') {
    const parts = u.pathname.replace(/\/$/, '').split('/');
    if (parts.length !== 3 || parts[0] !== '' || parts[1] !== 'bot') return null;
    return validId(parts[2] ?? null);
  }
  return null;
}

export function templateDeepLink(id: string): string {
  assertId(id);
  return `grokbot://app/v1/bot-template?id=${id}`;
}

export function templateUniversalLink(id: string): string {
  assertId(id);
  return `https://cursor.com/grok-bot/link/v1/bot-template?id=${id}`;
}

export function templatePageUrl(id: string): string {
  assertId(id);
  return `https://x.ai/bot/${id}`;
}

export function promptDeepLink(text: string): string {
  const t = text.trim();
  if (t.length === 0) throw new RangeError('Prompt text is empty');
  if (t.length > MAX_PROMPT) throw new RangeError(`Prompt text exceeds ${MAX_PROMPT} characters`);
  return `grokbot://app/v1/prompt?text=${encodeURIComponent(t)}`;
}
