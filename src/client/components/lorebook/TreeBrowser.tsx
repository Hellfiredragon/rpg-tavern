import type { TreeNode } from "../../types";
import { useDragTree } from "./useDragTree";

type Props = {
  nodes: TreeNode[];
  lorebook: string;
  readonly: boolean;
  onSelect: (path: string) => void;
  onNew: (prefix: string) => void;
  onMoved: () => void;
};

export function TreeBrowser({ nodes, lorebook, readonly, onSelect, onNew, onMoved }: Props) {
  useDragTree(lorebook, readonly, onMoved);

  return (
    <div className="tree-root" data-lorebook={lorebook} data-readonly={readonly ? "true" : undefined}>
      {!readonly && (
        <button className="btn-sm btn-new-entry" data-prefix="" data-lorebook={lorebook}
          onClick={() => onNew("")}>+ New</button>
      )}
      {nodes.length === 0 ? (
        <p className="tree-empty">No entries yet.</p>
      ) : (
        <TreeLevel nodes={nodes} lorebook={lorebook} readonly={readonly} onSelect={onSelect} onNew={onNew} />
      )}
    </div>
  );
}

function TreeLevel({ nodes, lorebook, readonly, onSelect, onNew }: {
  nodes: TreeNode[];
  lorebook: string;
  readonly: boolean;
  onSelect: (path: string) => void;
  onNew: (prefix: string) => void;
}) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        if (node.isEntry && node.children.length === 0) {
          return (
            <li className="tree-entry" data-path={node.path} key={node.path}>
              <a href="#" onClick={(e) => { e.preventDefault(); onSelect(node.path); }}>{node.name}</a>
            </li>
          );
        }

        if (node.children.length > 0) {
          const folderPrefix = node.path + "/";
          return (
            <li className="tree-folder" data-path={node.path} key={node.path}>
              <details open>
                <summary>{node.isEntry ? node.path.split("/").pop() : node.name}/</summary>
                {node.isEntry && (
                  <ul className="tree-list">
                    <li className="tree-entry" data-path={node.path}>
                      <a href="#" onClick={(e) => { e.preventDefault(); onSelect(node.path); }}>{node.name}</a>
                    </li>
                  </ul>
                )}
                {!readonly && (
                  <button className="btn-sm btn-new-entry" data-prefix={folderPrefix} data-lorebook={lorebook}
                    onClick={() => onNew(folderPrefix)}>+ New</button>
                )}
                <TreeLevel nodes={node.children} lorebook={lorebook} readonly={readonly} onSelect={onSelect} onNew={onNew} />
              </details>
            </li>
          );
        }

        if (!node.isEntry) {
          // Empty folder
          const folderPrefix = node.path + "/";
          return (
            <li className="tree-folder" data-path={node.path} key={node.path}>
              <details>
                <summary>{node.name}/</summary>
                {!readonly && (
                  <button className="btn-sm btn-new-entry" data-prefix={folderPrefix} data-lorebook={lorebook}
                    onClick={() => onNew(folderPrefix)}>+ New</button>
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
