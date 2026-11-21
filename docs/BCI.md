# 多脑机接口适配层（BciHub）

比宝的"感官"和"手"不应该是写死在 QQ 适配器里的。`core/bci-hub.js` 提供一个很小的统一层：

```
设备/服务 ──适配器──▶ BciHub ──sense()──▶ 感知帧 ──▶ 丘脑 / 工作空间 / 记忆
                     │
                     └──act()──▶ 策略 / 确认 / 限频 / 审计 ──▶ 真实动作
```

## 适配器契约

```js
hub.register({
  id: 'screen',
  label: '屏幕视觉',
  kind: 'vision',
  capabilities: ['sense.vision'],
  readOnly: true,
  async sense(payload) {
    return { gist: '一个聊天窗口', text: '...' }
  },
})
```

动作适配器：

```js
hub.register({
  id: 'hands',
  label: '键鼠之手',
  capabilities: ['act.pointer', 'act.keyboard'],
  readOnly: false,
  async act(action) {
    // action.type = 'pointer.click' / 'keyboard.type'
    return { ok: true }
  },
})
```

## 能力表

| 能力 | 含义 |
| --- | --- |
| `sense.vision` | 画面 / OCR / 视觉描述 |
| `sense.audio` | 麦克风 / 环境声 |
| `sense.state` | 游戏或应用状态（只读） |
| `sense.touch` | 戳一戳、震动、触觉 |
| `sense.biometric` | EEG / 眼动 / 心率等只读生理信号 |
| `sense.knowledge` | 从本地知识库检索"她以前学过"的内容 |
| `act.pointer` | 鼠标移动、点击、拖拽 |
| `act.keyboard` | 键盘输入、快捷键 |
| `act.audio` | 语音输出 |
| `act.device` | 其他受控设备 |

## 安全闸门

默认策略：

```js
{ actuation: false, requireConfirmation: true, maxActionsPerMin: 12 }
```

一次动作要同时通过：

1. 适配器存在且不是 `readOnly`；
2. `policy.actuation === true`；
3. `confirmed === true`（默认要求）；
4. 动作类型对应的能力已声明；
5. 每分钟次数未超限。

所有注册、感知、动作（成功或失败）都会进 `audit`。`snapshot()` 会给出适配器、策略、最近审计与每分钟动作数。

## 当前已接

| 适配器 | 能力 | 状态 |
| --- | --- | --- |
| `tft` | `sense.state` | 只读，读云顶状态；需要外部推送 `/bci/game` |
| `screen` | `sense.vision` | 只读，复用视觉模型；可接收外部图片，或明确授权后截屏 |
| `system` | `sense.state` | 只读，自动采集 CPU / 内存 / 电源 / 网络 / 前台窗口；只在异常时进入意识 |
| `interoception` | `sense.biometric` | 只读，由精力、皮质醇、心境和睡眠债生成内部体感；不是真实传感器 |
| `eeg` | `sense.biometric` | 只读占位，真实 EEG / 心率 / 眼动设备尚未接入 |
| `knowledge` | `sense.knowledge` | 只读，检索导入的 .md/.txt/.json；可在「感官」页开关 |
| `hands` | `act.pointer` / `act.keyboard` | 工厂已提供，默认不注册、不打开 |

## 自动采集与开关

`sense()` 只负责读取；读到的内容要通过 `brain.perceiveSense()` 才会进入丘脑、工作记忆和情绪。自动采集遵守两条独立闸门：

1. **通道开关**：在「感官」页把对应通道设为「接入」。关闭后，自动采样不会写入大脑；手动投喂和显式 API 读取仍可用。
2. **屏幕权限**：`autoSense.screenCaptureEnabled` 默认 `false`。关闭时屏幕适配器不会截屏；打开后才会按间隔采集，且截图只在内存中交给视觉模型，不落盘。

默认节奏：

| 适配器 | 前置条件 | 间隔 | 写入条件 |
| --- | --- | --- | --- |
| `system` | `system` 通道接入 | 60 秒检查；同一告警 30 分钟内不重复 | 仅低电、内存不足、CPU 过高、断网或连续开机超过 72 小时 |
| `interoception` | `interoception` 通道接入 | 5 分钟 | 仅精力低、皮质醇高、心境低或睡眠债高 |
| `screen` | `vision` 通道接入 + 屏幕权限 + 视觉模型启用 | 默认 10 分钟，受每小时视觉上限约束 | 每次截图描述成功 |

同一句体感在 30 分钟内不会重复写入。所有适配器读取都有超时：默认 15 秒，屏幕 45 秒。动作层仍为 `actuation=false`，没有 `/bci/act` 路由，Agent 不能执行键鼠动作。

## 接一个新设备

1. 在 `index.js` 里 `bci.register(...)`，或在插件外部通过自己的适配器包注册；
2. 只读设备只实现 `sense()`，不要为了"方便"把动作也塞进去；
3. 动作设备先在测试里用 `policy.actuation=false` 跑一遍，确认被拦住；
4. 真正打开动作时，用最小权限、逐次确认、限频和审计；
5. 任何动作失败都要能被回滚或至少留下可复盘记录。

## 和 QQ 的关系

QQ 是"嘴和耳朵"，不是脑机接口。`BciHub` 里的视觉/听觉/触觉/生理信号最终会通过 `brain.perceiveSense()` 进入同一颗大脑；动作则应该先形成意图，再由适配器执行。不要把 QQ 的发送逻辑塞进 BCI 适配器，也不要把 BCI 的采样率绑在聊天轮次上。
