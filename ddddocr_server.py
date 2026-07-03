# ddddocr 本地验证码识别服务
# 用法: python ddddocr_server.py
# 默认监听 http://127.0.0.1:9898
# POST /ocr  body: {"image": "<base64>"}  →  {"result": "xxxx"}

import sys, os, time, base64, io
sys.stdout.reconfigure(encoding="utf-8")
os.environ["PYTHONIOENCODING"] = "utf-8"

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import ddddocr
from PIL import Image

PORT = 9898

print(f"Loading ddddocr model...", flush=True)
t0 = time.time()
ocr = ddddocr.DdddOcr(show_ad=False)
print(f"Model loaded in {time.time()-t0:.3f}s", flush=True)

class OCRHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/ocr":
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
            result = ocr.classification(img_bytes)

            resp = json.dumps({"result": result, "time_ms": 0}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        except Exception as e:
            resp = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

    def do_GET(self):
        if self.path == "/health":
            resp = json.dumps({"status": "ok"}).encode("utf-8")
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
        # 静默日志（可注释掉以查看请求日志）
        pass

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), OCRHandler)
    print(f"ddddocr server running on http://127.0.0.1:{PORT}", flush=True)
    print(f"  POST /ocr   body: {{\"image\": \"<base64>\"}} -> {{\"result\": \"xxxx\"}}", flush=True)
    print(f"  GET  /health -> {{\"status\": \"ok\"}}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
        server.shutdown()
