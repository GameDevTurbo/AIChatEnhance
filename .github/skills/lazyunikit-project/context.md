# 项目上下文 — 程序集与依赖

## 程序集结构 (asmdef)
| 程序集 | 路径 | 职责 |
|---|---|---|
| LazyUniKit.Core | Scripts/Runtime/Core | 底层工具、事件系统 |
| LazyUniKit.Game | Scripts/Runtime/Game | 游戏逻辑、战斗、关卡 |
| LazyUniKit.UI | Scripts/Runtime/UI | UI 框架、窗口管理 |
| LazyUniKit.Editor | Scripts/Editor | 编辑器扩展 |

## 依赖规则
- Core 不依赖任何业务程序集
- Game 和 UI 可依赖 Core
- Game 和 UI 之间禁止直接依赖，通过 LazyEvent 通信
- Editor 可依赖所有运行时程序集

## 命名空间
- 命名空间 = `LazyUniKit.{程序集名}.{子文件夹}`
- 例：`LazyUniKit.Game.Battle`、`LazyUniKit.UI.Windows`
