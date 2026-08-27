/* Orbit theme — mobile nav, scroll reveals, section tracking, a header that
   stays out of the way over the map, the hero typing reveal, randomised
   orbital phases and the camera controls for the orbital map.

   Progressive enhancement throughout: with JavaScript off the header is solid,
   every reveal target is visible, the heading is plain text, and the orbital
   map is an ordinary list of links that still animates on its own via CSS. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  // Below this the map is a flat list, so none of the 3D applies.
  var wide = window.matchMedia('(min-width: 48.0625rem)');

  function slice(list) {
    return Array.prototype.slice.call(list);
  }

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  // --- mobile navigation --------------------------------------------------
  var toggle = document.querySelector('.ob-nav-toggle');
  var nav = document.getElementById('ob-nav');

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

  // --- scroll reveals -----------------------------------------------------
  var revealables = slice(document.querySelectorAll('[data-reveal]'));

  function revealAll() {
    revealables.forEach(function (element) {
      element.classList.add('is-in');
    });
    revealables = [];
  }

  try {
    if (revealables.length && !reduced.matches) root.classList.add('ob-js');

    var revealTicking = false;

    function revealPass() {
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
    }

    function scheduleReveal() {
      if (revealTicking) return;
      revealTicking = true;
      window.requestAnimationFrame(revealPass);
    }

    if (reduced.matches) {
      revealAll();
    } else if (revealables.length) {
      // Runs synchronously, so content can never be stranded at opacity 0.
      revealPass();
      window.addEventListener('scroll', scheduleReveal, { passive: true });
      window.addEventListener('resize', scheduleReveal);
      window.addEventListener('load', revealPass);

      // The map fills the viewport, so on this theme every reveal target starts
      // below the fold. If scrolling or animation frames were ever not running,
      // that would hide the whole portfolio — so show everything regardless
      // after a delay far longer than any real visitor needs.
      window.setTimeout(revealAll, 10000);

      if (typeof reduced.addEventListener === 'function') {
        reduced.addEventListener('change', function (event) {
          if (event.matches) revealAll();
        });
      }
    }
  } catch (error) {
    revealAll();
    root.classList.remove('ob-js');
  }

  // --- hero typing reveal (the launch heading, so homepage only) -----------
  try {
    var heading = document.querySelector('.ob-launch-title');

    if (heading && !reduced.matches) {
      var caret = heading.querySelector('.ob-launch-caret');
      var lines = slice(heading.querySelectorAll('.ob-launch-line'));
      var charIndex = 0;

      // Count first so the pace can be scaled to the length of the name.
      var total = 0;
      lines.forEach(function (line) {
        slice(line.childNodes).forEach(function (node) {
          if (node.nodeType === 3) total += node.nodeValue.length;
        });
      });

      if (total > 0 && total <= 80) {
        // Unhurried, but still an introduction rather than a performance: the
        // average key lands around 55ms, and the whole name is in under a
        // second and a half even for a long one.
        var pace = Math.max(34, Math.min(58, Math.round(1150 / total)));

        // Nobody types on a metronome. Each key gets its own interval drawn
        // around the average, the first letter of a word takes a beat longer
        // the way reaching for a new word does, and now and then there is a
        // longer hesitation. The spread is deliberately narrow — enough to
        // read as a hand rather than a clock, not enough to look ragged.
        var elapsed = 0;

        lines.forEach(function (line, lineIndex) {
          // Snapshot first: the list is live while nodes are replaced.
          slice(line.childNodes).forEach(function (node) {
            if (node.nodeType !== 3) return;

            var fragment = document.createDocumentFragment();
            node.nodeValue.split('').forEach(function (character, position) {
              // Reaching for a new word costs a beat before its first key lands.
              if (position === 0 && lineIndex > 0) elapsed += pace * 0.9;

              // Inline spans, opacity only — the line keeps its exact shaping.
              var span = document.createElement('span');
              span.className = 'ob-char';
              span.textContent = character;
              span.style.setProperty('--ob-char-delay', Math.round(elapsed) + 'ms');
              charIndex += 1;
              fragment.appendChild(span);

              var gap = pace * (0.72 + Math.random() * 0.56);
              // And now and then a hand simply hesitates.
              if (Math.random() < 0.13) gap += pace * 0.7;
              elapsed += gap;
            });
            line.replaceChild(fragment, node);
          });
        });

        heading.classList.add('ob-typing');
        if (caret) caret.classList.add('is-blinking');

        // Once the reveal is over, drop the class entirely. That settles the
        // caret and, more importantly, removes the `opacity: 0` starting state
        // — so the name is guaranteed visible even if the animation never ran.
        window.setTimeout(function () {
          heading.classList.remove('ob-typing');
          if (caret) caret.classList.remove('is-blinking');
        }, elapsed + 600);
      }
    }
  } catch (error) {
    // Any failure leaves the heading exactly as the server rendered it.
    var headingFallback = document.querySelector('.ob-launch-title');
    if (headingFallback) headingFallback.classList.remove('ob-typing');
  }

  // --- light / dark ---------------------------------------------------------
  // theme-boot.js has already put the resolved palette on the document before
  // the first paint; this only has to switch it and remember the choice. Both
  // copies of the button — the header's and the landing's — drive the same
  // state, and both are only revealed once we are here, so a visitor without
  // script never sees a control that cannot do anything.
  try {
    var themeButtons = slice(document.querySelectorAll('[data-theme-toggle]'));

    if (themeButtons.length) {
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

      var readTheme = function () {
        var attr = root.getAttribute('data-ob-theme');
        if (attr === 'dark' || attr === 'light') return attr;
        return systemDark.matches ? 'dark' : 'light';
      };

      var applyTheme = function (theme) {
        root.setAttribute('data-ob-theme', theme);
        themeButtons.forEach(function (button) {
          button.setAttribute(
            'aria-label',
            theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
          );
          button.setAttribute('aria-pressed', String(theme === 'dark'));
        });
      };

      applyTheme(readTheme());
      root.classList.add('ob-theme-ready');

      themeButtons.forEach(function (button) {
        button.addEventListener('click', function () {
          var next = readTheme() === 'dark' ? 'light' : 'dark';
          applyTheme(next);
          try {
            window.localStorage.setItem('ob-theme', next);
          } catch (storageError) {
            // Blocked storage: the choice still holds for this page.
          }
        });
      });

      // Follow the system only while the visitor has not chosen for themselves.
      if (typeof systemDark.addEventListener === 'function') {
        systemDark.addEventListener('change', function (event) {
          var chosen = null;
          try {
            chosen = window.localStorage.getItem('ob-theme');
          } catch (storageError) {
            /* nothing stored that we can read */
          }
          if (chosen !== 'dark' && chosen !== 'light') {
            applyTheme(event.matches ? 'dark' : 'light');
          }
        });
      }
    }
  } catch (error) {
    /* the palette stays exactly as theme-boot.js left it */
  }

  // --- header: hidden over the map, solid once past it --------------------
  try {
    var header = document.getElementById('ob-header');
    var launch = document.querySelector('.ob-launch');

    if (header && launch) {
      var headerTicking = false;

      var syncHeader = function () {
        headerTicking = false;
        // Reveal the header a little before the map scrolls away.
        var threshold = launch.offsetTop + launch.offsetHeight - header.offsetHeight * 2;
        var over = window.scrollY < threshold;
        header.classList.toggle('is-over-map', over);
        // The landing's copy of the theme toggle takes over while the header
        // is hidden, so the same control is always reachable in the same place.
        document.body.classList.toggle('is-over-map', over);
      };

      var scheduleHeader = function () {
        if (headerTicking) return;
        headerTicking = true;
        window.requestAnimationFrame(syncHeader);
      };

      syncHeader();
      window.addEventListener('scroll', scheduleHeader, { passive: true });
      window.addEventListener('resize', scheduleHeader);
    }
  } catch (error) {
    /* the header simply stays visible */
  }

  // --- highlight the section currently in view ----------------------------
  try {
    var navLinks = slice(document.querySelectorAll('[data-nav-section]'));
    var sections = navLinks
      .map(function (link) {
        return document.getElementById(link.getAttribute('data-nav-section'));
      })
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

  // --- where each planet starts on its orbit ------------------------------
  // Re-rolled on every entry, so no two visits open on the same arrangement.
  // Only the angle changes: the ring, the period and the destination are all
  // fixed in the stylesheet, so navigation stays exactly where it was.
  try {
    var arms = slice(document.querySelectorAll('.ob-arm'));

    if (arms.length) {
      // One planet per equal sector, jittered inside it, then shuffled onto the
      // orbits — random, but never with everything bunched on one side.
      var count = arms.length;
      var phases = arms.map(function (unused, index) {
        return (index + Math.random()) / count;
      });
      for (var p = phases.length - 1; p > 0; p -= 1) {
        var q = Math.floor(Math.random() * (p + 1));
        var swap = phases[p];
        phases[p] = phases[q];
        phases[q] = swap;
      }

      var applyPhases = function () {
        arms.forEach(function (arm, index) {
          var billboard = arm.querySelector('.ob-billboard');

          if (reduced.matches) {
            // Nothing moves, so the angle is placed directly. Below the
            // breakpoint the map is a flat list and must keep its own layout.
            if (!wide.matches) {
              arm.style.transform = '';
              if (billboard) billboard.style.transform = '';
              return;
            }
            var degrees = phases[index] * 360;
            arm.style.transform = 'rotateZ(' + degrees.toFixed(2) + 'deg)';
            // The billboard cancels the arm angle, so labels stay upright.
            if (billboard) {
              billboard.style.transform = 'rotateZ(' + (-degrees).toFixed(2) + 'deg) rotateX(-62deg)';
            }
            return;
          }

          var duration = parseFloat(window.getComputedStyle(arm).animationDuration);
          if (!duration) return;
          // A negative delay starts the orbit already part-way round.
          var delay = (-phases[index] * duration).toFixed(2) + 's';
          arm.style.animationDelay = delay;
          if (billboard) billboard.style.animationDelay = delay;
        });
      };

      applyPhases();
      if (typeof wide.addEventListener === 'function') wide.addEventListener('change', applyPhases);
      if (typeof reduced.addEventListener === 'function') reduced.addEventListener('change', applyPhases);
    }
  } catch (error) {
    /* the stylesheet's own starting phases stand */
  }

  // --- camera controls: wheel to zoom, drag to orbit ----------------------
  // The scene keeps its orientation in three custom properties. Everything in
  // the map — camera, rings, sun, planets and labels — is written against
  // them, so the orbital animation keeps running untouched underneath.
  try {
    var scene = document.querySelector('[data-scene]');

    if (scene && finePointer.matches) {
      // Must match --ob-tilt in the stylesheet.
      var REST_TILT = 62;
      var MIN_TILT = 26;
      var MAX_TILT = 78;
      // Must match --ob-zoom in the stylesheet. The closest zoom is capped so
      // the outermost planet stays inside the viewport even at the limit.
      var REST_ZOOM = 360;
      var MIN_ZOOM = -160;
      // The closest zoom is worked out from the geometry rather than pinned to
      // a constant — see measureMaxZoom below. This is only the fallback for
      // when the scene cannot be measured, and the ceiling it may not exceed.
      var MAX_ZOOM = 380;
      var ZOOM_CEILING = 900;
      // The ceiling is solved from the geometry alone. On a small window it can
      // land below the resting zoom, and the landing follows it down rather
      // than opening on a view the map cannot actually hold.
      var ZOOM_FLOOR = 0;
      // How much room to leave between the outermost planet and the viewport
      // edge at the closest zoom, so it stays comfortably inside rather than
      // grazing it.
      var EDGE_MARGIN = 28;
      var MAX_FLING = 5;
      // Past this much travel the gesture is a drag, and the click that would
      // otherwise follow it is swallowed rather than navigating.
      var DRAG_SLOP = 6;

      var tilt = REST_TILT;
      var spin = 0;
      var zoom = REST_ZOOM;
      var spinVelocity = 0;
      var writePending = false;

      // --- how far in the map may be pushed ---------------------------------
      // The boundary is the outermost *planet*, not the decorative ring beyond
      // it — that one is meant to run past the frame and over the hero.
      //
      // Solved from the geometry rather than guessed at. With the plane pushed
      // z toward the viewer and tilted by t, a planet at in-plane radius a and
      // orbital angle T sits at
      //     x = a cos T                  z' = z + a sin T sin t
      //     y = a sin T cos t
      // and perspective draws it at x * P / (P - z'). Writing u = P - z, the
      // extremes over a whole orbit work out to
      //     max |x on screen| = P a / sqrt(u^2 - (a sin t)^2)
      //     max |y on screen| = P a cos t / (u - a sin t)
      // The first peaks on the near quarter of the orbit, not at its side — the
      // near side is closer to the viewer and magnified, which is what makes a
      // naive "radius times scale" estimate run the planet off the edge.
      // Each is inverted for the u it needs, over the range of tilts the camera
      // can be dragged to, and the tightest answer wins.
      // How far the outermost planet reaches on screen, given u = P - z. The
      // sideways peak is on the near quarter of the orbit rather than at its
      // side, because the near side is closer to the viewer and magnified; the
      // vertical peak is at the nearest point. Each adds the planet's own
      // radius, which is drawn face-on and so is never foreshortened.
      var reachOf = function (u, tiltDegrees, orbit, body, perspective) {
        var t = tiltDegrees * Math.PI / 180;
        var k = orbit * Math.sin(t);
        if (u <= k + 1) return Infinity;
        var flat = u * u - k * k;
        return {
          x: (perspective * orbit) / Math.sqrt(flat) + (body * perspective * u) / flat,
          y: (perspective * (orbit * Math.cos(t) + body)) / (u - k)
        };
      };

      // Sideways is held across the whole tilt range, because running off the
      // side of the window is the thing that must never happen. Height is held
      // at the resting tilt only: flattening the plane stretches the orbit
      // vertically at any zoom at all, so folding that case in would pin the
      // limit to the resting zoom and leave nothing to zoom into. Tilting is
      // deliberate exploration, and the map is meant to exceed its frame there.
      //
      // Both reaches shrink as u grows, so the smallest u that satisfies every
      // constraint is found by bisection — steadier than inverting the algebra,
      // and it stays correct if the geometry above it is ever retuned.
      var solveZoom = function (orbit, body, roomX, roomY, perspective) {
        var tilts = [MIN_TILT, 45, REST_TILT, MAX_TILT];

        var fits = function (u) {
          for (var i = 0; i < tilts.length; i += 1) {
            var r = reachOf(u, tilts[i], orbit, body, perspective);
            if (r === Infinity || r.x > roomX) return false;
          }
          var rest = reachOf(u, REST_TILT, orbit, body, perspective);
          return rest !== Infinity && rest.y <= roomY;
        };

        var low = perspective - ZOOM_CEILING;
        var high = perspective - ZOOM_FLOOR;
        if (fits(low)) return perspective - low;
        if (!fits(high)) return ZOOM_FLOOR;

        for (var step = 0; step < 40; step += 1) {
          var mid = (low + high) / 2;
          if (fits(mid)) high = mid;
          else low = mid;
        }
        return perspective - high;
      };

      var measureMaxZoom = function () {
        try {
          var perspective = parseFloat(window.getComputedStyle(scene).perspective);
          var arms = document.querySelectorAll('.ob-arm');
          var outer = arms.length ? arms[arms.length - 1].querySelector('.ob-anchor') : null;
          var planet = outer && outer.querySelector('.ob-planet');
          var launch = document.querySelector('.ob-launch');
          if (!perspective || !outer || !planet || !launch) return MAX_ZOOM;

          // Layout sizes, before any perspective magnification, so the reading
          // is not disturbed by the entrance animation or the current zoom.
          var matrix = new DOMMatrixReadOnly(window.getComputedStyle(outer).transform);
          // Magnitude, not just the x component: the anchor now carries a drift
          // rotation as well as its translation, so after a drag m41 alone reads
          // short by cos(drift) and the ceiling would come out too generous.
          var orbit = Math.hypot(matrix.m41, matrix.m42);
          var body = planet.offsetWidth / 2;
          if (!orbit) return MAX_ZOOM;

          var box = scene.getBoundingClientRect();
          var frame = launch.getBoundingClientRect();
          // Everything is drawn out from the perspective origin, so that — not
          // the middle of the scene box — is what the room is measured from.
          var origin = window.getComputedStyle(scene).perspectiveOrigin.split(' ');
          var originX = box.left + (parseFloat(origin[0]) || box.width / 2);
          var originY = box.top + (parseFloat(origin[1]) || box.height / 2);

          var roomX = Math.min(window.innerWidth - originX, originX) - EDGE_MARGIN;
          var roomY = Math.min(originY - frame.top, frame.bottom - originY) - EDGE_MARGIN;
          if (roomX <= 0 || roomY <= 0) return ZOOM_FLOOR;

          return clamp(solveZoom(orbit, body, roomX, roomY, perspective), ZOOM_FLOOR, ZOOM_CEILING);
        } catch (measureError) {
          return MAX_ZOOM;
        }
      };

      var write = function () {
        writePending = false;
        scene.style.setProperty('--ob-tilt-live', tilt.toFixed(2) + 'deg');
        scene.style.setProperty('--ob-spin', spin.toFixed(2) + 'deg');
        scene.style.setProperty('--ob-zoom', zoom.toFixed(1) + 'px');
      };

      var schedule = function () {
        if (writePending) return;
        writePending = true;
        window.requestAnimationFrame(write);
      };

      var releaseCamera = function () {
        tilt = REST_TILT;
        spin = 0;
        zoom = Math.min(REST_ZOOM, MAX_ZOOM);
        spinVelocity = 0;
        scene.style.removeProperty('--ob-tilt-live');
        scene.style.removeProperty('--ob-spin');
        // Only hand the zoom back to the stylesheet if that is where rest is.
        if (zoom === REST_ZOOM) scene.style.removeProperty('--ob-zoom');
        else scene.style.setProperty('--ob-zoom', zoom.toFixed(1) + 'px');
        scene.classList.remove('is-grabbing');
      };

      MAX_ZOOM = measureMaxZoom();
      if (zoom > MAX_ZOOM) {
        zoom = MAX_ZOOM;
        write();
      }

      var remeasureZoom = function () {
        MAX_ZOOM = measureMaxZoom();
        // A narrower window can lower the ceiling under where the visitor
        // already is; pull them back to it rather than leaving a clipped view.
        if (zoom > MAX_ZOOM) {
          zoom = MAX_ZOOM;
          schedule();
        }
      };

      window.addEventListener('resize', remeasureZoom);

      // --- inertia: the system coasts to a stop after a fling -------------
      var coasting = false;

      var coast = function () {
        if (coasting || dragging || reduced.matches) return;
        if (Math.abs(spinVelocity) < 0.05) {
          spinVelocity = 0;
          return;
        }
        coasting = true;

        var stepCoast = function () {
          if (dragging || !wide.matches) {
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

      // --- press and drag to orient ---------------------------------------
      var dragging = false;
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

        var swing = dx * 0.3;
        spin += swing;
        // Dragging down tips the plane toward edge-on, within safe limits.
        tilt = clamp(tilt + dy * 0.22, MIN_TILT, MAX_TILT);
        // Smoothed, so one stray sample cannot throw the fling.
        spinVelocity = clamp(spinVelocity * 0.6 + swing * (16 / dt) * 0.4, -MAX_FLING, MAX_FLING);
        schedule();
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
        // Primary button only, and never a second finger or pen.
        if (event.button !== 0 || event.pointerType !== 'mouse') return;
        if (!wide.matches) return;

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
        // No preventDefault here: the link still needs its focus and its click.
      });

      // A link is natively draggable, which would hijack the gesture.
      scene.addEventListener('dragstart', function (event) {
        event.preventDefault();
      });

      // Capture, so the swallowed click never reaches the anchor.
      scene.addEventListener('click', function (event) {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }, true);

      window.addEventListener('blur', endDrag);

      // Now that script is here, the stylesheet's blunt :focus-within pause is
      // switched off and replaced with one that only fires for keyboard focus —
      // where holding the map still is genuinely useful. A mouse press focuses
      // the planet it lands on, which is why the system used to stop dead after
      // a drag and only pick up again on the next click.
      scene.classList.add('is-managed');

      // Which input last moved focus. :focus-visible alone is not something we
      // can count on across browsers, and getting this wrong in the permissive
      // direction brings the original bug straight back.
      var byKeyboard = false;
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Tab' || String(event.key).indexOf('Arrow') === 0) byKeyboard = true;
      }, true);
      document.addEventListener('pointerdown', function () { byKeyboard = false; }, true);

      var syncHold = function () {
        var focused = document.activeElement;
        var inside = !!(focused && focused !== scene && scene.contains(focused));
        var visible = byKeyboard;
        if (inside && !visible && typeof focused.matches === 'function') {
          try {
            visible = focused.matches(':focus-visible');
          } catch (selectorError) {
            visible = false;
          }
        }
        scene.classList.toggle('is-holding', inside && visible);
      };

      scene.addEventListener('focusin', syncHold);
      scene.addEventListener('focusout', function () {
        // Runs after focus has actually moved.
        window.setTimeout(syncHold, 0);
      });

      // --- wheel zoom, toward the sun at the centre ------------------------
      // Bound to the window, but answered purely from where the pointer is at
      // the moment of the event. Listening on the scene instead went by DOM
      // ancestry, so a wheel over a label that had orbited well outside the
      // frame still counted as being over the map — and the page would refuse
      // to scroll until the cursor happened to land somewhere else. The frame
      // is the interaction area; anywhere outside it the event is left alone.
      var overMap = function (event) {
        var box = scene.getBoundingClientRect();
        if (!box.width || !box.height) return false;
        return event.clientX >= box.left && event.clientX <= box.right &&
               event.clientY >= box.top && event.clientY <= box.bottom;
      };

      window.addEventListener('wheel', function (event) {
        if (!wide.matches) return;
        if (!overMap(event)) return;

        var delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
        var next = clamp(zoom - delta * 0.9, MIN_ZOOM, MAX_ZOOM);
        // At either limit the wheel is handed back to the page, so a visitor
        // can always keep scrolling down to the portfolio itself.
        if (next === zoom) return;

        zoom = next;
        event.preventDefault();
        schedule();
      }, { passive: false });

      // --- getting back to the resting view --------------------------------
      scene.addEventListener('dblclick', function (event) {
        if (event.target.closest('[data-body], .ob-sun')) return;
        releaseCamera();
      });

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (nav && nav.classList.contains('is-open')) return;
        releaseCamera();
      });

      // Below the breakpoint the map is a plain list; drop any orientation.
      if (typeof wide.addEventListener === 'function') {
        wide.addEventListener('change', function (event) {
          if (!event.matches) releaseCamera();
        });
      }
    }
  } catch (error) {
    /* the map is perfectly usable at its resting orientation */
  }
})();
