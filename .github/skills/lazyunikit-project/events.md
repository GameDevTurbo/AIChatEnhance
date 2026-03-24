# 事件系统规范

## LazyEvent 核心 API
```csharp
// 定义事件
public static readonly LazyEvent<DamageArgs> OnDamage = new();

// 订阅
OnDamage.On(handler);        // 持久订阅
OnDamage.Once(handler);      // 一次性订阅

// 发送
OnDamage.Emit(new DamageArgs { ... });

// 取消订阅
OnDamage.Off(handler);
```

## 使用规范
- 事件定义集中在 `Events/GameEvents.cs`
- Args 结构体使用 `readonly struct`，避免 GC
- 订阅必须在 `OnDestroy` 或对应生命周期中取消
- 禁止在事件回调中直接修改事件列表（防止迭代异常）

## 跨程序集通信
- Game ↔ UI 通过事件解耦
- 例：战斗系统 Emit `ScoreChangedArgs` → UI 监听并更新分数显示
