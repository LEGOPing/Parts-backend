// 模拟前端 api.js 的 split（uploadRBInventoryShards）与 merge（fetchRBInventoryParts）逻辑
const MAX_SHARD_BYTES = 4 * 1024 * 1024;
const BASE = 'inventory_parts_';
const SUFFIX = '.csv';

function byteSize(s) { return Buffer.byteLength(s, 'utf8'); }

function splitCSV(text) {
    const lines = text.split(/\r?\n/);
    const headerLine = lines[0];
    const dataLines = lines.slice(1).filter(line => line.trim() !== '');
    const shards = [];
    let current = [headerLine];
    let currentSize = byteSize(headerLine + '\n');
    for (const line of dataLines) {
        const lineSize = byteSize(line + '\n');
        if (currentSize + lineSize >= MAX_SHARD_BYTES && current.length > 1) {
            shards.push(current.join('\n'));
            current = [headerLine];
            currentSize = byteSize(headerLine + '\n');
        }
        current.push(line);
        currentSize += lineSize;
    }
    if (current.length > 1) shards.push(current.join('\n'));
    return { shards, dataLines, headerLine };
}

const header = 'id,part_num,color_id,quantity,img_url';
let csvText = header;
const urlPrefix = 'https://cdn.rebrickable.com/media/parts/ldraw/13/';
for (let i = 1; i <= 200000; i++) {
    csvText += `\n${i},3004,13,1,${urlPrefix}3004.png`;
}
console.log('原始CSV大小(MB):', (byteSize(csvText) / 1048576).toFixed(2));

const { shards, dataLines, headerLine } = splitCSV(csvText);
console.log('分片数量:', shards.length);
shards.forEach((s, i) => {
    const bytes = byteSize(s);
    const sizeMB = (bytes / 1048576).toFixed(3);
    const name = `${BASE}${i + 1}${SUFFIX}`;
    if (bytes >= MAX_SHARD_BYTES) throw new Error(`分片 ${name} 超过4MB: ${sizeMB}MB (${bytes}字节)`);
    console.log(`  ${name}: ${sizeMB}MB (${bytes}字节, ${s.split(/\r?\n/).length} 行)`);
    if (s.split('\n')[0] !== headerLine) throw new Error(`${name} 缺少表头`);
});

const first = shards[0];
const rest = shards.slice(1).map(t => {
    const idx = t.indexOf('\n');
    return idx === -1 ? t : t.slice(idx + 1);
});
const merged = first + rest.join('');

const mergedRows = merged.split(/\r?\n/).filter(l => l.trim() !== '');
console.log('原始数据行:', dataLines.length, '合并后行数:', mergedRows.length, '合并后表头:', mergedRows[0]);
if (mergedRows.length !== dataLines.length + 1) throw new Error('行数不匹配!');
if (mergedRows[0] !== headerLine) throw new Error('表头不匹配!');
for (let i = 1; i < mergedRows.length; i++) {
    if (mergedRows[i] !== dataLines[i - 1]) throw new Error(`第 ${i} 行数据不一致`);
}
console.log('✓ 分割(<4MB)与合并(去重表头)逻辑验证通过，数据行完整无丢失');
