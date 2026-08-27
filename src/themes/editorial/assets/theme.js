/* Editorial theme — mobile nav, scroll reveals, active section tracking.
   Everything here is progressive enhancement: with JavaScript off, or if
   anything below throws, the page stays fully readable and visible. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- mobile navigation --------------------------------------------------
  var toggle = document.querySelector('.ed-menu-toggle');
  var nav = document.getElementById('ed-nav');

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
    // The hidden state lives behind .ed-js, so it is only ever applied once we
    // know this script is running and is able to take it back off again.
    if (revealables.length && !reduced.matches) {
      root.classList.add('ed-js');
    }

    // --- scroll reveal ----------------------------------------------------
    // A plain rect check rather than IntersectionObserver: the first pass runs
    // synchronously, so content can never be left stranded at opacity 0.
    var ticking = false;

    function pass() {
      ticking = false;
      if (!revealables.length) return;

      var limit = window.innerHeight * 0.92;
      var remaining = [];

      for (var i = 0; i < revealables.length; i += 1) {
        var element = revealables[i];
        var rect = element.getBoundingClientRect();
        var onScreen = rect.top < limit && rect.bottom > 0;
        // A zero-height or fully scrolled-past element counts as seen.
        if (onScreen || rect.bottom <= 0) element.classList.add('is-in');
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
      // Late-loading images can move things into view.
      window.addEventListener('load', pass);

      if (typeof reduced.addEventListener === 'function') {
        reduced.addEventListener('change', function (event) {
          if (event.matches) revealAll();
        });
      }
    }
  } catch (error) {
    // Never let a failure here hide the page.
    revealAll();
    root.classList.remove('ed-js');
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
        var marker = window.innerHeight * 0.35;
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
