#!/usr/bin/env bash
# ===========================================================================
# 打包 AWS Lambda 无头浏览器抓价函数，产出 deployment.zip
#
# 运行环境（二选一）
#   A) 有 Docker：用 AWS 官方构建镜像隔离系统依赖，最稳
#      docker run -it --rm \
#        -v "$(pwd)/../":/build -w /build/lambda_bl_price \
#        amazon/aws-lambda-python:3.9 /build/lambda_bl_price/build.sh
#   B) 无 Docker：在 Amazon Linux 2 / CentOS7 兼容的机器上直接 bash build.sh
#
# 产出构物：
#   deployment.zip  —— 直接传到 AWS Lambda（>50MB 时改传 S3 再引用）
#   .env.example    —— Lambda 环境变量样例
#
# 若运行时报缺系统库（libnss3 等），说明构建环境与 Lambda runtime 不一致，
# 请改走方式 A（或把该机器构建结果经 S3 上传）。
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

echo "==> 清理"
rm -rf build deployment.zip
mkdir -p build/pkg/pw-browsers

echo "==> 安装依赖"
python3 -m venv build/.venv
# shellcheck disable=SC1091
source build/.venv/bin/activate
pip install -q -U pip
pip install -q -r requirements.txt

echo "==> 下载 chromium headless-shell（存到包内 pw-browsers）"
python -m playwright install chromium-headless-shell
BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
for d in "$BROWSERS_DIR"/chromium_headless_shell-*; do
  [ -d "$d" ] && cp -r "$d" build/pkg/pw-browsers/
done
# 确保包内能命中 headless_shell
if ! find build/pkg/pw-browsers -name headless_shell | grep -q .; then
  echo "!! 警告：未找到 headless_shell，请检查 playwright install 结果的目录"; exit 1
fi

echo "==> 组装代码"
cp lambda_function.py build/pkg/
# 以 zip#… 的路径上带好 app 逻辑（复用解析/抓取）
cp -r "$ROOT/app" build/pkg/app

echo "==> 打入 Python 依赖（含 playwright 及其 driver）"
cp -r build/.venv/lib/"$(python3 -c 'import sys;print("python%s.%s"%(sys.version_info[0],sys.version_info[1]))')"/site-packages/* build/pkg/

# 清理无用大文件，压缩体积
find build/pkg -name '__pycache__' -type d -prune -exec rm -rf {} + || true
rm -rf build/pkg/pytest* build/pkg/*.dist-info 2>/dev/null || true

echo "==> 生成压缩包 deployment.zip"
cd build/pkg
zip -q -r9 "$SCRIPT_DIR/deployment.zip" . -x '**/.libs/**'
cd "$SCRIPT_DIR"
ls -lh deployment.zip
echo "完成。将 deployment.zip 上传到 AWS Lambda（运行时选 python3.9，内存≥1024MB，超时≥1分钟）。"