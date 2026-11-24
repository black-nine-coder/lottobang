const lottoBrowser = {
  isPages: document.documentElement.dataset.hosting === "pages",

  random(seed) {
    let value = Number(seed) >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  },

  async copy(text, fallback) {
    try {
      await navigator.clipboard.writeText(text);
      fallback.hidden = true;
      return true;
    } catch {
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      return false;
    }
  },
};
