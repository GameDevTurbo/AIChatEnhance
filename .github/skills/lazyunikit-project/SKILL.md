# LazyUniKit 项目规范索引

## 核心约束
- 所有业务逻辑必须在对应的 asmdef 程序集内
- 禁止直接跨程序集引用，必须通过接口或事件通信
- 命名空间必须与文件夹路径一致
- 使用 UniTask 替代 Coroutine 做异步

## 关键架构
- **MVC分层**：Model（数据）→ Controller（逻辑）→ View（表现）
- **事件系统**：LazyEvent<T> 全局事件总线
- **UI框架**：UIWindow 基类 + UILayer 层级管理
- **战斗系统**：BattleDirector 调度器 + ScoreSystem 评分

## 目录规范
- `Assets/Scripts/Runtime/` — 运行时代码
- `Assets/Scripts/Editor/` — 编辑器工具
- `Assets/Prefabs/UI/` — UI 预制体
- `Assets/Resources/Config/` — 配置文件
