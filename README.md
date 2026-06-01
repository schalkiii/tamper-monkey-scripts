# TamperMonkey Scripts

个人自用的 TamperMonkey / Greasemonkey 油猴脚本集合。

## 脚本列表

| 脚本                                                                     | 用途                                               | 版本  |
| ------------------------------------------------------------------------ | -------------------------------------------------- | ----- |
| [auto-verify.user.js](./auto-verify.user.js)                             | 通用验证码自动识别与填写                           | 1.0.1 |
| [iyuu-reseed-checker.user.js](./iyuu-reseed-checker.user.js)             | PT 站种子详情页显示 IYUU 可辅种数                  | 1.4   |
| [qbittorrent-reseed-tagger.user.js](./qbittorrent-reseed-tagger.user.js) | qBittorrent WebUI 根据辅种数自动打标签             | 0.5.0 |
| [pt-cookie-cleaner.user.js](./pt-cookie-cleaner.user.js)                 | 移除 PT 站 Cookie 分号后空格，修复 IYUU 签到兼容性 | 2.0.0 |

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

- 多策略 Hash 提取：支持 `<b>Hash码:</b>`、`Hash码:`、`Info Hash:` 等多种 NexusPHP 页面格式
- 自动从下载链接中提取 Hash（`download.php?hash=xxx` / `download.php?info_hash=xxx`）
- 调用 [IYUU API](http://api.iyuu.cn) 查询辅种数据
- 在「下载种子」行末尾展示结果（如 `可辅种数: 5`）
- 支持简体/繁体中文 PT 站点（自动适配「下载种子」/「下載種子」）
- 种子页面无法提取 Hash 时自动跳过，不修改页面显示

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

劫持浏览器 `document.cookie` getter，任何脚本（包括 Cookie Cloud）读取 Cookie 时自动移除分号后的空格，解决 Cookie Cloud → MoviePilot 同步时 cookie 被截断的问题。

### 背景

Cookie Cloud 插件将浏览器 Cookie 上传到 MoviePilot 时，`document.cookie` 标准输出格式为 `key1=val1; key2=val2`（分号后含空格）。MoviePilot 在解析此格式时可能因空格导致 cookie 值被截断，影响功能。

### 实现原理（v2.0）

通过 `Object.defineProperty` 重写 `document.cookie` 的 getter，在读出的 cookie 字符串上执行 `replace(/;\s+/g, ";")` 移除空格。

**对比 v1.0 改进**：

- v1.0：读取 cookie → 去空格 → 重写回浏览器（**破坏性**：丢失 `Secure`/`SameSite`/`expires` 等属性）
- v2.0：劫持 getter 在读取时去空格（**非破坏性**：不修改 cookie 存储，保留所有原始属性）

### 安装

直接在 TamperMonkey 中导入 `pt-cookie-cleaner.user.js` 即可。

### 覆盖站点

内置 70+ 个常见 PT 站匹配规则，包括 HDChina、HDSky、M-Team、TTG 等主流站点。

### 技术说明

- 使用 `@run-at document-start` 确保在页面 JS 及扩展读取 cookie 前完成劫持
- 不修改 cookie 存储，不丢失任何 cookie 属性
- HttpOnly cookie 的可见性受浏览器安全策略限制，无法通过用户脚本绕过

---

## 许可

MIT License
