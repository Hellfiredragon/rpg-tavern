import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { TreeBrowser } from "./TreeBrowser";
import { EntryForm } from "./EntryForm";
import { Dialog } from "../shared/Dialog";
import * as api from "../../api";
import type { TreeNode } from "../../types";

type Props = {
  slug: string;
  name: string;
  readonly: boolean;
  entryPath: string | null;
  onBack: () => void;
};

export function LorebookEditor({ slug, name, readonly, entryPath, onBack }: Props) {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [newDialog, setNewDialog] = useState<{ prefix: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [treeKey, setTreeKey] = useState(0);

  const refreshTree = useCallback(async () => {
    const data = await api.fetchTree(slug);
    setNodes(data.nodes);
  }, [slug]);

  useEffect(() => { refreshTree(); }, [refreshTree, treeKey]);

  const handleCreateEntry = () => {
    if (!newDialog) return;
    const n = newName.trim();
    if (!n) return;
    const path = newDialog.prefix + n;
    setNewDialog(null);
    setNewName("");
    navigate(`/lorebook/${encodeURIComponent(slug)}/${path}`, { replace: true });
  };

  const handleCreateFolder = async () => {
    if (!newDialog) return;
    const n = newName.trim();
    if (!n) return;
    const path = newDialog.prefix + n;
    setNewDialog(null);
    setNewName("");
    await api.createFolder(slug, path);
    setTreeKey((k) => k + 1);
  };

  return (
    <div id="lorebook-edit">
      <div className="lorebook-header-bar">
        <button className="btn-sm" onClick={onBack}>&larr;</button>
        <span>{name}{readonly ? " (Preset)" : ""}</span>
      </div>
      <div className="lorebook-container">
        <div className="lorebook-sidebar">
          <div className="lorebook-tree">
            <TreeBrowser
              nodes={nodes}
              lorebook={slug}
              readonly={readonly}
              onNew={(prefix) => { setNewDialog({ prefix }); setNewName(""); }}
            />
          </div>
        </div>
        <div className="lorebook-editor">
          {entryPath ? (
            <EntryForm
              key={entryPath}
              lorebook={slug}
              path={entryPath}
              readonly={readonly}
              onSaved={() => setTreeKey((k) => k + 1)}
              onDeleted={() => { navigate(`/lorebook/${encodeURIComponent(slug)}`, { replace: true }); setTreeKey((k) => k + 1); }}
            />
          ) : (
            <p className="editor-placeholder">
              {readonly ? "Select an entry from the tree to view it." : "Select an entry from the tree, or create a new one."}
            </p>
          )}
        </div>
      </div>

      <Dialog open={!!newDialog} onClose={() => setNewDialog(null)}>
        <form onSubmit={(e) => { e.preventDefault(); handleCreateEntry(); }}>
          <h3>Create New</h3>
          <label htmlFor="new-name">Path</label>
          <div className="path-input-group">
            {newDialog?.prefix && <span className="path-prefix">{newDialog.prefix}</span>}
            <input id="new-name" type="text" placeholder="e.g. gabrielle" required
              value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </div>
          <div className="editor-actions">
            <button type="submit">Create Entry</button>
            <button type="button" onClick={handleCreateFolder}>Create Folder</button>
            <button type="button" className="btn-cancel" onClick={() => setNewDialog(null)}>Cancel</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
