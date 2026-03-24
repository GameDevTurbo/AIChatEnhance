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
exports.analyzeConversation = analyzeConversation;
const vscode = __importStar(require("vscode"));
// ─── Skill 专属分析提示 ─────────────────────────────
const SKILL_PROMPTS = {
    'context': '从项目架构视角分析：识别涉及的程序集（asmdef）、关键文件路径、命名空间。指出跨程序集依赖风险。200字以内。',
    'code': '从代码规范视角分析：命名规范、UniTask异步模式、日志规范、文件编码安全的具体要求。200字以内。',
    'ui': '从UI系统视角分析：涉及的UIWindow、UILayer层级、按钮/文本组件变化。200字以内。',
    'battle': '从战斗系统视角分析：涉及的BattleDirector、ScoreSystem、Combo等核心组件变化。200字以内。',
    'events': '从事件系统视角分析：需新增/修改的LazyEvent事件定义和订阅者管理。200字以内。',
    'docs': '从文档维护视角分析：需同步更新的HTML文档和todo条目。150字以内。',
    'communication': '从沟通规则视角分析：此需求中有哪些需要确认的设计决策？是否有架构级变更需要先确认？100字以内。',
    'workflow': '从工作流视角分析：建议的执行顺序、可并行的步骤、必须的验证检查点。150字以内。',
    'review': '从审查视角分析：此改动是否涉及已审查过的模块？已知的改进建议是否关联？100字以内。',
    'issues': '从历史问题视角分析：此需求是否可能触发已知问题（I001-I012）？需要注意什么？100字以内。',
    'SKILL': '从整体规范视角分析：最重要的约束和最佳实践提示。150字以内。',
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
async function getAvailableModels() {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.map(m => ({ id: m.id, name: m.name, family: m.family ?? '' }));
}
function pickModels(allModels, modelIds) {
    let chosen = modelIds.length > 0
        ? modelIds.map(id => allModels.find(m => m.id === id)).filter((m) => !!m)
        : [];
    if (!chosen.length) {
        chosen = [allModels.find(m => /mini|flash|haiku|lite/i.test(m.family ?? '')) ?? allModels[0]];
    }
    return chosen;
}
// ─── 需求分析工作流（原有 + 增强） ─────────────────────
async function runWorkflow(requirement, skills, modelIds, onNodeStart, onNodeDone, onNodeError, onProgress, token) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型，请确认已登录 GitHub Copilot');
    }
    const chosen = pickModels(allModels, modelIds);
    onProgress(`模型: ${chosen.map(m => m.name).join(' · ')}，并行处理 ${skills.length} 个节点...`);
    // 并行分析每个 Skill 节点
    const nodePromises = skills.map(async (skill, i) => {
        onNodeStart(skill.name);
        const model = chosen[i % chosen.length];
        const prompt = SKILL_PROMPTS[skill.name] ?? '分析这个需求的关键实现要点。200字以内。';
        const systemCtx = `你是 PackJam Unity 项目的 AI 规划助手。以下是 [${skill.name}] 专项知识：\n\n${skill.content.slice(0, 600)}\n\n`;
        try {
            const messages = [
                vscode.LanguageModelChatMessage.User(`${systemCtx}用户需求：${requirement}\n\n${prompt}`)
            ];
            const response = await model.sendRequest(messages, {}, token);
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
    const successNodes = nodes.filter(n => !n.analysis.startsWith('[错误]'));
    if (!successNodes.length) {
        throw new Error('所有节点均分析失败，请检查网络或 Copilot 状态');
    }
    onProgress('所有节点完成，正在汇总执行计划...');
    const summaryMessages = [
        vscode.LanguageModelChatMessage.User(`你是 PackJam Unity 项目的 AI 规划助手。\n用户需求：${requirement}\n\n` +
            `各专项节点分析结果：\n\n` +
            successNodes.map(n => `**[${n.skillName}]**\n${n.analysis}`).join('\n\n') +
            `\n\n综合以上内容，生成简洁执行计划，格式如下：

## 执行上下文
> 涉及的程序集、关键文件路径（bullet list）

## 任务清单
1. 步骤一
2. 步骤二
（按执行顺序，6步以内）

## 注意事项
- 约束1
- 约束2

## 验证命令
\`\`\`
dotnet build PackJam.slnx --no-incremental 2>&1 | Select-String "error CS"
\`\`\``)
    ];
    const summaryResponse = await chosen[0].sendRequest(summaryMessages, {}, token);
    const merged = await streamToString(summaryResponse, token);
    return { nodes, merged };
}
// ─── 对话分析工作流（新增 P2） ─────────────────────────
async function analyzeConversation(conversation, modelIds, onProgress, token) {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!allModels.length) {
        throw new Error('未找到可用的 Copilot 语言模型');
    }
    const chosen = pickModels(allModels, modelIds);
    // 阶段 1：用多个模型视角并行提取任务
    onProgress('阶段 1/2：多视角并行提取任务...');
    const perspectives = [
        { role: '产品经理', prompt: '从产品视角提取：用户想要实现什么功能？有哪些明确的需求点？' },
        { role: '架构师', prompt: '从技术视角提取：涉及哪些系统改动？有哪些技术决策或约束？' },
        { role: '项目经理', prompt: '从执行视角提取：有哪些可执行的任务？优先级如何？有哪些依赖关系？' },
    ];
    const extractPromises = perspectives.map(async (p, i) => {
        const model = chosen[i % chosen.length];
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
    // 阶段 2：汇总去重
    onProgress('阶段 2/2：汇总去重，生成最终任务列表...');
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
            `可用的 skill 名称：context, code, ui, battle, events, docs, communication, workflow, review, issues\n` +
            `只输出 JSON，不要其他内容。`)
    ];
    const mergeResponse = await chosen[0].sendRequest(mergeMessages, {}, token);
    const mergeText = await streamToString(mergeResponse, token);
    try {
        // 提取 JSON（可能包含 ```json ... ``` 包裹）
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
//# sourceMappingURL=_old_LmAnalyzer.js.map