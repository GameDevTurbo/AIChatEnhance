#!/usr/bin/env node
/**
 * test/integration-extra.js
 * 补充集成测试 — 覆盖 integration.js 未测试的路径
 * 全部模型场景采用 0x（免费）模型
 *
 * 覆盖路径：
 *  - 输入模式切换 (requirement ↔ conversation)
 *  - chatExtracted 消息处理
 *  - restoreSettings（含 pending model ID）
 *  - restoreHistory / loadHistoryItem / clearAllHistory
 *  - toggleHistory 面板
 *  - toggleUpperPanel
 *  - renderBrowseData
 *  - imageAdded / imagesReset
 *  - doRegeneratePlan（重新生成计划）
 *  - modelError 处理
 *  - loadedSession 恢复
 *  - toggleModelExpand
 *  - toggleModelSection（手动展开/收起）
 *  - startAnalyze 空输入校验
 *  - 多次 models 消息（重渲染）
 *  - analysisComplete 消息
 *  - 全 0x 模型时 primaryModel 默认选第一个
 *  - 计划编辑后重新预览保持内容
 *  - Step 4 无计划时 execEmpty 显示
 */
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

/* ── 全局辅助 ─────────────────────────────── */
function createFreshDom() {
  const htmlRaw = fs.readFileSync(path.join(__dirname, '../webview/index.html'), 'utf8');
  const html = htmlRaw
    .replace(/\{\{cspSource\}\}/g, '*')
    .replace(/\{\{nonce\}\}/g, 'test')
    .replace(/\{\{styleUri\}\}/g, '')
    .replace(/\{\{scriptUri\}\}/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const sent = [];
  dom.window.acquireVsCodeApi = function() {
    return {
      postMessage: function(msg) { sent.push(msg); },
      getState: function() { return null; },
      setState: function() {},
    };
  };
  const mainJs = fs.readFileSync(path.join(__dirname, '../webview/main.js'), 'utf8');
  dom.window.eval(mainJs);
  return { dom, window: dom.window, document: dom.window.document, sent };
}

/* ── 通用辅助 ─────────────────────────────── */
let pass = 0, fail = 0;
const failures = [];

function ok(condition, label) {
  if (condition) { process.stdout.write('  \u2713 ' + label + '\n'); pass++; }
  else { process.stderr.write('  \u2717 FAIL: ' + label + '\n'); fail++; failures.push(label); }
}
function section(name) { console.log('\n[' + name + ']'); }

/* ── 全 0x 模型数据 ───────────────────────── */
const MODELS_0X = [
  { id: 'gpt-4o',       name: 'GPT-4o',        family: 'gpt-4o',   multiplier: 0, multiplierSource: 'table', maxInputTokens: 128000 },
  { id: 'gpt-4.1',      name: 'GPT-4.1',       family: 'gpt-4.1',  multiplier: 0, multiplierSource: 'table', maxInputTokens: 1000000 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini',  family: 'gpt-4.1',  multiplier: 0, multiplierSource: 'table', maxInputTokens: 1000000 },
  { id: 'gpt-4o-mini',  name: 'GPT-4o Mini',   family: 'gpt-4o',   multiplier: 0, multiplierSource: 'api',   maxInputTokens: 128000 },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano',  family: 'gpt-4.1',  multiplier: 0, multiplierSource: 'table', maxInputTokens: 1000000 },
];

/* ══════════════════════════════════════════════
   T1: 输入模式切换
   ══════════════════════════════════════════════ */
section('T1: 输入模式切换');
{
  const { document } = createFreshDom();
  const el = id => document.getElementById(id);

  // 初始状态：requirement 激活
  ok(!el('modeRequirement').classList.contains('hidden'), '初始：需求输入区可见');
  ok(el('modeConversation').classList.contains('hidden'), '初始：对话输入区隐藏');

  // 切换到对话模式
  const convBtn = document.querySelector('[data-param="conversation"]');
  convBtn.click();
  ok(el('modeRequirement').classList.contains('hidden'), '切换后：需求输入区隐藏');
  ok(!el('modeConversation').classList.contains('hidden'), '切换后：对话输入区可见');
  ok(convBtn.classList.contains('active'), '对话按钮激活');

  // 切回需求模式
  document.querySelector('[data-param="requirement"]').click();
  ok(!el('modeRequirement').classList.contains('hidden'), '切回：需求输入区可见');
  ok(el('modeConversation').classList.contains('hidden'), '切回：对话输入区隐藏');
}

/* ══════════════════════════════════════════════
   T2: 空输入校验
   ══════════════════════════════════════════════ */
section('T2: 空输入校验');
{
  const { document, sent } = createFreshDom();
  const el = id => document.getElementById(id);

  // 不填内容直接点分析
  el('req').value = '';
  el('analyzeBtn').click();
  ok(!el('inputErr').classList.contains('hidden'), '空输入时 inputErr 显示');
  ok(el('inputErr').textContent.includes('需求'), '错误提示含"需求"');
  ok(!sent.some(m => m.type === 'analyze'), '未发送 analyze 消息');
}

/* ══════════════════════════════════════════════
   T3: 全 0x 模型 — primaryModel 默认选第一个
   ══════════════════════════════════════════════ */
section('T3: 全0x模型时默认选首个');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  dispatch({ type: 'models', models: MODELS_0X });

  // 全 0x 无 multiplier===1 的，默认选 idx=0
  const radio = document.querySelector('input[name="primaryModel"]:checked');
  ok(!!radio, 'primary radio 存在且已选中');
  ok(radio.value === 'gpt-4o', '全0x时主模型=第一个 (gpt-4o)');

  // 全部 0x checkbox 勾选
  const allChecked = MODELS_0X.every(m => {
    const cb = document.querySelector('input.model-check[value="' + m.id + '"]');
    return cb && cb.checked;
  });
  ok(allChecked, '全部 0x 模型均自动勾选');
}

/* ══════════════════════════════════════════════
   T4: restoreSettings — pending model IDs
   ══════════════════════════════════════════════ */
section('T4: restoreSettings 恢复设置');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  // 先发 restoreSettings（模型还没加载）
  dispatch({ type: 'restoreSettings', settings: {
    primaryModelId: 'gpt-4.1',
    secondaryModelIds: ['gpt-4o-mini', 'gpt-4.1-nano'],
    attachSkills: false,
    attachImages: false,
    attachAnalysis: true,
  }});

  // 设置已应用到 checkbox
  ok(!document.getElementById('attachSkills').checked, 'attachSkills 恢复为 false');
  ok(!document.getElementById('attachImages').checked, 'attachImages 恢复为 false');
  ok(document.getElementById('attachAnalysis').checked, 'attachAnalysis 恢复为 true');

  // 然后注入模型 → pending IDs 应该被应用
  dispatch({ type: 'models', models: MODELS_0X });

  const radio = document.querySelector('input[name="primaryModel"]:checked');
  ok(radio && radio.value === 'gpt-4.1', 'pending primaryModelId 恢复 (gpt-4.1)');

  const cb1 = document.querySelector('input.model-check[value="gpt-4o-mini"]');
  ok(cb1 && cb1.checked, 'pending secondaryModelId gpt-4o-mini 恢复');
  const cb2 = document.querySelector('input.model-check[value="gpt-4.1-nano"]');
  ok(cb2 && cb2.checked, 'pending secondaryModelId gpt-4.1-nano 恢复');
}

/* ══════════════════════════════════════════════
   T5: toggleUpperPanel（展开/收起浏览区）
   ══════════════════════════════════════════════ */
section('T5: Upper Panel 浏览区');
{
  const { document } = createFreshDom();
  const el = id => document.getElementById(id);

  ok(el('upperPanel').classList.contains('collapsed'), '初始：upperPanel 折叠');
  ok(!el('upperToggle').classList.contains('open'), '初始：upperToggle 未 open');

  el('upperToggle').click();
  ok(!el('upperPanel').classList.contains('collapsed'), '展开后：upperPanel 不再折叠');
  ok(el('upperToggle').classList.contains('open'), '展开后：upperToggle open');

  el('upperToggle').click();
  ok(el('upperPanel').classList.contains('collapsed'), '再点：upperPanel 再次折叠');
}

/* ══════════════════════════════════════════════
   T6: renderBrowseData
   ══════════════════════════════════════════════ */
section('T6: 浏览数据渲染');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'browseData',
    skills: [
      { name: 'SKILL', hasFile: true, keywords: ['unity', 'c#'] },
      { name: 'ui', hasFile: true, keywords: ['uiwindow'] },
      { name: 'battle', hasFile: false, keywords: [] },
    ],
    templates: [
      { name: 'quick-fix', description: '快速修复模板' },
    ]
  });

  const chips = document.querySelectorAll('.browse-chip');
  ok(chips.length === 3, 'browse-chip 数量 = 3');
  ok(chips[0].classList.contains('has-file'), '第一个 chip 有 has-file 类');
  ok(!chips[2].classList.contains('has-file'), '第三个 chip 无 has-file 类');

  const tmplItems = document.querySelectorAll('.tmpl-item');
  ok(tmplItems.length === 1, 'tmpl-item 数量 = 1');
  ok(el('browseStatus').textContent.includes('3 skills'), 'browseStatus 含 skills 计数');
  ok(el('browseStatus').textContent.includes('1 template'), 'browseStatus 含 templates 计数');
}

/* ══════════════════════════════════════════════
   T7: 图片附件
   ══════════════════════════════════════════════ */
section('T7: 图片附件');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 添加 2 张图
  dispatch({ type: 'imageAdded', index: 0, name: 'screenshot.png', dataUri: 'data:image/png;base64,ABC' });
  dispatch({ type: 'imageAdded', index: 1, name: 'diagram.jpg', dataUri: 'data:image/jpeg;base64,DEF' });

  const thumbs = document.querySelectorAll('#imgThumbs .img-thumb');
  ok(thumbs.length === 2, '添加后 imgThumbs 有 2 个');
  ok(el('imgCount').textContent.includes('2'), 'imgCount 显示 2');

  // 重置（模拟删除一张后后端发 imagesReset）
  dispatch({ type: 'imagesReset', images: [
    { index: 0, name: 'screenshot.png', dataUri: 'data:image/png;base64,ABC' }
  ]});
  const thumbsAfter = document.querySelectorAll('#imgThumbs .img-thumb');
  ok(thumbsAfter.length === 1, 'imagesReset 后 imgThumbs = 1');
  ok(el('imgCount').textContent.includes('1'), 'imgCount 更新为 1');
}

/* ══════════════════════════════════════════════
   T8: History 面板
   ══════════════════════════════════════════════ */
section('T8: 历史面板');
{
  const { document, window, sent } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 初始隐藏
  ok(el('historyList').style.display === 'none', '初始：historyList 隐藏');

  // Toggle 打开
  el('historyToggle').click();
  ok(el('historyList').style.display === 'flex', '点击后 historyList 显示');

  // 注入历史
  dispatch({ type: 'restoreHistory', history: [
    { timestamp: Date.now() - 60000, requirement: '测试需求A', plan: '## Plan A\n- task1' },
    { timestamp: Date.now(), requirement: '测试需求B', plan: '## Plan B\n- task2' },
  ]});

  ok(el('historyCount').textContent === '2', 'historyCount = 2');
  const items = el('historyList').querySelectorAll('[data-action="loadHistoryItem"]');
  ok(items.length === 2, '历史条目 = 2');
  ok(items[0].textContent.includes('测试需求A'), '第一条含"测试需求A"');

  // 点击加载历史 → req 填充 + Plan 显示
  items[1].click();
  ok(el('req').value === '测试需求B', '加载后 req = "测试需求B"');
  ok(el('planBody').innerHTML.includes('Plan B'), 'planBody 含 "Plan B"');

  // Toggle 关闭
  el('historyToggle').click();
  ok(el('historyList').style.display === 'none', '再点：historyList 隐藏');

  // 清空历史
  sent.length = 0;
  document.querySelector('[data-action="clearHistory"]').click();
  ok(sent.some(m => m.type === 'clearHistory'), '发送了 clearHistory 消息');
}

/* ══════════════════════════════════════════════
   T9: modelError 处理
   ══════════════════════════════════════════════ */
section('T9: 模型错误处理');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  dispatch({ type: 'models', models: MODELS_0X });
  dispatch({ type: 'modelAnalysisStart' });

  // 启动 3 个视角
  dispatch({ type: 'modelStart', modelId: 'v-a', modelName: '视角A' });
  dispatch({ type: 'modelStart', modelId: 'v-b', modelName: '视角B' });
  dispatch({ type: 'modelStart', modelId: 'v-c', modelName: '视角C' });

  // 1 个成功，1 个报错，1 个成功
  dispatch({ type: 'modelDone',  modelId: 'v-a', analysis: '## A\nok' });
  dispatch({ type: 'modelError', modelId: 'v-b', error: 'rate_limit' });
  dispatch({ type: 'modelDone',  modelId: 'v-c', analysis: '## C\nok' });

  // 错误标签有 error 类
  const tabB = document.getElementById('mtab-v-b');
  ok(tabB && tabB.classList.contains('error'), '错误模型标签有 error 类');

  // 错误面板有错误文本
  const txtB = document.getElementById('mtxt-v-b');
  ok(txtB && txtB.textContent.includes('rate_limit'), '错误面板显示 rate_limit');

  // 全部完成后也应启用 toPlanBtn（即使有 error）
  ok(!document.getElementById('toPlanBtn').disabled, '含错误模型时 toPlanBtn 仍启用');
  ok(!document.getElementById('autoPlanBar').classList.contains('hidden'), '倒计时条显示');
}

/* ══════════════════════════════════════════════
   T10: toggleModelSection（手动展开/收起）
   ══════════════════════════════════════════════ */
section('T10: 模型区域手动展开/收起');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'models', models: MODELS_0X });
  // 加载后自动折叠
  ok(el('modelSectionBody').classList.contains('hidden'), '加载后已折叠');

  // 手动展开
  el('modelSectionToggle').click();
  ok(!el('modelSectionBody').classList.contains('hidden'), '点击后展开');
  ok(el('modelSectionToggle').classList.contains('open'), 'toggle 有 open 类');

  // 再次收起
  el('modelSectionToggle').click();
  ok(el('modelSectionBody').classList.contains('hidden'), '再点后收起');
  ok(!el('modelSectionToggle').classList.contains('open'), 'toggle 无 open 类');
}

/* ══════════════════════════════════════════════
   T11: toggleModelExpand（更多/收起）
   ══════════════════════════════════════════════ */
section('T11: 模型列表展开/收起');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 5 个模型 > 4，expandBtn 应显示
  dispatch({ type: 'models', models: MODELS_0X });
  ok(!el('modelExpandBtn').classList.contains('hidden'), '5个模型时 expandBtn 可见');

  // 点击展开按钮
  el('modelExpandBtn').click();
  ok(document.querySelector('.step1-model.expanded'), '展开后有 expanded 类');
  ok(el('modelExpandBtn').textContent.includes('收起'), '按钮文字变为"收起"');

  el('modelExpandBtn').click();
  ok(!document.querySelector('.step1-model.expanded'), '收起后无 expanded 类');
  ok(el('modelExpandBtn').textContent.includes('更多'), '按钮文字恢复"更多"');

  // <= 4 个模型时 expandBtn 应隐藏
  dispatch({ type: 'models', models: MODELS_0X.slice(0, 3) });
  ok(el('modelExpandBtn').classList.contains('hidden'), '3个模型时 expandBtn 隐藏');
}

/* ══════════════════════════════════════════════
   T12: doRegeneratePlan
   ══════════════════════════════════════════════ */
section('T12: 重新生成计划');
{
  const { document, window, sent } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'models', models: MODELS_0X });

  // 先给个初始计划
  dispatch({ type: 'planGenerated', merged: '## Plan V1', images: [] });

  // 重新生成
  sent.length = 0;
  el('regenBtn').click();
  ok(sent.some(m => m.type === 'regeneratePlan'), '发送了 regeneratePlan 消息');
  const rmsg = sent.find(m => m.type === 'regeneratePlan');
  ok(rmsg && rmsg.primaryModelId === 'gpt-4o', 'regeneratePlan 含 primaryModelId = gpt-4o');
  ok(el('analyzeBtn').disabled, '重新生成时 analyzeBtn 禁用');
}

/* ══════════════════════════════════════════════
   T13: chatExtracted 消息处理
   ══════════════════════════════════════════════ */
section('T13: 对话提取结果');
{
  const { document, window, sent } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'chatExtracted',
    requirement: '重构 BattleManager 状态机',
    summary: '共提取 2 个任务',
    tasks: [
      { priority: 'P0', title: '抽取 IBattleState 接口' },
      { priority: 'P1', title: '迁移 idle/combat 状态实现' },
    ]
  });

  ok(el('req').value === '重构 BattleManager 状态机', 'req 填充提取结果');
  ok(!el('extractResult').classList.contains('hidden'), 'extractResult 显示');
  ok(el('extractResult').textContent.includes('2 个任务'), '摘要含"2 个任务"');
  ok(el('extractResult').textContent.includes('抽取 IBattleState'), '任务1 文本');
  ok(el('extractResult').textContent.includes('P0'), '任务1 优先级');
  // 应切回 requirement 模式
  ok(!el('modeRequirement').classList.contains('hidden'), '提取后自动切回需求模式');
  // 应发 previewSkills
  ok(sent.some(m => m.type === 'previewSkills'), '提取后发送 previewSkills');
}

/* ══════════════════════════════════════════════
   T14: loadedSession 恢复
   ══════════════════════════════════════════════ */
section('T14: 会话恢复');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'loadedSession', plan: '## Restored Plan\n- step 1' });

  // ok 应跳到 step 3 且 planBody 有内容
  ok(el('planBody').innerHTML.includes('Restored Plan'), 'planBody 显示恢复的计划');
  ok(!el('planBox').classList.contains('hidden'), 'planBox 可见');
}

/* ══════════════════════════════════════════════
   T15: analysisComplete 消息
   ══════════════════════════════════════════════ */
section('T15: analysisComplete 状态');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'modelAnalysisStart' });
  dispatch({ type: 'analysisComplete' });

  ok(el('wfStatus').textContent.includes('完成'), 'analysisComplete 后 wfStatus 含"完成"');
  ok(!el('analyzeBtn').disabled, 'analysisComplete 后 analyzeBtn 恢复可用');
}

/* ══════════════════════════════════════════════
   T16: 计划编辑后预览保持修改内容
   ══════════════════════════════════════════════ */
section('T16: 计划编辑/预览内容持久化');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'planGenerated', merged: '## Original Plan', images: [] });

  // 进入编辑模式
  el('planEditBtn').click();
  const editor = el('planEditor');
  ok(!!editor, '编辑模式 textarea 存在');
  ok(editor.value.includes('Original Plan'), 'textarea 含原始内容');

  // 修改内容
  editor.value = '## Modified Plan\n- new step';

  // 切回预览
  el('planEditBtn').click();
  ok(el('planBody').innerHTML.includes('Modified Plan'), '预览保持修改后内容');
  ok(el('planBody').innerHTML.includes('new step'), '修改的步骤也被保留');

  // 再次编辑 → textarea 应是修改后的内容
  el('planEditBtn').click();
  ok(el('planEditor').value.includes('Modified Plan'), '再次编辑时保持修改内容');
}

/* ══════════════════════════════════════════════
   T17: Step 4 无计划时显示空状态
   ══════════════════════════════════════════════ */
section('T17: Step 4 无计划空状态');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 直接跳到 step 4（无计划）
  const step4Nav = document.querySelectorAll('[data-action="goStep"][data-param="4"]');
  step4Nav[0].click();
  ok(el('step-4').classList.contains('active'), '跳到 step-4');
  // execEmpty 应可见，execContent 应隐藏
  ok(!el('execEmpty').classList.contains('hidden'), '无计划时 execEmpty 可见');
  ok(el('execContent').classList.contains('hidden'), '无计划时 execContent 隐藏');
}

/* ══════════════════════════════════════════════
   T18: 多次模型注入（重渲染）
   ══════════════════════════════════════════════ */
section('T18: 多次模型注入重渲染');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  // 第一次注入 5 个
  dispatch({ type: 'models', models: MODELS_0X });
  ok(document.querySelectorAll('#modelBody tr').length === 5, '第一次：5 行');

  // 第二次注入 2 个
  dispatch({ type: 'models', models: MODELS_0X.slice(0, 2) });
  ok(document.querySelectorAll('#modelBody tr').length === 2, '第二次：覆盖为 2 行');
}

/* ══════════════════════════════════════════════
   T19: matchedSkills 标签高亮
   ══════════════════════════════════════════════ */
section('T19: Skill 标签高亮');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  dispatch({ type: 'allSkills', skills: ['SKILL', 'ui', 'battle', 'events'] });
  dispatch({ type: 'matchedSkills', skills: ['SKILL', 'battle'] });

  const tags = document.querySelectorAll('.skill-tag');
  ok(tags.length === 4, 'skill-tag 总数 = 4');

  const activeNames = Array.from(tags).filter(t => t.classList.contains('active')).map(t => t.textContent);
  ok(activeNames.includes('SKILL'), 'SKILL 标签高亮');
  ok(activeNames.includes('battle'), 'battle 标签高亮');
  ok(!activeNames.includes('ui'), 'ui 标签未高亮');
  ok(!activeNames.includes('events'), 'events 标签未高亮');

  const hint = document.getElementById('skillHint');
  ok(hint.textContent.includes('1'), 'skillHint 含匹配数（battle=1，SKILL不算）');
}

/* ══════════════════════════════════════════════
   T20: 完整 0x 全流程端到端
   ══════════════════════════════════════════════ */
section('T20: 全0x模型端到端流程');
{
  const { document, window, sent } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 1. 加载全 0x 模型
  dispatch({ type: 'models', models: MODELS_0X });
  ok(document.querySelectorAll('.model-check:checked').length === 5, '5 个 0x 全部勾选');

  // 2. 填写需求 + 启动分析
  el('req').value = '用 UniTask 实现全局倒计时系统';
  sent.length = 0;
  el('analyzeBtn').click();
  const aMsg = sent.find(m => m.type === 'analyze');
  ok(!!aMsg, '发送 analyze 消息');
  ok(aMsg.primaryModelId === 'gpt-4o', '主模型 = gpt-4o (0x)');
  ok(aMsg.secondaryModelIds.length === 4, '4 个参谋模型 (全0x)');
  ok(aMsg.secondaryModelIds.every(id => MODELS_0X.some(m => m.id === id)), '参谋模型均为 0x');

  // 3. 后端响应 5 视角
  dispatch({ type: 'modelAnalysisStart' });
  const views = ['需求', '技术', '风险', '顺序', '覆盖'];
  views.forEach((v, i) => dispatch({ type: 'modelStart', modelId: 'v' + i, modelName: v }));
  views.forEach((v, i) => dispatch({ type: 'modelDone', modelId: 'v' + i, analysis: '## ' + v + '\n内容' }));

  ok(!el('toPlanBtn').disabled, '5/5 完成后可生成计划');

  // 4. 手动跳计划
  sent.length = 0;
  el('toPlanBtn').click();
  ok(sent.some(m => m.type === 'generatePlan'), '发送 generatePlan');

  // 5. 注入计划
  dispatch({ type: 'planGenerated', merged: '## UniTask 倒计时\n1. 创建 TimerService\n2. 注册全局事件\n\n> 全部使用 0x 模型完成', images: [] });
  ok(el('planBody').querySelector('h2'), '计划含 H2');
  ok(el('planBody').querySelector('ol'), '计划含有序列表');
  ok(el('planBody').querySelector('blockquote'), '计划含引用');

  // 6. 跳 Step 4 执行
  sent.length = 0;
  document.querySelector('[data-action="goStep"][data-param="4"]').click();
  ok(el('step-4').classList.contains('active'), 'Step 4 激活');
  ok(!el('execContent').classList.contains('hidden'), 'execContent 可见');
  ok(el('execPreview').textContent.includes('TimerService'), '执行预览含计划内容');

  // 7. 执行
  sent.length = 0;
  document.querySelector('[data-action="executeToChat"]').click();
  const eMsg = sent.find(m => m.type === 'executeWithContext');
  ok(!!eMsg, '发送 executeWithContext');
  ok(eMsg.planText.includes('TimerService'), 'planText 含计划内容');
  ok(eMsg.attachSkills === true, 'attachSkills 默认 true');
}

/* ══════════════════════════════════════════════
   T21: 计划图片渲染
   ══════════════════════════════════════════════ */
section('T21: 计划图片渲染');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  dispatch({ type: 'planGenerated',
    merged: '## Plan with images',
    images: [
      { name: 'arch.png', dataUri: 'data:image/png;base64,AAA' },
      { name: 'flow.jpg', dataUri: 'data:image/jpeg;base64,BBB' },
    ]
  });

  const planThumbs = document.querySelectorAll('#planImgThumbs .img-thumb');
  ok(planThumbs.length === 2, '计划图片缩略图 = 2');
  ok(!el('planImgLabel').classList.contains('hidden'), '图片标签可见');
}

/* ══════════════════════════════════════════════
   T22: 空模型列表
   ══════════════════════════════════════════════ */
section('T22: 空模型列表');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  dispatch({ type: 'models', models: [] });
  const body = document.getElementById('modelBody');
  ok(body.innerHTML.includes('未找到'), '空模型时显示"未找到"提示');
  ok(body.querySelectorAll('tr').length === 1, '仅一行提示');
}

/* ══════════════════════════════════════════════
   T23: XSS via model name (二次防护)
   ══════════════════════════════════════════════ */
section('T23: 模型名 XSS 防护');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  dispatch({ type: 'models', models: [
    { id: 'xss-model', name: '<img src=x onerror=alert(1)>', family: 'xss', multiplier: 0, multiplierSource: 'table', maxInputTokens: 1000 },
  ]});

  const body = document.getElementById('modelBody');
  ok(!body.innerHTML.includes('<img '), '模型名 img 标签被转义');
  ok(body.innerHTML.includes('&lt;img'), '模型名安全输出');
}

/* ══════════════════════════════════════════════
   T24: restoreSettings — inputMode + lastRequirement
   ══════════════════════════════════════════════ */
section('T24: restoreSettings 恢复 inputMode + lastRequirement');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 默认应该是 requirement 模式
  ok(el('modeRequirement') && !el('modeRequirement').classList.contains('hidden'), '默认 requirement 模式可见');

  // 切换到 conversation 模式
  dispatch({ type: 'restoreSettings', settings: {
    primaryModelId: '',
    secondaryModelIds: [],
    attachSkills: true,
    attachImages: false,
    attachAnalysis: true,
    inputMode: 'conversation',
    lastRequirement: '之前输入的需求文本',
  }});

  ok(el('modeConversation') && !el('modeConversation').classList.contains('hidden'), '恢复后 conversation 模式可见');
  ok(el('modeRequirement').classList.contains('hidden'), '恢复后 requirement 模式隐藏');
  ok(el('req').value === '之前输入的需求文本', 'lastRequirement 恢复到输入框');
}

/* ══════════════════════════════════════════════
   T25: autoSaveSettings 包含新字段
   ══════════════════════════════════════════════ */
section('T25: autoSaveSettings 发送 inputMode + lastRequirement');
{
  const { document, window, sent } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 注入模型先
  dispatch({ type: 'models', models: MODELS_0X });
  // 写入需求文本
  el('req').value = '测试需求持久化';
  // 切换到 conversation 模式（会触发 autoSaveSettings）
  sent.length = 0;
  document.querySelector('[data-action="setMode"][data-param="conversation"]').click();
  const saveMsg = sent.find(m => m.type === 'saveSettings');
  ok(!!saveMsg, '切换模式后发送 saveSettings');
  ok(saveMsg.inputMode === 'conversation', 'saveSettings 含 inputMode=conversation');
  ok(saveMsg.lastRequirement === '测试需求持久化', 'saveSettings 含 lastRequirement');
}

/* ══════════════════════════════════════════════
   T26: restoreSettings null — 无崩溃
   ══════════════════════════════════════════════ */
section('T26: restoreSettings null 安全');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));

  // null settings should not crash
  dispatch({ type: 'restoreSettings', settings: null });
  ok(true, 'restoreSettings(null) 无崩溃');

  // partial settings (backward compat — old format without new fields)
  dispatch({ type: 'restoreSettings', settings: {
    primaryModelId: 'gpt-4o',
    secondaryModelIds: [],
    attachSkills: true,
    attachImages: false,
    attachAnalysis: false,
  }});
  ok(document.getElementById('attachSkills').checked === true, '旧格式设置正常恢复');
  // inputMode should stay as default when not provided
  ok(!document.getElementById('modeRequirement').classList.contains('hidden'), '未提供 inputMode 时保持默认');
}

/* ══════════════════════════════════════════════
   T27: lastRequirement 不覆盖已有输入
   ══════════════════════════════════════════════ */
section('T27: lastRequirement 不覆盖已有输入');
{
  const { document, window } = createFreshDom();
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { data }));
  const el = id => document.getElementById(id);

  // 用户已经手动输入了内容
  el('req').value = '用户正在编辑的需求';

  dispatch({ type: 'restoreSettings', settings: {
    primaryModelId: '',
    secondaryModelIds: [],
    attachSkills: true,
    attachImages: false,
    attachAnalysis: true,
    inputMode: 'requirement',
    lastRequirement: '旧的缓存需求',
  }});

  ok(el('req').value === '用户正在编辑的需求', 'lastRequirement 不覆盖已有输入');
}

/* ══════════════════════════════════════════════
   报告
   ══════════════════════════════════════════════ */
console.log('\n' + '='.repeat(52));
const total = pass + fail;
if (fail === 0) {
  console.log('\u2705 \u8865\u5145\u96c6\u6210\u6d4b\u8bd5\u5168\u90e8\u901a\u8fc7\uff1a' + pass + '/' + total);
  process.exit(0);
} else {
  console.error('\u274c ' + fail + ' \u9879\u5931\u8d25/' + total + ' \u603b\u8ba1');
  console.error('\u5931\u8d25\u9879\uff1a\n  ' + failures.join('\n  '));
  process.exit(1);
}
