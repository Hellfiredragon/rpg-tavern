import { useNavigate } from "react-router-dom";
import { LorebookEditor } from "../lorebook/LorebookEditor";

type Props = {
  slug: string;
  name: string;
  preset: boolean;
  entryPath: string | null;
  onStart: () => void;
};

export function TemplateView({ slug, name, preset, entryPath, onStart }: Props) {
  const navigate = useNavigate();

  return (
    <div id="adventure-play" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="adventure-location-bar">
        <button className="btn-sm" onClick={() => navigate("/adventure")}>&larr;</button>
        <span className="adventure-name">{name}{preset ? " (Preset)" : ""}</span>
        <button className="btn-sm btn-mode-toggle" onClick={onStart}>Start Adventure</button>
      </div>
      <LorebookEditor
        slug={slug}
        name={name}
        readonly={preset}
        entryPath={entryPath}
        onBack={() => navigate("/adventure")}
        hideHeader
      />
    </div>
  );
}
