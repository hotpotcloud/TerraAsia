// 产物定位：统一 scripts/ 下各校验脚本找 dist 产物的方式
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');

/**
 * 解析要校验的 HTML 产物路径。
 * @param {string} [arg] 命令行传入的路径；为空时自动取 dist/ 下唯一的 .html
 * @returns {string|null} 绝对路径；找不到或不唯一时返回 null
 */
function resolveHtml(arg) {
  if (arg) {
    const p = path.resolve(arg);
    return fs.existsSync(p) ? p : null;
  }
  if (!fs.existsSync(DIST)) return null;
  const files = fs.readdirSync(DIST).filter((f) => f.toLowerCase().endsWith('.html'));
  return files.length === 1 ? path.join(DIST, files[0]) : null;
}

/** 找不到产物时的统一提示与退出码 */
function failNoArtifact() {
  console.error('未找到产物：请先执行 npm run build，或显式传入产物目录');
  process.exit(2);
}

/**
 * 解析要校验的前端产物目录（Vite 构建出来的整个静态站点）。
 * @param {string} [arg] 命令行传入的目录；为空时用 dist/
 * @returns {string|null}
 */
function resolveDist(arg) {
  const p = arg ? path.resolve(arg) : DIST;
  if (!fs.existsSync(p)) return null;
  if (!fs.existsSync(path.join(p, 'index.html'))) return null;
  return p;
}

module.exports = { ROOT, DIST, resolveHtml, resolveDist, failNoArtifact };
