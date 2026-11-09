#!/usr/bin/env bash
# TerraAsia 服务器一次性初始化（在目标服务器上以 root 执行）
#
#   bash deploy/setup-server.sh [站点目录] [站点端口]
#
#   bash deploy/setup-server.sh                     # /var/www/terra-asia : 8159
#   bash deploy/setup-server.sh /data/www/ta 9000   # 自定义目录与端口
#
# 做四件事：装 nginx + rsync、建发布目录、写站点配置、启动服务。
# 幂等：可重复执行；已存在的发布目录不会被覆盖。
# 端口注意：这里的端口是「站点端口」（nginx 监听），SSH 端口与此无关；
#          改了端口要同步 GitHub 仓库的 Variable `SITE_PORT`。
set -euo pipefail

APP_DIR="${1:-/var/www/terra-asia}"
APP_PORT="${2:-8159}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="$HERE/nginx/terra-asia.conf"
CONF_DST="/etc/nginx/conf.d/terra-asia.conf"

log() { printf '\033[36m[setup]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 或 sudo 运行"
[ -f "$CONF_SRC" ] || die "找不到 nginx 配置：$CONF_SRC"

# ---------- 1. 装依赖 ----------
if command -v apt-get >/dev/null 2>&1; then
  PM=apt
elif command -v dnf >/dev/null 2>&1; then
  PM=dnf
elif command -v yum >/dev/null 2>&1; then
  PM=yum
else
  die "未识别的包管理器，请手动安装 nginx 与 rsync"
fi

log "包管理器：$PM"
case "$PM" in
  apt)
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx rsync curl
    ;;
  dnf) dnf install -y nginx rsync curl ;;
  yum) yum install -y nginx rsync curl ;;
esac

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now nginx
else
  service nginx start
fi

# ---------- 1.5 端口预检 ----------
# 轻量服务器常见坑：端口没放通、被系统进程占用。提前报出来，别等 CI 冒烟检查红。
# 重复执行时 nginx 自己会监听着这个端口，那是正常情况，不算占用。
if command -v ss >/dev/null 2>&1; then
  occupant=$(ss -ltnp 2>/dev/null | grep -E "[:.]${APP_PORT}\b" | head -1 || true)
  if [ -n "$occupant" ]; then
    if echo "$occupant" | grep -q nginx; then
      log "端口 ${APP_PORT} 已由本站 nginx 监听（重复执行，跳过占用检查）"
    else
      die "端口 ${APP_PORT} 已被其他进程占用：${occupant}"
    fi
  else
    log "端口 ${APP_PORT} 空闲"
  fi
fi

# ---------- 2. 发布目录 ----------
# 目录约定（与 CI 一致）：
#   releases/<run>-<sha>/  每次发布一个完整站点目录
#   current -> releases/…  软链，nginx 的 root 指向它
mkdir -p "$APP_DIR/releases"
if [ ! -e "$APP_DIR/current" ]; then
  mkdir -p "$APP_DIR/releases/placeholder"
  cat > "$APP_DIR/releases/placeholder/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>TerraAsia</title>
<body style="background:#060d16;color:#8fb2cc;font:16px/1.8 system-ui;padding:56px">
<h1 style="color:#eef6fc">TerraAsia 已就绪</h1>
<p>站点目录已创建，等待第一次 CI 构建：向 main 推送代码即可自动发布。</p>
</body>
HTML
  # 相对软链：随 APP_DIR 整体搬迁也不断
  ln -sfn releases/placeholder "$APP_DIR/current"
  log "写入占位页 $APP_DIR/current -> releases/placeholder"
fi

# ---------- 3. nginx 站点 ----------
# Debian/Ubuntu 的默认站点也监听 80，会抢在 conf.d 之前匹配
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
  log "已移除 nginx 默认站点（sites-enabled/default）"
fi

install -m 644 "$CONF_SRC" "$CONF_DST"
sed -i "s#root /var/www/terra-asia/current;#root ${APP_DIR}/current;#" "$CONF_DST"
sed -i "s#listen 8159;#listen ${APP_PORT};#" "$CONF_DST"
sed -i "s#listen \[::\]:8159;#listen [::]:${APP_PORT};#" "$CONF_DST"
log "写入站点配置 $CONF_DST（root=$APP_DIR/current, listen=${APP_PORT}）"

if ! nginx -t; then
  die "nginx 配置校验失败，请检查 $CONF_DST"
fi
systemctl reload nginx 2>/dev/null || service nginx reload

# ---------- 4. 自检 ----------
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${APP_PORT}/" || true)
log "本机访问 http://127.0.0.1/ -> $code"

cat <<EOF

✅ 服务器初始化完成

  站点目录 : $APP_DIR
  当前版本 : $APP_DIR/current（软链，CI 发布时原子切换）
  版本目录 : $APP_DIR/releases/（CI 自动保留最近 5 个）
  配置     : $CONF_DST

还需要在腾讯云控制台做一件事：
  轻量应用服务器 → 防火墙 → 放通 TCP:${APP_PORT}（站点端口）
  访问地址：http://<服务器IP>:${APP_PORT}/

如果改过端口：GitHub 仓库 Settings → Variables 里把 SITE_PORT 也改成 ${APP_PORT}，
否则 CI 冒烟检查会去戳默认端口。

提示：本机 curl 返回 000 通常是 nginx 未启动或端口被占用；
      外网打不开但本机 200，基本就是防火墙没放通。
EOF
