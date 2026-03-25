import * as vscode from 'vscode';
import * as path from 'path';
import type { SkillFile, PromptTemplate } from './types';
export type { SkillFile, PromptTemplate };

/** 关键词路由表 — 与 SKILL.md 10 项路由一致 */
const SKILL_KEYWORD_MAP: Record<string, string[]> = {
    'context':       ['目录', '结构', 'asmdef', '命名空间', '程序集', '架构', 'namespace', 'assembly'],
    'code':          ['命名', '规范', '异步', 'unitask', 'async', 'log', '日志', '编译', '格式', '编码', 'encoding'],
    'ui':            ['ui', 'window', '窗口', 'uiwindow', 'layer', '界面', 'button', 'text', 'popup'],
    'battle':        ['战斗', 'battle', 'system', '计分', 'score', 'combo', 'carriage', '车厢', 'director'],
    'events':        ['事件', 'event', 'lazyevent', 'emit', '订阅', 'on ', 'off '],
    'docs':          ['文档', 'html', 'doc', '同步', 'chat.html', 'todo.html'],
    'communication': ['沟通', '方案', '确认', '选择', '变更', '成本', 'cost', '交互'],
    'workflow':      ['任务', '工作流', '计划', 'plan', '拆分', '并行', 'todo', '执行', '验证'],
    'review':        ['审查', 'review', '重构', 'refactor', '审计'],
    'issues':        ['问题', 'issue', '故障', 'bug', '排查', '踩坑', '历史'],
    'SKILL':         [], // 索引文件，始终加载
};

// ─── 辅助 ──────────────────────────────────────────

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

async function readText(uri: vscode.Uri): Promise<string> {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf-8');
}

/** 获取 Skill 磁盘目录路径（扫描 .github/skills/ 下所有子目录） */
async function getSkillsDirs(): Promise<vscode.Uri[]> {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!rootPath) { return []; }
    const skillsRoot = vscode.Uri.joinPath(rootPath, '.github', 'skills');
    if (!await fileExists(skillsRoot)) { return []; }
    try {
        const entries = await vscode.workspace.fs.readDirectory(skillsRoot);
        return entries
            .filter(([, type]) => type === vscode.FileType.Directory)
            .map(([name]) => vscode.Uri.joinPath(skillsRoot, name));
    } catch { return []; }
}

/** 获取所有可用 Skill 的名称列表 */
export function getAllSkillNames(): string[] {
    return Object.keys(SKILL_KEYWORD_MAP);
}

/** 获取每个 Skill 的简要描述（用于浏览面板） */
export async function getSkillDescriptions(): Promise<Array<{ name: string; keywords: string[]; hasFile: boolean }>> {
    const dirs = await getSkillsDirs();
    const results = await Promise.all(
        Object.entries(SKILL_KEYWORD_MAP).map(async ([name, keywords]) => ({
            name,
            keywords,
            hasFile: (await Promise.all(
                dirs.map(dir => fileExists(vscode.Uri.joinPath(dir, `${name}.md`)))
            )).some(Boolean),
        }))
    );
    return results;
}

/** 根据需求文本匹配相关 Skill 并加载内容 */
export async function loadMatchingSkills(requirement: string): Promise<SkillFile[]> {
    const dirs = await getSkillsDirs();
    const req = requirement.toLowerCase();
    const matched: SkillFile[] = [];

    for (const [skillName, keywords] of Object.entries(SKILL_KEYWORD_MAP)) {
        const isAlwaysLoad = skillName === 'SKILL';
        const isKeywordMatch = keywords.some(kw => req.includes(kw));
        if (!isAlwaysLoad && !isKeywordMatch) { continue; }

        for (const dir of dirs) {
            const uri = vscode.Uri.joinPath(dir, `${skillName}.md`);
            if (await fileExists(uri)) {
                matched.push({ name: skillName, content: await readText(uri) });
                break;
            }
        }
    }
    return matched;
}

/** 扫描工作区中所有 .prompt.md 文件 */
export async function scanPromptTemplates(): Promise<PromptTemplate[]> {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!rootPath) { return []; }

    const templates: PromptTemplate[] = [];
    const searchDirs = [
        vscode.Uri.joinPath(rootPath, '.github', 'prompts'),
        vscode.Uri.joinPath(rootPath, '.github'),
    ];

    // 也扫描用户级 prompts 目录
    const userPromptsDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'Code', 'User', 'prompts')
        : '';
    if (userPromptsDir) { searchDirs.push(vscode.Uri.file(userPromptsDir)); }

    for (const dir of searchDirs) {
        if (!await fileExists(dir)) { continue; }
        await scanDirForPrompts(dir, templates);
    }
    return templates;
}

async function scanDirForPrompts(dir: vscode.Uri, results: PromptTemplate[]): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(dir);
    } catch { return; }

    for (const [name, type] of entries) {
        const fullUri = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
            await scanDirForPrompts(fullUri, results);
        } else if (name.endsWith('.prompt.md')) {
            try {
                const content = await readText(fullUri);
                const desc = extractFrontmatterField(content, 'description') || '(no description)';
                results.push({
                    name: name.replace(/\.prompt\.md$/, ''),
                    description: desc,
                    filePath: fullUri.fsPath,
                    content,
                });
            } catch { /* skip unreadable */ }
        }
    }
}

function extractFrontmatterField(content: string, field: string): string {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) { return ''; }
    const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
    const m = fmMatch[1].match(re);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

/** 从工作区读取项目级指令文件，作为动态上下文 */
export async function loadWorkspaceContext(): Promise<string> {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!rootPath) { return ''; }

    const candidates = [
        vscode.Uri.joinPath(rootPath, '.github', 'copilot-instructions.md'),
        vscode.Uri.joinPath(rootPath, 'CLAUDE.md'),
        vscode.Uri.joinPath(rootPath, 'AGENTS.md'),
    ];
    const parts: string[] = [];
    for (const uri of candidates) {
        if (await fileExists(uri)) {
            try {
                const content = (await readText(uri)).slice(0, 1500);
                parts.push(`[${path.basename(uri.fsPath)}]\n${content}`);
            } catch { /* skip */ }
        }
    }
    return parts.join('\n\n');
}
