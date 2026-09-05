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
#   deployment.zip —— 直接传到 AWS Lambda（>50MB 时先传 S3 再引用）
#
# 若运行时报缺系统库（libnss3 等），说明构建环境与 Lambda runtime 不一致，
# 请改走方式 A（或把该机器构建结果经 S3 上传）。
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")" 2>/dev/null || cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  echo "!! 警告：未找到 headless_shell，请检查 playwright install 结果的目录"
  exit 1
fi

echo "==> 组装代码"
cp lambda_function.py build/pkg/
cp -r "$ROOT/app" build/pkg/app

echo "==> 打入 Python 依赖（含 playwright 及其 driver）"
PYVER=$(python3 -c "import sys;print('python%s.%s'%(sys.version_info[0],sys.version_info[1]))")
cp -r build/.venv/lib/"$PYVER"/site-packages/* build/pkg/

# 清理无用大文件，压缩体积
find build/pkg -name '__pycache__' -type d -prune -exec rm -rf {} + || true
rm -rf build/pkg/pytest* build/pkg/*.dist-info 2>/dev/null || true

echo "==> 收集 Chromium 系统库依赖到 libs/（Lambda 运行时缺库时命中）"
SHELL_BIN="$(find build/pkg/pw-browsers -name headless_shell | head -1)"
if [ -n "$SHELL_BIN" ]; then
  mkdir -p build/pkg/libs
  # 罗列 headless-shell 直接依赖的 .so，逐个拷进包内（保留完整文件名扩展版本号）
  ldd "$SHELL_BIN" 2>/dev/null | grep -oE "/[^ ]+\.so\.[0-9]+" | sort -u | while read -r so; do
    [ -e "$so" ] && cp -n -f "$so" build/pkg/libs/ 2>/dev/null || true
  done
  echo "  已拷贝 $(find build/pkg/libs -maxdepth 1 -name '*.so*' | wc -l) 个库"
  echo "  缺失（ldd 标记 not found）的库，请用 yum 安装后重跑："
  ldd "$SHELL_BIN" 2>/dev/null | grep "not found" | sed "s/^/    - /" || true
else
  echo "  !! 未找到 headless_shell，跳过系统库收集"
fi

echo "==> 生成压缩包 deployment.zip"
cd build/pkg
zip -q -r9 "$SCRIPT_DIR/deployment.zip" .
cd "$SCRIPT_DIR"
ls -lh deployment.zip
echo "完成。将 deployment.zip 上传到 AWS Lambda（>50MB 时先传 S3 再引用）。"
echo "  - 运行时选 python3.9，内存>=1024MB（建议 1536MB），超时 >=60s。"
echo "  - 若上方 ldd 有 not found 库：在 Amazon Linux2 构建镜像里 yum install 对应包后重新打包。"