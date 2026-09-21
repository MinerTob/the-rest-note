# 项目约定

## 开发文档（硬性要求）

- 动手之前先读 `DEVELOPMENT.md`：找功能看 §3 功能地图，改实现看 §5 模块详解，找 DOM 钩子看 §7，找存储 key / 事件看 §6。
- **每新增或修改一个功能，必须更新 `DEVELOPMENT.md`**：
  - 在 §10 功能日志**最上面**追加一条（模板在文档里）；
  - 如果动了导出函数、`data-*` 钩子、storage key 或自定义事件，同步更新 §3 / §6 / §7 对应表格。
- 没写进文档的功能改动视为没完成。

## 代码约定（细节见 DEVELOPMENT.md §8）

- 分层：`src/lib` 放纯逻辑、不碰 DOM；`src/scripts` 放浏览器行为；`src/i18n` 管文案；`src/views` 只排版。
- 客户端路由：脚本只执行一次，初始化必须幂等（`dataset.ready` 守卫或 `document` 事件委托）。
- 样式只用 `src/styles/tokens.css` 的语义变量，组件里不写死颜色。
- 改完跑：`npm test`、`npm run check`；有 UI 改动再 `npm run build`。

## 交付约定（本人明确要求）

- **修完之后默认直接提交并推送到 `origin`（`main`）**，不用再问："以后都推"。
  提交信息按仓库习惯写：一句中文说明 + 正文写清根因 / 修法 / 实测（见 `git log` 里的例子）。
- 推送前保证 `npm test` / `npm run check` / `npm run build` 都过；推完在回复里给出提交号。

## 代码检索

仓库有 CodeGraph 索引（`.codegraph/`）。找代码优先用它：

- MCP 工具可用时：`codegraph_explore`；
- 否则终端里：`codegraph explore "<符号名或问题>"`。

没有 `.codegraph/` 目录就跳过，改用 `rg` 搜索。
