# 比宝 · 拟人认知内核

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

一个按计算神经科学四条定律运行的「活人脑」，接在 DSH（DeepSeek Harness）里，长着一张 QQ 的嘴。

```
bibao-brain/             dsh 插件（Host + Client）
  core/                  认知内核：激素、工作空间、记忆、再巩固、睡眠、造梦
  bin/                   验脑 / 冒烟 / 渲染测试
  index.js               Host：大脑实例、HTTP 路由、snowluma 传输、持久化
  client.js              Client：设置页（class 组件，避开 DSH 的 React 双副本）
interactive_visual_im_*.html   最初的六模块认知环路可视化初稿
```

## 它是什么

不是「收到消息 → RAG → 调模型 → 回复」的客服机器人，而是一套确定性神经状态机：

| 定律 | 落点 |
| --- | --- |
| 自由能 / 主动推理 | `core/appraisal.js`：PE > 0.5 或踩到核心信念时，二选一——让步，或改变外部 |
| 全局工作空间与点火 | `core/workspace.js`：5 槽（皮质醇 > 0.75 锁 2 槽），静默时阈值塌陷，走神与内耗自发点火 |
| 互补学习系统 | `core/memory.js`：海马体快写，新皮层只在凌晨 03:00 睡眠回放时慢改 |
| 艾宾浩斯 + 再巩固 | `core/memory.js`：`R = exp(−Δt/S)`，三态分层，心境会永久涂抹旧记忆 |

LLM 只是布洛卡区：外部原话先被重编码成第一人称内部感知帧，模型只能返回被限幅的双轨 JSON；
`appraisal` / `broca` / `reflection` 三条逻辑可以各用一套模型与 key。

## 快速开始

```bash
node bibao-brain/bin/sandbox.mjs      # 6 大认知沙盒，应输出 6/6
node bibao-brain/bin/growth-smoke.mjs # 人格 / 复盘 / 生活流 / 模糊记忆 / 线程 / 主动分享 / 越界降好感，47 项
node bibao-brain/bin/bci-hub-smoke.mjs # 多脑机接口策略，12 项
node bibao-brain/bin/host-smoke.mjs   # Host 路由 / 持久化 / 好友面板 / 用量 / 知识库 / 主人面板 / 群层只看不回，42 项
node bibao-brain/bin/group-smoke.mjs  # 固定白名单不会被自动降级，6 项
node bibao-brain/bin/bubble-smoke.mjs # 气泡长尾 / 情绪耦合 / 句子完整性，15 项
node bibao-brain/bin/knowledge-smoke.mjs # 知识库分块 / 检索 / 导入 / BCI 开关，7 项
node bibao-brain/bin/openai-smoke.mjs # 直连 baseURL 与完整 URL，3 项
node bibao-brain/bin/usage-smoke.mjs  # Token 计量：精确/估算/分组/缓存/会话/持久化，9 项
node bibao-brain/bin/render-smoke.mjs # 设置页各标签的渲染冒烟
node bibao-brain/bin/sticker-import-smoke.mjs # 表情包导入 + 分类，7 项
node bibao-brain/bin/sticker-smoke.mjs # 表情包分类/自动归档，12 项
node bibao-brain/bin/neuro-smoke.mjs # 神经递质昼夜节律，4 项
node bibao-brain/bin/life-smoke.mjs # 生活流每日变化 / 周末 / 主题，4 项
node bibao-brain/bin/ws-reverse-smoke.mjs # 反向 WS，6 项
node bibao-brain/bin/eval-qq.mjs      # 20 个 QQ 场景的盲评样本
```

安装到 DSH：

```bash
dsh plugin add huajikano/bibao
```

或者用 Release 里的预构建包（免构建授权）：

```bash
dsh plugin add https://github.com/huajikano/bibao/releases/latest/download/bibao.tgz
```

装好后重启 DSH，在 **设置 → 比宝** 打开；另有一个只监听回环的独立控制台
（`http://127.0.0.1:3110/?token=…`，地址见 `~/.dsh/bibao/boot-report.json` 的 `consoleUrl`）。

详细文档见 [bibao-brain/README.md](bibao-brain/README.md)。

## 版本

| Tag | 内容 |
| --- | --- |
| [`v0.12.1`](https://github.com/huajikano/bibao/releases/tag/v0.12.1) | 知识库翻书、导入限制与自动启用；生活流按天/周末/主题变化；主人面板（QQ + 长期要求）；短问候走本地快路径，减少慢模型等待 |
| [`v0.12.0`](https://github.com/huajikano/bibao/releases/tag/v0.12.0) | 知识库改成“翻书”并说明导入限制、导入后自动启用；生活流按天/周末/主题变化且不等聊天才翻页；新增主人面板（QQ + 长期要求） |
| [`v0.11.0`](https://github.com/huajikano/bibao/releases/tag/v0.11.0) | 直连模型可填完整 `/chat/completions` URL 与无斜杠模型名；白名单改为固定焦点；长句在完整分句处收尾；新增知识库 BCI |
| [`v0.10.0`](https://github.com/huajikano/bibao/releases/tag/v0.10.0) | 表情包分「常用/默认/吃灰」并可手动归类；好感/神经递质加入昼夜节律与实时趋势；认知环路图静息态也会流动 |
| [`v0.9.1`](https://github.com/huajikano/bibao/releases/tag/v0.9.1) | 新插件图标；越界问题会降好感并累积、正常关心仍能回升；好友/对话列表好感实时刷新并显示一位小数 |
| [`v0.9.0`](https://github.com/huajikano/bibao/releases/tag/v0.9.0) | 默认灵动小女孩节奏：长尾气泡、玩心/疲惫/生气耦合、提示词默认一句、最终条数不被标点切碎 |
| [`v0.8.8`](https://github.com/huajikano/bibao/releases/tag/v0.8.8) | 群聊层级修正：余光/免打扰只看不回，被 @ 或被戳一戳也不回；只有焦点群会说话 |
| [`v0.8.7`](https://github.com/huajikano/bibao/releases/tag/v0.8.7) | 用量面板参考 CC Switch：本次会话、缓存读/写、命中率、平均延迟、按模块/模型/最近调用 |
| [`v0.8.6`](https://github.com/huajikano/bibao/releases/tag/v0.8.6) | 设置页后面新增「用量」：按输入/输出、认知模块、模型、最近 14 天统计 Token |
| [`v0.8.5`](https://github.com/huajikano/bibao/releases/tag/v0.8.5) | 戳一戳二选一：回戳一下或发一张表情包，不再发文字；表情包按情绪/上下文选并加冷却 |
| [`v0.8.4`](https://github.com/huajikano/bibao/releases/tag/v0.8.4) | snowluma 目录不再要求固定路径：环境变量/设置字段/常见目录/盘符浅扫自动找；找不到时给出可操作提示 |
| [`v0.8.3`](https://github.com/huajikano/bibao/releases/tag/v0.8.3) | 清理补丁/测试里的本机路径、QQ 号、群号；snowluma 配置目录改为自动探测 |
| [`v0.8.2`](https://github.com/huajikano/bibao/releases/tag/v0.8.2) | 戳一戳回戳（只一下）、好友面板改为互动 10 条自动进入并由她管理、显示 QQ 账号小字 |
| [`v0.8.1`](https://github.com/huajikano/bibao/releases/tag/v0.8.1) | 反向 WS 服务端（snowluma wsClient 直连 8080/ws）、任意群戳一戳回复、表情包描述可编辑 |
| [`v0.8.0`](https://github.com/huajikano/bibao/releases/tag/v0.8.0) | 对话线程、默认关闭的主动分享、QQ 盲评样本；修表情包导入、戳一戳回复、WS 配置保存与重连 |
| [`v0.7.0`](https://github.com/huajikano/bibao/releases/tag/v0.7.0) | 人格一致提示词、自我复盘/元认知、她自己的生活流、模糊记忆、多脑机接口适配层；修 QQ 表情包发送崩溃 |
| [`v0.0.3`](https://github.com/huajikano/bibao/releases/tag/v0.0.3) | SQLite 持久层、夜间事实归纳、词法向量检索、时间校准（附 `bibao.tgz`） |
| [`v0.0.2`](https://github.com/huajikano/bibao/releases/tag/v0.0.2) | 行为滑杆（记忆力 / 说话频率）、群聊三层状态、感官接口 |
| [`v0.0.1`](https://github.com/huajikano/bibao/releases/tag/v0.0.1) | 首个可运行版本 |

## 状态

- Phase 1（纯认知沙盒）：6/6 通过
- Phase 2（snowluma 感知与运动皮层）：已接通 OneBot HTTP/WS + **反向 WS**（snowluma `wsClients` 直连 `8080/ws`），
  群白名单 + 防抖 + 三层漏斗；真实群消息已验证能触发回复
- 成长层：人格一致的动态提示词、自我复盘（证据 → 经验 → 六维说话倾向）、生活流、模糊记忆
- 关系层：对话线程（没聊完的事会留一条线、两天后放下）、默认关闭的主动私聊分享
- 记忆：SQLite 情景层 + 软删除归档 + 语义事实层（带出处、会过期、会被新说法推翻）
- 多脑机接口：`core/bci-hub.js` 统一适配器、只读/动作策略、限频与审计；新增可开关的知识库检索接口（像翻书，不是整篇 RAG）
- 主人面板：设置主人 QQ 与长期要求；要求会作为“答应过的事”进入提示词，不是每句话的命令
- 生活流：按天、周末、每日主题和空档变化，打开面板/跨天也会生成新一天，不再等聊天才翻页
- 模型：直连支持完整 `/chat/completions` URL 和无 `provider/` 前缀的模型名（如 `spark-x2.6`）
- 说话：长句优先在完整分句处收尾，不再把一句话砍掉半截
- QQ 修复：表情包导入与描述编辑；被戳后按情绪/上下文二选一（回戳一下或表情包，不发文字）；反向 WS 连接、WS 配置重启不丢
- 隐私：补丁/测试只含占位符，不写本机 snowluma 路径、QQ 号或群号；真实配置只留在本机
- 群聊层级：白名单是**固定白名单**，不会被自动退出焦点；只有「焦点」群会回复，「余光」和「免打扰」只看不回，被 @ 或被戳一戳也不会回
- 界面：设置页十标签（脑内 / 对话 / 记忆 / 群聊 / 验脑 / 人物 / 感官 / 好友 / 设置 / 用量）+ 独立控制台

路线图见 [docs/ROADMAP.md](docs/ROADMAP.md)，多接口说明见 [docs/BCI.md](docs/BCI.md)。

## 许可

代码仅供学习与个人使用。snowluma 是第三方运行时，不随本仓库分发。

