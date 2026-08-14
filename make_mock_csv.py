#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 生成模拟 inventory_parts.csv（约 12MB，每行约 60 字节），用于验证分片边界
import csv
import io

out = io.StringIO()
w = csv.writer(out)
w.writerow(["id", "part_num", "color_id", "quantity", "img_url"])
for i in range(1, 200001):
    w.writerow([i, f"p{i}", i % 100, 1, "https://cdn.rebrickable.com/media/parts/ldraw/13/3004.png"])
with open("/workspace/mock_inventory_parts.csv", "w", newline="", encoding="utf-8") as f:
    f.write(out.getvalue())
print("mock file created")
