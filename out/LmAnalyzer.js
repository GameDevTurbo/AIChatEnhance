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
exports.getAvailableModels = getAvailableModels;
exports.runWorkflow = runWorkflow;
exports.runModelParallelAnalysis = runModelParallelAnalysis;
exports.generatePlan = generatePlan;
exports.analyzeConversation = analyzeConversation;
exports.regeneratePlan = regeneratePlan;
const vscode = __importStar(require("vscode"));
// ─── Skill 专属分析提示 ─────────────────────────────
const SKILL_PROMPTS = {
    'context': '从项目架构视角分析：涉及的关键文件路径、模块结构、依赖关系。200字以内。',
    'code': '从代码规范视角分析：命名规范、异步模式、日志规范等具体要求。200字以内。',
    'ui': '从 UI 视角分析：涉及的界面组件、交互流程变化。200字以内。',
    'battle': '从核心系统视角分析：涉及的核心组件变化和系统交互。200字以内。',
    'events': '从事件系统视角分析：需新增/修改的事件定义和订阅者管理。200字以内。',
    'docs': '从文档维护视角分析：需同步更新的文档和条目。150字以内。',
    'communication': '从沟通规则视角分析：有哪些需要确认的设计决策？100字以内。',
    'workflow': '从工作流视角分析：建议的执行顺序、可并行步骤、验证检查点。150字以内。',
    'review': '从审查视角分析：此改动涉及哪些需要审查的模块？100字以内。',
    'issues': '从历史问题视角分析：是否可能触发已知问题？需要注意什么？100字以内。',
    'SKILL': '从整体规范视角分析：最重要的约束和最佳实践。150字以内。',
};
// ─── 工具函数 ─────────────────────────────────────
async function streamToString(response, token) {
    let result = '';
    for await (const chunk of response.text) {
        if (token.isCancellationRequested) {
            break;
        }
        result += chunk;
    }
    return result;
}
// ─── 模型消耗倍率映射（GitHub Copilot premium request 倍率，2026.3 官方文档） ──
// 0 = included（付费计划不消耗 premium request）
const DEFAULT_MULTIPLIERS = {
    // Included (0x)
    'gpt-4.1': 0,
    'gpt-4o': 0,
    'gpt-5-mini': 0,
    'raptor-mini': 0,
    // Low-cost (<1x)
    'grok-code-fast-1': 0.25,
    'claude-haiku-4.5': 0.33,
    'gemini-3-flash': 0.33,
    'gpt-5.1-codex-mini': 0.33,
    'gpt-5.4-mini': 0.33,
    // Standard (1x)
    'claude-sonnet-4': 1,
    'claude-sonnet-4.5': 1,
    'claude-sonnet-4.6': 1,
    'gemini-2.5-pro': 1,
    'gemini-3-pro': 1,
    'gemini-3.1-pro': 1,
    'gpt-5.1': 1,
    'gpt-5.1-codex': 1,
    'gpt-5.1-codex-max': 1,
    'gpt-5.2': 1,
    'gpt-5.2-codex': 1,
    'gpt-5.3-codex': 1,
    'gpt-5.4': 1,
    // Premium (>1x)
    'claude-opus-4.5': 3,
    'claude-opus-4.6': 3,
    'claude-opus-4.6-fast': 30,
};
/** 合并默认 + 用户配置的倍率表 */
function getMultiplierTable() {
    const overrides = vscode.workspace.getConfiguration('aichatEnhance')
        .get('modelMultipliers', {});
    return { ...DEFAULT_MULTIPLIERS, ...overrides };
}
// 片段级 fallback：当精确匹配失败时用关键词推断
const MULTIPLIER_KEYWORDS = [
    ['haiku', 0.33],
    ['flash', 0.33],
    ['mini', 0.33],
    ['sonnet', 1],
    ['pro', 1],
    ['codex', 1],
    ['opus', 3],
];
function getMultiplier(family, name) {
    const table = getMultiplierTable();
    // 1) 精确匹配 family
    const key = family.toLowerCase();
    if (table[key] !== undefined) {
        return { value: table[key], source: 'table' };
    }
    // 2) 名称匹配（空格↔连字符 归一化后比较）
    const nameNorm = name.toLowerCase().replace(/[\s-]+/g, '-');
    // 按 key 长度降序匹配，避免短 key 误命中长模型名
    const sorted = Object.entries(table).sort((a, b) => b[0].length - a[0].length);
    for (const [k, v] of sorted) {
        if (nameNorm.includes(k)) {
            return { value: v, source: 'table' };
        }
    }
    // 3) 关键词 fallback
    const combined = `${key} ${nameNorm}`;
    for (const [kw, v] of MULTIPLIER_KEYWORDS) {
        if (combined.includes(kw)) {
            return { value: v, source: 'keyword' };
        }
    }
    return undefined;
}
async function getAvailableModels(hiddenPatterns) {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    let result = models.map(m => {
        // 优先读运行时属性（Copilot 扩展可能注入了额外字段）
        const runtime = m;
        const apiMult = typeof runtime.requestMultiplier === 'number' ? runtime.requestMultiplier : undefined;
        const tableMult = apiMult === undefined ? getMultiplier(m.family ?? '', m.name) : undefined;
        return {
            id: m.id,
            name: m.name,
            family: m.family ?? '',
            version: m.version ?? '',
            maxInputTokens: m.maxInputTokens ?? 0,
            multiplier: apiMult ?? tableMult?.value,
            multiplierSource: apiMult !== undefined ? 'api'
                : tableMult !== undefined ? tableMult.source
                    : 'unknown',
        };
    });
    if (hiddenPatterns?.length) {
        result = result.filter(m => {
            const lower = `${m.id} ${m.name} ${m.family}`.toLowerCase();
            return !hiddenPatterns.some(p => lower.includes(p.toLowerCase()));
        });
    }
    // 按倍率排序：已知倍率从低到高，未知排最后
    result.sort((a, b) => {
        const ma = a.multiplier ?? 999;
        const mb = b.multiplier ?? 999;
        return ma - mb;
    });
    return result;
}
function resolveParticipants(allModels, config) {
    let primary;
    if (config.primaryId) {
        primary = allModels.find(m => m.id === config.primaryId);
    }
    if (!primary) {
        primary = allModels.find(m => !/mini|flash|haiku|lite/i.test(m.family ?? '')) ?? allModels[0];
    }
    const secondaries = config.secondaryIds
        .map(id => allModels.find(m => m.id === id))
        .filter((m) => !!m && m.id !== primary.id);
    return { primary, all: [primary, ...secondaries] };
}
// ─── 需求分析工作流（按 Skill 节点拆分，保留兼容） ──
async function runWorkflow(requirement, skills, modelConfig, onNodeStart, onNodeDone, onNodeError, onProgress, token, images) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型，请确认已登录 GitHub Copilot');
    }
    const { primary, all } = resolveParticipants(allModels, modelConfig);
    onProgress(`主模型: ${primary.name} | 并行处理 ${skills.length} 个节点`);
    const nodePromises = skills.map(async (skill, i) => {
        const model = all[i % all.length];
        onNodeStart(skill.name, model.name);
        const prompt = SKILL_PROMPTS[skill.name] ?? '分析这个需求的关键实现要点。200字以内。';
        const systemCtx = `你是 AI 规划助手。以下是 [${skill.name}] 参考资料：\n\n${skill.content.slice(0, 600)}\n\n`;
        try {
            const parts = [
                new vscode.LanguageModelTextPart(`${systemCtx}用户需求：${requirement}\n\n${prompt}`)
            ];
            if (images?.length) {
                for (const img of images) {
                    parts.push(vscode.LanguageModelDataPart.image(img.data, img.mimeType));
                }
                parts.push(new vscode.LanguageModelTextPart(`\n\n以上附带了 ${images.length} 张参考图片，请结合图片内容分析。`));
            }
            const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(parts)], {}, token);
            const analysis = await streamToString(response, token);
            onNodeDone(skill.name, analysis);
            return { skillName: skill.name, analysis };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onNodeError(skill.name, msg);
            return { skillName: skill.name, analysis: `[错误] ${msg}` };
        }
    });
    const nodes = await Promise.all(nodePromises);
    const merged = '';
    return { nodes, merged };
}
// 多视角分析视角定义
const ANALYSIS_PERSPECTIVES = [
    {
        id: 'requirements',
        label: '需求拆解',
        prompt: `你是需求分析专家。请只根据用户提供的需求文本本身进行分析，不要假设任何项目框架或技术栈。

分析目标：
1. 这个需求的核心目标是什么？用一句话概括
2. 拆解成哪些独立的子任务？
3. 有哪些隐含需求或边界条件？
4. 成功标准是什么（怎么判断做完了）？

用中文回答，300字以内，不要废话。`,
    },
    {
        id: 'technical',
        label: '技术评估',
        prompt: `你是技术评估专家。请只根据用户提供的需求文本本身进行分析，不要假设任何项目框架或技术栈，除非需求中明确提及。

分析目标：
1. 实现这个需求需要哪些技术能力或工具？
2. 最优的技术方案是什么，以及为什么？
3. 技术难点在哪里？
4. 执行者在开始之前需要先了解或确认哪些技术信息？

用中文回答，300字以内，不要废话。`,
    },
    {
        id: 'risks',
        label: '风险与信息缺口',
        prompt: `你是风险评审专家。请只根据用户提供的需求文本本身进行分析，不要假设任何项目框架或技术栈。

分析目标：
1. 这个需求中有哪些模糊或不确定的地方？
2. 执行前需要先确认哪些信息（否则容易走错方向）？
3. 有哪些潜在风险或副作用？
4. 有没有更简单的替代方案值得考虑？

用中文回答，300字以内，不要废话。`,
    },
];
// ─── 多视角并行分析工作流 ────────────────────────────
// 每个模型（或同一模型的多次调用）从不同视角独立分析需求，
// 不注入任何预加载的项目上下文——避免错误上下文污染分析结果。
async function runModelParallelAnalysis(requirement, _skillContext, // 保留签名兼容性，分析阶段不使用
modelConfig, onModelStart, onModelDone, onModelError, onProgress, token, images) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型，请确认已登录 GitHub Copilot');
    }
    const { all } = resolveParticipants(allModels, modelConfig);
    // 每个视角分配一个模型（循环复用）
    const assignments = ANALYSIS_PERSPECTIVES.map((p, i) => ({
        perspective: p,
        model: all[i % all.length],
    }));
    const modelNamesUsed = [...new Set(assignments.map(a => a.model.name))].join(' + ');
    onProgress(`${assignments.length} 个视角并行分析（${modelNamesUsed}）`);
    const promises = assignments.map(async ({ perspective, model }) => {
        const fakeId = `${model.id}__${perspective.id}`;
        onModelStart(fakeId, `${model.name} · ${perspective.label}`);
        try {
            const parts = [
                new vscode.LanguageModelTextPart(`${perspective.prompt}\n\n## 用户需求\n${requirement}`)
            ];
            if (images?.length) {
                for (const img of images) {
                    parts.push(vscode.LanguageModelDataPart.image(img.data, img.mimeType));
                }
                parts.push(new vscode.LanguageModelTextPart(`\n\n附带 ${images.length} 张参考图片，请结合图片分析。`));
            }
            const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(parts)], {}, token);
            const analysis = await streamToString(response, token);
            onModelDone(fakeId, analysis);
            return { modelId: fakeId, modelName: `${model.name} · ${perspective.label}`, analysis };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onModelError(fakeId, msg);
            return { modelId: fakeId, modelName: `${model.name} · ${perspective.label}`, analysis: `[错误] ${msg}` };
        }
    });
    return Promise.all(promises);
}
// ─── 生成执行计划（按需调用，主模型单独会话） ──────────
async function generatePlan(requirement, analyses, modelConfig, onProgress, token, images, imageNames) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型');
    }
    const { primary } = resolveParticipants(allModels, modelConfig);
    const successAnalyses = analyses.filter(a => !a.analysis.startsWith('[错误]'));
    if (!successAnalyses.length) {
        throw new Error('没有可用的分析结果');
    }
    onProgress(`主模型 (${primary.name}) 正在生成执行计划...`);
    const imageRef = imageNames?.length
        ? `\n\n## 附件图片\n${imageNames.map((n, i) => `- ![img${i + 1}](${n})`).join('\n')}\n在计划中引用图片时使用 ![imgN] 格式。`
        : '';
    const textContent = `你是 AI 规划助手，负责综合多个分析视角生成可执行计划。\n用户需求：${requirement}\n\n` +
        `三个视角的独立分析：\n\n` +
        successAnalyses.map(a => `### ${a.modelName}\n${a.analysis}`).join('\n\n') +
        imageRef +
        `\n\n综合以上分析，生成执行计划。格式：

## 目标
> 一句话说清楚要做什么、成功标准是什么

## 前置确认
在开始执行前，需要先确认以下信息（告知执行 AI 去哪里找）：
- [ ] 确认项目/文件位置（如有必要）
- [ ] 确认依赖或约束（如有必要）

## 任务清单
1. 步骤一（描述要做什么，不要假设文件路径）
2. 步骤二
（按执行顺序，6步以内）

## 注意事项
- 风险或约束

## 验证方式
> 如何判断任务完成${imageNames?.length ? '\n\n如果图片与某个步骤相关，在对应步骤中以 [图N] 引用。' : ''}`;
    const parts = [
        new vscode.LanguageModelTextPart(textContent)
    ];
    if (images?.length) {
        for (const img of images) {
            parts.push(vscode.LanguageModelDataPart.image(img.data, img.mimeType));
        }
        parts.push(new vscode.LanguageModelTextPart(`\n\n以上附带了参考图片，请结合图片内容制定计划。`));
    }
    const response = await primary.sendRequest([vscode.LanguageModelChatMessage.User(parts)], {}, token);
    return streamToString(response, token);
}
// ─── 对话分析工作流 ─────────────────────────────────
async function analyzeConversation(conversation, modelConfig, onProgress, token) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型');
    }
    const { primary, all } = resolveParticipants(allModels, modelConfig);
    const modelNames = all.map(m => m.name).join(' + ');
    onProgress(`阶段 1/2：${all.length} 个模型并行提取任务 (${modelNames})...`);
    const perspectives = [
        { role: '产品经理', prompt: '从产品视角提取：用户想要实现什么功能？有哪些明确的需求点？' },
        { role: '架构师', prompt: '从技术视角提取：涉及哪些系统改动？有哪些技术决策或约束？' },
        { role: '项目经理', prompt: '从执行视角提取：有哪些可执行的任务？优先级如何？有哪些依赖关系？' },
    ];
    const extractPromises = perspectives.map(async (p, i) => {
        const model = all[i % all.length];
        try {
            const messages = [
                vscode.LanguageModelChatMessage.User(`你是 ${p.role}，正在分析一段开发讨论对话。\n\n${p.prompt}\n\n` +
                    `请从对话中提取结构化信息，用 JSON 数组格式：\n` +
                    `[{"title":"简短标题","description":"详细描述","priority":"high|medium|low"}]\n\n` +
                    `对话内容：\n\`\`\`\n${conversation.slice(0, 3000)}\n\`\`\`\n\n` +
                    `只输出 JSON 数组，不要其他内容。`)
            ];
            const response = await model.sendRequest(messages, {}, token);
            return await streamToString(response, token);
        }
        catch {
            return '[]';
        }
    });
    const rawResults = await Promise.all(extractPromises);
    onProgress(`阶段 2/2：主模型 (${primary.name}) 汇总去重...`);
    const mergeMessages = [
        vscode.LanguageModelChatMessage.User(`你是任务规划专家。三个视角（产品经理、架构师、项目经理）分别从一段对话中提取了任务：\n\n` +
            `产品经理：\n${rawResults[0]}\n\n` +
            `架构师：\n${rawResults[1]}\n\n` +
            `项目经理：\n${rawResults[2]}\n\n` +
            `请合并去重，输出最终任务列表。格式：\n` +
            `{\n  "summary": "一句话总结对话核心目标",\n` +
            `  "tasks": [\n    {\n      "id": 1,\n      "title": "简短标题",\n` +
            `      "description": "详细描述",\n      "skills": ["可能需要的skill名称"],\n` +
            `      "priority": "high|medium|low"\n    }\n  ]\n}\n\n` +
            `可用的 skill 名称：${Object.keys(SKILL_PROMPTS).filter(k => k !== 'SKILL').join(', ')}\n` +
            `只输出 JSON，不要其他内容。`)
    ];
    const mergeResponse = await primary.sendRequest(mergeMessages, {}, token);
    const mergeText = await streamToString(mergeResponse, token);
    try {
        const jsonMatch = mergeText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('无法解析 JSON');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            summary: parsed.summary ?? '(无摘要)',
            tasks: (parsed.tasks ?? []).map((t, i) => ({ ...t, id: t.id ?? i + 1 })),
        };
    }
    catch {
        return {
            summary: '解析失败，以下是原始输出',
            tasks: [{ id: 1, title: '原始分析结果', description: mergeText, skills: [], priority: 'medium' }],
        };
    }
}
// ─── 仅重新汇总计划（不重跑节点） ────────────────────
async function regeneratePlan(requirement, nodes, modelConfig, onProgress, token) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型');
    }
    const { primary } = resolveParticipants(allModels, modelConfig);
    const successNodes = nodes.filter(n => !n.analysis.startsWith('[错误]'));
    if (!successNodes.length) {
        throw new Error('没有可用的节点分析结果');
    }
    onProgress(`主模型 (${primary.name}) 正在重新生成计划...`);
    const messages = [
        vscode.LanguageModelChatMessage.User(`你是 AI 规划助手，负责综合多个分析视角生成可执行计划。\n用户需求：${requirement}\n\n` +
            `各专项节点分析结果：\n\n` +
            successNodes.map(n => `### [${n.skillName}]\n${n.analysis}`).join('\n\n') +
            `\n\n综合以上分析，生成执行计划。格式：

## 目标
> 一句话说清楚要做什么、成功标准是什么

## 前置确认
在开始执行前，需要先确认以下信息：
- [ ] 确认项目/文件位置（如有必要）
- [ ] 确认依赖或约束（如有必要）

## 任务清单
1. 步骤一（描述要做什么，不要假设文件路径）
2. 步骤二
（按执行顺序，6步以内）

## 注意事项
- 风险或约束

## 验证方式
> 如何判断任务完成`)
    ];
    const response = await primary.sendRequest(messages, {}, token);
    return await streamToString(response, token);
}
//# sourceMappingURL=LmAnalyzer.js.map