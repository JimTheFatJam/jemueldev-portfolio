/* Arcade theme — mobile nav, the light/dark switch, scroll reveals, section
   tracking, and the two-way link between the dock and the orrery.

   Deliberately small, and deliberately not in charge of the star chart. The
   revolutions are CSS animations on their own clock: nothing here starts,
   stops, pauses or re-times them, so they cannot be made to stutter by
   anything a visitor does. There is no wheel handler and no drag handler
   anywhere in this file — the page always scrolls normally.

   Progressive enhancement throughout: with JavaScript off the header is
   solid, every reveal target is visible, the palette is whatever the system
   asked for, and the dock and the worlds are ordinary links. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function slice(list) {
    return Array.prototype.slice.call(list);
  }

  // --- mobile navigation ---------------------------------------------------
  var toggle = document.querySelector('.ar-nav-toggle');
  var nav = document.getElementById('ar-nav');

  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // --- light / dark --------------------------------------------------------
  // theme-boot.js has already put the resolved palette on the document before
  // the first paint; this only switches it and remembers the choice. The
  // button is revealed only once we are here, so a visitor without script
  // never sees a control that cannot do anything.
  try {
    var themeButtons = slice(document.querySelectorAll('[data-theme-toggle]'));

    if (themeButtons.length) {
      var systemLight = window.matchMedia('(prefers-color-scheme: light)');

      var readTheme = function () {
        var attr = root.getAttribute('data-ar-theme');
        if (attr === 'dark' || attr === 'light') return attr;
        return systemLight.matches ? 'light' : 'dark';
      };

      var applyTheme = function (theme) {
        root.setAttribute('data-ar-theme', theme);
        themeButtons.forEach(function (button) {
          button.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
          button.setAttribute('aria-pressed', String(theme === 'light'));
        });
      };

      applyTheme(readTheme());
      root.classList.add('ar-theme-ready');

      themeButtons.forEach(function (button) {
        button.addEventListener('click', function () {
          var next = readTheme() === 'light' ? 'dark' : 'light';
          applyTheme(next);
          try {
            window.localStorage.setItem('ar-theme', next);
          } catch (storageError) {
            // Blocked storage: the choice still holds for this page.
          }
        });
      });

      // Follow the system only while the visitor has not chosen for themselves.
      if (typeof systemLight.addEventListener === 'function') {
        systemLight.addEventListener('change', function (event) {
          var chosen = null;
          try {
            chosen = window.localStorage.getItem('ar-theme');
          } catch (storageError) {
            /* nothing stored that we can read */
          }
          if (chosen !== 'dark' && chosen !== 'light') {
            applyTheme(event.matches ? 'light' : 'dark');
          }
        });
      }
    }
  } catch (error) {
    /* the palette stays exactly as theme-boot.js left it */
  }

  // --- scroll reveals ------------------------------------------------------
  var revealables = slice(document.querySelectorAll('[data-reveal]'));

  function revealAll() {
    revealables.forEach(function (element) {
      element.classList.add('is-in');
    });
    revealables = [];
  }

  try {
    if (revealables.length && !reduced.matches) root.classList.add('ar-js');

    var revealTicking = false;

    var revealPass = function () {
      revealTicking = false;
      if (!revealables.length) return;

      var limit = window.innerHeight * 0.92;
      var remaining = [];

      for (var i = 0; i < revealables.length; i += 1) {
        var element = revealables[i];
        var rect = element.getBoundingClientRect();
        if ((rect.top < limit && rect.bottom > 0) || rect.bottom <= 0) element.classList.add('is-in');
        else remaining.push(element);
      }

      revealables = remaining;
      if (!revealables.length) {
        window.removeEventListener('scroll', scheduleReveal);
        window.removeEventListener('resize', scheduleReveal);
      }
    };

    var scheduleReveal = function () {
      if (revealTicking) return;
      revealTicking = true;
      window.requestAnimationFrame(revealPass);
    };

    if (reduced.matches) {
      revealAll();
    } else if (revealables.length) {
      // Runs synchronously, so content can never be stranded at opacity 0.
      revealPass();
      window.addEventListener('scroll', scheduleReveal, { passive: true });
      window.addEventListener('resize', scheduleReveal);
      window.addEventListener('load', revealPass);

      // If scrolling or animation frames were ever not running, that would
      // hide content for good — so show everything regardless after a delay
      // far longer than any real visitor needs.
      window.setTimeout(revealAll, 10000);

      if (typeof reduced.addEventListener === 'function') {
        reduced.addEventListener('change', function (event) {
          if (event.matches) revealAll();
        });
      }
    }
  } catch (error) {
    revealAll();
    root.classList.remove('ar-js');
  }

  // --- the dock and the orrery point at each other -------------------------
  // The worlds carry no text, so this is how a visitor learns which world is
  // which: hovering or focusing either one lights up its partner. Class
  // toggles only — it never touches the animations that are moving the worlds
  // around, so the system keeps turning at exactly the same rate throughout.
  try {
    var pairs = {};
    slice(document.querySelectorAll('[data-world]')).forEach(function (node) {
      var key = node.getAttribute('data-world');
      (pairs[key] = pairs[key] || []).push(node);
    });

    Object.keys(pairs).forEach(function (key) {
      var group = pairs[key];
      if (group.length < 2) return;

      var light = function (on) {
        group.forEach(function (node) { node.classList.toggle('is-lit', on); });
      };

      group.forEach(function (node) {
        node.addEventListener('pointerenter', function () { light(true); });
        node.addEventListener('pointerleave', function () { light(false); });
        // Keyboard focus lands on the dock entry; light its world too.
        node.addEventListener('focus', function () { light(true); });
        node.addEventListener('blur', function () { light(false); });
      });
    });
  } catch (error) {
    /* the dock and the worlds still work on their own */
  }

  // --- highlight the section currently in view -----------------------------
  try {
    var navLinks = slice(document.querySelectorAll('[data-nav-section]'));
    var sections = navLinks
      .map(function (link) { return document.getElementById(link.getAttribute('data-nav-section')); })
      .filter(Boolean);

    if (sections.length) {
      var spyTicking = false;

      var spy = function () {
        spyTicking = false;
        var marker = window.innerHeight * 0.4;
        var current = '';

        sections.forEach(function (section) {
          if (section.getBoundingClientRect().top <= marker) current = section.id;
        });

        navLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('data-nav-section') === current);
        });
      };

      var scheduleSpy = function () {
        if (spyTicking) return;
        spyTicking = true;
        window.requestAnimationFrame(spy);
      };

      spy();
      window.addEventListener('scroll', scheduleSpy, { passive: true });
      window.addEventListener('resize', scheduleSpy);
    }
  } catch (error) {
    /* navigation highlighting is optional */
  }
})();
