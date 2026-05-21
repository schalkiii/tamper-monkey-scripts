// ==UserScript==
// @name            qB-WebUI 根据辅种数添加标签
// @name:en         qB-WebUI Add Tags Based on Reseed Count
// @namespace       localhost
// @version         0.5.0
// @author          Schalkiii
// @description     在 qBittorrent WebUI 中根据辅种数为种子添加标签，支持 all 和 list 两种模式
// @description:en  Add tags to torrents in qBittorrent WebUI based on reseed count, supporting all and list modes
// @license         MIT
// @run-at          document-end
// @match           http://192.168.10.111:9091/*
// @match           http://127.0.0.1:9091/*
// @grant           GM_xmlhttpRequest
// ==/UserScript==

/* globals torrentsTable */

(function () {
  "use strict";

  var baseURL = window.location.origin + "/api/v2/torrents/";
  var reseedAPI =
    "http://api.iyuu.cn/index.php?s=App.Api.GetSubject&info_hash=";
  var tagPrefix = "Reseed-";

  function getTorrentList(scope) {
    if (scope === "all") {
      return getFetch("info");
    }
    if (scope === "list") {
      if (!window.torrentsTable) {
        console.error("[qB-Tagger] torrentsTable 未就绪");
        return null;
      }
      return torrentsTable.getFilteredAndSortedRows().map(function (row) {
        return row.full_data;
      });
    }
    return null;
  }

  async function getFetch(route) {
    try {
      var response = await fetch(baseURL + route);
      if (!response.ok) {
        throw new Error("Error fetching data!");
      }
      return await response.json();
    } catch (error) {
      console.error("[qB-Tagger] 获取种子列表失败：" + error);
      return null;
    }
  }

  function queryReseedCount(hash) {
    return new Promise(function (resolve) {
      console.log("[qB-Tagger] 查询辅种数：" + hash + "...");
      GM_xmlhttpRequest({
        url: reseedAPI + hash,
        method: "GET",
        onload: function (response) {
          console.log("[qB-Tagger] 请求完成，状态码：" + response.status);
          if (response.status !== 200) {
            console.warn("[qB-Tagger] 请求失败，状态码：" + response.status);
            resolve({ hash: hash, reseedCount: -1 });
            return;
          }

          var json;
          try {
            json = JSON.parse(response.responseText);
          } catch (e) {
            console.error("[qB-Tagger] JSON 解析失败：" + e);
            resolve({ hash: hash, reseedCount: -1 });
            return;
          }

          if (json.ret !== 200) {
            console.warn("[qB-Tagger] API 返回 ret=" + json.ret);
            resolve({ hash: hash, reseedCount: -1 });
            return;
          }

          var count = Math.max(json.data.pid_total, json.data.tid_total);
          console.log("[qB-Tagger] Hash " + hash + " 辅种数：" + count);
          resolve({ hash: hash, reseedCount: count });
        },
        onerror: function (error) {
          console.error("[qB-Tagger] 请求发生错误：" + error);
          resolve({ hash: hash, reseedCount: -1 });
        },
      });
    });
  }

  async function addTagToTorrent(hash, tag) {
    var url = baseURL + "addTags";
    var data = new URLSearchParams();
    data.append("hashes", hash);
    data.append("tags", tag);

    try {
      var response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: data,
      });
      if (!response.ok) {
        throw new Error("Error adding tag!");
      }
      console.log("[qB-Tagger] 标签添加成功：" + hash + ' → "' + tag + '"');
    } catch (error) {
      console.error(
        "[qB-Tagger] 标签添加失败：" + hash + ' → "' + tag + '"',
        error,
      );
    }
  }

  function getReseedTag(reseedCount) {
    if (reseedCount < 0) {
      return null;
    }
    if (reseedCount >= 7) {
      return tagPrefix + "7+";
    }
    return tagPrefix + reseedCount;
  }

  async function processTorrents(scope) {
    var torrentList = await getTorrentList(scope);
    if (!torrentList || torrentList.length === 0) {
      console.log("[qB-Tagger] 未找到种子");
      return;
    }

    console.log(
      '[qB-Tagger] 模式 "' +
        scope +
        '" 下找到 ' +
        torrentList.length +
        " 个种子",
    );
    console.log(
      "[qB-Tagger] 种子哈希列表：",
      torrentList.map(function (t) {
        return t.hash;
      }),
    );

    var successCount = 0;
    var skipCount = 0;
    var errorCount = 0;

    for (var i = 0; i < torrentList.length; i++) {
      var torrent = torrentList[i];
      try {
        var result = await queryReseedCount(torrent.hash);
        console.log(
          "[qB-Tagger] 处理种子：" +
            torrent.name +
            " | Hash " +
            result.hash +
            " | 辅种数 " +
            result.reseedCount,
        );

        var tag = getReseedTag(result.reseedCount);
        if (tag) {
          await addTagToTorrent(result.hash, tag);
          successCount++;
        } else {
          console.warn(
            "[qB-Tagger] 跳过 " + torrent.name + "（无有效辅种数据）",
          );
          skipCount++;
        }
      } catch (error) {
        console.error(
          "[qB-Tagger] 处理种子失败：" + torrent.name + "：" + error,
        );
        errorCount++;
      }
    }

    var msg = "处理完成！成功 " + successCount + " 个";
    if (skipCount > 0) msg += "，跳过 " + skipCount + " 个";
    if (errorCount > 0) msg += "，失败 " + errorCount + " 个";
    showToast(msg);
  }

  function showToast(message) {
    var existing = document.getElementById("qbt-auto-tag-toast");
    if (existing) {
      existing.remove();
    }

    var toast = document.createElement("div");
    toast.id = "qbt-auto-tag-toast";
    toast.textContent = message;
    toast.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:999999;" +
      "padding:10px 20px;background:#2a2a2a;color:#fff;border-radius:6px;" +
      "font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3);" +
      "pointer-events:none;";
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.remove();
    }, 4000);
  }

  function addButton() {
    var newBtn = document.createElement("li");
    newBtn.innerHTML = '<a class="js-modal"><b>打可辅种数标签</b></a>';
    var navbar = document.querySelector("#desktopNavbar > ul");
    if (!navbar) {
      console.log("[qB-Tagger] 未找到导航栏，等待重试...");
      setTimeout(addButton, 1000);
      return;
    }
    navbar.appendChild(newBtn);

    newBtn.addEventListener("click", function () {
      var scope = window.prompt(
        "请先手动删除 [tagNames] 中包含的标签\n" +
          "检查全部种子请输入 [all]\n" +
          "仅检查当前表格中显示的种子请输入 [list]",
        "all",
      );
      if (!scope) return;
      processTorrents(scope);
    });
  }

  addButton();
})();
