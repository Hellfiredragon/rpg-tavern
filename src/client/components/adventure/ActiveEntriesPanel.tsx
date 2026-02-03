import { useState, useEffect } from "react";
import * as api from "../../api";
import type { ActiveEntry } from "../../types";

type Props = {
  chatId: string;
  lorebook: string;
  refreshKey: number;
};

function pathToLabel(path: string): string {
  const filename = path.split("/").pop() || path;
  return filename.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ActiveEntriesPanel({ chatId, lorebook, refreshKey }: Props) {
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

  const handleGoalToggle = async (entry: ActiveEntry) => {
    const data = await api.toggleGoal(lorebook, entry.path, !entry.completed, chatId);
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

  const order = ["locations", "characters", "items", "goals"];
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
              const isGoal = e.category === "goals";
              const isCharacter = e.category === "characters";
              const isItem = e.category === "items";
              const preview = e.content.length > 80 ? e.content.slice(0, 80) + "..." : e.content;
              return (
                <div className="active-entry-item" key={e.path}>
                  {isGoal ? (
                    <label className="active-entry-goal">
                      <input type="checkbox" checked={!!e.completed}
                        onChange={() => handleGoalToggle(e)} />
                      <span className={`active-entry-name${e.completed ? " goal-completed" : ""}`}>
                        {e.name}
                      </span>
                    </label>
                  ) : (
                    <span className="active-entry-name">{e.name}</span>
                  )}
                  {isCharacter && e.state && e.state.length > 0 && (
                    <div className="active-entry-state">
                      {e.state.map((s) => (
                        <span className="state-tag" key={s}>{s}</span>
                      ))}
                    </div>
                  )}
                  {isCharacter && e.currentLocation && (
                    <span className="active-entry-location">at {pathToLabel(e.currentLocation)}</span>
                  )}
                  {isItem && e.location && (
                    <span className="active-entry-location">
                      {e.location === "player" ? "carried" : `at ${pathToLabel(e.location)}`}
                    </span>
                  )}
                  {isGoal && e.requirements && e.requirements.length > 0 && (
                    <span className="active-entry-preview">{e.requirements.join("; ")}</span>
                  )}
                  {!isGoal && <span className="active-entry-preview">{preview}</span>}
                </div>
              );
            })}
          </div>
        ))
      )}
    </aside>
  );
}
