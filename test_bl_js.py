import json
from playwright.sync_api import sync_playwright

page_js = """
(() => {
  var h=document.body.innerHTML;
  var re=/<td>(Min Price|Qty Avg Price|Avg Price|Max Price):<\\/td>\\s*<td><b>([A-Z]{2,3})?(?:\\s|&nbsp;|\\u00a0)*([\\d,]+\\.\\d+)<\\/b><\\/td>/gi;
  var out={min:[],avg:[],qty_avg:[],max:[]};
  var map={'Min Price':'min','Avg Price':'avg','Qty Avg Price':'qty_avg','Max Price':'max'};
  var m;while((m=re.exec(h))!==null){var k=map[m[1]];if(k&&out[k])out[k].push([(m[2]||'').toUpperCase(),parseFloat(m[3].replace(/,/g,''))]);}
  function blk(col){function g(k){return out[k][col]?out[k][col][1]:null;}return {min:g('min'),avg:g('avg'),qty_avg:g('qty_avg'),max:g('max')};}
  var cur=(h.indexOf('CNY')>=0?'CNY':(h.indexOf('USD')>=0?'USD':''));
  return JSON.stringify({cur:cur,l6:blk(0),cs:blk(2),counts:{min:out.min.length,avg:out.avg.length,qty_avg:out.qty_avg.length,max:out.max.length}});
})();
"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'])
    ctx = b.new_context(user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                        locale="en-US", timezone_id="America/Los_Angeles")
    pg = ctx.new_page()
    pg.goto("https://www.bricklink.com/catalogPG.asp?P=3001&colorID=7", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_selector("text=Last 6 Months Sales", timeout=60000)
    res = pg.evaluate(page_js)
    b.close()
    print("PAGEJS", res)
    try:
        obj = json.loads(res)
        print("CUR", obj["cur"])
        print("L6  ", obj["l6"])
        print("CS  ", obj["cs"])
    except Exception as e:
        print("ERR", e)