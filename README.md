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
node bibao-brain/bin/host-smoke.mjs   # Host 路由 / 持久化 / LLM 钳制，23 项
node bibao-brain/bin/render-smoke.mjs # 设置页六个标签的渲染冒烟
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
| [`v0.0.3`](https://github.com/huajikano/bibao/releases/tag/v0.0.3) | SQLite 持久层、夜间事实归纳、词法向量检索、时间校准（附 `bibao.tgz`） |
| [`v0.0.2`](https://github.com/huajikano/bibao/releases/tag/v0.0.2) | 行为滑杆（记忆力 / 说话频率）、群聊三层状态、感官接口 |
| [`v0.0.1`](https://github.com/huajikano/bibao/releases/tag/v0.0.1) | 首个可运行版本 |

## 状态

- Phase 1（纯认知沙盒）：6/6 通过
- Phase 2（snowluma 感知与运动皮层）：已接通 OneBot HTTP/WS，群白名单 + 防抖 + 三层漏斗；
  真实群消息已验证能触发回复
- 记忆：SQLite 情景层 + 软删除归档 + 语义事实层（带出处、会过期、会被新说法推翻）
- 界面：设置页七标签（脑内 / 对话 / 记忆 / 群聊 / 验脑 / 感官 / 设置）

## 许可

代码仅供学习与个人使用。snowluma 是第三方运行时，不随本仓库分发。
