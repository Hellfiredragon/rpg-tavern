import { useEffect } from "react";

const HOLD_MS = 1000;
const MOVE_THRESHOLD = 8;

export function useDragTree(lorebook: string, readonly: boolean, onMoved: () => void) {
  useEffect(() => {
    if (readonly) return;

    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let isDragging = false;
    let dragEntry: HTMLElement | null = null;
    let dragPath = "";
    let startX = 0, startY = 0;
    let ghostEl: HTMLElement | null = null;
    let ringEl: HTMLElement | null = null;
    let targetGhostEl: HTMLElement | null = null;
    let currentDropTarget: HTMLElement | null = null;

    function getTreeRoot(el: HTMLElement) {
      return el.closest(".tree-root") as HTMLElement | null;
    }

    function folderPath(folderLi: HTMLElement) {
      return folderLi.dataset.path || "";
    }

    function sourceFolderOf(path: string) {
      const i = path.lastIndexOf("/");
      return i > 0 ? path.slice(0, i) : "";
    }

    function showRing(x: number, y: number) {
      ringEl = document.createElement("div");
      ringEl.className = "drag-hold-ring";
      ringEl.innerHTML = '<svg viewBox="0 0 28 28"><circle cx="14" cy="14" r="12"/></svg>';
      ringEl.style.left = x + "px";
      ringEl.style.top = y + "px";
      document.body.appendChild(ringEl);
      void ringEl.offsetWidth;
      ringEl.classList.add("active");
    }

    function hideRing() {
      if (ringEl) { ringEl.remove(); ringEl = null; }
    }

    function showGhost(text: string, x: number, y: number) {
      ghostEl = document.createElement("div");
      ghostEl.className = "drag-ghost";
      ghostEl.textContent = text;
      ghostEl.style.left = (x + 12) + "px";
      ghostEl.style.top = (y - 14) + "px";
      document.body.appendChild(ghostEl);
    }

    function moveGhost(x: number, y: number) {
      if (ghostEl) {
        ghostEl.style.left = (x + 12) + "px";
        ghostEl.style.top = (y - 14) + "px";
      }
    }

    function hideGhost() {
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    }

    function showTargetGhost(container: HTMLElement, entryName: string) {
      hideTargetGhost();
      targetGhostEl = document.createElement("li");
      targetGhostEl.className = "drag-target-ghost";
      targetGhostEl.textContent = entryName;
      const ul = container.querySelector("ul.tree-list");
      if (ul) ul.appendChild(targetGhostEl);
      else if (container.classList.contains("tree-root")) container.appendChild(targetGhostEl);
    }

    function hideTargetGhost() {
      if (targetGhostEl) { targetGhostEl.remove(); targetGhostEl = null; }
    }

    function clearHighlights() {
      document.querySelectorAll(".drag-over, .drag-over-root").forEach((el) => {
        el.classList.remove("drag-over", "drag-over-root");
      });
      currentDropTarget = null;
    }

    function cancelDrag() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      hideRing();
      hideGhost();
      hideTargetGhost();
      clearHighlights();
      if (dragEntry) dragEntry.classList.remove("dragging");
      isDragging = false;
      dragEntry = null;
      dragPath = "";
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const entry = (e.target as HTMLElement).closest(".tree-entry") as HTMLElement | null;
      if (!entry) return;
      const tree = entry.closest("#lorebook-tree, .lorebook-tree");
      if (!tree) return;
      const root = getTreeRoot(entry);
      if (!root || root.dataset.readonly === "true") return;
      if ((e.target as HTMLElement).closest("button")) return;

      dragEntry = entry;
      dragPath = entry.dataset.path || "";
      startX = e.pageX;
      startY = e.pageY;
      e.preventDefault();

      showRing(e.pageX, e.pageY);

      holdTimer = setTimeout(() => {
        holdTimer = null;
        isDragging = true;
        dragEntry!.classList.add("dragging");
        hideRing();
        const textEl = dragEntry!.querySelector("a");
        showGhost(textEl ? textEl.textContent! : dragPath, e.clientX, e.clientY);
      }, HOLD_MS);
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragEntry) return;
      if (holdTimer !== null) {
        const dx = e.pageX - startX;
        const dy = e.pageY - startY;
        if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) cancelDrag();
        return;
      }
      if (!isDragging) return;

      moveGhost(e.clientX, e.clientY);
      ghostEl!.style.display = "none";
      const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      ghostEl!.style.display = "";

      if (!hitEl) { clearHighlights(); hideTargetGhost(); return; }

      const sourceFolder = sourceFolderOf(dragPath);
      const entryLink = dragEntry!.querySelector("a");
      const entryName = entryLink ? entryLink.textContent! : dragPath.split("/").pop()!;

      const folder = hitEl.closest(".tree-folder") as HTMLElement | null;
      const root = hitEl.closest(".tree-root") as HTMLElement | null;

      if (folder && root && !root.dataset.readonly) {
        const fp = folderPath(folder);
        if (fp !== sourceFolder && fp !== dragPath) {
          if (currentDropTarget !== folder) {
            clearHighlights();
            hideTargetGhost();
            folder.classList.add("drag-over");
            currentDropTarget = folder;
            showTargetGhost(folder.querySelector("details") as HTMLElement || folder, entryName);
          }
          return;
        }
      }

      if (root && !root.dataset.readonly && sourceFolder !== "") {
        const overFolder = hitEl.closest(".tree-folder") as HTMLElement | null;
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

      if (currentDropTarget) { clearHighlights(); hideTargetGhost(); }
    }

    function onMouseUp() {
      if (!dragEntry) return;
      if (holdTimer !== null) { cancelDrag(); return; }
      if (!isDragging) { cancelDrag(); return; }

      let destination: string | null = null;
      const root = getTreeRoot(dragEntry);
      const lb = root ? root.dataset.lorebook || "" : "";

      if (currentDropTarget && currentDropTarget.classList.contains("drag-over")) {
        destination = folderPath(currentDropTarget);
      } else if (currentDropTarget && currentDropTarget.classList.contains("drag-over-root")) {
        destination = "";
      }

      const pathToMove = dragPath;
      cancelDrag();

      if (destination === null || !lb) return;

      fetch(`/api/lorebook/entry/move?lorebook=${encodeURIComponent(lb)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathToMove, destination }),
      }).then((res) => {
        if (res.ok) onMoved();
      }).catch(() => {});
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && (holdTimer !== null || isDragging)) cancelDrag();
    }

    function onDragStart(e: DragEvent) {
      if ((e.target as HTMLElement).closest?.(".tree-entry")) e.preventDefault();
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragstart", onDragStart);

    return () => {
      cancelDrag();
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, [lorebook, readonly, onMoved]);
}
