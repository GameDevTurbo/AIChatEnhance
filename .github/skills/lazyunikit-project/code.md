# 代码规范

## 命名规范
- 类名/方法名：PascalCase
- 私有字段：`_camelCase`（下划线前缀）
- 常量：`UPPER_SNAKE_CASE`
- 接口：`I` 前缀（如 `IScoreCalculator`）

## 异步模式
- 统一使用 `UniTask` 替代 `Coroutine`
- 异步方法后缀 `Async`：`LoadDataAsync()`
- 取消令牌传递：`CancellationToken ct = default`

## 日志规范
- 使用 `LazyLog.Info/Warn/Error` 替代 `Debug.Log`
- 格式：`LazyLog.Info("[模块名] 消息", context)`
- Release 构建自动剥离 Info 级别日志

## 序列化
- 可序列化字段使用 `[SerializeField] private`
- 禁止 `public` 字段暴露到 Inspector
- ScriptableObject 用于配置数据
