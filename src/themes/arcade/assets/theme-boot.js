/* Arcade theme — palette boot.

   Loaded blocking in <head>, ahead of the first paint, so the chosen palette is
   already on the document when the page is drawn and there is no flash of the
   wrong one. It does exactly one thing; everything else waits for theme.js.

   The attribute is always written, even when the choice came from the system,
   so the rest of the stylesheet and the toggle icon only ever have to read one
   source of truth. */
(function () {
  'use strict';

  var stored = null;
  try {
    stored = window.localStorage.getItem('ar-theme');
  } catch (error) {
    /* private mode, blocked storage — fall through to the system preference */
  }

  var theme = stored === 'dark' || stored === 'light' ? stored : null;

  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  document.documentElement.setAttribute('data-ar-theme', theme);
})();
