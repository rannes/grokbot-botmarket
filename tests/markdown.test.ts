import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/core/markdown.js';

describe('renderMarkdown', () => {
  it('strips scripts and event handlers', () => {
    const out = renderMarkdown('hi <script>alert(1)</script> <b onclick="x()">b</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('onclick');
  });
  it('keeps links with rel and target', () => {
    const out = renderMarkdown('[a](https://example.com)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="nofollow noopener"');
    expect(out).toContain('target="_blank"');
  });
  it('drops javascript: hrefs', () => {
    const out = renderMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });
  it('downgrades h1 to h2', () => {
    const out = renderMarkdown('# Title');
    expect(out).toContain('<h2>Title</h2>');
    expect(out).not.toContain('<h1');
  });
  it('drops images', () => {
    expect(renderMarkdown('![x](https://e.com/a.png)')).not.toContain('<img');
  });
});
