# UI 系统规范

## 窗口基类
- 所有 UI 窗口继承 `UIWindow`
- 生命周期：`OnCreate → OnShow → OnHide → OnDestroy`
- 窗口注册在 `UIManager.Open<T>()` / `UIManager.Close<T>()`

## 层级管理
| UILayer | 用途 | sortingOrder 范围 |
|---|---|---|
| Background | 背景/场景UI | 0-99 |
| Normal | 普通窗口 | 100-199 |
| Popup | 弹窗/对话框 | 200-299 |
| Top | 顶层提示/Loading | 300-399 |

## 组件规范
- Button 绑定使用 `onClick.AddListener`，OnDestroy 移除
- Text 使用 TextMeshPro，禁止 Unity 内置 Text
- 列表使用对象池 + ScrollRect 虚拟滚动

## 预制体
- 路径：`Assets/Prefabs/UI/{WindowName}.prefab`
- Canvas 设置：Screen Space - Camera，Reference 1920×1080
