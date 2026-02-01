import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "../../api";
import type { LorebookEntry } from "../../types";

const MIME = "application/lorebook-path";

function hasType(types: DataTransfer["types"], mime: string) {
  // DOMStringList (Firefox dragover) has .contains(); frozen Array has .includes()
  return "includes" in types ? types.includes(mime) : (types as unknown as DOMStringList).contains(mime);
}

function pathToLabel(path: string): string {
  const filename = path.split("/").pop() || path;
  return filename.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PathBadge({ path, onRemove, readonly }: {
  path: string;
  onRemove?: () => void;
  readonly: boolean;
}) {
  const folder = path.includes("/") ? path.split("/")[0] : null;
  return (
    <span className="drop-badge" title={path}>
      {folder && <span className="drop-badge-folder">{folder}/</span>}
      <span className="drop-badge-name">{pathToLabel(path)}</span>
      {!readonly && onRemove && (
        <button type="button" className="drop-badge-x" onClick={onRemove}
          aria-label={`Remove ${pathToLabel(path)}`}>&times;</button>
      )}
    </span>
  );
}

function useDropZone(onDrop: (path: string) => void) {
  const [active, setActive] = useState(false);
  const enterCount = useRef(0);

  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasType(e.dataTransfer.types, MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragEnter: (e: React.DragEvent) => {
      if (!hasType(e.dataTransfer.types, MIME)) return;
      e.preventDefault();
      enterCount.current++;
      if (enterCount.current === 1) setActive(true);
    },
    onDragLeave: () => {
      enterCount.current--;
      if (enterCount.current === 0) setActive(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      enterCount.current = 0;
      setActive(false);
      const path = e.dataTransfer.getData(MIME);
      if (path) onDrop(path);
    },
  };

  return { active, handlers };
}

type Props = {
  lorebook: string;
  path: string;
  readonly: boolean;
  onSaved: () => void;
  onDeleted: () => void;
};

export function EntryForm({ lorebook, path, readonly, onSaved, onDeleted }: Props) {
  const [entry, setEntry] = useState<LorebookEntry>({
    name: "", content: "", keywords: [], regex: "", priority: 0, enabled: true, contexts: [],
  });
  const [isNew, setIsNew] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    api.fetchEntry(lorebook, path).then((data) => {
      setEntry(data.entry);
      setIsNew(data.isNew);
    });
  }, [lorebook, path]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const payload: LorebookEntry = {
        ...entry,
        keywords: typeof entry.keywords === "string"
          ? (entry.keywords as unknown as string).split(",").map((s) => s.trim()).filter(Boolean)
          : entry.keywords,
        contexts: typeof entry.contexts === "string"
          ? (entry.contexts as unknown as string).split(",").map((s) => s.trim()).filter(Boolean)
          : entry.contexts,
      };
      if (isNew) {
        await api.createEntry(lorebook, path, payload);
        setIsNew(false);
        setFeedback({ type: "success", msg: "Entry created." });
      } else {
        await api.saveEntry(lorebook, path, payload);
        setFeedback({ type: "success", msg: "Entry saved." });
      }
      onSaved();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to save" });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete entry '${entry.name}'?`)) return;
    await api.deleteEntry(lorebook, path);
    onDeleted();
  };

  const keywordsStr = Array.isArray(entry.keywords) ? entry.keywords.join(", ") : String(entry.keywords);
  const contextsStr = Array.isArray(entry.contexts) ? entry.contexts.join(", ") : String(entry.contexts);
  const isCharacter = path.startsWith("characters/");
  const isLocation = path.startsWith("locations/");

  const homeLocationDrop = useDropZone(useCallback((droppedPath: string) => {
    setEntry((prev) => ({ ...prev, homeLocation: droppedPath }));
  }, []));

  const charactersDrop = useDropZone(useCallback((droppedPath: string) => {
    setEntry((prev) => {
      const existing = Array.isArray(prev.characters) ? prev.characters : [];
      if (existing.includes(droppedPath)) return prev;
      return { ...prev, characters: [...existing, droppedPath] };
    });
  }, []));

  return (
    <>
      <h2>{path}{readonly ? " (Preset — Read Only)" : ""}</h2>
      {feedback && <div className={`feedback ${feedback.type}`}>{feedback.msg}</div>}
      <form onSubmit={handleSubmit}>
        <label htmlFor="lb-name">Name</label>
        <input id="lb-name" type="text" value={entry.name} required disabled={readonly}
          onChange={(e) => setEntry({ ...entry, name: e.target.value })} />

        <label htmlFor="lb-content">Content</label>
        <textarea id="lb-content" rows={8} value={entry.content} disabled={readonly}
          onChange={(e) => setEntry({ ...entry, content: e.target.value })} />

        <label htmlFor="lb-keywords">Keywords <span className="hint">(comma-separated)</span></label>
        <input id="lb-keywords" type="text" value={keywordsStr} disabled={readonly}
          onChange={(e) => setEntry({ ...entry, keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />

        <label htmlFor="lb-regex">Regex pattern <span className="hint">(leave empty for none)</span></label>
        <input id="lb-regex" type="text" value={entry.regex} disabled={readonly}
          onChange={(e) => setEntry({ ...entry, regex: e.target.value })} />

        <label htmlFor="lb-contexts">Contexts <span className="hint">(comma-separated entry paths or trait: refs)</span></label>
        <input id="lb-contexts" type="text" value={contextsStr} disabled={readonly}
          onChange={(e) => setEntry({ ...entry, contexts: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />

        {isCharacter && (
          <>
            <label>Home Location <span className="hint">(drag a location from the tree)</span></label>
            <div className={`drop-zone-field${homeLocationDrop.active ? " drop-zone-active" : ""}`}
              {...(readonly ? {} : homeLocationDrop.handlers)}>
              {entry.homeLocation ? (
                <PathBadge path={entry.homeLocation} readonly={readonly}
                  onRemove={() => setEntry((prev) => ({ ...prev, homeLocation: undefined }))} />
              ) : (
                <span className="drop-zone-placeholder">Drop a location here</span>
              )}
            </div>
          </>
        )}

        {isLocation && (
          <>
            <label>Characters <span className="hint">(drag characters from the tree)</span></label>
            <div className={`drop-zone-field${charactersDrop.active ? " drop-zone-active" : ""}`}
              {...(readonly ? {} : charactersDrop.handlers)}>
              {Array.isArray(entry.characters) && entry.characters.length > 0 && (
                <div className="drop-badge-list">
                  {entry.characters.map((ch) => (
                    <PathBadge key={ch} path={ch} readonly={readonly}
                      onRemove={() => setEntry((prev) => ({
                        ...prev, characters: (prev.characters || []).filter((c) => c !== ch),
                      }))} />
                  ))}
                </div>
              )}
              <span className="drop-zone-placeholder">
                {!entry.characters || entry.characters.length === 0 ? "Drop characters here" : "+ Drop more"}
              </span>
            </div>
          </>
        )}

        <label htmlFor="lb-priority">Priority: <strong>{entry.priority}</strong></label>
        <input id="lb-priority" type="number" value={entry.priority} disabled={readonly}
          onChange={(e) => setEntry({ ...entry, priority: Number(e.target.value) || 0 })} />

        <label>
          <input type="checkbox" checked={entry.enabled} disabled={readonly}
            onChange={(e) => setEntry({ ...entry, enabled: e.target.checked })} />
          Enabled
        </label>

        {!readonly && (
          <div className="editor-actions">
            <button type="submit">{isNew ? "Create" : "Save"}</button>
            {!isNew && (
              <button type="button" className="btn-danger" onClick={handleDelete}>Delete</button>
            )}
          </div>
        )}
      </form>
    </>
  );
}
