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

## 0.7 成长层：她自己的今天、自己的说法、自己的忘性

0.6 之前的脑已经会"反应"，但反应得再准，也像一个随时待命的客服。0.7 加了三层很便宜、但决定像不像人的东西：

| 层 | 文件 | 它解决什么 |
| --- | --- | --- |
| **人格一致** | `core/voice.js` | 系统提示词从当前 `biography.json` 长出来。换成 16 岁高中生，她就不会再说"我毕业了"。旧版写死的 22 岁/毒舌人设已移除。 |
| **自我复盘** | `core/self.js` | 每轮之后悄悄记一笔"对方接住了 / 变冷了 / 没回"；睡眠或每 6 小时压成 1-2 条经验，微调暖意、玩心、直率、话量、示弱、主动六个维度。单次最多 ±0.06，经验最多 10 条、会衰减。模型只能建议，不能改核心信念。 |
| **她的一天** | `core/life-stream.js` | 按年龄、关系、爱好生成早读/食堂/放学/写作业/游戏/被妈妈催睡等生活事件。事件进提示词，睡前压成日记和 1-2 条情景记忆；她不主动拿这些刷屏，聊到才提。 |
| **记不清** | `core/memory.js` | 新增 `fidelity/blur`：旧事不再只有"记得/忘了"两态，而是清晰度连续下降；清晰度低时只交梗概并明确说"记不清"，宁可少说也不编细节。 |

这三层默认都开着，可以在面板「设置」里分别关掉：

```yaml
growth:
  selfReview: true   # 把对话反馈变成经验
  life: true         # 让她有自己的今天
```

### 自我复盘怎么防跑偏

- 只消费"上次复盘之后"的新证据，同样的冷脸不会被反复计入；
- 每次风格调整有硬上限，六个维度永远在 `[0,1]`；
- 经验按字符重合度去重，最多 10 条，60 天后淡出；
- 复盘提示词明确要求"不要把毒舌磨平、不要改成客服、不要编造记忆"；
- 核心信念（`CoreSchema`）仍然只在凌晨睡眠回放里、按 `η(Age)` 慢改，复盘碰不到它。

### 多脑机接口

`core/bci-hub.js` 把"感知"和"动作"拆成统一适配器：能力声明、只读/写入策略、确认、限频、审计。当前注册了 `tft`（游戏状态）、`screen`（视觉）、`eeg`（只读生理占位）三个只读通道；`hands` 键鼠工厂已提供，但默认不注册、不打开 `actuation`。详见 [docs/BCI.md](../docs/BCI.md)。

### 一次验成长

```bash
node bin/growth-smoke.mjs     # 47 项：人格 / 复盘 / 生活流 / 模糊记忆 / 线程 / 主动分享 / 越界降好感
node bin/bci-hub-smoke.mjs    # 12 项：四种适配器 / 默认拦截 / 确认 / 限频 / 审计
node bin/sticker-import-smoke.mjs # 7 项：表情包导入 + 描述编辑 + 分类（假视觉端点）
node bin/ws-reverse-smoke.mjs # 6 项：反向 WS 握手 / 事件 / 动作 / 群列表
node bin/eval-qq.mjs          # 20 个 QQ 场景的盲评样本
```

## 0.8：没聊完的事、可以主动但默认不打扰、QQ 四个老毛病

### 对话线程

`core/threads.js` 只维护每个对象最多 3 条"还没聊完的事"：

- 对方问过但还没被回答的问题；
- 答应过、约好、提到"下次/明天/回头"的事；
- 最近还热着的话题。

线程 2 天后自动放下，不进入长期记忆。提示词里会出现"你们还没聊完的：…"，但明确要求"他绕回来再提，不要主动查岗"。

### 主动分享（默认关闭）

`core/outreach.js` 只在同时满足这些条件时给一句私聊：

- 对方是真实好友，亲密度 ≥ 55；
- 沉默 ≥ 6 小时；
- 今天生活流里有 6 小时内发生的事；
- 精力够、没在气头上、心境没跌到谷底；
- 每个对象每天最多一条，全局冷却 8 小时。

默认 `outreach.enabled=false`；打开后仍然要求 `sendEnabled=true` 且 `allowPrivate=true`，不会在群里刷存在感。

### QQ 修复

| 问题 | 原因 | 修复 |
| --- | --- | --- |
| 表情包导入失败 | 主面板调用了不存在的 `shrinkImage` | 补上 canvas 缩放 + PNG/JPEG 选择；失败时显示具体错误 |
| 戳一戳没反应 | 只写触觉感知，从不生成回复 | `reactToPoke()` 二选一：回戳一下，或发一张情绪/上下文匹配的表情包；**不生成文字**；20 秒/对象冷却 |
| WS 配置保存后重启丢失 | 启动时只恢复 `enabled/sendEnabled/allowGroups` | 逐字段恢复 HTTP/WS 地址、token、selfId、poke 开关等 |
| WS 客户端连不上 | 3000/3001 没开，或 token 只放 header；selfId 在手填配置时可能为空 | **反向 WS 服务端**：监听 `ws://127.0.0.1:8080/ws`，snowluma 的 `wsClients` 主动连进来；token 同时支持 query/header；事件与动作走同一条连接；连接状态写入日志与 `/state.snow.wsStatus` |
| 表情包描述不能改 | 自动识别结果直接落库，没有编辑入口 | 收藏夹每张图都有「改描述」，保存到 `StickerBook.update()`；主面板和独立控制台都可用 |
| 戳一戳只对白名单群有反应 | 复用了群消息白名单 | `pokeAnyGroup` 默认开：戳一戳是直接对着她，默认不按群白名单拦；可在设置关掉 |
| 需要戳回去 | 旧版 `pokeBack` 默认关、只有 15% 概率 | 默认开；被戳后**只戳一下**，同一对象 20 秒内不重复，避免无限互戳 |
| 好友面板门槛 | 只有 `friend` 标记（私聊一次就有） | 改为**互动 ≥ 10 条自动进入**，不需要手动加好友；`friendSource='self'` 表示她自己记的 |
| 好友面板看不到账号 | 只显示昵称 | 昵称旁边加小号 QQ（`bb-friendId`，10.5px），并按互动次数排序 |

---

## snowluma 测试边界

默认不接任何群（`allowGroups: []`）、私聊关闭、`sendEnabled=false`（不真的发）。装好后在面板里填自己的群号。
白名单为空 = 谁都不理；要她开口，把 `sendEnabled` 打开（面板设置页勾「允许真的发到 QQ」）。

---

## 一、两阶段纪律

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **Phase 1** | 纯认知内核 + 生物钟 + 6 大无接口沙盒验脑 | ✅ 本包已实现，6/6 通过 |
| **Phase 2** | `snowluma` 感知 / 运动皮层挂载（QQ 私聊与群聊） | 🟡 传输层已接上，默认只读观察 |

Phase 2 的传输层有两条路：

- `core/snowluma.js`：插件连 snowluma 的 WS `3001` 收事件，HTTP `3000` 发动作；
- `core/onebot-ws-server.js`：**反向 WS**，插件监听 `ws://127.0.0.1:8080/ws`，snowluma 的
  `wsClients` 主动连进来，事件和动作都走同一条连接。`wsClients` 开着时自动选这条，
  端口/token 直接从 `config/onebot_<uin>.json` 读，不复制密钥。

两条路都走三层漏斗与 3s 防抖，私聊直接进丘脑。

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
node bin/growth-smoke.mjs     # 成长层 47 项
node bin/bci-hub-smoke.mjs    # 多脑机接口 12 项
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
| GET | `/api/bibao/usage` | Token 用量：总量、今天、按逻辑、按模型、最近 14 天、最近调用 |
| POST | `/api/bibao/usage/reset` | 清空 Token 统计 |
| POST | `/api/bibao/settings` | `{useLlm, tuning, growth}` 切换语言区 / 行为滑杆 / 成长层并持久化 |
| POST | `/api/bibao/self/review` | 立刻做一次自我复盘（`force:false` 时只在有新证据时跑） |
| POST | `/api/bibao/outreach/preview` | 看"现在该不该主动找谁说一句"，不发送 |
| GET | `/api/bibao/bci` | 已注册的脑机接口、能力、策略与最近审计 |
| POST | `/api/bibao/bci/sense` | `{adapter, payload}` 只读拉一次外部感知 |
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
        snowluma:
          enabled: false    # 默认不连、不发
          configDir: ''     # 留空自动找；也可填安装根目录或 config 目录，或用 SNOWLUMA_CONFIG_DIR
          allowGroups: []   # 默认谁都不理；装好后填自己的群
```

> 仓库里的补丁和测试只使用占位符（`123456789` / `1000000xx`），不写任何人的
> snowluma 本机路径、QQ 号或群号。你自己的配置留在本机 `settings.json` / `cordis.yml`，
> 不要提交回仓库。

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
│  ├─ voice.js           从当前 biography 生成人格一致的 System Prompt
│  ├─ self.js            自我模型：证据 → 经验 → 六维说话倾向微调
│  ├─ life-stream.js     她自己的今天：生活事件、提示词、睡前日记
│  ├─ threads.js         对话线程：没聊完的事、两天后自动放下
│  ├─ outreach.js        主动分享的纯决策：该不该先说、说什么
│  ├─ bci-hub.js         多脑机接口：能力声明、只读/动作策略、限频、审计
│  ├─ onebot-ws-server.js 反向 WS 服务端：snowluma wsClient 直连 8080/ws
│  ├─ broca.js           本地语言组装（双轨 JSON、去标点、预算）
│  ├─ prefrontal.js      感知帧、LLM 输出钳制、双轨生成
│  ├─ brain.js           门面：perceive / advance / sleep / recall / reviewSelf / snapshot
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
- 不做所有群消息逢问必答：余光/免打扰只看不回，被 @ 或被戳一戳也不回；只有焦点群会说话。
- 不输出带句号的长段落（气泡去标点 + `max_expression_chars` 物理截断）。

---

## 九、验证状态（本机实测）

| 项目 | 结果 |
| --- | --- |
| `node bin/sandbox.mjs` | 6/6 通过，约 40ms |
| `node bin/growth-smoke.mjs` | 47/47 通过（人格、复盘、生活流、模糊记忆、线程、主动分享、越界降好感、WS token） |
| `node bin/bci-hub-smoke.mjs` | 12/12 通过（四类适配器、默认拦截、确认、限频、审计） |
| `node bin/ws-reverse-smoke.mjs` | 6/6 通过（反向 WS 握手、事件、动作、群列表） |
| `node bin/sticker-import-smoke.mjs` | 7/7 通过（表情包导入 + 描述编辑 + 分类） |
| `node bin/sticker-smoke.mjs` | 12/12 通过（情绪选择、常用/默认/吃灰、自动归档、手动锁定） |
| `node bin/neuro-smoke.mjs` | 4/4 通过（昼夜节律、目标值、静息态漂移） |
| `node bin/host-smoke.mjs` | 35/35 通过（路由、持久化、好友 10 条门槛、Token 用量、余光/免打扰 @ 也不回、漏斗、吐槽闭环、LLM 钳制、自我复盘、BCI、WS 配置保存） |
| `node bin/bubble-smoke.mjs` | 13/13 通过（长尾采样、情绪耦合、提示词默认一句、最终条数不被标点切碎） |
| `node bin/usage-smoke.mjs` | 9/9 通过（精确 usage / 估算 / 按逻辑 / 缓存 / 会话 / 持久化 / 清零） |
| 安装后 Host 启动 | `boot-report.json`：13 条路由、23 条记忆、gate 6/6、Phase 2 unlocked |
| 存档 | `%USERPROFILE%\.dsh\bibao\brain-state.json`（约 24 KB，原子写） |
| 客户端槽位 | `sidebar.panellist` 出现 `bibao`（order 6），`main` 出现 `bibao` 面板注册 |
| 浏览器视觉 / 点击 | **未验证**：本环境没有浏览器控制；深色 / 浅色观感、气泡动画与滚动需要人工点一眼 |

已确认的运行时行为是 Host 层的；面板的渲染只经过语法与槽位注册检查。
如果打开面板发现样式问题，先看 `client.js` 里的 `CSS` 常量，再对照 `--dsw-alias-*` 令牌。


