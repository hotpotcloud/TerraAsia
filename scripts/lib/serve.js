// 本地静态服务：校验/截图脚本共用。
// 为什么不直接 file:// 打开？Vite 产物里是 ES module + fetch 相对路径，
// file:// 下会被 CORS 与路径规则卡住，必须走 http 才有代表性。
const http = require('http');
const path = require('path');
const fs = require('fs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * 把 dist 目录挂到 127.0.0.1 的随机端口。
 * @param {string} dir dist 绝对路径
 * @returns {Promise<{url: string, close: () => void}>}
 */
async function serveDist(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const p = path.join(root, rel);
    // 目录穿越防护：解析后的路径必须仍在 root 内
    if (p.startsWith(root) && fs.existsSync(p) && fs.statSync(p).isFile()) {
      res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
      fs.createReadStream(p).pipe(res);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => server.close(),
  };
}

/** 各脚本共用的浏览器启动参数：本机 Edge + 软件渲染（CI 无 GPU） */
const LAUNCH = {
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
};

module.exports = { serveDist, LAUNCH };
