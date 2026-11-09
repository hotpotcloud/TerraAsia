// Python 解释器包装：统一 scripts 里调用数据管线的入口。
// - 默认用 PATH 里的 python
// - 可用环境变量 PYTHON 指定具体解释器（本机常有多个 Python，numpy 只装在其中一个）
//   例: PYTHON=/d/Apps/python3.11.9/python npm run build
const { spawnSync } = require('child_process');

const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('用法: node scripts/py.js <脚本路径> [参数...]');
  process.exit(2);
}

const r = spawnSync(py, args, { stdio: 'inherit', shell: false });

if (r.error) {
  if (r.error.code === 'ENOENT') {
    console.error(`找不到 Python 解释器：${py}`);
    console.error('请安装 Python 3.9+，或用 PYTHON 环境变量指定解释器路径');
  } else {
    console.error(`启动 Python 失败：${r.error.message}`);
  }
  process.exit(2);
}

process.exit(r.status === null ? 1 : r.status);
