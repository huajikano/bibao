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
| `tft` | `sense.state` | 只读，读云顶状态 |
| `screen` | `sense.vision` | 只读，走现有视觉模型 |
| `eeg` | `sense.biometric` | 只读占位，当前导出内在状态近似值，等真实设备 |
| `hands` | `act.pointer` / `act.keyboard` | 工厂已提供，默认不注册、不打开 |

## 接一个新设备

1. 在 `index.js` 里 `bci.register(...)`，或在插件外部通过自己的适配器包注册；
2. 只读设备只实现 `sense()`，不要为了"方便"把动作也塞进去；
3. 动作设备先在测试里用 `policy.actuation=false` 跑一遍，确认被拦住；
4. 真正打开动作时，用最小权限、逐次确认、限频和审计；
5. 任何动作失败都要能被回滚或至少留下可复盘记录。

## 和 QQ 的关系

QQ 是"嘴和耳朵"，不是脑机接口。`BciHub` 里的视觉/听觉/触觉/生理信号最终会通过 `brain.perceiveSense()` 进入同一颗大脑；动作则应该先形成意图，再由适配器执行。不要把 QQ 的发送逻辑塞进 BCI 适配器，也不要把 BCI 的采样率绑在聊天轮次上。
