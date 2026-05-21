// ==UserScript==
// @name         AutoVerify - 验证码自动识别
// @namespace    auto-verify
// @version      1.0.0
// @description  自动识别页面上的验证码图片并填入输入框，支持中英文及多语言关键词
// @author       AutoVerify
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "av_ocr_result_cache";
  const OCR_API_KEY = "helloworld";
  const OCR_API_URL = "https://api.ocr.space/parse/image";

  const config = {
    delay: 1000,
    callCount: 0,
    MAX_CALLS: 30,
    userImageKeywords: [],
    userInputKeywords: [],
    userExcludedImageKeywords: [],
    defaultImageKeywords: /captcha|verify|code|auth|validate|seccode/i,
    defaultInputKeywords:
      /captcha|verify|code|auth|validate|seccode|vcode|imgcode|验证码|校验码|校驗碼|驗證|驗證碼|图形码|圖片驗證/i,
    defaultExcludedImageKeywords:
      /logo|icon|avatar|banner|qr|advert|loading|spinner|close|closebtn|search|flag|svg|images|donat|pay(?:ment)?/i,
    defaultExcludedInputKeywords:
      /2fa|twofactor|totp|两步|二次|two.?step|authenticator|mfa|passcode|security.?code|recovery.?code|google.?auth|authy|backup/i,
    visibilityRetryDelay: 400,
  };

  function buildKeywordRegex(list) {
    const escaped = list.map((str) =>
      str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    return new RegExp(escaped.join("|"), "i");
  }

  const baseImageKeywords = [
    "captcha",
    "verify",
    "code",
    "auth",
    "validate",
    "seccode",
  ];
  const baseInputKeywords = [
    "captcha",
    "verify",
    "code",
    "auth",
    "validate",
    "seccode",
    "vcode",
    "imgcode",
    "image",
    "验证码",
    "校验码",
    "校驗碼",
    "驗證",
    "驗證碼",
    "图形码",
    "圖片驗證",
  ];

  const additionalKeywords = [
    "codigo",
    "código",
    "verificacion",
    "verificación",
    "autenticacion",
    "autenticación",
    "verification",
    "vérification",
    "valider",
    "authentification",
    "prüfen",
    "verifizieren",
    "überprüfung",
    "validieren",
    "authentifizierung",
    "verificacao",
    "verificação",
    "autenticacao",
    "autenticação",
    "codice",
    "verifica",
    "validazione",
    "autenticazione",
    "код",
    "проверка",
    "верификация",
    "капча",
    "コード",
    "認証",
    "認証コード",
    "確認コード",
    "検証",
    "코드",
    "인증",
    "캡차",
    "รหัส",
    "ยืนยัน",
    "ตรวจสอบ",
    "แคปชา",
    "رمز",
    "تحقق",
    "التحقق",
    "توثيق",
    "كابتشا",
  ];

  config.defaultImageKeywords = buildKeywordRegex([
    ...baseImageKeywords,
    ...additionalKeywords,
  ]);
  config.defaultInputKeywords = buildKeywordRegex([
    ...baseInputKeywords,
    ...additionalKeywords,
  ]);

  function loadUserKeywords() {
    const saved = GM_getValue("av_user_keywords", null);
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        config.userImageKeywords = arr
          .filter(
            (kw) => kw.type === "image" && kw.purpose === "match" && kw.enabled,
          )
          .map((kw) => kw.text.toLowerCase());
        config.userInputKeywords = arr
          .filter(
            (kw) => kw.type === "input" && kw.purpose === "match" && kw.enabled,
          )
          .map((kw) => kw.text.toLowerCase());
        config.userExcludedImageKeywords = arr
          .filter(
            (kw) =>
              kw.type === "image" && kw.purpose === "exclude" && kw.enabled,
          )
          .map((kw) => kw.text.toLowerCase());
      } catch (e) {
        /* ignore corrupt data */
      }
    }
  }

  function hashBase64(str) {
    var hash = 0;
    var len = Math.min(str.length, 500);
    for (var i = 0; i < len; i++) {
      var c = str.charCodeAt(i);
      hash = (hash << 5) - hash + c;
      hash = hash | 0;
    }
    return "av_" + hash;
  }

  function getCachedResult(key) {
    try {
      var data = JSON.parse(GM_getValue(STORAGE_KEY, "{}"));
      return data[key] || null;
    } catch (e) {
      return null;
    }
  }

  function setCachedResult(key, value) {
    try {
      var data = JSON.parse(GM_getValue(STORAGE_KEY, "{}"));
      data[key] = value;
      var keys = Object.keys(data);
      if (keys.length > 100) {
        delete data[keys[0]];
      }
      GM_setValue(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  }

  function runOcr(base64Data) {
    return new Promise(function (resolve, reject) {
      var payload =
        "base64Image=" +
        encodeURIComponent(base64Data) +
        "&language=eng&isOverlayRequired=false";

      GM_xmlhttpRequest({
        method: "POST",
        url: OCR_API_URL,
        headers: {
          apikey: OCR_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: payload,
        timeout: 15000,
        onload: function (response) {
          try {
            var result = JSON.parse(response.responseText);
            if (
              result.OCRExitCode === 1 &&
              result.ParsedResults &&
              result.ParsedResults.length > 0
            ) {
              var text = result.ParsedResults[0].ParsedText;
              text = text.replace(/\s/g, "").trim();
              resolve(text);
            } else {
              reject(
                new Error(
                  "OCR API 错误: " +
                    (result.ErrorMessage || "ExitCode=" + result.OCRExitCode),
                ),
              );
            }
          } catch (e) {
            reject(e);
          }
        },
        onerror: function () {
          reject(new Error("OCR API 网络请求失败"));
        },
        ontimeout: function () {
          reject(new Error("OCR API 请求超时（15s）"));
        },
      });
    });
  }

  function imgToBase64(imgElement, callback) {
    if (imgElement.complete) {
      convertAndCallback(imgElement, callback);
    } else {
      imgElement.onload = function () {
        convertAndCallback(imgElement, callback);
      };
    }
  }

  function convertAndCallback(imgElement, callback) {
    var canvas = document.createElement("canvas");
    var rect = imgElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext("2d");
    if (dpr !== 1) {
      ctx.scale(dpr, dpr);
    }
    ctx.drawImage(imgElement, 0, 0, rect.width, rect.height);
    try {
      callback(canvas.toDataURL());
    } catch (e) {
      /* cross-origin images will throw */
    }
  }

  function isPossibleCaptcha(img) {
    if (
      !img.src ||
      img.offsetParent === null ||
      img.naturalWidth === 0 ||
      img.naturalHeight === 0
    ) {
      return false;
    }

    var anchor = img.closest("a");
    if (anchor) {
      var href = (anchor.getAttribute("href") || "").trim();
      if (href && href !== "#" && !/^javascript:/i.test(href)) {
        return false;
      }
    }

    var srcLower = img.src.toLowerCase();
    var altLower = (img.alt || "").toLowerCase();

    if (config.userExcludedImageKeywords.length > 0) {
      if (
        config.userExcludedImageKeywords.some(function (kw) {
          return srcLower.includes(kw) || altLower.includes(kw);
        })
      ) {
        return false;
      }
    }

    var isBase64Src = srcLower.startsWith("data:image/");
    if (
      (!isBase64Src && config.defaultExcludedImageKeywords.test(srcLower)) ||
      config.defaultExcludedImageKeywords.test(altLower)
    ) {
      return false;
    }

    var rect = img.getBoundingClientRect();
    var isSizeLikely =
      rect.width > 10 &&
      rect.width < 300 &&
      rect.height > 15 &&
      rect.height < 100;

    var hasKeyword = config.defaultImageKeywords.test(srcLower);
    if (!hasKeyword && config.userImageKeywords.length > 0) {
      hasKeyword = config.userImageKeywords.some(function (kw) {
        return srcLower.includes(kw);
      });
    }

    var hasAltKeyword =
      /码|校验|碼/.test(altLower) || config.defaultImageKeywords.test(altLower);
    if (!hasAltKeyword && config.userImageKeywords.length > 0) {
      hasAltKeyword = config.userImageKeywords.some(function (kw) {
        return altLower.includes(kw);
      });
    }

    return (
      (isSizeLikely && (hasKeyword || hasAltKeyword)) ||
      (rect.width > 80 &&
        rect.width < 150 &&
        rect.height > 15 &&
        rect.height < 60)
    );
  }

  function getInputScore(input) {
    var name = (input.name || "").toLowerCase();
    var id = (input.id || "").toLowerCase();
    var placeholder = (input.placeholder || "").toLowerCase();

    var score = 0;

    if (/image|img|pic/.test(name)) {
      score += 10;
    }
    if (config.defaultInputKeywords.test(name)) {
      score += 8;
    } else if (config.defaultInputKeywords.test(id)) {
      score += 5;
    } else if (config.defaultInputKeywords.test(placeholder)) {
      score += 3;
    }

    if (config.userInputKeywords.length > 0) {
      var userMatchName = config.userInputKeywords.some(function (kw) {
        return name.includes(kw);
      });
      var userMatchId = config.userInputKeywords.some(function (kw) {
        return id.includes(kw);
      });
      var userMatchPlaceholder = config.userInputKeywords.some(function (kw) {
        return placeholder.includes(kw);
      });
      if (
        score === 0 &&
        (userMatchName || userMatchId || userMatchPlaceholder)
      ) {
        if (userMatchName) score += 4;
        else if (userMatchId) score += 3;
        else score += 2;
      }
    }

    return score;
  }

  function isTwoFactorInput(input) {
    var name = (input.name || "").toLowerCase();
    var id = (input.id || "").toLowerCase();
    var placeholder = (input.placeholder || "").toLowerCase();

    if (
      config.defaultExcludedInputKeywords.test(name) ||
      config.defaultExcludedInputKeywords.test(id) ||
      config.defaultExcludedInputKeywords.test(placeholder)
    ) {
      return true;
    }

    var parent = input.parentElement;
    for (var i = 0; i < 3 && parent; i++) {
      var text = (parent.textContent || "").toLowerCase().substring(0, 120);
      if (
        /两步验证|二次验证|两步认证|双重验证|双因素|两步驗證|two.?factor|authenticator/i.test(
          text,
        )
      ) {
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
  }

  function isInputVisible(input) {
    if (!input) return false;
    var style = window.getComputedStyle(input);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    var rect = input.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    if (
      input.offsetParent === null &&
      style.position !== "fixed" &&
      style.position !== "absolute"
    ) {
      return false;
    }
    return true;
  }

  function processCaptcha(img, input) {
    imgToBase64(img, function (base64Data) {
      if (!base64Data) return;
      var cacheKey = hashBase64(base64Data);
      var cached = getCachedResult(cacheKey);
      if (cached !== null) {
        input.value = cached;
        input.dispatchEvent(
          new Event("input", { bubbles: true, cancelable: true }),
        );
        input.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true }),
        );
        console.log(
          '[AutoVerify] OCR(缓存命中): "' +
            cached +
            '" → ' +
            (input.name || input.id || "input"),
        );
        return;
      }
      console.log("[AutoVerify] OCR 识别中...");
      runOcr(base64Data)
        .then(function (text) {
          if (!text) return;
          setCachedResult(cacheKey, text);
          input.value = text;
          input.dispatchEvent(
            new Event("input", { bubbles: true, cancelable: true }),
          );
          input.dispatchEvent(
            new Event("change", { bubbles: true, cancelable: true }),
          );
          console.log(
            '[AutoVerify] OCR 完成: "' +
              text +
              '" → ' +
              (input.name || input.id || "input"),
          );
        })
        .catch(function (err) {
          console.warn("[AutoVerify] OCR 失败:", err);
        });
    });
  }

  function findAndProcessCode(attempt) {
    if (attempt === void 0) attempt = 0;
    if (config.callCount >= config.MAX_CALLS) {
      if (config.observer) config.observer.disconnect();
      return;
    }
    config.callCount++;

    var inputsArray = Array.from(
      document.querySelectorAll(
        "input[type='text'], input[type='tel'], input:not([type])",
      ),
    );

    var scoredInputs = [];
    inputsArray.forEach(function (inp) {
      var score = getInputScore(inp);
      if (score > 0 && !isTwoFactorInput(inp)) {
        scoredInputs.push({ input: inp, score: score });
      }
    });
    scoredInputs.sort(function (a, b) {
      return b.score - a.score;
    });

    var keywordInputsAll = scoredInputs.map(function (si) {
      return si.input;
    });

    var visibleKeywordInputs = keywordInputsAll.filter(function (inp) {
      return isInputVisible(inp) && !inp.disabled && !inp.readOnly;
    });
    if (
      visibleKeywordInputs.length === 0 &&
      keywordInputsAll.length > 0 &&
      attempt === 0
    ) {
      setTimeout(function () {
        findAndProcessCode(1);
      }, config.visibilityRetryDelay);
      return;
    }

    var keywordInputs = visibleKeywordInputs;
    if (keywordInputs.length === 0) return;

    var imgs = Array.from(document.querySelectorAll("img")).filter(
      isPossibleCaptcha,
    );
    if (imgs.length === 0) return;

    console.log(
      "[AutoVerify] 发现 " +
        keywordInputs.length +
        " 个关键词输入框, " +
        imgs.length +
        " 张验证码图片",
    );
    keywordInputs.forEach(function (inp, idx) {
      var inpScore = 0;
      for (var si = 0; si < scoredInputs.length; si++) {
        if (scoredInputs[si].input === inp) {
          inpScore = scoredInputs[si].score;
          break;
        }
      }
      console.log(
        "  [Input " +
          idx +
          '] name="' +
          inp.name +
          '" id="' +
          inp.id +
          '" score=' +
          inpScore +
          ' placeholder="' +
          inp.placeholder +
          '"',
      );
    });
    imgs.forEach(function (im, idx) {
      console.log(
        "  [Image " +
          idx +
          '] src="' +
          im.src.substring(0, 120) +
          '" size=' +
          im.width +
          "x" +
          im.height,
      );
    });

    var processedInputs = new Set();

    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var imgRect = img.getBoundingClientRect();
      var imgCX = imgRect.left + imgRect.width / 2;
      var imgCY = imgRect.top + imgRect.height / 2;

      var bestInput = null;
      var bestWeight = Infinity;

      for (var j = 0; j < keywordInputs.length; j++) {
        var inp = keywordInputs[j];
        if (processedInputs.has(inp)) continue;
        var inpRect = inp.getBoundingClientRect();
        var inpCX = inpRect.left + inpRect.width / 2;
        var inpCY = inpRect.top + inpRect.height / 2;
        var dist = Math.hypot(imgCX - inpCX, imgCY - inpCY);

        var inpScore = 0;
        for (var si = 0; si < scoredInputs.length; si++) {
          if (scoredInputs[si].input === inp) {
            inpScore = scoredInputs[si].score;
            break;
          }
        }

        var weight = dist / (1 + inpScore * 50);

        if (weight < bestWeight) {
          bestWeight = weight;
          bestInput = inp;
        }
      }

      if (!bestInput) continue;

      var bestInpRect = bestInput.getBoundingClientRect();
      var bestDist = Math.hypot(
        imgCX - (bestInpRect.left + bestInpRect.width / 2),
        imgCY - (bestInpRect.top + bestInpRect.height / 2),
      );

      var viewportDiagonal = Math.hypot(window.innerWidth, window.innerHeight);
      if (bestDist > viewportDiagonal / 3) {
        console.log(
          '[AutoVerify] 图片 "' +
            img.src.substring(0, 80) +
            '" 距最近输入框 ' +
            bestDist.toFixed(0) +
            "px，视为不相关，跳过配对",
        );
        continue;
      }

      processedInputs.add(bestInput);
      processCaptcha(img, bestInput);

      if (!img.__avReloadAttached) {
        (function (capturedImg, capturedInput) {
          capturedImg.addEventListener("load", function () {
            setTimeout(function () {
              processCaptcha(capturedImg, capturedInput);
            }, 50);
          });
        })(img, bestInput);
        img.__avReloadAttached = true;
      }
    }
  }

  function debounce(func, delay) {
    var timer;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        func.apply(context, args);
      }, delay);
    };
  }

  function init() {
    loadUserKeywords();
    findAndProcessCode();

    var targetNode = document.body;
    if (!targetNode) {
      setTimeout(init, 500);
      return;
    }

    var debouncedFind = debounce(findAndProcessCode, 750);
    var observer = new MutationObserver(debouncedFind);
    observer.observe(targetNode, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["src"],
    });
    config.observer = observer;

    console.log(
      "[AutoVerify] 已启动 · OCR: ocr.space 免费API | 图片关键词: " +
        config.defaultImageKeywords.source.substring(0, 80) +
        "... | 输入框关键词: " +
        config.defaultInputKeywords.source.substring(0, 80) +
        "...",
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(init, config.delay);
    });
  } else {
    setTimeout(init, config.delay);
  }
})();
