/* Grid theme — mobile navigation, scroll reveals, active section tracking.
   Progressive enhancement: with JavaScript off, or if anything below throws,
   the page stays fully readable and every element is visible. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- mobile navigation --------------------------------------------------
  var toggle = document.querySelector('.gd-nav-toggle');
  var nav = document.getElementById('gd-nav');

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

  var revealables = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));

  function revealAll() {
    revealables.forEach(function (element) {
      element.classList.add('is-in');
    });
    revealables = [];
  }

  try {
    // The hidden state only applies behind .gd-js, so it is added only once we
    // know this script is running and able to take it back off again.
    if (revealables.length && !reduced.matches) root.classList.add('gd-js');

    // A plain rect check rather than IntersectionObserver: the first pass runs
    // synchronously, so content can never be stranded at opacity 0.
    var ticking = false;

    function pass() {
      ticking = false;
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
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
      }
    }

    function schedule() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(pass);
    }

    if (reduced.matches) {
      revealAll();
    } else if (revealables.length) {
      pass();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      window.addEventListener('load', pass);

      if (typeof reduced.addEventListener === 'function') {
        reduced.addEventListener('change', function (event) {
          if (event.matches) revealAll();
        });
      }
    }
  } catch (error) {
    revealAll();
    root.classList.remove('gd-js');
  }

  // --- hero typing reveal (homepage only) ---------------------------------
  try {
    var heading = document.querySelector('.gd-home .gd-display');

    if (heading && !reduced.matches) {
      var caret = heading.querySelector('.gd-display-caret');
      var lines = heading.querySelectorAll('.gd-display-line');
      var index = 0;

      // Count first so the pace can be scaled to the length of the name.
      var total = 0;
      lines.forEach(function (line) {
        line.childNodes.forEach(function (node) {
          if (node.nodeType === 3) total += node.nodeValue.length;
        });
      });

      if (total > 0 && total <= 80) {
        // Long names type faster so the whole reveal stays under ~0.9s.
        var step = Math.max(12, Math.min(30, Math.round(700 / total)));
        heading.style.setProperty('--gd-char-step', step + 'ms');

        lines.forEach(function (line) {
          // Snapshot first: the list is live while nodes are replaced.
          Array.prototype.slice.call(line.childNodes).forEach(function (node) {
            if (node.nodeType !== 3) return;

            var fragment = document.createDocumentFragment();
            node.nodeValue.split('').forEach(function (character) {
              // Inline spans, opacity only — the line keeps its exact shaping.
              var span = document.createElement('span');
              span.className = 'gd-char';
              span.textContent = character;
              span.style.setProperty('--gd-char-i', index);
              index += 1;
              fragment.appendChild(span);
            });
            line.replaceChild(fragment, node);
          });
        });

        heading.classList.add('gd-typing');
        if (caret) caret.classList.add('is-blinking');

        // Once the reveal is over, drop the class entirely. That settles the
        // caret and, more importantly, removes the `opacity: 0` starting state
        // — so the name is guaranteed visible even if the animation never ran.
        window.setTimeout(function () {
          heading.classList.remove('gd-typing');
          if (caret) caret.classList.remove('is-blinking');
        }, index * step + 500);
      }
    }
  } catch (error) {
    // Any failure leaves the heading exactly as the server rendered it.
    var fallback = document.querySelector('.gd-display');
    if (fallback) fallback.classList.remove('gd-typing');
  }

  // --- pointer nudge on buttons -------------------------------------------
  try {
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    if (finePointer.matches && !reduced.matches) {
      var magnetTarget = null;
      var magnetX = 0;
      var magnetY = 0;
      var magnetQueued = false;

      var applyMagnet = function () {
        magnetQueued = false;
        if (magnetTarget) magnetTarget.style.transform = 'translate(' + magnetX + 'px, ' + magnetY + 'px)';
      };

      var releaseMagnet = function () {
        if (!magnetTarget) return;
        magnetTarget.style.transform = '';
        magnetTarget = null;
      };

      document.addEventListener(
        'pointermove',
        function (event) {
          if (event.pointerType !== 'mouse') return;
          var button = event.target.closest ? event.target.closest('.gd-btn') : null;

          if (!button) {
            releaseMagnet();
            return;
          }
          if (button !== magnetTarget) releaseMagnet();
          magnetTarget = button;

          // At most a 3px lean toward the cursor — a nudge, not movement.
          var rect = button.getBoundingClientRect();
          var limit = 3;
          magnetX = Math.max(-limit, Math.min(limit, ((event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)) * limit));
          magnetY = Math.max(-limit, Math.min(limit, ((event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)) * limit));

          if (!magnetQueued) {
            magnetQueued = true;
            window.requestAnimationFrame(applyMagnet);
          }
        },
        { passive: true }
      );

      // Never leave a button offset behind.
      document.addEventListener('pointerleave', releaseMagnet, { passive: true });
      document.addEventListener('pointercancel', releaseMagnet, { passive: true });
      window.addEventListener('blur', releaseMagnet);
      window.addEventListener('scroll', releaseMagnet, { passive: true });
    }
  } catch (error) {
    /* the nudge is optional */
  }

  // --- highlight the section currently in view ----------------------------
  try {
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('[data-nav-section]'));
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
})();
