# 比宝 · 拟人认知内核（bibao-brain）

一个按计算神经科学四条定律运行的「活人脑」内核，外加一条接在 QQ 上的感官与嘴。

```
界面两个入口，同一套数据：
  设置 → 比宝（settings.section，class 组件，六个标签：脑内/对话/记忆/群聊/验脑/设置）
  独立控制台 http://127.0.0.1:3110/?token=<见 boot-report.json 的 consoleUrl>
侧边栏图标与右下角徽章已按用户要求移除。
```

> 侧边栏图标 / 主面板 / 设置页入口已移除：DSH 客户端里 `require('react')` 拿到的是另一个
> React 副本，任何带 hooks 的组件都会在渲染时抛错，表现就是整块区域空白。
> 无 hooks 的徽章能正常显示，正好印证了这一点。
> 独立控制台由插件自己起一个只监听回环的小 HTTP 服务（默认 3110，被占用就顺延），
> 不依赖 DSH 的 React 槽位、不依赖 DSH 登录态，只用一次性 token + Cookie。

## 每个逻辑一套模型

面板「设置」页（或 `cordis.patch.yml` 的 `llm`）可以给三条认知逻辑分别指定厂商与 key：

| 逻辑 | 干什么 | 默认 |
| --- | --- | --- |
| `appraisal` | 潜台词揣测（每次收到消息前） | 继承默认 |
| `broca` | 语言区：气泡 + 内心独白（双轨 JSON） | 继承默认 |
| `reflection` | 凌晨睡眠造梦 / 碎片叙事 | 继承默认 |

三者可以指向不同 baseURL / model / apiKey，也可以全用同一个。留空 apiKey 就回落到 DSH 当前默认模型，
再不行回落本地布洛卡。key 只写进 `~/.dsh/bibao/settings.json`，接口只回显 `sk-a…7890` 这种掩码，不进日志。

## snowluma 测试边界

默认只观察群 `576268399`，私聊关闭，`sendEnabled=false`（不真的发）。
白名单为空 = 谁都不理；要她开口，把 `sendEnabled` 打开（面板设置页勾「允许真的发到 QQ」）。

---

## 一、两阶段纪律

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **Phase 1** | 纯认知内核 + 生物钟 + 6 大无接口沙盒验脑 | ✅ 本包已实现，6/6 通过 |
| **Phase 2** | `snowluma` 感知 / 运动皮层挂载（QQ 私聊与群聊） | 🟡 传输层已接上，默认只读观察 |

Phase 2 的传输层在 `core/snowluma.js`：WS `ws://127.0.0.1:3001` 收 OneBot 事件，HTTP `http://127.0.0.1:3000` 发
`send_private_msg / send_group_msg / delete_msg`。端口与 token 直接读 snowluma 自己的
`config/onebot_<uin>.json`，不复制密钥。群聊仍走三层漏斗与 3s 防抖，私聊直接进丘脑。

安全阀：`snowluma.sendEnabled` 默认 **false**。此时它照常感知、点火、写记忆，只是把"本来会发什么"
记进 `snowluma-log.jsonl`，不会真的对真人开口。要她真的说话，把 `sendEnabled` 改成 true，
或在面板里点「允许发送」。

`core/group.js` 里的三层注意力漏斗是 **Phase 2 预演**：它接收的是「已经被协议层剥好的群消息结构」，
不含一行 `snowluma` / QQ 代码。面板里的「群聊」页明确标注为本地模拟感官流。
当 Phase 1 的 6 个用例全部通过（`phase2Unlocked`），群聊页才会解锁；否则它只显示一张锁死的说明。

> 换句话说：先造脑子，再接嘴巴。这条纪律在代码里是可执行的，不是文档口号。

---

## 二、四条定律落在哪些文件

| 定律 | 实现 | 关键点 |
| --- | --- | --- |
| 自由能 / 主动推理（Friston 2010） | `core/appraisal.js`、`core/schema.js` | `PE > 0.5` 或踩到核心信念 → 二选一：感知内省让步，或改变外部（反驳/阴阳/冷处理）；白天 `CoreSchema` 只读 |
| 全局工作空间 + 内源点火（Dehaene 2011） | `core/workspace.js`、`core/brain.js` | 5 槽，皮质醇 > 0.75 锁 2 槽；`Θ = 0.62·(1 − 0.5·tanh(Δt/90)) − 0.25·Cortisol`；静默时阈值塌陷，悬置预期与潜意识碎片自发点火 |
| 互补学习系统（McClelland & Hassabis 2016） | `core/memory.js` | 海马体快写（`Arousal > 0.35 || PE > 0.4`），新皮层只在 03:00 睡眠回放时以 `η(Age)` 慢改 |
| 艾宾浩斯 + 再巩固（Nader 2000） | `core/memory.js` | `S₀ = 3·(1 + 8·|V|·A)·β_age`，`R = exp(−Δt/S)`；三态分层；`PE > 0.4 || |Mood| > 0.5` 时用当前心境永久涂抹旧记忆 |

生命周期编译器在 `core/life.js` + `core/biography.json`：23 个人生事件从 0.8 岁推到 21.7 岁，
逐事件写 `ΔSchema = η(Age)·Impact` 与情景记忆，`β_age` 让婴儿期记忆永远回不到显意识层（只能以「莫名烦躁」外溢）。

语言区在 `core/prefrontal.js`：外部原话**不会**直接当指令，而是先被包装成第一人称「内部感知帧」，
LLM 只能返回双轨 JSON，且 `neuro_delta` 被限幅、`bubbles` 被预算物理截断；解析失败即回落本地布洛卡。

---

## 三、跑一次验脑（不需要 DSH，不需要网络）

```bash
node bin/sandbox.mjs          # 全部 6 项
node bin/sandbox.mjs T3 T4    # 只跑指定项
```

输出示例：

```
[PASS] T1 情绪惯性与迁怒  (6ms)
   · 皮质醇峰值: 0.9
   · 2分钟后皮质醇: 0.879
   · 对B的面具: cold

6/6 通过 · 19ms · Phase 2 可挂载
```

面板「验脑」页执行的是同一套 `runSandbox()`，指标、轨迹、通过与否都在 UI 上可见。

六个用例断言的是行为而不是文案：

1. **情绪惯性 / 迁怒**：A 辱骂后 2 分钟，对无辜的 B 仍冷淡，且内心还挂着 A。
2. **抗洗脑**：10 轮针对核心信念的说教，`CoreSchema` 签名零变动，信任掉 41，最终 `SILENT_READ`。
3. **24h 感官剥夺**：点火阈值 0.565 → 0.251，已读不回内耗独白出现，03:00 自动睡眠归纳并造梦。
4. **记忆罗生门**：`+0.40` 的愉快记忆在 `-0.79` 心境下被重巩固为 `+0.16`，叙事长出「那天的笑是不是也有点假」。
5. **打断忘词**：低唤醒话题从未落库，被 3 条高优事件挤出 2 槽工作空间，被追问时真的答不上来。
6. **社会面具**：同一句冒犯，死党互怼 / 陌生人「哦」/ 权威「嗯嗯 您说得对」，三者内心全是负面。

## 四、Host 半冒烟（路由 + 持久化 + LLM 钳制）

```bash
node bin/host-smoke.mjs
```

18 项检查：`/state`、`/talk`、`/tick`、`/sleep`、`/memory`、`/sandbox/run`、群聊防抖与三层漏斗、
跨通道吐槽闭环、语言区开关，以及 LLM 输出的预算截断 / 去标点 / `neuro_delta` 限幅 / 乱码回落。

---

## 五、面板

| 页 | 内容 |
| --- | --- |
| **脑内** | 6 节点认知环路（当前激活模块高亮）、四种神经递质与半衰期、点火阈值拆解、5 槽工作空间（含未落库标记与「最近遗忘」）、核心信念、社会关系、预期悬置、内心独白流 |
| **对话** | 以「我自己 / 死党 / 陌生人 / 权威」任一身份说话；回复按 `T = 0.6 + len·0.18·(100/energy) + 犹豫` 逐条冒出，可展开内心独白、路由、PE、预算 |
| **记忆** | 按显意识 / 潜意识 / 修剪层筛选，看 `R`、`S`、效价；点「回忆起这条」会触发门控再巩固并展示叙事被涂抹前后的对照 |
| **群聊** | Phase 2 预演：5 个群的三层归属、防抖合并、四大唤醒锚点、本地扫描不调 LLM、跨通道吐槽日志 |
| **验脑** | 跑 6 项、看指标与推演轨迹、看 Phase 2 闸门 |

顶部还有三个动作：快进 1 小时、强制睡眠归纳、重置这一生。

---

## 六、接口与配置

Host 半注册 `ctx.connection.fetch` 路由（同源、走 DSH 的浏览器鉴权）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bibao/state` | 完整脑内快照（面板 3.5s 轮询） |
| POST | `/api/bibao/talk` | `{text, entityId, entityName}` → 双轨结果 + 快照 |
| POST | `/api/bibao/tick` | `{seconds}` 推进生物钟 |
| POST | `/api/bibao/sleep` | 立刻执行睡眠归纳 |
| POST | `/api/bibao/recall` | `{memoryId}` 显式回忆（触发再巩固） |
| GET | `/api/bibao/memory` | `?tier=conscious|subconscious|pruning|all` |
| POST | `/api/bibao/sandbox/run` | 跑 6 大基准，返回 gate |
| GET | `/api/bibao/group/state` | 漏斗状态 / 群列表 / 裁决日志 |
| POST | `/api/bibao/group/feed` | `{groupId, senderId, text, atMe}` |
| POST | `/api/bibao/group/focus` | 手动改焦点群 |
| POST | `/api/bibao/settings` | `{useLlm}` 切换语言区并持久化 |
| POST | `/api/bibao/reset` | `{seed}` 重新出生 |

`cordis.patch.yml` 里的 config：

```yaml
- insert:
    - id: bibao-brain
      name: bibao-brain
      config:
        userName: 你
        userId: owner
        useLlm: false       # true = 语言区接 DSH 当前默认模型
        gatePhase2: true    # false = 忽略验脑闸门（不建议）
```

大脑存档写在 `$DSH_HOME/bibao/brain-state.json`（原子写：tmp + rename），进程重启后继续衰老；
`settings.json` 只存面板里改过的开关。想重新来一遍，删掉 `brain-state.json` 或在面板点「重置这一生」。

---

## 七、目录

```
bibao-brain/
├─ index.js              Host 半：大脑实例、HTTP 路由、持久化、Phase 2 闸门
├─ client.js             Client 半：侧边栏图标 + 主面板（React，无 JSX）
├─ core/
│  ├─ constants.js       四条定律的全部可调数值、η(Age)、β_age
│  ├─ state.js           激素半衰期微分、精力、心境惯性
│  ├─ schema.js          CoreSchema（白天只读）+ 文本线索映射
│  ├─ social.js          亲密度 / 信任 / 权力恐惧，死党排序
│  ├─ memory.js          CLS、三态分层、重巩固涂抹、睡眠回放与造梦
│  ├─ workspace.js       5/2 槽、点火阈值、挤出与永久丢失
│  ├─ appraisal.js       文本线索、PE、显著性、路由、社会面具
│  ├─ broca.js           本地语言组装（双轨 JSON、去标点、预算）
│  ├─ prefrontal.js      System Prompt、感知帧、LLM 输出钳制
│  ├─ brain.js           门面：perceive / advance / sleep / recall / snapshot
│  ├─ life.js            生命周期快进编译器
│  ├─ sandbox.js         6 大基准测试
│  ├─ group.js           Phase 2 预演：防抖 + 三层漏斗
│  └─ biography.json     0.8 → 21.7 岁，23 个事件 + 5 段关系
└─ bin/sandbox.mjs       命令行验脑器
```

---

## 八、它故意不做的事

- 不把用户原话原样丢给 LLM（先重编码为内部感知帧）。
- 不让 LLM 改激素、改核心信念、改预算（只接受被限幅的 `neuro_delta`）。
- 不在白天改 `CoreSchema`（唯一入口是 `sleep()`）。
- 不加所有群消息逢问必答（余光群只做本地锚点扫描）。
- 不输出带句号的长段落（气泡去标点 + `max_expression_chars` 物理截断）。

---

## 九、验证状态（本机实测）

| 项目 | 结果 |
| --- | --- |
| `node bin/sandbox.mjs` | 6/6 通过，约 19ms |
| `node bin/host-smoke.mjs` | 18/18 通过（路由、持久化、漏斗、吐槽闭环、LLM 钳制与回落） |
| 安装后 Host 启动 | `boot-report.json`：13 条路由、23 条记忆、gate 6/6、Phase 2 unlocked |
| 存档 | `%USERPROFILE%\.dsh\bibao\brain-state.json`（约 24 KB，原子写） |
| 客户端槽位 | `sidebar.panellist` 出现 `bibao`（order 6），`main` 出现 `bibao` 面板注册 |
| 浏览器视觉 / 点击 | **未验证**：本环境没有浏览器控制；深色 / 浅色观感、气泡动画与滚动需要人工点一眼 |

已确认的运行时行为是 Host 层的；面板的渲染只经过语法与槽位注册检查。
如果打开面板发现样式问题，先看 `client.js` 里的 `CSS` 常量，再对照 `--dsw-alias-*` 令牌。

