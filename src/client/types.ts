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
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
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
};

export type Settings = {
  general: { appName: string };
  llm: {
    provider: "anthropic" | "openai";
    apiKey: string;
    model: string;
    temperature: number;
  };
};
