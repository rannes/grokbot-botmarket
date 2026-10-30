import { describe, expect, it, vi } from 'vitest';
import { fetchTemplateMetadata } from '../src/core/xai-metadata.js';

const ID = 'i03IaF768-ielyzegoGye';
const API_URL = 'https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate';
const PAGE_URL = `https://x.ai/bot/${ID}`;

const API_JSON = `{"template":{"shareId":"i03IaF768-ielyzegoGye","name":"Outbound Prospecting","avatarShape":"pebble","avatarColor":"magenta","createdAtMs":"1788284656667","updatedAtMs":"1788418871949","blobObjectKey":"templates/157-437","published":true,"activeVersion":10,"description":"Finds prospects that match your ideal customer, then drafts a first message to each one. Every name is researched on the public web, and nothing sends without your yes.","ownerType":"GROK_BOT_TEMPLATE_OWNER_TYPE_USER"}}`;

const PAGE_HTML = `<html><head><meta property="og:title" content="Outbound Prospecting"/><meta property="og:description" content="Finds prospects that match your ideal customer, then drafts a first message to each one. Every name is researched on the public web, and nothing sends..."/><meta property="og:image" content="https://x.ai/bot/i03IaF768-ielyzegoGye/opengraph-image-bntnog?e81aaf2c58b21051"/></head></html>`;

function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('fetchTemplateMetadata', () => {
  it('maps API fields on success', async () => {
    const f = makeFetch(async (url, init) => {
      expect(url).toBe(API_URL);
      expect(init?.method).toBe('POST');
      const h = new Headers(init?.headers);
      expect(h.get('content-type')).toBe('application/json');
      expect(h.get('connect-protocol-version')).toBe('1');
      expect(init?.body).toBe(JSON.stringify({ shareId: ID }));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(API_JSON, { status: 200 });
    });
    const meta = await fetchTemplateMetadata(ID, f);
    expect(meta).toEqual({
      id: ID,
      name: 'Outbound Prospecting',
      description:
        'Finds prospects that match your ideal customer, then drafts a first message to each one. Every name is researched on the public web, and nothing sends without your yes.',
      avatarShape: 'pebble',
      avatarColor: 'magenta',
      imageUrl: null,
      published: true,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('falls back to og tags when the API returns 500', async () => {
    const f = makeFetch(async (url, init) => {
      if (url === API_URL) return new Response('boom', { status: 500 });
      expect(url).toBe(PAGE_URL);
      expect(init?.method ?? 'GET').toBe('GET');
      expect(new Headers(init?.headers).get('accept')).toBe('text/html');
      return new Response(PAGE_HTML, { status: 200 });
    });
    const meta = await fetchTemplateMetadata(ID, f);
    expect(meta).toEqual({
      id: ID,
      name: 'Outbound Prospecting',
      description:
        'Finds prospects that match your ideal customer, then drafts a first message to each one. Every name is researched on the public web, and nothing sends...',
      avatarShape: null,
      avatarColor: null,
      imageUrl: 'https://x.ai/bot/i03IaF768-ielyzegoGye/opengraph-image-bntnog?e81aaf2c58b21051',
      published: true,
    });
  });

  it('tolerates attribute order, single quotes and decodes entities', async () => {
    const html = `<meta content='Tom &amp; Jerry &quot;Bot&quot; &#39;s &lt;x&gt;' property='og:title'>`;
    const f = makeFetch(async (url) =>
      url === API_URL ? new Response('nope', { status: 404 }) : new Response(html, { status: 200 }),
    );
    const meta = await fetchTemplateMetadata(ID, f);
    expect(meta?.name).toBe(`Tom & Jerry "Bot" 's <x>`);
    expect(meta?.description).toBe('');
    expect(meta?.imageUrl).toBeNull();
  });

  it('returns null on non-2xx or invalid JSON', async () => {
    const f = makeFetch(async (url) =>
      url === API_URL ? new Response('not json', { status: 200 }) : new Response('missing', { status: 404 }),
    );
    expect(await fetchTemplateMetadata(ID, f)).toBeNull();
  });

  it('returns null when fetch rejects on both paths', async () => {
    const f = makeFetch(async () => {
      throw new Error('network down');
    });
    expect(await fetchTemplateMetadata(ID, f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('parses unquoted attribute values', async () => {
    const f = makeFetch(async (url) =>
      url === API_URL
        ? new Response('x', { status: 500 })
        : new Response('<meta property=og:title content=Foo>', { status: 200 }),
    );
    expect((await fetchTemplateMetadata(ID, f))?.name).toBe('Foo');
  });

  it('ignores og:title beyond the 512 KB cap', async () => {
    const pad = 'a'.repeat(524288 + 10);
    const html = `<p>${pad}</p><meta property="og:title" content="Late"/>`;
    const f = makeFetch(async (url) =>
      url === API_URL ? new Response('x', { status: 500 }) : new Response(html, { status: 200 }),
    );
    expect(await fetchTemplateMetadata(ID, f)).toBeNull();
  });

  it('parses og:title located before the cap in a large body', async () => {
    const html = `<meta property="og:title" content="Early"/><p>${'a'.repeat(600000)}</p>`;
    const f = makeFetch(async (url) =>
      url === API_URL ? new Response('x', { status: 500 }) : new Response(html, { status: 200 }),
    );
    expect((await fetchTemplateMetadata(ID, f))?.name).toBe('Early');
  });

  it('does not double-decode entities', async () => {
    const f = makeFetch(async (url) =>
      url === API_URL
        ? new Response('x', { status: 500 })
        : new Response('<meta property="og:title" content="a &amp;lt; b">', { status: 200 }),
    );
    expect((await fetchTemplateMetadata(ID, f))?.name).toBe('a &lt; b');
  });

  it('returns null when page has no og:title', async () => {
    const f = makeFetch(async (url) =>
      url === API_URL ? new Response('x', { status: 500 }) : new Response('<html></html>', { status: 200 }),
    );
    expect(await fetchTemplateMetadata(ID, f)).toBeNull();
  });

  it('falls through to the page when API 200 lacks template', async () => {
    const f = makeFetch(async (url) =>
      url === API_URL ? new Response('{}', { status: 200 }) : new Response(PAGE_HTML, { status: 200 }),
    );
    expect((await fetchTemplateMetadata(ID, f))?.name).toBe('Outbound Prospecting');
  });

  it('throws TypeError for an invalid id without calling fetch', async () => {
    const f = makeFetch(async () => new Response('', { status: 200 }));
    await expect(fetchTemplateMetadata('../evil', f)).rejects.toBeInstanceOf(TypeError);
    expect(f).not.toHaveBeenCalled();
  });
});
