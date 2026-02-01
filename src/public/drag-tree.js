/**
 * Lorebook tree drag-and-drop — hold-to-drag interaction.
 *
 * Hold mousedown on a tree entry for 1 second to start dragging.
 * Move >8px during hold cancels (click passthrough).
 * Drop on a folder or root to move the entry via PUT /api/lorebook/entry/move.
 */
(function () {
  "use strict";

  var HOLD_MS = 1000;
  var MOVE_THRESHOLD = 8;
  var RING_CIRCUMFERENCE = 75.4; // 2 * PI * 12

  // State
  var holdTimer = null;
  var isDragging = false;
  var dragEntry = null;  // the <li.tree-entry> being dragged
  var dragPath = "";
  var startX = 0, startY = 0;
  var ghostEl = null;
  var ringEl = null;
  var targetGhostEl = null;
  var currentDropTarget = null;

  // --- Helpers ---

  function getTreeRoot(el) {
    return el.closest(".tree-root");
  }

  function folderPath(folderLi) {
    var p = folderLi.dataset.path || "";
    return p;
  }

  function sourceFolderOf(path) {
    var i = path.lastIndexOf("/");
    return i > 0 ? path.slice(0, i) : "";
  }

  // --- Ring ---

  function showRing(x, y) {
    ringEl = document.createElement("div");
    ringEl.className = "drag-hold-ring";
    ringEl.innerHTML =
      '<svg viewBox="0 0 28 28"><circle cx="14" cy="14" r="12"/></svg>';
    ringEl.style.left = x + "px";
    ringEl.style.top = y + "px";
    document.body.appendChild(ringEl);
    // Force reflow then add class to start animation
    void ringEl.offsetWidth;
    ringEl.classList.add("active");
  }

  function hideRing() {
    if (ringEl) {
      ringEl.remove();
      ringEl = null;
    }
  }

  // --- Ghost ---

  function showGhost(text, x, y) {
    ghostEl = document.createElement("div");
    ghostEl.className = "drag-ghost";
    ghostEl.textContent = text;
    ghostEl.style.left = x + 12 + "px";
    ghostEl.style.top = y - 14 + "px";
    document.body.appendChild(ghostEl);
  }

  function moveGhost(x, y) {
    if (ghostEl) {
      ghostEl.style.left = x + 12 + "px";
      ghostEl.style.top = y - 14 + "px";
    }
  }

  function hideGhost() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
  }

  // --- Target ghost (preview <li>) ---

  function showTargetGhost(container, entryName) {
    hideTargetGhost();
    targetGhostEl = document.createElement("li");
    targetGhostEl.className = "drag-target-ghost";
    targetGhostEl.textContent = entryName;
    // Find the <ul.tree-list> inside the folder or root
    var ul = container.querySelector("ul.tree-list");
    if (ul) {
      ul.appendChild(targetGhostEl);
    } else if (container.classList.contains("tree-root")) {
      // Root with no entries yet — append directly
      container.appendChild(targetGhostEl);
    }
  }

  function hideTargetGhost() {
    if (targetGhostEl) {
      targetGhostEl.remove();
      targetGhostEl = null;
    }
  }

  // --- Highlight ---

  function clearHighlights() {
    var prev = document.querySelectorAll(".drag-over, .drag-over-root");
    for (var i = 0; i < prev.length; i++) {
      prev[i].classList.remove("drag-over");
      prev[i].classList.remove("drag-over-root");
    }
    currentDropTarget = null;
  }

  // --- Cancel ---

  function cancelDrag() {
    clearTimeout(holdTimer);
    holdTimer = null;
    hideRing();
    hideGhost();
    hideTargetGhost();
    clearHighlights();
    if (dragEntry) {
      dragEntry.classList.remove("dragging");
    }
    isDragging = false;
    dragEntry = null;
    dragPath = "";
  }

  // --- Event: mousedown ---

  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return; // left button only
    var entry = e.target.closest(".tree-entry");
    if (!entry) return;
    var tree = entry.closest("#lorebook-tree");
    if (!tree) return;
    var root = getTreeRoot(entry);
    if (!root || root.dataset.readonly === "true") return;
    // Don't activate on buttons
    if (e.target.closest("button")) return;

    dragEntry = entry;
    dragPath = entry.dataset.path || "";
    startX = e.pageX;
    startY = e.pageY;

    // Prevent text selection during hold
    e.preventDefault();

    showRing(e.pageX, e.pageY);

    holdTimer = setTimeout(function () {
      holdTimer = null;
      // Hold completed — start dragging
      isDragging = true;
      dragEntry.classList.add("dragging");
      hideRing();
      var text = dragEntry.querySelector("a");
      showGhost(text ? text.textContent : dragPath, e.clientX, e.clientY);
    }, HOLD_MS);
  });

  // --- Event: mousemove ---

  document.addEventListener("mousemove", function (e) {
    if (!dragEntry) return;

    if (holdTimer !== null) {
      // Still in hold phase — check movement threshold
      var dx = e.pageX - startX;
      var dy = e.pageY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
        cancelDrag();
      }
      return;
    }

    if (!isDragging) return;

    moveGhost(e.clientX, e.clientY);

    // Temporarily hide ghost to hit-test what's beneath
    ghostEl.style.display = "none";
    var hitEl = document.elementFromPoint(e.clientX, e.clientY);
    ghostEl.style.display = "";

    if (!hitEl) {
      clearHighlights();
      hideTargetGhost();
      return;
    }

    var sourceFolder = sourceFolderOf(dragPath);
    var entryName = dragEntry.querySelector("a");
    entryName = entryName ? entryName.textContent : dragPath.split("/").pop();

    // Check if over a folder
    var folder = hitEl.closest(".tree-folder");
    var root = hitEl.closest(".tree-root");

    if (folder && root && !root.dataset.readonly) {
      var fp = folderPath(folder);
      // Must be different from source folder and not the entry itself
      if (fp !== sourceFolder && fp !== dragPath) {
        if (currentDropTarget !== folder) {
          clearHighlights();
          hideTargetGhost();
          folder.classList.add("drag-over");
          currentDropTarget = folder;
          showTargetGhost(folder.querySelector("details") || folder, entryName);
        }
        return;
      }
    }

    // Check if over root area (for root-level drop)
    if (root && !root.dataset.readonly && sourceFolder !== "") {
      // Only allow root drop if not already at root
      var overFolder = hitEl.closest(".tree-folder");
      if (!overFolder || overFolder.dataset.path === dragPath) {
        if (currentDropTarget !== root) {
          clearHighlights();
          hideTargetGhost();
          root.classList.add("drag-over-root");
          currentDropTarget = root;
          showTargetGhost(root, entryName);
        }
        return;
      }
    }

    // No valid target
    if (currentDropTarget) {
      clearHighlights();
      hideTargetGhost();
    }
  });

  // --- Event: mouseup ---

  document.addEventListener("mouseup", function (e) {
    if (!dragEntry) return;

    if (holdTimer !== null) {
      // Hold didn't complete — cancel and allow normal click
      cancelDrag();
      return;
    }

    if (!isDragging) {
      cancelDrag();
      return;
    }

    var destination = null;
    var root = getTreeRoot(dragEntry);
    var lorebook = root ? root.dataset.lorebook : "";

    if (currentDropTarget && currentDropTarget.classList.contains("drag-over")) {
      // Dropped on a folder
      destination = folderPath(currentDropTarget);
    } else if (currentDropTarget && currentDropTarget.classList.contains("drag-over-root")) {
      // Dropped on root
      destination = "";
    }

    var pathToMove = dragPath;
    cancelDrag();

    if (destination === null || !lorebook) return;

    // API call
    fetch("/api/lorebook/entry/move?lorebook=" + encodeURIComponent(lorebook), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathToMove, destination: destination }),
    })
      .then(function (res) {
        var newPath = res.headers.get("X-New-Path");
        if (res.ok) {
          // Refresh the tree
          if (typeof htmx !== "undefined") {
            htmx.trigger(document.body, "refreshTree");
          }
          // If the moved entry was being edited, reload it at new path
          if (newPath) {
            var editor = document.getElementById("lorebook-editor");
            if (editor) {
              var form = editor.querySelector("form");
              if (form) {
                var action = form.getAttribute("hx-put") || form.getAttribute("hx-post") || "";
                if (action.includes("path=" + encodeURIComponent(pathToMove))) {
                  var newUrl = "/api/lorebook/entry?path=" + encodeURIComponent(newPath) +
                    "&lorebook=" + encodeURIComponent(lorebook);
                  htmx.ajax("GET", newUrl, { target: "#lorebook-editor", swap: "innerHTML" });
                }
              }
            }
          }
        }
      })
      .catch(function () {
        // Silently fail — tree will remain unchanged
      });
  });

  // --- Event: keydown (Escape) ---

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (holdTimer !== null || isDragging)) {
      cancelDrag();
    }
  });

  // --- Prevent native drag on tree entries ---

  document.addEventListener("dragstart", function (e) {
    if (e.target.closest && e.target.closest(".tree-entry")) {
      e.preventDefault();
    }
  });
})();
