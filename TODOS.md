# RPG Tavern - SillyTavern Feature Parity TODOs

What's already built: Lorebook CRUD with tree/matching engine, basic settings
(provider/model/temperature), chat UI skeleton (placeholder responses), dark
fantasy theme with HTMX, template lorebooks, path traversal protection.

---

## Phase 1: Core Chat (MVP)

### 1.1 LLM Integration
- [x] OpenAI-compatible API client (streaming via SSE)
- [x] KoboldCpp API client (text completion + streaming)
- [x] Multi-backend abstraction with configurable pipeline (narrator → character → extractor)
- [x] Token-by-token response rendering in the chat UI (SSE events)
- [x] Backend configuration UI in settings (add/remove backends, assign to pipeline steps)
- [x] Concurrency control via per-backend slot semaphores
- [ ] Abort/cancel in-flight generation (stop button)
- [ ] Error handling (rate limits, invalid key, network failures) — basic error messages shown

### 1.2 Chat History Persistence
- [x] Save chat messages to disk (JSONL format, one file per conversation)
- [x] Load chat history on page load
- [x] Multiple conversations per character (create new / switch / delete)
- [x] Chat list sidebar or selector

### 1.3 Character Cards
- [ ] Character data model (name, description, personality, scenario, first_message, example_messages, avatar)
- [ ] Character CRUD API + editor UI
- [ ] Character list with avatars and search
- [ ] Character avatar upload and display
- [ ] Character selector in chat view
- [ ] First message display on new conversation
- [ ] Character-bound lorebook attachment

### 1.4 Prompt Construction
- [x] System prompt assembly with world context (active lorebook entries, location, characters, items, goals, traits)
- [x] Narrator prompt construction (story continuation, scene description)
- [x] Character prompt construction (in-character dialog from NPCs at location)
- [x] Extractor prompt construction with tool definitions for lorebook mutations
- [ ] User persona description injection
- [ ] Message history truncation to fit context window
- [ ] Token counting (per-message and total)

---

## Phase 2: Essential Chat Features

### 2.1 Message Actions
- [ ] Edit any message (user or assistant) inline
- [x] Delete individual messages (with git revert for extractor changes)
- [ ] Regenerate last assistant response
- [ ] Continue/extend last assistant response
- [ ] Impersonate (AI writes a message as the user)

### 2.2 Swipe System
- [ ] Store multiple alternative responses per assistant message
- [ ] Navigate alternatives with left/right arrows
- [ ] Swipe counter display (e.g. "2/5")

### 2.3 User Personas
- [ ] Persona data model (name, description, avatar)
- [ ] Persona CRUD + management UI
- [ ] Persona selector in chat
- [ ] Inject active persona description into prompt

### 2.4 Author's Note
- [ ] Configurable text injected at a set depth in the prompt
- [ ] Per-conversation author's note field
- [ ] Depth and frequency controls

---

## Phase 3: Advanced Prompt & Context

### 3.1 Prompt Template System
- [ ] Context template (story string) with Handlebars-style variables
  (`{{description}}`, `{{personality}}`, `{{scenario}}`, `{{persona}}`,
  `{{mesExamples}}`, `{{char}}`, `{{user}}`)
- [ ] Template editor UI with save/load/reset
- [ ] Instruct mode templates (system/user/assistant wrapping prefixes/suffixes)
- [ ] Prompt manager: drag-and-drop ordering of prompt segments
- [ ] Per-segment enable/disable and token budget display

### 3.2 Generation Presets
- [ ] Named preset collections (temperature, top_p, top_k, min_p, repetition_penalty, frequency_penalty, presence_penalty)
- [ ] Preset selector dropdown
- [ ] Preset CRUD (create, edit, delete, duplicate)
- [ ] Import/export presets as JSON

### 3.3 Lorebook Enhancements
- [ ] Secondary/optional keywords (AND logic with primary)
- [ ] Always-active (constant) entries
- [ ] Scan depth setting (how many recent messages to scan)
- [ ] Token budget for world info injection
- [ ] Insertion position options (before/after char defs, at depth N)
- [ ] Recursive scanning (entries activating other entries)
- [ ] Per-entry: case sensitivity toggle, whole-word match, probability, sticky, cooldown
- [ ] Import/export lorebooks as JSON files
- [ ] Embedded lorebook in character cards

---

## Phase 4: Group Chat

### 4.1 Group Management
- [ ] Create groups with multiple character members
- [ ] Group list and selector
- [ ] Group-specific scenario override
- [ ] Mute/unmute individual members

### 4.2 Turn Order
- [ ] Natural order (mentions-based)
- [ ] List order (sequential)
- [ ] Random order
- [ ] Manual mode (user picks who responds)
- [ ] Per-character talkativeness factor

### 4.3 Group Chat UI
- [ ] Character avatars next to messages
- [ ] Trigger specific character to respond
- [ ] Auto-mode (continuous AI conversation with delay)
- [ ] Joined character card context in prompt

---

## Phase 5: Additional API Backends

- [ ] Google Gemini API client
- [ ] Ollama local model client
- [x] KoboldAI / KoboldCPP client
- [ ] llama.cpp direct client
- [x] Generic OpenAI-compatible endpoint (custom URL)
- [ ] OpenRouter support
- [ ] Connection profiles (save/switch API + model + template combos)
- [ ] Model list auto-fetch from provider

---

## Phase 6: UI/UX Polish

### 6.1 Theming
- [ ] Theme data model (colors, fonts, layout options)
- [ ] Theme selector with save/load/switch
- [ ] Custom CSS injection per theme
- [ ] Background image selection for chat

### 6.2 Layout Options
- [ ] Chat width slider (25-100%)
- [ ] Avatar shape options (circle, square, rounded)
- [ ] Message style variants (flat, bubble, document)
- [ ] Timestamps on messages
- [ ] Token count display per message

### 6.3 Markdown & Formatting
- [ ] Markdown rendering in assistant messages (bold, italic, headers, lists)
- [ ] Code block syntax highlighting
- [ ] Blockquote styling
- [ ] Markdown toolbar/hotkeys in chat input

### 6.4 Responsive & Mobile
- [ ] Mobile-friendly drawer navigation
- [ ] Touch-friendly swipe gestures
- [ ] Collapsible sidebar panels

---

## Phase 7: Data Management

### 7.1 Character Import/Export
- [ ] Import character from JSON file
- [ ] Export character as JSON
- [ ] PNG-embedded character metadata (read/write EXIF)
- [ ] Import from URL (Chub.ai format)

### 7.2 Chat Export
- [ ] Export conversation as plain text
- [ ] Export conversation as JSONL

### 7.3 Backups
- [ ] Settings snapshot save/restore
- [ ] Full data backup (download as archive)
- [ ] Auto-backup with configurable interval

---

## Phase 8: Extensions & Integrations

### 8.1 Image Generation
- [ ] Stable Diffusion WebUI (Automatic1111) API integration
- [ ] ComfyUI API integration
- [ ] `/imagine` command to generate images in chat
- [ ] Image display in message bubbles

### 8.2 TTS (Text-to-Speech)
- [ ] Browser SpeechSynthesis API (system TTS)
- [ ] OpenAI TTS integration
- [ ] Edge TTS integration
- [ ] Per-character voice mapping
- [ ] Auto-play on new messages toggle

### 8.3 STT (Speech-to-Text)
- [ ] Browser SpeechRecognition API
- [ ] Whisper API integration
- [ ] Microphone button in chat input

### 8.4 Web Search
- [ ] Search integration to inject web results into prompt context
- [ ] Configurable search provider

### 8.5 RAG / Vector Storage
- [ ] Chat message vectorization (embeddings)
- [ ] Semantic search over old messages beyond context window
- [ ] Data Bank: attach files as knowledge sources
- [ ] Chunking and retrieval for large documents

---

## Phase 9: Power User Features

### 9.1 Slash Commands
- [ ] Command parser for `/command arg` syntax in chat input
- [ ] Built-in commands: `/sys` (system message), `/trigger`, `/translate`, `/imagine`
- [ ] Quick Replies (configurable buttons above chat input that run commands)
- [ ] Command autocomplete

### 9.2 Regex Scripts
- [ ] Pattern detection and replacement on AI output
- [ ] Global and per-character regex rules
- [ ] Regex rule editor UI

### 9.3 Macro System
- [ ] System macros: `{{char}}`, `{{user}}`, `{{date}}`, `{{time}}`
- [ ] Variable macros: `{{getvar::name}}`, `{{setvar::name::value}}`
- [ ] Macro expansion in prompts, character cards, and lorebook entries

### 9.4 Chat Branching
- [ ] Create branch points in conversation
- [ ] Navigate between branches
- [ ] Bookmark/checkpoint system

---

## Phase 10: Multi-User & Security

- [ ] User account system (admin + user roles)
- [ ] Password authentication
- [ ] Per-user isolated data directories
- [ ] CSRF protection
- [ ] Rate limiting on API endpoints
- [ ] IP allowlist / blocklist configuration

---

## Non-Goals (out of scope)

These SillyTavern features are intentionally excluded:

- Live2D / Talkinghead animated models
- Character expression sprites (28-slot emotion system)
- STscript full scripting language
- NovelAI-specific features
- AI Horde distributed computing
- Legacy ChromaDB integration
- Visual Novel mode
- Plugin/extension hot-loading architecture
- Internationalization (multi-language UI)
