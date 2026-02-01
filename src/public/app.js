(function() {
  // -----------------------------------------------------------------------
  // Tab switching
  // -----------------------------------------------------------------------
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.tab-panel');

  function switchTab(tabName) {
    tabs.forEach(function(t) { t.classList.remove('active'); });
    panels.forEach(function(p) { p.classList.remove('active'); });
    var tabBtn = document.querySelector('.tab[data-tab="' + tabName + '"]');
    if (tabBtn) tabBtn.classList.add('active');
    var panel = document.getElementById('panel-' + tabName);
    if (panel) panel.classList.add('active');
  }

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var tabName = tab.getAttribute('data-tab');
      navigateTo('#' + tabName, false);
    });
  });

  // -----------------------------------------------------------------------
  // Adventure state
  // -----------------------------------------------------------------------
  var currentAdventure = '';   // lorebook slug
  var currentChatId = '';
  var currentLocation = '';
  var adventureName = '';

  var chatForm = document.getElementById('chat-form');
  var chatInput = document.getElementById('chat-input');
  var chatMessages = document.getElementById('chat-messages');
  var adventurePicker = document.getElementById('adventure-picker');
  var adventurePlay = document.getElementById('adventure-play');
  var adventureNameEl = document.getElementById('adventure-name');
  var locationSelect = document.getElementById('adventure-location-select');
  var activeEntriesContent = document.getElementById('active-entries-content');

  function refreshActiveEntries() {
    if (!currentChatId) return;
    fetch('/api/adventures/active-entries?chatId=' + encodeURIComponent(currentChatId))
      .then(function(res) { return res.text(); })
      .then(function(html) {
        activeEntriesContent.innerHTML = html;
      });
  }

  function showAdventurePicker(skipPush) {
    adventurePicker.style.display = '';
    adventurePlay.style.display = 'none';
    currentAdventure = '';
    currentChatId = '';
    currentLocation = '';
    adventureName = '';
    activeEntriesContent.innerHTML = '<p class="active-entries-empty">Start chatting to see active lore.</p>';
    htmx.trigger(document.body, 'refreshAdventures');
    if (!skipPush) history.pushState(null, '', '#adventure');
  }

  function startAdventure(lorebook, chatId, name, location, skipPush) {
    currentAdventure = lorebook;
    currentChatId = chatId;
    currentLocation = location || '';
    adventureName = name;

    adventurePicker.style.display = 'none';
    adventurePlay.style.display = '';
    adventureNameEl.textContent = name;

    // Load locations into dropdown
    fetch('/api/adventures/locations?lorebook=' + encodeURIComponent(lorebook))
      .then(function(res) { return res.text(); })
      .then(function(html) {
        locationSelect.innerHTML = html;
        if (currentLocation) locationSelect.value = currentLocation;
      });

    // Load chat messages
    htmx.ajax('GET', '/api/chats/messages?id=' + encodeURIComponent(chatId), {
      target: '#chat-messages', swap: 'innerHTML'
    }).then(function() {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // Load active entries panel
    refreshActiveEntries();

    if (!skipPush) history.pushState(null, '', '#adventure/' + encodeURIComponent(lorebook));
  }

  // Back button
  document.getElementById('adventure-back-btn').addEventListener('click', function() {
    showAdventurePicker(false);
  });

  // Location change
  locationSelect.addEventListener('change', function() {
    var loc = locationSelect.value;
    if (!loc || !currentChatId) return;

    fetch('/api/adventures/location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: currentChatId, location: loc })
    })
    .then(function(res) {
      var newLoc = res.headers.get('X-Location');
      if (newLoc) currentLocation = newLoc;
      return res.text();
    })
    .then(function(html) {
      // Clear placeholder if present
      var ph = chatMessages.querySelector('.editor-placeholder');
      if (ph) ph.remove();
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      while (tmp.firstChild) chatMessages.appendChild(tmp.firstChild);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      refreshActiveEntries();
    });
  });

  // Send message
  chatForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var msg = chatInput.value.trim();
    if (!msg) return;

    // Clear placeholder if present
    var ph = chatMessages.querySelector('.editor-placeholder');
    if (ph) ph.remove();

    // Add user message
    var userDiv = document.createElement('div');
    userDiv.className = 'chat-msg chat-msg-user';
    userDiv.textContent = msg;
    chatMessages.appendChild(userDiv);
    chatInput.value = '';
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send to server
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, chatId: currentChatId, lorebook: currentAdventure })
    })
    .then(function(res) {
      var newId = res.headers.get('X-Chat-Id');
      if (newId) currentChatId = newId;
      var newLoc = res.headers.get('X-Location');
      if (newLoc) {
        currentLocation = newLoc;
        // Refresh location dropdown to include new/selected location
        fetch('/api/adventures/locations?lorebook=' + encodeURIComponent(currentAdventure))
          .then(function(r) { return r.text(); })
          .then(function(opts) {
            locationSelect.innerHTML = opts;
            locationSelect.value = currentLocation;
          });
      }
      return res.text();
    })
    .then(function(html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      while (tmp.firstChild) chatMessages.appendChild(tmp.firstChild);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      refreshActiveEntries();
    });
  });

  // Listen for refreshActiveEntries event from HX-Trigger headers
  document.body.addEventListener('refreshActiveEntries', function() {
    refreshActiveEntries();
  });

  // -----------------------------------------------------------------------
  // Adventure picker event delegation
  // -----------------------------------------------------------------------
  document.addEventListener('click', function(e) {
    // Continue button
    var contBtn = e.target.closest('.adventure-continue-btn');
    if (contBtn) {
      startAdventure(
        contBtn.getAttribute('data-lorebook'),
        contBtn.getAttribute('data-chat-id'),
        contBtn.getAttribute('data-name'),
        contBtn.getAttribute('data-location')
      );
      return;
    }

    // Delete button
    var delBtn = e.target.closest('.adventure-delete-btn');
    if (delBtn) {
      var slug = delBtn.getAttribute('data-lorebook');
      var name = delBtn.getAttribute('data-name');
      document.getElementById('adv-del-slug').value = slug;
      document.getElementById('adv-del-name').value = name;
      document.getElementById('adv-del-expected').textContent = name;
      document.getElementById('adv-del-confirm').value = '';
      document.getElementById('adv-del-submit').disabled = true;
      document.getElementById('adventure-delete-dialog').showModal();
      document.getElementById('adv-del-confirm').focus();
      return;
    }

    // Start from template button
    var startBtn = e.target.closest('.adventure-start-btn');
    if (startBtn) {
      var source = startBtn.getAttribute('data-template');
      var label = startBtn.getAttribute('data-name');
      document.getElementById('adv-tpl-source').value = source;
      document.getElementById('adv-tpl-source-label').textContent = 'Template: ' + label;
      document.getElementById('adv-tpl-name').value = '';
      document.getElementById('adventure-template-dialog').showModal();
      document.getElementById('adv-tpl-name').focus();
      return;
    }
  });

  // Adventure template dialog
  document.getElementById('btn-adv-tpl-cancel').addEventListener('click', function() {
    document.getElementById('adventure-template-dialog').close();
  });

  document.getElementById('adventure-template-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var nameInput = document.getElementById('adv-tpl-name');
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    var slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) { nameInput.focus(); return; }
    var source = document.getElementById('adv-tpl-source').value;
    document.getElementById('adventure-template-dialog').close();

    fetch('/api/lorebooks/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source, slug: slug, name: name })
    }).then(function() {
      return fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lorebook: slug })
      });
    }).then(function(res) {
      var chatId = res.headers.get('X-Chat-Id');
      if (chatId) startAdventure(slug, chatId, name, '');
    });
  });

  // Adventure delete dialog
  document.getElementById('btn-adv-del-cancel').addEventListener('click', function() {
    document.getElementById('adventure-delete-dialog').close();
  });

  document.getElementById('adv-del-confirm').addEventListener('input', function() {
    var expected = document.getElementById('adv-del-name').value;
    document.getElementById('adv-del-submit').disabled = (this.value !== expected);
  });

  document.getElementById('adventure-delete-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var slug = document.getElementById('adv-del-slug').value;
    var expected = document.getElementById('adv-del-name').value;
    if (document.getElementById('adv-del-confirm').value !== expected) return;
    document.getElementById('adventure-delete-dialog').close();
    fetch('/api/adventures?lorebook=' + encodeURIComponent(slug), { method: 'DELETE' })
      .then(function() {
        htmx.trigger(document.body, 'refreshAdventures');
      });
  });

  // -----------------------------------------------------------------------
  // Trait handlers (active entries panel)
  // -----------------------------------------------------------------------
  document.addEventListener('click', function(e) {
    var removeBtn = e.target.closest('.trait-remove');
    if (!removeBtn) return;
    var trait = removeBtn.getAttribute('data-trait');
    var chatId = removeBtn.getAttribute('data-chat-id');
    // Collect current traits from the DOM, minus the removed one
    var tags = document.querySelectorAll('.trait-tag');
    var traits = [];
    tags.forEach(function(tag) {
      var btn = tag.querySelector('.trait-remove');
      if (btn) {
        var t = btn.getAttribute('data-trait');
        if (t !== trait) traits.push(t);
      }
    });
    fetch('/api/adventures/traits', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatId, traits: traits })
    }).then(function(res) { return res.text(); })
      .then(function(html) { activeEntriesContent.innerHTML = html; });
  });

  document.addEventListener('submit', function(e) {
    var form = e.target.closest('.trait-add-form');
    if (!form) return;
    e.preventDefault();
    var input = form.querySelector('.trait-add-input');
    var newTrait = input.value.trim();
    if (!newTrait) return;
    var chatId = form.getAttribute('data-chat-id');
    // Collect current traits from the DOM
    var tags = document.querySelectorAll('.trait-tag');
    var traits = [];
    tags.forEach(function(tag) {
      var btn = tag.querySelector('.trait-remove');
      if (btn) traits.push(btn.getAttribute('data-trait'));
    });
    traits.push(newTrait);
    fetch('/api/adventures/traits', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatId, traits: traits })
    }).then(function(res) { return res.text(); })
      .then(function(html) { activeEntriesContent.innerHTML = html; });
  });

  // -----------------------------------------------------------------------
  // Lorebook
  // -----------------------------------------------------------------------
  var newDialog = document.getElementById('new-dialog');
  var newForm = document.getElementById('new-form');
  var prefixSpan = document.getElementById('new-prefix');
  var nameInput = document.getElementById('new-name');

  var lbDialog = document.getElementById('lorebook-dialog');
  var lbForm = document.getElementById('lorebook-form');
  var lbNameInput = document.getElementById('lb-new-name');

  var lorebookPicker = document.getElementById('lorebook-picker');
  var lorebookEdit = document.getElementById('lorebook-edit');
  var lorebookEditName = document.getElementById('lorebook-edit-name');

  var currentLorebook = '';
  var currentPrefix = '';

  function refreshTree() {
    htmx.ajax('GET', '/api/lorebook/tree?lorebook=' + encodeURIComponent(currentLorebook), {
      target: '#lorebook-tree', swap: 'innerHTML'
    });
  }

  document.body.addEventListener('refreshTree', function() {
    refreshTree();
  });

  function showLorebookPicker(skipPush) {
    lorebookPicker.style.display = '';
    lorebookEdit.style.display = 'none';
    currentLorebook = '';
    htmx.trigger(document.body, 'refreshLorebooks');
    if (!skipPush) history.pushState(null, '', '#lorebook');
  }

  function enterLorebookEdit(slug, name, skipPush, preset) {
    lorebookPicker.style.display = 'none';
    lorebookEdit.style.display = '';
    currentLorebook = slug;
    lorebookEditName.textContent = name + (preset ? ' (Preset)' : '');
    refreshTree();
    document.getElementById('lorebook-editor').innerHTML =
      preset
        ? '<p class="editor-placeholder">Select an entry from the tree to view it.</p>'
        : '<p class="editor-placeholder">Select an entry from the tree, or create a new one.</p>';
    if (!skipPush) history.pushState(null, '', '#lorebook/' + encodeURIComponent(slug));
  }

  // Back button
  document.getElementById('lorebook-back-btn').addEventListener('click', function() {
    showLorebookPicker(false);
  });

  // Event delegation for dynamic buttons
  document.addEventListener('click', function(e) {
    // Edit button on lorebook cards
    var editBtn = e.target.closest('.lorebook-edit-btn');
    if (editBtn) {
      var preset = editBtn.getAttribute('data-preset') === 'true';
      enterLorebookEdit(editBtn.getAttribute('data-slug'), editBtn.getAttribute('data-name'), false, preset);
      return;
    }

    // Delete button on template cards
    var delBtn = e.target.closest('.lorebook-delete-btn');
    if (delBtn) {
      if (confirm('Delete template "' + delBtn.getAttribute('data-name') + '"?')) {
        fetch('/api/lorebooks?slug=' + encodeURIComponent(delBtn.getAttribute('data-slug')), { method: 'DELETE' })
          .then(function() { htmx.trigger(document.body, 'refreshLorebooks'); });
      }
      return;
    }

    // Copy button on preset template cards
    var copyBtn = e.target.closest('.lorebook-copy-btn');
    if (copyBtn) {
      var source = copyBtn.getAttribute('data-slug');
      var label = copyBtn.getAttribute('data-name');
      document.getElementById('lb-copy-source').value = source;
      document.getElementById('lb-copy-source-label').textContent = 'Copying: ' + label;
      document.getElementById('lb-copy-name').value = '';
      document.getElementById('lorebook-copy-dialog').showModal();
      document.getElementById('lb-copy-name').focus();
      return;
    }

    // "+ New" entry/folder buttons in tree
    var btn = e.target.closest('.btn-new-entry');
    if (btn) {
      currentPrefix = btn.getAttribute('data-prefix') || '';
      prefixSpan.textContent = currentPrefix;
      nameInput.value = '';
      newDialog.showModal();
      nameInput.focus();
      return;
    }

    // "+ Template" button
    if (e.target.id === 'btn-new-lorebook' || e.target.closest('#btn-new-lorebook')) {
      lbNameInput.value = '';
      lbDialog.showModal();
      lbNameInput.focus();
      return;
    }
  });

  // --- New entry/folder dialog ---
  document.getElementById('btn-cancel').addEventListener('click', function() {
    newDialog.close();
  });

  newForm.addEventListener('submit', function(e) {
    e.preventDefault();
  });

  function getFullPath() {
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return null; }
    return currentPrefix + name;
  }

  nameInput.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var path = getFullPath();
    if (!path) return;
    newDialog.close();
    if (path.endsWith('/')) {
      htmx.ajax('POST', '/api/lorebook/folder?lorebook=' + encodeURIComponent(currentLorebook), {
        target: '#lorebook-tree', swap: 'innerHTML', values: { path: path.replace(/\/$/, '') }
      });
    } else {
      htmx.ajax('GET', '/api/lorebook/entry?path=' + encodeURIComponent(path) + '&lorebook=' + encodeURIComponent(currentLorebook), {
        target: '#lorebook-editor', swap: 'innerHTML'
      });
    }
  });

  document.getElementById('btn-entry').addEventListener('click', function() {
    var path = getFullPath();
    if (!path) return;
    if (path.endsWith('/')) { nameInput.focus(); return; }
    newDialog.close();
    htmx.ajax('GET', '/api/lorebook/entry?path=' + encodeURIComponent(path) + '&lorebook=' + encodeURIComponent(currentLorebook), {
      target: '#lorebook-editor', swap: 'innerHTML'
    });
  });

  document.getElementById('btn-folder').addEventListener('click', function() {
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    var path = currentPrefix + name;
    newDialog.close();
    htmx.ajax('POST', '/api/lorebook/folder?lorebook=' + encodeURIComponent(currentLorebook), {
      target: '#lorebook-tree', swap: 'innerHTML', values: { path: path }
    });
  });

  // --- New lorebook dialog ---
  document.getElementById('btn-lb-cancel').addEventListener('click', function() {
    lbDialog.close();
  });

  lbForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var name = lbNameInput.value.trim();
    if (!name) { lbNameInput.focus(); return; }
    var slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) { lbNameInput.focus(); return; }
    lbDialog.close();
    fetch('/api/lorebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug, name: name })
    }).then(function() {
      htmx.trigger(document.body, 'refreshLorebooks');
      enterLorebookEdit(slug, name);
    });
  });

  // --- Copy preset template dialog ---
  document.getElementById('btn-lb-copy-cancel').addEventListener('click', function() {
    document.getElementById('lorebook-copy-dialog').close();
  });

  document.getElementById('lorebook-copy-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var copyNameInput = document.getElementById('lb-copy-name');
    var name = copyNameInput.value.trim();
    if (!name) { copyNameInput.focus(); return; }
    var slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) { copyNameInput.focus(); return; }
    var source = document.getElementById('lb-copy-source').value;
    document.getElementById('lorebook-copy-dialog').close();
    fetch('/api/lorebooks/make-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source, slug: slug, name: name })
    }).then(function() {
      htmx.trigger(document.body, 'refreshLorebooks');
      enterLorebookEdit(slug, name, false, false);
    });
  });

  // --- Save as Template dialog (adventure → template) ---
  var saveTplDialog = document.getElementById('adventure-save-tpl-dialog');
  var saveTplForm = document.getElementById('adventure-save-tpl-form');
  var saveTplNameInput = document.getElementById('save-tpl-name');
  var saveTplSource = document.getElementById('save-tpl-source');
  var saveTplSourceLabel = document.getElementById('save-tpl-source-label');

  document.addEventListener('click', function(e) {
    var saveTplBtn = e.target.closest('.adventure-save-tpl-btn');
    if (saveTplBtn) {
      var source = saveTplBtn.getAttribute('data-lorebook');
      var label = saveTplBtn.getAttribute('data-name');
      saveTplSource.value = source;
      saveTplSourceLabel.textContent = 'Adventure: ' + label;
      saveTplNameInput.value = '';
      saveTplDialog.showModal();
      saveTplNameInput.focus();
      return;
    }
  });

  document.getElementById('btn-save-tpl-cancel').addEventListener('click', function() {
    saveTplDialog.close();
  });

  saveTplForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var name = saveTplNameInput.value.trim();
    if (!name) { saveTplNameInput.focus(); return; }
    var slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) { saveTplNameInput.focus(); return; }
    var source = saveTplSource.value;
    saveTplDialog.close();
    fetch('/api/lorebooks/make-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source, slug: slug, name: name })
    }).then(function() {
      htmx.trigger(document.body, 'refreshLorebooks');
    });
  });

  // -----------------------------------------------------------------------
  // Hash-based routing
  // -----------------------------------------------------------------------
  function navigateTo(hash, skipPush) {
    // Parse hash: #tab or #tab/slug
    var raw = (hash || '').replace(/^#/, '');
    var parts = raw.split('/');
    var tab = parts[0] || 'adventure';
    var slug = decodeURIComponent(parts.slice(1).join('/'));

    // Validate tab name
    if (tab !== 'adventure' && tab !== 'lorebook' && tab !== 'settings') {
      tab = 'adventure';
      slug = '';
    }

    switchTab(tab);

    if (tab === 'adventure') {
      if (slug) {
        // Resume an adventure by lorebook slug
        fetch('/api/adventures/resume?lorebook=' + encodeURIComponent(slug))
          .then(function(res) {
            if (!res.ok) {
              // Adventure not found, fall back to picker
              showAdventurePicker(true);
              if (!skipPush) history.pushState(null, '', '#adventure');
              return;
            }
            return res.json();
          })
          .then(function(data) {
            if (data) startAdventure(data.lorebook, data.chatId, data.name, data.location, skipPush);
          });
      } else {
        showAdventurePicker(true);
        if (!skipPush) history.pushState(null, '', '#adventure');
      }
    } else if (tab === 'lorebook') {
      if (slug) {
        fetch('/api/lorebooks/meta?slug=' + encodeURIComponent(slug))
          .then(function(res) {
            if (!res.ok) { showLorebookPicker(true); return; }
            return res.json();
          })
          .then(function(data) {
            if (data) enterLorebookEdit(data.slug, data.name, skipPush, data.preset);
          });
      } else {
        showLorebookPicker(true);
      }
      if (!skipPush) history.pushState(null, '', hash || '#lorebook');
    } else if (tab === 'settings') {
      if (!skipPush) history.pushState(null, '', '#settings');
    }
  }

  // Browser back/forward
  window.addEventListener('popstate', function() {
    navigateTo(location.hash, true);
  });

  // Initial load — navigate based on current hash
  navigateTo(location.hash, true);
})();
