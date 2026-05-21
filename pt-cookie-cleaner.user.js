// ==UserScript==
// @name         移除特定站点 Cookie 空格
// @namespace    https://github.com/schalkiii/tamper-monkey-scripts
// @version      1.0.0
// @description  移除 PT 站点 Cookie 中分号后的空格，修复 IYUU 自动签到兼容性问题
// @author       Schalkiii
// @license      MIT
// @run-at       document-start
// @match        https://ubits.club/*
// @match        https://www.agsvpt.com/*
// @match        https://www.yemapt.org/*
// @match        https://pt.hdupt.com/*
// @match        https://pt.gtkpw.xyz/*
// @match        https://pt.cdfile.org/*
// @match        https://pt.itzmx.com/*
// @match        https://www.joyhd.net/*
// @match        https://www.hdkyl.in/*
// @match        https://1ptba.com/*
// @match        https://aidoru-online.me/*
// @match        https://asiandvdclub.org/*
// @match        https://audiences.me/*
// @match        https://byr.pt/*
// @match        https://carpt.net/*
// @match        https://club.hares.top/*
// @match        https://cyanbug.net/*
// @match        https://discfan.net/*
// @match        https://dreamingtree.org/*
// @match        https://femdomcult.org/*
// @match        https://greatposterwall.com/*
// @match        https://hd-space.org/*
// @match        https://hdchina.org/*
// @match        https://hdfans.org/*
// @match        https://hdhome.org/*
// @match        https://hddolby.com/*
// @match        https://hdsky.me/*
// @match        https://hdvideo.one/*
// @match        http://hdzone.me/*
// @match        https://hdcity.leniter.org/*
// @match        https://hhanclub.top/*
// @match        http://ihdbits.me/*
// @match        https://kamept.com/*
// @match        https://kufirc.com/*
// @match        https://leaves.red/*
// @match        https://monikadesign.uk/*
// @match        https://nanyangpt.com/*
// @match        https://oldtoons.world/*
// @match        https://ourbits.club/*
// @match        https://piggo.me/*
// @match        https://pt.0ff.cc/*
// @match        https://pt.2xfree.org/*
// @match        https://pt.btschool.club/*
// @match        https://pt.eastgame.org/*
// @match        https://pt.keepfrds.com/*
// @match        https://pt.soulvoice.club/*
// @match        https://ptsbao.club/*
// @match        https://sharkpt.net/*
// @match        https://skyey2.com/*
// @match        https://totheglory.im/*
// @match        https://zmpt.cc/*
// @match        https://www.beitai.pt/*
// @match        https://www.haidan.video/*
// @match        https://www.hd.ai/*
// @match        https://www.hdarea.co/*
// @match        https://www.htpt.cc/*
// @match        https://www.icc2022.com/*
// @match        https://www.nicept.net/*
// @match        https://www.okpt.net/*
// @match        https://www.pttime.org/*
// @match        https://www.tjupt.org/*
// @match        https://www.torrentleech.org/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  var cookieStr = document.cookie;
  var cleanedCookieStr = cookieStr.replace(/;\s+/g, ";");

  console.log("[CookieClean] 原始 cookie:", cookieStr);
  console.log("[CookieClean] 清理后 cookie:", cleanedCookieStr);

  cleanedCookieStr.split(";").forEach(function (entry) {
    var eqIdx = entry.indexOf("=");
    if (eqIdx === -1) return;
    var name = entry.substring(0, eqIdx).trim();
    var value = entry.substring(eqIdx + 1).trim();
    if (name && value) {
      document.cookie = name + "=" + value + "; path=/;";
    }
  });
})();
