import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_ID_RE,
  parseTemplateRef,
  templateDeepLink,
  templateUniversalLink,
  templatePageUrl,
  promptDeepLink,
} from '../src/core/template-link.js';

const ID = 'i03IaF768-ielyzegoGye';

describe('parseTemplateRef', () => {
  it.each([
    ['bare id', ID],
    ['page url', `https://x.ai/bot/${ID}`],
    ['www page url with trailing slash', `https://www.x.ai/bot/${ID}/`],
    ['trailing slash and query noise', `https://x.ai/bot/${ID}/?utm=1&a=b`],
    ['grokbot deep link', `grokbot://app/v1/bot-template?id=${ID}&open=1`],
    ['sand deep link', `sand://app/v1/bot-template?id=${ID}`],
    ['grok-bot universal', `https://cursor.com/grok-bot/link/v1/bot-template?id=${ID}`],
    ['sand universal', `https://cursor.com/sand/link/v1/bot-template?id=${ID}`],
    ['whitespace', `  ${ID}\n`],
  ])('accepts %s', (_n, input) => {
    expect(parseTemplateRef(input)).toBe(ID);
  });

  it.each([
    ['20-char id', 'i03IaF768-ielyzegoGy'],
    ['marketplace path', 'https://x.ai/bot/marketplace/bots/foo'],
    ['evil host', `https://evil.com/bot/${ID}`],
    ['userinfo', `https://user:pw@x.ai/bot/${ID}`],
    ['username only', `https://user@x.ai/bot/${ID}`],
    ['port', `https://x.ai:8443/bot/${ID}`],
    ['hash', `https://x.ai/bot/${ID}#frag`],
    ['too long', `https://x.ai/bot/${ID}?q=${'a'.repeat(2048)}`],
    ['extra segment', `https://x.ai/bot/${ID}/extra`],
    ['empty', ''],
    ['bad deep link host', `grokbot://other/v1/bot-template?id=${ID}`],
    ['bad id param', 'grokbot://app/v1/bot-template?id=short'],
  ])('rejects %s', (_n, input) => {
    expect(parseTemplateRef(input)).toBeNull();
  });
});

describe('builders', () => {
  it('builds exact strings', () => {
    expect(templateDeepLink(ID)).toBe(`grokbot://app/v1/bot-template?id=${ID}`);
    expect(templateUniversalLink(ID)).toBe(`https://cursor.com/grok-bot/link/v1/bot-template?id=${ID}`);
    expect(templatePageUrl(ID)).toBe(`https://x.ai/bot/${ID}`);
    expect(TEMPLATE_ID_RE.test(ID)).toBe(true);
  });

  it('throws TypeError on bad id', () => {
    expect(() => templateDeepLink('bad')).toThrow(TypeError);
    expect(() => templateUniversalLink('bad')).toThrow(TypeError);
    expect(() => templatePageUrl('bad')).toThrow(TypeError);
  });

  it('promptDeepLink', () => {
    expect(promptDeepLink('hi there')).toBe('grokbot://app/v1/prompt?text=hi%20there');
    expect(promptDeepLink('  hi  ')).toBe('grokbot://app/v1/prompt?text=hi');
    expect(() => promptDeepLink('a'.repeat(1001))).toThrow(RangeError);
    expect(() => promptDeepLink('  ')).toThrow(RangeError);
    expect(promptDeepLink('a'.repeat(1000))).toContain('text=');
  });
});
