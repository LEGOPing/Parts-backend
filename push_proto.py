# coding: utf-8
"""把 pythonista_proto.py 推送到 gitee parts-rb 的 blp-shortcuts/ 目录。
用法：python3 push_proto.py"""
import base64, json, time, urllib.request, urllib.error

TOK = '5e8fe75044a023e2c992c1b5d11c95f0'
FRONT = 'https://gitee.com/api/v5/repos/legoping/parts-rb/contents'
BR = 'main'
PATH = 'blp-shortcuts/pythonista_proto.py'
LOCAL = '/workspace/pythonista_app/pythonista_proto.py'


def _req(method, url, payload=None, tries=10):
    data = json.dumps(payload).encode() if payload is not None else None
    for i in range(1, tries + 1):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Content-Type', 'application/json;charset=utf-8')
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode('utf-8')
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            b = e.read().decode('utf-8', 'ignore')[:200]
            if e.code == 429:
                time.sleep(12 * i)
                continue
            print('  HTTPERR', e.code, b)
            time.sleep(3)
        except Exception as e:
            print('  EXC', repr(e))
            time.sleep(10)
    raise SystemExit('FAILED %s %s' % (method, url))


def get_sha():
    d = _req('GET', '%s/%s?ref=%s&access_token=%s' % (FRONT, PATH, BR, TOK))
    return d.get('sha') if isinstance(d, dict) else None


b64 = base64.b64encode(open(LOCAL, 'rb').read()).decode('ascii')
doc = {
    'access_token': TOK,
    'content': b64,
    'branch': BR,
    'message': 'feat: 正式5步流程——Supabase建LP+去重, NP/OP旋转, 10天增量沿用, 每10条落盘 [skip ci]',
}
sha = get_sha()
if sha:
    doc['sha'] = sha
url = '%s/%s' % (FRONT, PATH)
r = _req('PUT', url, doc)
if isinstance(r, dict) and '_http' in r and r['_http'] == 400:
    time.sleep(3)
    sha = get_sha()
    if sha:
        doc['sha'] = sha
    r = _req('PUT', url, doc)
print('  push pythonista_proto.py ->', (r.get('commit') or {}).get('sha', '?') if isinstance(r, dict) else '?')