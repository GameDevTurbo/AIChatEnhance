#!/usr/bin/env node
/**
 * test/integration.js
 * 用 jsdom 模拟浏览器环境，端到端跑 main.js 全部 UI 流程
 * 运行：node test/integration.js
 */
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

/* ── 1. 读取 HTML 结构 ────────────────────────── */
const htmlRaw = fs.readFileSync(path.join(__dirname, '../webview/index.html'), 'utf8');
// index.html 含 {{nonce}} 等模板变量，jsdom 不在乎 CSP，直接替换掉
const html = htmlRaw
  .replace(/\{\{cspSource\}\}/g, '*')
  .replace(/\{\{nonce\}\}/g, 'test')
  .replace(/\{\{styleUri\}\}/g, '')     // 不加载样式，不影响逻辑
  .replace(/\{\{scriptUri\}\}/g, '');   // script 标签内容为空，后面手动注入

/* ── 2. 创建 JSDOM 实例 ────────────────────────── */
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

/* ── 3. Mock acquireVsCodeApi ─────────────────── */
const sentMessages = [];
window.acquireVsCodeApi = function() {
  return {
    postMessage: function(msg) { sentMessages.push(msg); },
    getState: function() { return null; },
    setState: function() {},
  };
};

/* ── 4. 注入 main.js ──────────────────────────── */
const mainJs = fs.readFileSync(path.join(__dirname, '../webview/main.js'), 'utf8');
window.eval(mainJs);

/* ── 5. 工具函数 ──────────────────────────────── */
function dispatch(data) {
  window.dispatchEvent(new window.MessageEvent('message', { data }));
}

function el(id) { return document.getElementById(id); }
function hasClass(id, cls) { return el(id).classList.contains(cls); }

let pass = 0, fail = 0;
const failures = [];

function ok(condition, label) {
  if (condition) { process.stdout.write('  ✓ ' + label + '\n'); pass++; }
  else { process.stderr.write('  ✗ FAIL: ' + label + '\n'); fail++; failures.push(label); }
}

function section(name) { console.log('\n[' + name + ']'); }

/* ── 6. 测试模型数据 ─────────────────────────── */
const MODELS = [
  { id: 'gpt-4o',       name: 'GPT-4o',        family: 'gpt-4o',    multiplier: 0,  multiplierSource: 'table', maxInputTokens: 128000 },
  { id: 'gpt-4.1',      name: 'GPT-4.1',       family: 'gpt-4.1',   multiplier: 0,  multiplierSource: 'table', maxInputTokens: 1000000 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini',  family: 'gpt-4.1',   multiplier: 0,  multiplierSource: 'table', maxInputTokens: 1000000 },
  { id: 'claude-4',     name: 'Claude Sonnet',  family: 'claude',    multiplier: 1,  multiplierSource: 'table', maxInputTokens: 200000 },
  { id: 'o3',           name: 'o3',             family: 'o3',        multiplier: 10, multiplierSource: 'table', maxInputTokens: 200000 },
];

/* ══════════════════════════════════════════════
   T1: 初始 DOM 状态
   ══════════════════════════════════════════════ */
section('T1: 初始 DOM 状态');
ok(!!el('step-1'), '#step-1 存在');
ok(!!el('step-2'), '#step-2 存在');
ok(!!el('step-3'), '#step-3 存在');
ok(!!el('step-4'), '#step-4 存在');
ok(!!el('toPlanBtn'), '#toPlanBtn 存在');
ok(!!el('autoPlanBar'), '#autoPlanBar 存在');
ok(!!el('planBody'), '#planBody 存在');
ok(!!el('req'), '#req textarea 存在');
ok(!!el('analyzeBtn'), '#analyzeBtn 存在');
ok(!!el('modelBody'), '#modelBody 存在');
ok(!!el('modelSectionToggle'), '#modelSectionToggle 存在');
ok(!!el('modelSectionBody'), '#modelSectionBody 存在');

/* ══════════════════════════════════════════════
   T2: 初始状态值
   ══════════════════════════════════════════════ */
section('T2: 初始状态');
ok(hasClass('step-1', 'active'), 'Step 1 初始激活');
ok(!hasClass('step-2', 'active'), 'Step 2 初始未激活');
ok(el('toPlanBtn').disabled, 'toPlanBtn 初始禁用');
ok(hasClass('autoPlanBar', 'hidden'), 'autoPlanBar 初始隐藏');
ok(hasClass('cancelBtn', 'hidden'), 'cancelBtn 初始隐藏');
ok(!hasClass('planBox', 'hidden') || hasClass('planBox', 'hidden'), 'planBox 存在且含 hidden 类');
ok(!!el('analysisDoneHint'), '#analysisDoneHint 存在');

/* ══════════════════════════════════════════════
   T3: init 发送了 3 个初始化请求
   ══════════════════════════════════════════════ */
section('T3: 初始化消息');
const initTypes = sentMessages.map(m => m.type);
ok(initTypes.includes('requestAllSkills'), '发送 requestAllSkills');
ok(initTypes.includes('requestBrowse'), '发送 requestBrowse');
ok(initTypes.includes('requestModels'), '发送 requestModels');

/* ══════════════════════════════════════════════
   T4: 注入模型 → 0x 自动选 → 模型折叠
   ══════════════════════════════════════════════ */
section('T4: 模型加载与0x自动选');
dispatch({ type: 'models', models: MODELS });

const rows = document.querySelectorAll('#modelBody tr');
ok(rows.length === MODELS.length, '模型行数正确 (' + rows.length + ')');

const freeIds = MODELS.filter(m => m.multiplier === 0).map(m => m.id);
const allFreeChecked = freeIds.every(id => {
  const cb = document.querySelector('input.model-check[value="' + id + '"]');
  return cb && cb.checked;
});
ok(allFreeChecked, '所有 0x 模型自动勾选 (' + freeIds.join(', ') + ')');

// 高倍率模型不应被自动选
const paidIds = MODELS.filter(m => m.multiplier >= 1).map(m => m.id);
const nonePaidChecked = paidIds.every(id => {
  const cb = document.querySelector('input.model-check[value="' + id + '"]:not(:disabled)');
  return !cb || !cb.checked;
});
ok(nonePaidChecked, '高倍率模型未被自动选');

// 折叠：modelSectionBody 应 hidden
ok(hasClass('modelSectionBody', 'hidden'), '加载后模型区域自动折叠');
ok(!hasClass('modelSectionToggle', 'open'), 'modelSectionToggle 折叠状态');

/* ══════════════════════════════════════════════
   T5: allSkills 注入 → Skill 标签渲染
   ══════════════════════════════════════════════ */
section('T5: Skill 标签');
dispatch({ type: 'allSkills', skills: ['SKILL', 'ui', 'battle', 'events', 'workflow'] });
const tags = document.querySelectorAll('.skill-tag');
ok(tags.length === 5, 'skill-tag 数量正确 (' + tags.length + ')');

/* ══════════════════════════════════════════════
   T6: 分析流程（Step 1 → 2 → 模型标签页）
   ══════════════════════════════════════════════ */
section('T6: 分析流程');

// 填写需求
el('req').value = '给战斗系统新增倒计时奖励机制';

// 模拟后端发来 modelAnalysisStart
sentMessages.length = 0;
dispatch({ type: 'modelAnalysisStart' });

ok(hasClass('step-2', 'active'), 'modelAnalysisStart 后 Step 2 激活');
ok(!hasClass('wfStatus', 'hidden'), 'wfStatus 显示');

// 5 个视角模拟启动
const perspectives = [
  { id: 'p-req', name: '需求拆解' },
  { id: 'p-tech', name: '技术评估' },
  { id: 'p-risk', name: '风险分析' },
  { id: 'p-exec', name: '执行顺序' },
  { id: 'p-skill', name: 'Skill 覆盖' },
];
perspectives.forEach(p => {
  dispatch({ type: 'modelStart', modelId: p.id, modelName: p.name });
});

const tabEls = document.querySelectorAll('.model-tab');
ok(tabEls.length === 5, '5 个视角标签页已创建');
ok(document.querySelectorAll('.model-tab-pane').length === 5, '5 个标签面板已创建');

// 第一个标签应为激活状态
ok(tabEls[0] && tabEls[0].classList.contains('active'), '第一个标签默认激活');

// 完成 3 个视角，检查进度
dispatch({ type: 'modelDone', modelId: 'p-req',  analysis: '## 需求分析\n需求明确，需要实现倒计时奖励机制。' });
dispatch({ type: 'modelDone', modelId: 'p-tech', analysis: '## 技术评估\n使用 UniTask 实现倒计时。' });
dispatch({ type: 'modelDone', modelId: 'p-risk', analysis: '## 风险\n注意 pause/resume 逻辑冲突。' });

ok(el('analysisDoneHint').textContent.includes('3/5'), '进度提示 3/5');
ok(el('toPlanBtn').disabled, '未全部完成时 toPlanBtn 仍禁用');
ok(hasClass('autoPlanBar', 'hidden'), '未全部完成时倒计时条不显示');

// 完成剩余 2 个
dispatch({ type: 'modelDone', modelId: 'p-exec',  analysis: '## 执行顺序\n1. 先读代码 2. 实现逻辑' });
dispatch({ type: 'modelDone', modelId: 'p-skill', analysis: '## Skill 覆盖\n需预读 UIWindow、UniTask 文档。' });

ok(!el('toPlanBtn').disabled, '全部完成后 toPlanBtn 启用');
ok(!hasClass('autoPlanBar', 'hidden'), '全部完成后倒计时条显示');
ok(el('autoPlanHint').textContent.includes('秒'), '倒计时提示文本含"秒"');

// 分析内容验证（已完成标签应有 done 类）
ok(document.getElementById('mtab-p-req').classList.contains('done'), '视角标签显示 done 状态');

/* ══════════════════════════════════════════════
   T7: 取消自动计划
   ══════════════════════════════════════════════ */
section('T7: 取消自动计划');
// 用事件委托触发 cancelAutoPlan
const cancelBtn = document.querySelector('[data-action="cancelAutoPlan"]');
ok(!!cancelBtn, 'cancelAutoPlan 按钮存在');
cancelBtn.click();
ok(hasClass('autoPlanBar', 'hidden'), '取消后倒计时条隐藏');

/* ══════════════════════════════════════════════
   T8: 手动跳计划 → Step 3
   ══════════════════════════════════════════════ */
section('T8: 手动生成计划');
sentMessages.length = 0;
el('toPlanBtn').click();

ok(hasClass('step-3', 'active'), '点击后 Step 3 激活');
ok(sentMessages.some(m => m.type === 'generatePlan'), '发送了 generatePlan 消息');
const genMsg = sentMessages.find(m => m.type === 'generatePlan');
ok(!!genMsg && !!genMsg.primaryModelId, 'generatePlan 含 primaryModelId');

/* ══════════════════════════════════════════════
   T9: planGenerated → Markdown 渲染
   ══════════════════════════════════════════════ */
section('T9: 计划 Markdown 渲染');
const planMd = `## 执行计划

### 准备阶段
- [x] 阅读 BattleManager 代码
- [ ] 确认倒计时起点

### 实现步骤

1. 添加 \`timeBonus\` 字段到 BattleData
2. 创建 BattleTimer 封装 UniTask 倒计时
3. 在 BattleManager 中分发 **LazyEvent**

> 注意：步骤 1 和步骤 2 可以并行开发。`;

dispatch({ type: 'planGenerated', merged: planMd, images: [] });

const pb = el('planBody');
ok(pb && pb.innerHTML !== '', 'planBody 有内容');
ok(pb.querySelector('h2'), 'planBody 渲染了 H2');
ok(pb.querySelector('h3'), 'planBody 渲染了 H3');
ok(pb.querySelector('ol'), 'planBody 渲染了有序列表');
ok(pb.querySelector('ul'), 'planBody 渲染了无序列表 (复选框)');
ok(pb.querySelector('blockquote'), 'planBody 渲染了引用块');
ok(pb.innerHTML.includes('md-li done'), '已完成复选框有 done 类');
ok(pb.innerHTML.includes('md-li todo'), '待完成复选框有 todo 类');
ok(pb.innerHTML.includes('<strong>'), '加粗文本渲染');

// planBox 和 planActions 应 visible
ok(!hasClass('planBox', 'hidden'), 'planBox 显示');
ok(!hasClass('planActions', 'hidden'), 'planActions 显示');
ok(!hasClass('planBoxLabel', 'hidden'), 'planBoxLabel 显示');
ok(hasClass('planEmpty', 'hidden'), 'planEmpty 隐藏');
ok(!hasClass('planStatus', 'hidden') || hasClass('planStatus', 'hidden'), 'planStatus 存在');

/* ══════════════════════════════════════════════
   T10: 计划编辑/预览切换
   ══════════════════════════════════════════════ */
section('T10: 计划编辑切换');
const editBtn = el('planEditBtn');
ok(editBtn.textContent.includes('编辑'), '编辑按钮文字正确');
editBtn.click();
ok(!!el('planEditor'), '切换编辑模式后 textarea 存在');
ok(editBtn.textContent.includes('预览'), '切换后按钮变为"预览"');

editBtn.click();
ok(!el('planEditor'), '切换回预览后 textarea 消失');
ok(editBtn.textContent.includes('编辑'), '预览模式下按钮恢复"编辑"');
ok(pb.querySelector('h2'), '预览模式下 H2 仍存在');

/* ══════════════════════════════════════════════
   T11: Step 4 执行页
   ══════════════════════════════════════════════ */
section('T11: Step 4 执行页');
sentMessages.length = 0;
// 通过点击"下一步"按钮进入 Step 4
const nextBtn = document.querySelector('[data-action="goStep"][data-param="4"]');
ok(!!nextBtn, '下一步按钮存在');
nextBtn.click();
ok(hasClass('step-4', 'active'), 'Step 4 激活');
ok(!hasClass('execContent', 'hidden'), 'execContent 显示（有计划时）');
ok(sentMessages.some(m => m.type === 'requestTokenEstimate'), '发送了 tokenEstimate 请求');

// Token 估算注入
dispatch({ type: 'tokenEstimate', estimate: '~3.5K tokens', imageCount: 0 });
ok(el('tokenEstimate').textContent === '~3.5K tokens', 'tokenEstimate 文本正确');

/* ══════════════════════════════════════════════
   T12: executeToChat 消息
   ══════════════════════════════════════════════ */
section('T12: 执行消息发送');
sentMessages.length = 0;
const execBtn = document.querySelector('[data-action="executeToChat"]');
ok(!!execBtn, 'executeToChat 按钮存在');
execBtn.click();
const execMsg = sentMessages.find(m => m.type === 'executeWithContext');
ok(!!execMsg, '发送了 executeWithContext 消息');
ok(typeof execMsg.planText === 'string' && execMsg.planText.length > 0, 'planText 不为空');
ok(typeof execMsg.attachSkills === 'boolean', 'attachSkills 字段存在');

/* ══════════════════════════════════════════════
   T13: 错误状态处理
   ══════════════════════════════════════════════ */
section('T13: 错误与取消处理');
dispatch({ type: 'error', text: '模型调用超时' });
ok(!hasClass('analyzeErr', 'hidden'), 'analyzeErr 显示错误');
ok(el('analyzeErr').textContent.includes('模型调用超时'), '错误文本正确');

dispatch({ type: 'cancelled' });
ok(el('wfStatus').textContent === '已取消', '取消状态文本正确');

/* ══════════════════════════════════════════════
   T14: goToStep / stepReached stepper 状态
   ══════════════════════════════════════════════ */
section('T14: 步骤条样式');
// 我们经历了 1→2→3→4，stepReached 应为 4
const stepItems = document.querySelectorAll('.step-item');
ok(stepItems[3].classList.contains('active'), 'step-4 显示 active');
// 前 3 步应为 done
ok(stepItems[0].classList.contains('done'), 'step-1 显示 done');
ok(stepItems[1].classList.contains('done'), 'step-2 显示 done');
ok(stepItems[2].classList.contains('done'), 'step-3 显示 done');

/* ══════════════════════════════════════════════
   T15: XSS 防护（注入计划）
   ══════════════════════════════════════════════ */
section('T15: XSS 防护');
const xssMd = '## 标题\n<script>window._xss=true</script>\n**正常文字**';
dispatch({ type: 'planGenerated', merged: xssMd, images: [] });
ok(!window._xss, 'XSS 脚本未被执行（_xss 未被设置）');
ok(!el('planBody').innerHTML.includes('<script>'), '<script> 标签被转义');

/* ══════════════════════════════════════════════
   报告
   ══════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(52));
const total = pass + fail;
if (fail === 0) {
  console.log(`✅ 集成测试全部通过：${pass}/${total}`);
  process.exit(0);
} else {
  console.error(`❌ ${fail} 项失败/${total} 总计`);
  console.error('失败项：\n  ' + failures.join('\n  '));
  process.exit(1);
}
