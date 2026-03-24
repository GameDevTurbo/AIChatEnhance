import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface SkillFile {
    name: string;
    content: string;
}

export interface PromptTemplate {
    name: string;
    description: string;
    filePath: string;
    content: string;
}

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

/** 内置 fallback 知识 */
const BUILTIN_SKILLS: Record<string, string> = {
    'SKILL':         '# 项目规范索引\n- MVC 分层架构\n- LazyEvent 事件通信\n- UniTask 替代 Coroutine\n- 命名空间与目录一致',
    'context':       '# 程序集与依赖\n- Core / Game / UI / Editor 四个 asmdef\n- 跨程序集通过事件解耦\n- 命名空间 = LazyUniKit.{Assembly}.{SubFolder}',
    'code':          '# 代码规范\n- PascalCase 类名, _camelCase 私有字段\n- UniTask 异步, 方法后缀 Async\n- LazyLog 替代 Debug.Log\n- [SerializeField] private, 禁止 public 字段\n- 禁止 PowerShell 写中文到 .cs 文件',
    'ui':            '# UI 系统\n- UIWindow 基类, UILayer 层级管理\n- Background/Normal/Popup/Top 四层\n- TextMeshPro, 对象池虚拟滚动',
    'battle':        '# 战斗系统\n- BattleDirector 调度, ScoreSystem 评分\n- Combo 倍率上限 3.0, 时间奖励\n- 事件: BattleStart/End, ScoreChanged, ComboChanged',
    'events':        '# 事件系统\n- LazyEvent<T>: On/Once/Off/Emit\n- Args 用 readonly struct\n- 订阅必须在 OnDestroy 取消\n- Game↔UI 通过事件解耦',
    'docs':          '# 文档维护\n- Docs/*.html 格式\n- 新功能必须同步更新文档',
    'communication': '# 沟通规则\n- 方案选择制(列2-3方案)\n- 发现上报制\n- 变更确认制(架构级改动需确认)',
    'workflow':      '# 工作流\n- Plan-First: 分析→规划→路由→执行→验证→文档→回顾\n- dotnet build 强制验证\n- SubAgent 并行调研',
    'review':        '# 框架审查\n- 4阶段: 基础设施→核心系统→游戏机制→工具链\n- 审查清单: 命名/依赖/async/事件/日志',
    'issues':        '# 历史问题\n- 已记录 I001-I012\n- 常见: 编码乱码/asmdef引用/事件泄漏',
};

/** 获取 Skill 磁盘目录路径 */
function getSkillsDir(): string {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return rootPath ? path.join(rootPath, '.github', 'skills', 'lazyunikit-project') : '';
}

/** 获取所有可用 Skill 的名称列表 */
export function getAllSkillNames(): string[] {
    return Object.keys(SKILL_KEYWORD_MAP);
}

/** 获取每个 Skill 的简要描述（用于浏览面板） */
export function getSkillDescriptions(): Array<{ name: string; keywords: string[]; hasFile: boolean }> {
    const skillsDir = getSkillsDir();
    const hasDir = skillsDir !== '' && fs.existsSync(skillsDir);
    return Object.entries(SKILL_KEYWORD_MAP).map(([name, keywords]) => ({
        name,
        keywords,
        hasFile: hasDir && fs.existsSync(path.join(skillsDir, `${name}.md`)),
    }));
}

/** 根据需求文本匹配相关 Skill 并加载内容 */
export async function loadMatchingSkills(requirement: string): Promise<SkillFile[]> {
    const skillsDir = getSkillsDir();
    const hasExternal = skillsDir !== '' && fs.existsSync(skillsDir);
    const req = requirement.toLowerCase();
    const matched: SkillFile[] = [];

    for (const [skillName, keywords] of Object.entries(SKILL_KEYWORD_MAP)) {
        const isAlwaysLoad = skillName === 'SKILL';
        const isKeywordMatch = keywords.some(kw => req.includes(kw));
        if (!isAlwaysLoad && !isKeywordMatch) { continue; }

        if (hasExternal) {
            const fp = path.join(skillsDir, `${skillName}.md`);
            if (fs.existsSync(fp)) {
                matched.push({ name: skillName, content: fs.readFileSync(fp, 'utf-8') });
                continue;
            }
        }
        if (BUILTIN_SKILLS[skillName]) {
            matched.push({ name: skillName, content: BUILTIN_SKILLS[skillName] });
        }
    }
    return matched;
}

/** 扫描工作区中所有 .prompt.md 文件 */
export async function scanPromptTemplates(): Promise<PromptTemplate[]> {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!rootPath) { return []; }

    const templates: PromptTemplate[] = [];
    const searchDirs = [
        path.join(rootPath, '.github', 'prompts'),
        path.join(rootPath, '.github'),
    ];

    // 也扫描用户级 prompts 目录
    const userPromptsDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'Code', 'User', 'prompts')
        : '';
    if (userPromptsDir) { searchDirs.push(userPromptsDir); }

    for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) { continue; }
        await scanDirForPrompts(dir, templates);
    }
    return templates;
}

async function scanDirForPrompts(dir: string, results: PromptTemplate[]): Promise<void> {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await scanDirForPrompts(fullPath, results);
        } else if (entry.name.endsWith('.prompt.md')) {
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const desc = extractFrontmatterField(content, 'description') || '(no description)';
                results.push({
                    name: entry.name.replace(/\.prompt\.md$/, ''),
                    description: desc,
                    filePath: fullPath,
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
