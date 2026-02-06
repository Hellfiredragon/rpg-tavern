import type { Adventure, Template } from "../../types";

type Props = {
  adventures: Adventure[];
  templates: Template[];
  onContinue: (adv: Adventure) => void;
  onStart: (tpl: Template) => void;
  onDelete: (adv: Adventure) => void;
  onSaveTemplate: (adv: Adventure) => void;
  onEditTemplate: (tpl: Template) => void;
  onCopyTemplate: (tpl: Template) => void;
  onDeleteTemplate: (tpl: Template) => void;
  onNewTemplate: () => void;
};

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function AdventurePicker({
  adventures, templates, onContinue, onStart, onDelete, onSaveTemplate,
  onEditTemplate, onCopyTemplate, onDeleteTemplate, onNewTemplate,
}: Props) {
  return (
    <div id="adventure-picker">
      {adventures.length > 0 ? (
        <>
          <h2>Your Adventures</h2>
          {adventures.map((adv) => (
            <div className="adventure-card" key={adv.slug} onDoubleClick={() => onContinue(adv)}>
              <div className="adventure-card-info">
                <span className="adventure-card-name">{adv.name}</span>
                <span className="adventure-card-meta">
                  Last played: {formatRelativeDate(adv.updatedAt)}
                  {adv.locationName ? ` · Location: ${adv.locationName}` : ""}
                </span>
              </div>
              <div className="adventure-card-actions">
                <button className="btn-sm" onClick={() => onContinue(adv)}>Continue</button>
                <button className="btn-sm" onClick={() => onSaveTemplate(adv)}>Save as Template</button>
                <button className="btn-sm btn-danger" onClick={() => onDelete(adv)}>Delete</button>
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <h2>Your Adventures</h2>
          <p className="editor-placeholder">No adventures yet. Start one from a template below!</p>
        </>
      )}

      {templates.length > 0 && (
        <>
          <h2>Templates</h2>
          {templates.map((tpl) => (
            <div className="adventure-card adventure-card-template" key={tpl.slug} onDoubleClick={() => tpl.preset ? onEditTemplate(tpl) : onEditTemplate(tpl)}>
              <span className="adventure-card-name">{tpl.name}</span>
              <div className="adventure-card-actions">
                <button className="btn-sm" onClick={() => onStart(tpl)}>Start</button>
                <button className="btn-sm" onClick={() => onEditTemplate(tpl)}>
                  {tpl.preset ? "View" : "Edit"}
                </button>
                {tpl.preset ? (
                  <button className="btn-sm" onClick={() => onCopyTemplate(tpl)}>Copy</button>
                ) : (
                  <button className="btn-sm btn-danger" onClick={() => onDeleteTemplate(tpl)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <button type="button" className="btn-sm" style={{ marginTop: "0.5rem" }} onClick={onNewTemplate}>+ Template</button>
    </div>
  );
}
