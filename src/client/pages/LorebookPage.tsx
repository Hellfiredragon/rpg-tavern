import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { LorebookPicker } from "../components/lorebook/LorebookPicker";
import { LorebookEditor } from "../components/lorebook/LorebookEditor";
import { Dialog } from "../components/shared/Dialog";
import * as api from "../api";
import type { Template } from "../types";

export function LorebookPage() {
  const { slug, "*": entryPath } = useParams<{ slug: string; "*": string }>();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<Template[]>([]);

  // Editor state
  const [editorMeta, setEditorMeta] = useState<{ slug: string; name: string; preset: boolean } | null>(null);

  // Dialog state
  const [newDialog, setNewDialog] = useState(false);
  const [copyDialog, setCopyDialog] = useState<{ source: string; label: string } | null>(null);
  const [dialogName, setDialogName] = useState("");

  const loadPicker = useCallback(async () => {
    const data = await api.fetchLorebooks();
    setTemplates(data.templates);
  }, []);

  useEffect(() => {
    if (slug) {
      api.fetchLorebookMeta(slug)
        .then((data) => setEditorMeta({ slug: data.slug, name: data.name, preset: data.preset }))
        .catch(() => navigate("/lorebook", { replace: true }));
    } else {
      setEditorMeta(null);
      loadPicker();
    }
  }, [slug, navigate, loadPicker]);

  const handleCreateTemplate = async () => {
    const name = dialogName.trim();
    if (!name) return;
    const tplSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!tplSlug) return;
    setNewDialog(false);
    setDialogName("");
    await api.createLorebook(tplSlug, name);
    setEditorMeta({ slug: tplSlug, name, preset: false });
    navigate(`/lorebook/${encodeURIComponent(tplSlug)}`);
  };

  const handleCopyTemplate = async () => {
    if (!copyDialog) return;
    const name = dialogName.trim();
    if (!name) return;
    const tplSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!tplSlug) return;
    setCopyDialog(null);
    setDialogName("");
    await api.makeTemplate(copyDialog.source, tplSlug, name);
    setEditorMeta({ slug: tplSlug, name, preset: false });
    navigate(`/lorebook/${encodeURIComponent(tplSlug)}`);
  };

  if (editorMeta) {
    return (
      <LorebookEditor
        slug={editorMeta.slug}
        name={editorMeta.name}
        readonly={editorMeta.preset}
        entryPath={entryPath || null}
        onBack={() => navigate("/lorebook")}
      />
    );
  }

  return (
    <>
      <LorebookPicker
        templates={templates}
        onEdit={(lb) => {
          setEditorMeta({ slug: lb.slug, name: lb.name, preset: false });
          navigate(`/lorebook/${encodeURIComponent(lb.slug)}`);
        }}
        onView={(lb) => {
          setEditorMeta({ slug: lb.slug, name: lb.name, preset: true });
          navigate(`/lorebook/${encodeURIComponent(lb.slug)}`);
        }}
        onCopy={(lb) => { setCopyDialog({ source: lb.slug, label: lb.name }); setDialogName(""); }}
        onDelete={async (lb) => {
          if (confirm(`Delete template "${lb.name}"?`)) {
            await api.deleteLorebook(lb.slug);
            loadPicker();
          }
        }}
        onNewTemplate={() => { setNewDialog(true); setDialogName(""); }}
      />

      {/* New template dialog */}
      <Dialog open={newDialog} onClose={() => setNewDialog(false)}>
        <form onSubmit={(e) => { e.preventDefault(); handleCreateTemplate(); }}>
          <h3>New Template</h3>
          <label htmlFor="lb-new-name">Name</label>
          <input id="lb-new-name" type="text" placeholder="e.g. Fantasy Setting" required
            value={dialogName} onChange={(e) => setDialogName(e.target.value)} autoFocus />
          <div className="editor-actions">
            <button type="submit">Create</button>
            <button type="button" className="btn-cancel" onClick={() => setNewDialog(false)}>Cancel</button>
          </div>
        </form>
      </Dialog>

      {/* Copy template dialog */}
      <Dialog open={!!copyDialog} onClose={() => setCopyDialog(null)}>
        <form onSubmit={(e) => { e.preventDefault(); handleCopyTemplate(); }}>
          <h3>Copy Template</h3>
          {copyDialog && <p className="hint">Copying: {copyDialog.label}</p>}
          <label htmlFor="lb-copy-name">New Template Name</label>
          <input id="lb-copy-name" type="text" placeholder="e.g. My Custom Template" required
            value={dialogName} onChange={(e) => setDialogName(e.target.value)} autoFocus />
          <div className="editor-actions">
            <button type="submit">Copy</button>
            <button type="button" className="btn-cancel" onClick={() => setCopyDialog(null)}>Cancel</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
