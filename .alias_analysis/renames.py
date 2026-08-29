#!/usr/bin/env python3
import csv, os
from collections import defaultdict

BASE = '/workspace/.alias_analysis/rb_clone'

def read_rows(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.reader(f))

rb_parts = set()
rows = read_rows(os.path.join(BASE, 'parts.csv'))
for r in rows[1:]:
    if r and r[0].strip(): rb_parts.add(r[0].strip())

el_id2part = {}
for r in read_rows(os.path.join(BASE, 'elements.csv'))[1:]:
    if r and r[0].strip() and r[1].strip():
        el_id2part[r[0].strip()] = r[1].strip()

# BL ITEMID -> set of rb targets
bl = defaultdict(set)
for r in read_rows(os.path.join(BASE, 'BL-parts.csv'))[1:]:
    if not r: continue
    item = r[1].strip(); code = r[3].strip()
    if item and code and el_id2part.get(code):
        bl[item].add(el_id2part[code])

# current aliases
aliases = {}
for r in read_rows(os.path.join(BASE, 'part_aliases.csv'))[1:]:
    if r and len(r) >= 2 and r[0].strip() and r[1].strip():
        aliases[r[0].strip()] = r[1].strip()

# genuine renames: BL item whose resolved RB target set differs from itself
renames = []
for item, targets in bl.items():
    targets_rb = {t for t in targets if t != item}   # targets differing from BL number
    if not targets_rb:
        continue                                      # resolves to itself -> no alias
    if item in aliases:
        continue                                      # already persisted
    # row present in BL where this ITEMID also literally exists in RB as itself?
    self_in_rb = item in rb_parts
    renames.append((item, sorted(targets), self_in_rb))

print(f'BL ITEMID 总数(可解析)= {len(bl)}')
print(f'genuine renames (BL!=RB target) 未持久化 = {len(renames)}')
all_same = [x for x in renames if len(x[1])==1]
multi = [x for x in renames if len(x[1])>1]
print(f'  其中 单一RB目标(BL!=目标, 无歧义) = {len(all_same)}')
print(f'  其中 多RB目标(需按颜色/歧义)      = {len(multi)}')

print('\n== 单一目标、BL!=RB、未持久化的改型别名（前120）==')
for item, targets, selfrb in sorted(all_same, key=lambda x:x[0]):
    print(f'{item} -> {targets[0]}' + ('  [BL本身也是RB]' if selfrb else ''))