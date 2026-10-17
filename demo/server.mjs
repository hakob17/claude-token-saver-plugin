// Static server for the routing-proxy demo page (Railway sets PORT).
import http from "node:http";
import fs from "node:fs";

const page = fs.readFileSync(new URL("./index.html", import.meta.url));
http.createServer((req, res) => {
  if (req.url === "/healthz") return res.end("ok");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" });
  res.end(page);
}).listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log(`demo on :${process.env.PORT || 3000}`));
