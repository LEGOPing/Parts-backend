#!/usr/bin/env python3
import csv, json, os
from collections import defaultdict

BASE = '/workspace/.alias_analysis/rb_clone'

def read_csv_lines(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.reader(f))

# ---------- 1. RB parts set ----------
rb_parts = set()
parts_path = os.path.join(BASE, 'parts.csv')
rows = read_csv_lines(parts_path)
hdr = rows[0]
pi = {k: i for i, k in enumerate(hdr)}
for r in rows[1:]:
    if not r: continue
    v = r[pi['part_num']].strip()
    if v: rb_parts.add(v)
print(f'[RB parts.csv] {len(rb_parts)} unique part_num')

# ---------- 2. elements: element_id -> part_num ----------
el_id2part = {}
el_rows = read_csv_lines(os.path.join(BASE, 'elements.csv'))
eh = el_rows[0]; ei = {k:i for i,k in enumerate(eh)}
# elements header: element_id,part_num,color_id,design_id
for r in el_rows[1:]:
    if not r: continue
    eid = r[0].strip()
    pnum = r[1].strip()
    if eid and pnum: el_id2part[eid] = pnum
print(f'[elements.csv] {len(el_id2part)} element_id->part_num')

# ---------- 3. BL-parts: ITEMID -> set of part_num (via CODENAME->elements) ----------
bl_item2assign = defaultdict(dict)  # ITEMID -> {CODENAME: part_num}
bl_rows = read_csv_lines(os.path.join(BASE, 'BL-parts.csv'))
bh = bl_rows[0]; bi = {k:i for i,k in enumerate(bh)}
# header: ITEMTYPE,ITEMID,COLOR,CODENAME
n_rb = 0
for r in bl_rows[1:]:
    if not r: continue
    item = r[bi['ITEMID']].strip()
    code = r[bi['CODENAME']].strip()
    if not item or not code: continue
    pnum = el_id2part.get(code)
    if pnum:
        bl_item2assign[item][code] = pnum
        n_rb += 1
print(f'[BL-parts.csv] {len(bl_item2assign)} ITEMIDs; {n_rb} rows resolvable to RB via elements')

# ---------- 4. inventory parts ----------
inv_rows = read_csv_lines(os.path.join(BASE, 'inventory_parts.csv'))
ih = inv_rows[0]; ii = {k:i for i,k in enumerate(ih)}
inv_parts = {}
for r in inv_rows[1:]:
    if not r: continue
    pn = r[ii['part_num']].strip()
    if pn:
        inv_parts[pn] = inv_parts.get(pn, 0) + 1
print(f'[inventory_parts.csv] {len(inv_parts)} distinct part_num')

# ---------- 5. current persisted aliases ----------
alias_rows = read_csv_lines(os.path.join(BASE, 'part_aliases.csv'))
ah = al_hdr = alias_rows[0]
aliases = {}
for r in alias_rows[1:]:
    if r and len(r) >= 2:
        a = r[0].strip(); b = r[1].strip()
        if a and b: aliases[a] = b
print(f'[part_aliases.csv] {len(aliases)} persisted aliases')

# ---------- 6. candidates: inventory BL nums not in RB, not alias-persisted ----------
candidates = []
for pn, cnt in inv_parts.items():
    if pn in rb_parts:
        continue          # valid RB number, no alias needed
    if pn in aliases:
        continue          # already persisted
    # resolve via BL-parts
    assign = bl_item2assign.get(pn)
    if not assign:
        continue          # can't derive RB target from these sources
    rb_targets = sorted(set(assign.values()))
    candidates.append((pn, cnt, rb_targets))

print('\n== 未持久化别名的候选（在BL有可解析目标，但未写入 part_aliases.csv）==')
for pn, cnt, t in sorted(candidates, key=lambda x: -x[1]):
    print(f'{pn}\t(qty_rows={cnt})\t-> RB candidates: {t}')

# ---------- breakdown: inventory nums NOT in rb_parts ----------
not_rb = {pn: cnt for pn, cnt in inv_parts.items() if pn not in rb_parts}
resolved_via_bl = {pn: bl_item2assign.get(pn) for pn in not_rb if bl_item2assign.get(pn)}
resolved_via_alias = {pn for pn in not_rb if pn in aliases}
unresolved = {pn: cnt for pn, cnt in not_rb.items() if pn not in aliases and not bl_item2assign.get(pn)}
print(f'\n[inventory→RB] 总数={len(inv_parts)} 不在RB表={len(not_rb)}')
print(f'  其中 已别名={len(resolved_via_alias)} BL可解析={len(resolved_via_bl)} 两者皆无(未知)={len(unresolved)}')

print('\n[库存中不在RB表 且 BL可解析 → 但未持久化别名的候选]  =', len(candidates))
print('\n[库存中不在RB表 且 BL也不可解析(未知型号，非别名问题) 前40]:')
for pn, cnt in sorted(unresolved.items(), key=lambda x:-x[1])[:40]:
    print(f'  {pn}\t(qty={cnt})')

# sanity: 48452cx1
print('\n[sanity] 48452cx1 在库存中?', '48452cx1' in inv_parts, '; BL assignable:', bl_item2assign.get('48452cx1'))
print('[sanity] 48452cx1 remark 目标50163是RB吗:', '50163' in rb_parts)