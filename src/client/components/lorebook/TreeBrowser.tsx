import { useRef, useEffect } from "react";
import { NavLink } from "react-router-dom";
import type { TreeNode } from "../../types";

const MIME = "application/lorebook-path";

type Props = {
  nodes: TreeNode[];
  lorebook: string;
  readonly: boolean;
  onNew: (prefix: string) => void;
};

export function TreeBrowser({ nodes, lorebook, readonly, onNew }: Props) {
  return (
    <div className="tree-root" data-lorebook={lorebook}>
      {!readonly && (
        <button className="btn-sm btn-new-entry" onClick={() => onNew("")}>+ New</button>
      )}
      {nodes.length === 0 ? (
        <p className="tree-empty">No entries yet.</p>
      ) : (
        <TreeLevel nodes={nodes} lorebook={lorebook} readonly={readonly} onNew={onNew} />
      )}
    </div>
  );
}

function EntryLink({ path, name, lorebook, readonly }: {
  path: string;
  name: string;
  lorebook: string;
  readonly: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const href = `/adventure/${encodeURIComponent(lorebook)}/${path}`;

  useEffect(() => {
    if (readonly) return;
    const el = ref.current;
    if (!el) return;
    function onDragStart(e: DragEvent) {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData("text/plain", path);
      e.dataTransfer.setData(MIME, path);
      e.dataTransfer.effectAllowed = "copyMove";
    }
    el.addEventListener("dragstart", onDragStart);
    return () => el.removeEventListener("dragstart", onDragStart);
  }, [path, readonly]);

  return (
    <NavLink
      ref={ref}
      className={({ isActive }) => "tree-link" + (isActive ? " tree-link-active" : "")}
      to={href}
      replace
    >
      {name}
      <span className="tree-path">{path}</span>
    </NavLink>
  );
}

function TreeLevel({ nodes, lorebook, readonly, onNew }: {
  nodes: TreeNode[];
  lorebook: string;
  readonly: boolean;
  onNew: (prefix: string) => void;
}) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        // Leaf entry — no children
        if (node.isEntry && node.children.length === 0) {
          return (
            <li className="tree-entry" key={node.path}>
              <EntryLink path={node.path} name={node.name} lorebook={lorebook} readonly={readonly} />
            </li>
          );
        }

        // Folder with children (may also be an entry itself)
        if (node.children.length > 0) {
          const folderPrefix = node.path + "/";
          return (
            <li className="tree-folder" key={node.path}>
              <details open>
                <summary>{node.isEntry ? node.path.split("/").pop() : node.name}/</summary>
                {node.isEntry && (
                  <ul className="tree-list">
                    <li className="tree-entry">
                      <EntryLink path={node.path} name={node.name} lorebook={lorebook} readonly={readonly} />
                    </li>
                  </ul>
                )}
                {!readonly && (
                  <button className="btn-sm btn-new-entry" onClick={() => onNew(folderPrefix)}>+ New</button>
                )}
                <TreeLevel nodes={node.children} lorebook={lorebook} readonly={readonly} onNew={onNew} />
              </details>
            </li>
          );
        }

        // Empty folder
        if (!node.isEntry) {
          const folderPrefix = node.path + "/";
          return (
            <li className="tree-folder" key={node.path}>
              <details>
                <summary>{node.name}/</summary>
                {!readonly && (
                  <button className="btn-sm btn-new-entry" onClick={() => onNew(folderPrefix)}>+ New</button>
                )}
                <p className="tree-empty">Empty folder</p>
              </details>
            </li>
          );
        }

        return null;
      })}
    </ul>
  );
}
