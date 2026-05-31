// ==UserScript==
// @name         IYUU 可辅种数查看助手
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  自动从 PT 站种子详情页提取 Hash 码并查询 IYUU 可辅种总数，支持多种 NexusPHP Hash 格式
// @author       Schalkiii
// @license      MIT
// @match        http*://*/details*.php*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @downloadURL https://update.greasyfork.org/scripts/523202/IYUU%20%E5%8F%AF%E8%BE%85%E7%A7%8D%E6%95%B0%E6%9F%A5%E7%9C%8B%E5%8A%A9%E6%89%8B.user.js
// @updateURL https://update.greasyfork.org/scripts/523202/IYUU%20%E5%8F%AF%E8%BE%85%E7%A7%8D%E6%95%B0%E6%9F%A5%E7%9C%8B%E5%8A%A9%E6%89%8B.meta.js
// ==/UserScript==

(function () {
  "use strict";

  function extractInfoHash() {
    var bodyText = document.body.innerHTML;

    var patterns = [
      /<b>Hash[码碼]:<\/b>&nbsp;([a-f0-9]{40})/i,
      /Hash[码碼]:?\s*(?:&nbsp;)?\s*([a-f0-9]{40})/i,
      /Info\s*Hash:?\s*(?:&nbsp;)?\s*([a-f0-9]{40})/i,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = patterns[i].exec(bodyText);
      if (match && match[1]) {
        return match[1];
      }
    }

    var downloadLinks = document.querySelectorAll(
      'a[href*="download.php"], a[href*="download"], a[href*="dl.php"]',
    );
    for (var j = 0; j < downloadLinks.length; j++) {
      var href = downloadLinks[j].getAttribute("href");
      var dlMatch = /[?&](?:hash|info_hash)=([a-f0-9]{40})/i.exec(href);
      if (dlMatch && dlMatch[1]) {
        return dlMatch[1];
      }
    }

    return null;
  }

  var infoHash = extractInfoHash();

  if (!infoHash) {
    console.log("[IYUU] 未找到 Hash 码，跳过页面修改");
    return;
  }

  console.log("[IYUU] 已找到 Hash 码：" + infoHash);

  var apiUrl =
    "http://api.iyuu.cn/index.php?s=App.Api.GetSubject&info_hash=" + infoHash;
  console.log("[IYUU] 请求 URL：" + apiUrl);

  GM_xmlhttpRequest({
    url: apiUrl,
    method: "GET",
    onload: function (response) {
      console.log("[IYUU] 请求完成，状态码：" + response.status);
      if (response.status !== 200) {
        console.error("[IYUU] 请求失败，状态码：" + response.status);
        return;
      }

      var json;
      try {
        json = JSON.parse(response.responseText);
      } catch (e) {
        console.error("[IYUU] JSON 解析失败：" + e);
        return;
      }

      if (json.ret !== 200) {
        console.warn(
          "[IYUU] API 返回 ret=" + json.ret + "，可能该 Hash 无辅种数据",
        );
        return;
      }

      var reseedCount = Math.max(json.data.pid_total, json.data.tid_total);
      console.log("[IYUU] 可辅种数：" + reseedCount);

      var downloadLink = document.querySelector(
        'td.rowfollow a[title*="下载种子"], td.rowfollow a[title*="下載種子"]',
      );
      if (!downloadLink) {
        console.error("[IYUU] 未找到「下载种子」行");
        return;
      }

      var downloadRow = downloadLink.closest("tr");
      var displaySpan = document.createElement("span");
      displaySpan.innerHTML =
        '&nbsp;|&nbsp;<b><font class="small">可辅种数: ' +
        reseedCount +
        "</font></b>";
      downloadRow.querySelector("td.rowfollow").appendChild(displaySpan);
      console.log("[IYUU] 辅种数已添加到页面");
    },
    onerror: function (error) {
      console.error("[IYUU] 请求发生错误：" + error);
    },
  });
})();
