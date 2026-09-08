# coding: utf-8
"""删除 gitee parts-rb 根目录的 BL-price.json 和 BL-price.old（若存在）。
用法：python3 del_price.py"""
import json, time, urllib.request, urllib.error

TOK = '5e8fe75044a023e2c992c1b5d11c95f0'
FRONT = 'https://gitee.com/api/v5/repos/legoping/parts-rb/contents'


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
            if e.code in (404,):
                return {'_code': e.code, '_body': b}
            print('  HTTPERR', e.code, b)
            time.sleep(3)
        except Exception as e:
            print('  EXC', repr(e))
            time.sleep(10)
    raise SystemExit('FAILED %s %s' % (method, url))


def delete(path):
    url = '%s/%s?ref=main&access_token=%s' % (FRONT, path, TOK)
    d = _req('GET', url)
    if not isinstance(d, dict) or '_code' in d:
        print('  %s: 不存在或跳过（%s）' % (path, d.get('_code') if isinstance(d, dict) else type(d).__name__))
        return
    sha = d.get('sha')
    if not sha:
        print('  %s: 无 sha，跳过' % path)
        return
    _req('DELETE', '%s/%s' % (FRONT, path), {
        'access_token': TOK,
        'sha': sha,
        'branch': 'main',
        'message': 'remove: 清空线上旧价格，待重新爬价 [skip ci]',
    })
    print('  已删除', path)


for p in ['BL-price.json', 'BL-price.old']:
    delete(p)