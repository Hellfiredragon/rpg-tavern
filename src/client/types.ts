export type ChatMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lorebook: string;
  currentLocation: string;
  traits: string[];
  summonedCharacters: string[];
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  source?: "narrator" | "character" | "extractor" | "system";
  content: string;
  timestamp: string;
  commits?: string[];
};

export type Adventure = {
  slug: string;
  name: string;
  latestChatId: string;
  currentLocation: string;
  locationName: string;
  updatedAt: string;
};

export type Template = {
  slug: string;
  name: string;
  preset: boolean;
};

export type LocationEntry = {
  path: string;
  name: string;
};

export type ActiveEntry = {
  path: string;
  name: string;
  content: string;
  category: string;
  state?: string[];
  currentLocation?: string;
  location?: string;
  completed?: boolean;
  requirements?: string[];
};

export type TreeNode = {
  name: string;
  path: string;
  isEntry: boolean;
  children: TreeNode[];
};

export type LorebookEntry = {
  name: string;
  content: string;
  keywords: string[];
  regex: string;
  priority: number;
  enabled: boolean;
  contexts: string[];
  characters?: string[];
  homeLocation?: string;
  currentLocation?: string;
  state?: string[];
  goals?: string[];
  location?: string;
  requirements?: string[];
  completed?: boolean;
};

// ---------------------------------------------------------------------------
// Backend + Pipeline config
// ---------------------------------------------------------------------------

export type BackendType = "koboldcpp" | "openai";

export type BackendConfig = {
  id: string;
  name: string;
  type: BackendType;
  url: string;
  apiKey: string;
  model: string;
  streaming: boolean;
  maxConcurrent: number;
};

export type PipelineRole = "narrator" | "character" | "extractor";

export type PipelineStep = {
  role: PipelineRole;
  backendId: string;
  enabled: boolean;
};

export type PipelineConfig = {
  steps: PipelineStep[];
};

export type Settings = {
  general: { appName: string; temperature?: number };
  llm: {
    provider: "anthropic" | "openai";
    apiKey: string;
    model: string;
    temperature: number;
  };
  backends: BackendConfig[];
  pipeline: PipelineConfig;
};

// ---------------------------------------------------------------------------
// Pipeline SSE events
// ---------------------------------------------------------------------------

export type PipelineEvent =
  | { type: "step_start"; role: PipelineRole }
  | { type: "step_token"; role: PipelineRole; token: string }
  | { type: "step_complete"; role: PipelineRole; message: ChatMessage }
  | { type: "extractor_background"; status: "started" | "completed" | "failed"; error?: string }
  | { type: "extractor_tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "pipeline_complete"; messages: ChatMessage[]; location?: string }
  | { type: "pipeline_error"; error: string; role?: PipelineRole; category?: string }
  | { type: "pipeline_cancelled" };
