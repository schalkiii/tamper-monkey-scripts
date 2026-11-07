// ==UserScript==
// @name         PT Medal Monitor
// @namespace    http://tampermonkey.net/
// @version      2026-11-07
// @description  监控所有站点的勋章状况，并按站点时魔判断勋章加成 24 小时做种能否回本
// @author       Schalkiii
// @match        http*://*/medal*.php*
// @match        http*://*/medals*
// @match        http*://*/medal_center.php*
// @match        http*://*/badge*.php*
// @match        http*://*/buycenter.php*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_xmlhttpRequest
// @noframes
// @connect *
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/521928/PT%20Medal%20Monitor.user.js
// @updateURL https://update.greasyfork.org/scripts/521928/PT%20Medal%20Monitor.meta.js
// ==/UserScript==

// Changelog  2026-11-07（同步 PT 勋章扫描器扩展的实测经验）:
// - 新增时魔与回本列：抓各站 mybonus.php（解析不到再试 mybonus_new.php），乘数基数取
//   「勋章加成」行的「基础魔力」而不是总时魔——站点算勋章奖励时不含"低保"，carpt 实测
//   总时魔 149.285 中只有 99.285 参与加成，用总时魔会把收益高估一半，且各站差值无法推导
// - 列定位改为按表头文本：老版本写死 td:nth-child(2..9)，遇到多一列「勋章 ID」的站点
//   （cyanbug/ptcafe 等 10 列布局）整行错位，名称/加成/价格全部串列
// - 可购买判定收紧：老逻辑 canBuy: !row.querySelector('td:nth-child(8) input')?.disabled
//   在该格没有 input 时得到 !undefined = true，把「已购买」「需要更多魔力值」也标成可购买；
//   现在只认 value/text 恰为 购买/購買 且未禁用的按钮
// - 分页自动化：从分页条发现 ?page=N（含省略号折叠页，逐页继续发现，上限 20 页），
//   删除 OKPT-Page2 / CrabPt-Page2 / 财神-Page2 这类手工分页条目
// - 修两处既有 bug：Promise.allSettled 结果未解包（分组永远落在 undefined 键下）；
//   noneMedalUrls 混用对象项与字符串项，filter 用 includes(site.url) 匹配不到对象项
// - 展示改用 textContent：老逻辑把站点返回的勋章名/描述直接 innerHTML 解析
// - 站点表按 2026-11 存活探测同步：好学 medal.php → /medals（旧路径已 404）、
//   zrpt.cc → naturept.top、pt.gtkpw.xyz → pt.gtk.pw、hdvideo.one → hdvideo.top、
//   pterclub.com → pterclub.net、rousi.zip → rousi.pro、www.agsvpt.com → pt.agsvpt.cn、
//   hhanclub.top → hhanclub.net、xingyunge.top → pt.xingyungept.org、
//   playletpt.xyz → playlet.cc、海棠勋章页统一到 buycenter.php；
//   移除已停站的 leaves.red / raingfh.top / momentpt.top，合并重复的 HDV 条目
// Changelog  2025-05-01:
// 添加、修改了一些站点。
// Changelog  2025-04-05:
// 添加、修改了一些站点。解决相对路径导致的勋章图片显示错误问题。对于不支持的站点搜索「购买」按钮来展示疑似可购买的勋章
// Changelog  2025-02-07:
// 添加、修改了一些站点
// Changelog  2025-01-03:
// 添加、修改了一些站点和match规则
// Changelog  2024-12-29:
// 右上角添加按钮，添加只显示有背景色行功能，即只保留最关键的可领取和未来才可领取的勋章。
// Changelog  2024-12-28:
// 右上角添加按钮，点击才运行。
// 抓取结果展示添加按钮跳转方便领取。
// 可领取勋章背景绿色高亮。
// 未来才开始领取的勋章背景橙色高亮。
// 更新、移除部分网址。
// Changelog  2024-12-27-1:
// 修复手续费抓取。
// Changelog  2025-02-27:
// 添加了一些新开的站点。增加显示页面特殊的未支持站点跳转链接

(function () {
    'use strict';

    // 站点配置。medalUrl 缺省时用 url；bonusPaths 覆盖该站的魔力值明细页候选。
    // 只有该站抓到「可购买」勋章时才会去请求时魔页，空列表不多打这一次请求。
    const SITES = [
        { name: '1PTBA', url: 'https://1ptba.com/medal.php' },
        { name: '52PT', url: 'https://52pt.site/medal.php' },
        { name: 'Audiences', url: 'https://audiences.me/medal_center.php' },
        { name: 'BTSchool', url: 'https://pt.btschool.club/medal.php' },
        { name: 'BYR', url: 'https://byr.pt/medal.php' },
        { name: 'CHDBits', url: 'https://ptchdbits.co/medal.php' },
        { name: 'CMCT', url: 'https://springsunday.net/badges.php' },
        { name: 'CarPt', url: 'https://carpt.net/medal.php' },
        { name: 'DiscFan', url: 'https://discfan.net/medal.php' },
        { name: 'Dragon', url: 'https://www.dragonhd.xyz/medal.php' },
        { name: 'FreeFarm', url: 'https://pt.0ff.cc/medal.php' },
        { name: 'GPW', url: 'https://greatposterwall.com/medal.php' },
        { name: 'HDArea', url: 'https://hdarea.club/medal.php' },
        { name: 'HDAtmos', url: 'https://hdatmos.club/medal.php' },
        { name: 'HDCity', url: 'https://hdcity.city/medal.php' },
        { name: 'HDDolby', url: 'https://www.hddolby.com/medals.php' },
        { name: 'HDHome', url: 'https://hdhome.org/medal.php' },
        { name: 'HDPost', url: 'https://pt.hdpost.top/medal.php' },
        { name: 'HDPt', url: 'https://hdpt.xyz/medal.php' },
        { name: 'HDSky', url: 'https://hdsky.me/medal.php' },
        { name: 'HDTime', url: 'https://hdtime.org/medal.php' },
        { name: 'HDU', url: 'https://pt.hdupt.com/medal.php' },
        { name: 'HDVideo', url: 'https://hdvideo.top/medal.php' },
        { name: 'HDfans', url: 'http://hdfans.org/medal.php' },
        { name: 'HITPT', url: 'https://www.hitpt.com/medal.php' },
        { name: 'HUDBT', url: 'https://hudbt.hust.edu.cn/medal.php' },
        { name: 'HaiDan', url: 'https://www.haidan.video/medal.php' },
        { name: 'ITZMX', url: 'https://pt.itzmx.com/medal.php' },
        { name: 'JoyHD', url: 'https://www.joyhd.net/medal.php' },
        { name: 'NanYang', url: 'https://nanyangpt.com/medal.php' },
        { name: 'Oshen', url: 'http://www.oshen.win/medal.php' },
        { name: 'OurBits', url: 'https://ourbits.club/medal.php' },
        { name: 'PThome', url: 'https://www.pthome.net/medal.php' },
        { name: 'PTsbao', url: 'https://ptsbao.club/medal.php' },
        { name: 'SoulVoice', url: 'https://pt.soulvoice.club/medal.php' },
        { name: 'TCCF', url: 'https://et8.org/medal.php' },
        { name: 'TJUPT', url: 'https://www.tjupt.org/medal.php' },
        { name: 'TLFbits', url: 'https://pt.eastgame.org/medal.php' },
        { name: 'TTG', url: 'https://totheglory.im/mall.php?cid=5' },
        { name: 'WT-Sakura', url: 'https://wintersakura.net/medal.php' },
        { name: 'Monika', url: 'https://monikadesign.uk/medal.php' },
        { name: 'ICC', url: 'https://www.icc2022.com/medal.php' },
        { name: 'CyanBug', url: 'https://cyanbug.net/medal.php' },
        { name: '海棠', url: 'https://www.htpt.cc/buycenter.php' },
        { name: '杏林', url: 'https://xingtan.one/medal.php' },
        { name: 'SRVFI', url: 'https://srvfi.top/medal.php' },
        { name: 'OKPT', url: 'https://www.okpt.net/medal.php' },
        { name: 'GGPT', url: 'https://www.gamegamept.com/medal.php' },
        { name: 'Panda', url: 'https://pandapt.net/medal.php' },
        { name: 'KuFei', url: 'https://kufei.org/medal.php' },
        { name: 'RouSi', url: 'https://rousi.pro/medal.php' },
        { name: '悟空', url: 'https://wukongwendao.top/medal.php' },
        { name: 'PTCafe', url: 'https://ptcafe.club/medal.php' },
        { name: 'PTChina', url: 'https://ptchina.org/medal.php' },
        { name: 'GTK', url: 'https://pt.gtk.pw/medal.php' },
        { name: 'ECUST', url: 'https://pt.ecust.pp.ua/medal.php' },
        { name: 'iloli', url: 'https://share.ilolicon.com/medal.php' },
        { name: 'CrabPt', url: 'https://crabpt.vip/medal.php' },
        { name: 'PTFans', url: 'https://ptfans.cc/medal.php' },
        { name: '影', url: 'https://star-space.net/medal.php' },
        { name: 'PTzone', url: 'https://ptzone.xyz/medal.php' },
        { name: 'PTLGS', url: 'https://ptlgs.org/medal.php' },
        { name: 'NJTUPT', url: 'https://njtupt.top/medal.php' },
        { name: 'FRDS', url: 'https://pt.keepfrds.com/medal.php' },
        { name: 'U2', url: 'https://u2.dmhy.org/medal.php' },
        { name: 'Ubits', url: 'https://ubits.club/medal.php' },
        { name: 'KamePT', url: 'https://kamept.com/medal.php' },
        { name: '伞', url: 'https://sanpro.pw/medal.php' },
        { name: 'DevTracker', url: 'https://tracker.ldo.pics/medal.php' },
        { name: '唐门', url: 'https://tmpt.top/medal.php' },
        { name: 'HDBao', url: 'https://hdbao.cc/medal.php' },
        { name: 'AFUN', url: 'https://www.ptlover.cc/medal.php' },
        { name: 'LemonHDNet', url: 'https://lemonhd.net/medal.php' },
        { name: 'Sewer', url: 'https://sewerpt.com/medal.php' },
        { name: 'RailGun', url: 'https://bilibili.download/medal.php' },
        { name: 'A4A', url: 'https://a4apt.com/medal.php' },
        { name: '葫芦娃', url: 'https://pt.541542.xyz/medal.php' },
        { name: 'Playlet', url: 'https://playlet.cc/medal.php' },
        { name: 'PTSKIT', url: 'https://www.ptskit.com/medal.php' },
        { name: 'MyPT', url: 'https://cc.mypt.cc/medal.php' },
        { name: '垃圾堆', url: 'https://pt.lajidui.top/medal.php' },
        { name: 'siqi', url: 'https://si-qi.xyz/medal.php' },
        { name: '13city', url: 'https://13city.org/medal.php' },
        { name: '藏宝阁', url: 'https://cangbao.ge/medal.php' },
        { name: 'aling', url: 'https://pt.aling.de/medal.php' },
        { name: 'March', url: 'https://duckboobee.org/medal.php' },
        // 好学改版：/medal.php 与 /mybonus.php 均已 404，勋章图鉴在 /medals。
        // 该站是卡片布局（article.mcard + ul.spec），本脚本的表格解析拿不到，
        // 会退化为「疑似购买按钮」提示；时魔改由 /my-spark 提供（需前端渲染，抓不到）
        { name: '好学', url: 'https://www.hxpt.org/medals', bonusPaths: [] },
        { name: '未来幻境', url: 'https://nex.jivon.de/medal.php' },
        { name: '52Movie', url: 'https://www.52movie.top/medal.php' },
        { name: 'Luck', url: 'https://pt.luckpt.de/medal.php' },
        { name: 'NovaHD', url: 'https://pt.novahd.top/medal.php' },
        { name: 'YHPP', url: 'https://www.yhpp.cc/medal.php' },
        { name: '天枢', url: 'https://dubhe.site/medal.php' },
        { name: '躺平', url: 'https://www.tangpt.top/medal.php' },
        { name: '自然', url: 'https://naturept.top/medal.php' },
        { name: '包子', url: 'https://p.t-baozi.cc/medal.php' },
        { name: '慕雪', url: 'https://pt.muxuege.org/medal.php' },
        { name: '星陨阁', url: 'https://pt.xingyungept.org/medal.php' },
        { name: '财神', url: 'https://cspt.top/medal.php' },
        { name: 'PTer', url: 'https://pterclub.net/medal.php' },
        { name: 'ZMPT', url: 'https://zmpt.cc/medal.php' },
        { name: '象岛', url: 'https://ptvicomo.net/medal.php' },
        { name: '麒麟', url: 'https://www.hdkyl.in/medal.php' },
        { name: 'Piggo', url: 'https://piggo.me/medal.php' },
        { name: 'QingWa', url: 'https://qingwapt.com/medal.php' },
        { name: 'AGSV', url: 'https://pt.agsvpt.cn/medal.php' },
        { name: 'YemaPT', url: 'https://www.yemapt.org/#/consumer/badge' },
        { name: 'HHClub', url: 'https://hhanclub.net/medal.php' },
    ];

    // 表格布局未适配的站点：给出跳转入口，避免被误当成「没有勋章」
    const usupportUrls = [
        { name: '好学', url: 'https://www.hxpt.org/medals' },
        { name: '财神', url: 'https://cspt.top/medal.php' },
        { name: 'PTer', url: 'https://pterclub.net/medal.php' },
        { name: 'ZMPT', url: 'https://zmpt.cc/medal.php' },
        { name: '象岛', url: 'https://ptvicomo.net/medal.php' },
        { name: '麒麟', url: 'https://www.hdkyl.in/medal.php' },
        { name: 'Piggo', url: 'https://piggo.me/medal.php' },
        { name: 'QingWa', url: 'https://qingwapt.com/medal.php' },
        { name: 'AGSV', url: 'https://pt.agsvpt.cn/medal.php' },
        { name: 'YemaPT', url: 'https://www.yemapt.org/#/consumer/badge' },
        { name: 'HHClub', url: 'https://hhanclub.net/medal.php' },
    ];

    const offlineUrls = [
        { name: 'RS', url: 'https://resource.xidian.edu.cn/medal.php' },
        { name: 'DaJiao', url: 'https://dajiao.cyou/medal.php' },
        { name: 'HaresClub', url: 'https://club.hares.top/medal.php' },
        { name: '回声PT', url: 'https://hspt.club/medal.php' },
    ];

    // medal.php 404 的站点（可能没有勋章功能）。统一按 url 字符串比对：
    // 老版本这里对象项与字符串项混用，includes(site.url) 永远匹配不到对象项
    const noneMedalUrls = [
        'https://zhuque.in/medal.php',
        'https://www.pttime.org/medal.php',
        'https://jpopsuki.eu/medal.php',
        'https://hawke.uno/medal.php',
        'https://fearnopeer.com/medal.php',
        'https://lemonhd.club/medal.php',
        'https://hd-space.org/medal.php',
        'https://52pt.site/medal.php',
        'https://audiences.me/medal.php',
        'https://pt.btschool.club/medal.php',
        'https://ptchdbits.co/medal.php',
        'https://www.dragonhd.xyz/medal.php',
        'https://hdarea.club/medal.php',
        'https://hdcity.city/medal.php',
        'https://hdhome.org/medal.php',
        'https://pt.hdpost.top/medal.php',
        'https://hdsky.me/medal.php',
        'https://pt.hdupt.com/medal.php',
        'https://www.hitpt.com/medal.php',
        'https://hudbt.hust.edu.cn/medal.php',
        'https://www.haidan.video/medal.php',
        'https://club.hares.top/medal.php',
        'https://pt.itzmx.com/medal.php',
        'https://www.joyhd.net/medal.php',
        'https://nanyangpt.com/medal.php',
        'https://ourbits.club/medal.php',
        'https://www.pthome.net/medal.php',
        'https://ptsbao.club/medal.php',
        'https://et8.org/medal.php',
        'https://monikadesign.uk/medal.php',
        'https://star-space.net/medal.php',
        'https://pt.keepfrds.com/medal.php',
        'https://u2.dmhy.org/medal.php',
        'https://pt.eastgame.org/medal.php',
        'https://www.tjupt.org/medal.php',
        'https://byr.pt/medal.php',
        'https://resource.xidian.edu.cn/medal.php',
    ];

    const medalUrlOf = (site) => site.medalUrl || site.url;
    const newSITES = SITES.filter(site => !noneMedalUrls.includes(medalUrlOf(site)));

    // ===== 时魔（每小时做种魔力值）与回本 =====

    const DEFAULT_BONUS_PATHS = ['/mybonus.php', '/mybonus_new.php'];
    const PAYBACK_WINDOW_HOURS = 24;
    const MAX_PAGES = 20;

    // 正文兜底只服务没有拆解表的老版页面（如 kamept）。锚定「当前每小时…获取X个…值」
    // 这句结论：裸匹配「每小时」会抓到公式说明里的参数值
    // （carpt 正文有「做种每小时将得到如下的魔力值 0.5个魔力值 * 你的做种数」）
    const TEXT_HOURLY_RE = /当前每小时[^0-9]{0,12}?([\d,]+(?:\.\d+)?)\s*个\s*\S{1,3}值/;

    // 加成字符串 → 加成系数：'+6%'→0.06、'-100%'→-1、'300%'→3。
    // 取不到百分号返回 null 而不是 0，避免把「无法判定」伪装成「无加成」
    function parseBonusCoef(bonus) {
        const m = String(bonus === undefined || bonus === null ? '' : bonus)
            .match(/([+-]?\d+(?:\.\d+)?)\s*%/);
        return m ? parseFloat(m[1]) / 100 : null;
    }

    // 千分位数字可解；"--"、"无限"、"24.555 TB" 返回 null
    function parseNumber(text) {
        if (text === undefined || text === null) return null;
        const cleaned = String(text).replace(/[,\s]/g, '');
        if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
        const num = parseFloat(cleaned);
        return Number.isFinite(num) ? num : null;
    }

    const cellTexts = (row) => [...row.cells].map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());

    // mybonus.php「每小时获得的合计魔力值」拆解表 → 时魔字段。
    // 列按表头文本定位、不写死下标：nova 在「基本奖励」与「勋章加成」之间插了做种奖励/
    // 等级奖励加成等额外行；简繁混用（discfan 為「基礎魔力」「系數」）；
    // 币种随站点改名（zmpt 叫电力、luckpt 叫幸运星），而「基础X / 获得X / 系数」前缀稳定
    function extractHourlyMagic(doc) {
        const found = { medalBase: null, medalCoef: null, baseHourly: null, totalHourly: null };

        for (const table of doc.querySelectorAll('table')) {
            const rows = [...table.querySelectorAll('tr')].map(cellTexts).filter(cells => cells.length >= 4);
            const headerIndex = rows.findIndex(cells => cells.some(c => /^(基础|基礎)/.test(c))
                && cells.some(c => /^(获得|獲得)/.test(c))
                && cells.some(c => /^系[数數]$/.test(c)));
            if (headerIndex < 0) continue;

            const header = rows[headerIndex];
            const baseIdx = header.findIndex(c => /^(基础|基礎)/.test(c));
            const gainedIdx = header.findIndex(c => /^(获得|獲得)/.test(c));
            const coefIdx = header.findIndex(c => /^系[数數]$/.test(c));

            for (const cells of rows.slice(headerIndex + 1)) {
                const typeName = cells[0];
                // 勋章行可能拆成多行（luckpt 分「勋章佩戴加成」「勋章仓库加成」，
                // 系数列还是 "0.100 × 1.600 = 0.160" 算式），取先出现的一行
                if (found.medalBase === null && /^[勋勳]章/.test(typeName)) {
                    found.medalBase = parseNumber(cells[baseIdx]);
                    found.medalCoef = parseNumber(cells[coefIdx]);
                } else if (/^基本[奖獎]/.test(typeName)) {
                    found.baseHourly = parseNumber(cells[gainedIdx]);
                    // 「合计」只有首行带（其余行被 rowspan 合并），恒在该行末位；
                    // 下标不能按表头长度推算，个别站点表头省略「合计」这一格
                    if (cells.length - 1 > gainedIdx) found.totalHourly = parseNumber(cells[cells.length - 1]);
                }
            }
            break;
        }

        if (found.medalBase !== null || found.baseHourly !== null || found.totalHourly !== null) {
            return Object.assign({ source: 'table' }, found);
        }
        return extractHourlyMagicFromText(doc);
    }

    function extractHourlyMagicFromText(doc) {
        const text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ');
        const m = text.match(TEXT_HOURLY_RE);
        if (!m) return null;
        const num = parseNumber(m[1]);
        // 0 是合法事实（此刻没在做种），保留它才能给出「无法回本」而不是「未知」
        if (num === null || num < 0) return null;
        return { medalBase: null, medalCoef: null, baseHourly: num, totalHourly: num, source: 'text' };
    }

    // 回本估算：按 windowHours 小时持续做种，加成带来的增量魔力能否覆盖勋章价格。
    // 基数优先取勋章加成行的「基础魔力」；该行缺失（未佩戴勋章的站点不渲染）时退回
    // 总时魔，结果偏乐观，用 estimated 标记
    function computePayback(medal, hourly, windowHours) {
        if (!hourly) return null;
        const coef = parseBonusCoef(medal.bonusMultiplier);
        const price = typeof medal.price === 'number' ? medal.price : parseNumber(medal.price);
        if (coef === null || price === null) return null;

        const base = hourly.medalBase !== null ? hourly.medalBase
            : hourly.baseHourly !== null ? hourly.baseHourly : hourly.totalHourly;
        if (base === null) return null;

        const extraPerHour = base * coef;
        const gain = extraPerHour * windowHours;
        return {
            windowHours: windowHours,
            base: base,
            extraPerHour: extraPerHour,
            gain: gain,
            price: price,
            // 加成 ≤ 0（站点确实存在 -5% 这类负加成勋章）永远回不了本，不给时长
            hours: extraPerHour > 0 ? price / extraPerHour : null,
            canPayback: extraPerHour > 0 && gain >= price,
            estimated: hourly.medalBase === null,
        };
    }

    // 回本时长折算成「天」：上万小时看不出概念。24 小时内可回本的走 canPayback 分支，
    // 所以这里只会收到超过一天的值
    function formatPaybackDays(hours) {
        const days = hours / 24;
        if (days < 10) return days.toFixed(1) + ' 天';
        return Math.round(days).toLocaleString() + ' 天';
    }

    function paybackText(payback) {
        if (!payback) return '';
        if (payback.canPayback) return '✓ ' + payback.windowHours + 'h 内回本';
        if (payback.hours === null) return '无法回本';
        return (payback.estimated ? '≈' : '') + '回本 ' + formatPaybackDays(payback.hours);
    }

    // ===== 抓取 =====

    function request(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
                onload: resolve,
                onerror: reject,
            });
        });
    }

    const parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');

    // 省略号折叠的中间页（如「1 2 … 12 13 14」里的 3~11）首页没有链接，
    // 只有翻到相邻页才在分页条暴露，因此每抓一页都要重新发现
    function collectPageNumbers(doc) {
        const nums = new Set();
        doc.querySelectorAll('a[href]').forEach(a => {
            const m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/i);
            if (!m) return;
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > 0) nums.add(n);
        });
        return [...nums].sort((a, b) => a - b);
    }

    // 站点 URL 已带查询参数时（TTG 的 mall.php?cid=5）要用 &，拼 ?page= 会得到非法地址
    const buildPageUrl = (siteUrl, pageNum) =>
        siteUrl + (siteUrl.includes('?') ? '&' : '?') + 'page=' + pageNum;

    // 时魔页只是附属数据源：候选地址按序尝试，全部失败就返回 null，绝不影响勋章结果。
    // bonusPaths 为空数组表示该站确认没有可抓的时魔页，不发请求
    async function scrapeHourlyMagic(site) {
        const paths = site.bonusPaths || DEFAULT_BONUS_PATHS;
        if (paths.length === 0) return null;
        const origin = new URL(medalUrlOf(site)).origin;
        for (const path of paths) {
            try {
                const response = await request(origin + path);
                if (response.status !== 200) continue;
                const hourly = extractHourlyMagic(parseHtml(response.responseText));
                if (hourly) {
                    hourly.url = origin + path;
                    return hourly;
                }
            } catch (error) {
                // 附属数据，静默换下一个候选
            }
        }
        console.warn('[' + site.name + '] 时魔不可用：' + paths.join(' 、 '));
        return null;
    }

    // 单站：勋章页全部分页 →（确有可购买勋章时）时魔页 → 逐条附加回本结论
    async function scrapeSite(site) {
        const medals = await scrapeMedalPages(site);
        site.hourly = medals.some(medal => medal.canBuy) ? await scrapeHourlyMagic(site) : null;
        if (site.hourly) {
            medals.forEach(medal => {
                medal.payback = computePayback(medal, site.hourly, PAYBACK_WINDOW_HOURS);
            });
        }
        return medals;
    }

    async function scrapeMedalPages(site) {
        const medals = [];
        const seen = new Set();
        const fetched = new Set();
        const pending = new Set([0]);
        let pages = 0;
        let lastDoc = null;

        while (pending.size > 0 && pages < MAX_PAGES) {
            const pageNum = Math.min.apply(null, [...pending]);
            pending.delete(pageNum);
            if (fetched.has(pageNum)) continue;
            fetched.add(pageNum);

            const url = pageNum === 0 ? medalUrlOf(site) : buildPageUrl(medalUrlOf(site), pageNum);
            let response;
            try {
                response = await request(url);
            } catch (error) {
                console.error('[' + site.name + '] 第' + (pageNum + 1) + '页抓取失败:', error);
                break;
            }
            if (response.status !== 200) {
                if (pages === 0) console.error('[' + site.name + '] HTTP ' + response.status);
                break;
            }
            pages++;

            const doc = parseHtml(response.responseText);
            lastDoc = doc;
            for (const medal of extractMedalsFromDoc(doc, site)) {
                // 1 索引站点的首页常常同时被链成 ?page=1：按名称+价格去重
                const key = medal.name + '@' + medal.price;
                if (seen.has(key)) continue;
                seen.add(key);
                medal.page = pages;
                medal.pageUrl = url;
                medals.push(medal);
            }
            collectPageNumbers(doc).forEach(n => {
                if (!fetched.has(n)) pending.add(n);
            });
        }

        site.pageCount = pages;
        // 表格没适配的站点退化为「疑似购买按钮」提示，避免被当成「无勋章」
        if (medals.length === 0 && lastDoc) findPurchaseButtons(lastDoc, site);
        return medals;
    }

    // NexusPHP 勋章表一行内可能并排多枚勋章，按「一枚勋章占几列」分组成滑窗处理。
    // 列序与扩展 getColumnLayout() 同源：9 列与 10 列（多一列「勋章 ID」）的唯一区别
    // 是整体右移一位；靠表头文本猜列序不可行，表头里的「可购买时间」也含「购买」二字
    function getColumnLayout(tdsLength) {
        if (tdsLength <= 0) return null;
        if (tdsLength % 10 === 0) {
            return { stride: 10, nameIdx: 2, timeIdx: 3, durationIdx: 4, bonusIdx: 5, priceIdx: 6, stockIdx: 7, actionIdx: 8 };
        }
        if (tdsLength % 9 === 0) {
            return { stride: 9, nameIdx: 1, timeIdx: 2, durationIdx: 3, bonusIdx: 4, priceIdx: 5, stockIdx: 6, actionIdx: 7 };
        }
        return null;
    }

    function extractMedalsFromDoc(doc, site) {
        const medals = [];

        for (const table of doc.querySelectorAll('table')) {
            const rows = [...table.querySelectorAll('tr')];
            const headerIndex = rows.findIndex(row => {
                const text = (row.textContent || '').replace(/\s+/g, ' ');
                return /加成/.test(text) && /价格|價[格錢]/.test(text);
            });
            if (headerIndex < 0) continue;

            // 表头单元格数即一枚勋章占据的列数（列头缺失的站点退回按首个数据行长度推断）
            const headerStride = rows[headerIndex].cells.length;
            let layout = getColumnLayout(headerStride);

            for (const row of rows.slice(headerIndex + 1)) {
                const cells = [...row.cells];
                if (cells.length < 5) continue;
                if (!layout) {
                    layout = getColumnLayout(cells.length);
                    if (!layout) continue;
                }

                for (let i = 0; i + layout.stride - 1 < cells.length; i += layout.stride) {
                    const group = cells.slice(i, i + layout.stride);
                    const actionCell = group[layout.actionIdx];
                    if (!actionCell) continue;

                    // 可购买判定与扩展一致：只认 value/text 恰为「购买/購買」且未禁用的按钮，
                    // 「已购买」「已经购买」「需要更多魔力值」「已过可购买时间」都算不可购买；
                    // 老逻辑用子串匹配 + !input?.disabled，该格没有 input 时会误判成可购买
                    const buyButton = [...actionCell.querySelectorAll('input[type="submit"],input[type="button"],button')]
                        .find(el => {
                            const label = (el.value || el.textContent || '').trim();
                            return (label === '购买' || label === '購買') && !el.disabled;
                        });
                    if (!buyButton) continue;

                    const nameCell = group[layout.nameIdx];
                    const title = nameCell ? nameCell.querySelector('h1') : null;
                    const img = group[0] ? group[0].querySelector('img') : null;
                    const pick = (idx) => (group[idx] ? group[idx].textContent.replace(/\s+/g, ' ').trim() : '');
                    // 名称单元格常见为 <h1>名称</h1>描述……，取 h1 才不会被描述污染
                    const name = title ? title.textContent.trim()
                        : (nameCell ? nameCell.textContent.trim().split('\n')[0] : '未知勋章');
                    const rawDesc = nameCell ? nameCell.textContent.trim() : '';

                    medals.push({
                        site: site.name,
                        image: img && img.getAttribute('src')
                            ? new URL(img.getAttribute('src'), medalUrlOf(site)).href : '',
                        name: name,
                        description: title ? rawDesc.replace(title.textContent.trim(), '').trim() : '',
                        availableTime: pick(layout.timeIdx),
                        validity: pick(layout.durationIdx),
                        bonusMultiplier: pick(layout.bonusIdx),
                        price: parseNumber(pick(layout.priceIdx)) || 0,
                        stock: pick(layout.stockIdx),
                        canBuy: true,
                        giftFee: (actionCell.parentElement.textContent.match(/(?:手續費|手续费)[:：]\s*([\d.]+%?)/) || [])[1] || '',
                    });
                }
            }
            break;
        }
        return medals;
    }

    function findPurchaseButtons(doc, site) {
        const found = [];
        doc.querySelectorAll('button, a, input[type="button"], input[type="submit"]').forEach(btn => {
            const btnText = (btn.textContent || btn.value || '').trim();
            if (!/(购买|購買|Buy|消费)/i.test(btnText)) return;
            const holder = btn.closest('tr, div, li');
            const context = ((holder || {}).textContent || '').trim().substring(0, 100) || '无上下文信息';
            const excludePattern = /(不可|已经|已过)/i;
            const containsExcluded = excludePattern.test(btnText) || excludePattern.test(context);
            const isDisabled = btn.disabled || !!btn.closest('.disabled') || btn.style.display === 'none';
            if (!isDisabled && !containsExcluded) {
                found.push({ text: btnText, context: context, element: btn.outerHTML });
            }
        });
        if (found.length > 0) {
            console.warn('[' + site.name + '] 发现疑似购买按钮 (' + found.length + '个)');
            showPurchaseButtonWarning(site.name, medalUrlOf(site), found);
        }
    }

    // ===== 展示 =====

    function createUnsupportSection() {
        const container = document.createElement('div');
        container.style.cssText = 'margin:120px 20px 20px;padding:20px;border:1px solid #ffd700;border-radius:5px;background:#fffbe6;';

        const header = document.createElement('h2');
        header.textContent = '未支持站点（点击访问）';
        header.style.cssText = 'color:#856404;margin-top:0;';

        const list = document.createElement('div');
        list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:10px;';

        usupportUrls.forEach(site => {
            const link = document.createElement('a');
            link.href = site.url;
            link.textContent = site.name;
            link.target = '_blank';
            link.style.cssText = 'display:block;padding:8px;background:#fff3cd;border:1px solid #ffeeba;border-radius:4px;color:#856404;text-decoration:none;transition:all .2s;';
            link.addEventListener('mouseover', () => {
                link.style.backgroundColor = '#ffeeba';
                link.style.transform = 'translateY(-2px)';
            });
            link.addEventListener('mouseout', () => {
                link.style.backgroundColor = '#fff3cd';
                link.style.transform = 'none';
            });
            list.appendChild(link);
        });

        container.append(header, list);
        document.body.appendChild(container);
    }

    function showPurchaseButtonWarning(siteName, siteUrl, buttons) {
        const container = document.createElement('div');
        container.style.cssText = 'margin:20px;padding:20px;border:2px solid #ff4444;border-radius:5px;background:#fff3f3;position:relative;';

        const header = document.createElement('h3');
        header.textContent = '⚠️ ' + siteName + ' 检测到潜在购买按钮';
        header.style.color = '#cc0000';

        const link = document.createElement('a');
        link.href = siteUrl;
        link.textContent = '前往查看';
        link.style.cssText = 'position:absolute;top:10px;right:10px;padding:5px 10px;background:#ff4444;color:#fff;border-radius:3px;text-decoration:none;';

        const list = document.createElement('ul');
        list.style.paddingLeft = '20px';
        buttons.forEach((btn, index) => {
            const li = document.createElement('li');
            li.style.margin = '10px 0';
            const strong = document.createElement('strong');
            strong.textContent = '按钮 ' + (index + 1) + ': ';
            const textDiv = document.createElement('div');
            textDiv.textContent = btn.text;
            textDiv.style.color = '#666';
            const ctxDiv = document.createElement('div');
            ctxDiv.textContent = '上下文: ' + btn.context;
            ctxDiv.style.cssText = 'font-size:.9em;color:#999;';
            li.append(strong, textDiv, ctxDiv);
            list.appendChild(li);
        });

        container.append(header, link, list);
        document.body.appendChild(container);
    }

    // 站点头部的时魔徽标：千分位与魔力值同款；无勋章加成行时注明是总时魔估算
    function hourlyBadge(hourly) {
        if (!hourly) return null;
        const shown = hourly.totalHourly !== null ? hourly.totalHourly
            : hourly.baseHourly !== null ? hourly.baseHourly : hourly.medalBase;
        if (typeof shown !== 'number') return null;
        const span = document.createElement('span');
        span.style.cssText = 'font-size:.72em;color:#00838f;margin-left:10px;font-weight:normal;';
        span.textContent = '⚡时魔 ' + shown.toLocaleString(undefined, { maximumFractionDigits: 2 })
            + (hourly.medalBase === null ? '（总时魔估算）' : '');
        return span;
    }

    function displayTableOnPage(medals, site) {
        const container = document.createElement('div');
        container.style.cssText = 'margin:20px;padding:20px;border:1px solid #ccc;border-radius:5px;background:#f9f9f9;';

        const siteHeader = document.createElement('h2');
        siteHeader.textContent = site.name + ' (一共 ' + medals.length + ' 个勋章，'
            + (site.pageCount || 1) + ' 页) ';
        const badge = hourlyBadge(site.hourly);
        if (badge) siteHeader.appendChild(badge);

        const link = document.createElement('a');
        link.href = medalUrlOf(site);
        link.textContent = '访问站点';
        link.style.cssText = 'color:#007bff;text-decoration:none;margin-left:10px;font-weight:bold;';
        link.addEventListener('click', (event) => {
            event.preventDefault();
            window.open(medalUrlOf(site), '_blank');
        });
        siteHeader.appendChild(link);
        container.appendChild(siteHeader);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;margin-bottom:20px;';

        const headers = ['图片', '跳转', '名称', '描述', '可购买时间', '有效期', '加成', '价格', '库存', '手续费', '回本'];
        const headerRow = document.createElement('tr');
        headers.forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            th.style.cssText = 'border:1px solid #ddd;padding:8px;background:#f2f2f2;';
            headerRow.appendChild(th);
        });
        const thead = document.createElement('thead');
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        medals.forEach(medal => {
            const row = document.createElement('tr');
            if (medal.canBuy) {
                row.style.backgroundColor = '#e6ffe6';
                row.style.fontWeight = 'bold';
            }
            // 24 小时内可回本的再深一档，扫列表时一眼挑得出来
            if (medal.payback && medal.payback.canPayback) row.style.backgroundColor = '#c8f5c8';

            const startText = (medal.availableTime || '').split('~')[0].trim();
            if (startText && startText !== '不限') {
                const startTime = new Date(startText);
                if (!Number.isNaN(startTime.getTime()) && startTime > new Date()) {
                    row.style.backgroundColor = '#ffe6cc';
                    row.style.fontWeight = 'bold';
                }
            }

            const imgCell = document.createElement('td');
            if (medal.image) {
                const img = document.createElement('img');
                img.src = medal.image;
                img.width = 50;
                img.height = 50;
                imgCell.appendChild(img);
            }
            const jumpCell = document.createElement('td');
            const jump = document.createElement('a');
            jump.href = medal.pageUrl || medalUrlOf(site);
            jump.textContent = '打开';
            jump.target = '_blank';
            jumpCell.appendChild(jump);

            const values = [
                medal.name, medal.description, medal.availableTime, medal.validity,
                medal.bonusMultiplier, Number(medal.price).toLocaleString(), medal.stock,
                medal.giftFee, paybackText(medal.payback),
            ];
            row.append(imgCell, jumpCell, ...values.map(text => {
                const td = document.createElement('td');
                // textContent 而非 innerHTML：勋章名/描述来自站点页面，不能当 HTML 解析
                td.textContent = text;
                td.style.cssText = 'border:1px solid #ddd;padding:8px;';
                return td;
            }));
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        container.appendChild(table);
        document.body.appendChild(container);
    }

    // ===== 入口 =====

    async function scrapeAllSites() {
        const settled = await Promise.allSettled(newSITES.map(site => scrapeSite(site)));
        let total = 0;

        settled.forEach((result, index) => {
            const site = newSITES[index];
            // allSettled 返回的是 {status,value/reason} 外层对象，老版本把它当勋章
            // 对象分组，结果全部落在 undefined 键下
            if (result.status !== 'fulfilled') {
                console.error('[' + site.name + '] 抓取异常:', result.reason);
                return;
            }
            const medals = result.value;
            total += medals.length;
            if (medals.length === 0) return;

            const hourlyShown = site.hourly
                ? (site.hourly.totalHourly !== null ? site.hourly.totalHourly : site.hourly.baseHourly)
                : '未知';
            console.group(site.name + ' (共有 ' + medals.length + ' 个勋章，'
                + (site.pageCount || 1) + ' 页；时魔 ' + hourlyShown + ')');
            console.table(medals.map(medal => ({
                name: medal.name,
                bonus: medal.bonusMultiplier,
                price: medal.price,
                payback: paybackText(medal.payback),
                perHour: medal.payback ? Number(medal.payback.extraPerHour.toFixed(3)) : null,
            })));
            console.groupEnd();
            displayTableOnPage(medals, site);
        });

        return total;
    }

    window.addEventListener('load', function () {
        createUnsupportSection();

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'position:fixed;top:20px;right:20px;display:flex;gap:10px;z-index:1000;';

        const scrapeButton = document.createElement('button');
        scrapeButton.textContent = '开始抓取勋章';
        scrapeButton.style.cssText = 'padding:10px 20px;background:#007bff;color:#fff;border:none;border-radius:5px;cursor:pointer;';

        const hideButton = document.createElement('button');
        hideButton.textContent = '隐藏无背景色行';
        hideButton.style.cssText = 'padding:10px 20px;background:#28a745;color:#fff;border:none;border-radius:5px;cursor:pointer;';

        buttonContainer.append(scrapeButton, hideButton);
        document.body.appendChild(buttonContainer);

        scrapeButton.addEventListener('click', function () {
            scrapeButton.textContent = '抓取中...';
            scrapeButton.disabled = true;

            scrapeAllSites()
                .then(count => {
                    console.log('所有站点抓取完成，总共抓取到', count, '个勋章');
                    scrapeButton.textContent = '抓取完成';
                })
                .catch(error => {
                    console.error('抓取过程出错:', error);
                    scrapeButton.textContent = '抓取出错，重试';
                    scrapeButton.disabled = false;
                });
        });

        hideButton.addEventListener('click', function () {
            const tables = document.querySelectorAll('table');
            if (tables.length === 0) {
                console.error('未找到表格');
                return;
            }
            const isHidden = hideButton.textContent === '显示所有行';
            tables.forEach(table => {
                table.querySelectorAll('tbody tr').forEach(row => {
                    const background = row.style.backgroundColor;
                    if (!background || background === 'transparent') {
                        row.style.display = isHidden ? '' : 'none';
                    }
                });
            });
            hideButton.textContent = isHidden ? '隐藏无背景色行' : '显示所有行';
        });
    });
})();
