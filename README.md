# dsh-plugin-account-usage

DeepSeek Harness 编辑器底部的用量条：在原有的「轮次 / 步数 / tok/s / 缓存命中」旁边，再加三个小药丸。
以下为显示示例：

| 药丸 | 显示 | 说明 |
| --- | --- | --- |
| 账户余额 | `¥4.88` | 读账号余额，充值余额与赠送余额各自列出 |
| 本任务花费 | `本任务 ¥34.00` | 本任务**及其全部子代理**花的钱，按**模型**和**峰谷时段**分别计价 |
| 用量波峰波谷 | `空闲时段` | 当前是高峰还是空闲、距离下次切换多久、两档单价分别多少 |

三个药丸都能点开明细面板。

花费面板示例（换过模型、跨过时段、且派过子代理时）：

```
本任务花费（估算）                    ¥34.00
本会话花费                             ¥14.00
deepseek-flash · 3.0M tok · 空闲时段     ¥6.00
deepseek-flash · 1.0M tok · 高峰时段     ¥8.00
子代理花费（2 个）                     ¥20.00
↳ Test A · 1.0M tok        ¥2.00
↳ Test B · 2.0M tok                   ¥18.00
合计                                  ¥34.00
```

只有一种模型、一个时段、且没有子代理时，面板保持精简的三桶样式（缓存命中 / 缓存未命中 / 输出）。

## 安装

要求：DeepSeek Harness **0.2.2 及以上**（面板定位用的是 CSS 锚点定位；0.2.2 之前的版本没有这套能力，见「版本兼容」）。插件已经预构建，**安装后不需要编译**。

### 方式一：Web 界面（推荐）

侧边栏 **插件** → 安装 → 填入仓库地址：

```
https://github.com/buter-fur/dsh-plugin-account-usage
```

### 方式二：命令行

```bash
dsh plugin --profile desktop add https://github.com/buter-fur/dsh-plugin-account-usage
```

### 方式三：手动

```bash
git clone https://github.com/buter-fur/dsh-plugin-account-usage ~/.dsh/plugins/dsh-plugin-account-usage
ln -s ~/.dsh/plugins/dsh-plugin-account-usage ~/.dsh/profiles/desktop/node_modules/dsh-plugin-account-usage
```

然后编辑 `~/.dsh/profiles/desktop/package.json`，加上依赖与 bundle 两处：

```json
{
  "dependencies": { "dsh-plugin-account-usage": "file:../../plugins/dsh-plugin-account-usage" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-account-usage"] } }
}
```

### 安装后必须重启

**新增 bundle 只在启动时读取一次**，所以装完要退出并重新打开 DeepSeek Harness。之后修改 `lib/client.js` 或 profile 的 patch 会由 HMR 热更新，不必再重启。

## 采用官方计费口径

平台按**每个请求发生的时刻**、以及**服务该请求的模型**收费。插件在 Host 侧（`lib/index.js`）注册了一个会话投影 `usageByModel`，把每个 provider 用量样本归到它自己的「模型 × 时段」格子里，浏览器只负责按格子的单价乘算。

- **模型**：按位置判定。用量样本本身不带模型，所以记到它之前最近一次 `model/selection` 或 `request/header` 的模型名下。
- **时段**：按样本自己的 `time`。北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰，其余为空闲（空闲单价为高峰的一半）。
- **节假日**：法定放假日全天按空闲。日历优先用 `holiday-cache/`，其次用 `data/` 内置快照；未覆盖的年份回退工作日规则，并在面板里写明。
- **子代理**：子代理写的是自己的会话，父会话日志里没有它的 token。插件从父会话的 `subagentCatalog` 找出全部后代，逐个读取它们各自的投影（`sessions.refreshProjections`，不需要打开子会话），再按**各自**的模型与时段计价后相加。
- **替换而不是累加**：同一 turn+step 的样本会替换前一次，所以流式结算和重试的二次上报都不会重复计费。

单价表（元 / 百万 tokens），与官方价目表一致：

| 模型 | 时段 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-flash | 高峰 | 0.04 | 2 | 8 |
| deepseek-flash | 空闲 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 高峰 | 0.30 | 9 | 27 |
| deepseek-v4-pro | 空闲 | 0.15 | 4.5 | 13.5 |

未知模型回落到 `deepseek-flash` 的单价。

### 已知偏差

- 金额是按官方价目表与官方日历**推算**的估算值，不是平台账单回执。
- 投影只有每个样本的时间，没有「平台实际按哪一档结算」的回执；若平台日后调整价目表或峰谷规则，需要改 `lib/client.js` 里的 `PRICES` 与 `PEAK_WINDOWS`。
- 中国法定节假日依赖 `data/` 或 `holiday-cache/` 的日历；国务院通常在每年 11 月公布次年安排，插件启动时会自动抓取今年与明年缺失的年份，抓不到就不写、下次再试。
- 极少数边界：同一个 turn+step 先由 A 模型服务、又被 B 模型重试接管时，那一格会按「替换」记到 B。

## 节假日日历

- 取值顺序：`holiday-cache/`（运行时抓取）→ `data/holiday-2026.json`（内置）→ 工作日规则。
- 数据来自 [`NateScarlet/holiday-cn`](https://github.com/NateScarlet/holiday-cn)，每个年份文件都带 `papers` 字段指向国务院通知原文。
- 日历内容会进投影的 `stateVersion`：日历一变，已存检查点即失效，注册表会自动重折一次完整日志，历史金额按新日历重算。
- 想手动维护：把上游格式的 `holiday-<年>.json` 放进 `~/.dsh/plugins/dsh-plugin-account-usage/holiday-cache/` 即可；删掉该目录就回到内置快照。

## 卸载

**临时停用**（保留源码）：把 profile `package.json` 的 `bundles` 里 `"dsh-plugin-account-usage"` 一行删掉，重启即可。

**彻底卸载**：再删掉 `dependencies` 里那一行与 `node_modules` 里的软链，最后删掉插件目录。

## 结构

```
package.json            包名、dsh.bundle.patch、dsh.client
cordis.patch.yml        bundle 层：插入一行 Host 行
lib/index.js            Host 半边：usageByModel 投影（按模型 × 时段归集用量）
lib/holiday-calendar.js 节假日日历：读缓存/内置、联网刷新、内容指纹
lib/client.js           浏览器半边：三个药丸与明细面板
data/holiday-2026.json  内置日历兜底快照
test/host-smoke.mjs     Host 半边自检（依赖面、注册契约、日历与峰谷判定）
test/render-smoke.mjs   浏览器半边自检（装载 bundle 并渲染整行）
```

## 版本兼容

插件跟着 DSH 的客户端插件 API 走，升级 DSH 后如果药丸消失，先看这张表：

| 插件版本 | 需要的 DSH | 说明 |
| --- | --- | --- |
| 0.1.1 | ≥ 0.2.2 | 面板改用 CSS 锚点定位（`anchor-name` + `position-anchor`），不再依赖已删除的 `primitives.useAnchoredPosition`；`sessionProjections.register` 的异步句柄按 0.2.1-rc.2 的新契约处理；`x-client-version` 改为上报运行时真实版本 |
| 0.1.0 | 0.2.0 ~ 0.2.1 | 面板定位走 `primitives.useAnchoredPosition`，0.2.2 起该导出被删除，渲染即抛错、三个药丸一起消失 |

升级 DSH 后出现「插件用不了了」的排查顺序：

1. 侧边栏 **插件** 页确认 bundle 还在启用列表里（DSH 升级后若重建 profile，bundle 行可能被漏掉）。
2. 看页面开发者工具 Console：如果是 `xxx is not a function`，是本插件引用了新版已删除的 API；如果是 404，是 `lib/client.js` 没随包发出去。
3. 跑 `npm test`（见下），它用与新版本 `dsh-client-ui-primitives` 导出表一致的桩模块渲染整行，引用任何已删除的名字都会当场失败。

## 开发

```bash
npm test
```

两条自检，都只用 `node:` 内置模块，无需安装依赖：

- **`test/host-smoke.mjs`**（Host 半边）——校验三个源文件只 import `node:` 与相对路径；按 0.2.2 语义调用 `apply`：`sessionProjections.register` 返回可调用的 thenable，注册成功只发生一次、注册被拒时不抛错也不留 unhandled rejection；`stateSchema.parse` / `wire.viewSchema.parse` 都能跑通；日历与峰谷判定与浏览器半边一致。
- **`test/render-smoke.mjs`**（浏览器半边）——像页面那样通过 `window.__ModuleLoader__.load` 装载 `lib/client.js`，用一份与 0.2.2 导出表一致的 `dsh-client-ui-primitives` 桩、一个能真正执行函数组件的极简 React 桩来渲染整行：三颗药丸都出现、每颗的 `anchor-name` 唯一且是合法 dashed-ident、展开后每块面板用 `position-anchor` 指回自己的触发器、面板里没有任何 JavaScript 定位样式、并且 `apply` 注册的 dock 行能渲染、余额请求上报的是 `window.__DSH_BOOT__.release.version`。

两条硬约束（都已踩过坑）：

1. **Host 半边不许引用任何裸包名。** 插件装在 dsh 安装目录之外，Node 解析 import 是从引用文件自身目录往上找 `node_modules`，所以 `@deepseek-ai/*` 或任何 npm 包都会 `MODULE_NOT_FOUND`，后果是整个插件加载失败。只能用 `node:` 内置模块与插件内相对路径。`npm test` 里有这一条自动检查。
2. **注册给投影注册表的 schema 必须带能跑通的 `parse`。** 注册表在构建会话快照时会对**每个**注册项调用 `stateSchema.parse` 与 `wire.viewSchema.parse`，一个坏掉的注册项会波及整个会话的历史读取。`apply` 里有 `isRegistrable` 闸门兜底：证明不了可解析就不注册。

## License

MIT
