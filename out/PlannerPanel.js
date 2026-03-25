"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerPanel = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const SkillLoader_1 = require("./SkillLoader");
const LmAnalyzer_1 = require("./LmAnalyzer");
const STATE_KEY_SETTINGS = 'aichatenhance.settings';
const STATE_KEY_HISTORY = 'aichatenhance.history';
const MAX_HISTORY = 20;
class PlannerPanel {
    static viewType = 'taskPlannerPanel';
    static _instance;
    _panel;
    _context;
    _cts;
    _isAnalyzing = false;
    _disposables = [];
    _attachedImages = [];
    _lastNodes = [];
    _lastModelResults = [];
    _lastRequirement = '';
    _lastSkillContext = '';
    _lastPlan = '';
    static createOrShow(context) {
        if (PlannerPanel._instance) {
            PlannerPanel._instance._panel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel(PlannerPanel.viewType, 'Task Planner', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview'))] });
        PlannerPanel._instance = new PlannerPanel(panel, context);
    }
    constructor(panel, context) {
        this._panel = panel;
        this._context = context;
        this._panel.webview.html = this._getWebviewHtml();
        // Restore settings + history on init
        const saved = context.globalState.get(STATE_KEY_SETTINGS);
        const history = context.globalState.get(STATE_KEY_HISTORY, []);
        setTimeout(() => {
            this._post({ type: 'restoreSettings', settings: saved ?? null });
            this._post({ type: 'restoreHistory', history });
        }, 100);
        this._panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), undefined, this._disposables);
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    }
    _dispose() {
        PlannerPanel._instance = undefined;
        this._cts?.dispose();
        this._disposables.forEach(d => d.dispose());
    }
    // ─── Persistence ─────────────────────────────────
    _saveSettings(s) {
        const current = this._context.globalState.get(STATE_KEY_SETTINGS, {});
        this._context.globalState.update(STATE_KEY_SETTINGS, { ...current, ...s });
    }
    _appendHistory(requirement, plan) {
        const history = this._context.globalState.get(STATE_KEY_HISTORY, []);
        history.unshift({
            id: new Date().toISOString(),
            requirement: requirement.slice(0, 80),
            plan,
            timestamp: Date.now(),
        });
        if (history.length > MAX_HISTORY) {
            history.length = MAX_HISTORY;
        }
        this._context.globalState.update(STATE_KEY_HISTORY, history);
        this._post({ type: 'restoreHistory', history });
    }
    // ─── Message Router ──────────────────────────────
    _handleMessage(msg) {
        switch (msg.type) {
            case 'analyze':
                if (this._isAnalyzing) {
                    this._post({ type: 'error', text: '分析正在进行中，请等待完成或取消后再试' });
                    break;
                }
                this._handleAnalyze(msg.requirement, { primaryId: msg.primaryModelId, secondaryIds: msg.secondaryModelIds });
                this._saveSettings({ primaryModelId: msg.primaryModelId, secondaryModelIds: msg.secondaryModelIds });
                break;
            case 'analyzeChat':
                this._handleAnalyzeChat(msg.conversation, { primaryId: msg.primaryModelId, secondaryIds: msg.secondaryModelIds });
                break;
            case 'cancel':
                this._cts?.cancel();
                this._isAnalyzing = false;
                break;
            case 'copy':
                vscode.env.clipboard.writeText(msg.text);
                break;
            case 'requestModels':
                this._fetchAndSendModels();
                break;
            case 'requestBrowse':
                this._sendBrowseData();
                break;
            case 'previewSkills':
                this._previewSkills(msg.requirement);
                break;
            case 'requestAllSkills':
                this._post({ type: 'allSkills', skills: (0, SkillLoader_1.getAllSkillNames)() });
                break;
            case 'attachImages':
                this._handleAttachImages();
                break;
            case 'removeImage':
                this._removeImage(msg.index);
                break;
            case 'regeneratePlan':
                this._handleRegeneratePlan({ primaryId: msg.primaryModelId, secondaryIds: msg.secondaryModelIds });
                break;
            case 'generatePlan':
                this._handleGeneratePlan({ primaryId: msg.primaryModelId, secondaryIds: msg.secondaryModelIds });
                break;
            case 'executionPlanReady':
                break;
            case 'saveSettings':
                this._saveSettings({
                    primaryModelId: msg.primaryModelId,
                    secondaryModelIds: msg.secondaryModelIds,
                    attachSkills: msg.attachSkills,
                    attachImages: msg.attachImages,
                    attachAnalysis: msg.attachAnalysis,
                });
                break;
            case 'clearHistory':
                this._context.globalState.update(STATE_KEY_HISTORY, []);
                this._post({ type: 'restoreHistory', history: [] });
                break;
            case 'loadHistorySession': {
                const history = this._context.globalState.get(STATE_KEY_HISTORY, []);
                const session = history.find(h => h.id === msg.id);
                if (session) {
                    this._post({ type: 'loadedSession', plan: session.plan });
                }
                break;
            }
            case 'executeWithContext':
                this._handleExecuteWithContext(msg.planText, msg.attachSkills, msg.attachImages, msg.attachAnalysis);
                break;
            case 'requestTokenEstimate':
                this._sendTokenEstimate(msg.attachSkills, msg.attachImages, msg.attachAnalysis);
                break;
        }
    }
    // ─── Image Handling ──────────────────────────────
    async _handleAttachImages() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        });
        if (!uris) {
            return;
        }
        const MAX_IMAGES = 5;
        const MAX_SIZE = 4 * 1024 * 1024;
        for (const uri of uris) {
            if (this._attachedImages.length >= MAX_IMAGES) {
                vscode.window.showWarningMessage(`Maximum ${MAX_IMAGES} images allowed`);
                break;
            }
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > MAX_SIZE) {
                vscode.window.showWarningMessage(`${path.basename(uri.fsPath)} exceeds 4 MB limit, skipped`);
                continue;
            }
            const data = await vscode.workspace.fs.readFile(uri);
            const ext = path.extname(uri.fsPath).toLowerCase().replace('.', '');
            const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            const base64 = Buffer.from(data).toString('base64');
            this._attachedImages.push({ name: path.basename(uri.fsPath), mimeType: mime, data: new Uint8Array(data) });
            this._post({
                type: 'imageAdded',
                index: this._attachedImages.length - 1,
                name: path.basename(uri.fsPath),
                dataUri: `data:${mime};base64,${base64}`,
            });
        }
    }
    _removeImage(index) {
        if (index >= 0 && index < this._attachedImages.length) {
            this._attachedImages.splice(index, 1);
            this._post({ type: 'imagesReset', images: this._attachedImages.map((img, i) => ({
                    index: i,
                    name: img.name,
                    dataUri: `data:${img.mimeType};base64,${Buffer.from(img.data).toString('base64')}`,
                })) });
        }
    }
    // ─── Analysis ────────────────────────────────────
    async _handleAnalyze(requirement, mc) {
        if (!requirement.trim()) {
            this._post({ type: 'error', text: '请先输入需求描述' });
            return;
        }
        this._cts?.dispose();
        this._cts = new vscode.CancellationTokenSource();
        const token = this._cts.token;
        this._isAnalyzing = true;
        this._lastRequirement = requirement;
        this._lastModelResults = [];
        this._post({ type: 'status', text: '正在加载上下文...' });
        try {
            const skills = await (0, SkillLoader_1.loadMatchingSkills)(requirement);
            const wsContext = await (0, SkillLoader_1.loadWorkspaceContext)();
            const skillParts = skills.map(s => `[${s.name}]\n${s.content}`);
            if (wsContext) {
                skillParts.unshift(wsContext);
            }
            const skillContext = skillParts.join('\n\n');
            this._lastSkillContext = skillContext;
            this._post({ type: 'modelAnalysisStart' });
            const results = await (0, LmAnalyzer_1.runModelParallelAnalysis)(requirement, skillContext, mc, (id, name) => this._post({ type: 'modelStart', modelId: id, modelName: name }), (id, analysis) => this._post({ type: 'modelDone', modelId: id, analysis }), (id, error) => this._post({ type: 'modelError', modelId: id, error }), (m) => this._post({ type: 'status', text: m }), token, this._attachedImages.length > 0 ? this._attachedImages : undefined);
            this._lastModelResults = results;
            this._post({ type: 'analysisComplete' });
        }
        catch (err) {
            if (!token.isCancellationRequested) {
                this._post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
            else {
                this._post({ type: 'cancelled' });
            }
        }
        finally {
            this._isAnalyzing = false;
        }
    }
    async _handleAnalyzeChat(conversation, mc) {
        if (!conversation.trim()) {
            this._post({ type: 'error', text: '请粘贴对话内容' });
            return;
        }
        this._cts?.dispose();
        this._cts = new vscode.CancellationTokenSource();
        const token = this._cts.token;
        this._isAnalyzing = true;
        try {
            const result = await (0, LmAnalyzer_1.analyzeConversation)(conversation, mc, (m) => this._post({ type: 'status', text: m }), token);
            const requirement = result.summary + '\n\n' +
                result.tasks.map((t, i) => `${i + 1}. [${t.priority}] ${t.title}\n   ${t.description}`).join('\n');
            this._post({ type: 'chatExtracted', requirement, summary: result.summary, tasks: result.tasks });
        }
        catch (err) {
            if (!token.isCancellationRequested) {
                this._post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
            else {
                this._post({ type: 'cancelled' });
            }
        }
        finally {
            this._isAnalyzing = false;
        }
    }
    // ─── Plan Generation ─────────────────────────────
    async _handleRegeneratePlan(mc) {
        if (!this._lastModelResults.length) {
            this._post({ type: 'error', text: '没有可用的分析结果，请先执行分析' });
            return;
        }
        await this._handleGeneratePlan(mc);
    }
    async _handleGeneratePlan(mc) {
        if (!this._lastModelResults.length) {
            this._post({ type: 'error', text: '没有可用的分析结果' });
            return;
        }
        this._cts?.dispose();
        this._cts = new vscode.CancellationTokenSource();
        const token = this._cts.token;
        try {
            const imageNames = this._attachedImages.map(img => img.name);
            const merged = await (0, LmAnalyzer_1.generatePlan)(this._lastRequirement, this._lastModelResults, mc, (m) => this._post({ type: 'status', text: m }), token, this._attachedImages.length > 0 ? this._attachedImages : undefined, imageNames.length > 0 ? imageNames : undefined);
            const planImages = this._attachedImages.map((img) => ({
                name: img.name,
                dataUri: `data:${img.mimeType};base64,${Buffer.from(img.data).toString('base64')}`,
            }));
            this._lastPlan = merged;
            this._appendHistory(this._lastRequirement, merged);
            this._post({ type: 'planGenerated', merged, images: planImages });
        }
        catch (err) {
            if (!token.isCancellationRequested) {
                this._post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
        }
    }
    // ─── Execute ─────────────────────────────────────
    async _handleExecuteWithContext(planText, attachSkills, attachImages, attachAnalysis) {
        const parts = [];
        if (attachSkills && this._lastSkillContext) {
            parts.push(`## 工作区上下文\n${this._lastSkillContext}`);
        }
        if (attachAnalysis && this._lastModelResults.length) {
            const analyses = this._lastModelResults
                .filter(r => r.analysis)
                .map(r => `### ${r.modelName}\n${r.analysis}`)
                .join('\n\n');
            if (analyses) {
                parts.push(`## 分析结果\n${analyses}`);
            }
        }
        if (attachImages && this._attachedImages.length) {
            parts.push(`## 参考图片\n${this._attachedImages.map((img, i) => `img${i + 1}: ${img.name}`).join('\n')}`);
        }
        parts.push(planText);
        const text = parts.join('\n\n');
        await this._openChat(text);
    }
    _estimateTokens(attachSkills, attachImages, attachAnalysis) {
        let chars = 0;
        if (attachSkills && this._lastSkillContext) {
            chars += this._lastSkillContext.length;
        }
        if (attachAnalysis) {
            for (const r of this._lastModelResults) {
                if (r.analysis) {
                    chars += r.analysis.length;
                }
            }
        }
        if (attachImages) {
            chars += this._attachedImages.length * 3000;
        }
        return Math.round(chars / 4);
    }
    _sendTokenEstimate(attachSkills, attachImages, attachAnalysis) {
        const planTokens = Math.round((this._lastRequirement.length + (this._lastModelResults[0]?.analysis?.length ?? 0)) / 4);
        const contextTokens = this._estimateTokens(attachSkills, attachImages, attachAnalysis);
        const total = planTokens + contextTokens;
        const imgNote = this._attachedImages.length > 0
            ? ` (含 ${this._attachedImages.length} 张图片 ~${this._attachedImages.length * 750} tokens)`
            : '';
        this._post({
            type: 'tokenEstimate',
            estimate: `~${total.toLocaleString()}${imgNote}`,
            imageCount: this._attachedImages.length,
        });
    }
    // ─── Utils ───────────────────────────────────────
    async _sendBrowseData() {
        const skills = await (0, SkillLoader_1.getSkillDescriptions)();
        const templates = await (0, SkillLoader_1.scanPromptTemplates)();
        this._post({
            type: 'browseData',
            skills: skills.map(s => ({ name: s.name, keywords: s.keywords, hasFile: s.hasFile })),
            templates: templates.map(t => ({ name: t.name, description: t.description })),
        });
    }
    async _fetchAndSendModels() {
        try {
            const cfg = vscode.workspace.getConfiguration('aichatEnhance');
            const hidden = cfg.get('hiddenModels', []);
            const models = await (0, LmAnalyzer_1.getAvailableModels)(hidden);
            this._post({ type: 'models', models });
        }
        catch {
            this._post({ type: 'models', models: [] });
        }
    }
    async _previewSkills(requirement) {
        if (!requirement.trim()) {
            this._post({ type: 'matchedSkills', skills: [] });
            return;
        }
        const skills = await (0, SkillLoader_1.loadMatchingSkills)(requirement);
        this._post({ type: 'matchedSkills', skills: skills.map(s => s.name) });
    }
    async _openChat(text) {
        await vscode.env.clipboard.writeText(text);
        await vscode.commands.executeCommand('workbench.action.chat.open');
        vscode.window.showInformationMessage('执行计划已复制到剪贴板 — 在 Chat 输入框中 Ctrl+V');
    }
    _post(msg) {
        this._panel.webview.postMessage(msg);
    }
    // ─── Webview HTML (external files + CSP nonce) ───
    _getWebviewHtml() {
        const webviewDir = path.join(this._context.extensionPath, 'webview');
        const nonce = crypto.randomBytes(16).toString('base64');
        const styleUri = this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(webviewDir, 'style.css')));
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(webviewDir, 'main.js')));
        const cspSource = this._panel.webview.cspSource;
        let html = fs.readFileSync(path.join(webviewDir, 'index.html'), 'utf-8');
        html = html.replace(/\{\{nonce\}\}/g, nonce);
        html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
        html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
        html = html.replace(/\{\{cspSource\}\}/g, cspSource);
        return html;
    }
}
exports.PlannerPanel = PlannerPanel;
//# sourceMappingURL=PlannerPanel.js.map