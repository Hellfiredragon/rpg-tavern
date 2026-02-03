import type { Template } from "../../types";

type Props = {
  templates: Template[];
  onEdit: (lb: Template) => void;
  onView: (lb: Template) => void;
  onCopy: (lb: Template) => void;
  onDelete: (lb: Template) => void;
  onNewTemplate: () => void;
};

export function LorebookPicker({ templates, onEdit, onView, onCopy, onDelete, onNewTemplate }: Props) {
  return (
    <div id="lorebook-picker">
      <h2>Templates</h2>
      {templates.length > 0 ? (
        templates.map((lb) => (
          <div className="adventure-card adventure-card-template" key={lb.slug}>
            <span className="adventure-card-name">{lb.name}</span>
            <div className="adventure-card-actions">
              <button className="btn-sm" onClick={() => lb.preset ? onView(lb) : onEdit(lb)}>
                {lb.preset ? "View" : "Edit"}
              </button>
              {lb.preset ? (
                <button className="btn-sm" onClick={() => onCopy(lb)}>Copy</button>
              ) : (
                <button className="btn-sm btn-danger" onClick={() => onDelete(lb)}>Delete</button>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="editor-placeholder">No templates yet.</p>
      )}

      <button type="button" className="btn-sm" style={{ marginTop: "0.5rem" }} onClick={onNewTemplate}>+ Template</button>
    </div>
  );
}
