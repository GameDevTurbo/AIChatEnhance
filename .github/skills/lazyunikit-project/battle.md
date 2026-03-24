# 战斗系统规范

## 核心组件
- **BattleDirector**：战斗流程调度器，管理关卡开始/结束、波次切换
- **ScoreSystem**：评分系统，处理 combo、奖励、倍率计算
- **CarriageSystem**：车厢系统，管理车厢状态和切换逻辑

## 战斗流程
1. `BattleDirector.StartBattle()` → 初始化所有子系统
2. 每帧 `BattleDirector.Tick(deltaTime)` → 驱动各子系统
3. 关卡条件达成 → `BattleDirector.EndBattle(result)`

## 评分规则
- 基础分 = 击败敌人分数之和
- Combo 倍率：连击数 × 0.1 额外倍率（上限 3.0）
- 时间奖励：剩余时间 × 10 分
- 完美通关：无受伤额外 +500 分

## 事件通信
- `LazyEvent<BattleStartArgs>` — 战斗开始
- `LazyEvent<BattleEndArgs>` — 战斗结束
- `LazyEvent<ScoreChangedArgs>` — 分数变化
- `LazyEvent<ComboChangedArgs>` — 连击变化
