const TEMPLATE_ID_RE = /^[A-Za-z0-9_-]{21}$/;
const API_URL = 'https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate';
const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 524288;

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  avatarShape: string | null;
  avatarColor: string | null;
  imageUrl: string | null;
  published: boolean;
}

async function fetchFromApi(id: string, fetchImpl: typeof fetch): Promise<TemplateMetadata | null> {
  try {
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
      body: JSON.stringify({ shareId: id }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { template?: Record<string, unknown> } | null;
    const t = data?.template;
    if (!t || typeof t.name !== 'string' || t.name === '') return null;
    return {
      id,
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      avatarShape: typeof t.avatarShape === 'string' ? t.avatarShape : null,
      avatarColor: typeof t.avatarColor === 'string' ? t.avatarColor : null,
      imageUrl: null,
      published: t.published === true,
    };
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function ogContent(html: string, prop: string): string | null {
  const tagRe = /<meta\b[^>]*>/gi;
  for (const m of html.matchAll(tagRe)) {
    const tag = m[0];
    const p = /\bproperty\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    if ((p?.[1] ?? p?.[2] ?? p?.[3]) !== prop) continue;
    const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    if (!c) continue;
    return decodeEntities(c[1] ?? c[2] ?? c[3] ?? '');
  }
  return null;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BODY_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const buf = new Uint8Array(Math.min(total, MAX_BODY_BYTES));
  let off = 0;
  for (const c of chunks) {
    if (off >= buf.length) break;
    const part = c.subarray(0, buf.length - off);
    buf.set(part, off);
    off += part.length;
  }
  return new TextDecoder().decode(buf);
}

async function fetchFromPage(id: string, fetchImpl: typeof fetch): Promise<TemplateMetadata | null> {
  try {
    const res = await fetchImpl(`https://x.ai/bot/${id}`, {
      method: 'GET',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await readCapped(res);
    const name = ogContent(html, 'og:title');
    if (!name) return null;
    return {
      id,
      name,
      description: ogContent(html, 'og:description') ?? '',
      avatarShape: null,
      avatarColor: null,
      imageUrl: ogContent(html, 'og:image') || null,
      published: true,
    };
  } catch {
    return null;
  }
}

export async function fetchTemplateMetadata(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TemplateMetadata | null> {
  if (!TEMPLATE_ID_RE.test(id)) throw new TypeError('Invalid template id');
  return (await fetchFromApi(id, fetchImpl)) ?? (await fetchFromPage(id, fetchImpl));
}
