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
const SkillLoader_1 = require("./SkillLoader");
const LmAnalyzer_1 = require("./LmAnalyzer");
class PlannerPanel {
    static viewType = 'taskPlannerPanel';
    static _instance;
    _panel;
    _cts;
    _isAnalyzing = false;
    _disposables = [];
    static createOrShow(context) {
        if (PlannerPanel._instance) {
            PlannerPanel._instance._panel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel(PlannerPanel.viewType, 'Task Planner', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        PlannerPanel._instance = new PlannerPanel(panel, context);
    }
    constructor(panel, _context) {
        this._panel = panel;
        this._panel.iconPath = new vscode.ThemeIcon('robot');
        this._panel.webview.html = getWebviewHtml();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), null, this._disposables);
        this._post({ type: 'allSkills', skills: (0, SkillLoader_1.getAllSkillNames)() });
    }
    _dispose() {
        PlannerPanel._instance = undefined;
        this._cts?.dispose();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
    _mc(msg) {
        return { primaryId: msg.primaryModelId ?? '', secondaryIds: msg.secondaryModelIds ?? [] };
    }
    async _handleMessage(msg) {
        const mc = this._mc(msg);
        switch (msg.type) {
            case 'analyze':
                await this._handleAnalyze(String(msg.requirement ?? ''), mc);
                break;
            case 'cancel':
                this._cts?.cancel();
                break;
            case 'copy':
                await vscode.env.clipboard.writeText(String(msg.text ?? ''));
                vscode.window.showInformationMessage('已复制到剪贴板');
                break;
            case 'openChat':
                await this._openChat(String(msg.text ?? ''));
                break;
            case 'requestModels':
                await this._fetchAndSendModels();
                break;
            case 'previewSkills':
                await this._previewSkills(String(msg.requirement ?? ''));
                break;
            case 'requestAllSkills':
                this._post({ type: 'allSkills', skills: (0, SkillLoader_1.getAllSkillNames)() });
                break;
            case 'requestBrowse':
                await this._sendBrowseData();
                break;
            case 'analyzeChat':
                await this._handleAnalyzeChat(String(msg.conversation ?? ''), mc);
                break;
            case 'generatePlanFromTasks':
                await this._handleGeneratePlan(String(msg.text ?? ''), mc);
                break;
        }
    }
    // ─── Requirement Analysis ────────────────────────
    async _handleAnalyze(requirement, mc) {
        if (!requirement.trim()) {
            this._post({ type: 'error', text: '请先输入需求描述' });
            return;
        }
        this._cts?.dispose();
        this._cts = new vscode.CancellationTokenSource();
        const token = this._cts.token;
        this._isAnalyzing = true;
        this._post({ type: 'status', text: '正在匹配 Skills...' });
        try {
            const skills = await (0, SkillLoader_1.loadMatchingSkills)(requirement);
            if (!skills.length) {
                this._post({ type: 'error', text: '未匹配到任何 Skill，请在需求中加入关键词' });
                return;
            }
            this._post({ type: 'workflowStart', skillNames: skills.map(s => s.name) });
            const plan = await (0, LmAnalyzer_1.runWorkflow)(requirement, skills, mc, (n, m) => this._post({ type: 'nodeStart', skillName: n, modelName: m }), (n, a) => this._post({ type: 'nodeDone', skillName: n, analysis: a }), (n, e) => this._post({ type: 'nodeError', skillName: n, error: e }), (m) => this._post({ type: 'status', text: m }), token);
            this._post({ type: 'result', merged: plan.merged });
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
    // ─── Chat Analysis ──────────────────────────
    async _handleAnalyzeChat(conversation, mc) {
        if (!conversation.trim()) {
            this._post({ type: 'chatError', text: '请粘贴对话内容' });
            return;
        }
        this._cts?.dispose();
        this._cts = new vscode.CancellationTokenSource();
        const token = this._cts.token;
        this._isAnalyzing = true;
        try {
            const result = await (0, LmAnalyzer_1.analyzeConversation)(conversation, mc, (m) => this._post({ type: 'chatStatus', text: m }), token);
            this._post({ type: 'chatResult', ...result });
        }
        catch (err) {
            if (!token.isCancellationRequested) {
                this._post({ type: 'chatError', text: err instanceof Error ? err.message : String(err) });
            }
            else {
                this._post({ type: 'chatCancelled' });
            }
        }
        finally {
            this._isAnalyzing = false;
        }
    }
    async _handleGeneratePlan(tasksJson, mc) {
        try {
            const tasks = JSON.parse(tasksJson);
            const requirement = tasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
            this._post({ type: 'switchToInput', requirement });
            await this._handleAnalyze(requirement, mc);
        }
        catch {
            this._post({ type: 'error', text: '任务数据解析失败' });
        }
    }
    // ─── Browse ─────────────────────────────────
    async _sendBrowseData() {
        const skills = (0, SkillLoader_1.getSkillDescriptions)();
        const prompts = await (0, SkillLoader_1.scanPromptTemplates)();
        this._post({
            type: 'browseData',
            skills,
            prompts: prompts.map(p => ({
                name: p.name,
                description: p.description,
                filePath: p.filePath,
            })),
        });
    }
    // ─── Utils ──────────────────────────────────
    async _fetchAndSendModels() {
        try {
            const models = await (0, LmAnalyzer_1.getAvailableModels)();
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
}
exports.PlannerPanel = PlannerPanel;
// ═══════════════════════════════════════════════════════
// ─── Webview HTML ─────────────────────────────────────
// ═══════════════════════════════════════════════════════
function getWebviewHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root {
  --radius: 5px;
  --gap: 10px;
  --bg-card: var(--vscode-editorWidget-background);
  --border: var(--vscode-panel-border, #444);
  --accent: var(--vscode-focusBorder);
  --fg: var(--vscode-editor-foreground);
  --fg-dim: var(--vscode-descriptionForeground);
  --bg: var(--vscode-editor-background);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --input-bg: var(--vscode-input-background);
  --input-fg: var(--vscode-input-foreground);
  --input-border: var(--vscode-input-border, #555);
  --err: var(--vscode-errorForeground, #f48771);
  --ok: #4ec9b0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--fg);
  font-family: var(--vscode-font-family); font-size: 12px; line-height: 1.5;
  height: 100vh; overflow: hidden;
}

/* ── Layout ── */
.container { display: flex; flex-direction: column; height: 100vh; }
.top-section {
  flex: 0 0 auto; max-height: 35vh;
  display: flex; flex-direction: column;
  border-bottom: 2px solid var(--border);
  transition: max-height .2s;
}
.top-section.collapsed { max-height: 34px; }
.top-section.collapsed .section-body { display: none; }
.section-bar {
  display: flex; align-items: center;
  background: var(--bg-card); border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.section-body { flex: 1; overflow: auto; padding: 10px 16px; }
.bottom-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.tab-content { flex: 1; overflow: auto; padding: 14px 20px; }

/* ── Tabs ── */
.tab-bar { display: flex; flex: 1; }
.tab {
  padding: 7px 16px; font-size: 11px; font-weight: 600;
  cursor: pointer; color: var(--fg-dim);
  border-bottom: 2px solid transparent;
  transition: all .15s; user-select: none; white-space: nowrap;
}
.tab:hover { color: var(--fg); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-page { display: none; }
.tab-page.active { display: block; }
.toggle-btn {
  padding: 4px 12px; cursor: pointer; font-size: 12px;
  color: var(--fg-dim); user-select: none; transition: transform .2s;
}
.top-section.collapsed .toggle-btn { transform: rotate(-90deg); }

/* ── Common ── */
h4 {
  font-size: 11px; font-weight: 600; color: var(--fg-dim);
  text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px;
}
textarea {
  width: 100%; min-height: 100px; resize: vertical;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: var(--radius);
  padding: 8px; font-size: 12px; font-family: var(--vscode-font-family); line-height: 1.5;
}
textarea:focus { outline: none; border-color: var(--accent); }
.columns { display: flex; gap: 24px; }
.col { flex: 1; min-width: 0; }
.col-sm { flex: 0 0 360px; min-width: 280px; }
button {
  padding: 7px 14px; border: none; border-radius: var(--radius);
  cursor: pointer; font-size: 11px; font-weight: 600;
}
button:disabled { opacity: .4; cursor: not-allowed; }
.btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
.btn-primary:hover:not(:disabled) { background: var(--btn-hover); }
.btn-sec { background: transparent; border: 1px solid var(--border); color: var(--fg-dim); }
.btn-sec:hover:not(:disabled) { border-color: var(--accent); color: var(--fg); }
.btn-sm { padding: 3px 8px; font-size: 10px; }
.row { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.hidden { display: none !important; }
.spacer { height: 12px; }
.dim { color: var(--fg-dim); font-size: 10px; }

/* ── Status / Error ── */
.status-bar {
  padding: 7px 12px; background: var(--bg-card);
  border-left: 3px solid var(--accent); font-size: 11px;
  color: var(--fg-dim); white-space: pre-line;
  border-radius: 0 var(--radius) var(--radius) 0; margin: 8px 0;
}
.err { color: var(--err); font-size: 11px; margin: 8px 0; }

/* ── Model Table ── */
.model-table-wrap {
  max-height: 200px; overflow: auto;
  border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px;
}
.model-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.model-table th {
  text-align: left; padding: 5px 8px; font-size: 10px; font-weight: 600;
  color: var(--fg-dim); border-bottom: 1px solid var(--border);
  background: var(--bg-card); position: sticky; top: 0;
}
.model-table td { padding: 4px 8px; }
.model-table td:first-child, .model-table td:nth-child(2) { width: 40px; text-align: center; }
.model-table tr:hover { background: var(--vscode-list-hoverBackground); }

/* ── Skill Tags ── */
.skill-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; min-height: 22px; }
.skill-tag {
  font-size: 10px; padding: 2px 8px; border-radius: 10px;
  border: 1px solid var(--border); color: var(--fg-dim); opacity: .5; transition: all .15s;
}
.skill-tag.active { opacity: 1; border-color: var(--accent); color: var(--fg); background: rgba(0,120,212,.12); }

/* ── Skill Grid (Browse) ── */
.skill-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;
}
.skill-card {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 8px 10px; cursor: pointer; transition: border-color .15s;
}
.skill-card:hover { border-color: var(--accent); }
.skill-card-name { font-size: 11px; font-weight: 600; margin-bottom: 3px; }
.skill-card-badge {
  display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 8px;
  margin-left: 4px; vertical-align: middle;
}
.badge-file { background: rgba(0,120,212,.15); color: var(--accent); }
.badge-builtin { background: rgba(255,200,50,.15); color: #e5c07b; }
.skill-card-kw { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.skill-card-kw span {
  font-size: 9px; padding: 1px 5px; border-radius: 3px;
  background: rgba(255,255,255,.06); color: var(--fg-dim);
}

/* ── Template List (Browse) ── */
.tmpl-list { display: flex; flex-direction: column; gap: 4px; }
.tmpl-card {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 6px 10px; transition: border-color .15s;
}
.tmpl-card:hover { border-color: var(--accent); }
.tmpl-name { font-size: 11px; font-weight: 600; }
.tmpl-desc { font-size: 10px; color: var(--fg-dim); margin-top: 2px; }
.tmpl-path { font-size: 9px; color: var(--fg-dim); opacity: .6; margin-top: 2px; word-break: break-all; }

/* ── Workflow Nodes ── */
.wf-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; margin: 8px 0;
}
.wf-card {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 8px 10px; cursor: pointer; transition: all .15s; text-align: center;
}
.wf-card:hover { border-color: var(--accent); }
.wf-card.selected { border-color: var(--accent); background: rgba(0,120,212,.06); }
.wf-card.done { border-color: rgba(78,201,176,.4); }
.wf-card.error { border-color: rgba(244,135,113,.4); }
.wf-dot {
  width: 10px; height: 10px; border-radius: 50%; margin: 0 auto 4px;
}
.wf-dot-idle { background: var(--fg-dim); opacity: .3; }
.wf-dot-running { background: var(--vscode-progressBar-background, #0078d4); animation: pulse .9s infinite; }
.wf-dot-done { background: var(--ok); }
.wf-dot-error { background: var(--err); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.25} }
.wf-name { font-size: 11px; font-weight: 600; }
.wf-model { font-size: 9px; color: var(--fg-dim); margin-top: 2px; }
.wf-tag { font-size: 9px; color: var(--fg-dim); margin-top: 1px; }
.wf-detail {
  margin-top: 10px; padding: 12px 14px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-card); font-size: 11px; line-height: 1.65; white-space: pre-wrap;
}
.wf-detail-title {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .04em; color: var(--fg-dim); margin-bottom: 6px;
}

/* ── Plan ── */
.plan-box {
  border: 1px solid var(--accent); border-radius: var(--radius); overflow: hidden;
}
.plan-head {
  padding: 8px 12px; background: var(--bg-card);
  font-size: 12px; font-weight: 700; color: var(--accent);
  border-bottom: 1px solid var(--border);
}
.plan-body {
  padding: 14px 16px; font-size: 12px; line-height: 1.75; white-space: pre-wrap;
}
.action-row { display: flex; gap: 8px; margin-top: 10px; }

/* ── Task Cards ── */
.task-list { display: flex; flex-direction: column; gap: 6px; }
.task-card {
  border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px;
}
.task-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.task-id { font-size: 10px; font-weight: 700; color: var(--accent); min-width: 22px; }
.task-title { font-size: 11px; font-weight: 600; flex: 1; }
.task-priority { font-size: 9px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.task-priority-high { background: rgba(244,135,113,.2); color: var(--err); }
.task-priority-medium { background: rgba(255,200,50,.2); color: #e5c07b; }
.task-priority-low { background: rgba(78,201,176,.2); color: var(--ok); }
.task-desc { font-size: 11px; color: var(--fg-dim); line-height: 1.5; }
.task-skills { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.task-skill-tag {
  font-size: 9px; padding: 1px 5px; border-radius: 3px;
  background: rgba(0,120,212,.1); color: var(--accent);
}
.summary-box {
  padding: 8px 12px; background: var(--bg-card);
  border-left: 3px solid var(--ok);
  border-radius: 0 var(--radius) var(--radius) 0;
  font-size: 11px; margin-bottom: 8px;
}
.empty-state { text-align: center; padding: 30px; color: var(--fg-dim); font-size: 12px; }
</style>
</head>
<body>
<div class="container">

  <!-- ═══ TOP SECTION: Reference ═══ -->
  <div class="top-section" id="topSection">
    <div class="section-bar">
      <div class="tab-bar">
        <div class="tab active" data-action="topTab" data-param="skills">&#128218; Skills</div>
        <div class="tab" data-action="topTab" data-param="templates">&#128221; Prompt &#27169;&#26495;</div>
      </div>
      <span class="toggle-btn" data-action="toggleTop">&#9660;</span>
    </div>
    <div class="section-body" id="topBody">
      <div class="tab-page active" id="top-skills">
        <div id="skillGrid" class="skill-grid">
          <div class="empty-state">&#21152;&#36733;&#20013;...</div>
        </div>
      </div>
      <div class="tab-page" id="top-templates">
        <div id="templateList" class="tmpl-list">
          <div class="empty-state">&#21152;&#36733;&#20013;...</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══ BOTTOM SECTION: Workflow ═══ -->
  <div class="bottom-section">
    <div class="section-bar">
      <div class="tab-bar" id="bottomTabs">
        <div class="tab active" data-action="bottomTab" data-param="input">&#9312; &#38656;&#27714;</div>
        <div class="tab" data-action="bottomTab" data-param="analyze">&#9313; &#20998;&#26512;</div>
        <div class="tab" data-action="bottomTab" data-param="plan">&#9314; &#35745;&#21010;</div>
        <div class="tab" data-action="bottomTab" data-param="chat">&#9315; &#23545;&#35805;</div>
      </div>
    </div>
    <div class="tab-content">

      <!-- Tab ① 需求 -->
      <div class="tab-page active" id="bot-input">
        <div class="columns">
          <div class="col">
            <h4>&#38656;&#27714;&#25551;&#36848;</h4>
            <textarea id="req" placeholder="&#25551;&#36848;&#20320;&#35201;&#20570;&#20160;&#20040;&#65292;&#20363;&#22914;&#65306;&#32473;&#25112;&#26007;&#31995;&#32479;&#26032;&#22686;&#20498;&#35745;&#26102;&#22870;&#21169;&#65292;&#20851;&#21345;&#32467;&#26463;&#21069;&#23436;&#25104;&#32473;&#39069;&#22806;&#20998;&#25968;"></textarea>
            <h4 style="margin-top:12px;">&#21305;&#37197; Skills</h4>
            <div class="skill-tags" id="skillTags"></div>
            <div id="skillHint" class="dim" style="margin-top:4px;">&#36755;&#20837;&#38656;&#27714;&#21518;&#33258;&#21160;&#21305;&#37197;</div>
          </div>
          <div class="col-sm">
            <h4>&#27169;&#22411;&#36873;&#25321; <span class="dim" style="text-transform:none;letter-spacing:0;">&#33267;&#23569;&#19968;&#20010;&#20027;&#27169;&#22411;</span></h4>
            <div class="model-table-wrap">
              <table class="model-table">
                <thead><tr><th>&#20027;</th><th>&#21442;&#19982;</th><th>&#27169;&#22411;</th></tr></thead>
                <tbody id="modelBody">
                  <tr><td colspan="3" style="text-align:center;padding:14px;color:var(--fg-dim);">&#28857;&#20987;&#19979;&#26041;&#25353;&#38062;&#21152;&#36733;&#21487;&#29992;&#27169;&#22411;</td></tr>
                </tbody>
              </table>
            </div>
            <div class="row">
              <button class="btn-sec btn-sm" data-action="loadModels">&#128260; &#21152;&#36733;&#27169;&#22411;</button>
              <span class="dim" id="modelCount"></span>
            </div>
            <div class="spacer"></div>
            <div class="row">
              <button class="btn-primary" data-action="startAnalyze" id="analyzeBtn" style="flex:1;">&#9889; &#21551;&#21160;&#20998;&#26512;</button>
              <button class="btn-sec hidden" data-action="cancel" id="cancelBtn">&#10005; &#21462;&#28040;</button>
            </div>
            <div id="inputErr" class="err hidden"></div>
          </div>
        </div>
      </div>

      <!-- Tab ② 分析 -->
      <div class="tab-page" id="bot-analyze">
        <div id="wfStatus" class="status-bar hidden"></div>
        <div id="wfNodes" class="wf-grid"></div>
        <div id="wfDetail" class="wf-detail hidden">
          <div class="wf-detail-title" id="wfDetailTitle"></div>
          <div id="wfDetailText"></div>
        </div>
        <div id="analyzeErr" class="err hidden"></div>
      </div>

      <!-- Tab ③ 计划 -->
      <div class="tab-page" id="bot-plan">
        <div id="planEmpty" class="empty-state">&#23578;&#26410;&#29983;&#25104;&#35745;&#21010; &#8212; &#35831;&#20808;&#22312; &#9312; &#38656;&#27714; &#20013;&#21551;&#21160;&#20998;&#26512;</div>
        <div id="planBox" class="plan-box hidden">
          <div class="plan-head">&#128203; &#32508;&#21512;&#25191;&#34892;&#35745;&#21010;</div>
          <div class="plan-body" id="planBody"></div>
        </div>
        <div id="planActions" class="action-row hidden">
          <button class="btn-primary" data-action="copyPlan">&#128203; &#22797;&#21046;&#35745;&#21010;</button>
          <button class="btn-sec" data-action="openChat">&#128172; &#21457;&#36865;&#21040; Chat</button>
        </div>
      </div>

      <!-- Tab ④ 对话 -->
      <div class="tab-page" id="bot-chat">
        <div class="columns">
          <div class="col">
            <h4>&#31896;&#36148;&#23545;&#35805;&#20869;&#23481;</h4>
            <textarea id="chatInput" style="min-height:200px;" placeholder="&#31896;&#36148;&#20320;&#21644; AI &#30340;&#32842;&#22825;&#35760;&#24405;...&#22810;&#20010; AI &#35270;&#35282;&#23558;&#24182;&#34892;&#20998;&#26512;&#24182;&#25552;&#21462;&#32467;&#26500;&#21270;&#20219;&#21153;&#12290;"></textarea>
            <div class="row">
              <button class="btn-primary" data-action="analyzeChat" id="chatAnalyzeBtn">&#128269; &#25552;&#21462;&#20219;&#21153;</button>
              <button class="btn-sec hidden" data-action="cancelChat" id="chatCancelBtn">&#10005; &#21462;&#28040;</button>
            </div>
            <div id="chatStatus" class="status-bar hidden"></div>
            <div id="chatErr" class="err hidden"></div>
          </div>
          <div class="col">
            <h4>&#25552;&#21462;&#30340;&#20219;&#21153;</h4>
            <div id="chatSummary" class="summary-box hidden"></div>
            <div id="chatTasks" class="task-list"></div>
            <div id="chatActions" class="action-row hidden">
              <button class="btn-primary" data-action="genPlanFromTasks">&#9889; &#29983;&#25104;&#25191;&#34892;&#35745;&#21010;</button>
              <button class="btn-sec" data-action="copyChatTasks">&#128203; &#22797;&#21046;&#20219;&#21153;</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
var vscode = acquireVsCodeApi();
var planText = '';
var allSkillNames = [];
var matchedSkillNames = [];
var previewTimer = null;
var chatTasksData = [];
var nodeDataMap = {};
var selectedNodeId = '';

/* ═══ Event Delegation ═══ */
document.addEventListener('click', function(e) {
  var el = e.target;
  while (el && el !== document.body) {
    var action = el.getAttribute('data-action');
    if (action) { handleAction(action, el); return; }
    el = el.parentElement;
  }
});

function handleAction(action, el) {
  var param = el.getAttribute('data-param') || '';
  switch (action) {
    case 'topTab':           switchTopTab(param); break;
    case 'bottomTab':        switchBottomTab(param); break;
    case 'toggleTop':        toggleTopSection(); break;
    case 'loadModels':       loadModels(); break;
    case 'startAnalyze':     startAnalyze(); break;
    case 'cancel':           cancel(); break;
    case 'cancelChat':       cancel(); break;
    case 'copyPlan':         copyPlan(); break;
    case 'openChat':         openChat(); break;
    case 'selectNode':       selectNode(param); break;
    case 'analyzeChat':      doAnalyzeChat(); break;
    case 'genPlanFromTasks': generatePlanFromTasks(); break;
    case 'copyChatTasks':    copyChatTasks(); break;
  }
}

document.addEventListener('input', function(e) {
  if (e.target.id === 'req') {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function() {
      vscode.postMessage({ type: 'previewSkills', requirement: e.target.value.trim() });
    }, 300);
  }
});

document.addEventListener('change', function(e) {
  if (e.target.name === 'primaryModel') syncPrimaryCheckboxes();
  updateModelCount();
});

/* ═══ Tabs ═══ */
function switchTopTab(name) {
  var sec = document.getElementById('topSection');
  sec.querySelectorAll('.tab-bar .tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-param') === name);
  });
  document.querySelectorAll('#topBody > .tab-page').forEach(function(p) {
    p.classList.toggle('active', p.id === 'top-' + name);
  });
  vscode.postMessage({ type: 'requestBrowse' });
}

function switchBottomTab(name) {
  document.querySelectorAll('#bottomTabs .tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-param') === name);
  });
  document.querySelectorAll('.tab-content > .tab-page').forEach(function(p) {
    p.classList.toggle('active', p.id === 'bot-' + name);
  });
}

function toggleTopSection() {
  document.getElementById('topSection').classList.toggle('collapsed');
}

/* ═══ Models ═══ */
function loadModels() {
  vscode.postMessage({ type: 'requestModels' });
}

function renderModels(models) {
  var body = document.getElementById('modelBody');
  if (!models.length) {
    body.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:14px;color:var(--fg-dim);">未找到可用模型</td></tr>';
    updateModelCount();
    return;
  }
  body.innerHTML = models.map(function(m, i) {
    var fam = m.family ? ' <span class="dim">(' + esc(m.family) + ')</span>' : '';
    return '<tr>' +
      '<td><input type="radio" name="primaryModel" value="' + escAttr(m.id) + '"' + (i === 0 ? ' checked' : '') + '></td>' +
      '<td><input type="checkbox" class="model-check" value="' + escAttr(m.id) + '"' + (i === 0 ? ' checked disabled' : '') + '></td>' +
      '<td>' + esc(m.name) + fam + '</td>' +
      '</tr>';
  }).join('');
  syncPrimaryCheckboxes();
  updateModelCount();
}

function syncPrimaryCheckboxes() {
  var radio = document.querySelector('input[name="primaryModel"]:checked');
  if (!radio) return;
  var pid = radio.value;
  document.querySelectorAll('.model-check').forEach(function(cb) {
    if (cb.value === pid) { cb.checked = true; cb.disabled = true; }
    else { cb.disabled = false; }
  });
}

function updateModelCount() {
  var n = document.querySelectorAll('.model-check:checked').length;
  var el = document.getElementById('modelCount');
  el.textContent = n > 0 ? n + ' 个模型参与分析' : '';
}

function getModelConfig() {
  var primary = '';
  var secondaries = [];
  var radio = document.querySelector('input[name="primaryModel"]:checked');
  if (radio) primary = radio.value;
  document.querySelectorAll('.model-check:checked').forEach(function(cb) {
    if (cb.value !== primary) secondaries.push(cb.value);
  });
  return { primaryModelId: primary, secondaryModelIds: secondaries };
}

/* ═══ Tab ① Start Analysis ═══ */
function startAnalyze() {
  var req = document.getElementById('req').value.trim();
  if (!req) { showErr('inputErr', '请先输入需求描述'); return; }
  hideEl('inputErr');
  setAnalyzing(true);
  switchBottomTab('analyze');
  resetAnalyzeTab();
  var mc = getModelConfig();
  vscode.postMessage({
    type: 'analyze', requirement: req,
    primaryModelId: mc.primaryModelId, secondaryModelIds: mc.secondaryModelIds
  });
}

function cancel() { vscode.postMessage({ type: 'cancel' }); setAnalyzing(false); }

function setAnalyzing(on) {
  var ab = document.getElementById('analyzeBtn'); if (ab) ab.disabled = on;
  var cb = document.getElementById('cancelBtn'); if (cb) cb.classList.toggle('hidden', !on);
  var cab = document.getElementById('chatAnalyzeBtn'); if (cab) cab.disabled = on;
  var ccb = document.getElementById('chatCancelBtn'); if (ccb) ccb.classList.toggle('hidden', !on);
}

function resetAnalyzeTab() {
  document.getElementById('wfNodes').innerHTML = '';
  hideEl('wfDetail'); hideEl('wfStatus'); hideEl('analyzeErr');
  nodeDataMap = {}; selectedNodeId = '';
}

/* ═══ Tab ② Workflow Nodes ═══ */
function renderWorkflowStart(skillNames) {
  nodeDataMap = {};
  var html = skillNames.map(function(name) {
    var sid = escId(name);
    nodeDataMap[name] = { status: 'idle', analysis: '', modelName: '', error: '' };
    return '<div class="wf-card" id="wf-' + sid + '" data-action="selectNode" data-param="' + escAttr(name) + '">' +
      '<div class="wf-dot wf-dot-idle" id="dot-' + sid + '"></div>' +
      '<div class="wf-name">' + esc(name) + '</div>' +
      '<div class="wf-model" id="mod-' + sid + '"></div>' +
      '<div class="wf-tag" id="tag-' + sid + '">等待</div>' +
      '</div>';
  }).join('');
  document.getElementById('wfNodes').innerHTML = html;
}

function updateNode(skillName, status, data) {
  var sid = escId(skillName);
  var card = document.getElementById('wf-' + sid);
  var dot = document.getElementById('dot-' + sid);
  var tag = document.getElementById('tag-' + sid);
  var mod = document.getElementById('mod-' + sid);
  if (!card) return;
  if (!nodeDataMap[skillName]) nodeDataMap[skillName] = {};
  var nd = nodeDataMap[skillName];
  nd.status = status;
  if (data.analysis !== undefined) nd.analysis = data.analysis;
  if (data.modelName !== undefined) nd.modelName = data.modelName;
  if (data.error !== undefined) nd.error = data.error;
  dot.className = 'wf-dot wf-dot-' + status;
  card.className = 'wf-card' + (status === 'done' ? ' done' : status === 'error' ? ' error' : '') +
    (selectedNodeId === skillName ? ' selected' : '');
  if (status === 'running') {
    tag.textContent = '分析中...';
    if (data.modelName) mod.textContent = data.modelName;
  } else if (status === 'done') {
    tag.textContent = '\\u2713 完成';
  } else if (status === 'error') {
    tag.textContent = '\\u2717 错误';
  }
  if (status === 'done' && !selectedNodeId) selectNode(skillName);
  if (selectedNodeId === skillName) showNodeDetail(skillName);
}

function selectNode(skillName) {
  selectedNodeId = skillName;
  document.querySelectorAll('.wf-card').forEach(function(c) {
    c.classList.toggle('selected', c.getAttribute('data-param') === skillName);
  });
  showNodeDetail(skillName);
}

function showNodeDetail(skillName) {
  var d = nodeDataMap[skillName];
  if (!d) return;
  var title = document.getElementById('wfDetailTitle');
  var text = document.getElementById('wfDetailText');
  title.textContent = skillName + (d.modelName ? ' \\u2014 ' + d.modelName : '');
  if (d.status === 'done') text.textContent = d.analysis;
  else if (d.status === 'error') text.textContent = '错误: ' + d.error;
  else if (d.status === 'running') text.textContent = '正在分析...';
  else text.textContent = '等待中';
  showEl('wfDetail');
}

/* ═══ Tab ③ Plan ═══ */
function showResult(merged) {
  setAnalyzing(false);
  planText = merged;
  document.getElementById('planBody').textContent = merged;
  hideEl('planEmpty');
  showEl('planBox'); showEl('planActions');
  switchBottomTab('plan');
}

function copyPlan() { vscode.postMessage({ type: 'copy', text: planText }); }
function openChat() { vscode.postMessage({ type: 'openChat', text: planText }); }

/* ═══ Tab ④ Chat ═══ */
function doAnalyzeChat() {
  var text = document.getElementById('chatInput').value.trim();
  if (!text) { showErr('chatErr', '请粘贴对话内容'); return; }
  hideEl('chatErr');
  setAnalyzing(true);
  hideEl('chatSummary'); hideEl('chatActions');
  document.getElementById('chatTasks').innerHTML = '';
  var mc = getModelConfig();
  vscode.postMessage({
    type: 'analyzeChat', conversation: text,
    primaryModelId: mc.primaryModelId, secondaryModelIds: mc.secondaryModelIds
  });
}

function renderChatResult(data) {
  chatTasksData = data.tasks || [];
  var el = document.getElementById('chatSummary');
  el.textContent = data.summary || '';
  showEl('chatSummary');
  var tl = document.getElementById('chatTasks');
  if (!chatTasksData.length) {
    tl.innerHTML = '<div class="empty-state">未提取到任务</div>';
    return;
  }
  tl.innerHTML = chatTasksData.map(function(t) {
    return '<div class="task-card">' +
      '<div class="task-header">' +
      '<span class="task-id">#' + t.id + '</span>' +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      '<span class="task-priority task-priority-' + (t.priority || 'medium') + '">' + (t.priority || 'medium') + '</span>' +
      '</div>' +
      '<div class="task-desc">' + esc(t.description) + '</div>' +
      (t.skills && t.skills.length
        ? '<div class="task-skills">' + t.skills.map(function(s) { return '<span class="task-skill-tag">' + esc(s) + '</span>'; }).join('') + '</div>'
        : '') +
      '</div>';
  }).join('');
  showEl('chatActions');
}

function generatePlanFromTasks() {
  var mc = getModelConfig();
  vscode.postMessage({
    type: 'generatePlanFromTasks', text: JSON.stringify(chatTasksData),
    primaryModelId: mc.primaryModelId, secondaryModelIds: mc.secondaryModelIds
  });
}

function copyChatTasks() {
  var lines = chatTasksData.map(function(t, i) {
    return (i + 1) + '. [' + t.priority + '] ' + t.title + '\\n   ' + t.description;
  });
  vscode.postMessage({ type: 'copy', text: lines.join('\\n\\n') });
}

/* ═══ Browse ═══ */
function renderBrowseData(data) {
  renderSkillGrid(data.skills || []);
  renderTemplateList(data.prompts || []);
}

function renderSkillGrid(skills) {
  var el = document.getElementById('skillGrid');
  if (!skills.length) { el.innerHTML = '<div class="empty-state">未找到 Skill</div>'; return; }
  el.innerHTML = skills.map(function(s) {
    var kws = (s.keywords || []).slice(0, 6);
    return '<div class="skill-card">' +
      '<div class="skill-card-name">' + esc(s.name) +
      (s.hasFile
        ? '<span class="skill-card-badge badge-file">文件</span>'
        : '<span class="skill-card-badge badge-builtin">内置</span>') +
      '</div>' +
      (kws.length
        ? '<div class="skill-card-kw">' + kws.map(function(k) { return '<span>' + esc(k) + '</span>'; }).join('') + '</div>'
        : '') +
      '</div>';
  }).join('');
}

function renderTemplateList(prompts) {
  var el = document.getElementById('templateList');
  if (!prompts.length) { el.innerHTML = '<div class="empty-state">未找到 .prompt.md 模板</div>'; return; }
  el.innerHTML = prompts.map(function(p) {
    return '<div class="tmpl-card">' +
      '<div class="tmpl-name">' + esc(p.name) + '</div>' +
      '<div class="tmpl-desc">' + esc(p.description) + '</div>' +
      '<div class="tmpl-path">' + esc(p.filePath) + '</div>' +
      '</div>';
  }).join('');
}

/* ═══ Skill Tags ═══ */
function handleAllSkills(skills) {
  allSkillNames = skills || [];
  renderSkillTags();
}

function handleMatchedSkills(skills) {
  matchedSkillNames = skills || [];
  renderSkillTags();
}

function renderSkillTags() {
  var el = document.getElementById('skillTags');
  var hint = document.getElementById('skillHint');
  if (!allSkillNames.length) { el.innerHTML = ''; return; }
  el.innerHTML = allSkillNames.map(function(name) {
    var active = matchedSkillNames.indexOf(name) !== -1;
    return '<span class="skill-tag' + (active ? ' active' : '') + '">' + esc(name) + '</span>';
  }).join('');
  var count = matchedSkillNames.filter(function(n) { return n !== 'SKILL'; }).length;
  hint.textContent = count > 0
    ? count + ' 个 Skill 已匹配（SKILL 始终加载）'
    : '输入需求后自动匹配';
}

/* ═══ Utils ═══ */
function showEl(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideEl(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function showErr(id, t) { var el = document.getElementById(id); if (el) { el.textContent = '\\u274C ' + t; el.classList.remove('hidden'); } }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

/* ═══ Message Handler ═══ */
window.addEventListener('message', function(e) {
  var msg = e.data;
  switch (msg.type) {
    case 'allSkills':     handleAllSkills(msg.skills); break;
    case 'matchedSkills': handleMatchedSkills(msg.skills); break;
    case 'models':        renderModels(msg.models || []); break;
    case 'status':
      showEl('wfStatus');
      document.getElementById('wfStatus').textContent = msg.text;
      break;
    case 'workflowStart':
      switchBottomTab('analyze');
      showEl('wfStatus');
      document.getElementById('wfStatus').textContent = '工作流启动...';
      renderWorkflowStart(msg.skillNames || []);
      break;
    case 'nodeStart':
      updateNode(msg.skillName, 'running', { modelName: msg.modelName || '' });
      break;
    case 'nodeDone':
      updateNode(msg.skillName, 'done', { analysis: msg.analysis || '' });
      break;
    case 'nodeError':
      updateNode(msg.skillName, 'error', { error: msg.error || '' });
      break;
    case 'result':
      showResult(msg.merged);
      break;
    case 'error':
      setAnalyzing(false); hideEl('wfStatus');
      showErr('analyzeErr', msg.text);
      showErr('inputErr', msg.text);
      break;
    case 'cancelled':
      setAnalyzing(false);
      document.getElementById('wfStatus').textContent = '已取消';
      break;
    case 'browseData':
      renderBrowseData(msg);
      break;
    case 'chatStatus':
      showEl('chatStatus');
      document.getElementById('chatStatus').textContent = msg.text;
      break;
    case 'chatResult':
      setAnalyzing(false); hideEl('chatStatus');
      renderChatResult(msg);
      break;
    case 'chatError':
      setAnalyzing(false); hideEl('chatStatus');
      showErr('chatErr', msg.text);
      break;
    case 'chatCancelled':
      setAnalyzing(false);
      document.getElementById('chatStatus').textContent = '已取消';
      break;
    case 'switchToInput':
      switchBottomTab('input');
      if (msg.requirement) {
        document.getElementById('req').value = msg.requirement;
        vscode.postMessage({ type: 'previewSkills', requirement: msg.requirement });
      }
      break;
  }
});

/* ═══ Init ═══ */
vscode.postMessage({ type: 'requestAllSkills' });
vscode.postMessage({ type: 'requestBrowse' });
</script>
</body>
</html>`;
}
//# sourceMappingURL=PlannerPanel.js.map