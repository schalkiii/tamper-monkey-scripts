# TamperMonkey Scripts

个人自用的 TamperMonkey / Greasemonkey 油猴脚本集合。

## 脚本列表

| 脚本                                                                     | 用途                                               | 版本  |
| ------------------------------------------------------------------------ | -------------------------------------------------- | ----- |
| [auto-verify.user.js](./auto-verify.user.js)                             | 通用验证码自动识别与填写                           | 1.0.0 |
| [iyuu-reseed-checker.user.js](./iyuu-reseed-checker.user.js)             | PT 站种子详情页显示 IYUU 可辅种数                  | 1.3   |
| [qbittorrent-reseed-tagger.user.js](./qbittorrent-reseed-tagger.user.js) | qBittorrent WebUI 根据辅种数自动打标签             | 0.5.0 |
| [pt-cookie-cleaner.user.js](./pt-cookie-cleaner.user.js)                 | 移除 PT 站 Cookie 分号后空格，修复 IYUU 签到兼容性 | 1.0.0 |

---

## auto-verify.user.js — 验证码自动识别

### 功能

自动识别网页上的验证码图片（图形验证码），通过 OCR 解析后填入对应的输入框。

### 特性

- **通用匹配**：通过关键词（captcha/verify/code/验证码）自动定位验证码图片和输入框
- **智能配对**：基于视觉邻近度 + 关键词评分的加权配对算法，防止误填
- **2FA 排除**：自动检测并跳过两步验证（TOTP/2FA/MFA）输入框
- **OCR.space API**：使用 OCR.space 免费 API 进行识别（key: `helloworld`，每日 500 次）
- **网站自定义**：支持为特定网站配置自定义关键词白名单/黑名单
- **图片重载检测**：监听验证码图片刷新事件，自动重新识别

### 安装

直接在 TamperMonkey 中导入 `auto-verify.user.js` 即可，无需额外配置。

### 配置

脚本菜单（TamperMonkey 图标 → 脚本名 → 菜单项）：

- **切换日志输出**：开启/关闭控制台调试日志
- **管理网站自定义配置**：为特定域名设置自定义关键词
- **清除所有数据**：重置所有配置

### 技术说明

使用 OCR.space 公共 API（`helloworld` key），无需注册，但有频率限制。如需更高限额，自行到 [ocr.space](https://ocr.space/OCRAPI) 注册免费 key。

---

## iyuu-reseed-checker.user.js — IYUU 可辅种数查看

### 功能

在 PT（Private Tracker）站点的种子详情页自动显示该种子的 IYUU 可辅种总数。

### 特性

- 自动从页面提取 Info Hash（40 位十六进制）
- 调用 [IYUU API](http://api.iyuu.cn) 查询辅种数据
- 在「下载种子」行末尾展示结果（如 `可辅种数: 5`）
- 支持简体/繁体中文 PT 站点（自动适配「下载种子」/「下載種子」）

### 安装

直接在 TamperMonkey 中导入 `iyuu-reseed-checker.user.js` 即可。

### 兼容站点

自动匹配 `http*://*/details*.php*` 模式的页面，大部分国内 PT 站均适用。

### 技术说明

依赖 [IYUU 公开 API](http://api.iyuu.cn) 查询辅种数据，无需 Token。

---

## qbittorrent-reseed-tagger.user.js — qB WebUI 辅种标签

### 功能

在 qBittorrent WebUI 中自动为种子打上辅种数标签，方便根据可辅种数量分类管理。

### 特性

- 在 WebUI 顶部导航栏添加「打可辅种数标签」按钮
- 支持两种扫描模式：
  - **list** — 仅处理当前表格中显示的种子
  - **all** — 处理所有种子
- 按辅种数分级打标签：`Reseed-0` ~ `Reseed-6`、`Reseed-7+`
- Toast 消息提示处理结果（非阻塞）
- 自动跳过无有效辅种数据的种子

### 安装

1. 导入脚本到 TamperMonkey
2. **修改 `@match` 规则**中的 IP 地址为你的 qBittorrent WebUI 地址

```javascript
// @match  http://192.168.10.72:9091/*
// @match  http://127.0.0.1:9091/*
```

### 使用

1. 打开 qBittorrent WebUI
2. 确认左侧已选中要处理的分类 / 标签
3. 点击顶部导航栏的「打可辅种数标签」
4. 输入 `all` 或 `list` 选择扫描范围
5. 等待处理完成，查看 Toast 结果

### 注意事项

- 扫描前建议手动删除已有 `Reseed-*` 标签，避免重复
- 处理大量种子时耗时较长，请耐心等待（单线程逐条查询）
- 依赖 qBittorrent WebUI 的 `torrentsTable` 全局变量

---

## pt-cookie-cleaner.user.js — Cookie 空格清理

### 功能

移除 PT 站点 Cookie 中分号后的空格，将 Cookie 格式标准化为 IYUU 自动签到兼容的格式。

### 背景

部分 PT 站点在 `Set-Cookie` 时，不同 Cookie 条目之间使用 `; `（分号+空格）分隔。IYUU 自动签到工具在解析这些 Cookie 时会因空格导致解析失败。此脚本在页面加载前清理 Cookie 格式。

### 安装

直接在 TamperMonkey 中导入 `pt-cookie-cleaner.user.js` 即可。

### 覆盖站点

内置 70+ 个常见 PT 站匹配规则，包括 HDChina、HDSky、M-Team、TTG 等主流站点。

### 技术说明

- 使用 `@run-at document-start` 确保在页面 JS 执行前完成清理
- 使用 `@grant none`（直接操作 `document.cookie`，无需特权 API）
- 保留 Cookie 值中的等号（使用 `indexOf` 而非 `split('=')`）

---

## 许可

MIT License
