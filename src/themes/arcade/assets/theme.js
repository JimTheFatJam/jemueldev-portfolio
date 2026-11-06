/* Arcade theme — mobile nav, the light/dark switch, scroll reveals, section
   tracking, and the two-way link between the dock and the orrery.

   The star chart has a camera — wheel to zoom, drag to orient — but the
   camera and the orbits are kept strictly apart. Orientation lives in custom
   properties on the frame; the revolutions are CSS animations on their own
   clock. Nothing here starts, stops, pauses or re-times them, so no amount of
   zooming or dragging can make the planets stutter.

   The wheel is only ever taken when the pointer is inside the frame AND the
   zoom would actually change. Outside it, or at either limit, the event is
   handed straight back and the page scrolls normally.

   Progressive enhancement throughout: with JavaScript off the header is
   solid, every reveal target is visible, the palette is whatever the system
   asked for, and the dock and the worlds are ordinary links. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

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

  // --- camera controls: wheel to zoom, drag to orient ----------------------
  // Adapted from the orbit theme, whose behaviour this is meant to restore.
  //
  // The camera lives entirely in custom properties on the frame. Nothing here
  // reads, writes, starts, stops or re-times .ar-arm or .ar-arm-fix, which
  // are the elements carrying the orbital animations — so however much a
  // visitor zooms, drags or flings the system, the planets keep revolving on
  // exactly the same clock they started on.
  try {
    var scene = document.querySelector('[data-scene]');

    if (scene && finePointer.matches) {
      // Must match the rest values in the stylesheet.
      var REST_ZOOM = 1;
      var MIN_ZOOM = 0.55;
      var MAX_ZOOM = 2.6;

      var REST_FLAT = 0.62;   // how open the orbital plane sits at rest
      var MIN_FLAT = 0.20;    // nearly edge-on
      var MAX_FLAT = 1;       // face-on; past this it would turn inside out

      var MAX_FLING = 4.5;
      // Past this much travel the gesture is a drag, and the click that would
      // otherwise follow it is swallowed rather than navigating.
      var DRAG_SLOP = 6;

      var zoom = REST_ZOOM;
      var spin = 0;
      var flat = REST_FLAT;
      var spinVelocity = 0;

      var readout = scene.querySelector('[data-zoom-readout]');

      var clampTo = function (value, low, high) {
        return value < low ? low : value > high ? high : value;
      };

      var write = function () {
        scene.style.setProperty('--ar-zoom', zoom.toFixed(3));
        scene.style.setProperty('--ar-spin', spin.toFixed(2) + 'deg');
        scene.style.setProperty('--ar-unspin', (-spin).toFixed(2) + 'deg');
        scene.style.setProperty('--ar-flat', flat.toFixed(3));
        // Undoing a squash means dividing by it, so the floor keeps this
        // finite however far the plane is tipped.
        scene.style.setProperty('--ar-unflat', (1 / Math.max(flat, 0.01)).toFixed(3));
        if (readout) readout.textContent = Math.round(zoom * 100) + '%';
      };

      var reset = function () {
        zoom = REST_ZOOM;
        spin = 0;
        flat = REST_FLAT;
        spinVelocity = 0;
        write();
      };

      // --- inertia: the system coasts to a stop after a fling --------------
      var dragging = false;
      var coasting = false;

      var coast = function () {
        if (coasting || dragging || reduced.matches) return;
        if (Math.abs(spinVelocity) < 0.05) {
          spinVelocity = 0;
          return;
        }
        coasting = true;

        var stepCoast = function () {
          if (dragging) {
            coasting = false;
            spinVelocity = 0;
            return;
          }
          spin += spinVelocity;
          spinVelocity *= 0.955;
          write();
          if (Math.abs(spinVelocity) < 0.02) {
            coasting = false;
            spinVelocity = 0;
            return;
          }
          window.requestAnimationFrame(stepCoast);
        };

        window.requestAnimationFrame(stepCoast);
      };

      // --- press and drag to orient ----------------------------------------
      var dragPointer = null;
      var travelled = 0;
      var suppressClick = false;
      var lastX = 0;
      var lastY = 0;
      var lastTime = 0;

      var onMove = function (event) {
        if (!dragging || event.pointerId !== dragPointer) return;

        var dx = event.clientX - lastX;
        var dy = event.clientY - lastY;
        var dt = Math.max(8, event.timeStamp - lastTime);
        lastX = event.clientX;
        lastY = event.clientY;
        lastTime = event.timeStamp;

        travelled += Math.abs(dx) + Math.abs(dy);
        // Only past the slop does this stop being a click on a planet.
        if (travelled > DRAG_SLOP) suppressClick = true;

        // Sideways swings the system around; dragging down opens the plane
        // toward face-on and dragging up tips it toward edge-on.
        var swing = dx * 0.32;
        spin += swing;
        flat = clampTo(flat + dy * 0.0035, MIN_FLAT, MAX_FLAT);
        // Smoothed, so one stray sample cannot throw the fling.
        spinVelocity = clampTo(spinVelocity * 0.6 + swing * (16 / dt) * 0.4, -MAX_FLING, MAX_FLING);
        write();
      };

      var endDrag = function () {
        // Unconditional teardown: the listeners come off and the flags reset
        // even if the state was already half-cleared, so a release that
        // arrives twice, or outside the window, still leaves nothing latched.
        dragging = false;
        dragPointer = null;
        scene.classList.remove('is-grabbing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        window.removeEventListener('mouseup', endDrag);
        coast();
      };

      scene.addEventListener('pointerdown', function (event) {
        // Primary button only, and never a finger or a pen: a touch here has
        // to stay available for scrolling the page and tapping a planet.
        if (event.button !== 0 || event.pointerType !== 'mouse') return;

        dragging = true;
        coasting = false;
        spinVelocity = 0;
        travelled = 0;
        suppressClick = false;
        dragPointer = event.pointerId;
        lastX = event.clientX;
        lastY = event.clientY;
        lastTime = event.timeStamp;
        scene.classList.add('is-grabbing');

        // Listening on the window rather than capturing the pointer keeps the
        // click's own target intact, so a press without travel still follows
        // whichever planet it landed on.
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        // Belt and braces: if a pointerup is ever lost — dragging out of the
        // window and releasing there is the usual way — the mouse event still
        // gets us out of the drag.
        window.addEventListener('mouseup', endDrag);
        // No preventDefault here: a planet still needs its focus and its click.
      });

      // A link is natively draggable, which would hijack the gesture.
      scene.addEventListener('dragstart', function (event) { event.preventDefault(); });

      // Capture, so a swallowed click never reaches the anchor.
      scene.addEventListener('click', function (event) {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }, true);

      // Put the view back where it started.
      scene.addEventListener('dblclick', function () { reset(); });

      window.addEventListener('blur', endDrag);

      // --- wheel zoom -------------------------------------------------------
      // Bound to the window, but answered purely from where the pointer is at
      // the moment of the event rather than from what it is over in the DOM.
      // The frame is the interaction area: anywhere outside it the event is
      // left completely alone, so the page scrolls exactly as it always does.
      var overMap = function (event) {
        var box = scene.getBoundingClientRect();
        if (!box.width || !box.height) return false;
        return event.clientX >= box.left && event.clientX <= box.right &&
               event.clientY >= box.top && event.clientY <= box.bottom;
      };

      window.addEventListener('wheel', function (event) {
        if (!overMap(event)) return;

        var delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
        var next = clampTo(zoom * Math.exp(-delta * 0.0012), MIN_ZOOM, MAX_ZOOM);
        // At either limit the wheel is handed straight back to the page, so a
        // visitor can always keep scrolling down to the portfolio itself and
        // never gets stuck over the map.
        if (Math.abs(next - zoom) < 0.0005) return;

        zoom = next;
        event.preventDefault();
        write();
      }, { passive: false });

      // Only now, with the controls actually attached, does the frame start
      // advertising them.
      scene.classList.add('is-live', 'is-draggable');
      write();
    }
  } catch (error) {
    /* the map keeps its resting view and every planet is still a link */
  }
})();
