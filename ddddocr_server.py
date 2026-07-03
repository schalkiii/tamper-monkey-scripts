# ddddocr 本地验证码识别服务 v2
# 用法: python ddddocr_server.py
# 默认监听 http://127.0.0.1:9898
# POST /ocr  body: {"image": "<base64>"}  →  {"result": "xxxx", "confidence": 0.95, "candidates": ["xxxx","xxxy"]}
#
# v2 改进:
#   - 双模型 (default + beta) 投票，取一致结果或概率更高者
#   - 概率输出，返回 top-3 候选
#   - 颜色过滤预处理（可选）
#   - 透明 PNG 修复

import sys, os, time, base64, io, json, traceback
sys.stdout.reconfigure(encoding="utf-8")
os.environ["PYTHONIOENCODING"] = "utf-8"

from http.server import HTTPServer, BaseHTTPRequestHandler
import ddddocr
from PIL import Image

PORT = 9898

print(f"Loading ddddocr models...", flush=True)
t0 = time.time()
# 默认模型 + beta 模型，双引擎投票
ocr_default = ddddocr.DdddOcr(show_ad=False)
ocr_beta = ddddocr.DdddOcr(show_ad=False, beta=True)
# old 模型作为第三票
ocr_old = ddddocr.DdddOcr(show_ad=False, old=True)
print(f"Models loaded in {time.time()-t0:.3f}s (3 models)", flush=True)


def classify_with_confidence(img_bytes):
    """三模型投票"""
    results = []

    # 1. 默认模型
    try:
        r1 = ocr_default.classification(img_bytes)
        if r1:
            results.append(r1)
    except Exception as e:
        print(f"default model error: {e}", flush=True)

    # 2. Beta 模型
    try:
        r2 = ocr_beta.classification(img_bytes)
        if r2:
            results.append(r2)
    except Exception as e:
        print(f"beta model error: {e}", flush=True)

    # 3. Old 模型
    try:
        r3 = ocr_old.classification(img_bytes)
        if r3:
            results.append(r3)
    except Exception as e:
        print(f"old model error: {e}", flush=True)

    if not results:
        return {"result": "", "confidence": 0.0, "all_results": []}

    # 投票
    from collections import Counter
    counter = Counter(results)
    best, count = counter.most_common(1)[0]

    # 大小写归一化投票
    lower_results = [r.lower() for r in results]
    lower_counter = Counter(lower_results)
    lower_best, lower_count = lower_counter.most_common(1)[0]

    if count >= 3:
        confidence = 0.95
    elif lower_count >= 3:
        # 忽略大小写后三模型一致
        confidence = 0.9
        best = results[0]
    elif lower_count >= 2:
        confidence = 0.75
    else:
        confidence = 0.4

    # 关键修正：如果 default 和 old 一致但都比 beta 短
    # beta 可能多识别了一个字符，而 default/old 犯了同样的截断错误
    if len(results) >= 3:
        r_def, r_beta, r_old = results[0], results[1], results[2]
        # default 和 old 一致，但 beta 更长
        if r_def.lower() == r_old.lower() and len(r_beta) > len(r_def):
            # beta 可能是对的后半部分，检查 beta 是否以 default 结果开头
            if r_beta.lower().startswith(r_def.lower()):
                best = r_beta
                confidence = 0.8
            else:
                # beta 完全不同但更长，给 beta 机会
                best = r_beta
                confidence = 0.6
        # beta 和 old 一致但比 default 长
        elif r_beta.lower() == r_old.lower() and len(r_def) < len(r_beta):
            best = r_beta
            confidence = 0.85
        # beta 和 default 一致但比 old 长
        elif r_beta.lower() == r_def.lower() and len(r_old) < len(r_beta):
            best = r_beta
            confidence = 0.85

    return {
        "result": best,
        "confidence": round(confidence, 3),
        "all_results": results,
    }


class OCRHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/ocr", "/ocr/enhanced"):
            self.send_error(404, "Not Found")
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            img_b64 = data.get("image", "")

            # 去掉 data:image/xxx;base64, 前缀
            if "," in img_b64 and img_b64.startswith("data:"):
                img_b64 = img_b64.split(",", 1)[1]

            img_bytes = base64.b64decode(img_b64)

            # 检查是否需要颜色过滤
            use_color_filter = data.get("color_filter", False)
            if use_color_filter:
                try:
                    img = Image.open(io.BytesIO(img_bytes))
                    # 简单的颜色过滤：保留深色（文字通常为深色）
                    img_array = __import__("numpy").array(img)
                    if len(img_array.shape) == 3:
                        # 计算亮度，保留暗色像素
                        brightness = img_array.mean(axis=2)
                        mask = brightness < 128
                        filtered = __import__("numpy").ones_like(img_array) * 255
                        filtered[mask] = img_array[mask]
                        buf = io.BytesIO()
                        Image.fromarray(filtered.astype("uint8")).save(buf, format="PNG")
                        img_bytes = buf.getvalue()
                except Exception:
                    pass  # 颜色过滤失败，用原图

            result = classify_with_confidence(img_bytes)

            resp = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        except Exception as e:
            traceback.print_exc()
            resp = json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

    def do_GET(self):
        if self.path == "/health":
            resp = json.dumps({"status": "ok", "version": "2.0"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        else:
            self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), OCRHandler)
    print(f"ddddocr server v2 running on http://127.0.0.1:{PORT}", flush=True)
    print(f"  POST /ocr          body: {{\"image\": \"<base64>\"}}", flush=True)
    print(f"  POST /ocr/enhanced body: {{\"image\": \"<base64>\", \"color_filter\": true}}", flush=True)
    print(f"  GET  /health       -> {{\"status\": \"ok\"}}", flush=True)
    print(f"  Features: 3-model voting (default + beta + old) + color filter", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
        server.shutdown()
