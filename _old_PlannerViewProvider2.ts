import * as vscode from 'vscode';
import { loadMatchingSkills, getAllSkillNames } from './SkillLoader';
import { runWorkflow, getAvailableModels } from './LmAnalyzer';

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

        webviewView.webview.onDidReceiveMessage(async (msg: { type: string; requirement?: string; text?: string; modelIds?: string[] }) => {
            switch (msg.type) {
                case 'analyze':        await this._handleAnalyze(msg.requirement ?? '', msg.modelIds ?? []); break;
                case 'cancel':         this._cts?.cancel(); break;
                case 'copy':           await vscode.env.clipboard.writeText(msg.text ?? '');
                    vscode.window.showInformationMessage('执行计划已复制，粘贴进 Copilot Chat 即可');
                    break;
                case 'openChat':       await this._openChat(msg.text ?? ''); break;
                case 'requestModels':  await this._fetchAndSendModels(); break;
                case 'previewSkills':  await this._previewSkills(msg.requirement ?? ''); break;
                case 'requestAllSkills': this._post({ type: 'allSkills', skills: getAllSkillNames() }); break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && !this._isAnalyzing) {
                this._post({ type: 'syncState', analyzing: false });
            }
        });
    }

    private async _handleAnalyze(requirement: string, modelIds: string[]): Promise<void> {
        if (!requirement.trim()) {
            this._post({ type: 'error', text: '⚠️ 请先输入需求描述' });
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
                this._post({ type: 'error', text: '未匹配到任何 Skill，请在需求中加入关键词（如“战斗”、“UI”、“事件”等）' });
                return;
            }

            this._post({ type: 'workflowStart', skillNames: skills.map(s => s.name) });

            const plan = await runWorkflow(
                requirement,
                skills,
                modelIds,
                (skillName) => this._post({ type: 'nodeStart', skillName }),
                (skillName, analysis) => this._post({ type: 'nodeDone', skillName, analysis }),
                (skillName, error) => this._post({ type: 'nodeError', skillName, error }),
                (msg: string) => this._post({ type: 'status', text: msg }),
                token
            );

            this._post({ type: 'result', merged: plan.merged });
        } catch (err: unknown) {
            if (!token.isCancellationRequested) {
                const msg = err instanceof Error ? err.message : String(err);
                this._post({ type: 'error', text: msg });
            } else {
                this._post({ type: 'cancelled' });
            }
        } finally {
            this._isAnalyzing = false;
        }
    }

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

function getWebviewHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{
  background:var(--vscode-editor-background);
  color:var(--vscode-editor-foreground);
  font-family:var(--vscode-font-family);
  font-size:12px;padding:10px;line-height:1.5;
}
h4{font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);
  text-transform:uppercase;letter-spacing:.05em;margin:0 0 5px;}
textarea{
  width:100%;min-height:72px;resize:vertical;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,#555);
  border-radius:3px;padding:7px;font-size:12px;
  font-family:var(--vscode-font-family);line-height:1.5;
}
textarea:focus{outline:none;border-color:var(--vscode-focusBorder);}
.row{display:flex;gap:6px;margin-top:7px;}
button{
  flex:1;padding:6px 10px;border:none;border-radius:3px;
  cursor:pointer;font-size:11px;font-weight:600;
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
}
button:hover:not(:disabled){background:var(--vscode-button-hoverBackground);}
button:disabled{opacity:.45;cursor:not-allowed;}
.btn-sec{
  background:transparent;
  border:1px solid var(--vscode-button-secondaryBackground,#555);
  color:var(--vscode-descriptionForeground);
}
.btn-sec:hover:not(:disabled){border-color:var(--vscode-focusBorder);color:var(--vscode-foreground);}
.status{
  margin-top:8px;padding:6px 10px;
  background:var(--vscode-editorWidget-background);
  border-left:2px solid var(--vscode-focusBorder);
  font-size:11px;color:var(--vscode-descriptionForeground);
  white-space:pre-line;border-radius:0 3px 3px 0;
}
/* 模型选择 */
.model-section{margin-top:8px;}
.model-list{display:flex;flex-direction:column;gap:2px;margin-top:4px;}
.model-item{display:flex;align-items:center;gap:5px;font-size:11px;padding:1px 0;}
.model-item input[type=checkbox]{cursor:pointer;margin:0;}
.model-item label{cursor:pointer;flex:1;}
.model-family{font-size:10px;color:var(--vscode-descriptionForeground);}
/* 工作流节点卡片 */
.wf-section{margin-top:10px;}
.wf-label{
  font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--vscode-descriptionForeground);margin-bottom:5px;
  display:flex;align-items:center;gap:5px;
}
.wf-label::after{content:'';flex:1;height:1px;background:var(--vscode-panel-border,#444);}
.wf-nodes{display:flex;flex-direction:column;gap:4px;}
.wf-card{border:1px solid var(--vscode-panel-border,#444);border-radius:3px;overflow:hidden;transition:border-color .15s;}
.wf-card.done{border-color:rgba(78,201,176,.4);}
.wf-card.error{border-color:rgba(244,135,113,.4);}
.wf-head{
  padding:5px 9px;display:flex;align-items:center;gap:7px;
  cursor:pointer;user-select:none;font-size:11px;font-weight:600;
  background:var(--vscode-editorWidget-background);
}
.wf-head:hover{background:var(--vscode-list-hoverBackground);}
.wf-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.wf-dot-idle{background:var(--vscode-descriptionForeground);opacity:.4;}
.wf-dot-running{background:var(--vscode-progressBar-background,#0078d4);animation:pulse .9s infinite;}
.wf-dot-done{background:#4ec9b0;}
.wf-dot-error{background:var(--vscode-errorForeground,#f48771);}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.wf-name{flex:1;}
.wf-tag{font-size:10px;color:var(--vscode-descriptionForeground);font-weight:400;}
.wf-body{
  padding:8px 10px;font-size:11px;line-height:1.65;
  white-space:pre-wrap;color:var(--vscode-editor-foreground);
  border-top:1px solid var(--vscode-panel-border,#444);
  display:none;
}
.wf-body.open{display:block;}
/* 执行计划 */
.plan-box{margin-top:10px;border:1px solid var(--vscode-focusBorder);border-radius:3px;overflow:hidden;}
.plan-head{
  padding:6px 10px;background:var(--vscode-editorWidget-background);
  font-size:11px;font-weight:700;color:var(--vscode-focusBorder);
  border-bottom:1px solid var(--vscode-panel-border,#444);
}
.plan-body{padding:10px;font-size:11px;line-height:1.75;white-space:pre-wrap;}
.act-row{display:flex;gap:6px;margin-top:6px;}
.hidden{display:none!important;}
.err{color:var(--vscode-errorForeground);margin-top:8px;font-size:11px;}
/* Skill 标签预览 */
.skill-preview{margin-top:6px;}
.skill-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;min-height:22px;}
.skill-tag{
  font-size:10px;padding:2px 8px;border-radius:10px;
  border:1px solid var(--vscode-panel-border,#444);
  color:var(--vscode-descriptionForeground);opacity:.5;
  transition:all .15s;
}
.skill-tag.active{
  opacity:1;
  border-color:var(--vscode-focusBorder);
  color:var(--vscode-foreground);
  background:rgba(0,120,212,.12);
}
</style>
</head>
<body>
<h4>需求描述</h4>
<textarea id="req"
  placeholder="描述你要做什么，例如：给战斗系统新增倒计时奖励，关卡结束前完成给额外分数"
  oninput="onReqInput()"></textarea>

<div id="skillPreview" class="skill-preview">
  <h4 style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
    <span>匹配 Skills</span>
    <span style="font-size:10px;font-weight:400;color:var(--vscode-descriptionForeground);" id="skillHint">输入需求后自动匹配</span>
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
  <button id="analyzeBtn" onclick="analyze()">⚡ 启动工作流</button>
  <button id="cancelBtn" class="btn-sec hidden" onclick="cancel()">✕ 取消</button>
</div>

<div id="statusEl" class="status hidden"></div>

<div id="wfSection" class="wf-section hidden">
  <div class="wf-label">工作流节点</div>
  <div id="wfNodes" class="wf-nodes"></div>
</div>

<div id="planEl" class="plan-box hidden">
  <div class="plan-head">📋 综合执行计划</div>
  <div id="planBody" class="plan-body"></div>
</div>
<div id="actRow" class="act-row hidden">
  <button onclick="copyPlan()">📋 复制计划</button>
  <button class="btn-sec" onclick="openChat()">💬 发送到 Chat</button>
</div>
<div id="errEl" class="err hidden"></div>

<script>
const vscode = acquireVsCodeApi();
let planText = '';
let allSkillNames = [];
let matchedSkillNames = [];
let previewTimer = null;

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

function onReqInput() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(function() {
    var req = document.getElementById('req').value.trim();
    vscode.postMessage({ type: 'previewSkills', requirement: req });
  }, 300);
}

function renderSkillTags() {
  var el = document.getElementById('skillTags');
  var hint = document.getElementById('skillHint');
  if (!allSkillNames.length) { el.innerHTML = ''; return; }
  el.innerHTML = allSkillNames.map(function(name) {
    var active = matchedSkillNames.indexOf(name) !== -1;
    return '<span class="skill-tag' + (active ? ' active' : '') + '">' + escHtml(name) + '</span>';
  }).join('');
  var count = matchedSkillNames.filter(function(n) { return n !== 'SKILL'; }).length;
  hint.textContent = count > 0
    ? count + ' 个 Skill 已匹配（SKILL 索引始终加载）'
    : '输入需求后自动匹配';
}

function analyze() {
  var req = document.getElementById('req').value.trim();
  if (!req) { showErr('⚠️ 请先输入需求描述'); return; }
  setAnalyzing(true);
  hide(['wfSection','planEl','actRow','errEl','statusEl']);
  document.getElementById('wfNodes').innerHTML = '';
  showStatus('正在匹配 Skills...');
  vscode.postMessage({ type: 'analyze', requirement: req, modelIds: getSelectedModelIds() });
}
function cancel() { vscode.postMessage({ type: 'cancel' }); setAnalyzing(false); }
function copyPlan() { vscode.postMessage({ type: 'copy', text: planText }); }
function openChat() { vscode.postMessage({ type: 'openChat', text: planText }); }

function setAnalyzing(on) {
  document.getElementById('analyzeBtn').disabled = on;
  document.getElementById('cancelBtn').classList.toggle('hidden', !on);
}
function showStatus(t) {
  var el = document.getElementById('statusEl');
  el.textContent = t; el.classList.remove('hidden');
}
function hide(ids) { ids.forEach(function(id){ document.getElementById(id).classList.add('hidden'); }); }
function show(id)  { document.getElementById(id).classList.remove('hidden'); }
function toggleBody(id) { document.getElementById(id).classList.toggle('open'); }

function setNodeStatus(skillName, status, text) {
  var card = document.getElementById('card-' + escId(skillName));
  if (!card) return;
  var dot  = card.querySelector('.wf-dot');
  var tag  = card.querySelector('.wf-tag');
  var body = card.querySelector('.wf-body');
  dot.className = 'wf-dot wf-dot-' + status;
  card.className = 'wf-card' + (status === 'done' || status === 'error' ? ' ' + status : '');
  if (status === 'running') {
    tag.textContent = '分析中...';
    body.innerHTML = '<span style="color:var(--vscode-descriptionForeground);font-style:italic;">正在分析...</span>';
    body.classList.add('open');
  } else if (status === 'done') {
    tag.textContent = '✓ 完成';
    body.textContent = text || '';
  } else if (status === 'error') {
    tag.textContent = '✗ 错误';
    body.textContent = text || '';
    body.classList.add('open');
  }
}

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (msg.type === 'status') {
    showStatus(msg.text);
  }
  else if (msg.type === 'workflowStart') {
    var nodesEl = document.getElementById('wfNodes');
    nodesEl.innerHTML = (msg.skillNames || []).map(function(name) {
      var safeId = escId(name);
      return '<div class="wf-card" id="card-' + safeId + '">' +
        '<div class="wf-head" onclick="toggleBody(\'body-' + safeId + '\')">' +
        '<div class="wf-dot wf-dot-idle"></div>' +
        '<span class="wf-name">' + escHtml(name) + '</span>' +
        '<span class="wf-tag">等待</span>' +
        '</div>' +
        '<div class="wf-body" id="body-' + safeId + '"></div>' +
        '</div>';
    }).join('');
    show('wfSection');
  }
  else if (msg.type === 'nodeStart') { setNodeStatus(msg.skillName, 'running', ''); }
  else if (msg.type === 'nodeDone')  { setNodeStatus(msg.skillName, 'done', msg.analysis); }
  else if (msg.type === 'nodeError') { setNodeStatus(msg.skillName, 'error', msg.error); }
  else if (msg.type === 'result') {
    setAnalyzing(false);
    hide(['statusEl']);
    planText = msg.merged;
    document.getElementById('planBody').textContent = planText;
    show('planEl'); show('actRow');
  }
  else if (msg.type === 'error') {
    setAnalyzing(false);
    hide(['statusEl']);
    showErr('❌ ' + msg.text);
  }
  else if (msg.type === 'cancelled') {
    setAnalyzing(false);
    showStatus('已取消');
  }
  else if (msg.type === 'models')    { renderModels(msg.models || []); }
  else if (msg.type === 'syncState') { if (!msg.analyzing) { setAnalyzing(false); } }
  else if (msg.type === 'allSkills') { allSkillNames = msg.skills || []; renderSkillTags(); }
  else if (msg.type === 'matchedSkills') { matchedSkillNames = msg.skills || []; renderSkillTags(); }
});

function showErr(t) { var el = document.getElementById('errEl'); el.textContent = t; show('errEl'); }

function renderModels(models) {
  var list = document.getElementById('modelList');
  var btn  = document.getElementById('modelRefreshBtn');
  if (btn) btn.textContent = '↺ 刷新';
  if (!models.length) {
    list.innerHTML = '<div class="model-item"><input type="checkbox" id="m_auto" value="" checked>' +
      '<label for="m_auto">自动选择 <span class="model-family">(推荐)</span></label></div>';
    return;
  }
  list.innerHTML =
    '<div class="model-item"><input type="checkbox" id="m_auto" value=""><label for="m_auto">自动选择</label></div>' +
    models.map(function(m, i) {
      var fam = m.family ? ' <span class="model-family">('+escHtml(m.family)+')</span>' : '';
      return '<div class="model-item"><input type="checkbox" id="m'+i+'" value="'+escAttr(m.id)+'">' +
        '<label for="m'+i+'">'+escHtml(m.name)+fam+'</label></div>';
    }).join('');
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escId(s)   { return String(s).replace(/[^a-zA-Z0-9_-]/g,'_'); }

// 页面初始化：请求所有 Skill 名称
vscode.postMessage({ type: 'requestAllSkills' });
// 若输入框已有内容（retainContext），立即触发预览
var initReq = document.getElementById('req').value.trim();
if (initReq) { vscode.postMessage({ type: 'previewSkills', requirement: initReq }); }
</script>
</body>
</html>`;
}
