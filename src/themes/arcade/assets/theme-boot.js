/* Arcade theme — palette boot.

   Loaded blocking in <head>, ahead of the first paint, so the chosen palette
   is already on the document when the page is drawn and there is no flash of
   the wrong one. It does exactly one thing.

   The attribute is always written, even when the choice came from the system,
   so the stylesheet and the toggle glyph only ever read one source of truth. */
(function () {
  'use strict';

  var stored = null;
  try {
    stored = window.localStorage.getItem('ar-theme');
  } catch (error) {
    /* private mode or blocked storage — fall through to the system preference */
  }

  var theme = stored === 'dark' || stored === 'light' ? stored : null;

  if (!theme) {
    // Night is this theme's native mode, so it is the default unless the
    // system explicitly asks for light.
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  document.documentElement.setAttribute('data-ar-theme', theme);
})();
