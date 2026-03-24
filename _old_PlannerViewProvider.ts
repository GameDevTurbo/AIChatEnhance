import * as vscode from 'vscode';
import { loadMatchingSkills, getAllSkillNames, getSkillDescriptions, scanPromptTemplates } from './SkillLoader';
import { runWorkflow, getAvailableModels, analyzeConversation } from './LmAnalyzer';

export class PlannerViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _cts?: vscode.CancellationTokenSource;
    private _isAnalyzing = false;

    constructor(private readonly _context: vscode.ExtensionContext) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getWebviewHtml();

        webviewView.webview.onDidReceiveMessage(async (msg: {
            type: string;
            requirement?: string;
            text?: string;
            modelIds?: string[];
            conversation?: string;
        }) => {
            switch (msg.type) {
                case 'analyze':          await this._handleAnalyze(msg.requirement ?? '', msg.modelIds ?? []); break;
                case 'cancel':           this._cts?.cancel(); break;
                case 'copy':             await vscode.env.clipboard.writeText(msg.text ?? '');
                    vscode.window.showInformationMessage('已复制到剪贴板');
                    break;
                case 'openChat':         await this._openChat(msg.text ?? ''); break;
                case 'requestModels':    await this._fetchAndSendModels(); break;
                case 'previewSkills':    await this._previewSkills(msg.requirement ?? ''); break;
                case 'requestAllSkills': this._post({ type: 'allSkills', skills: getAllSkillNames() }); break;
                case 'requestBrowse':    await this._sendBrowseData(); break;
                case 'analyzeChat':      await this._handleAnalyzeChat(msg.conversation ?? '', msg.modelIds ?? []); break;
                case 'generatePlanFromTasks': await this._handleGeneratePlan(msg.text ?? '', msg.modelIds ?? []); break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && !this._isAnalyzing) {
                this._post({ type: 'syncState', analyzing: false });
            }
        });
    }

    // ─── 需求分析 ─────────────────────────

    private async _handleAnalyze(requirement: string, modelIds: string[]): Promise<void> {
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
            const skills = await loadMatchingSkills(requirement);
            if (!skills.length) {
                this._post({ type: 'error', text: '未匹配到任何 Skill，请在需求中加入关键词' });
                return;
            }
            this._post({ type: 'workflowStart', skillNames: skills.map(s => s.name) });
            const plan = await runWorkflow(
                requirement, skills, modelIds,
                (n) => this._post({ type: 'nodeStart', skillName: n }),
                (n, a) => this._post({ type: 'nodeDone', skillName: n, analysis: a }),
                (n, e) => this._post({ type: 'nodeError', skillName: n, error: e }),
                (m) => this._post({ type: 'status', text: m }),
                token
            );
            this._post({ type: 'result', merged: plan.merged });
        } catch (err: unknown) {
            if (!token.isCancellationRequested) {
                this._post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            } else {
                this._post({ type: 'cancelled' });
            }
        } finally {
            this._isAnalyzing = false;
        }
    }

    // ─── 对话分析 ─────────────────────────

    private async _handleAnalyzeChat(conversation: string, modelIds: string[]): Promise<void> {
        if (!conversation.trim()) {
            this._post({ type: 'chatError', text: '请粘贴对话内容' });
            return;
        }
        this._cts?.dispose();
        this._cts = new vscode.CancellationTokenSource();
        const token = this._cts.token;
        this._isAnalyzing = true;

        try {
            const result = await analyzeConversation(
                conversation, modelIds,
                (m) => this._post({ type: 'chatStatus', text: m }),
                token
            );
            this._post({ type: 'chatResult', ...result });
        } catch (err: unknown) {
            if (!token.isCancellationRequested) {
                this._post({ type: 'chatError', text: err instanceof Error ? err.message : String(err) });
            } else {
                this._post({ type: 'chatCancelled' });
            }
        } finally {
            this._isAnalyzing = false;
        }
    }

    private async _handleGeneratePlan(tasksJson: string, modelIds: string[]): Promise<void> {
        try {
            const tasks = JSON.parse(tasksJson) as Array<{ title: string; skills: string[] }>;
            const requirement = tasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
            await this._handleAnalyze(requirement, modelIds);
        } catch {
            this._post({ type: 'error', text: '任务数据解析失败' });
        }
    }

    // ─── 浏览面板 ─────────────────────────

    private async _sendBrowseData(): Promise<void> {
        const skills = getSkillDescriptions();
        const prompts = await scanPromptTemplates();
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

    // ─── 共用 ─────────────────────────────

    private async _fetchAndSendModels(): Promise<void> {
        try {
            const models = await getAvailableModels();
            this._post({ type: 'models', models });
        } catch {
            this._post({ type: 'models', models: [] });
        }
    }

    private async _previewSkills(requirement: string): Promise<void> {
        if (!requirement.trim()) {
            this._post({ type: 'matchedSkills', skills: [] });
            return;
        }
        const skills = await loadMatchingSkills(requirement);
        this._post({ type: 'matchedSkills', skills: skills.map(s => s.name) });
    }

    private async _openChat(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
        await vscode.commands.executeCommand('workbench.action.chat.open');
        vscode.window.showInformationMessage('执行计划已复制到剪贴板 — 在 Chat 输入框中 Ctrl+V');
    }

    private _post(msg: object): void {
        this._view?.webview.postMessage(msg);
    }
}

// ─── Webview HTML ─────────────────────────────────

function getWebviewHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root {
  --radius: 4px;
  --gap: 8px;
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
body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family); font-size: 12px; line-height: 1.5; }

/* ─ tabs ─ */
.tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg-card); position: sticky; top: 0; z-index: 10; }
.tab {
  flex: 1; padding: 8px 4px; text-align: center; font-size: 11px; font-weight: 600;
  cursor: pointer; color: var(--fg-dim); border-bottom: 2px solid transparent;
  transition: all .15s; user-select: none;
}
.tab:hover { color: var(--fg); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.page { display: none; padding: 10px; }
.page.active { display: block; }

/* ─ common ─ */
h4 { font-size: 11px; font-weight: 600; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .05em; margin: 0 0 5px; }
textarea {
  width: 100%; min-height: 72px; resize: vertical;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: var(--radius);
  padding: 7px; font-size: 12px; font-family: var(--vscode-font-family); line-height: 1.5;
}
textarea:focus { outline: none; border-color: var(--accent); }
.row { display: flex; gap: 6px; margin-top: 7px; }
button {
  flex: 1; padding: 6px 10px; border: none; border-radius: var(--radius);
  cursor: pointer; font-size: 11px; font-weight: 600;
  background: var(--btn-bg); color: var(--btn-fg);
}
button:hover:not(:disabled) { background: var(--btn-hover); }
button:disabled { opacity: .45; cursor: not-allowed; }
.btn-sec { background: transparent; border: 1px solid var(--border); color: var(--fg-dim); }
.btn-sec:hover:not(:disabled) { border-color: var(--accent); color: var(--fg); }
.btn-sm { flex: none; padding: 4px 8px; font-size: 10px; }
.status-bar {
  margin-top: var(--gap); padding: 6px 10px; background: var(--bg-card);
  border-left: 2px solid var(--accent); font-size: 11px; color: var(--fg-dim);
  white-space: pre-line; border-radius: 0 var(--radius) var(--radius) 0;
}
.err { color: var(--err); margin-top: var(--gap); font-size: 11px; }
.hidden { display: none !important; }

/* ─ skill tags ─ */
.skill-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; min-height: 22px; }
.skill-tag {
  font-size: 10px; padding: 2px 8px; border-radius: 10px;
  border: 1px solid var(--border); color: var(--fg-dim); opacity: .5; transition: all .15s;
}
.skill-tag.active { opacity: 1; border-color: var(--accent); color: var(--fg); background: rgba(0,120,212,.12); }

/* ─ model ─ */
.model-section { margin-top: var(--gap); }
.model-list { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.model-item { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 1px 0; }
.model-item input[type=checkbox] { cursor: pointer; margin: 0; }
.model-item label { cursor: pointer; flex: 1; }
.model-family { font-size: 10px; color: var(--fg-dim); }

/* ─ workflow nodes ─ */
.wf-section { margin-top: 10px; }
.wf-label {
  font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--fg-dim); margin-bottom: 5px; display: flex; align-items: center; gap: 5px;
}
.wf-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.wf-nodes { display: flex; flex-direction: column; gap: 4px; }
.wf-card { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: border-color .15s; }
.wf-card.done { border-color: rgba(78,201,176,.4); }
.wf-card.error { border-color: rgba(244,135,113,.4); }
.wf-head {
  padding: 5px 9px; display: flex; align-items: center; gap: 7px;
  cursor: pointer; user-select: none; font-size: 11px; font-weight: 600; background: var(--bg-card);
}
.wf-head:hover { background: var(--vscode-list-hoverBackground); }
.wf-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.wf-dot-idle { background: var(--fg-dim); opacity: .4; }
.wf-dot-running { background: var(--vscode-progressBar-background, #0078d4); animation: pulse .9s infinite; }
.wf-dot-done { background: var(--ok); }
.wf-dot-error { background: var(--err); }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
.wf-name { flex: 1; }
.wf-tag { font-size: 10px; color: var(--fg-dim); font-weight: 400; }
.wf-body {
  padding: 8px 10px; font-size: 11px; line-height: 1.65;
  white-space: pre-wrap; color: var(--fg);
  border-top: 1px solid var(--border); display: none;
}
.wf-body.open { display: block; }

/* ─ plan box ─ */
.plan-box { margin-top: 10px; border: 1px solid var(--accent); border-radius: var(--radius); overflow: hidden; }
.plan-head { padding: 6px 10px; background: var(--bg-card); font-size: 11px; font-weight: 700; color: var(--accent); border-bottom: 1px solid var(--border); }
.plan-body { padding: 10px; font-size: 11px; line-height: 1.75; white-space: pre-wrap; }
.act-row { display: flex; gap: 6px; margin-top: 6px; }

/* ─ browse ─ */
.browse-card { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 6px; overflow: hidden; }
.browse-head {
  padding: 6px 10px; background: var(--bg-card);
  font-size: 11px; font-weight: 600; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 6px;
}
.browse-head:hover { background: var(--vscode-list-hoverBackground); }
.browse-icon { width: 16px; text-align: center; font-size: 12px; flex-shrink: 0; }
.browse-name { flex: 1; }
.browse-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 8px;
  background: rgba(0,120,212,.15); color: var(--accent);
}
.browse-body {
  padding: 8px 10px; font-size: 11px; line-height: 1.6;
  border-top: 1px solid var(--border); color: var(--fg-dim); display: none;
}
.browse-body.open { display: block; }
.browse-kw { font-size: 10px; color: var(--fg-dim); margin-top: 4px; }
.browse-kw span { background: rgba(255,255,255,.06); padding: 1px 5px; border-radius: 3px; margin-right: 3px; }
.browse-empty { text-align: center; padding: 20px; color: var(--fg-dim); font-size: 11px; }

/* ─ chat analysis ─ */
.task-card { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 6px; padding: 8px 10px; }
.task-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.task-id { font-size: 10px; font-weight: 700; color: var(--accent); min-width: 22px; }
.task-title { font-size: 11px; font-weight: 600; flex: 1; }
.task-priority { font-size: 9px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.task-priority-high { background: rgba(244,135,113,.2); color: var(--err); }
.task-priority-medium { background: rgba(255,200,50,.2); color: #e5c07b; }
.task-priority-low { background: rgba(78,201,176,.2); color: var(--ok); }
.task-desc { font-size: 11px; color: var(--fg-dim); line-height: 1.5; margin-bottom: 4px; }
.task-skills { display: flex; flex-wrap: wrap; gap: 3px; }
.task-skill-tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(0,120,212,.1); color: var(--accent); }
.chat-summary {
  padding: 8px 10px; background: var(--bg-card); border-left: 2px solid var(--ok);
  border-radius: 0 var(--radius) var(--radius) 0; font-size: 11px; margin-bottom: var(--gap);
}
</style>
</head>
<body>

<!-- ── tab nav ── -->
<div class="tabs">
  <div class="tab active" data-tab="plan" onclick="switchTab('plan')">&#9889; 规划</div>
  <div class="tab" data-tab="browse" onclick="switchTab('browse')">&#128194; 浏览</div>
  <div class="tab" data-tab="chat" onclick="switchTab('chat')">&#128172; 对话分析</div>
</div>

<!-- ══ Tab 1: Plan ══ -->
<div id="page-plan" class="page active">
  <h4>需求描述</h4>
  <textarea id="req"
    placeholder="描述你要做什么，例如：给战斗系统新增倒计时奖励，关卡结束前完成给额外分数"
    oninput="onReqInput()"></textarea>

  <div id="skillPreview">
    <h4 style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
      <span>匹配 Skills</span>
      <span style="font-size:10px;font-weight:400;color:var(--fg-dim);" id="skillHint">输入需求后自动匹配</span>
    </h4>
    <div id="skillTags" class="skill-tags"></div>
  </div>

  <div class="model-section">
    <h4 style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
      <span>模型选择</span>
      <span id="modelRefreshBtn" onclick="loadModels()"
        style="cursor:pointer;font-size:10px;color:var(--vscode-textLink-foreground);font-weight:400;text-transform:none;">
        &#128260; 加载模型</span>
    </h4>
    <div id="modelList" class="model-list">
      <div class="model-item">
        <input type="checkbox" id="m_auto" value="" checked>
        <label for="m_auto">自动选择 <span class="model-family">(推荐)</span></label>
      </div>
    </div>
  </div>

  <div class="row">
    <button id="analyzeBtn" onclick="analyze()">&#9889; 启动工作流</button>
    <button id="cancelBtn" class="btn-sec hidden" onclick="cancel()">&#10005; 取消</button>
  </div>
  <div id="statusEl" class="status-bar hidden"></div>
  <div id="wfSection" class="wf-section hidden">
    <div class="wf-label">工作流节点</div>
    <div id="wfNodes" class="wf-nodes"></div>
  </div>
  <div id="planEl" class="plan-box hidden">
    <div class="plan-head">&#128203; 综合执行计划</div>
    <div id="planBody" class="plan-body"></div>
  </div>
  <div id="actRow" class="act-row hidden">
    <button onclick="copyPlan()">&#128203; 复制计划</button>
    <button class="btn-sec" onclick="openChat()">&#128172; 发送到 Chat</button>
  </div>
  <div id="errEl" class="err hidden"></div>
</div>

<!-- ══ Tab 2: Browse ══ -->
<div id="page-browse" class="page">
  <h4 style="display:flex;justify-content:space-between;align-items:center;">
    <span>Skills</span>
    <button class="btn-sm btn-sec" onclick="refreshBrowse()">&#8634; 刷新</button>
  </h4>
  <div id="browseSkills"></div>

  <h4 style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
    <span>Prompt 模板</span>
    <span style="font-size:10px;color:var(--fg-dim);font-weight:400;">.prompt.md</span>
  </h4>
  <div id="browsePrompts"></div>
</div>

<!-- ══ Tab 3: Chat Analysis ══ -->
<div id="page-chat" class="page">
  <h4>粘贴对话内容</h4>
  <textarea id="chatInput" style="min-height:120px;"
    placeholder="粘贴你和AI的聊天记录、需求讨论、或任何混乱的对话内容...&#10;&#10;多个AI视角将并行分析并提取结构化任务。"></textarea>

  <div class="row">
    <button id="chatAnalyzeBtn" onclick="analyzeChat()">&#128269; 提取任务</button>
    <button id="chatCancelBtn" class="btn-sec hidden" onclick="cancel()">&#10005; 取消</button>
  </div>
  <div id="chatStatusEl" class="status-bar hidden"></div>
  <div id="chatSummary" class="chat-summary hidden"></div>
  <div id="chatTasks"></div>
  <div id="chatActRow" class="act-row hidden">
    <button onclick="generatePlanFromTasks()">&#9889; 生成执行计划</button>
    <button class="btn-sec" onclick="copyChatTasks()">&#128203; 复制任务列表</button>
  </div>
  <div id="chatErrEl" class="err hidden"></div>
</div>

<script>
var vscode = acquireVsCodeApi();
var planText = '';
var allSkillNames = [];
var matchedSkillNames = [];
var previewTimer = null;
var chatTasksData = [];

/* ─── Tab switching ─── */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.page').forEach(function(p) { p.classList.toggle('active', p.id === 'page-' + tab); });
  if (tab === 'browse') { refreshBrowse(); }
}

/* ─── Model selection ─── */
function getSelectedModelIds() {
  return Array.from(document.querySelectorAll('#modelList input[type=checkbox]:checked'))
    .map(function(cb) { return cb.value; })
    .filter(function(v) { return v !== ''; });
}
function loadModels() {
  var btn = document.getElementById('modelRefreshBtn');
  if (btn) btn.textContent = '加载中...';
  vscode.postMessage({ type: 'requestModels' });
}

/* ─── Tab 1: Planning ─── */
function onReqInput() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(function() {
    vscode.postMessage({ type: 'previewSkills', requirement: document.getElementById('req').value.trim() });
  }, 300);
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
function analyze() {
  var req = document.getElementById('req').value.trim();
  if (!req) { showErr('errEl', '请先输入需求描述'); return; }
  setAnalyzing(true);
  hide(['wfSection','planEl','actRow','errEl','statusEl']);
  document.getElementById('wfNodes').innerHTML = '';
  showStatus('statusEl', '正在匹配 Skills...');
  vscode.postMessage({ type: 'analyze', requirement: req, modelIds: getSelectedModelIds() });
}
function cancel() { vscode.postMessage({ type: 'cancel' }); setAnalyzing(false); }
function copyPlan() { vscode.postMessage({ type: 'copy', text: planText }); }
function openChat() { vscode.postMessage({ type: 'openChat', text: planText }); }
function setAnalyzing(on) {
  var ab = document.getElementById('analyzeBtn'); if (ab) ab.disabled = on;
  var cb = document.getElementById('cancelBtn'); if (cb) cb.classList.toggle('hidden', !on);
  var cab = document.getElementById('chatAnalyzeBtn'); if (cab) cab.disabled = on;
  var ccb = document.getElementById('chatCancelBtn'); if (ccb) ccb.classList.toggle('hidden', !on);
}
function setNodeStatus(skillName, status, text) {
  var card = document.getElementById('card-' + escId(skillName));
  if (!card) return;
  var dot = card.querySelector('.wf-dot'), tag = card.querySelector('.wf-tag'), body = card.querySelector('.wf-body');
  dot.className = 'wf-dot wf-dot-' + status;
  card.className = 'wf-card' + (status === 'done' || status === 'error' ? ' ' + status : '');
  if (status === 'running') { tag.textContent = '分析中...'; body.innerHTML = '<i style="color:var(--fg-dim)">正在分析...</i>'; body.classList.add('open'); }
  else if (status === 'done') { tag.textContent = '\u2713 完成'; body.textContent = text || ''; }
  else if (status === 'error') { tag.textContent = '\u2717 错误'; body.textContent = text || ''; body.classList.add('open'); }
}
function toggleBody(id) { document.getElementById(id).classList.toggle('open'); }

/* ─── Tab 2: Browse ─── */
function refreshBrowse() { vscode.postMessage({ type: 'requestBrowse' }); }
function renderBrowseData(data) {
  var skillsEl = document.getElementById('browseSkills');
  var promptsEl = document.getElementById('browsePrompts');
  if (!data.skills || !data.skills.length) {
    skillsEl.innerHTML = '<div class="browse-empty">未找到 Skill 文件</div>';
  } else {
    skillsEl.innerHTML = data.skills.map(function(s) {
      var kws = (s.keywords || []).slice(0, 6);
      return '<div class="browse-card">' +
        '<div class="browse-head" onclick="toggleBody(\\'bb-' + escId(s.name) + '\\')">' +
        '<span class="browse-icon">' + (s.hasFile ? '\uD83D\uDCC4' : '\uD83D\uDCE6') + '</span>' +
        '<span class="browse-name">' + esc(s.name) + '</span>' +
        (s.hasFile ? '<span class="browse-badge">文件</span>' : '<span class="browse-badge" style="background:rgba(255,200,50,.15);color:#e5c07b;">内置</span>') +
        '</div>' +
        '<div class="browse-body" id="bb-' + escId(s.name) + '">' +
        (kws.length ? '<div class="browse-kw">关键词：' + kws.map(function(k){ return '<span>' + esc(k) + '</span>'; }).join('') + '</div>' : '') +
        '</div></div>';
    }).join('');
  }
  if (!data.prompts || !data.prompts.length) {
    promptsEl.innerHTML = '<div class="browse-empty">未找到 .prompt.md 模板</div>';
  } else {
    promptsEl.innerHTML = data.prompts.map(function(p) {
      return '<div class="browse-card">' +
        '<div class="browse-head" onclick="toggleBody(\\'bp-' + escId(p.name) + '\\')">' +
        '<span class="browse-icon">\uD83D\uDCDD</span>' +
        '<span class="browse-name">' + esc(p.name) + '</span>' +
        '</div>' +
        '<div class="browse-body" id="bp-' + escId(p.name) + '">' +
        '<div>' + esc(p.description) + '</div>' +
        '<div class="browse-kw" style="margin-top:2px;">' + esc(p.filePath) + '</div>' +
        '</div></div>';
    }).join('');
  }
}

/* ─── Tab 3: Chat analysis ─── */
function analyzeChat() {
  var text = document.getElementById('chatInput').value.trim();
  if (!text) { showErr('chatErrEl', '请粘贴对话内容'); return; }
  setAnalyzing(true);
  hide(['chatSummary','chatErrEl','chatStatusEl','chatActRow']);
  document.getElementById('chatTasks').innerHTML = '';
  showStatus('chatStatusEl', '多视角并行分析中...');
  vscode.postMessage({ type: 'analyzeChat', conversation: text, modelIds: getSelectedModelIds() });
}
function renderChatResult(data) {
  chatTasksData = data.tasks || [];
  var summaryEl = document.getElementById('chatSummary');
  summaryEl.textContent = data.summary || '';
  show('chatSummary');
  var el = document.getElementById('chatTasks');
  if (!chatTasksData.length) {
    el.innerHTML = '<div class="browse-empty">未提取到任务</div>';
    return;
  }
  el.innerHTML = chatTasksData.map(function(t) {
    return '<div class="task-card">' +
      '<div class="task-header">' +
      '<span class="task-id">#' + t.id + '</span>' +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      '<span class="task-priority task-priority-' + (t.priority||'medium') + '">' + (t.priority||'medium') + '</span>' +
      '</div>' +
      '<div class="task-desc">' + esc(t.description) + '</div>' +
      (t.skills && t.skills.length ? '<div class="task-skills">' + t.skills.map(function(s){ return '<span class="task-skill-tag">' + esc(s) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';
  }).join('');
  show('chatActRow');
}
function generatePlanFromTasks() {
  vscode.postMessage({ type: 'generatePlanFromTasks', text: JSON.stringify(chatTasksData), modelIds: getSelectedModelIds() });
  switchTab('plan');
}
function copyChatTasks() {
  var text = chatTasksData.map(function(t,i) {
    return (i+1) + '. [' + t.priority + '] ' + t.title + '\\n   ' + t.description +
    (t.skills && t.skills.length ? '\\n   Skills: ' + t.skills.join(', ') : '');
  }).join('\\n\\n');
  vscode.postMessage({ type: 'copy', text: text });
}

/* ─── utils ─── */
function showStatus(id, t) { var el = document.getElementById(id); el.textContent = t; el.classList.remove('hidden'); }
function showErr(id, t) { var el = document.getElementById(id); el.textContent = '\u274C ' + t; el.classList.remove('hidden'); }
function hide(ids) { ids.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }); }
function show(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escId(s) { return String(s).replace(/[^a-zA-Z0-9_\\-]/g, '_'); }

/* ─── message handler ─── */
window.addEventListener('message', function(e) {
  var msg = e.data;
  switch (msg.type) {
    case 'status': showStatus('statusEl', msg.text); break;
    case 'workflowStart':
      var nodesEl = document.getElementById('wfNodes');
      nodesEl.innerHTML = (msg.skillNames||[]).map(function(name) {
        var sid = escId(name);
        return '<div class="wf-card" id="card-'+sid+'"><div class="wf-head" onclick="toggleBody(\\'body-'+sid+'\\')"><div class="wf-dot wf-dot-idle"></div><span class="wf-name">'+esc(name)+'</span><span class="wf-tag">等待</span></div><div class="wf-body" id="body-'+sid+'"></div></div>';
      }).join('');
      show('wfSection');
      break;
    case 'nodeStart':  setNodeStatus(msg.skillName, 'running', ''); break;
    case 'nodeDone':   setNodeStatus(msg.skillName, 'done', msg.analysis); break;
    case 'nodeError':  setNodeStatus(msg.skillName, 'error', msg.error); break;
    case 'result':
      setAnalyzing(false); hide(['statusEl']);
      planText = msg.merged;
      document.getElementById('planBody').textContent = planText;
      show('planEl'); show('actRow');
      break;
    case 'error':
      setAnalyzing(false); hide(['statusEl']);
      showErr('errEl', msg.text);
      break;
    case 'cancelled':
      setAnalyzing(false); showStatus('statusEl', '已取消');
      break;
    case 'models':     renderModels(msg.models || []); break;
    case 'syncState':  if (!msg.analyzing) setAnalyzing(false); break;
    case 'allSkills':  allSkillNames = msg.skills || []; renderSkillTags(); break;
    case 'matchedSkills': matchedSkillNames = msg.skills || []; renderSkillTags(); break;
    case 'browseData': renderBrowseData(msg); break;
    case 'chatStatus': showStatus('chatStatusEl', msg.text); break;
    case 'chatResult':
      setAnalyzing(false); hide(['chatStatusEl']);
      renderChatResult(msg);
      break;
    case 'chatError':
      setAnalyzing(false); hide(['chatStatusEl']);
      showErr('chatErrEl', msg.text);
      break;
    case 'chatCancelled':
      setAnalyzing(false); showStatus('chatStatusEl', '已取消');
      break;
  }
});

function renderModels(models) {
  var list = document.getElementById('modelList');
  var btn = document.getElementById('modelRefreshBtn');
  if (btn) btn.textContent = '\u21BA 刷新';
  if (!models.length) {
    list.innerHTML = '<div class="model-item"><input type="checkbox" id="m_auto" value="" checked><label for="m_auto">自动选择 <span class="model-family">(推荐)</span></label></div>';
    return;
  }
  list.innerHTML =
    '<div class="model-item"><input type="checkbox" id="m_auto" value=""><label for="m_auto">自动选择</label></div>' +
    models.map(function(m, i) {
      var fam = m.family ? ' <span class="model-family">('+esc(m.family)+')</span>' : '';
      return '<div class="model-item"><input type="checkbox" id="m'+i+'" value="'+escAttr(m.id)+'"><label for="m'+i+'">'+esc(m.name)+fam+'</label></div>';
    }).join('');
}

/* ─── init ─── */
vscode.postMessage({ type: 'requestAllSkills' });
var initReq = document.getElementById('req').value.trim();
if (initReq) vscode.postMessage({ type: 'previewSkills', requirement: initReq });
</script>
</body>
</html>`;
}
