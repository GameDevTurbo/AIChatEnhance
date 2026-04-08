// @ts-nocheck
/* eslint-disable */
'use strict';

const vscode = acquireVsCodeApi();
let currentStep = 1;
let stepReached = 1;
let inputMode = 'requirement';
let planText = '';
let planEdited = '';
let planEditMode = false;
let _autoPlanTimer = null;
let allSkillNames = [];
let matchedSkillNames = [];
let previewTimer = null;

/* === Event Delegation === */
document.addEventListener('click', function(e) {
  let el = e.target;
  while (el && el !== document.body) {
    const action = el.getAttribute('data-action');
    if (action) { handleAction(action, el); return; }
    el = el.parentElement;
  }
});

function handleAction(action, el) {
  const param = el.getAttribute('data-param') || '';
  switch (action) {
    case 'goStep':
      // 从当前步骤向前跳时，标记当前步骤已完成
      if (parseInt(param) > currentStep) { markStepDone(currentStep); }
      goToStep(parseInt(param)); break;
    case 'setMode':         setInputMode(param); break;
    case 'loadModels':      vscode.postMessage({ type: 'requestModels' }); break;
    case 'startAnalyze':    startAnalyze(); break;
    case 'cancel':          vscode.postMessage({ type: 'cancel' }); setAnalyzing(false); break;
    case 'extractChat':     extractChat(); break;
    case 'copyAnalysis':    copyAnalysis(param); break;
    case 'copyPlan':        vscode.postMessage({ type: 'copy', text: getEffectivePlan() }); break;
    case 'attachImages':    vscode.postMessage({ type: 'attachImages' }); break;
    case 'removeImage':     vscode.postMessage({ type: 'removeImage', index: parseInt(param) }); break;
    case 'regeneratePlan':  doRegeneratePlan(); break;
    case 'togglePlanEdit':  togglePlanEdit(); break;
    case 'executeToChat':   executeToChat(); break;
    case 'toggleUpper':     toggleUpperPanel(); break;
    case 'goToPlan':        goToPlan(); break;
    case 'switchModelTab':  switchModelTab(param); break;
    case 'toggleModelExpand': toggleModelExpand(); break;
    case 'toggleModelSection': toggleModelSection(); break;
    case 'cancelAutoPlan':    cancelAutoPlan(); break;
    case 'toggleHistory':       toggleHistoryPanel(); break;
    case 'clearHistory':         clearAllHistory(); break;
    case 'loadHistoryItem':      loadHistoryItem(parseInt(param)); break;
  }
}

let _saveReqTimer = null;
document.addEventListener('input', function(e) {
  if (e.target.id === 'req') {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function() {
      vscode.postMessage({ type: 'previewSkills', requirement: e.target.value.trim() });
    }, 300);
    clearTimeout(_saveReqTimer);
    _saveReqTimer = setTimeout(autoSaveSettings, 500);
  }
});

document.addEventListener('change', function(e) {
  if (e.target.name === 'primaryModel') { syncPrimaryCheckboxes(); }
  updateModelCount();
  if (e.target.id === 'attachSkills' || e.target.id === 'attachImages' || e.target.id === 'attachAnalysis') {
    requestTokenEstimate();
    autoSaveSettings();
  }
});

/* === Stepper === */
function goToStep(n) {
  if (n < 1 || n > 4) { return; }
  currentStep = n;
  const items = document.querySelectorAll('.step-item');
  const lines = document.querySelectorAll('.step-line');
  items.forEach(function(item, i) {
    const stepN = i + 1;
    item.classList.remove('active', 'done');
    if (stepN === currentStep) { item.classList.add('active'); }
    else if (stepN < stepReached) { item.classList.add('done'); }
  });
  lines.forEach(function(line, i) {
    line.classList.toggle('done', i + 1 < stepReached);
  });
  document.querySelectorAll('.step-page').forEach(function(p, i) {
    p.classList.toggle('active', i + 1 === currentStep);
  });
  if (n === 4) { updateExecPreview(); }
}

function markStepDone(n) {
  if (n >= stepReached) { stepReached = n + 1; }
  goToStep(currentStep);
}

/* === Input Mode === */
function setInputMode(mode) {
  inputMode = mode;
  document.querySelectorAll('.mode-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-param') === mode);
  });
  document.getElementById('modeRequirement').classList.toggle('hidden', mode !== 'requirement');
  document.getElementById('modeConversation').classList.toggle('hidden', mode !== 'conversation');
  autoSaveSettings();
}

/* === Models === */
function renderModels(models) {
  const body = document.getElementById('modelBody');
  if (!models.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:14px;color:var(--fg-dim);">\u672A\u627E\u5230\u53EF\u7528\u6A21\u578B</td></tr>';
    updateModelCount();
    return;
  }
  let defaultIdx = 0;
  for (let di = 0; di < models.length; di++) {
    if (models[di].multiplier === 1) { defaultIdx = di; break; }
  }
  body.innerHTML = models.map(function(m, i) {
    const fam = m.family ? ' <span class="dim">(' + esc(m.family) + ')</span>' : '';
    let mult = '?';
    let multStyle = ' style="color:#e5c07b;"';
    let multTitle = '';
    if (m.multiplier != null) {
      mult = m.multiplier + 'x';
      multTitle = m.multiplierSource === 'api' ? 'API' : m.multiplierSource === 'table' ? '\u786C\u7F16\u7801' : '\u5173\u952E\u8BCD\u63A8\u65AD';
      if (m.multiplier >= 10) { multStyle = ' style="color:var(--err);font-weight:700;"'; }
      else if (m.multiplier >= 2) { multStyle = ' style="color:#e5c07b;font-weight:600;"'; }
      else if (m.multiplier <= 0.25) { multStyle = ' style="color:var(--ok);"'; }
      else { multStyle = ''; }
      if (m.multiplierSource === 'api') { mult += ' \u2713'; }
    }
    const ctx = m.maxInputTokens > 0 ? formatTokens(m.maxInputTokens) : '-';
    const isDefault = (i === defaultIdx);
    return '<tr>' +
      '<td><input type="radio" name="primaryModel" value="' + escAttr(m.id) + '"' + (isDefault ? ' checked' : '') + '></td>' +
      '<td><input type="checkbox" class="model-check" value="' + escAttr(m.id) + '"' + (isDefault ? ' checked disabled' : '') + '></td>' +
      '<td>' + esc(m.name) + fam + '</td>' +
      '<td class="dim">' + ctx + '</td>' +
      '<td' + multStyle + (multTitle ? ' title="' + multTitle + '"' : '') + '>' + mult + '</td>' +
      '</tr>';
  }).join('');
  syncPrimaryCheckboxes();
  updateModelCount();
  // auto-collapse model section after loading
  const toggle = document.getElementById('modelSectionToggle');
  const section = document.getElementById('step1ModelSection');
  const sectionBody = document.getElementById('modelSectionBody');
  if (toggle && toggle.classList.contains('open')) {
    toggle.classList.remove('open');
    section.classList.remove('open');
    if (sectionBody) { sectionBody.classList.add('hidden'); }
  }
  const expandBtn = document.getElementById('modelExpandBtn');
  if (expandBtn) {
    if (models.length > 4) { expandBtn.classList.remove('hidden'); }
    else { expandBtn.classList.add('hidden'); }
  }
  if (window._pendingPrimaryId) {
    const r = document.querySelector('input[name="primaryModel"][value="' + window._pendingPrimaryId + '"]');
    if (r) { r.checked = true; syncPrimaryCheckboxes(); }
    window._pendingPrimaryId = null;
  }
  if (window._pendingSecondaryIds && window._pendingSecondaryIds.length) {
    window._pendingSecondaryIds.forEach(function(id) {
      const c = document.querySelector('input.model-check[value="' + id + '"]');
      if (c && !c.disabled) { c.checked = true; }
    });
    updateModelCount();
    window._pendingSecondaryIds = null;
  } else {
    // 没有保存的设置时，自动勾选所有 0x 免费模型作为参谋团
    var autoSelected = false;
    models.forEach(function(m) {
      if (m.multiplier === 0) {
        var cb = document.querySelector('input.model-check[value="' + escAttr(m.id) + '"]');
        if (cb && !cb.disabled) { cb.checked = true; autoSelected = true; }
      }
    });
    if (autoSelected) { updateModelCount(); }
  }
}

function formatTokens(n) {
  if (n >= 1000000) { return (n / 1000000).toFixed(0) + 'M'; }
  if (n >= 1000) { return (n / 1000).toFixed(0) + 'K'; }
  return String(n);
}

function syncPrimaryCheckboxes() {
  const radio = document.querySelector('input[name="primaryModel"]:checked');
  if (!radio) { return; }
  const pid = radio.value;
  document.querySelectorAll('.model-check').forEach(function(cb) {
    if (cb.value === pid) { cb.checked = true; cb.disabled = true; }
    else { cb.disabled = false; }
  });
}

function updateModelCount() {
  const n = document.querySelectorAll('.model-check:checked').length;
  const el = document.getElementById('modelCount');
  el.textContent = n > 0 ? n + ' \u4E2A\u6A21\u578B\u53C2\u4E0E\u5206\u6790' : '';
  updateModelSummary();
}

function updateModelSummary() {
  const summary = document.getElementById('modelSummary');
  if (!summary) { return; }
  const radio = document.querySelector('input[name="primaryModel"]:checked');
  const checked = document.querySelectorAll('.model-check:checked').length;
  if (radio) {
    const shortId = radio.value.split('/').pop();
    summary.textContent = shortId + (checked > 1 ? ' +' + (checked - 1) : '');
  } else {
    summary.textContent = '\u81F3\u5C11\u4E00\u4E2A\u4E3B\u6A21\u578B';
  }
}

function toggleModelSection() {
  const section = document.getElementById('step1ModelSection');
  const toggle = document.getElementById('modelSectionToggle');
  const body = document.getElementById('modelSectionBody');
  if (!section || !toggle || !body) { return; }
  const isOpen = toggle.classList.contains('open');
  if (isOpen) {
    toggle.classList.remove('open');
    section.classList.remove('open');
    body.classList.add('hidden');
  } else {
    toggle.classList.add('open');
    section.classList.add('open');
    body.classList.remove('hidden');
  }
}

function toggleModelExpand() {
  const section = document.querySelector('.step1-model');
  const btn = document.getElementById('modelExpandBtn');
  if (!section || !btn) { return; }
  const isExpanded = section.classList.toggle('expanded');
  btn.textContent = isExpanded ? '\u6536\u8D77 \u25B2' : '\u66F4\u591A \u25BC';
}

function getModelConfig() {
  let primary = '';
  const secondaries = [];
  const radio = document.querySelector('input[name="primaryModel"]:checked');
  if (radio) { primary = radio.value; }
  document.querySelectorAll('.model-check:checked').forEach(function(cb) {
    if (cb.value !== primary) { secondaries.push(cb.value); }
  });
  return { primaryModelId: primary, secondaryModelIds: secondaries };
}

/* === Step 1: Start Analysis === */
function startAnalyze() {
  const req = document.getElementById('req').value.trim();
  if (!req) { showErr('inputErr', '\u8BF7\u5148\u8F93\u5165\u9700\u6C42\u63CF\u8FF0'); return; }
  hideEl('inputErr');
  setAnalyzing(true);
  goToStep(2);
  resetAnalyzeStep();
  markStepDone(1);
  const mc = getModelConfig();
  vscode.postMessage({
    type: 'analyze', requirement: req,
    primaryModelId: mc.primaryModelId, secondaryModelIds: mc.secondaryModelIds
  });
}

function extractChat() {
  const text = document.getElementById('chatInput').value.trim();
  if (!text) { showErr('inputErr', '\u8BF7\u7C98\u8D34\u5BF9\u8BDD\u5185\u5BB9'); return; }
  hideEl('inputErr');
  setAnalyzing(true);
  const mc = getModelConfig();
  vscode.postMessage({
    type: 'analyzeChat', conversation: text,
    primaryModelId: mc.primaryModelId, secondaryModelIds: mc.secondaryModelIds
  });
}

function setAnalyzing(on) {
  const ab = document.getElementById('analyzeBtn'); if (ab) { ab.disabled = on; }
  const cb = document.getElementById('cancelBtn'); if (cb) { cb.classList.toggle('hidden', !on); }
  const eb = document.getElementById('extractBtn'); if (eb) { eb.disabled = on; }
  const rb = document.getElementById('regenBtn'); if (rb) { rb.disabled = on; }
}

/* === Step 2: Model Tabs === */
let modelTabData = {};
let activeTabId = '';
let doneModelCount = 0;
let totalModelCount = 0;

function renderModelTabs(modelIds) {
  modelTabData = {};
  doneModelCount = 0;
  totalModelCount = modelIds ? modelIds.length : 0;
  activeTabId = '';
  document.getElementById('modelTabs').innerHTML = '';
  document.getElementById('modelTabContent').innerHTML = '';
  hideEl('analysisEmpty');
  const btn = document.getElementById('toPlanBtn');
  if (btn) { btn.disabled = true; }
  document.getElementById('analysisDoneHint').textContent = '';
}

function addModelTab(modelId, modelName) {
  modelTabData[modelId] = { name: modelName, status: 'running', analysis: '', error: '' };
  totalModelCount = Math.max(totalModelCount, Object.keys(modelTabData).length);
  const tabBar = document.getElementById('modelTabs');
  const tabContent = document.getElementById('modelTabContent');
  hideEl('analysisEmpty');

  const tab = document.createElement('div');
  tab.className = 'model-tab' + (!activeTabId ? ' active' : '');
  tab.id = 'mtab-' + escId(modelId);
  tab.setAttribute('data-action', 'switchModelTab');
  tab.setAttribute('data-param', modelId);
  tab.innerHTML = '<span class="tab-dot running" id="tdot-' + escId(modelId) + '"></span>' + esc(modelName);
  tabBar.appendChild(tab);

  const pane = document.createElement('div');
  pane.className = 'model-tab-pane' + (!activeTabId ? ' active' : '');
  pane.id = 'mpane-' + escId(modelId);
  pane.innerHTML = '<div class="tab-pane-body" id="mtxt-' + escId(modelId) + '">\u6B63\u5728\u5206\u6790...</div>' +
    '<div class="tab-pane-actions"><button class="btn-sec btn-sm" data-action="copyAnalysis" data-param="' + escAttr(modelId) + '">\uD83D\uDCCB \u590D\u5236</button></div>';
  tabContent.appendChild(pane);

  if (!activeTabId) { activeTabId = modelId; }
}

function updateModelTab(modelId, status, data) {
  const nd = modelTabData[modelId];
  if (!nd) { return; }
  nd.status = status;
  if (data.analysis !== undefined) { nd.analysis = data.analysis; }
  if (data.error !== undefined) { nd.error = data.error; }

  const dot = document.getElementById('tdot-' + escId(modelId));
  if (dot) { dot.className = 'tab-dot ' + status; }
  const txt = document.getElementById('mtxt-' + escId(modelId));
  if (txt) {
    if (status === 'done') { txt.textContent = nd.analysis; }
    else if (status === 'error') { txt.textContent = '\u9519\u8BEF: ' + nd.error; }
  }
  const tab = document.getElementById('mtab-' + escId(modelId));
  if (tab && status === 'done') { tab.classList.add('done'); }
  if (tab && status === 'error') { tab.classList.add('error'); }

  if (status === 'done' || status === 'error') {
    doneModelCount++;
    checkAnalysisReady();
  }
}

function switchModelTab(modelId) {
  if (!modelTabData[modelId]) { return; }
  activeTabId = modelId;
  document.querySelectorAll('.model-tab').forEach(function(t) {
    t.classList.toggle('active', t.id === 'mtab-' + escId(modelId));
  });
  document.querySelectorAll('.model-tab-pane').forEach(function(p) {
    p.classList.toggle('active', p.id === 'mpane-' + escId(modelId));
  });
}

function checkAnalysisReady() {
  const ids = Object.keys(modelTabData);
  const allFinished = ids.length > 0 && ids.every(function(id) {
    return modelTabData[id].status === 'done' || modelTabData[id].status === 'error';
  });
  const btn = document.getElementById('toPlanBtn');
  const hint = document.getElementById('analysisDoneHint');
  if (btn) { btn.disabled = !allFinished; }
  if (hint) { hint.textContent = doneModelCount + '/' + totalModelCount + ' \u5B8C\u6210'; }
  if (allFinished && _autoPlanTimer === null) { startAutoPlanCountdown(); }
}

let _autoPlanSeconds = 0;
function startAutoPlanCountdown() {
  _autoPlanSeconds = 3;
  showEl('autoPlanBar');
  function tick() {
    if (_autoPlanSeconds <= 0) {
      hideEl('autoPlanBar');
      _autoPlanTimer = null;
      const btn = document.getElementById('toPlanBtn');
      if (btn && !btn.disabled) { goToPlan(); }
      return;
    }
    const h = document.getElementById('autoPlanHint');
    if (h) { h.textContent = _autoPlanSeconds + ' \u79D2\u540E\u81EA\u52A8\u751F\u6210\u8BA1\u5212'; }
    _autoPlanSeconds--;
    _autoPlanTimer = setTimeout(tick, 1000);
  }
  tick();
}

function cancelAutoPlan() {
  if (_autoPlanTimer) { clearTimeout(_autoPlanTimer); _autoPlanTimer = null; }
  hideEl('autoPlanBar');
}

function goToPlan() {
  cancelAutoPlan();
  markStepDone(2);
  goToStep(3);
  showEl('planStatus');
  document.getElementById('planStatus').textContent = '\u6B63\u5728\u751F\u6210\u8BA1\u5212...';
  const mc = getModelConfig();
  vscode.postMessage({
    type: 'generatePlan',
    primaryModelId: mc.primaryModelId,
    secondaryModelIds: mc.secondaryModelIds
  });
}

function copyAnalysis(id) {
  const nd = modelTabData[id];
  if (nd && nd.analysis) {
    vscode.postMessage({ type: 'copy', text: nd.analysis });
  }
}

function resetAnalyzeStep() {
  document.getElementById('modelTabs').innerHTML = '';
  document.getElementById('modelTabContent').innerHTML = '<div class="empty-state" id="analysisEmpty">\u8FD8\u672A\u5F00\u59CB\u5206\u6790</div>';
  hideEl('wfStatus'); hideEl('analyzeErr');
  cancelAutoPlan();
  modelTabData = {};
  activeTabId = '';
  doneModelCount = 0;
  totalModelCount = 0;
  const btn = document.getElementById('toPlanBtn');
  if (btn) { btn.disabled = true; }
  document.getElementById('analysisDoneHint').textContent = '';
}

/* === Step 3: Plan === */
function showPlan(merged, images) {
  setAnalyzing(false);
  hideEl('planStatus');
  planText = merged;
  planEdited = merged;
  planEditMode = false;

  const thumbsEl = document.getElementById('planImgThumbs');
  const imgLabel = document.getElementById('planImgLabel');
  if (images && images.length) {
    thumbsEl.innerHTML = images.map(function(img, i) {
      return '<div class="img-thumb" title="' + esc(img.name) + '">' +
        '<img src="' + img.dataUri + '" alt="img' + (i+1) + '">' +
        '<span class="img-name">img' + (i+1) + ': ' + esc(img.name) + '</span></div>';
    }).join('');
    if (imgLabel) { showEl('planImgLabel'); }
  } else {
    thumbsEl.innerHTML = '';
    if (imgLabel) { hideEl('planImgLabel'); }
  }

  const body = document.getElementById('planBody');
  body.innerHTML = renderMarkdown(merged);
  document.getElementById('planEditBtn').textContent = '\u270F\uFE0F \u7F16\u8F91';

  hideEl('planEmpty');
  showEl('planBoxLabel'); showEl('planBox'); showEl('planActions');

  markStepDone(2);
  if (currentStep !== 3) { goToStep(3); }
}

function togglePlanEdit() {
  planEditMode = !planEditMode;
  const body = document.getElementById('planBody');
  const btn = document.getElementById('planEditBtn');

  if (planEditMode) {
    const current = planEdited || planText;
    body.innerHTML = '<textarea id="planEditor" style="min-height:300px;">' + esc(current) + '</textarea>';
    btn.textContent = '\uD83D\uDC41 \u9884\u89C8';
  } else {
    const editor = document.getElementById('planEditor');
    if (editor) { planEdited = editor.value; }
    body.innerHTML = renderMarkdown(planEdited || planText);
    btn.textContent = '\u270F\uFE0F \u7F16\u8F91';
  }
}

function getEffectivePlan() {
  if (planEditMode) {
    const editor = document.getElementById('planEditor');
    if (editor) { planEdited = editor.value; }
  }
  return planEdited || planText;
}

function doRegeneratePlan() {
  const mc = getModelConfig();
  setAnalyzing(true);
  vscode.postMessage({
    type: 'regeneratePlan',
    primaryModelId: mc.primaryModelId,
    secondaryModelIds: mc.secondaryModelIds
  });
}

/* === Step 4: Execute === */
function updateExecPreview() {
  const plan = getEffectivePlan();
  if (!plan) {
    hideEl('execContent'); showEl('execEmpty');
    return;
  }
  hideEl('execEmpty'); showEl('execContent');
  document.getElementById('execPreview').textContent = plan;
  requestTokenEstimate();
}

function requestTokenEstimate() {
  vscode.postMessage({
    type: 'requestTokenEstimate',
    attachSkills: document.getElementById('attachSkills').checked,
    attachImages: document.getElementById('attachImages').checked,
    attachAnalysis: document.getElementById('attachAnalysis').checked,
  });
}

var _executeBusy = false;
function executeToChat() {
  if (_executeBusy) { return; }
  _executeBusy = true;
  var btn = document.getElementById('executeToChat');
  if (btn) { btn.disabled = true; }
  var plan = getEffectivePlan();
  vscode.postMessage({
    type: 'executeWithContext',
    planText: plan,
    attachSkills: document.getElementById('attachSkills').checked,
    attachImages: document.getElementById('attachImages').checked,
    attachAnalysis: document.getElementById('attachAnalysis').checked,
  });
  setTimeout(function() { _executeBusy = false; if (btn) { btn.disabled = false; } }, 2000);
}

/* === Skill Tags === */
function handleAllSkills(skills) {
  allSkillNames = skills || [];
  renderSkillTags();
}

function handleMatchedSkills(skills) {
  matchedSkillNames = skills || [];
  renderSkillTags();
}

function renderSkillTags() {
  const el = document.getElementById('skillTags');
  const hint = document.getElementById('skillHint');
  if (!allSkillNames.length) { el.innerHTML = ''; return; }
  el.innerHTML = allSkillNames.map(function(name) {
    const active = matchedSkillNames.indexOf(name) !== -1;
    return '<span class="skill-tag' + (active ? ' active' : '') + '">' + esc(name) + '</span>';
  }).join('');
  const count = matchedSkillNames.filter(function(n) { return n !== 'SKILL'; }).length;
  hint.textContent = count > 0
    ? count + ' \u4E2A Skill \u5DF2\u5339\u914D\uFF08SKILL \u59CB\u7EC8\u52A0\u8F7D\uFF09'
    : '\u8F93\u5165\u9700\u6C42\u540E\u81EA\u52A8\u5339\u914D';
}

/* === Markdown Renderer === */
function inlineMd(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
}

function renderMarkdown(text) {
  if (!text) { return ''; }
  const lines = text.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;
  function closeList() {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  }
  lines.forEach(function(line) {
    if (/^## (.+)/.test(line)) {
      closeList();
      out.push('<h2 class="md-h2">' + inlineMd(line.replace(/^## /, '')) + '</h2>');
    } else if (/^### (.+)/.test(line)) {
      closeList();
      out.push('<h3 class="md-h3">' + inlineMd(line.replace(/^### /, '')) + '</h3>');
    } else if (/^> (.*)/.test(line)) {
      closeList();
      out.push('<blockquote class="md-quote">' + inlineMd(line.replace(/^> /, '')) + '</blockquote>');
    } else if (/^- \[x\] (.+)/i.test(line)) {
      if (!inUl) { out.push('<ul class="md-list">'); inUl = true; }
      out.push('<li class="md-li done"><span class="md-cb">&#10003;</span> ' + inlineMd(line.replace(/^- \[x\] /i, '')) + '</li>');
    } else if (/^- \[ \] (.+)/.test(line)) {
      if (!inUl) { out.push('<ul class="md-list">'); inUl = true; }
      out.push('<li class="md-li todo"><span class="md-cb">&#9744;</span> ' + inlineMd(line.replace(/^- \[ \] /, '')) + '</li>');
    } else if (/^[-*] (.+)/.test(line)) {
      if (!inUl) { out.push('<ul class="md-list">'); inUl = true; }
      out.push('<li class="md-li">' + inlineMd(line.replace(/^[-*] /, '')) + '</li>');
    } else if (/^(\d+)\. (.+)/.test(line)) {
      if (!inOl) { closeList(); out.push('<ol class="md-list md-ol">'); inOl = true; }
      out.push('<li class="md-li">' + inlineMd(line.replace(/^\d+\. /, '')) + '</li>');
    } else if (!line.trim()) {
      closeList();
      out.push('<div class="md-br"></div>');
    } else {
      closeList();
      out.push('<div class="md-p">' + inlineMd(line) + '</div>');
    }
  });
  closeList();
  return out.join('');
}

/* === Utils === */
function showEl(id) { const el = document.getElementById(id); if (el) { el.classList.remove('hidden'); } }
function hideEl(id) { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); } }
function showErr(id, t) { const el = document.getElementById(id); if (el) { el.textContent = '\u274C ' + t; el.classList.remove('hidden'); } }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

/* === Message Handler === */
window.addEventListener('message', function(e) {
  const msg = e.data;
  switch (msg.type) {
    case 'allSkills':     handleAllSkills(msg.skills); break;
    case 'matchedSkills': handleMatchedSkills(msg.skills); break;
    case 'models':        renderModels(msg.models || []); break;
    case 'browseData':    renderBrowseData(msg.skills || [], msg.templates || []); break;
    case 'imageAdded':    addImageThumb(msg.index, msg.name, msg.dataUri); break;
    case 'imagesReset':   resetImageThumbs(msg.images || []); break;
    case 'status':
      showEl('wfStatus');
      document.getElementById('wfStatus').textContent = msg.text;
      break;
    case 'modelAnalysisStart':
      goToStep(2);
      showEl('wfStatus');
      document.getElementById('wfStatus').textContent = '\u5DE5\u4F5C\u6D41\u542F\u52A8...';
      renderModelTabs();
      markStepDone(1);
      break;
    case 'modelStart':
      addModelTab(msg.modelId, msg.modelName || '');
      break;
    case 'modelDone':
      updateModelTab(msg.modelId, 'done', { analysis: msg.analysis || '' });
      break;
    case 'modelError':
      updateModelTab(msg.modelId, 'error', { error: msg.error || '' });
      break;
    case 'analysisComplete':
      setAnalyzing(false);
      {
        const ws2 = document.getElementById('wfStatus');
        if (ws2) { ws2.textContent = '\u6240\u6709\u6A21\u578B\u5206\u6790\u5B8C\u6210'; }
      }
      break;
    case 'planGenerated':
      showPlan(msg.merged, msg.images || []);
      break;
    case 'restoreSettings':
      restoreSettings(msg.settings);
      break;
    case 'restoreHistory':
      renderHistoryList(msg.history || []);
      break;
    case 'loadedSession':
      if (msg.plan) { showPlan(msg.plan, []); }
      break;
    case 'tokenEstimate':
      document.getElementById('tokenEstimate').textContent = msg.estimate || '--';
      {
        const eic = document.getElementById('execImgCount');
        if (eic && msg.imageCount != null) { eic.textContent = String(msg.imageCount); }
      }
      break;
    case 'error':
      setAnalyzing(false); hideEl('wfStatus'); hideEl('planStatus');
      showErr('analyzeErr', msg.text);
      showErr('inputErr', msg.text);
      break;
    case 'cancelled':
      setAnalyzing(false);
      {
        const ws = document.getElementById('wfStatus');
        if (ws) { ws.textContent = '\u5DF2\u53D6\u6D88'; }
      }
      break;
    case 'chatExtracted':
      setAnalyzing(false);
      document.getElementById('req').value = msg.requirement || '';
      {
        const er = document.getElementById('extractResult');
        er.innerHTML = '<div class="extract-box"><div class="extract-summary">\u2713 ' + esc(msg.summary) + '</div>' +
          '<div class="extract-tasks">' + (msg.tasks || []).map(function(t, i) {
            return (i+1) + '. [' + t.priority + '] ' + esc(t.title);
          }).join('\n') + '</div></div>';
        showEl('extractResult');
      }
      setInputMode('requirement');
      vscode.postMessage({ type: 'previewSkills', requirement: msg.requirement });
      break;
  }
});

/* === Settings Persistence === */
function autoSaveSettings() {
  const mc = getModelConfig();
  vscode.postMessage({
    type: 'saveSettings',
    primaryModelId: mc.primaryModelId,
    secondaryModelIds: mc.secondaryModelIds,
    attachSkills: document.getElementById('attachSkills').checked,
    attachImages: document.getElementById('attachImages').checked,
    attachAnalysis: document.getElementById('attachAnalysis').checked,
    inputMode: inputMode,
    lastRequirement: (document.getElementById('req') || {}).value || '',
  });
}

function restoreSettings(s) {
  if (!s) { return; }
  if (s.attachSkills    != null) { document.getElementById('attachSkills').checked    = s.attachSkills; }
  if (s.attachImages    != null) { document.getElementById('attachImages').checked    = s.attachImages; }
  if (s.attachAnalysis  != null) { document.getElementById('attachAnalysis').checked  = s.attachAnalysis; }
  if (s.primaryModelId) { window._pendingPrimaryId = s.primaryModelId; }
  if (s.secondaryModelIds) { window._pendingSecondaryIds = s.secondaryModelIds; }
  if (s.inputMode) { setInputMode(s.inputMode); }
  if (s.lastRequirement) {
    var reqEl = document.getElementById('req');
    if (reqEl && !reqEl.value) { reqEl.value = s.lastRequirement; }
  }
}

/* === History Panel === */
let historyPanelOpen = false;

function toggleHistoryPanel() {
  historyPanelOpen = !historyPanelOpen;
  const list = document.getElementById('historyList');
  const arrow = document.getElementById('historyArrow');
  list.style.display = historyPanelOpen ? 'flex' : 'none';
  if (arrow) { arrow.style.transform = historyPanelOpen ? 'rotate(90deg)' : ''; }
}

let _historyData = [];
function renderHistoryList(history) {
  _historyData = history || [];
  const countEl = document.getElementById('historyCount');
  if (countEl) { countEl.textContent = _historyData.length ? String(_historyData.length) : ''; }
  const list = document.getElementById('historyList');
  if (!list) { return; }
  if (!_historyData.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--fg-dim);padding:4px 0;">\u6682\u65E0\u5386\u53F2</div>';
    return;
  }
  list.innerHTML = _historyData.map(function(r, i) {
    const date = new Date(r.timestamp).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
    return '<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;background:var(--bg-card);border:1px solid var(--border);" ' +
      'data-action="loadHistoryItem" data-param="' + i + '" title="' + esc(r.requirement) + '">' +
      '<span style="font-size:10px;color:var(--fg-dim);white-space:nowrap;">' + esc(date) + '</span>' +
      '<span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.requirement) + '</span>' +
      '</div>';
  }).join('');
}

function loadHistoryItem(i) {
  const r = _historyData[i];
  if (!r) { return; }
  document.getElementById('req').value = r.requirement;
  showPlan(r.plan, []);
  goToStep(3);
}

function clearAllHistory() {
  vscode.postMessage({ type: 'clearHistory' });
}

/* === Upper Panel === */
function toggleUpperPanel() {
  const panel = document.getElementById('upperPanel');
  const toggle = document.getElementById('upperToggle');
  const isOpen = toggle.classList.contains('open');
  if (isOpen) {
    toggle.classList.remove('open');
    panel.classList.add('collapsed');
  } else {
    toggle.classList.add('open');
    panel.classList.remove('collapsed');
  }
}

function renderBrowseData(skills, templates) {
  const sg = document.getElementById('browseSkills');
  if (skills.length === 0) {
    sg.innerHTML = '<span class="dim">no skills found</span>';
  } else {
    sg.innerHTML = skills.map(function(s) {
      const cls = 'browse-chip' + (s.hasFile ? ' has-file' : '');
      const kw = (s.keywords || []).join(', ');
      const tip = kw ? ' title="' + esc(kw) + '"' : '';
      return '<span class="' + cls + '"' + tip + '><span class="chip-dot"></span>' + esc(s.name) + '</span>';
    }).join('');
  }
  const tl = document.getElementById('browseTemplates');
  if (templates.length === 0) {
    tl.innerHTML = '<span class="dim">no templates found</span>';
  } else {
    tl.innerHTML = templates.map(function(t) {
      return '<div class="tmpl-item"><span class="tmpl-name">' + esc(t.name) + '</span>' +
        (t.description ? ' \u2014 ' + esc(t.description) : '') + '</div>';
    }).join('');
  }
  document.getElementById('browseStatus').textContent = skills.length + ' skills, ' + templates.length + ' templates';
}

/* === Image Attachments === */
let attachedImageCount = 0;

function addImageThumb(index, name, dataUri) {
  const container = document.getElementById('imgThumbs');
  const div = document.createElement('div');
  div.className = 'img-thumb';
  div.setAttribute('data-img-index', String(index));
  div.innerHTML = '<img src="' + dataUri + '" alt="' + esc(name) + '">' +
    '<span class="img-name">' + esc(name) + '</span>' +
    '<button class="img-remove" data-action="removeImage" data-param="' + index + '">&times;</button>';
  container.appendChild(div);
  attachedImageCount++;
  updateImgCount();
}

function resetImageThumbs(images) {
  const container = document.getElementById('imgThumbs');
  container.innerHTML = '';
  attachedImageCount = images.length;
  images.forEach(function(img) { addImageThumb(img.index, img.name, img.dataUri); });
  attachedImageCount = images.length;
  updateImgCount();
}

function updateImgCount() {
  const el = document.getElementById('imgCount');
  el.textContent = attachedImageCount > 0 ? attachedImageCount + ' \u5F20\u56FE\u7247' : '';
}

/* === Init === */
vscode.postMessage({ type: 'requestAllSkills' });
vscode.postMessage({ type: 'requestBrowse' });
vscode.postMessage({ type: 'requestModels' });
