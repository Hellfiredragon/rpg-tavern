import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AdventurePicker } from "../components/adventure/AdventurePicker";
import { AdventurePlay } from "../components/adventure/AdventurePlay";
import { TemplateView } from "../components/adventure/TemplateView";
import { Dialog } from "../components/shared/Dialog";
import * as api from "../api";
import type { Adventure, Template } from "../types";

type Mode =
  | { type: "picker" }
  | { type: "adventure"; lorebook: string; chatId: string; name: string; location: string }
  | { type: "template"; slug: string; name: string; preset: boolean };

export function AdventurePage() {
  const { slug, "*": entryPath } = useParams<{ slug: string; "*": string }>();
  const navigate = useNavigate();

  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [mode, setMode] = useState<Mode>({ type: "picker" });

  // Dialog state
  const [startDialog, setStartDialog] = useState<{ source: string; label: string } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ slug: string; name: string } | null>(null);
  const [saveDialog, setSaveDialog] = useState<{ slug: string; name: string } | null>(null);
  const [newTemplateDialog, setNewTemplateDialog] = useState(false);
  const [copyDialog, setCopyDialog] = useState<{ source: string; label: string } | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const loadPicker = useCallback(async () => {
    const data = await api.fetchAdventures();
    setAdventures(data.adventures);
    setTemplates(data.templates);
  }, []);

  // Determine mode from URL
  useEffect(() => {
    if (!slug) {
      setMode({ type: "picker" });
      loadPicker();
      return;
    }
    // Fetch meta to determine if template or adventure
    api.fetchLorebookMeta(slug)
      .then((meta) => {
        if (meta.template) {
          setMode({ type: "template", slug: meta.slug, name: meta.name, preset: meta.preset });
        } else {
          // It's an adventure — resume it
          api.resumeAdventure(slug)
            .then((data) => setMode({ type: "adventure", lorebook: data.lorebook, chatId: data.chatId, name: data.name, location: data.location }))
            .catch(() => navigate("/adventure", { replace: true }));
        }
      })
      .catch(() => navigate("/adventure", { replace: true }));
  }, [slug, navigate, loadPicker]);

  // --- Start adventure from template ---
  const handleStart = async () => {
    if (!startDialog || !dialogName.trim()) return;
    const name = dialogName.trim();
    const advSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!advSlug) return;
    setStartDialog(null);
    setDialogName("");
    await api.copyLorebook(startDialog.source, advSlug, name);
    const { chatId } = await api.createChat(advSlug);
    navigate("/adventure/" + encodeURIComponent(advSlug));
  };

  // --- Delete adventure ---
  const handleDelete = async () => {
    if (!deleteDialog || deleteConfirm !== deleteDialog.name) return;
    setDeleteDialog(null);
    setDeleteConfirm("");
    await api.deleteAdventure(deleteDialog.slug);
    loadPicker();
  };

  // --- Save as template ---
  const handleSaveTemplate = async () => {
    if (!saveDialog || !dialogName.trim()) return;
    const name = dialogName.trim();
    const tplSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!tplSlug) return;
    setSaveDialog(null);
    setDialogName("");
    await api.makeTemplate(saveDialog.slug, tplSlug, name);
    loadPicker();
  };

  // --- Create new template ---
  const handleCreateTemplate = async () => {
    const name = dialogName.trim();
    if (!name) return;
    const tplSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!tplSlug) return;
    setNewTemplateDialog(false);
    setDialogName("");
    await api.createLorebook(tplSlug, name);
    navigate(`/adventure/${encodeURIComponent(tplSlug)}`);
  };

  // --- Copy template (presets) ---
  const handleCopyTemplate = async () => {
    if (!copyDialog) return;
    const name = dialogName.trim();
    if (!name) return;
    const tplSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!tplSlug) return;
    setCopyDialog(null);
    setDialogName("");
    await api.makeTemplate(copyDialog.source, tplSlug, name);
    navigate(`/adventure/${encodeURIComponent(tplSlug)}`);
  };

  // --- Adventure mode ---
  if (mode.type === "adventure") {
    return (
      <AdventurePlay
        lorebook={mode.lorebook}
        chatId={mode.chatId}
        name={mode.name}
        location={mode.location}
        entryPath={entryPath || null}
      />
    );
  }

  // --- Template mode ---
  if (mode.type === "template") {
    return (
      <>
        <TemplateView
          slug={mode.slug}
          name={mode.name}
          preset={mode.preset}
          entryPath={entryPath || null}
          onStart={() => { setStartDialog({ source: mode.slug, label: mode.name }); setDialogName(""); }}
        />

        {/* Start dialog */}
        <Dialog open={!!startDialog} onClose={() => setStartDialog(null)}>
          <form onSubmit={(e) => { e.preventDefault(); handleStart(); }}>
            <h3>Start Adventure</h3>
            {startDialog && <p className="hint">Template: {startDialog.label}</p>}
            <label htmlFor="adv-tpl-name">Adventure Name</label>
            <input id="adv-tpl-name" type="text" placeholder="e.g. My Key Quest" required
              value={dialogName} onChange={(e) => setDialogName(e.target.value)} autoFocus />
            <div className="editor-actions">
              <button type="submit">Start</button>
              <button type="button" className="btn-cancel" onClick={() => setStartDialog(null)}>Cancel</button>
            </div>
          </form>
        </Dialog>
      </>
    );
  }

  // --- Picker mode ---
  return (
    <>
      <AdventurePicker
        adventures={adventures}
        templates={templates}
        onContinue={(adv) => navigate("/adventure/" + encodeURIComponent(adv.slug))}
        onStart={(tpl) => { setStartDialog({ source: tpl.slug, label: tpl.name }); setDialogName(""); }}
        onDelete={(adv) => { setDeleteDialog({ slug: adv.slug, name: adv.name }); setDeleteConfirm(""); }}
        onSaveTemplate={(adv) => { setSaveDialog({ slug: adv.slug, name: adv.name }); setDialogName(""); }}
        onEditTemplate={(tpl) => navigate(`/adventure/${encodeURIComponent(tpl.slug)}`)}
        onCopyTemplate={(tpl) => { setCopyDialog({ source: tpl.slug, label: tpl.name }); setDialogName(""); }}
        onDeleteTemplate={async (tpl) => {
          if (confirm(`Delete template "${tpl.name}"?`)) {
            await api.deleteLorebook(tpl.slug);
            loadPicker();
          }
        }}
        onNewTemplate={() => { setNewTemplateDialog(true); setDialogName(""); }}
      />

      {/* Start dialog */}
      <Dialog open={!!startDialog} onClose={() => setStartDialog(null)}>
        <form onSubmit={(e) => { e.preventDefault(); handleStart(); }}>
          <h3>Start Adventure</h3>
          {startDialog && <p className="hint">Template: {startDialog.label}</p>}
          <label htmlFor="adv-tpl-name">Adventure Name</label>
          <input id="adv-tpl-name" type="text" placeholder="e.g. My Key Quest" required
            value={dialogName} onChange={(e) => setDialogName(e.target.value)} autoFocus />
          <div className="editor-actions">
            <button type="submit">Start</button>
            <button type="button" className="btn-cancel" onClick={() => setStartDialog(null)}>Cancel</button>
          </div>
        </form>
      </Dialog>

      {/* Delete adventure dialog */}
      <Dialog open={!!deleteDialog} onClose={() => setDeleteDialog(null)}>
        <form onSubmit={(e) => { e.preventDefault(); handleDelete(); }}>
          <h3>Delete Adventure</h3>
          <p>This will permanently delete the adventure and all its save data.</p>
          {deleteDialog && <p>Type <strong>{deleteDialog.name}</strong> to confirm:</p>}
          <input type="text" placeholder="Type adventure name..." autoComplete="off" required
            value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoFocus />
          <div className="editor-actions">
            <button type="submit" className="btn-danger" disabled={deleteDialog ? deleteConfirm !== deleteDialog.name : true}>Delete</button>
            <button type="button" className="btn-cancel" onClick={() => setDeleteDialog(null)}>Cancel</button>
          </div>
        </form>
      </Dialog>

      {/* Save as Template dialog */}
      <Dialog open={!!saveDialog} onClose={() => setSaveDialog(null)}>
        <form onSubmit={(e) => { e.preventDefault(); handleSaveTemplate(); }}>
          <h3>Save as Template</h3>
          {saveDialog && <p className="hint">Adventure: {saveDialog.name}</p>}
          <label htmlFor="save-tpl-name">Template Name</label>
          <input id="save-tpl-name" type="text" placeholder="e.g. My Template" required
            value={dialogName} onChange={(e) => setDialogName(e.target.value)} autoFocus />
          <div className="editor-actions">
            <button type="submit">Save</button>
            <button type="button" className="btn-cancel" onClick={() => setSaveDialog(null)}>Cancel</button>
          </div>
        </form>
      </Dialog>

      {/* New template dialog */}
      <Dialog open={newTemplateDialog} onClose={() => setNewTemplateDialog(false)}>
        <form onSubmit={(e) => { e.preventDefault(); handleCreateTemplate(); }}>
          <h3>New Template</h3>
          <label htmlFor="lb-new-name">Name</label>
          <input id="lb-new-name" type="text" placeholder="e.g. Fantasy Setting" required
            value={dialogName} onChange={(e) => setDialogName(e.target.value)} autoFocus />
          <div className="editor-actions">
            <button type="submit">Create</button>
            <button type="button" className="btn-cancel" onClick={() => setNewTemplateDialog(false)}>Cancel</button>
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
