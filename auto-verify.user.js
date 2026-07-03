// ==UserScript==
// @name         AutoVerify Pro - 智能验证码自动识别填充
// @namespace    auto-verify-pro
// @version      2.1.0
// @description  整合三款验证码脚本优势 + ddddocr本地引擎：智能关键词匹配 + 多OCR引擎 + 手动规则 + 黑白名单 + 滑动/算术验证码 + 全事件触发
// @author       AutoVerify Pro
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.ocr.space
// @connect      api.jfbym.com
// @connect      www.jfbym.com
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  //  配置与常量
  // ══════════════════════════════════════════════════════════════

  const CONFIG = {
    // OCR 引擎选择: "ddddocr" | "ocrspace" | "jfbym" | "free"
    // ddddocr: 本地引擎，极速(~10ms)，无限次，需运行 ddddocr_server.py
    // ocrspace: 免费，25000次/月，无需注册（helloworld key）
    // jfbym: 云码，需Token，支持算术/滑块等复杂验证码
    // free: 第三方免费接口（不稳定，备用）
    defaultEngine: "ddddocr",

    // ocr.space 配置
    ocrspace: {
      apiKey: "helloworld", // 免费key，可替换为自己的
      apiUrl: "https://api.ocr.space/parse/image",
      language: "eng",
    },

    // 云码配置
    jfbym: {
      apiUrl: "https://www.jfbym.com/api/YmServer/customApi",
      token: "", // 在菜单中设置
      generalType: "10110", // 数英验证码
      mathType: "50106",    // 算术验证码 (calculate_ry)
    },

    // 免费接口配置（备用）
    free: {
      apiUrl: "http://0218886.xyz:2580/",
      generalEndpoint: "identify_GeneralCAPTCHA",
    },

    // ddddocr 本地引擎配置
    ddddocr: {
      apiUrl: "http://127.0.0.1:9898/ocr",
      healthUrl: "http://127.0.0.1:9898/health",
    },

    // 运行参数
    delay: 800,           // 初始延迟
    callCount: 0,
    MAX_CALLS: 50,        // 最大识别次数（防止无限循环）
    visibilityRetryDelay: 400,
    debounceDelay: 750,
    cacheLimit: 100,
  };

  // ══════════════════════════════════════════════════════════════
  //  多语言关键词（来自 auto-verify.user.js）
  // ══════════════════════════════════════════════════════════════

  const baseImageKeywords = [
    "captcha", "verify", "code", "auth", "validate", "seccode",
  ];

  const baseInputKeywords = [
    "captcha", "verify", "code", "auth", "validate", "seccode",
    "vcode", "imgcode", "image", "验证码", "校验码", "校驗碼",
    "驗證", "驗證碼", "图形码", "圖片驗證",
  ];

  const additionalKeywords = [
    "codigo", "código", "verificacion", "verificación", "autenticacion", "autenticación",
    "verification", "vérification", "valider", "authentification",
    "prüfen", "verifizieren", "überprüfung", "validieren", "authentifizierung",
    "verificacao", "verificação", "autenticacao", "autenticação",
    "codice", "verifica", "validazione", "autenticazione",
    "код", "проверка", "верификация", "капча",
    "コード", "認証", "認証コード", "確認コード", "検証",
    "코드", "인증", "캡차",
    "รหัส", "ยืนยัน", "ตรวจสอบ", "แคปชา",
    "رمز", "تحقق", "التحقق", "توثيق", "كابتشا",
  ];

  // 额外的中文验证码关键词（来自自动识别填充脚本）
  const extraCnKeywords = [
    "yzm", "Yzm", "YZM", "check", "Check", "CHECK",
    "random", "Random", "RANDOM", "veri", "Veri", "VERI",
    "看不清", "换一张",
  ];

  function buildKeywordRegex(list) {
    const escaped = list.map((str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(escaped.join("|"), "i");
  }

  const defaultImageKeywords = buildKeywordRegex([
    ...baseImageKeywords, ...additionalKeywords,
  ]);

  const defaultInputKeywords = buildKeywordRegex([
    ...baseInputKeywords, ...additionalKeywords, ...extraCnKeywords,
  ]);

  const defaultExcludedImageKeywords =
    /logo|icon|avatar|banner|qr|advert|loading|spinner|close|closebtn|search|flag|svg|images|donat|pay(?:ment)?/i;

  const defaultExcludedInputKeywords =
    /2fa|twofactor|totp|两步|二次|two.?step|authenticator|mfa|passcode|security.?code|recovery.?code|google.?auth|authy|backup/i;

  // ══════════════════════════════════════════════════════════════
  //  状态管理
  // ══════════════════════════════════════════════════════════════

  const State = {
    observer: null,
    callCount: 0,
    userImageKeywords: [],
    userInputKeywords: [],
    userExcludedImageKeywords: [],
    // 手动规则（来自自动识别填充脚本）
    localRules: [],
    preCode: "", // 前一次识别的图片base64，用于去重
    tempCode: "",
  };

  // ══════════════════════════════════════════════════════════════
  //  存储工具
  // ══════════════════════════════════════════════════════════════

  function gmGet(key, defaultVal) {
    try {
      const val = GM_getValue(key, defaultVal);
      return val !== undefined ? val : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  }

  function gmSet(key, val) {
    GM_setValue(key, val);
  }

  // ══════════════════════════════════════════════════════════════
  //  OCR 缓存（来自 auto-verify.user.js）
  // ══════════════════════════════════════════════════════════════

  function hashBase64(str) {
    let hash = 0;
    const len = Math.min(str.length, 500);
    for (let i = 0; i < len; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash | 0;
    }
    return "avp_" + hash;
  }

  function getCachedResult(key) {
    try {
      const data = JSON.parse(gmGet("avp_ocr_cache", "{}"));
      return data[key] || null;
    } catch (e) {
      return null;
    }
  }

  function setCachedResult(key, value) {
    try {
      const data = JSON.parse(gmGet("avp_ocr_cache", "{}"));
      data[key] = value;
      const keys = Object.keys(data);
      if (keys.length > CONFIG.cacheLimit) {
        delete data[keys[0]];
      }
      gmSet("avp_ocr_cache", JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  OCR 引擎
  // ══════════════════════════════════════════════════════════════

  /**
   * ocr.space 引擎（免费，无需Token）
   */
  function ocrSpaceRecognize(base64Data) {
    return new Promise((resolve, reject) => {
      let done = false;
      const safetyTimer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("ocr.space 请求超时（15s）"));
        }
      }, 15000);

      function finish(err, result) {
        if (done) return;
        done = true;
        clearTimeout(safetyTimer);
        if (err) reject(err);
        else resolve(result);
      }

      const payload =
        "base64Image=" + encodeURIComponent(base64Data) +
        "&language=" + CONFIG.ocrspace.language +
        "&isOverlayRequired=false";

      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.ocrspace.apiUrl,
        headers: {
          apikey: CONFIG.ocrspace.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: payload,
        timeout: 15000,
        onload: function (response) {
          try {
            const result = JSON.parse(response.responseText);
            if (
              result.OCRExitCode === 1 &&
              result.ParsedResults &&
              result.ParsedResults.length > 0
            ) {
              let text = result.ParsedResults[0].ParsedText;
              text = text.replace(/\s/g, "").trim();
              finish(null, text);
            } else {
              finish(new Error(
                "ocr.space 错误: " +
                (result.ErrorMessage || "ExitCode=" + result.OCRExitCode)
              ));
            }
          } catch (e) {
            finish(e);
          }
        },
        onerror: () => finish(new Error("ocr.space 网络请求失败")),
        ontimeout: () => finish(new Error("ocr.space 请求超时")),
      });
    });
  }

  /**
   * 云码引擎（需Token，支持复杂验证码类型）
   */
  function jfbymRecognize(base64Data, type) {
    const token = gmGet("jfbym_token", "");
    if (!token) {
      return Promise.reject(new Error("云码Token未设置，请通过菜单配置"));
    }
    const verifyType = type || CONFIG.jfbym.generalType;
    const safeToken = token.replace(/\+/g, "%2B");

    const payload = JSON.stringify({
      image: String(base64Data),
      type: verifyType,
      token: safeToken,
    });

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.jfbym.apiUrl,
        data: payload,
        headers: { "Content-Type": "application/json" },
        responseType: "json",
        timeout: 20000,
        onload: function (response) {
          try {
            const resp = response.response;
            if (resp.code == 10000) {
              const result = resp.data.data;
              resolve(result);
            } else if (resp.code == 10002) {
              reject(new Error("云码积分不足，请充值"));
            } else if (resp.code == 10003) {
              reject(new Error("云码Token错误，请检查配置"));
            } else {
              reject(new Error("云码错误: " + (resp.msg || resp.code)));
            }
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("云码网络请求失败")),
        ontimeout: () => reject(new Error("云码请求超时")),
      });
    });
  }

  /**
   * ddddocr 本地引擎（极速，无限次）
   */
  function ddddocrRecognize(base64Data) {
    const dataUrl = "data:image/png;base64," + base64Data;
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.ddddocr.apiUrl,
        data: JSON.stringify({ image: dataUrl }),
        headers: { "Content-Type": "application/json" },
        responseType: "json",
        timeout: 5000,
        onload: function (response) {
          try {
            const resp = response.response;
            if (resp && resp.result !== undefined) {
              resolve(resp.result);
            } else if (resp && resp.error) {
              reject(new Error("ddddocr: " + resp.error));
            } else {
              reject(new Error("ddddocr: 未知响应"));
            }
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("ddddocr 服务未运行，请启动 ddddocr_server.py")),
        ontimeout: () => reject(new Error("ddddocr 请求超时")),
      });
    });
  }

  /**
   * 检查 ddddocr 本地服务是否可用
   */
  function checkDdddocrAvailable() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: CONFIG.ddddocr.healthUrl,
        timeout: 2000,
        onload: function (response) {
          try {
            const resp = JSON.parse(response.responseText);
            resolve(resp.status === "ok");
          } catch (e) {
            resolve(false);
          }
        },
        onerror: () => resolve(false),
        ontimeout: () => resolve(false),
      });
    });
  }

  /**
   * 免费接口引擎（备用，不稳定）
   */
  function freeRecognize(base64Data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.free.apiUrl + CONFIG.free.generalEndpoint,
        data: JSON.stringify({ ImageBase64: String(base64Data) }),
        headers: { "Content-Type": "application/json" },
        responseType: "json",
        timeout: 15000,
        onload: function (response) {
          if (response.status === 200) {
            try {
              const result = response.response.result;
              resolve(result || "");
            } catch (e) {
              if (response.responseText.indexOf("触发限流策略") !== -1 ||
                  response.responseText.indexOf("接口请求频率过高") !== -1) {
                reject(new Error("免费接口限流"));
              } else {
                reject(new Error("免费接口解析失败"));
              }
            }
          } else {
            reject(new Error("免费接口HTTP " + response.status));
          }
        },
        onerror: () => reject(new Error("免费接口网络失败")),
        ontimeout: () => reject(new Error("免费接口超时")),
      });
    });
  }

  /**
   * 统一识别入口
   * @param {string} base64Data - 图片base64（不含data:image前缀）
   * @param {string} captchaType - "general" | "math"
   */
  function recognize(base64Data, captchaType) {
    const engine = gmGet("ocr_engine", CONFIG.defaultEngine);

    if (captchaType === "math") {
      // 算术验证码只支持云码
      return jfbymRecognize(base64Data, CONFIG.jfbym.mathType);
    }

    if (engine === "ddddocr") {
      return ddddocrRecognize(base64Data);
    } else if (engine === "jfbym") {
      return jfbymRecognize(base64Data, CONFIG.jfbym.generalType);
    } else if (engine === "free") {
      return freeRecognize(base64Data);
    } else {
      return ocrSpaceRecognize(base64Data);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  图片转 Base64（支持 img、canvas，跨域降级处理）
  // ══════════════════════════════════════════════════════════════

  function imgToBase64(imgElement) {
    return new Promise((resolve) => {
      const convert = () => {
        try {
          const canvas = document.createElement("canvas");
          const rect = imgElement.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.max(rect.width * dpr, 1);
          canvas.height = Math.max(rect.height * dpr, 1);
          const ctx = canvas.getContext("2d");
          if (dpr !== 1) ctx.scale(dpr, dpr);
          ctx.drawImage(imgElement, 0, 0, rect.width, rect.height);
          const dataUrl = canvas.toDataURL("image/png");
          resolve(dataUrl.split("base64,")[1]);
        } catch (e) {
          // 跨域污染
          console.warn("[AutoVerify Pro] 图片跨域无法转换:", imgElement.src.substring(0, 100));
          resolve(null);
        }
      };

      if (imgElement.complete && imgElement.naturalWidth > 0) {
        convert();
      } else {
        imgElement.addEventListener("load", convert, { once: true });
        imgElement.addEventListener("error", () => resolve(null), { once: true });
      }
    });
  }

  function canvasToBase64(canvasElement) {
    try {
      const dataUrl = canvasElement.toDataURL("image/png");
      return dataUrl.split("base64,")[1];
    } catch (e) {
      console.warn("[AutoVerify Pro] Canvas跨域无法转换");
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  验证码图片识别（来自自动识别填充脚本的 isCode 逻辑增强）
  // ══════════════════════════════════════════════════════════════

  function isPossibleCaptcha(img) {
    if (!img.src || img.offsetParent === null ||
        img.naturalWidth === 0 || img.naturalHeight === 0) {
      return false;
    }

    // 排除链接中的图片
    const anchor = img.closest("a");
    if (anchor) {
      const href = (anchor.getAttribute("href") || "").trim();
      if (href && href !== "#" && !/^javascript:/i.test(href)) {
        return false;
      }
    }

    const srcLower = img.src.toLowerCase();
    const altLower = (img.alt || "").toLowerCase();

    // 排除关键词检查
    if (State.userExcludedImageKeywords.length > 0) {
      if (State.userExcludedImageKeywords.some((kw) =>
        srcLower.includes(kw) || altLower.includes(kw)
      )) {
        return false;
      }
    }

    const isBase64Src = srcLower.startsWith("data:image/");
    if ((!isBase64Src && defaultExcludedImageKeywords.test(srcLower)) ||
        defaultExcludedImageKeywords.test(altLower)) {
      return false;
    }

    // 尺寸检查
    const rect = img.getBoundingClientRect();
    const isSizeLikely =
      rect.width > 10 && rect.width < 300 &&
      rect.height > 15 && rect.height < 100;

    // 关键词匹配
    let hasKeyword = defaultImageKeywords.test(srcLower);
    if (!hasKeyword && State.userImageKeywords.length > 0) {
      hasKeyword = State.userImageKeywords.some((kw) => srcLower.includes(kw));
    }

    let hasAltKeyword = /码|校验|碼/.test(altLower) ||
                        defaultImageKeywords.test(altLower);
    if (!hasAltKeyword && State.userImageKeywords.length > 0) {
      hasAltKeyword = State.userImageKeywords.some((kw) => altLower.includes(kw));
    }

    // 额外中文关键词检查
    const extraCnRegex = /yzm|check|random|veri|看不清|换一张/i;
    const allAttrs = [
      img.id, img.title, img.alt, img.name,
      img.className, img.src,
    ].join(" ").toLowerCase();
    const hasExtraCn = extraCnRegex.test(allAttrs);

    return (
      (isSizeLikely && (hasKeyword || hasAltKeyword || hasExtraCn)) ||
      (rect.width > 80 && rect.width < 150 &&
       rect.height > 15 && rect.height < 60)
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  输入框评分与筛选（来自 auto-verify.user.js）
  // ══════════════════════════════════════════════════════════════

  function getInputScore(input) {
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const placeholder = (input.placeholder || "").toLowerCase();

    let score = 0;

    if (/image|img|pic/.test(name)) score += 10;
    if (defaultInputKeywords.test(name)) score += 8;
    else if (defaultInputKeywords.test(id)) score += 5;
    else if (defaultInputKeywords.test(placeholder)) score += 3;

    // 额外中文关键词
    const extraCnRegex = /yzm|check|random|veri|看不清|换一张/i;
    if (extraCnRegex.test(name)) score += 6;
    else if (extraCnRegex.test(id)) score += 4;
    else if (extraCnRegex.test(placeholder)) score += 3;

    // 用户自定义关键词
    if (State.userInputKeywords.length > 0) {
      const matchName = State.userInputKeywords.some((kw) => name.includes(kw));
      const matchId = State.userInputKeywords.some((kw) => id.includes(kw));
      const matchPlaceholder = State.userInputKeywords.some((kw) => placeholder.includes(kw));
      if (score === 0 && (matchName || matchId || matchPlaceholder)) {
        if (matchName) score += 4;
        else if (matchId) score += 3;
        else score += 2;
      }
    }

    return score;
  }

  function isTwoFactorInput(input) {
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const placeholder = (input.placeholder || "").toLowerCase();

    if (
      defaultExcludedInputKeywords.test(name) ||
      defaultExcludedInputKeywords.test(id) ||
      defaultExcludedInputKeywords.test(placeholder)
    ) {
      return true;
    }

    let parent = input.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      const text = (parent.textContent || "").toLowerCase().substring(0, 120);
      if (/两步验证|二次验证|两步认证|双重验证|双因素|两步驗證|two.?factor|authenticator/i.test(text)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function isInputVisible(input) {
    if (!input) return false;
    const style = window.getComputedStyle(input);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (input.offsetParent === null && style.position !== "fixed" && style.position !== "absolute") {
      return false;
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════
  //  结果写入（整合多脚本的事件触发策略）
  // ══════════════════════════════════════════════════════════════

  function writeResult(input, text) {
    if (!text) return;
    text = text.replace(/\s+/g, "");

    // 使用 React/Vue 兼容的值设置方式
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    ).set;
    nativeInputValueSetter.call(input, text);

    // 触发完整事件链（来自自动识别填充脚本）
    const eventList = ["input", "change", "focus", "keypress", "keyup", "keydown", "select"];
    eventList.forEach((evtType) => {
      let evt;
      try {
        if (typeof InputEvent !== "undefined") {
          evt = new InputEvent(evtType, { bubbles: true, cancelable: true });
        } else {
          evt = new Event(evtType, { bubbles: true, cancelable: true });
        }
        input.dispatchEvent(evt);
      } catch (e) {
        // fallback
        input.dispatchEvent(new Event(evtType, { bubbles: true }));
      }
    });

    // 确保值被写入（某些框架会在事件中重置）
    nativeInputValueSetter.call(input, text);

    console.log(
      '[AutoVerify Pro] 写入: "' + text + '" → ' +
      (input.name || input.id || "input")
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  核心处理流程
  // ══════════════════════════════════════════════════════════════

  async function processCaptcha(img, input, captchaType) {
    const base64Data = await imgToBase64(img);
    if (!base64Data) return;

    // 去重：与上次识别的图片比较
    const codeHash = hashBase64(base64Data);
    if (codeHash === State.preCode) {
      console.log("[AutoVerify Pro] 图片未变化，跳过");
      return;
    }
    State.preCode = codeHash;

    // 缓存检查
    const cached = getCachedResult(codeHash);
    if (cached !== null) {
      console.log('[AutoVerify Pro] 缓存命中: "' + cached + '"');
      writeResult(input, cached);
      return;
    }

    console.log("[AutoVerify Pro] OCR 识别中...");
    try {
      const text = await recognize(base64Data, captchaType);
      if (text) {
        setCachedResult(codeHash, text);
        writeResult(input, text);
      }
    } catch (err) {
      console.warn("[AutoVerify Pro] OCR 失败:", err.message);

      // 引擎降级链：ddddocr → ocr.space → 0218886 free
      const engine = gmGet("ocr_engine", CONFIG.defaultEngine);
      if (engine === "ddddocr") {
        console.log("[AutoVerify Pro] ddddocr 失败，降级到 ocr.space...");
        try {
          const text2 = await ocrSpaceRecognize(base64Data);
          if (text2) {
            setCachedResult(codeHash, text2);
            writeResult(input, text2);
          } else {
            throw new Error("ocr.space 返回空");
          }
        } catch (err2) {
          console.warn("[AutoVerify Pro] ocr.space 降级失败:", err2.message);
          console.log("[AutoVerify Pro] 最终降级到 0218886 免费接口...");
          try {
            const text3 = await freeRecognize(base64Data);
            if (text3) {
              setCachedResult(codeHash, text3);
              writeResult(input, text3);
            }
          } catch (err3) {
            console.warn("[AutoVerify Pro] 所有引擎均失败:", err3.message);
          }
        }
      } else if (engine === "ocrspace") {
        console.log("[AutoVerify Pro] ocr.space 失败，降级到 0218886 免费接口...");
        try {
          const text2 = await freeRecognize(base64Data);
          if (text2) {
            setCachedResult(codeHash, text2);
            writeResult(input, text2);
          }
        } catch (err2) {
          console.warn("[AutoVerify Pro] 0218886 降级也失败:", err2.message);
        }
      } else if (engine === "jfbym" && gmGet("jfbym_token", "")) {
        console.log("[AutoVerify Pro] 降级到云码引擎重试...");
        try {
          const text2 = await jfbymRecognize(base64Data, CONFIG.jfbym.generalType);
          if (text2) {
            setCachedResult(codeHash, text2);
            writeResult(input, text2);
          }
        } catch (err2) {
          console.warn("[AutoVerify Pro] 云码降级也失败:", err2.message);
          console.log("[AutoVerify Pro] 最终降级到 0218886 免费接口...");
          try {
            const text3 = await freeRecognize(base64Data);
            if (text3) {
              setCachedResult(codeHash, text3);
              writeResult(input, text3);
            }
          } catch (err3) {
            console.warn("[AutoVerify Pro] 所有引擎均失败:", err3.message);
          }
        }
      }
    }
  }

  function findAndProcessCode(attempt) {
    if (attempt === void 0) attempt = 0;
    if (State.callCount >= CONFIG.MAX_CALLS) {
      if (State.observer) State.observer.disconnect();
      console.log("[AutoVerify Pro] 达到最大识别次数，停止");
      return;
    }

    // 检查黑白名单
    if (!shouldRunOnCurrentPage()) return;

    State.callCount++;

    // 1. 检查手动规则
    const rule = findMatchingRule();
    if (rule) {
      processByRule(rule);
      return;
    }

    // 2. 自动识别模式
    const inputsArray = Array.from(
      document.querySelectorAll(
        "input[type='text'], input[type='tel'], input:not([type])"
      )
    );

    const scoredInputs = [];
    inputsArray.forEach((inp) => {
      const score = getInputScore(inp);
      if (score > 0 && !isTwoFactorInput(inp)) {
        scoredInputs.push({ input: inp, score });
      }
    });
    scoredInputs.sort((a, b) => b.score - a.score);

    const keywordInputsAll = scoredInputs.map((si) => si.input);
    const visibleKeywordInputs = keywordInputsAll.filter(
      (inp) => isInputVisible(inp) && !inp.disabled && !inp.readOnly
    );

    if (visibleKeywordInputs.length === 0 && keywordInputsAll.length > 0 && attempt === 0) {
      setTimeout(() => findAndProcessCode(1), CONFIG.visibilityRetryDelay);
      return;
    }

    const keywordInputs = visibleKeywordInputs;
    if (keywordInputs.length === 0) return;

    // 查找验证码图片
    const imgs = Array.from(document.querySelectorAll("img")).filter(isPossibleCaptcha);
    // 也查找 canvas 验证码
    const canvases = Array.from(document.querySelectorAll("canvas")).filter((c) => {
      const rect = c.getBoundingClientRect();
      return rect.width > 30 && rect.width < 300 && rect.height > 15 && rect.height < 100;
    });

    if (imgs.length === 0 && canvases.length === 0) return;

    console.log(
      "[AutoVerify Pro] 发现 " + keywordInputs.length + " 个输入框, " +
      imgs.length + " 张图片, " + canvases.length + " 个Canvas"
    );

    const processedInputs = new Set();

    // 处理 img 验证码
    for (const img of imgs) {
      const imgRect = img.getBoundingClientRect();
      const imgCX = imgRect.left + imgRect.width / 2;
      const imgCY = imgRect.top + imgRect.height / 2;

      let bestInput = null;
      let bestWeight = Infinity;

      for (const inp of keywordInputs) {
        if (processedInputs.has(inp)) continue;
        const inpRect = inp.getBoundingClientRect();
        const inpCX = inpRect.left + inpRect.width / 2;
        const inpCY = inpRect.top + inpRect.height / 2;
        const dist = Math.hypot(imgCX - inpCX, imgCY - inpCY);

        let inpScore = 0;
        for (const si of scoredInputs) {
          if (si.input === inp) { inpScore = si.score; break; }
        }

        const weight = dist / (1 + inpScore * 50);
        if (weight < bestWeight) {
          bestWeight = weight;
          bestInput = inp;
        }
      }

      if (!bestInput) continue;

      const bestInpRect = bestInput.getBoundingClientRect();
      const bestDist = Math.hypot(
        imgCX - (bestInpRect.left + bestInpRect.width / 2),
        imgCY - (bestInpRect.top + bestInpRect.height / 2)
      );

      const viewportDiagonal = Math.hypot(window.innerWidth, window.innerHeight);
      if (bestDist > viewportDiagonal / 3) continue;

      processedInputs.add(bestInput);
      processCaptcha(img, bestInput, "general");

      // 监听图片刷新
      if (!img.__avpReloadAttached) {
        img.addEventListener("load", () => {
          setTimeout(() => processCaptcha(img, bestInput, "general"), 50);
        });
        img.__avpReloadAttached = true;
      }
    }

    // 处理 canvas 验证码
    for (const canvas of canvases) {
      if (keywordInputs.length === 0) break;
      // 找最近的未使用输入框
      let bestInput = keywordInputs[0];
      let bestDist = Infinity;
      for (const inp of keywordInputs) {
        if (processedInputs.has(inp)) continue;
        const cRect = canvas.getBoundingClientRect();
        const iRect = inp.getBoundingClientRect();
        const dist = Math.hypot(
          (cRect.left + cRect.width / 2) - (iRect.left + iRect.width / 2),
          (cRect.top + cRect.height / 2) - (iRect.top + iRect.height / 2)
        );
        if (dist < bestDist) {
          bestDist = dist;
          bestInput = inp;
        }
      }
      if (bestInput) {
        processedInputs.add(bestInput);
        const base64 = canvasToBase64(canvas);
        if (base64) {
          const codeHash = hashBase64(base64);
          if (codeHash !== State.preCode) {
            State.preCode = codeHash;
            const cached = getCachedResult(codeHash);
            if (cached) {
              writeResult(bestInput, cached);
            } else {
              recognize(base64, "general")
                .then((text) => {
                  if (text) {
                    setCachedResult(codeHash, text);
                    writeResult(bestInput, text);
                  }
                })
                .catch((err) => console.warn("[AutoVerify Pro] Canvas OCR 失败:", err.message));
            }
          }
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  手动规则系统（来自自动识别填充脚本）
  // ══════════════════════════════════════════════════════════════

  function loadRules() {
    State.localRules = gmGet("localRules", []);
  }

  function findMatchingRule() {
    const currentUrl = window.location.href;
    for (const rule of State.localRules) {
      // 支持 * 通配符
      const pattern = rule.url.replace(/\*/g, ".*");
      try {
        if (new RegExp("^" + pattern + "$").test(currentUrl)) {
          return rule;
        }
      } catch (e) {
        if (currentUrl.includes(rule.url)) return rule;
      }
    }
    return null;
  }

  function processByRule(rule) {
    const { img, input, type, captchaType, inputType } = rule;

    let imgElement = null;
    if (type === "img") {
      const imgs = document.getElementsByTagName("img");
      if (imgs[img]) imgElement = imgs[img];
    } else if (type === "canvas") {
      const canvases = document.getElementsByTagName("canvas");
      if (canvases[img]) imgElement = canvases[img];
    }

    let inputElement = null;
    const inputTag = inputType || "input";
    const inputs = document.getElementsByTagName(inputTag);
    if (inputs[input]) inputElement = inputs[input];

    if (imgElement && inputElement) {
      if (type === "canvas") {
        const base64 = canvasToBase64(imgElement);
        if (base64) {
          const codeHash = hashBase64(base64);
          if (codeHash !== State.preCode) {
            State.preCode = codeHash;
            const cached = getCachedResult(codeHash);
            if (cached) {
              writeResult(inputElement, cached);
            } else {
              recognize(base64, captchaType || "general")
                .then((text) => {
                  if (text) {
                    setCachedResult(codeHash, text);
                    writeResult(inputElement, text);
                  }
                })
                .catch((err) => console.warn("[AutoVerify Pro] 规则识别失败:", err.message));
            }
          }
        }
      } else {
        processCaptcha(imgElement, inputElement, captchaType || "general");
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  黑白名单系统（来自自动识别填充脚本）
  // ══════════════════════════════════════════════════════════════

  function shouldRunOnCurrentPage() {
    const url = window.location.href;
    const mode = gmGet("filter_mode", "blacklist");
    const blackList = gmGet("blackList", []);
    const whiteList = gmGet("whiteList", []);

    if (mode === "blacklist") {
      const inBlack = blackList.some((item) => url.includes(item));
      if (inBlack) {
        console.log("[AutoVerify Pro] 当前页面在黑名单中");
        return false;
      }
      return true;
    } else {
      const inWhite = whiteList.some((item) => url.includes(item));
      if (!inWhite) {
        console.log("[AutoVerify Pro] 当前页面不在白名单中");
        return false;
      }
      return true;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  防抖与初始化
  // ══════════════════════════════════════════════════════════════

  function debounce(func, delay) {
    let timer;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => func.apply(context, args), delay);
    };
  }

  function init() {
    loadRules();

    // 加载用户自定义关键词
    const saved = gmGet("avp_user_keywords", null);
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        State.userImageKeywords = arr
          .filter((kw) => kw.type === "image" && kw.purpose === "match" && kw.enabled)
          .map((kw) => kw.text.toLowerCase());
        State.userInputKeywords = arr
          .filter((kw) => kw.type === "input" && kw.purpose === "match" && kw.enabled)
          .map((kw) => kw.text.toLowerCase());
        State.userExcludedImageKeywords = arr
          .filter((kw) => kw.type === "image" && kw.purpose === "exclude" && kw.enabled)
          .map((kw) => kw.text.toLowerCase());
      } catch (e) { /* ignore */ }
    }

    // 加载云码Token到配置
    const jfbymToken = gmGet("jfbym_token", "");
    if (jfbymToken) {
      CONFIG.jfbym.token = jfbymToken;
    }

    findAndProcessCode();

    // MutationObserver 监听DOM变化
    const targetNode = document.body;
    if (!targetNode) {
      setTimeout(init, 500);
      return;
    }

    const debouncedFind = debounce(findAndProcessCode, CONFIG.debounceDelay);
    State.observer = new MutationObserver(debouncedFind);
    State.observer.observe(targetNode, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["src"],
    });

    // URL变化监听（SPA页面路由切换）
    let lastUrl = window.location.href;
    setInterval(() => {
      if (lastUrl !== window.location.href) {
        console.log("[AutoVerify Pro] URL变化，重新识别");
        lastUrl = window.location.href;
        State.callCount = 0;
        State.preCode = "";
        findAndProcessCode();
      }
    }, 500);

    const engine = gmGet("ocr_engine", CONFIG.defaultEngine);
    console.log(
      "[AutoVerify Pro] 已启动 · 引擎: " + engine +
      " · 规则数: " + State.localRules.length +
      " · 模式: " + gmGet("filter_mode", "blacklist")
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  用户关键词加载
  // ══════════════════════════════════════════════════════════════

  function loadUserKeywords() {
    const saved = gmGet("avp_user_keywords", null);
    if (!saved) return;
    try {
      const arr = JSON.parse(saved);
      State.userImageKeywords = arr
        .filter((kw) => kw.type === "image" && kw.purpose === "match" && kw.enabled)
        .map((kw) => kw.text.toLowerCase());
      State.userInputKeywords = arr
        .filter((kw) => kw.type === "input" && kw.purpose === "match" && kw.enabled)
        .map((kw) => kw.text.toLowerCase());
      State.userExcludedImageKeywords = arr
        .filter((kw) => kw.type === "image" && kw.purpose === "exclude" && kw.enabled)
        .map((kw) => kw.text.toLowerCase());
    } catch (e) { /* ignore */ }
  }

  // ══════════════════════════════════════════════════════════════
  //  菜单注册
  // ══════════════════════════════════════════════════════════════

  GM_registerMenuCommand("⚡ 切换OCR引擎 (当前: " +
    (gmGet("ocr_engine", CONFIG.defaultEngine) === "ddddocr" ? "ddddocr本地" :
     gmGet("ocr_engine", CONFIG.defaultEngine) === "ocrspace" ? "ocr.space免费" :
     gmGet("ocr_engine", CONFIG.defaultEngine) === "jfbym" ? "云码" : "免费接口") + ")",
    () => {
      const current = gmGet("ocr_engine", CONFIG.defaultEngine);
      let next;
      if (current === "ddddocr") next = "ocrspace";
      else if (current === "ocrspace") next = "jfbym";
      else if (current === "jfbym") next = "free";
      else next = "ddddocr";
      gmSet("ocr_engine", next);
      const names = { ddddocr: "ddddocr本地", ocrspace: "ocr.space免费", jfbym: "云码", free: "免费接口" };
      alert("OCR引擎已切换为: " + names[next] + "\n刷新页面生效");
    }
  );

  GM_registerMenuCommand("🔑 设置云码Token",
    () => {
      const current = gmGet("jfbym_token", "");
      const token = prompt("请输入云码Token（从 jfbym.com 获取）:", current);
      if (token !== null) {
        gmSet("jfbym_token", token.trim());
        alert("Token已保存");
      }
    }
  );

  GM_registerMenuCommand("🔑 设置 ocr.space API Key",
    () => {
      const current = gmGet("ocrspace_key", CONFIG.ocrspace.apiKey);
      const key = prompt(
        "请输入 ocr.space API Key:\n（默认 helloworld 免费key，注册可获25000次/月）\n注册地址: https://ocr.space/ocrapi",
        current
      );
      if (key !== null) {
        gmSet("ocrspace_key", key.trim());
        CONFIG.ocrspace.apiKey = key.trim();
        alert("API Key已保存");
      }
    }
  );

  GM_registerMenuCommand("📋 添加页面规则（手动指定验证码）",
    () => addManualRule()
  );

  GM_registerMenuCommand("📑 管理所有规则",
    () => manageRules()
  );

  GM_registerMenuCommand("🔄 切换过滤模式 (当前: " +
    (gmGet("filter_mode", "blacklist") === "blacklist" ? "黑名单" : "白名单") + ")",
    () => {
      const current = gmGet("filter_mode", "blacklist");
      const next = current === "blacklist" ? "whitelist" : "blacklist";
      gmSet("filter_mode", next);
      alert("已切换为" + (next === "blacklist" ? "黑名单" : "白名单") + "模式\n刷新页面生效");
    }
  );

  GM_registerMenuCommand("📝 管理黑/白名单",
    () => manageLists()
  );

  GM_registerMenuCommand("⚙️ 其他设置",
    () => otherSettings()
  );

  // ══════════════════════════════════════════════════════════════
  //  手动添加规则 UI（来自自动识别填充脚本）
  // ══════════════════════════════════════════════════════════════

  function addManualRule() {
    const ruleData = {
      url: window.location.href,
      img: "", input: "", inputType: "", type: "", captchaType: "",
    };

    topNotice("请在验证码图片上点击鼠标「右键」");

    document.oncontextmenu = function (e) {
      e.preventDefault();

      if (e.target.tagName === "IMG") {
        const imgList = document.getElementsByTagName("img");
        for (let i = 0; i < imgList.length; i++) {
          if (imgList[i] === e.target) {
            ruleData.img = i;
            ruleData.type = "img";
            break;
          }
        }
      } else if (e.target.tagName === "CANVAS") {
        const canvasList = document.getElementsByTagName("canvas");
        for (let i = 0; i < canvasList.length; i++) {
          if (canvasList[i] === e.target) {
            ruleData.img = i;
            ruleData.type = "canvas";
            break;
          }
        }
      }

      if (ruleData.img === "") {
        topNotice("选择有误，请重新点击验证码图片");
        return;
      }

      topNotice("请在验证码输入框上点击鼠标「左键」");

      document.onclick = function (e) {
        e.preventDefault();
        const inputList = document.getElementsByTagName("input");
        const textareaList = document.getElementsByTagName("textarea");

        if (e.target.tagName === "INPUT") {
          ruleData.inputType = "input";
          for (let i = 0; i < inputList.length; i++) {
            if (inputList[i] === e.target) {
              ruleData.input = (inputList[0] && (inputList[0].id === "_w_simile" || inputList[0].id === "black_node"))
                ? i - 1 : i;
              break;
            }
          }
        } else if (e.target.tagName === "TEXTAREA") {
          ruleData.inputType = "textarea";
          for (let i = 0; i < textareaList.length; i++) {
            if (textareaList[i] === e.target) {
              ruleData.input = i;
              break;
            }
          }
        }

        if (ruleData.input === "") {
          topNotice("选择有误，请重新点击输入框");
          return;
        }

        // 弹出选择验证码类型
        showRuleTypeDialog(ruleData);
        document.onclick = null;
      };
    };
  }

  function showRuleTypeDialog(ruleData) {
    const div = document.createElement("div");
    div.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; padding: 25px; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2); z-index: 9999999999;
      font-family: "Microsoft YaHei", Arial, sans-serif; width: 420px;
    `;
    div.innerHTML = `
      <h3 style="margin:0 0 15px;font-size:16px;color:#333;">添加验证码规则</h3>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:8px;font-size:14px;color:#333;">URL（支持*通配符）:</label>
        <input type="text" id="ruleUrl" value="${ruleData.url}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
      </div>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:8px;font-size:14px;color:#333;">验证码类型:</label>
        <label style="display:block;margin:5px 0;font-size:14px;">
          <input type="radio" name="captchaType" value="general" checked> 数/英验证码
        </label>
        <label style="display:block;margin:5px 0;font-size:14px;">
          <input type="radio" name="captchaType" value="math"> 算术验证码（需云码）
        </label>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="confirmBtn" style="flex:1;padding:10px;background:#409EFF;color:white;border:none;border-radius:6px;cursor:pointer;">确认</button>
        <button id="cancelBtn" style="flex:1;padding:10px;background:#f5f5f5;color:#666;border:1px solid #ddd;border-radius:6px;cursor:pointer;">取消</button>
      </div>
    `;
    document.body.appendChild(div);

    div.querySelector("#confirmBtn").onclick = () => {
      ruleData.url = div.querySelector("#ruleUrl").value.trim() || ruleData.url;
      ruleData.captchaType = div.querySelector('input[name="captchaType"]:checked').value;
      div.remove();

      // 保存规则
      const rules = gmGet("localRules", []);
      const existingIdx = rules.findIndex((r) => r.url === ruleData.url);
      if (existingIdx !== -1) rules[existingIdx] = ruleData;
      else rules.push(ruleData);
      gmSet("localRules", rules);
      State.localRules = rules;

      topNotice("规则添加成功");
      document.oncontextmenu = null;
      findAndProcessCode();
    };

    div.querySelector("#cancelBtn").onclick = () => {
      div.remove();
      document.oncontextmenu = null;
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  规则管理 UI
  // ══════════════════════════════════════════════════════════════

  function manageRules() {
    const div = document.createElement("div");
    div.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; padding: 20px; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2); z-index: 9999999999;
      width: 75%; max-height: 80vh; overflow: auto;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    `;

    const allRules = gmGet("localRules", []);

    div.innerHTML = `
      <div style="display:flex;align-items:center;margin-bottom:15px;">
        <h3 style="margin:0;flex-grow:1;font-size:18px;color:#333;">规则列表 (${allRules.length})</h3>
        <button id="closeBtn" style="width:30px;height:30px;border:1px solid #ddd;border-radius:50%;background:#f5f5f5;cursor:pointer;font-size:16px;">×</button>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <button id="exportBtn" style="padding:8px 16px;background:#E6A23C;color:white;border:none;border-radius:6px;cursor:pointer;">导出</button>
        <button id="importBtn" style="padding:8px 16px;background:#409EFF;color:white;border:none;border-radius:6px;cursor:pointer;">导入</button>
        <input type="file" id="importFile" accept=".json" style="display:none;">
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead style="background:#f8f9fa;">
          <tr>
            <th style="padding:8px;border-bottom:1px solid #ddd;text-align:left;">URL</th>
            <th style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">类型</th>
            <th style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">操作</th>
          </tr>
        </thead>
        <tbody id="rulesBody"></tbody>
      </table>
    `;
    document.body.appendChild(div);

    function renderRules() {
      const rules = gmGet("localRules", []);
      const body = div.querySelector("#rulesBody");
      body.innerHTML = "";
      rules.forEach((rule, i) => {
        const row = body.insertRow();
        row.innerHTML = `
          <td style="padding:8px;border-bottom:1px solid #eee;max-width:300px;overflow:hidden;text-overflow:ellipsis;">${rule.url}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${rule.captchaType === "math" ? "算术" : "数英"}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">
            <button class="del-btn" data-idx="${i}" style="color:#f44336;background:none;border:none;cursor:pointer;">删除</button>
          </td>
        `;
      });
      body.querySelectorAll(".del-btn").forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx);
          const rules = gmGet("localRules", []);
          rules.splice(idx, 1);
          gmSet("localRules", rules);
          State.localRules = rules;
          renderRules();
          topNotice("规则已删除");
        };
      });
    }
    renderRules();

    div.querySelector("#closeBtn").onclick = () => div.remove();

    div.querySelector("#exportBtn").onclick = () => {
      const rules = gmGet("localRules", []);
      const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "captcha_rules.json";
      a.click();
      URL.revokeObjectURL(url);
    };

    div.querySelector("#importBtn").onclick = () => div.querySelector("#importFile").click();
    div.querySelector("#importFile").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          const existing = gmGet("localRules", []);
          const merged = [...existing];
          imported.forEach((r) => {
            if (!merged.some((x) => x.url === r.url)) merged.push(r);
          });
          gmSet("localRules", merged);
          State.localRules = merged;
          renderRules();
          topNotice("导入成功");
        } catch (err) {
          topNotice("导入失败：格式错误");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  黑白名单管理 UI
  // ══════════════════════════════════════════════════════════════

  function manageLists() {
    const mode = gmGet("filter_mode", "blacklist");
    const list = gmGet(mode === "blacklist" ? "blackList" : "whiteList", []);

    const div = document.createElement("div");
    div.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; padding: 20px; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2); z-index: 9999999999;
      width: 500px; max-height: 70vh; overflow: auto;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    `;

    div.innerHTML = `
      <div style="display:flex;align-items:center;margin-bottom:15px;">
        <h3 style="margin:0;flex-grow:1;font-size:18px;color:#333;">${mode === "blacklist" ? "黑" : "白"}名单管理</h3>
        <button id="closeBtn" style="width:30px;height:30px;border:1px solid #ddd;border-radius:50%;background:#f5f5f5;cursor:pointer;font-size:16px;">×</button>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <input type="text" id="newItem" placeholder="输入URL关键词" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;">
        <button id="addBtn" style="padding:8px 16px;background:#409EFF;color:white;border:none;border-radius:6px;cursor:pointer;">添加</button>
        <button id="addCurrentBtn" style="padding:8px 16px;background:#67C23A;color:white;border:none;border-radius:6px;cursor:pointer;">当前页面</button>
      </div>
      <div id="listContainer" style="max-height:300px;overflow:auto;"></div>
    `;
    document.body.appendChild(div);

    function renderList() {
      const mode = gmGet("filter_mode", "blacklist");
      const list = gmGet(mode === "blacklist" ? "blackList" : "whiteList", []);
      const container = div.querySelector("#listContainer");
      container.innerHTML = list.map((item, i) => `
        <div style="display:flex;align-items:center;padding:8px;border-bottom:1px solid #eee;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;">${item}</span>
          <button class="rm-btn" data-idx="${i}" style="color:#f44336;background:none;border:none;cursor:pointer;">移除</button>
        </div>
      `).join("");
      container.querySelectorAll(".rm-btn").forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx);
          const key = mode === "blacklist" ? "blackList" : "whiteList";
          const list = gmGet(key, []);
          list.splice(idx, 1);
          gmSet(key, list);
          renderList();
        };
      });
    }
    renderList();

    div.querySelector("#closeBtn").onclick = () => div.remove();
    div.querySelector("#addBtn").onclick = () => {
      const input = div.querySelector("#newItem");
      const val = input.value.trim();
      if (!val) return;
      const key = gmGet("filter_mode", "blacklist") === "blacklist" ? "blackList" : "whiteList";
      const list = gmGet(key, []);
      if (!list.includes(val)) {
        list.push(val);
        gmSet(key, list);
        renderList();
        input.value = "";
      }
    };
    div.querySelector("#addCurrentBtn").onclick = () => {
      const url = window.location.href.split("?")[0];
      const key = gmGet("filter_mode", "blacklist") === "blacklist" ? "blackList" : "whiteList";
      const list = gmGet(key, []);
      if (!list.includes(url)) {
        list.push(url);
        gmSet(key, list);
        renderList();
        topNotice("已添加当前页面");
      }
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  其他设置 UI
  // ══════════════════════════════════════════════════════════════

  function otherSettings() {
    const div = document.createElement("div");
    div.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; padding: 20px; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2); z-index: 9999999999;
      width: 450px; font-family: "Microsoft YaHei", Arial, sans-serif;
    `;

    div.innerHTML = `
      <div style="display:flex;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;flex-grow:1;font-size:18px;color:#333;">其他设置</h3>
        <button id="closeBtn" style="width:30px;height:30px;border:1px solid #ddd;border-radius:50%;background:#f5f5f5;cursor:pointer;font-size:16px;">×</button>
      </div>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:8px;font-size:14px;color:#333;">初始延迟 (毫秒)</label>
        <div style="display:flex;gap:10px;">
          <input type="number" id="delayInput" value="${gmGet("startDelay", CONFIG.delay)}" min="0" step="100" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;">
          <button id="saveDelay" style="padding:8px 16px;background:#409EFF;color:white;border:none;border-radius:6px;cursor:pointer;">保存</button>
        </div>
        <p style="margin:5px 0 0;font-size:12px;color:#999;">页面加载后等待多久开始识别，默认 ${CONFIG.delay}ms</p>
      </div>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:8px;font-size:14px;color:#333;">清空OCR缓存</label>
        <button id="clearCache" style="padding:8px 16px;background:#f44336;color:white;border:none;border-radius:6px;cursor:pointer;">清空缓存</button>
      </div>
      <div style="margin-bottom:15px;">
        <label style="display:block;margin-bottom:8px;font-size:14px;color:#333;">恢复出厂设置</label>
        <button id="factoryReset" style="padding:8px 16px;background:#f44336;color:white;border:none;border-radius:6px;cursor:pointer;">重置全部</button>
      </div>
      <div style="background:#f0f9ff;padding:12px;border-radius:8px;font-size:13px;color:#666;">
        <b>OCR引擎说明：</b><br>
        • ddddocr 本地：极速(~10ms)，无限次，需运行 ddddocr_server.py<br>
        • ocr.space：免费，25000次/月，无需注册<br>
        • 云码：需Token，支持算术验证码，精度更高<br>
        • 免费接口：第三方，不稳定，仅备用<br>
        启动本地引擎: python ddddocr_server.py<br>
        注册ocr.space: https://ocr.space/ocrapi<br>
        注册云码: https://www.jfbym.com/
      </div>
    `;
    document.body.appendChild(div);

    div.querySelector("#closeBtn").onclick = () => div.remove();
    div.querySelector("#saveDelay").onclick = () => {
      const val = parseInt(div.querySelector("#delayInput").value);
      if (!isNaN(val) && val >= 0) {
        gmSet("startDelay", val);
        CONFIG.delay = val;
        topNotice("延迟已设置为 " + val + "ms");
      }
    };
    div.querySelector("#clearCache").onclick = () => {
      gmSet("avp_ocr_cache", "{}");
      State.preCode = "";
      topNotice("OCR缓存已清空");
    };
    div.querySelector("#factoryReset").onclick = () => {
      if (confirm("确定要清除所有设置和规则吗？此操作不可撤销！")) {
        GM_deleteValue("localRules");
        GM_deleteValue("blackList");
        GM_deleteValue("whiteList");
        GM_deleteValue("filter_mode");
        GM_deleteValue("ocr_engine");
        GM_deleteValue("jfbym_token");
        GM_deleteValue("ocrspace_key");
        GM_deleteValue("avp_ocr_cache");
        GM_deleteValue("avp_user_keywords");
        GM_deleteValue("startDelay");
        topNotice("已恢复出厂设置，刷新页面生效");
      }
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  通知提示
  // ══════════════════════════════════════════════════════════════

  function topNotice(text) {
    let notice = document.getElementById("avp-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "avp-notice";
      notice.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.8); color: white; padding: 10px 20px;
        border-radius: 8px; z-index: 99999999999; font-size: 14px;
        font-family: "Microsoft YaHei", Arial, sans-serif;
        transition: opacity 0.3s; max-width: 80%; text-align: center;
      `;
      document.body.appendChild(notice);
    }
    notice.textContent = text;
    notice.style.opacity = "1";
    notice.style.display = "block";
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => {
      notice.style.opacity = "0";
      setTimeout(() => { notice.style.display = "none"; }, 300);
    }, 3000);
  }

  // ══════════════════════════════════════════════════════════════
  //  启动
  // ══════════════════════════════════════════════════════════════

  // 使用用户设置的 ocr.space key
  const userOcrKey = gmGet("ocrspace_key", "");
  if (userOcrKey) {
    CONFIG.ocrspace.apiKey = userOcrKey;
  }

  // 使用用户设置的延迟
  const userDelay = gmGet("startDelay", null);
  if (userDelay !== null) {
    CONFIG.delay = userDelay;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(init, CONFIG.delay);
    });
  } else {
    setTimeout(init, CONFIG.delay);
  }
})();
