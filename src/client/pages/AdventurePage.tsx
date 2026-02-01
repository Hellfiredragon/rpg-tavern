import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AdventurePicker } from "../components/adventure/AdventurePicker";
import { AdventurePlay } from "../components/adventure/AdventurePlay";
import { Dialog } from "../components/shared/Dialog";
import * as api from "../api";
import type { Adventure, Template } from "../types";

export function AdventurePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  // Play state
  const [playData, setPlayData] = useState<{ lorebook: string; chatId: string; name: string; location: string } | null>(null);

  // Dialog state
  const [startDialog, setStartDialog] = useState<{ source: string; label: string } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ slug: string; name: string } | null>(null);
  const [saveDialog, setSaveDialog] = useState<{ slug: string; name: string } | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const loadPicker = useCallback(async () => {
    const data = await api.fetchAdventures();
    setAdventures(data.adventures);
    setTemplates(data.templates);
  }, []);

  // Load picker data or resume adventure
  useEffect(() => {
    if (slug) {
      api.resumeAdventure(slug)
        .then((data) => setPlayData(data))
        .catch(() => navigate("/adventure", { replace: true }));
    } else {
      setPlayData(null);
      loadPicker();
    }
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
    setPlayData({ lorebook: advSlug, chatId, name, location: "" });
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
  };

  if (playData) {
    return <AdventurePlay {...playData} />;
  }

  return (
    <>
      <AdventurePicker
        adventures={adventures}
        templates={templates}
        onContinue={(adv) => {
          setPlayData({ lorebook: adv.slug, chatId: adv.latestChatId, name: adv.name, location: adv.currentLocation });
          navigate("/adventure/" + encodeURIComponent(adv.slug));
        }}
        onStart={(tpl) => { setStartDialog({ source: tpl.slug, label: tpl.name }); setDialogName(""); }}
        onDelete={(adv) => { setDeleteDialog({ slug: adv.slug, name: adv.name }); setDeleteConfirm(""); }}
        onSaveTemplate={(adv) => { setSaveDialog({ slug: adv.slug, name: adv.name }); setDialogName(""); }}
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

      {/* Delete dialog */}
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
    </>
  );
}
