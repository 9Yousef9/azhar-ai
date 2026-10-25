'use strict';
// خادم بلا اعتماديات خارجية (Node 18+). مفتاح Gemini يبقى هنا فقط ولا يصل للمتصفح.
const http=require('http'),fs=require('fs'),path=require('path');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&m[2]&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch(e){}
const PORT=+process.env.PORT||3000,MODEL=process.env.GEMINI_MODEL||'gemini-2.5-flash',
BASE=process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com/v1beta',
DAILY=+process.env.DAILY_LIMIT||300,PER_MIN=+process.env.PER_MIN_LIMIT||15,PUB=path.join(__dirname,'public');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const SYS='أنت معلم ذكي لطلاب الأزهر الشريف من الابتدائي إلى الثانوي. أجب بالعربية الفصحى المبسطة المناسبة لسن الطالب، ولا تختلق معلومات ولا تنسب شيئًا إلى كتاب رسمي دون تأكد، وقل بصراحة إذا لم تكن متأكدًا. في المسائل الشرعية الخلافية انصح بالرجوع إلى المعلم أو العالم المختص. التزم بمحتوى تعليمي مناسب للأعمار.';
const hits=new Map();let day=new Date().toISOString().slice(0,10),used=0;
function limited(ip){const d=new Date().toISOString().slice(0,10);if(d!==day){day=d;used=0}if(used>=DAILY)return 'day';const now=Date.now(),a=(hits.get(ip)||[]).filter(t=>now-t<6e4);if(a.length>=PER_MIN){hits.set(ip,a);return 'ip'}a.push(now);hits.set(ip,a);used++;return null}
setInterval(()=>{const n=Date.now();for(const[k,a]of hits){if(!a.some(t=>n-t<6e4))hits.delete(k)}},6e4).unref();
const json=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
const body=req=>new Promise((ok,no)=>{let s='';req.on('data',c=>{s+=c;if(s.length>2e5){no(new Error('big'));req.destroy()}});req.on('end',()=>ok(s));req.on('error',no)});
const ipOf=req=>process.env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress:req.socket.remoteAddress;
async function chat(req,res){
 const key=process.env.GEMINI_API_KEY;
 if(!key)return json(res,503,{code:'no_key',error:'GEMINI_API_KEY غير مضبوط على الخادم'});
 let b;try{b=JSON.parse(await body(req))}catch(e){return json(res,400,{code:'bad_request'})}
 const m=b&&b.messages;
 if(!Array.isArray(m)||!m.length||m.length>20||m.some(x=>!x||!['user','assistant'].includes(x.role)||typeof x.content!=='string'||x.content.length>12000||!x.content.trim()))return json(res,400,{code:'bad_request'});
 const w=limited(ipOf(req));
 if(w==='ip')return json(res,429,{code:'rate_limited'});
 if(w==='day')return json(res,429,{code:'daily_limit'});
 const payload={systemInstruction:{parts:[{text:SYS}]},contents:m.map(x=>({role:x.role==='user'?'user':'model',parts:[{text:x.content}]})),generationConfig:{temperature:.5,maxOutputTokens:4096,...(b.json?{responseMimeType:'application/json'}:{})}};
 let r;
 try{r=await fetch(`${BASE}/models/${encodeURIComponent(MODEL)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)})}
 catch(e){return json(res,504,{code:'offline',error:'تعذر الوصول إلى خدمة Gemini'})}
 if(!r.ok){const t=await r.text().catch(()=>'');
  if(r.status===429)return json(res,429,{code:'quota'});
  if(r.status===401||r.status===403||(r.status===400&&/API key/i.test(t)))return json(res,502,{code:'bad_key'});
  return json(res,502,{code:'upstream'})}
 const j=await r.json().catch(()=>({}));
 const text=((((j.candidates||[])[0]||{}).content||{}).parts||[]).map(p=>p.text||'').join('').trim();
 json(res,200,{text:text||'لم أستطع الإجابة عن هذا السؤال، جرّب صياغة أخرى.'});
}
const server=http.createServer(async(req,res)=>{
 try{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'");
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/api/status'&&req.method==='GET')return json(res,200,{ai:!!process.env.GEMINI_API_KEY});
  if(u.pathname==='/api/chat'){if(req.method!=='POST')return json(res,405,{code:'method'});return await chat(req,res)}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}
  let p=path.normalize(decodeURIComponent(u.pathname));if(p==='/'||p==='\\')p='/index.html';
  const f=path.join(PUB,p);if(!f.startsWith(PUB+path.sep)){res.writeHead(403);return res.end()}
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d)});
 }catch(e){if(!res.headersSent)json(res,500,{code:'server'});else res.end()}
});
if(require.main===module)server.listen(PORT,process.env.HOST||'0.0.0.0',()=>console.log(`http://localhost:${PORT}  |  Gemini: ${process.env.GEMINI_API_KEY?'مفعّل':'غير مفعّل (لا يوجد GEMINI_API_KEY)'}  |  model: ${MODEL}`));
module.exports=server;
