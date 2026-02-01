import { useState, useEffect } from "react";
import * as api from "../../api";
import type { ActiveEntry } from "../../types";

type Props = {
  chatId: string;
  refreshKey: number;
};

export function ActiveEntriesPanel({ chatId, refreshKey }: Props) {
  const [traits, setTraits] = useState<string[]>([]);
  const [entries, setEntries] = useState<ActiveEntry[]>([]);
  const [newTrait, setNewTrait] = useState("");

  useEffect(() => {
    api.fetchActiveEntries(chatId)
      .then((data) => { setTraits(data.traits); setEntries(data.entries); })
      .catch(() => {});
  }, [chatId, refreshKey]);

  const removeTrait = async (trait: string) => {
    const updated = traits.filter((t) => t !== trait);
    const data = await api.updateTraits(chatId, updated);
    setTraits(data.traits);
    setEntries(data.entries);
  };

  const addTrait = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTrait.trim()) return;
    const updated = [...traits, newTrait.trim()];
    setNewTrait("");
    const data = await api.updateTraits(chatId, updated);
    setTraits(data.traits);
    setEntries(data.entries);
  };

  // Group entries by category
  const groups = new Map<string, ActiveEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.category) || [];
    list.push(e);
    groups.set(e.category, list);
  }

  const order = ["locations", "characters", "items"];
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  return (
    <aside className="active-entries-panel">
      <h3>Active Lore</h3>
      <div className="active-entries-traits">
        <h4>Traits</h4>
        <div className="trait-tags">
          {traits.map((trait) => (
            <span className="trait-tag" key={trait}>
              {trait}
              <button onClick={() => removeTrait(trait)}>&times;</button>
            </span>
          ))}
        </div>
        <form className="trait-add-form" onSubmit={addTrait}>
          <input type="text" className="trait-add-input" placeholder="Add trait..."
            value={newTrait} onChange={(e) => setNewTrait(e.target.value)} />
          <button type="submit" className="btn-sm">+</button>
        </form>
      </div>
      {entries.length === 0 ? (
        <p className="active-entries-empty">No active entries.</p>
      ) : (
        sortedKeys.map((key) => (
          <div className="active-entries-group" key={key}>
            <h4>{key}</h4>
            {groups.get(key)!.map((e) => {
              const preview = e.content.length > 80 ? e.content.slice(0, 80) + "..." : e.content;
              return (
                <div className="active-entry-item" key={e.path}>
                  <span className="active-entry-name">{e.name}</span>
                  <span className="active-entry-preview">{preview}</span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </aside>
  );
}
