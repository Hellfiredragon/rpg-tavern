import { useRef } from "react";
import { moveEntry } from "../../api";
import type { TreeNode } from "../../types";

type Props = {
  nodes: TreeNode[];
  lorebook: string;
  readonly: boolean;
  onSelect: (path: string) => void;
  onNew: (prefix: string) => void;
  onMoved: () => void;
};

const MIME = "application/lorebook-path";

function parentFolder(path: string) {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "";
}

export function TreeBrowser({ nodes, lorebook, readonly, onSelect, onNew, onMoved }: Props) {
  const draggedPathRef = useRef("");

  function handleDragStart(e: React.DragEvent, path: string) {
    draggedPathRef.current = path;
    e.dataTransfer.setData(MIME, path);
    e.dataTransfer.effectAllowed = "copyMove";
    (e.currentTarget as HTMLElement).closest(".tree-entry")?.classList.add("dragging");
  }

  function handleDragEnd(e: React.DragEvent) {
    draggedPathRef.current = "";
    (e.currentTarget as HTMLElement).closest(".tree-entry")?.classList.remove("dragging");
  }

  function canDropOnFolder(folderPath: string) {
    const dragged = draggedPathRef.current;
    if (!dragged) return false;
    if (dragged === folderPath) return false;
    if (parentFolder(dragged) === folderPath) return false;
    return true;
  }

  function handleFolderDragOver(e: React.DragEvent, folderPath: string) {
    if (!canDropOnFolder(folderPath)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleFolderDragEnter(e: React.DragEvent, folderPath: string) {
    if (!canDropOnFolder(folderPath)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).closest(".tree-folder")?.classList.add("drag-over");
  }

  function handleFolderDragLeave(e: React.DragEvent) {
    const folder = (e.currentTarget as HTMLElement).closest(".tree-folder");
    if (folder && !folder.contains(e.relatedTarget as Node)) {
      folder.classList.remove("drag-over");
    }
  }

  function handleFolderDrop(e: React.DragEvent, folderPath: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).closest(".tree-folder")?.classList.remove("drag-over");
    const path = e.dataTransfer.getData(MIME);
    if (!path || !canDropOnFolder(folderPath)) return;
    moveEntry(lorebook, path, folderPath).then(() => onMoved()).catch(() => {});
  }

  function canDropOnRoot() {
    const dragged = draggedPathRef.current;
    if (!dragged) return false;
    if (parentFolder(dragged) === "") return false;
    return true;
  }

  function handleRootDragOver(e: React.DragEvent) {
    if (!canDropOnRoot()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleRootDragEnter(e: React.DragEvent) {
    if (!canDropOnRoot()) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add("drag-over-root");
  }

  function handleRootDragLeave(e: React.DragEvent) {
    const root = e.currentTarget as HTMLElement;
    if (!root.contains(e.relatedTarget as Node)) {
      root.classList.remove("drag-over-root");
    }
  }

  function handleRootDrop(e: React.DragEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("drag-over-root");
    const path = e.dataTransfer.getData(MIME);
    if (!path || !canDropOnRoot()) return;
    moveEntry(lorebook, path, "").then(() => onMoved()).catch(() => {});
  }

  const rootDropProps = readonly ? {} : {
    onDragOver: handleRootDragOver,
    onDragEnter: handleRootDragEnter,
    onDragLeave: handleRootDragLeave,
    onDrop: handleRootDrop,
  };

  return (
    <div className="tree-root" data-lorebook={lorebook} {...rootDropProps}>
      {!readonly && (
        <button className="btn-sm btn-new-entry" data-prefix="" data-lorebook={lorebook}
          onClick={() => onNew("")}>+ New</button>
      )}
      {nodes.length === 0 ? (
        <p className="tree-empty">No entries yet.</p>
      ) : (
        <TreeLevel
          nodes={nodes}
          lorebook={lorebook}
          readonly={readonly}
          onSelect={onSelect}
          onNew={onNew}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragEnter={handleFolderDragEnter}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
        />
      )}
    </div>
  );
}

type TreeLevelProps = {
  nodes: TreeNode[];
  lorebook: string;
  readonly: boolean;
  onSelect: (path: string) => void;
  onNew: (prefix: string) => void;
  onDragStart: (e: React.DragEvent, path: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onFolderDragOver: (e: React.DragEvent, folderPath: string) => void;
  onFolderDragEnter: (e: React.DragEvent, folderPath: string) => void;
  onFolderDragLeave: (e: React.DragEvent) => void;
  onFolderDrop: (e: React.DragEvent, folderPath: string) => void;
};

function EntryLink({ node, readonly, onSelect, onDragStart, onDragEnd }: {
  node: TreeNode;
  readonly: boolean;
  onSelect: (path: string) => void;
  onDragStart: (e: React.DragEvent, path: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  return (
    <a
      href="#"
      draggable={!readonly}
      onClick={(e) => { e.preventDefault(); onSelect(node.path); }}
      onDragStart={readonly ? undefined : (e) => onDragStart(e, node.path)}
      onDragEnd={readonly ? undefined : onDragEnd}
    >
      {node.name}
      <span className="tree-path">{node.path}</span>
    </a>
  );
}

function TreeLevel({ nodes, lorebook, readonly, onSelect, onNew, onDragStart, onDragEnd, onFolderDragOver, onFolderDragEnter, onFolderDragLeave, onFolderDrop }: TreeLevelProps) {
  const dragProps = { onDragStart, onDragEnd };
  const folderDropProps = { onFolderDragOver, onFolderDragEnter, onFolderDragLeave, onFolderDrop };

  return (
    <ul className="tree-list">
      {nodes.map((node) => {
        if (node.isEntry && node.children.length === 0) {
          return (
            <li className="tree-entry" data-path={node.path} key={node.path}>
              <EntryLink node={node} readonly={readonly} onSelect={onSelect} {...dragProps} />
            </li>
          );
        }

        if (node.children.length > 0) {
          const folderPrefix = node.path + "/";
          const summaryDropHandlers = readonly ? {} : {
            onDragOver: (e: React.DragEvent) => folderDropProps.onFolderDragOver(e, node.path),
            onDragEnter: (e: React.DragEvent) => folderDropProps.onFolderDragEnter(e, node.path),
            onDragLeave: (e: React.DragEvent) => folderDropProps.onFolderDragLeave(e),
            onDrop: (e: React.DragEvent) => folderDropProps.onFolderDrop(e, node.path),
          };
          return (
            <li className="tree-folder" data-path={node.path} key={node.path}>
              <details open>
                <summary {...summaryDropHandlers}>
                  {node.isEntry ? node.path.split("/").pop() : node.name}/
                </summary>
                {node.isEntry && (
                  <ul className="tree-list">
                    <li className="tree-entry" data-path={node.path}>
                      <EntryLink node={node} readonly={readonly} onSelect={onSelect} {...dragProps} />
                    </li>
                  </ul>
                )}
                {!readonly && (
                  <button className="btn-sm btn-new-entry" data-prefix={folderPrefix} data-lorebook={lorebook}
                    onClick={() => onNew(folderPrefix)}>+ New</button>
                )}
                <TreeLevel nodes={node.children} lorebook={lorebook} readonly={readonly} onSelect={onSelect} onNew={onNew}
                  {...dragProps} {...folderDropProps} />
              </details>
            </li>
          );
        }

        if (!node.isEntry) {
          const folderPrefix = node.path + "/";
          const summaryDropHandlers = readonly ? {} : {
            onDragOver: (e: React.DragEvent) => folderDropProps.onFolderDragOver(e, node.path),
            onDragEnter: (e: React.DragEvent) => folderDropProps.onFolderDragEnter(e, node.path),
            onDragLeave: (e: React.DragEvent) => folderDropProps.onFolderDragLeave(e),
            onDrop: (e: React.DragEvent) => folderDropProps.onFolderDrop(e, node.path),
          };
          return (
            <li className="tree-folder" data-path={node.path} key={node.path}>
              <details>
                <summary {...summaryDropHandlers}>{node.name}/</summary>
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
