/**
 * MCP App (ui:// resource) that renders NairaHome results as a card on screens like Echo Show.
 * Implements the MCP Apps view handshake: ui/initialize -> ui/notifications/initialized,
 * then renders every ui/notifications/tool-result the host sends.
 */
export const CARD_URI = "ui://nairahome/card.html";
export const MCP_APP_MIME = "text/html;profile=mcp-app";

export const CARD_HTML = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NairaHome</title>
<style>
:root{--bg:#0f1a14;--panel:#16251c;--ink:#f3f1e8;--muted:#a9b8ad;--green:#29c46a;--gold:#f2b84b;--red:#ff7a6b;--line:#24382b}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.card{padding:20px 22px}.eyebrow{color:var(--gold);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}
.big{font-size:40px;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px}.say{font-size:18px;margin:10px 0 16px}
.muted{color:var(--muted);font-size:13px}.row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
.row b{font-weight:700}.pill{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:#21402c;color:var(--green)}
.pill.warn{background:#4a3a17;color:var(--gold)}.pill.bad{background:#4a211c;color:var(--red)}.pill.demo{background:#3b2a4a;color:#e0b8ff}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px}
.tile .v{font-size:22px;font-weight:800}.bar{height:8px;border-radius:8px;background:var(--line);overflow:hidden;margin-top:6px}.bar>i{display:block;height:100%;background:var(--green)}
.defer{opacity:.55}.empty{color:var(--muted);padding:30px 0;text-align:center}
</style></head><body><div id="root" class="card"><div class="empty">Waiting for NairaHome…</div></div>
<script>
(function(){
  var root=document.getElementById('root'), nextId=1;
  var N=function(n){return '\\u20a6'+Math.round(n).toLocaleString('en-US')};
  var SYM={USD:'$',GBP:'\\u00a3',EUR:'\\u20ac',CAD:'C$'};
  var M=function(n,c){return (SYM[c]||'')+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  var D=function(iso){return new Date(iso+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})};
  function fxLine(fx){ if(!fx) return ''; return '<p class="muted">'+(fx.mode==='demo'?'<span class="pill demo">DEMO RATE</span> ':'')+'Mid-market '+N(fx.rate)+' per '+esc(fx.currency)+' · '+esc(fx.source)+(fx.mode==='demo'?'':' · updated '+esc(new Date(fx.asOf).toUTCString().slice(5,22))+' UTC')+'</p>'; }
  function verdictPill(v){var map={better_than_mid_market:['Promo rate',''],excellent:['Excellent',''],within_un_target:['Fair · under 3%',''],pricey:['Pricey · over 3%','warn'],expensive:['Expensive','bad']};var x=map[v]||[v,''];return '<span class="pill '+x[1]+'">'+x[0]+'</span>';}
  function render(sc){
    if(!sc||!sc.kind){root.innerHTML='<div class="empty">No card for this result.</div>';return;}
    var d=sc.data||{}, h='';
    if(sc.kind==='rate'){h='<div class="eyebrow">Today\\'s naira rate</div><div class="big">'+N(d.rate)+'</div><div class="muted">per 1 '+esc(d.currency)+'</div><p class="say">'+esc(sc.speech)+'</p>'+fxLine(d);}
    else if(sc.kind==='quote'){var q=d.quote;h='<div class="eyebrow">'+esc(q.provider||'Transfer')+' · true cost</div><div class="big">'+N(q.ngnDelivered)+'</div><div class="muted">delivered for '+M(q.totalPaid,q.currency)+' '+verdictPill(q.verdict)+'</div>'+
      '<div class="grid"><div class="tile"><div class="muted">Fee</div><div class="v">'+M(q.fee,q.currency)+'</div></div><div class="tile"><div class="muted">Hidden in the rate</div><div class="v">'+M(q.hiddenFxCost,q.currency)+'</div></div><div class="tile"><div class="muted">All-in cost</div><div class="v">'+q.totalCostPct+'%</div></div><div class="tile"><div class="muted">Family loses</div><div class="v">'+N(q.ngnLost)+'</div></div></div>'+fxLine(d.fx);}
    else if(sc.kind==='compare'){h='<div class="eyebrow">Best offer first</div>';(d.ranked||[]).forEach(function(q,i){h+='<div class="row"><span>'+(i===0?'\\u2605 ':'')+'<b>'+esc(q.provider)+'</b> '+verdictPill(q.verdict)+'</span><span><b>'+N(q.ngnDelivered)+'</b> <span class="muted">'+q.totalCostPct+'%</span></span></div>'});h+=fxLine(d.fx);}
    else if(sc.kind==='plan'&&d.plan){var p=d.plan,c=p.currency,pct=p.budget?Math.min(100,Math.round(p.fundedSender/p.budget*100)):100;
      h='<div class="eyebrow">'+esc(p.month)+' plan'+(d.sample?' · <span class="pill demo">SAMPLE FAMILY</span>':'')+'</div><div class="big">'+M(p.totalSenderNeeded,c)+'</div><div class="muted">for '+N(p.totalNgnDue)+' due · planning rate '+N(p.planningRate)+' ('+p.assumedCostPct+'% cost: '+esc(p.assumedCostBasis)+')</div>';
      if(p.budget){h+='<div class="tile" style="margin-top:12px"><div class="muted">Budget '+M(p.budget,c)+' · funding '+M(p.fundedSender,c)+(p.shortfallSender?' · gap '+M(p.shortfallSender,c):'')+'</div><div class="bar"><i style="width:'+pct+'%"></i></div></div>';}
      if(p.transfers.length){h+='<div class="grid">';p.transfers.forEach(function(t){h+='<div class="tile"><div class="muted">Send to '+esc(t.member)+(t.payoutNote?' · '+esc(t.payoutNote):'')+'</div><div class="v">'+M(t.senderAmount,c)+'</div><div class="muted">'+N(t.amountNgn)+' · '+esc(t.covers.join(', '))+'</div></div>'});h+='</div>';}
      p.items.forEach(function(it){h+='<div class="row '+(it.status==='defer'?'defer':'')+'"><span><b>'+esc(it.member)+'</b> · '+esc(it.label)+' '+(it.overdue?'<span class="pill bad">overdue</span>':'')+(it.status==='defer'?'<span class="pill warn">later</span>':'')+'</span><span>'+N(it.amountNgn)+' <span class="muted">'+D(it.due)+'</span></span></div>'});
      if(p.setAsides.length){h+='<p class="eyebrow" style="margin-top:16px">Coming up</p>';p.setAsides.forEach(function(s){h+='<div class="row"><span><b>'+esc(s.member)+'</b> · '+esc(s.label)+' <span class="muted">'+D(s.due)+'</span></span><span>'+M(s.perMonthSender,c)+'<span class="muted">/mo</span></span></div>'});}
      h+=fxLine(d.fx);}
    else if(sc.kind==='summary'){var c2=d.currency;h='<div class="eyebrow">Your household'+(d.sample?' · <span class="pill demo">SAMPLE FAMILY</span>':'')+'</div><div class="grid"><div class="tile"><div class="muted">Sent this month</div><div class="v">'+N(d.thisMonth.ngn)+'</div></div><div class="tile"><div class="muted">Lost to fees + markup</div><div class="v">'+M(d.thisMonth.cost,c2)+'</div></div><div class="tile"><div class="muted">This year</div><div class="v">'+N(d.thisYear.ngn)+'</div></div></div>';
      (d.upcoming||[]).forEach(function(o){h+='<div class="row"><span><b>'+esc(o.member)+'</b> · '+esc(o.label)+(o.overdue?' <span class="pill bad">overdue</span>':'')+'</span><span>'+N(o.amountNgn)+' <span class="muted">'+D(o.nextDue)+'</span></span></div>'});}
    else {h='<p class="say">'+esc(sc.speech)+'</p>';sc={kind:'rate'};}
    if(sc.kind!=='rate') h+='<p class="muted" style="margin-top:14px">\\u201c'+esc(sc.speech)+'\\u201d</p>';
    root.innerHTML=h;
    post({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.documentElement.scrollHeight}});
  }
  function post(m){ if(window.parent&&window.parent!==window) window.parent.postMessage(m,'*'); }
  window.addEventListener('message',function(ev){var m=ev.data;if(!m||m.jsonrpc!=='2.0')return;
    if(m.method==='ui/notifications/tool-result'){render((m.params||{}).structuredContent);}
    else if(m.id===1&&m.result){post({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});}
  });
  post({jsonrpc:'2.0',id:nextId++,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'nairahome-card',version:'1.0.0'},appCapabilities:{}}});
})();
</script></body></html>`;
