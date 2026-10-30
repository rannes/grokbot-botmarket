// Copy-to-clipboard for [data-copy] buttons. No other behavior; pages work without JS.
(() => {
  const RESET_MS = 1600;
  const timers = new WeakMap();

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'sr-only';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
    if (!target) return;
    event.preventDefault();
    const label = target.dataset.label ?? target.textContent;
    target.dataset.label = label;
    const ok = await copy(target.getAttribute('data-copy') ?? '');
    target.textContent = ok ? 'Copied' : 'Copy failed';
    target.classList.toggle('is-copied', ok);
    clearTimeout(timers.get(target));
    timers.set(
      target,
      setTimeout(() => {
        target.textContent = label;
        target.classList.remove('is-copied');
      }, RESET_MS),
    );
  });
})();
