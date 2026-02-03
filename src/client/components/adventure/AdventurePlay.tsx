import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ActiveEntriesPanel } from "./ActiveEntriesPanel";
import { LorebookEditor } from "../lorebook/LorebookEditor";
import * as api from "../../api";
import type { ChatMessage, LocationEntry } from "../../types";

type Props = {
  lorebook: string;
  chatId: string;
  name: string;
  location: string;
};

export function AdventurePlay({ lorebook, chatId: initialChatId, name, location: initialLocation }: Props) {
  const navigate = useNavigate();
  const [chatId, setChatId] = useState(initialChatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [currentLocation, setCurrentLocation] = useState(initialLocation);
  const [input, setInput] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<"play" | "edit">("play");
  const messagesRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, []);

  // Load messages
  useEffect(() => {
    api.fetchMessages(chatId).then((data) => {
      setMessages(data.messages);
      setTimeout(scrollToBottom, 0);
    });
  }, [chatId, scrollToBottom]);

  // Load locations
  useEffect(() => {
    api.fetchLocations(lorebook).then(setLocations);
  }, [lorebook, refreshKey]);

  // Location change via dropdown
  const handleLocationChange = async (loc: string) => {
    if (!loc) return;
    const data = await api.changeLocation(chatId, loc);
    setCurrentLocation(data.location);
    const sysMsg: ChatMessage = { role: "system", content: data.narration, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, sysMsg]);
    setRefreshKey((k) => k + 1);
    setTimeout(scrollToBottom, 0);
  };

  // Send message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg) return;
    setInput("");

    // Optimistic user message
    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setTimeout(scrollToBottom, 0);

    const data = await api.sendMessage(msg, chatId, lorebook);
    if (data.chatId !== chatId) setChatId(data.chatId);

    // Append server messages (skip the user message we already added)
    const serverMsgs = data.messages.filter((m) => m.role !== "user");
    setMessages((prev) => [...prev, ...serverMsgs]);

    if (data.location) {
      setCurrentLocation(data.location);
      setRefreshKey((k) => k + 1);
    }
    setRefreshKey((k) => k + 1);
    setTimeout(scrollToBottom, 0);
  };

  return (
    <div id="adventure-play" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="adventure-location-bar">
        <button className="btn-sm" onClick={() => navigate("/adventure")}>&larr;</button>
        <span className="adventure-name">{name}</span>
        <select value={currentLocation} onChange={(e) => handleLocationChange(e.target.value)}>
          <option value="">-- Choose a location --</option>
          {locations.map((loc) => (
            <option key={loc.path} value={loc.path}>{loc.name}</option>
          ))}
        </select>
        <button
          className={`btn-sm btn-mode-toggle${mode === "edit" ? " btn-mode-active" : ""}`}
          onClick={() => setMode((m) => m === "play" ? "edit" : "play")}
        >
          {mode === "play" ? "Edit" : "Play"}
        </button>
      </div>
      {mode === "play" ? (
        <div className="adventure-body">
          <div className="chat-container">
            <div className="chat-messages" ref={messagesRef}>
              {messages.length === 0 ? (
                <p className="editor-placeholder">Your adventure begins...</p>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`chat-msg chat-msg-${msg.role}`}>{msg.content}</div>
                ))
              )}
            </div>
            <form className="chat-input-area" onSubmit={handleSend}>
              <input type="text" placeholder="What do you do?" autoComplete="off" required
                value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="submit">Send</button>
            </form>
          </div>
          <ActiveEntriesPanel chatId={chatId} lorebook={lorebook} refreshKey={refreshKey} />
        </div>
      ) : (
        <LorebookEditor
          slug={lorebook}
          name={name}
          readonly={false}
          entryPath={null}
          onBack={() => setMode("play")}
        />
      )}
    </div>
  );
}
