# -*- coding: utf-8 -*-
"""
玩具寄售清单 - Pythonista 一键下载引导
运行一次即可把完整应用下载到：玩具寄售/toy_consignment.py
下载完成后可删除本引导脚本。
"""
import urllib.request
import os
import sys

# 远程下载地址（运行时从 paste.rs 获取纯文本）
DOWNLOAD_URL = "https://paste.rs/OTaxG"

TARGET = os.path.join(os.path.expanduser("~"), "玩具寄售", "toy_consignment.py")


def main():
    print("=" * 50)
    print("  玩具寄售清单 · 一键安装")
    print("=" * 50)
    print(f"\n正在下载: {DOWNLOAD_URL}")
    try:
        req = urllib.request.Request(DOWNLOAD_URL, headers={"User-Agent": "Pythonista"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        print(f"✅ 下载成功 ({len(data)} 字节)")
    except Exception as e:
        print(f"❌ 下载失败: {e}")
        print("   请检查网络或联系作者更新下载链接。")
        sys.exit(1)

    # 保存
    try:
        os.makedirs(os.path.dirname(TARGET), exist_ok=True)
        with open(TARGET, "wb") as f:
            f.write(data)
        print(f"✅ 已保存到: {TARGET}")
    except Exception as e:
        print(f"❌ 保存失败: {e}")
        sys.exit(1)

    # 简单语法检查
    try:
        import py_compile
        py_compile.compile(TARGET, doraise=True)
        print("✅ 语法检查通过")
    except Exception as e:
        print(f"⚠️ 语法检查未通过: {e}")
        print("   可能是 Pythonista 特有模块导致，不影响运行。")

    print()
    print("👉 请在 Pythonista 文件列表中找到")
    print("      玩具寄售 / toy_consignment.py")
    print("   点击打开，再点 ▶ 运行即可。")
    print()
    print("（本引导脚本可以删除）")
    print("=" * 50)


if __name__ == "__main__":
    main()
