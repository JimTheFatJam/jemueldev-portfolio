/* Admin interactions: sidebar, confirmations, slug helper, media picker.
   No framework, no polling — everything is event driven. */
(function () {
  'use strict';

  var csrfToken = (document.querySelector('input[name="_csrf"]') || {}).value || '';

  // --- sidebar ------------------------------------------------------------
  var navToggle = document.querySelector('.admin-nav-toggle');
  var sidebar = document.getElementById('admin-sidebar');
  if (navToggle && sidebar) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') !== 'true';
      navToggle.setAttribute('aria-expanded', String(open));
      sidebar.classList.toggle('is-open', open);
    });
  }

  // --- destructive actions ask first --------------------------------------
  document.addEventListener('submit', function (event) {
    var form = event.target.closest('form[data-confirm]');
    if (!form) return;
    if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
  });

  // Buttons that submit a form declared elsewhere (form="…") bypass the
  // listener above, because the submit event fires on the target form.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button[form]');
    if (!button) return;
    var form = document.getElementById(button.getAttribute('form'));
    if (!form || !form.hasAttribute('data-confirm')) return;
    if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
  });

  // --- slug follows the title until the slug is edited by hand ------------
  var slugSource = document.querySelector('[data-slug-source]');
  var slugTarget = document.querySelector('[data-slug-target]');
  if (slugSource && slugTarget) {
    var slugTouched = slugTarget.value.trim() !== '';
    slugTarget.addEventListener('input', function () {
      slugTouched = true;
    });
    slugSource.addEventListener('input', function () {
      if (slugTouched) return;
      slugTarget.value = slugSource.value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    });
  }

  // --- media picker -------------------------------------------------------
  var dialog = document.getElementById('media-dialog');
  var dialogBody = document.getElementById('media-dialog-body');
  var activeTarget = null; // { mode: 'single'|'multi', field: Element }
  var selection = [];

  function closeDialog() {
    if (dialog && dialog.open) dialog.close();
    activeTarget = null;
    selection = [];
  }

  function loadPicker(query) {
    var url = '/admin/media/picker?multiple=' + (activeTarget.mode === 'multi' ? '1' : '0');
    if (query) url += '&q=' + encodeURIComponent(query);
    dialogBody.innerHTML = '<p class="empty-state">Loading…</p>';
    fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Could not load the media library.');
        return response.text();
      })
      .then(function (html) {
        dialogBody.innerHTML = html;
        updateCount();
      })
      .catch(function (error) {
        dialogBody.innerHTML = '<p class="empty-state">' + error.message + '</p>';
      });
  }

  function openPicker(mode, field) {
    if (!dialog) return;
    activeTarget = { mode: mode, field: field };
    selection = [];
    if (!dialog.open) dialog.showModal();
    loadPicker('');
  }

  function updateCount() {
    var counter = dialogBody.querySelector('[data-picker-count]');
    if (counter) counter.textContent = String(selection.length);
  }

  function setSingle(field, item) {
    var input = field.querySelector('[data-media-input]');
    var preview = field.querySelector('[data-media-preview]');
    var clear = field.querySelector('[data-media-clear]');
    var choose = field.querySelector('[data-media-choose]');
    input.value = item.id;
    preview.innerHTML = '';
    var img = document.createElement('img');
    img.src = item.url;
    img.alt = item.alt || item.name;
    preview.appendChild(img);
    if (clear) clear.hidden = false;
    if (choose) choose.textContent = 'Change';
  }

  function galleryItemNode(item) {
    var li = document.createElement('li');
    li.setAttribute('data-media-id', String(item.id));
    li.innerHTML =
      '<img alt=""><span class="gallery-field-name"></span>' +
      '<span class="gallery-field-buttons">' +
      '<button type="button" class="icon-button" data-gallery-move="up" aria-label="Move earlier">↑</button>' +
      '<button type="button" class="icon-button" data-gallery-move="down" aria-label="Move later">↓</button>' +
      '<button type="button" class="icon-button" data-gallery-remove aria-label="Remove">✕</button>' +
      '</span>';
    li.querySelector('img').src = item.url;
    li.querySelector('img').alt = item.alt || '';
    li.querySelector('.gallery-field-name').textContent = item.name || '';
    return li;
  }

  function syncGallery(field) {
    var input = field.querySelector('[data-gallery-input]');
    var list = field.querySelector('[data-gallery-list]');
    var empty = field.querySelector('[data-gallery-empty]');
    var ids = Array.prototype.map.call(list.children, function (li) {
      return Number(li.getAttribute('data-media-id'));
    });
    input.value = JSON.stringify(ids);
    if (empty) empty.hidden = ids.length > 0;
  }

  document.addEventListener('click', function (event) {
    // Single media field
    var choose = event.target.closest('[data-media-choose]');
    if (choose) {
      openPicker('single', choose.closest('[data-media-field]'));
      return;
    }

    var clear = event.target.closest('[data-media-clear]');
    if (clear) {
      var field = clear.closest('[data-media-field]');
      field.querySelector('[data-media-input]').value = '';
      field.querySelector('[data-media-preview]').innerHTML =
        '<span class="media-field-empty">No image selected</span>';
      clear.hidden = true;
      var chooseButton = field.querySelector('[data-media-choose]');
      if (chooseButton) chooseButton.textContent = 'Choose image';
      return;
    }

    // Gallery field
    var add = event.target.closest('[data-gallery-add]');
    if (add) {
      openPicker('multi', add.closest('[data-gallery-field]'));
      return;
    }

    var remove = event.target.closest('[data-gallery-remove]');
    if (remove) {
      var galleryField = remove.closest('[data-gallery-field]');
      remove.closest('li').remove();
      syncGallery(galleryField);
      return;
    }

    var move = event.target.closest('[data-gallery-move]');
    if (move) {
      var li = move.closest('li');
      var direction = move.getAttribute('data-gallery-move');
      if (direction === 'up' && li.previousElementSibling) {
        li.parentNode.insertBefore(li, li.previousElementSibling);
      } else if (direction === 'down' && li.nextElementSibling) {
        li.parentNode.insertBefore(li.nextElementSibling, li);
      }
      syncGallery(move.closest('[data-gallery-field]'));
      return;
    }

    // Dialog internals
    if (event.target.closest('[data-media-close]')) {
      closeDialog();
      return;
    }

    var pick = event.target.closest('[data-picker-item]');
    if (pick && activeTarget) {
      var item = {
        id: Number(pick.getAttribute('data-id')),
        url: pick.getAttribute('data-url'),
        name: pick.getAttribute('data-name'),
        alt: pick.getAttribute('data-alt')
      };
      if (activeTarget.mode === 'single') {
        setSingle(activeTarget.field, item);
        closeDialog();
      } else {
        var index = selection.findIndex(function (entry) {
          return entry.id === item.id;
        });
        if (index >= 0) {
          selection.splice(index, 1);
          pick.setAttribute('aria-pressed', 'false');
        } else {
          selection.push(item);
          pick.setAttribute('aria-pressed', 'true');
        }
        updateCount();
      }
      return;
    }

    if (event.target.closest('[data-picker-confirm]') && activeTarget) {
      var target = activeTarget.field;
      var list = target.querySelector('[data-gallery-list]');
      selection.forEach(function (entry) {
        if (list.querySelector('[data-media-id="' + entry.id + '"]')) return;
        list.appendChild(galleryItemNode(entry));
      });
      syncGallery(target);
      closeDialog();
    }
  });

  // Search inside the picker without leaving the dialog.
  document.addEventListener('submit', function (event) {
    var searchForm = event.target.closest('[data-picker-search]');
    if (searchForm && activeTarget) {
      event.preventDefault();
      loadPicker(searchForm.querySelector('input[name="q"]').value);
      return;
    }

    var uploadForm = event.target.closest('[data-picker-upload]');
    if (uploadForm && activeTarget) {
      event.preventDefault();
      var status = uploadForm.querySelector('[data-picker-status]');
      var data = new FormData(uploadForm);
      if (!data.get('files') || !data.get('files').name) {
        status.textContent = 'Choose a file first.';
        return;
      }
      status.textContent = 'Uploading…';
      fetch('/admin/media/upload', {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken }
      })
        .then(function (response) {
          return response.json();
        })
        .then(function (result) {
          if (result.errors && result.errors.length) {
            status.textContent = result.errors.join(' ');
          } else {
            status.textContent = 'Uploaded.';
          }
          loadPicker('');
        })
        .catch(function () {
          status.textContent = 'Upload failed. Try the Media page instead.';
        });
    }
  });

  if (dialog) {
    dialog.addEventListener('close', function () {
      activeTarget = null;
      selection = [];
    });
  }

  // --- technology logo picker (Devicon) -----------------------------------
  var iconDialog = document.getElementById('icon-dialog');
  var iconDialogBody = document.getElementById('icon-dialog-body');
  var activeIconField = null;

  function closeIconDialog() {
    if (iconDialog && iconDialog.open) iconDialog.close();
    activeIconField = null;
  }

  function loadIcons(query) {
    var url = '/admin/icons/picker' + (query ? '?q=' + encodeURIComponent(query) : '');
    iconDialogBody.innerHTML = '<p class="empty-state">Loading…</p>';
    fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Could not load the logo list.');
        return response.text();
      })
      .then(function (html) {
        iconDialogBody.innerHTML = html;
        var search = iconDialogBody.querySelector('#icon-q');
        if (search) search.focus();
      })
      .catch(function (error) {
        iconDialogBody.innerHTML = '<p class="empty-state">' + error.message + '</p>';
      });
  }

  function setIcon(field, name, artHtml) {
    field.querySelector('[data-icon-input]').value = name;
    field.querySelector('[data-icon-preview]').innerHTML = artHtml || '';
    field.querySelector('[data-icon-label]').textContent = name || 'Choose logo';
    var trigger = field.querySelector('[data-icon-choose]');
    if (trigger) {
      trigger.setAttribute(
        'aria-label',
        name ? 'Icon: ' + name + '. Choose a different logo' : 'Icon: none selected. Choose a logo'
      );
    }
  }

  document.addEventListener('click', function (event) {
    var choose = event.target.closest('[data-icon-choose]');
    if (choose) {
      if (!iconDialog) return;
      activeIconField = choose.closest('[data-icon-field]');
      if (!iconDialog.open) iconDialog.showModal();
      loadIcons('');
      return;
    }

    if (event.target.closest('[data-icon-close]')) {
      closeIconDialog();
      return;
    }

    var option = event.target.closest('[data-icon-option]');
    if (option && activeIconField) {
      var art = option.querySelector('.icon-option-art');
      setIcon(activeIconField, option.getAttribute('data-icon-name') || '', art ? art.innerHTML : '');
      closeIconDialog();
    }
  });

  document.addEventListener('submit', function (event) {
    var iconSearch = event.target.closest('[data-icon-search]');
    if (iconSearch && activeIconField) {
      event.preventDefault();
      loadIcons(iconSearch.querySelector('input[name="q"]').value);
    }
  });

  if (iconDialog) {
    iconDialog.addEventListener('close', function () {
      activeIconField = null;
    });
  }

  // --- project technologies (name + optional Devicon logo) ----------------
  var techField = document.querySelector('[data-tech-field]');

  if (techField) {
    var techList = techField.querySelector('[data-tech-list]');
    var techInput = techField.querySelector('[data-tech-input]');
    var techEmpty = techField.querySelector('[data-tech-empty]');
    var techNameInput = techField.querySelector('[data-tech-name-input]');
    var techIconField = techField.querySelector('[data-icon-field]');

    var syncTech = function () {
      var entries = Array.prototype.map.call(techList.children, function (li) {
        return { name: li.getAttribute('data-tech-name'), icon: li.getAttribute('data-tech-icon') || '' };
      });
      techInput.value = JSON.stringify(entries);
      if (techEmpty) techEmpty.hidden = entries.length > 0;
    };

    var techRow = function (name, icon, logoHtml) {
      var li = document.createElement('li');
      li.setAttribute('data-tech-name', name);
      li.setAttribute('data-tech-icon', icon || '');
      li.innerHTML =
        '<span class="tech-field-logo" aria-hidden="true"></span>' +
        '<span class="tech-field-name"></span>' +
        '<span class="tech-field-buttons">' +
        '<button type="button" class="icon-button" data-tech-move="up" aria-label="Move earlier">↑</button>' +
        '<button type="button" class="icon-button" data-tech-move="down" aria-label="Move later">↓</button>' +
        '<button type="button" class="icon-button icon-button-danger" data-tech-remove aria-label="Remove">✕</button>' +
        '</span>';
      li.querySelector('.tech-field-logo').innerHTML = logoHtml || '';
      li.querySelector('.tech-field-name').textContent = name;
      return li;
    };

    /** Put the "new technology" row back to empty, logo included. */
    var resetTechDraft = function () {
      techNameInput.value = '';
      if (!techIconField) return;
      var iconInput = techIconField.querySelector('[data-icon-input]');
      var preview = techIconField.querySelector('[data-icon-preview]');
      var label = techIconField.querySelector('[data-icon-label]');
      var trigger = techIconField.querySelector('[data-icon-choose]');
      if (iconInput) iconInput.value = '';
      if (preview) preview.innerHTML = '';
      if (label) label.textContent = 'Choose logo';
      if (trigger) trigger.setAttribute('aria-label', 'Logo: none selected. Choose a logo');
    };

    var addTech = function () {
      var iconInput = techIconField ? techIconField.querySelector('[data-icon-input]') : null;
      var preview = techIconField ? techIconField.querySelector('[data-icon-preview]') : null;
      var icon = iconInput ? iconInput.value : '';
      var logoHtml = preview ? preview.innerHTML : '';
      // A logo with no typed name falls back to the logo's own name.
      var name = (techNameInput.value || '').trim() || icon;
      if (!name) {
        techNameInput.focus();
        return;
      }

      var duplicate = techList.querySelector('[data-tech-name="' + name.replace(/"/g, '\\"') + '"]');
      if (!duplicate) {
        techList.appendChild(techRow(name, icon, logoHtml));
        syncTech();
      }

      resetTechDraft();
      techNameInput.focus();
    };

    techField.addEventListener('click', function (event) {
      if (event.target.closest('[data-tech-add]')) {
        addTech();
        return;
      }

      var remove = event.target.closest('[data-tech-remove]');
      if (remove) {
        remove.closest('li').remove();
        syncTech();
        return;
      }

      var move = event.target.closest('[data-tech-move]');
      if (move) {
        var li = move.closest('li');
        if (move.getAttribute('data-tech-move') === 'up' && li.previousElementSibling) {
          li.parentNode.insertBefore(li, li.previousElementSibling);
        } else if (move.getAttribute('data-tech-move') === 'down' && li.nextElementSibling) {
          li.parentNode.insertBefore(li.nextElementSibling, li);
        }
        syncTech();
      }
    });

    // Enter in the name box adds the entry rather than submitting the project.
    techNameInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTech();
      }
    });
  }

  // --- plain text chips (research keywords) -------------------------------
  document.querySelectorAll('[data-chips-field]').forEach(function (field) {
    var list = field.querySelector('[data-chips-list]');
    var hidden = field.querySelector('[data-chips-input]');
    var empty = field.querySelector('[data-chips-empty]');
    var input = field.querySelector('[data-chip-input]');

    var sync = function () {
      var values = Array.prototype.map.call(list.children, function (li) {
        return li.getAttribute('data-chip-value');
      });
      hidden.value = JSON.stringify(values);
      if (empty) empty.hidden = values.length > 0;
    };

    var addChips = function () {
      // One value, or several pasted in at once.
      var values = (input.value || '')
        .split(',')
        .map(function (value) {
          return value.trim();
        })
        .filter(Boolean);

      values.forEach(function (value) {
        var existing = Array.prototype.some.call(list.children, function (li) {
          return li.getAttribute('data-chip-value').toLowerCase() === value.toLowerCase();
        });
        if (existing) return;

        var li = document.createElement('li');
        li.setAttribute('data-chip-value', value);
        li.innerHTML =
          '<span class="chip-text"></span>' +
          '<button type="button" class="icon-button icon-button-danger" data-chip-remove aria-label="Remove">✕</button>';
        li.querySelector('.chip-text').textContent = value;
        list.appendChild(li);
      });

      if (values.length) sync();
      input.value = '';
      input.focus();
    };

    field.addEventListener('click', function (event) {
      if (event.target.closest('[data-chip-add]')) {
        addChips();
        return;
      }
      var remove = event.target.closest('[data-chip-remove]');
      if (remove) {
        remove.closest('li').remove();
        sync();
      }
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        addChips();
      }
    });
  });
})();
