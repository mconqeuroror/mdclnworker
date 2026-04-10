/**
 * Copy text with Clipboard API + robust fallbacks (Safari / iOS / older browsers).
 */
export async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to legacy
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.setAttribute('tabindex', '-1');
    ta.style.position = 'fixed';
    ta.style.left = '0';
    ta.style.top = '0';
    // iOS often ignores 1×1px — use small but non-zero box; still visually hidden
    ta.style.width = '2rem';
    ta.style.height = '2rem';
    ta.style.padding = '0';
    ta.style.margin = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.opacity = '0';
    ta.style.zIndex = '-1';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    if (isIos) {
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, value.length);
    } else {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, value.length);
    }

    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    // fall through
  }

  return false;
}

/**
 * Focus a field and select the entire value so the user can Ctrl+C / “Copy” from the system menu.
 */
export function selectElementContents(el) {
  if (!el) return;
  try {
    el.focus();
    if (typeof el.select === 'function') {
      el.select();
    }
    const len = el.value?.length ?? 0;
    if (typeof el.setSelectionRange === 'function' && len) {
      el.setSelectionRange(0, len);
    }
  } catch {
    // ignore
  }
}
