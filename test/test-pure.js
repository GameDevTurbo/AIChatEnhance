#!/usr/bin/env node
/**
 * test-pure.js — 纯函数自动化测试（无需浏览器，无需 VS Code）
 * 运行方式：node test/test-pure.js
 *
 * 测试范围：
 *  - renderMarkdown / inlineMd（从 main.js 提取逻辑，独立验证）
 *  - 0x 模型自动选逻辑
 *  - 倒计时状态机逻辑
 */
'use strict';

const assert = require('assert');

/* ══════════════════════════════════════════════════
   复制 main.js 中的纯函数（不依赖 DOM / vscode API）
   ══════════════════════════════════════════════════ */

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

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

/* ══════════════════════════════════════════════════
   模型筛选逻辑（从 renderModels 提取）
   ══════════════════════════════════════════════════ */
function pickDefaultPrimaryIdx(models) {
  let defaultIdx = 0;
  for (let di = 0; di < models.length; di++) {
    if (models[di].multiplier === 1) { defaultIdx = di; break; }
  }
  return defaultIdx;
}

function selectZeroXModels(models) {
  return models.filter(m => m.multiplier === 0).map(m => m.id);
}

/* ══════════════════════════════════════════════════
   TEST RUNNER
   ══════════════════════════════════════════════════ */
let pass = 0, fail = 0;
const errors = [];

function ok(condition, label) {
  if (condition) {
    console.log('  ✓', label);
    pass++;
  } else {
    console.error('  ✗ FAIL:', label);
    fail++;
    errors.push(label);
  }
}

function section(name) {
  console.log('\n[' + name + ']');
}

/* ─── T1: inlineMd ─── */
section('T1: inlineMd 转义与格式化');
ok(inlineMd('hello <world>') === 'hello &lt;world&gt;', 'HTML 转义 <');
ok(inlineMd('AT&T') === 'AT&amp;T', 'HTML 转义 &');
ok(inlineMd('**bold**') === '<strong>bold</strong>', '加粗 **...**');
ok(inlineMd('`code`') === '<code class="md-code">code</code>', '行内代码');
ok(inlineMd('**a** and `b`') === '<strong>a</strong> and <code class="md-code">b</code>', '混合格式');

/* ─── T2: renderMarkdown — 空/null ─── */
section('T2: renderMarkdown 边界');
ok(renderMarkdown('') === '', '空字符串返回空');
ok(renderMarkdown(null) === '', 'null 返回空');
ok(renderMarkdown(undefined) === '', 'undefined 返回空');

/* ─── T3: 标题 ─── */
section('T3: 标题渲染');
const h2 = renderMarkdown('## Hello World');
ok(h2.includes('<h2 class="md-h2">'), 'H2 标签正确');
ok(h2.includes('Hello World'), 'H2 内容正确');
const h3 = renderMarkdown('### Sub Title');
ok(h3.includes('<h3 class="md-h3">'), 'H3 标签正确');

/* ─── T4: 列表 ─── */
section('T4: 列表渲染');
const ul = renderMarkdown('- item 1\n- item 2');
ok(ul.includes('<ul class="md-list">'), 'ul 标签');
ok(ul.includes('</ul>'), 'ul 闭合');
ok((ul.match(/<li/g) || []).length === 2, '两个 li');

const ol = renderMarkdown('1. first\n2. second');
ok(ol.includes('<ol class="md-list md-ol">'), 'ol 标签');
ok((ol.match(/<li/g) || []).length === 2, '两个有序 li');

/* ─── T5: 复选框 ─── */
section('T5: 复选框');
const checked = renderMarkdown('- [x] Done item');
ok(checked.includes('class="md-li done"'), '已完成复选框 class');
ok(checked.includes('&#10003;'), '已完成符号 ✓');

const todo = renderMarkdown('- [ ] Todo item');
ok(todo.includes('class="md-li todo"'), '待完成复选框 class');
ok(todo.includes('&#9744;'), '待完成符号 ☐');

/* ─── T6: 引用块 ─── */
section('T6: 引用块');
const bq = renderMarkdown('> Important note');
ok(bq.includes('<blockquote class="md-quote">'), 'blockquote 标签');
ok(bq.includes('Important note'), 'blockquote 内容');

/* ─── T7: 列表切换（列表后跟非列表） ─── */
section('T7: 列表正确闭合');
const mixed = renderMarkdown('- item\n\nParagraph');
ok(mixed.includes('</ul>'), 'ul 在空行前正确闭合');
ok(mixed.includes('<div class="md-p">'), 'Paragraph 正确渲染');

/* ─── T8: HTML 注入防范（XSS） ─── */
section('T8: XSS 防护');
const xss = renderMarkdown('<script>alert(1)</script>');
ok(!xss.includes('<script>'), '脚本标签被转义');
ok(xss.includes('&lt;script&gt;'), '脚本标签内容可见（已转义）');

const xssAttr = renderMarkdown('**"><img src=x onerror=alert(1)>**');
ok(!xssAttr.includes('<img '), '属性注入：<img 标签已转义（无裸露标签）');
ok(xssAttr.includes('&lt;img'), '属性注入：img 以 &lt;img 形式出现（安全文本）');

/* ─── T9: esc / escAttr / escId ─── */
section('T9: 工具函数');
ok(esc('<div>') === '&lt;div&gt;', 'esc 转义标签');
ok(escAttr('"value"') === '&quot;value&quot;', 'escAttr 转义引号');
ok(escId('model.id/test') === 'model_id_test', 'escId 移除非法字符');

/* ─── T10: 0x 模型自动选逻辑 ─── */
section('T10: 0x 模型自动选');
const MODELS = [
  { id: 'gpt-4o',       name: 'GPT-4o',        multiplier: 0  },
  { id: 'gpt-4.1',      name: 'GPT-4.1',        multiplier: 0  },
  { id: 'claude',       name: 'Claude',          multiplier: 1  },
  { id: 'o3',           name: 'o3',              multiplier: 10 },
];

const freeIds = selectZeroXModels(MODELS);
ok(freeIds.length === 2, '0x 模型数量正确（2个）');
ok(freeIds.includes('gpt-4o'), 'gpt-4o 在自动选列表');
ok(freeIds.includes('gpt-4.1'), 'gpt-4.1 在自动选列表');
ok(!freeIds.includes('claude'), '1x 模型不在自动选列表');
ok(!freeIds.includes('o3'), '10x 模型不在自动选列表');

/* ─── T11: 主模型 defaultIdx 逻辑 ─── */
section('T11: 主模型默认选择');
ok(pickDefaultPrimaryIdx(MODELS) === 2, '默认主模型=第一个1x模型（claude，idx=2）');
const allFreeModels = [
  { id: 'a', multiplier: 0 },
  { id: 'b', multiplier: 0 },
];
ok(pickDefaultPrimaryIdx(allFreeModels) === 0, '全0x时默认选第一个');

/* ─── T12: ANALYSIS_PERSPECTIVES 数量检查 ─── */
section('T12: 分析视角数量（文件内容验证）');
try {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../src/LmAnalyzer.ts'), 'utf8');
  const ids = [...src.matchAll(/id:\s*'(\w+)'/g)].map(m => m[1]);
  const perspectiveIds = ids.filter(id =>
    ['requirements', 'technical', 'risks', 'execution_sequence', 'skill_coverage'].includes(id)
  );
  ok(perspectiveIds.length === 5, '5个分析视角已定义（当前=' + perspectiveIds.length + '）');
  ok(perspectiveIds.includes('execution_sequence'), '含执行顺序视角');
  ok(perspectiveIds.includes('skill_coverage'), '含Skill覆盖视角');
} catch(e) {
  console.warn('  ⚠ 跳过文件读取：', e.message);
}

/* ─── T13: 编译输出验证 ─── */
section('T13: 编译输出存在性');
try {
  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '../out');
  const hasOut = fs.existsSync(outDir);
  ok(hasOut, 'out/ 目录存在');
  if (hasOut) {
    const files = fs.readdirSync(outDir);
    ok(files.some(f => f.endsWith('.js')), 'out/ 目录含编译后 .js 文件');
    ok(files.includes('LmAnalyzer.js'), 'LmAnalyzer.js 已编译');
    ok(files.includes('PlannerPanel.js'), 'PlannerPanel.js 已编译');
  }
} catch(e) {
  console.warn('  ⚠ 跳过：', e.message);
}

/* ══════════════════════════════════════════════════
   报告
   ══════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(48));
const total = pass + fail;
if (fail === 0) {
  console.log(`✅ 全部通过：${pass}/${total}`);
  process.exit(0);
} else {
  console.error(`❌ ${fail} 项失败/${total} 总计`);
  console.error('失败项：', errors.join('\n        '));
  process.exit(1);
}
