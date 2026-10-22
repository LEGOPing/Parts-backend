#!/bin/bash
#
# Supabase 免费版心跳脚本（Bash 版本）
# 每 5 天运行一次，防止 Supabase 项目因 7 天无活动而暂停
#
# 使用方式：
#   export SUPABASE_URL="https://xxxx.supabase.co"
#   export SUPABASE_ANON_KEY="eyJ..."
#   bash supabase_heartbeat.sh
#

set -e

# 加载 .env 文件（本地运行时）
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# 从 DATABASE_URL 提取 project ref 作为后备
if [ -z "$SUPABASE_URL" ] && [ -n "$DATABASE_URL" ]; then
    # DATABASE_URL 格式: postgresql://postgres.<REF>:xxx@...
    REF=$(echo "$DATABASE_URL" | sed -E 's|postgres\.(.*):.*|\1|')
    SUPABASE_URL="https://${REF}.supabase.co"
fi

if [ -z "$SUPABASE_URL" ]; then
    echo "ERROR: SUPABASE_URL 或 DATABASE_URL 未设置"
    exit 1
fi

NOW=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$NOW] 开始 Supabase 心跳检测..."

# 方式 1: 如果有 ANON_KEY，走 REST API
if [ -n "$SUPABASE_ANON_KEY" ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "apikey: $SUPABASE_ANON_KEY" \
        -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
        "$SUPABASE_URL/rest/v1/")

    NOW=$(date '+%Y-%m-%d %H:%M:%S')
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
        echo "[$NOW] ✅ 心跳成功 (HTTP $HTTP_CODE)"
        exit 0
    else
        echo "[$NOW] ❌ 心跳失败 (HTTP $HTTP_CODE)"
        exit 1
    fi
fi

# 方式 2: 没有 ANON_KEY，直接访问 REST API 根路径（返回 401 也算有活动）
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/rest/v1/")
NOW=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    echo "[$NOW] ✅ 心跳成功 (HTTP $HTTP_CODE)"
    exit 0
else
    echo "[$NOW] ❌ 心跳失败 (HTTP $HTTP_CODE)"
    exit 1
fi
