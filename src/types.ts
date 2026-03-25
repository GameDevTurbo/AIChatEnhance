// ─── 共享类型定义 ─────────────────────────────────────
// 消息协议 + 跨模块接口

// ─── 模型与分析相关 ───────────────────────────────────

export interface ModelConfig {
    primaryId: string;
    secondaryIds: string[];
}

export interface ModelInfo {
    id: string;
    name: string;
    family: string;
    version: string;
    maxInputTokens: number;
    multiplier?: number;
    multiplierSource: 'api' | 'table' | 'keyword' | 'unknown';
}

export interface ImageAttachment {
    name: string;
    mimeType: string;
    data: Uint8Array;
}

export interface SkillNodeResult {
    skillName: string;
    analysis: string;
}

export interface ModelAnalysisResult {
    modelId: string;
    modelName: string;
    analysis: string;
}

export interface WorkflowPlan {
    nodes: SkillNodeResult[];
    merged: string;
}

export interface ExtractedTask {
    id: number;
    title: string;
    description: string;
    skills: string[];
    priority: 'high' | 'medium' | 'low';
}

export interface ConversationAnalysis {
    tasks: ExtractedTask[];
    summary: string;
}

// ─── 持久化数据 ────────────────────────────────────

export interface SavedSettings {
    primaryModelId: string;
    secondaryModelIds: string[];
    attachSkills: boolean;
    attachImages: boolean;
    attachAnalysis: boolean;
}

export interface SessionRecord {
    id: string;
    requirement: string;
    plan: string;
    timestamp: number;
}

// ─── Skill 相关 ────────────────────────────────────

export interface SkillFile {
    name: string;
    content: string;
}

export interface PromptTemplate {
    name: string;
    description: string;
    filePath: string;
    content: string;
}

export interface SkillDescription {
    name: string;
    keywords: string[];
    hasFile: boolean;
}

// ─── Webview → Extension 消息 ─────────────────────

export type WebviewMessage =
    | { type: 'analyze'; requirement: string; primaryModelId: string; secondaryModelIds: string[] }
    | { type: 'analyzeChat'; conversation: string; primaryModelId: string; secondaryModelIds: string[] }
    | { type: 'cancel' }
    | { type: 'copy'; text: string }
    | { type: 'requestModels' }
    | { type: 'requestBrowse' }
    | { type: 'previewSkills'; requirement: string }
    | { type: 'requestAllSkills' }
    | { type: 'attachImages' }
    | { type: 'removeImage'; index: number }
    | { type: 'regeneratePlan'; primaryModelId: string; secondaryModelIds: string[] }
    | { type: 'generatePlan'; primaryModelId: string; secondaryModelIds: string[] }
    | { type: 'executionPlanReady' }
    | { type: 'saveSettings'; primaryModelId: string; secondaryModelIds: string[]; attachSkills: boolean; attachImages: boolean; attachAnalysis: boolean }
    | { type: 'clearHistory' }
    | { type: 'loadHistorySession'; id: string }
    | { type: 'executeWithContext'; planText: string; attachSkills: boolean; attachImages: boolean; attachAnalysis: boolean }
    | { type: 'requestTokenEstimate'; attachSkills: boolean; attachImages: boolean; attachAnalysis: boolean };

// ─── Extension → Webview 消息 ─────────────────────

export type ExtensionMessage =
    | { type: 'imageAdded'; index: number; name: string; dataUri: string }
    | { type: 'imagesReset'; images: Array<{ index: number; name: string; dataUri: string }> }
    | { type: 'status'; text: string }
    | { type: 'error'; text: string }
    | { type: 'cancelled' }
    | { type: 'modelAnalysisStart' }
    | { type: 'modelStart'; modelId: string; modelName: string }
    | { type: 'modelDone'; modelId: string; analysis: string }
    | { type: 'modelError'; modelId: string; error: string }
    | { type: 'analysisComplete' }
    | { type: 'planGenerated'; merged: string; images: Array<{ name: string; dataUri: string }> }
    | { type: 'models'; models: ModelInfo[] }
    | { type: 'browseData'; skills: Array<{ name: string; keywords: string[]; hasFile: boolean }>; templates: Array<{ name: string; description: string }> }
    | { type: 'matchedSkills'; skills: string[] }
    | { type: 'allSkills'; skills: string[] }
    | { type: 'restoreSettings'; settings: SavedSettings | null }
    | { type: 'restoreHistory'; history: SessionRecord[] }
    | { type: 'loadedSession'; plan: string }
    | { type: 'tokenEstimate'; estimate: string; imageCount: number }
    | { type: 'chatExtracted'; requirement: string; summary: string; tasks: ExtractedTask[] };
