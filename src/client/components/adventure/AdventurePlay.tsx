import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ActiveEntriesPanel } from "./ActiveEntriesPanel";
import { ExtractorIndicator } from "./ExtractorIndicator";
import { LorebookEditor } from "../lorebook/LorebookEditor";
import { sendMessageSSE } from "../../hooks/useSSE";
import * as api from "../../api";
import type { ActiveEntry, ChatMessage, LocationEntry, PipelineEvent } from "../../types";

type Props = {
  lorebook: string;
  chatId: string;
  name: string;
  location: string;
  entryPath?: string | null;
};

export function AdventurePlay({ lorebook, chatId: initialChatId, name, location: initialLocation, entryPath }: Props) {
  const navigate = useNavigate();
  const [chatId, setChatId] = useState(initialChatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [currentLocation, setCurrentLocation] = useState(initialLocation);
  const [input, setInput] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<"play" | "edit">("play");
  const [streaming, setStreaming] = useState(false);
  const [extractorRunning, setExtractorRunning] = useState(false);
  const [activeCharacters, setActiveCharacters] = useState<ActiveEntry[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // Load active characters (dialog partners)
  useEffect(() => {
    api.fetchActiveEntries(chatId)
      .then((data) => setActiveCharacters(data.entries.filter((e) => e.category === "characters")))
      .catch(() => {});
  }, [chatId, refreshKey]);

  // Location change via dropdown
  const handleLocationChange = async (loc: string) => {
    if (!loc) return;
    const data = await api.changeLocation(chatId, loc);
    setCurrentLocation(data.location);
    const sysMsg: ChatMessage = { role: "system", source: "system", content: data.narration, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, sysMsg]);
    setRefreshKey((k) => k + 1);
    setTimeout(scrollToBottom, 0);
  };

  // Delete message
  const handleDeleteMessage = async (msg: ChatMessage) => {
    if (!msg.id) return;
    const hasCommits = msg.commits && msg.commits.length > 0;
    if (hasCommits && !confirm("This will revert lorebook changes made by this message. Continue?")) return;

    try {
      await api.deleteMessage(chatId, msg.id);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      if (hasCommits) setRefreshKey((k) => k + 1);
    } catch {
      // ignore errors
    }
  };

  // Cancel in-flight generation
  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    api.cancelChat(chatId).catch(() => {}); // fire-and-forget server-side cancel
    // Remove empty streaming placeholders
    setMessages((prev) => prev.filter((m) => !m.id?.startsWith("streaming-") || m.content));
    setStreaming(false);
  };

  // Send message — uses SSE if backends are configured, falls back to JSON
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || streaming) return;
    setInput("");

    // Optimistic user message
    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setTimeout(scrollToBottom, 0);

    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);

    try {
      // Try SSE first
      let sseSucceeded = false;
      try {
        await sendMessageSSE(msg, chatId, lorebook, (event: PipelineEvent) => {
          sseSucceeded = true;
          switch (event.type) {
            case "step_start": {
              // Add placeholder for this step
              const placeholder: ChatMessage = {
                id: `streaming-${event.role}`,
                role: "assistant",
                source: event.role === "extractor" ? "extractor" : event.role,
                content: "",
                timestamp: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, placeholder]);
              setTimeout(scrollToBottom, 0);
              break;
            }
            case "step_token": {
              // Append token to current streaming message
              setMessages((prev) => {
                const streamId = `streaming-${event.role}`;
                const hasPlaceholder = prev.some((m: ChatMessage) => m.id === streamId);
                if (hasPlaceholder) {
                  return prev.map((m: ChatMessage) =>
                    m.id === streamId ? { ...m, content: m.content + event.token } : m
                  );
                }
                return prev;
              });
              setTimeout(scrollToBottom, 0);
              break;
            }
            case "step_complete": {
              // Replace placeholder with final message
              const finalMsg = event.message;
              if (!finalMsg.content) {
                // Empty content — remove the placeholder
                setMessages((prev) => prev.filter((m) => m.id !== `streaming-${event.role}`));
              } else {
                setMessages((prev) =>
                  prev.map((m) => m.id === `streaming-${event.role}` ? finalMsg : m)
                );
              }
              setTimeout(scrollToBottom, 0);
              break;
            }
            case "extractor_background": {
              if (event.status === "started") setExtractorRunning(true);
              else {
                setExtractorRunning(false);
                setRefreshKey((k) => k + 1);
              }
              break;
            }
            case "pipeline_complete": {
              if (event.location) {
                setCurrentLocation(event.location);
              }
              setRefreshKey((k) => k + 1);
              break;
            }
            case "pipeline_cancelled": {
              // Remove empty streaming placeholders, keep partial content
              setMessages((prev) => prev.filter((m) => !m.id?.startsWith("streaming-") || m.content));
              break;
            }
            case "pipeline_error": {
              const errorMsg: ChatMessage = {
                role: "system",
                source: "system",
                content: `[Error: ${event.error}]`,
                timestamp: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, errorMsg]);
              setTimeout(scrollToBottom, 0);
              break;
            }
          }
        }, ac.signal);
      } catch (sseErr: unknown) {
        // Abort is expected when user clicks Stop
        if (sseErr instanceof DOMException && sseErr.name === "AbortError") return;
        // SSE might fail if no backends configured — fall back to JSON
        if (!sseSucceeded) {
          const data = await api.sendMessage(msg, chatId, lorebook);
          if (data.chatId !== chatId) setChatId(data.chatId);
          const serverMsgs = data.messages.filter((m) => m.role !== "user");
          setMessages((prev) => [...prev, ...serverMsgs]);
          if (data.location) {
            setCurrentLocation(data.location);
          }
          setRefreshKey((k) => k + 1);
          setTimeout(scrollToBottom, 0);
        }
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
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
          onClick={() => {
            setMode((m) => {
              if (m === "edit") navigate(`/adventure/${encodeURIComponent(lorebook)}`, { replace: true });
              return m === "play" ? "edit" : "play";
            });
          }}
        >
          {mode === "play" ? "Edit" : "Play"}
        </button>
      </div>
      {mode === "play" && activeCharacters.length > 0 && (
        <div className="adventure-characters-bar">
          <span className="adventure-characters-label">Dialog:</span>
          {activeCharacters.map((c) => (
            <span key={c.path} className="adventure-character-tag">{c.name}</span>
          ))}
        </div>
      )}
      {mode === "play" ? (
        <div className="adventure-body">
          <div className="chat-container">
            <div className="chat-messages" ref={messagesRef}>
              {messages.length === 0 ? (
                <p className="editor-placeholder">Your adventure begins...</p>
              ) : (
                messages.map((msg, i) => (
                  <div key={msg.id || i} className={`chat-msg chat-msg-${msg.role}${msg.source ? ` chat-msg-source-${msg.source}` : ""}${msg.content.startsWith("[Error:") ? " chat-msg-error" : ""}`}>
                    {msg.source && msg.source !== "system" && msg.role === "assistant" && (
                      <span className={`chat-msg-source-badge chat-msg-source-${msg.source}`}>{msg.source}</span>
                    )}
                    <span className="chat-msg-content">
                      {msg.content}
                      {msg.id?.startsWith("streaming-") && <span className="streaming-cursor" />}
                    </span>
                    {msg.id && !msg.id.startsWith("streaming-") && msg.role !== "user" && (
                      <button
                        className="chat-msg-delete"
                        title={msg.commits?.length ? "Delete & revert lorebook changes" : "Delete message"}
                        onClick={() => handleDeleteMessage(msg)}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <form className="chat-input-area" onSubmit={handleSend}>
              <input type="text" placeholder="What do you do?" autoComplete="off" required
                value={input} onChange={(e) => setInput(e.target.value)} disabled={streaming} />
              {streaming ? (
                <button type="button" className="btn-stop" onClick={handleCancel}>Stop</button>
              ) : (
                <button type="submit">Send</button>
              )}
            </form>
          </div>
          <div className="active-entries-wrapper">
            {extractorRunning && <ExtractorIndicator />}
            <ActiveEntriesPanel chatId={chatId} lorebook={lorebook} refreshKey={refreshKey} />
          </div>
        </div>
      ) : (
        <LorebookEditor
          slug={lorebook}
          name={name}
          readonly={false}
          entryPath={entryPath || null}
          onBack={() => setMode("play")}
          hideHeader
        />
      )}
    </div>
  );
}
