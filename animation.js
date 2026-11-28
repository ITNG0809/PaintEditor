/* ======================================================================
   animation.js — アニメーション（シーン）機能
   シーンエディタ / ブロックエディタ+実行エンジン / クローン・変数・リスト /
   定義ブロック・ペン / カスタム拡張機能(TurboWarp形式)。 window.SCN を公開。
   実行エンジンはTurboWarp/Scratch方式(フレームのスケジューラ・コンパイラ・シルエット当たり判定)。docs/engine.md 参照。
   （旧 paint-editor.html の2つ目の <script> をそのまま移動）
   ※ scratch-compat.js と sound-core.js より後に読み込むこと
   ====================================================================== */
(function(){
'use strict';
/* ============================================================
   シーン(アニメーション)モジュール 第1部: シーンエディタ
   既存のエディタ本体(cs/SPS/dc など)は読み取り専用で参照し、書き換えない。
   データ: S.scenes[] = {id,n,bg,objs[],gvars{},msgs[]}  obj = {id,name,ref,c,x,y,size,dir,vis,ghost,sc[],vars{}}
   obj.c は元コスチューム(エディタのコスチュームオブジェクト)への「参照」。コピーはしない。
   ============================================================ */
const H={};/* 第2部・第3部が差し込むフック */
const SCN={H};window.SCN=SCN;
const q=(s,r)=>(r||document).querySelector(s),el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),nz=(v,d)=>{v=+v;return Number.isFinite(v)?v:(d||0)},rnd=v=>Math.round(v*100)/100;
const normDir=d=>{d=((d%360)+360)%360;return d>180?d-360:d};
let _id=1;const uid=()=>'i'+(_id++).toString(36)+Math.random().toString(36).slice(2,6);
SCN.uid=uid;SCN.clamp=clamp;SCN.nz=nz;SCN.el=el;
Object.assign(IC,{sc_flag:'<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',sc_stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',sc_reset:'<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
sc_film:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5v4M13 5v4M18 5v4"/>',sc_big:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',sc_fs:'<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',sc_fsx:'<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',sc_eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
sc_code:'<rect x="4" y="4" width="9" height="5" rx="1"/><rect x="8" y="10" width="12" height="5" rx="1"/><rect x="4" y="16" width="9" height="4" rx="1"/>',sc_stage:'<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="12" cy="12" r="3"/>',sc_objs:'<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
sc_front:'<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5h10"/>',sc_back:'<rect x="4" y="4" width="11" height="11" rx="1"/><path d="M9 20h11V9"/>',sc_grid:'<path d="M4 4h16v16H4zM12 4v16M4 12h16"/>',sc_ext:'<path d="M10 4a2 2 0 1 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 1 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 1 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 1 0 0-4H5V7a1 1 0 0 1 1-1h4z"/>'});
const S={scenes:[],cur:0,sel:null,big:false,fs:false,panel:'stage',guide:true,open:false,cn:0};
const SC=()=>S.scenes[S.cur],OBJ=()=>{const s=SC();return s&&s.objs.find(o=>o.id===S.sel)||null};
SCN.S=S;SCN.scene=SC;SCN.sel=OBJ;
/* ---------- コスチューム参照 ---------- */
let CI=new Map(),RC=new WeakMap();
function reindex(){spSave();CI=new Map();SPS.forEach(s=>s.cs.forEach((c,i)=>CI.set(c,{s,i})))}
function syncRef(o){const m=o.c&&CI.get(o.c);if(m)o.ref={sp:m.s.n,cn:o.c.n,ci:m.i,st:!!m.s.stage}}
function resolveRef(r){if(!r)return null;const sp=SPS.find(s=>s.n===r.sp);if(!sp)return null;const L=sp.cs.map((c,i)=>[c,i]).filter(a=>a[0].n===r.cn);if(!L.length)return null;return (L.find(a=>a[1]===r.ci)||L[0])[0]}
function bindObj(o){if(o.c&&CI.has(o.c)){syncRef(o);return}o.c=resolveRef(o.ref)}
const ownerOf=c=>CI.get(c)||null;
SCN.reindex=reindex;SCN.ownerOf=ownerOf;
/* ---------- ラスタ化・範囲・当たり判定 ---------- */
function info(c){let r=RC.get(c);if(r)return r;const R=RS(c);r={R,box:null,cv:null,bx:0,by:0,S:2,ctx:null,empty:false};let bb=null;try{bb=thumbBox(c)}catch(e){}
if(bb&&c.k=='b')bb=[bb[0]/R,bb[1]/R,bb[2]/R,bb[3]/R];
if(!bb){r.empty=true;bb=[c.cx/R-12,c.cy/R-12,c.cx/R+12,c.cy/R+12]}
r.box=bb;
if(c.k=='v'&&!r.empty){const x0=bb[0]-1,y0=bb[1]-1,x1=bb[2]+1,y1=bb[3]+1;let Sx=2;while((x1-x0)*Sx>4096||(y1-y0)*Sx>4096)Sx/=2;if(Sx<.05)Sx=.05;
const cv=document.createElement('canvas');cv.width=Math.max(1,Math.ceil((x1-x0)*Sx));cv.height=Math.max(1,Math.ceil((y1-y0)*Sx));const x=cv.getContext('2d',{willReadFrequently:true});x.setTransform(Sx,0,0,Sx,-x0*Sx,-y0*Sx);
try{dc(x,c)}catch(e){}r.cv=cv;r.ctx=x;r.bx=x0;r.by=y0;r.S=Sx;
if(c.sh.some(s=>s.t=='img'&&!s.hid&&!(s.im&&s.im.complete))){/* 画像が未読込なら保存しない */return r}}
RC.set(c,r);return r}
function alphaAt(c,u,v){const r=info(c);let cvs,px,py;
if(c.k=='b'){px=Math.floor(u*r.R);py=Math.floor(v*r.R);if(px<0||py<0||px>=c.w||py>=c.h)return 0;if(c._tp){px-=c._tp.ox;py-=c._tp.oy;cvs=c._tp.cv;if(px<0||py<0||px>=cvs.width||py>=cvs.height)return 0}else cvs=c.bc}
else{if(!r.cv)return 0;px=Math.floor((u-r.bx)*r.S);py=Math.floor((v-r.by)*r.S);if(px<0||py<0||px>=r.cv.width||py>=r.cv.height)return 0;cvs=r.cv}
if(RT){const sl=silOf(cvs);if(sl&&px<sl.w&&py<sl.h)return sl.a[py*sl.w+px]}
try{return cvs.getContext('2d').getImageData(px,py,1,1).data[3]}catch(e){return 0}}
const alive=o=>!!(o.c&&CI.has(o.c));
function lbox(o){const eb=H.extensionBox&&H.extensionBox(o);if(eb)return eb;if(!alive(o))return[-24,-24,24,24];const c=o.c,r=info(c),a=c.cx/r.R,b=c.cy/r.R;return[r.box[0]-a,r.box[1]-b,r.box[2]-a,r.box[3]-b]}
/* 回転方法: all=自由に回転 / lr=左右のみ(左向きは左右反転) / none=回転しない。[角度, 左右反転(1か-1)] */
const rotF=o=>{const r=o.rot;if(r=='none')return[0,1];if(r=='lr')return[0,normDir(o.dir)<0?-1:1];return[(o.dir-90)*Math.PI/180,1]};
/* 伸縮(TurboWarpの「伸縮」拡張): o.stx / o.sty = 横・縦の伸縮%(未設定は100)。負の値は反転、0に近い値は極小に丸める */
const stN=v=>{v=v==null?100:v;return(Math.abs(v)<1e-4?(v<0?-1e-4:1e-4):v)/100},stX=o=>stN(o.stx),stY=o=>stN(o.sty);
const TR=o=>{const[a,f]=rotF(o);return{c:Math.cos(a),s:Math.sin(a),k:Math.max(o.size,1e-6)/100,f,sx:stX(o),sy:stY(o)}};
function toStage(o,lx,ly){const t=TR(o),x=lx*t.k*t.f*t.sx,y=ly*t.k*t.sy;return[240+o.x+x*t.c-y*t.s,180-o.y+x*t.s+y*t.c]}
function toLocal(o,X,Y){const t=TR(o),dx=X-240-o.x,dy=Y-180+o.y;return[(dx*t.c+dy*t.s)/(t.k*t.f*t.sx),(-dx*t.s+dy*t.c)/(t.k*t.sy)]}
function corners(o){const b=lbox(o);return[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].map(p=>toStage(o,p[0],p[1]))}
function hitPix(o,X,Y){if(!o.vis)return false;const[lx,ly]=toLocal(o,X,Y);const eh=H.extensionHit&&H.extensionHit(o,lx,ly);if(eh!=null)return eh;if(!alive(o))return Math.abs(lx)<=24&&Math.abs(ly)<=24;const c=o.c,r=info(c);return alphaAt(c,lx+c.cx/r.R,ly+c.cy/r.R)>10}
function hitBox(o,X,Y){if(!o.vis)return false;const[lx,ly]=toLocal(o,X,Y),b=lbox(o),m=8/TR(o).k;return lx>=b[0]-m&&lx<=b[2]+m&&ly>=b[1]-m&&ly<=b[3]+m}
function pickAt(L,X,Y,loose){for(let i=L.length-1;i>=0;i--)if(hitPix(L[i],X,Y))return L[i];if(loose)for(let i=L.length-1;i>=0;i--)if(hitBox(L[i],X,Y))return L[i];return null}
Object.assign(SCN,{info,alphaAt,lbox,toStage,toLocal,corners,hitPix,pickAt,alive});
/* ---------- 描画 ---------- */
/* コスチュームの「元画像」と描く範囲。cv の (sx,sy,sw,sh) を、コスチューム座標(左上原点・論理px)の (dx,dy,dw,dh) に描く。
   ビットマップは絵のある範囲だけ(compact なら小さなキャンバスから直接)。ベクターはラスタ化済みのキャンバス */
function paintSrc(c,r){if(c.k=='b'){if(r.empty)return null;const R=r.R,b=r.box,t=c._tp;let sx=Math.max(0,Math.floor(b[0]*R)),sy=Math.max(0,Math.floor(b[1]*R)),ex=Math.min(c.w,Math.ceil(b[2]*R)),ey=Math.min(c.h,Math.ceil(b[3]*R)),cv,ox=0,oy=0;
if(t){cv=t.cv;ox=t.ox;oy=t.oy;sx=Math.max(sx,ox);sy=Math.max(sy,oy);ex=Math.min(ex,ox+cv.width);ey=Math.min(ey,oy+cv.height)}else cv=c.bc;
const sw=ex-sx,sh=ey-sy;if(!(sw>0&&sh>0))return null;return{cv,sx:sx-ox,sy:sy-oy,sw,sh,dx:sx/R,dy:sy/R,dw:sw/R,dh:sh/R}}
if(r.cv)return{cv:r.cv,sx:0,sy:0,sw:r.cv.width,sh:r.cv.height,dx:r.bx,dy:r.by,dw:r.cv.width/r.S,dh:r.cv.height/r.S};return null}
function drawObj(x,o,k){if(!o.vis)return;if(H.drawExtension&&H.drawExtension(x,o,k))return;const c=o.c;x.save();x.globalAlpha=clamp(1-o.ghost/100,0,1);x.translate(240+o.x,180-o.y);x.rotate(rotF(o)[0]);const s=Math.max(o.size,0)/100;x.scale(s*rotF(o)[1]*stX(o),s*stY(o));
if(!alive(o)){x.strokeStyle='#e03a5a';x.fillStyle='#e03a5a';x.lineWidth=2;x.setLineDash([5,4]);x.strokeRect(-24,-24,48,48);x.setLineDash([]);x.font='bold 28px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('?',0,2);x.restore();return}
const r=info(c);x.translate(-c.cx/r.R,-c.cy/r.R);
if(c.k=='b'){if(r.empty){x.restore();return}x.imageSmoothingEnabled=(k*s/r.R)<1;const P=paintSrc(c,r);if(P)x.drawImage(P.cv,P.sx,P.sy,P.sw,P.sh,P.dx,P.dy,P.dw,P.dh)}
else if(r.cv){x.imageSmoothingEnabled=true;x.drawImage(r.cv,r.bx,r.by,r.cv.width/r.S,r.cv.height/r.S)}
else if(!r.empty){try{dc(x,c)}catch(e){}}
x.restore()}
SCN.drawObj=drawObj;
const stList=()=>H.list?H.list():(SC()?SC().objs:[]);
function selGeo(o){const b=lbox(o),t=TR(o),O=[240+o.x,180-o.y],P=toStage(o,0,-1),ux=P[0]-O[0],uy=P[1]-O[1],ul=Math.hypot(ux,uy)||1,d=Math.max(34,-b[1]*t.k+22);
const cn=corners(o);let bi=0,bd=-1;cn.forEach((p,i)=>{const dd=Math.hypot(p[0]-O[0],p[1]-O[1]);if(dd>bd){bd=dd;bi=i}});
return{cn,O,rot:[O[0]+ux/ul*d,O[1]+uy/ul*d],sc:cn[bi]}}
/* 背景: ステージのコスチューム(コスチュームエディターで選んでいるもの)を貼り付けて表示。背景色の設定はなし(下地は白)。
   シーンにステージのオブジェクトがあるときは、そのオブジェクトが背景として描かれるので、二重には描きません */
function backdropCost(){const st=SPS.find(s=>s.stage);return st&&st.cs&&st.cs.length?st.cs[clamp(st.ci|0,0,st.cs.length-1)]:null}
function drawBackdrop(x,k){x.fillStyle='#fff';x.fillRect(0,0,480,360);if(stList().some(o=>o.stage))return;const c=backdropCost();if(c&&CI.has(c))drawObj(x,{x:0,y:0,size:100,dir:90,rot:'all',vis:true,ghost:0,c,stage:true},k)}
function drawStage(){const cv=q('#scs');if(!cv||!SC())return;const k=cv.width/480,x=cv.getContext('2d');x.setTransform(k,0,0,k,0,0);x.imageSmoothingEnabled=true;drawBackdrop(x,k);
const run=!!(H.rt&&H.rt());
if(!run&&!S.fs&&S.guide){x.strokeStyle='#8886';x.lineWidth=1/k;x.setLineDash([4,4]);x.beginPath();x.moveTo(240,0);x.lineTo(240,360);x.moveTo(0,180);x.lineTo(480,180);x.stroke();x.setLineDash([])}
if(H.drawPen)H.drawPen(x);stList().forEach(o=>drawObj(x,o,k));if(H.drawMon)H.drawMon(x);if(H.drawBub)H.drawBub(x);
const o=OBJ();if(!run&&o){const g=selGeo(o),sc=cv.clientWidth/480||1,hr=11/sc;x.save();x.lineWidth=2/sc;x.strokeStyle='#855cd6';x.setLineDash([6/sc,4/sc]);x.beginPath();g.cn.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]));x.closePath();x.stroke();x.setLineDash([]);
const tm=[(g.cn[0][0]+g.cn[1][0])/2,(g.cn[0][1]+g.cn[1][1])/2];x.beginPath();x.moveTo(tm[0],tm[1]);x.lineTo(g.rot[0],g.rot[1]);x.stroke();
x.fillStyle='#fff';[g.rot,g.sc].forEach((p,i)=>{x.beginPath();x.arc(p[0],p[1],hr,0,7);x.fill();x.stroke();x.beginPath();x.fillStyle='#855cd6';if(i==0){x.arc(p[0],p[1],hr*.35,0,7)}else x.rect(p[0]-hr*.35,p[1]-hr*.35,hr*.7,hr*.7);x.fill();x.fillStyle='#fff'});
x.beginPath();x.arc(g.O[0],g.O[1],4/sc,0,7);x.fillStyle='#855cd6';x.fill();x.restore()}}
let _dr=0;function redraw(){if(_dr)return;_dr=requestAnimationFrame(()=>{_dr=0;drawStage();drawInfo()})}
SCN.redraw=redraw;SCN.drawNow=()=>{drawStage();drawInfo()};
/* ---------- 保存(自動保存・プロジェクト連携・JSON) ---------- */
function packObj(o){if(alive(o))syncRef(o);return{id:o.id,name:o.name,ref:o.ref,stage:!!o.stage,x:rnd(o.x),y:rnd(o.y),size:rnd(o.size),dir:rnd(o.dir),rot:o.rot||undefined,vis:!!o.vis,ghost:rnd(o.ghost),sc:o.sc,vars:o.vars,lists:o.lists||{}}}
const vFps=v=>{v=Math.round(Number(v));return Number.isFinite(v)&&v>=1&&v<=250?v:30};
const packScene=s=>({id:s.id,n:s.n,bg:s.bg,fps:vFps(s.fps),msgs:s.msgs,gvars:s.gvars,glists:s.glists||{},defs:s.defs||[],objs:s.objs.map(packObj)});
SCN.pack=()=>{reindex();const o={v:1,cur:S.cur,scenes:S.scenes.map(packScene)},x=H.exPack?H.exPack():[];if(x.length)o.exts=x;return o};
let _sv=0,_svWarn=0;function touch(){if(H.liveSync)H.liveSync();clearTimeout(_sv);_sv=setTimeout(()=>{try{localStorage.setItem('ced_scn',JSON.stringify(SCN.pack()))}catch(e){if(!_svWarn){_svWarn=1;toast('シーンの自動保存に失敗しました(容量不足の可能性)。JSONで書き出してください')}}},500)}
SCN.touch=touch;
const vRef=r=>r&&typeof r=='object'&&typeof r.sp=='string'?{sp:r.sp.slice(0,80),cn:String(r.cn==null?'':r.cn).slice(0,80),ci:Math.max(0,r.ci|0),st:!!r.st}:null;
const vLists=v=>{const o={};if(v&&typeof v=='object'&&!Array.isArray(v))Object.keys(v).slice(0,200).forEach(k=>{const a=v[k];if(k&&k.length<=40&&Array.isArray(a))o[k]=a.slice(0,200000).filter(x=>typeof x=='number'&&Number.isFinite(x)||typeof x=='string'||typeof x=='boolean').map(x=>typeof x=='string'?x.slice(0,1000):x)});return o};
const vVars=v=>{const o={};if(v&&typeof v=='object'&&!Array.isArray(v))Object.keys(v).slice(0,200).forEach(k=>{const x=v[k];if(k&&k.length<=40&&(typeof x=='number'&&Number.isFinite(x)||typeof x=='string'||typeof x=='boolean'))o[k]=typeof x=='string'?x.slice(0,200):x});return o};
function vScripts(a,W){if(!Array.isArray(a)||!H.vBlocks)return[];const out=[];for(const s of a.slice(0,300)){if(!s||typeof s!='object'||!Array.isArray(s.b)){W.drop++;continue}const b=H.vBlocks(s.b,W);if(b.length)out.push({id:uid(),x:clamp(nz(s.x),-1e5,1e5),y:clamp(nz(s.y),-1e5,1e5),b})}return out}
function vScene(r,W){if(!r||typeof r!='object')throw Error('シーンのデータが不正です');if(!Array.isArray(r.objs))throw Error('オブジェクトの一覧がありません');if(r.objs.length>500)throw Error('オブジェクトが多すぎます(上限500)');
const s={id:uid(),n:String(r.n||'シーン').slice(0,60),bg:/^#[0-9a-f]{3,8}$/i.test(r.bg)?r.bg:'#ffffff',objs:[],fps:vFps(r.fps),gvars:vVars(r.gvars),glists:vLists(r.glists),defs:vDefs(r.defs),msgs:Array.isArray(r.msgs)?r.msgs.filter(m=>typeof m=='string'&&m&&m.length<=40).slice(0,100):[]};if(!s.msgs.length)s.msgs=['メッセージ1'];
const names=new Set();r.objs.forEach((p,i)=>{if(!p||typeof p!='object'){W.drop++;return}let nm=String(p.name||'オブジェクト'+(i+1)).slice(0,60),b=nm,k=2;while(names.has(nm))nm=b+(k++);names.add(nm);
s.objs.push({id:uid(),name:nm,ref:vRef(p.ref),stage:!!p.stage,c:null,x:clamp(nz(p.x),-1e5,1e5),y:clamp(nz(p.y),-1e5,1e5),size:clamp(nz(p.size,100),0,1e4),dir:normDir(nz(p.dir,90)),rot:p.rot=='lr'||p.rot=='none'?p.rot:undefined,vis:p.vis!==false,ghost:clamp(nz(p.ghost),0,100),sc:vScripts(p.sc,W),vars:vVars(p.vars),lists:vLists(p.lists)})});return s}
SCN.vScene=vScene;
function bindAll(){reindex();RC=new WeakMap();let miss=0;S.scenes.forEach(s=>s.objs.forEach(o=>{bindObj(o);if(!o.c)miss++}));return miss}
SCN.bindAll=bindAll;
SCN.unpack=(d,opt)=>{const W={drop:0};if(!d||!Array.isArray(d.scenes))throw Error('シーンデータの形式が違います');const prevEx=H.exPack?H.exPack():null;if(H.exRestore){const m=H.exRestore(d.exts,opt);if(m)W.exm=m}let L;try{L=d.scenes.slice(0,100).map(r=>vScene(r,W));if(!L.length)throw Error('シーンがありません')}catch(e){if(prevEx&&H.exRestore)H.exRestore(prevEx,{trust:true});throw e}
S.scenes=L;S.cur=clamp(d.cur|0,0,L.length-1);S.sel=null;if(H.reset)H.reset();if(S.open){bindAll();refreshAll()}return W};
function exportScenes(all){reindex();const P=(all?S.scenes:[SC()]).map(packScene);const ex=H.exPack?H.exPack():[];return JSON.stringify(ex.length?{kind:'ced-scene',v:1,scenes:P,exts:ex}:{kind:'ced-scene',v:1,scenes:P})}
async function importText(t){let o;try{o=JSON.parse(t)}catch(e){throw Error('JSONとして読み込めません(ファイルが壊れています)')}
if(!o||typeof o!='object'||o.kind!='ced-scene'||!Array.isArray(o.scenes))throw Error('シーンのファイルではありません');if(!o.scenes.length)throw Error('シーンが含まれていません');
let exm='';if(Array.isArray(o.exts)&&o.exts.length&&H.exMerge)exm=await H.exMerge(o.exts);const W={drop:0},L=[];for(const r of o.scenes.slice(0,100)){try{L.push(vScene(r,W))}catch(e){W.bad=(W.bad||0)+1}}if(!L.length)throw Error('読み込めるシーンがありませんでした');
L.forEach(s=>{s.n=uniqScene(s.n)});S.scenes.push(...L);S.cur=S.scenes.length-L.length;S.sel=null;if(H.reset)H.reset();const miss=bindAll();touch();refreshAll();return{n:L.length,drop:W.drop,bad:W.bad||0,miss,exm}}
const uniqScene=n=>{const used=new Set(S.scenes.map(s=>s.n));if(!used.has(n))return n;const m=n.match(/^(.*?)(\d+)$/),b=m?m[1]:n;let k=m?+m[2]+1:2;while(used.has(b+k))k++;return b+k};
const uniqName=(b,skip)=>{const used=new Set(SC().objs.filter(o=>o!==skip).map(o=>o.name));if(!used.has(b))return b;const m=b.match(/^(.*?)(\d+)$/),s=m?m[1]:b;let k=m?+m[2]+1:2;while(used.has(s+k))k++;return s+k};
SCN.uniqName=uniqName;
/* ---------- シーン・オブジェクト操作 ---------- */
const newScene=n=>({id:uid(),n:n||'シーン1',bg:'#ffffff',fps:30,objs:[],gvars:{},glists:{},defs:[],msgs:['メッセージ1']});
const newObj=(c,name)=>{const o={id:uid(),name:name||'',ref:null,c:c||null,x:0,y:0,size:100,dir:90,vis:true,ghost:0,sc:[],vars:{},lists:{}};if(c)syncRef(o);return o};
SCN.newScene=newScene;
const stopRun=()=>{if(H.reset)H.reset()};
function addObj(c,name){stopRun();const s=SC(),o=newObj(c,uniqName(name||c.n||'オブジェクト'));if(H.attachScratch)H.attachScratch(o,c);let n=0;while(s.objs.some(p=>Math.abs(p.x-o.x)<1&&Math.abs(p.y-o.y)<1&&p.c===c)){n++;o.x+=24;o.y-=24;if(n>40)break}s.objs.push(o);S.sel=o.id;touch();refreshAll();return o}
SCN.addObj=addObj;
function dupObj(o){stopRun();const s=SC(),p=newObj(o.c,uniqName(o.name));Object.assign(p,{ref:o.ref?{...o.ref}:null,x:o.x+20,y:o.y-20,size:o.size,dir:o.dir,rot:o.rot,vis:o.vis,ghost:o.ghost,vars:{...o.vars},lists:JSON.parse(JSON.stringify(o.lists||{})),sc:JSON.parse(JSON.stringify(o.sc)).map(z=>({...z,id:uid()}))});
s.objs.splice(s.objs.indexOf(o)+1,0,p);S.sel=p.id;touch();refreshAll();return p}
async function delObj(o){if(!o)return;if(!await uiConfirm('オブジェクト「'+o.name+'」を削除しますか?\n(このオブジェクトのブロックも消えます。元のコスチュームは消えません)'))return;stopRun();const s=SC(),i=s.objs.indexOf(o);if(i<0)return;s.objs.splice(i,1);S.sel=s.objs.length?s.objs[Math.min(i,s.objs.length-1)].id:null;touch();refreshAll()}
function zmove(o,m){stopRun();const L=SC().objs,i=L.indexOf(o);if(i<0)return;L.splice(i,1);const j=m=='front'?L.length:m=='back'?0:m=='up'?Math.min(L.length,i+1):Math.max(0,i-1);L.splice(j,0,o);touch();refreshAll()}
Object.assign(SCN,{dupObj,delObj,zmove});
/* ---------- 小さなダイアログ ---------- */
function askText(title,val,ok){return new Promise(res=>{const ov=el('div','sc-ov'),d=el('div','sc-dl');d.innerHTML='<h3></h3><input type="text" maxlength="40" autocomplete="off" spellcheck="false"><div class="acts"><button class="sc-b" type="button">キャンセル</button><button class="sc-b pri" type="button"></button></div>';
d.firstChild.textContent=title;const inp=d.children[1],[b0,b1]=d.querySelectorAll('button');b1.textContent=ok||'OK';inp.value=val||'';let done=0;const fin=v=>{if(done)return;done=1;ov.remove();res(v)};
b0.onclick=()=>fin(null);b1.onclick=()=>fin(inp.value.trim()||null);inp.onkeydown=e=>{e.stopPropagation();if(e.isComposing||e.keyCode==229)return;if(e.key=='Enter'){e.preventDefault();fin(inp.value.trim()||null)}else if(e.key=='Escape'){e.preventDefault();fin(null)}};
ov.onpointerdown=e=>{if(e.target===ov)fin(null)};ov.append(d);document.body.append(ov);inp.focus();inp.select()})}
SCN.askText=askText;
function lazyThumbs(items){let i=0;const step=()=>{const t0=performance.now();while(i<items.length&&performance.now()-t0<10){const[cv,c]=items[i++];if(cv.isConnected)spThumb(cv,c)}if(i<items.length)requestAnimationFrame(step)};step()}
function pickCost(title,onPick,keep,only){reindex();const ov=el('div','sc-ov'),d=el('div','sc-dl'),pk=el('div','sc-pk'),th=[];d.innerHTML='<h3></h3>';d.firstChild.textContent=title;
(only?[only]:SPS).forEach(s=>{const h=el('h4');h.textContent=s.stage?'ステージ(背景)':s.n;const g=el('div','g');s.cs.forEach(c=>{const b=el('button',null,'<canvas width="72" height="54"></canvas><span></span>');b.lastChild.textContent=c.n;b.title=c.n;th.push([b.firstChild,c]);b.onclick=()=>{onPick(c);if(!keep)ov.remove()};g.append(b)});pk.append(h,g)});
const ac=el('div','acts'),x=el('button','sc-b pri');x.type='button';x.textContent=keep?'閉じる':'キャンセル';x.onclick=()=>ov.remove();ac.append(x);d.append(pk,ac);ov.onpointerdown=e=>{if(e.target===ov)ov.remove()};ov.append(d);document.body.append(ov);lazyThumbs(th)}
/* スプライト選択: いまあるスプライト(ステージを除く)から選ぶ。配置されるのは、そのスプライトで選択中のコスチューム */
function pickSprite(title,onPick,keep){reindex();const ov=el('div','sc-ov'),d=el('div','sc-dl'),pk=el('div','sc-pk'),th=[];d.innerHTML='<h3></h3>';d.firstChild.textContent=title;const g=el('div','g');let n=0;
SPS.forEach(s=>{if(s.stage||!s.cs||!s.cs.length)return;const c=s.cs[clamp(s.ci|0,0,s.cs.length-1)];n++;const b=el('button',null,'<canvas width="72" height="54"></canvas><span></span><small></small>');b.children[1].textContent=s.n;b.lastChild.textContent=s.cs.length+'個のコスチューム';b.lastChild.style.cssText='font-size:10px;opacity:.7';b.title=s.n;th.push([b.firstChild,c]);b.onclick=()=>{onPick(s,c);if(!keep)ov.remove()};g.append(b)});
if(n)pk.append(g);else{const e=el('div',null,'配置できるスプライトがありません(コスチュームのあるスプライトを作ってください)');e.style.padding='12px 4px';pk.append(e)}
const ac=el('div','acts'),x=el('button','sc-b pri');x.type='button';x.textContent=keep?'閉じる':'キャンセル';x.onclick=()=>ov.remove();ac.append(x);d.append(pk,ac);ov.onpointerdown=e=>{if(e.target===ov)ov.remove()};ov.append(d);document.body.append(ov);lazyThumbs(th)}
SCN.pickCost=pickCost;SCN.pickSprite=pickSprite;
function menuAt(x,y,items){const m=el('div','sc-menu');items.forEach(([t,f,cls])=>{const b=el('button',cls||'');b.type='button';b.textContent=t;b.onclick=()=>{cl();f()};m.append(b)});document.body.append(m);const r=m.getBoundingClientRect();m.style.left=Math.max(4,Math.min(x,innerWidth-r.width-4))+'px';m.style.top=Math.max(4,Math.min(y,innerHeight-r.height-4))+'px';
const cl=()=>{m.remove();removeEventListener('pointerdown',out,true)},out=e=>{if(!m.contains(e.target))cl()};setTimeout(()=>addEventListener('pointerdown',out,true),0)}
SCN.menuAt=menuAt;
/* ---------- エディター切り替え(コスチューム / アニメーション / 音)。どの画面からでも、ほかのエディターへ直接移れる ---------- */
Object.assign(IC,{nv_cos:'<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>',nv_snd:'<path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4"/>',nv_cmp:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'});
const EDNAV={list:[['costume','nv_cos','コスチュームエディター','コスチュームを描く・編集する画面へ'],['anim','sc_film','アニメーションエディター','コスチュームを組み合わせて動かす画面へ'],['sound','nv_snd','音エディター','音の読み込み・波形編集の画面へ'],['composer','nv_cmp','作曲エディター','ピアノロール・ソングで曲を作る画面へ']],
go(t){const SE=window.PaintSoundEditor,seOpen=()=>!!(SE&&SE.state&&SE.state.open),CP=window.PaintComposer;
if(CP&&CP.state.open&&t!='composer')CP.close();
if(t=='composer'){if(S.open){stopRun();touch()}if(CP)CP.open().catch(e=>toast('作曲エディターを開けませんでした: '+e.message))}
else if(t=='costume'){if(S.open)close();if(seOpen())SE.close()}
else if(t=='anim'){if(seOpen())SE.close();if(!S.open)open()}
else if(t=='sound'){if(S.open){stopRun();touch()}if(SE&&!seOpen())SE.open().catch(e=>toast('音エディターを開けませんでした: '+e.message))}},
make(cur,bc){const w=el('span','pe-nav');w.setAttribute('role','navigation');w.setAttribute('aria-label','エディターの切り替え');
EDNAV.list.forEach(([k,i,l,t])=>{const b=el('button',(bc?bc+' ':'')+'pe-nav-b'+(k==cur?' on':''),ic(i,18)+'<span>'+l+'</span>');b.type='button';b.title=t;b.dataset.nav=k;if(k==cur)b.setAttribute('aria-current','page');else b.onclick=()=>EDNAV.go(k);w.append(b)});return w}};
window.PaintNav=EDNAV;
/* ---------- 画面の組み立て ---------- */
let R={};/* DOM参照 */
const BTN=(i,l,t,cls)=>{const b=el('button','sc-b '+(cls||''));b.type='button';b.innerHTML=ic(i,20)+(l?'<span>'+l+'</span>':'');b.title=t||l||'';b.setAttribute('aria-label',t||l||'');return b};
function build(){if(R.root)return;const root=el('div');root.id='scn';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-label','アニメーション(シーンエディタ)');root.dataset.panel='stage';R.root=root;
const top=el('div','sc-top');R.back=EDNAV.make('anim','sc-b');
R.sel=el('select');R.sel.title='シーンを切り替え';R.sel.setAttribute('aria-label','シーン');R.sname=el('input');R.sname.type='text';R.sname.maxLength=60;R.sname.setAttribute('aria-label','シーン名(Enterで確定)');R.sname.title='シーン名を変更';R.sname.style.width='120px';
R.snew=BTN('plus','','新しいシーンを追加');R.sdup=BTN('dup','','シーンを複製');R.sdel=BTN('del','','シーンを削除');
const g1=el('span','sc-grp');g1.append(R.sel,R.sname,R.snew,R.sdup,R.sdel);const sp=el('span','sc-sp'),g2=el('span','sc-grp');R.run=el('span','sc-grp');
R.bigb=BTN('sc_big','','ステージを大きく表示(切り替え)');R.exp=BTN('save','書き出し','シーンをJSONで書き出し');R.imp=BTN('load','読み込み','シーンのJSONを読み込み');R.file=el('input');R.file.type='file';R.file.accept='.json,.scene,application/json';R.file.hidden=true;g2.append(R.bigb,R.exp,R.imp,R.file);
top.append(R.back,g1,sp,R.run,g2);
const body=el('div','sc-body');R.code=H.buildCode?H.buildCode():el('div','p-code');if(!H.buildCode){R.code.hidden=true;body.classList.add('nc')}
const right=el('div','sc-right'),ps=el('div','p-stage'),bar=el('div','sc-stbar');R.gd=BTN('sc_grid','ガイド','中心線(座標0,0)の表示切り替え');const s2=el('span','sc-sp');R.fsb=BTN('sc_fs','全画面','ステージを画面いっぱいに表示(全画面)。Escまたは右上の「戻す」で戻ります');bar.append(R.gd,s2,R.fsb);
const sb=el('div','sc-stbox');R.cv=el('canvas');R.cv.id='scs';R.cv.width=480;R.cv.height=360;R.cv.tabIndex=0;R.cv.setAttribute('aria-label','ステージ(480×360)');sb.append(R.cv);R.info=el('div','sc-info');ps.append(bar,sb,R.info);R.stbox=sb;R.ps=ps;buildFs(ps);
const po=el('div','p-objs'),oh=el('div','sc-oh');R.oadd=BTN('plus','追加','スプライトからオブジェクトを追加');R.odup=BTN('dup','','選択中のオブジェクトを複製');R.odel=BTN('del','','選択中のオブジェクトを削除');
R.ofr=BTN('sc_front','','最前面へ');R.obk=BTN('sc_back','','最背面へ');R.oup=BTN('arrU','','1つ前面へ');R.odn=BTN('arrD','','1つ背面へ');oh.append(R.oadd,R.odup,R.odel,el('span','sc-sp'),R.ofr,R.oup,R.odn,R.obk);
R.ol=el('div','sc-ol');R.ol.setAttribute('role','listbox');R.pr=el('div','sc-pr');po.append(oh,R.ol,R.pr);right.append(ps,po);body.append(R.code,right);
const tabs=el('div','sc-tabs');[['code','sc_code','ブロック'],['stage','sc_stage','ステージ'],['objs','sc_objs','オブジェクト']].forEach(([k,i,l])=>{if(k=='code'&&!H.buildCode)return;const b=el('button','sc-b',ic(i,22)+'<span>'+l+'</span>');b.type='button';b.dataset.p=k;b.onclick=()=>setPanel(k);tabs.append(b)});R.tabs=tabs;
root.append(top,body,tabs);document.body.append(root);if(H.buildRunUI)H.buildRunUI(R.run);buildProps();wire();new ResizeObserver(()=>{if(S.open){fitStage();redraw()}}).observe(body)}
function setPanel(k){S.panel=k;R.root.dataset.panel=k;R.tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.p==k));fitStage();redraw();if(k=='code'&&H.renderWS)H.renderWS()}
function fitStage(){const box=R.stbox,cv=R.cv;if(!box||!box.clientWidth)return;const pd=S.fs?0:8,mw=box.clientWidth-pd,flexy=S.fs||S.big||innerWidth<=900,mh=box.clientHeight-pd;let w=mw;if(flexy&&mh>60)w=Math.min(mw,mh*4/3);else if(!flexy)w=Math.min(mw,Math.max(220,(R.root.clientHeight-130)*.5*4/3));w=Math.max(S.fs?40:160,Math.floor(w));const h=Math.round(w*.75),d=devicePixelRatio||1,k=Math.min(S.fs?4:1e9,Math.max(1,Math.round(w*d)/480));cv.style.width=w+'px';cv.style.height=h+'px';
const W=Math.round(480*k),Hh=Math.round(360*k);if(cv.width!=W||cv.height!=Hh){cv.width=W;cv.height=Hh}}

/* ---------- 全画面(ステージを画面いっぱいに拡大。4:3のまま最大に広げる) ---------- */
function buildFs(ps){const b=el('div','sc-fsbar');R.fsbar=b;
const fl=BTN('sc_flag','','緑の旗(実行を開始)','flag'),st=BTN('sc_stop','','停止','stop'),ex=BTN('sc_fsx','戻す','全画面を終了(Esc)');
fl.onclick=()=>{if(SCN.flag)SCN.flag()};st.onclick=()=>{if(SCN.stopAll)SCN.stopAll()};ex.onclick=()=>fsOff();
b.append(fl,st,ex);ps.append(b);let t=0;
const wake=()=>{if(!S.fs)return;b.classList.remove('idle');clearTimeout(t);t=setTimeout(()=>b.classList.add('idle'),2800)};
ps.addEventListener('pointermove',wake);ps.addEventListener('pointerdown',wake);R.fsWake=wake}
function fsNative(){return document.fullscreenElement||document.webkitFullscreenElement}
function fsOn(){if(S.fs||!R.ps)return;S.fs=true;R.ps.classList.add('fs');R.root.classList.add('fs');
/* 本物の全画面(対応ブラウザ)。iPhoneなど非対応のときは、画面いっぱいの表示だけで代用 */
try{const f=R.ps.requestFullscreen||R.ps.webkitRequestFullscreen;if(f){const p=f.call(R.ps);if(p&&p.catch)p.catch(()=>{})}}catch(e){}
if(R.fsWake)R.fsWake();const fit=()=>{fitStage();redraw()};fit();setTimeout(fit,60);setTimeout(fit,300);try{R.cv.focus({preventScroll:true})}catch(e){}}
function fsOff(){if(!S.fs)return;S.fs=false;R.ps.classList.remove('fs');R.root.classList.remove('fs');
try{if(fsNative()){const x=document.exitFullscreen||document.webkitExitFullscreen;if(x){const p=x.call(document);if(p&&p.catch)p.catch(()=>{})}}}catch(e){}
const fit=()=>{fitStage();redraw()};fit();setTimeout(fit,60);setTimeout(fit,300)}
const fsChange=()=>{if(S.fs&&!fsNative()&&R.fsNat)fsOff();R.fsNat=!!fsNative();if(S.fs){setTimeout(()=>{fitStage();redraw()},30)}};
document.addEventListener('fullscreenchange',fsChange);document.addEventListener('webkitfullscreenchange',fsChange);
addEventListener('resize',()=>{if(S.fs)setTimeout(()=>{fitStage();redraw()},30)});
/* ---------- プロパティ ---------- */
const P={};
function buildProps(){const pr=R.pr;pr.innerHTML='';P.none=el('div','none','オブジェクトを選ぶか、「追加」でスプライトを配置してください。');P.form=el('div');
const row=(...a)=>{const r=el('div','row');r.append(...a);return r},lab=(t,i)=>{const l=el('label');l.append(t,i);return l},num=(k,min,max,w)=>{const i=el('input');i.type='number';i.step='any';i.inputMode='decimal';if(min!=null)i.min=min;if(max!=null)i.max=max;if(w)i.style.width=w;i.dataset.k=k;P[k]=i;return i};
P.name=el('input');P.name.type='text';P.name.maxLength=60;P.name.setAttribute('aria-label','オブジェクト名');
P.cost=el('div','cost');P.cvs=el('canvas');P.cvs.width=72;P.cvs.height=54;P.cname=el('span');P.cchg=BTN('ren','変更','使うコスチュームを変更');P.cost.append(P.cvs,P.cname,P.cchg);
P.vis=el('input');P.vis.type='checkbox';P.vis.setAttribute('aria-label','表示');
P.form.append(row(lab('名前',P.name),lab('表示',P.vis)),row(lab('X',num('x',-1e5,1e5)),lab('Y',num('y',-1e5,1e5)),lab('大きさ%',num('size',0,1e4)),lab('向き°',num('dir',-360,360)),lab('透明度%',num('ghost',0,100))),row(P.cost));
pr.append(P.none,P.form);
P.name.onchange=()=>{const o=OBJ();if(!o)return;stopRun();const v=P.name.value.trim();if(!v){P.name.value=o.name;return}o.name=uniqName(v.slice(0,60),o);P.name.value=o.name;touch();renderList();if(H.renderWS)H.renderWS()};
P.name.onkeydown=e=>{e.stopPropagation();if(e.key=='Enter'){e.preventDefault();P.name.blur()}};
P.vis.onchange=()=>{const o=OBJ();if(!o)return;stopRun();o.vis=P.vis.checked;touch();renderList();redraw()};
['x','y','size','dir','ghost'].forEach(k=>{P[k].oninput=()=>{const o=OBJ();if(!o||P[k].value==='')return;stopRun();let v=nz(P[k].value);if(k=='size')v=clamp(v,0,1e4);else if(k=='ghost')v=clamp(v,0,100);else if(k=='dir'){}else v=clamp(v,-1e5,1e5);o[k]=v;touch();redraw();thumbCur()};
P[k].onchange=()=>{const o=OBJ();if(o){if(k=='dir')o.dir=normDir(o.dir);refreshProps()}};P[k].onkeydown=e=>{e.stopPropagation();if(e.key=='Enter'){e.preventDefault();P[k].blur()}}});
P.cchg.onclick=()=>{const o=OBJ();if(!o)return;const own=alive(o)?ownerOf(o.c).s:null,set=c=>{stopRun();o.c=c;syncRef(o);touch();refreshAll()};/* 使えるのは、そのオブジェクトのスプライトのコスチュームだけ(スプライトが見つからないときだけ選び直し) */
if(own)pickCost('「'+o.name+'」のコスチュームを選ぶ(スプライト: '+own.n+')',set,false,own);else pickSprite('スプライトを選び直す',(s,c)=>set(c))}}
function refreshProps(){const o=OBJ();P.none.hidden=!!o;P.form.hidden=!o;if(!o)return;const a=document.activeElement;
if(a!==P.name)P.name.value=o.name;P.vis.checked=!!o.vis;['x','y','size','dir','ghost'].forEach(k=>{if(a!==P[k]){const v=k=='dir'?normDir(o.dir):o[k];P[k].value=rnd(v)}});
const x=P.cvs.getContext('2d');x.clearRect(0,0,72,54);if(alive(o))spThumb(P.cvs,o.c);else{x.fillStyle='#e03a5a';x.font='bold 30px sans-serif';x.textAlign='center';x.fillText('?',36,38)}
P.cname.textContent=alive(o)?(ownerOf(o.c).s.stage?'(背景) ':'')+o.c.n:'(コスチュームが見つかりません)'}
const thumbCur=(()=>{let t=0;return()=>{clearTimeout(t);t=setTimeout(()=>{const o=OBJ();if(!o)return;const cv=R.ol.querySelector('.sc-oi.on canvas');if(cv&&alive(o))spThumb(cv,o.c)},120)}})();
function renderList(){const s=SC(),L=R.ol;L.innerHTML='';const th=[];[...s.objs].reverse().forEach(o=>{const b=el('div','sc-oi'+(o.id===S.sel?' on':'')+(o.vis?'':' hid'),'<canvas width="72" height="54"></canvas><span class="nm"></span>');b.setAttribute('role','option');b.setAttribute('aria-selected',o.id===S.sel);b.querySelector('.nm').textContent=o.name;b.title=o.name;b.dataset.id=o.id;b.dataset.oid=o.id;
if(!alive(o)){const bd=el('span','bd','<i>?</i>');bd.title='元のコスチュームが見つかりません';b.append(bd);const x=b.firstChild.getContext('2d');x.fillStyle='#e03a5a';x.font='bold 34px sans-serif';x.textAlign='center';x.fillText('?',36,40)}else th.push([b.firstChild,o.c]);
b.onclick=()=>{S.sel=o.id;refreshAll()};L.append(b)});lazyThumbs(th);const on=L.querySelector('.on');if(on&&on.scrollIntoView)on.scrollIntoView({block:'nearest'})}
function drawInfo(){if(!R.info)return;const s=SC();if(!s)return;const miss=s.objs.filter(o=>!alive(o)).length,rt=H.rt&&H.rt();let t=s.objs.length+'個のオブジェクト';if(rt&&H.stat)t+=' / '+H.stat();else{const o=OBJ();if(o)t+=' / 選択: '+o.name+' ('+rnd(o.x)+', '+rnd(o.y)+')'}if(miss)t+=' / ⚠コスチューム未接続 '+miss+'個';R.info.textContent=t}
function refreshAll(){if(!S.open)return;const s=SC();R.sel.innerHTML='';S.scenes.forEach((x,i)=>{const o=el('option');o.value=i;o.textContent=x.n;R.sel.append(o)});R.sel.value=S.cur;syncFps();if(document.activeElement!==R.sname)R.sname.value=s.n;R.sdel.disabled=S.scenes.length<2;
if(S.sel&&!s.objs.some(o=>o.id===S.sel))S.sel=null;if(!S.sel&&s.objs.length)S.sel=s.objs[s.objs.length-1].id;
const o=OBJ(),has=!!o;[R.odup,R.odel,R.ofr,R.obk,R.oup,R.odn].forEach(b=>b.disabled=!has);R.gd.classList.toggle('on',S.guide);R.bigb.classList.toggle('on',S.big);R.root.classList.toggle('big',S.big);
renderList();refreshProps();fitStage();redraw();if(H.refresh)H.refresh()}
SCN.refreshAll=refreshAll;SCN.refreshProps=refreshProps;SCN.renderList=renderList;
/* ---------- ステージ操作(編集モード) ---------- */
function stagePt(e){const r=R.cv.getBoundingClientRect();return[(e.clientX-r.left)*480/r.width,(e.clientY-r.top)*360/r.height]}
let DR=null;
function wire(){const cv=R.cv;
cv.addEventListener('pointerdown',e=>{if(e.button>0||DR)return;const[X,Y]=stagePt(e);
if(H.rt&&H.rt()){if(H.click)H.click(X,Y);e.preventDefault();return}
const o=OBJ(),sc=cv.clientWidth/480||1,hr=16/sc;
if(o){const g=selGeo(o);if(Math.hypot(X-g.rot[0],Y-g.rot[1])<=hr){DR={t:'rot',id:e.pointerId,o};cv.setPointerCapture(e.pointerId);e.preventDefault();return}
if(Math.hypot(X-g.sc[0],Y-g.sc[1])<=hr){const d=Math.hypot(g.sc[0]-g.O[0],g.sc[1]-g.O[1]);if(d>3){DR={t:'sc',id:e.pointerId,o,s0:o.size,d0:d};cv.setPointerCapture(e.pointerId);e.preventDefault();return}}}
const h=pickAt(SC().objs,X,Y,true);if(h){const ch=S.sel!==h.id;S.sel=h.id;DR={t:'mv',id:e.pointerId,o:h,dx:h.x-(X-240),dy:h.y-(180-Y)};cv.setPointerCapture(e.pointerId);cv.focus({preventScroll:true});if(ch){renderList();refreshProps()}redraw()}else{S.sel=null;refreshAll()}e.preventDefault()});
cv.addEventListener('pointermove',e=>{if(!DR||DR.id!==e.pointerId)return;const[X,Y]=stagePt(e),o=DR.o;
if(DR.t=='mv'){o.x=clamp(Math.round(X-240+DR.dx),-1e5,1e5);o.y=clamp(Math.round(180-Y+DR.dy),-1e5,1e5)}
else if(DR.t=='rot'){const a=Math.atan2(X-240-o.x,180-o.y-Y)*180/Math.PI;o.dir=normDir(Math.round(a+90))}
else{const d=Math.hypot(X-240-o.x,180-o.y-Y)||1;o.size=clamp(Math.round(DR.s0*d/DR.d0),1,1e4)}
refreshProps();redraw()});
const end=e=>{if(!DR||DR.id!==e.pointerId)return;DR=null;touch();renderList();refreshProps()};cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
R.fsb.onclick=()=>S.fs?fsOff():fsOn();R.bigb.onclick=()=>{S.big=!S.big;refreshAll();setTimeout(()=>{fitStage();redraw()},0)};R.gd.onclick=()=>{S.guide=!S.guide;R.gd.classList.toggle('on',S.guide);redraw()};
R.oadd.onclick=()=>pickSprite('配置するスプライトを選ぶ(何個でも配置できます)',(s,c)=>addObj(c,s.n),true);
R.odup.onclick=()=>{const o=OBJ();if(o)dupObj(o)};R.odel.onclick=()=>delObj(OBJ());R.ofr.onclick=()=>zmove(OBJ(),'front');R.obk.onclick=()=>zmove(OBJ(),'back');R.oup.onclick=()=>zmove(OBJ(),'up');R.odn.onclick=()=>zmove(OBJ(),'down');
R.sel.onchange=()=>switchScene(+R.sel.value);
R.sname.onkeydown=e=>{e.stopPropagation();if(e.key=='Enter'){e.preventDefault();R.sname.blur()}else if(e.key=='Escape'){R.sname.value=SC().n;R.sname.blur()}};
R.sname.onchange=()=>{const v=R.sname.value.trim().slice(0,60);if(!v){R.sname.value=SC().n;return}SC().n=uniqScene2(v,SC());touch();refreshAll()};
R.snew.onclick=()=>{stopRun();S.scenes.push(newScene(uniqScene('シーン'+(S.scenes.length+1))));switchScene(S.scenes.length-1)};
R.sdup.onclick=()=>{stopRun();reindex();const p=JSON.parse(JSON.stringify(packScene(SC()))),W={drop:0},n=vScene(p,W);n.n=uniqScene(SC().n);n.objs.forEach(o=>bindObj(o));S.scenes.splice(S.cur+1,0,n);switchScene(S.cur+1)};
R.sdel.onclick=async()=>{if(S.scenes.length<2)return;if(!await uiConfirm('シーン「'+SC().n+'」を削除しますか?\n(配置とブロックがすべて消えます。元に戻せません)'))return;stopRun();S.scenes.splice(S.cur,1);S.cur=Math.min(S.cur,S.scenes.length-1);S.sel=null;touch();refreshAll()};
R.exp.onclick=async()=>{let all=false;if(S.scenes.length>1){const v=await uiDlg('どちらを書き出しますか?',[{t:'キャンセル',v:null},{t:'このシーンだけ',v:'one'},{t:'すべてのシーン',v:'all'}],{esc:null,focus:1});if(!v)return;all=v=='all'}
reindex();const t=exportScenes(all);dl(new Blob([t],{type:'application/json'}),(all?'scenes':SC().n.replace(/[\\/:*?"<>|]/g,'_')||'scene')+'.scene.json');toast('シーンをJSONで書き出しました')};
R.imp.onclick=()=>R.file.click();R.file.onchange=e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(f.size>60e6){uiAlert('ファイルが大きすぎます(60MBまで)');return}const r=new FileReader();r.onerror=()=>uiAlert('ファイルを読み込めませんでした');
r.onload=async()=>{try{const x=await importText(String(r.result));let m='シーンを'+x.n+'個読み込みました。';if(x.miss)m+='\n参照できないコスチュームのオブジェクトが'+x.miss+'個あります(「?」表示。コスチュームを選び直せます)。';if(x.drop)m+='\n不正または未対応のデータ'+x.drop+'件を読み飛ばしました。';if(x.exm)m+='\n'+x.exm;if(x.bad)m+='\n壊れたシーン'+x.bad+'個を読み込めませんでした。';await uiAlert(m)}catch(er){uiAlert('読み込みに失敗しました: '+er.message)}};r.readAsText(f)}}
const uniqScene2=(n,skip)=>{const used=new Set(S.scenes.filter(s=>s!==skip).map(s=>s.n));if(!used.has(n))return n;const m=n.match(/^(.*?)(\d+)$/),b=m?m[1]:n;let k=m?+m[2]+1:2;while(used.has(b+k))k++;return b+k};
function switchScene(i){if(!S.scenes[i])return;stopRun();S.cur=i;S.sel=null;bindAll();touch();refreshAll()}
SCN.switchScene=switchScene;
/* ---------- 開く/閉じる ---------- */
function open(){build();try{spLeave()}catch(e){}if(!S.scenes.length)S.scenes=[newScene('シーン1')];const miss=bindAll();S.open=true;R.root.hidden=false;document.body.style.overflow='hidden';if(!R.tabs.querySelector('.on'))setPanel(S.panel);refreshAll();setTimeout(()=>{fitStage();redraw()},30);
if(miss)toast('参照できないコスチュームのオブジェクトが'+miss+'個あります(「?」表示)');if(H.onOpen)H.onOpen()}
function close(){if(!S.open)return;fsOff();stopRun();touch();S.open=false;R.root.hidden=true;try{draw()}catch(e){}}
SCN.open=open;SCN.close=close;
/* ---------- キー操作(シーン画面が開いている間は、既存エディタのショートカットを必ず止める) ---------- */
document.addEventListener('keydown',e=>{if(!S.open)return;e.stopPropagation();const t=e.target;if(/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)||t.isContentEditable||document.querySelector('.sc-ov,#uidlg'))return;
if(e.key=='Escape'&&S.fs){e.preventDefault();fsOff();return}
if(e.key=='Escape'&&!document.querySelector('.sc-menu')){close();return}
if(H.rt&&H.rt())return;const o=OBJ();if(!o)return;const n=e.shiftKey?10:1,m={ArrowLeft:[-n,0],ArrowRight:[n,0],ArrowUp:[0,n],ArrowDown:[0,-n]}[e.key];
if(m){e.preventDefault();o.x+=m[0];o.y+=m[1];touch();refreshProps();redraw()}else if(e.key=='Delete'||e.key=='Backspace'){e.preventDefault();delObj(o)}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()=='d'){e.preventDefault();dupObj(o)}});
document.addEventListener('keyup',e=>{if(S.open)e.stopPropagation()});
/* ---------- 既存エディタとの連携(既存コードは変更せず、外側から包む) ---------- */
(function(){const _ser=window.ser;if(typeof _ser=='function')window.ser=function(n){const t=_ser(n);try{if(!S.scenes.length)return t;const j=JSON.stringify(SCN.pack());return t.slice(0,-1)+',"scn":'+j+'}'}catch(e){return t}};
const _la=window.loadAsync;if(typeof _la=='function')window.loadAsync=async function(t){const r=await _la.apply(this,arguments);try{if(typeof t=='string'&&t.lastIndexOf('"scn":')>=0){const o=JSON.parse(t);if(o&&o.scn){const ok=H.exAsk?await H.exAsk(o.scn.exts):true,W=SCN.unpack(o.scn,{trust:ok});if(W.drop)toast('シーンの不正なデータ'+W.drop+'件を読み飛ばしました');if(W.exm)toast(W.exm)}}}catch(e){toast('プロジェクト内のシーンデータを読み込めませんでした: '+e.message)}return r}})();

/* ============================================================
   第2部: ブロックエディタ + 実行エンジン
   ブロックはデータ(JSON): {op, in:{名前: 値 | ブロック}, c:{SUB:[...], SUB2:[...]}}  スクリプト: {id,x,y,b:[先頭(ハット)ブロック,...]}
   実行はジェネレータ(yieldでフレームを譲る)。複数スクリプト・複数オブジェクト・クローンが同時に進む。
   ============================================================ */
const BK={},CATS=[{id:'event',n:'イベント',c:'#ffbf00'},{id:'motion',n:'動き',c:'#4c97ff'},{id:'looks',n:'見た目',c:'#9966ff'},{id:'control',n:'制御',c:'#ffab19'},{id:'sense',n:'調べる',c:'#5cb1d6'},{id:'op',n:'演算',c:'#59c059'},{id:'msg',n:'メッセージ',c:'#e0a000'}],PAL={event:[],motion:[],looks:[],control:[],sense:[],op:[],msg:[]};
H.BK=BK;H.CATS=CATS;H.PAL=PAL;
const GEN=Object.getPrototypeOf(function*(){}).constructor;
function def(op,cat,kind,tpl,inp,fn,o){o=o||{};const d={op,cat,kind,tpl,inp:inp||{},fn,subs:kind=='c'?['SUB']:kind=='ce'?['SUB','SUB2']:[],nonext:!!o.nonext,els:o.els||'でなければ',pal:o.pal!==false};
d.parts=tpl.split(/(\[[A-Z0-9_]+\])/).filter(x=>x!=='').map(x=>/^\[[A-Z0-9_]+\]$/.test(x)?{i:x.slice(1,-1)}:{t:x});d.gen=!!fn&&fn instanceof GEN;BK[op]=d;if(d.pal&&PAL[cat])PAL[cat].push(op);return d}
H.def=def;
const isEnd=d=>d.kind=='cap'||d.nonext,isRep=d=>d.kind=='r'||d.kind=='b';
/* ---------- 値の変換(Scratch互換) ---------- */
const toNum=v=>{if(typeof v=='number')return Number.isFinite(v)?v:(v!==v?0:v);if(typeof v=='boolean')return v?1:0;const n=Number(v);return Number.isFinite(n)?n:0},
toStr=v=>typeof v=='number'&&!Number.isInteger(v)?String(Math.round(v*1e10)/1e10):String(v),
toBool=v=>{if(typeof v=='boolean')return v;if(typeof v=='string')return!(v===''||v==='0'||v.toLowerCase()==='false');return!!v},
cl=v=>Number.isFinite(v)?Math.max(-1e6,Math.min(1e6,v)):(v!==v?0:Math.sign(v)*1e6),
isNumStr=v=>typeof v=='number'||typeof v=='boolean'||(typeof v=='string'&&v.trim()!==''&&!isNaN(Number(v))),
cmp=(a,b)=>{if(isNumStr(a)&&isNumStr(b))return Number(a)-Number(b);const s=String(a).toLowerCase(),t=String(b).toLowerCase();return s<t?-1:s>t?1:0};
Object.assign(H,{toNum,toStr,toBool,cl});
/* ---------- 実行時の状態 ---------- */
let RT=null,EXA=false;const PEND={};H.rt=()=>RT;
/* ---------- 実行エンジンの設定(TurboWarp/Scratchと同じ考え方) ----------
   ・1フレームの間に、画面に変化が出る(=画面更新が要求される)までスレッドを何周も回す。
     画面を動かさないループ(計算・リスト操作など)は1フレームで何千回でも進む。
   ・1フレームで使う最大時間(WORK_MS)に達したら、その周で打ち切って描画する。
   E.rd = 「このフレームで画面更新が要求された」。動き/見た目/ペンのブロック・待つ・拡張機能の再描画で立つ。 */
const ENG={fps:30,workMs:75,st:{ticks:0,ms:0,passes:0,max:0}};H.engine=ENG;/* st: 実行時間の計測(確認用) */
const E={rd:0};
const RDC={motion:1,looks:1,pen:1};
/* 見えているオブジェクトが変化した時(または隠す/ペン操作の時)だけ、画面更新を要求する */
const rdMark=(T,d)=>{if(RDC[d.cat]&&(T.vis||d.cat=='pen'||d.op=='looks_hide'||(T.pen&&T.pen.down)))E.rd=1};
const now=()=>performance.now();
const costList=T=>{const m=T.c&&ownerOf(T.c);return m?m.s.cs:[]};
function hatIndex(sc){const h={flag:[],click:[],clone:[],msg:[],key:[],gt:[],bd:[],ex:[],xe:[]};sc.forEach(s=>{const f=s.b[0],d=f&&BK[f.op];if(!d||d.kind!='hat')return;if(f.op=='event_whenflag')h.flag.push(s);else if(f.op=='event_whenclicked')h.click.push(s);else if(f.op=='event_whenbroadcast')h.msg.push(s);else if(f.op=='event_whenkey')h.key.push(s);else if(f.op=='event_whengt')h.gt.push(s);else if(f.op=='event_whenbackdrop')h.bd.push(s);else if(f.op=='control_startasclone')h.clone.push(s);else if(d.ex)(d.ex.ev?h.xe:h.ex).push(s)});return h}
function mkTarget(o){const sc=JSON.parse(JSON.stringify(o.sc));return{id:uid(),name:o.name,src:o,stage:!!o.stage,isClone:false,x:o.x,y:o.y,size:o.size,dir:o.dir,rot:o.rot,vis:o.vis,ghost:o.ghost,c:alive(o)?o.c:null,vars:JSON.parse(JSON.stringify(o.vars)),lists:JSON.parse(JSON.stringify(o.lists||{})),sc,hats:hatIndex(sc),dead:false}}
function buildRT(){const s=SC();ENG.fps=vFps(s.fps);SIL=new WeakMap();RT={list:s.objs.map(mkTarget),threads:[],tmap:new Map(),g:JSON.parse(JSON.stringify(s.gvars)),gl:JSON.parse(JSON.stringify(s.glists||{})),lmon:{},mon:{},clones:0,raf:0,next:0,err:null,t0:now(),ans:''};R.root.classList.add('run');updateRunUI();R.root.classList.add('run');if(H.renderWS)H.renderWS()}
H.list=()=>RT?RT.list:(SC()?SC().objs:[]);
/* ---------- 実行中のブロック編集: 編集内容を、動いているオブジェクトとクローンへ反映 ----------
   ・動作中のスクリプトはそのまま続きます(次に起動するときから新しい内容)。
   ・消したスクリプトは止まります。足した変数・リスト・定義ブロックはすぐ使えます。 */
let _ls=0;
H.liveSync=()=>{if(!RT||_ls)return;_ls=setTimeout(()=>{_ls=0;liveApply()},40)};
function liveApply(){if(!RT)return;const sc=SC();if(!sc)return;
for(const k of Object.keys(sc.gvars||{}))if(!Object.prototype.hasOwnProperty.call(RT.g,k))RT.g[k]=JSON.parse(JSON.stringify(sc.gvars[k]));
for(const k of Object.keys(sc.glists||{}))if(!Object.prototype.hasOwnProperty.call(RT.gl,k))RT.gl[k]=JSON.parse(JSON.stringify(sc.glists[k]));
let hatLoop=false;
for(const o of sc.objs){const ts=RT.list.filter(T=>T.src===o);if(!ts.length)continue;
const nsc=JSON.parse(JSON.stringify(o.sc)),nh=hatIndex(nsc),oh=ts[0].hats||{};
['gt','ex','xe'].forEach(k=>{const m=new Map((oh[k]||[]).map(s=>[s.id,s._on]));(nh[k]||[]).forEach(s=>{if(m.has(s.id))s._on=m.get(s.id)})});
const ids=new Set(nsc.map(s=>s.id));
for(const T of ts){T.sc=nsc;T.hats=nh;for(const k of Object.keys(o.vars||{}))if(!Object.prototype.hasOwnProperty.call(T.vars,k))T.vars[k]=JSON.parse(JSON.stringify(o.vars[k]));for(const k of Object.keys(o.lists||{}))if(!Object.prototype.hasOwnProperty.call(T.lists,k))T.lists[k]=JSON.parse(JSON.stringify(o.lists[k]))}
/* 消されたスクリプトは止める */
for(const th of RT.threads)if(!th.dead&&ts.includes(th.T)&&!ids.has(th.s.id)){th.dead=true;th.stop=true}
if((nh.gt&&nh.gt.length)||(nh.ex&&nh.ex.length))hatLoop=true}
if(hatLoop&&!RT.halt)ensureLoop();
if(H.renderWS&&WS.wsc)markRunning()}
/* ---------- スレッド ---------- */
function startScript(T,s){const key=T.id+'|'+s.id,old=RT.tmap.get(key);if(old)old.dead=true;const th={T,s,key,dead:false,stop:false};th.gen=scriptGen(s,T,th);RT.threads.push(th);RT.tmap.set(key,th);ensureLoop();return th}
function* runList(arr,T,th){for(let i=0;i<arr.length;i++){if(th.stop||T.dead)return;yield* execBlock(arr[i],T,th)}}
function ev(x,T,th){if(x&&typeof x=='object'){const d=BK[x.op];if(!d||!d.fn)return 0;const A={};for(const k in d.inp)A[k]=ev(x.in?x.in[k]:undefined,T,th);return d.fn(T,A,th,x)}return x}
/* 非同期の拡張ブロック(Promiseを返す値ブロック)を待つための評価: 値ブロックがPENDを投げたら、完了まで待ってから式を評価し直す(解決済みの値は th.pc に保存) */
function* evg(x,T,th){if(!(x&&typeof x=='object'))return x;const own=!th.pc;if(own)th.pc=new Map();
try{for(;;){try{return ev(x,T,th)}catch(e){if(e!==PEND)throw e;const w=th.pw;th.pw=null;let st=0,v,er;w.p.then(r=>{st=1;v=r},r=>{st=2;er=r});
while(!st){yield;if(th.stop||T.dead)return 0}if(st==2){exErr(er);v=''}th.pc.set(w.b,exVal(BK[w.b.op],v))}}}finally{if(own)th.pc=null}}
const sub=(b,k)=>(b.c&&b.c[k])||[];
function* execBlock(b,T,th){const d=BK[b.op];if(!d)return;
switch(b.op){
case'control_repeat':{const n=Math.floor(toNum((EXA?(yield* evg(b.in.TIMES,T,th)):ev(b.in.TIMES,T,th)))+.5),L=sub(b,'SUB');for(let i=0;i<n;i++){yield* runList(L,T,th);if(th.stop||T.dead)return;if(WY(th))yield 1}return}
case'control_forever':{const L=sub(b,'SUB');for(;;){yield* runList(L,T,th);if(th.stop||T.dead)return;if(WY(th))yield 1}}
case'control_if':{if(toBool((EXA?(yield* evg(b.in.COND,T,th)):ev(b.in.COND,T,th))))yield* runList(sub(b,'SUB'),T,th);return}
case'control_ifelse':{yield* runList(sub(b,toBool((EXA?(yield* evg(b.in.COND,T,th)):ev(b.in.COND,T,th)))?'SUB':'SUB2'),T,th);return}
case'control_repeatuntil':{const L=sub(b,'SUB');while(!toBool((EXA?(yield* evg(b.in.COND,T,th)):ev(b.in.COND,T,th)))){yield* runList(L,T,th);if(th.stop||T.dead)return;if(WY(th))yield 1}return}
case'control_waituntil':{while(!toBool((EXA?(yield* evg(b.in.COND,T,th)):ev(b.in.COND,T,th)))){yield;if(th.stop||T.dead)return}return}
case'control_wait':{const end=now()+Math.max(0,toNum((EXA?(yield* evg(b.in.SECS,T,th)):ev(b.in.SECS,T,th))))*1000;E.rd=1;do{yield;if(th.stop||T.dead)return}while(now()<end);return}
}
if(!d.fn||isRep(d)||d.kind=='hat')return;const A={};for(const k in d.inp)A[k]=(EXA?(yield* evg(b.in?b.in[k]:undefined,T,th)):ev(b.in?b.in[k]:undefined,T,th));if(d.ex){yield* exRun(b,d,T,th,A);return}if(d.gen){const g=d.fn(T,A,th,b);for(;;){const r=g.next();if(T.pen&&T.pen.down)penTrack(T);rdMark(T,d);if(r.done)break;yield}}else{d.fn(T,A,th,b);rdMark(T,d)}if(T.pen&&T.pen.down)penTrack(T)}
/* ---------- 第2部b: コンパイラ(TurboWarp方式) ----------
   ブロックの木をJavaScriptの関数(ジェネレータ)に変換してから実行する。
   ・ブロックごとの検索・引数オブジェクトの作成・ジェネレータの入れ子をなくして速くする
   ・動作はインタプリタ(execBlock/runList)と同じ。判定・計算は同じ関数を使う
   ・拡張機能のブロックなど、変換できないものを含むスクリプトは、自動でインタプリタに戻す
   ・変換結果はスクリプトごとに1回だけ作る(実行ごとにスクリプトの写しを作るので、編集内容は常に反映される)
   ENG.compile=false にすると全部インタプリタで動く(動作確認・不具合切り分け用) */
ENG.compile=true;
const CJ=new WeakMap();let HPC=null;
function* G(g,T,d){for(;;){const r=g.next();if(T.pen&&T.pen.down)penTrack(T);rdMark(T,d);if(r.done)break;yield}}
const AND=(x,y)=>x&&y,OR=(x,y)=>x||y;
const PA=(th,p)=>{const m=th.as&&th.as[th.as.length-1];return m&&p in m?m[p]:0},PB=(th,p)=>{const m=th.as&&th.as[th.as.length-1];return m&&p in m?toBool(m[p]):false};
const cjLit=v=>v===undefined?'undefined':v===null?'null':typeof v=='number'?(Number.isFinite(v)?(Object.is(v,-0)?'-0':String(v)):'0'):typeof v=='boolean'?String(v):typeof v=='string'?JSON.stringify(v):null;
/* 計算が決まっている主なブロック(定義と同じ式を直接書く)。a,b は引数の式 */
const CJX={
op_add:a=>'(toNum('+a.A+')+toNum('+a.B+'))',op_sub:a=>'(toNum('+a.A+')-toNum('+a.B+'))',op_mul:a=>'(toNum('+a.A+')*toNum('+a.B+'))',op_div:a=>'(toNum('+a.A+')/toNum('+a.B+'))',
op_gt:a=>'(cmp('+a.A+','+a.B+')>0)',op_lt:a=>'(cmp('+a.A+','+a.B+')<0)',op_eq:a=>'(cmp('+a.A+','+a.B+')===0)',
op_and:a=>'AND(toBool('+a.A+'),toBool('+a.B+'))',op_or:a=>'OR(toBool('+a.A+'),toBool('+a.B+'))',op_not:a=>'(!toBool('+a.A+'))',
op_join:a=>'(toStr('+a.A+')+toStr('+a.B+'))',op_round:a=>'Math.round(toNum('+a.A+'))',op_length:a=>'Array.from(toStr('+a.A+')).length',
var_get:a=>'getVar(T,String('+a.VAR+'))',
motion_xpos:()=>'(Math.round(T.x*1e6)/1e6)',motion_ypos:()=>'(Math.round(T.y*1e6)/1e6)',sense_x:()=>'(Math.round(T.x*1e6)/1e6)',sense_y:()=>'(Math.round(T.y*1e6)/1e6)',
sense_size:()=>'(Math.round(T.size*1e6)/1e6)',sense_dir:()=>'(Math.round(T.dir*1e6)/1e6)',motion_dir:()=>'T.dir',sense_visible:()=>'(!!T.vis)'};
/* 命令ブロック(式の組み立ては引数が先に評価されるのを保つ) */
const CJS={
motion_move:a=>'{const n=toNum('+a.N+'),r=T.dir*Math.PI/180;T.x=cl(T.x+n*Math.sin(r));T.y=cl(T.y+n*Math.cos(r))}',
motion_turn:a=>'T.dir=normDir(T.dir+toNum('+a.DEG+'));',motion_turnleft:a=>'T.dir=normDir(T.dir-toNum('+a.DEG+'));',
motion_goto:a=>'{const x=toNum('+a.X+'),y=toNum('+a.Y+');T.x=cl(x);T.y=cl(y)}',
motion_xset:a=>'T.x=cl(toNum('+a.X+'));',motion_yset:a=>'T.y=cl(toNum('+a.Y+'));',
motion_xchange:a=>'{const v=toNum('+a.DX+');T.x=cl(T.x+v)}',motion_ychange:a=>'{const v=toNum('+a.DY+');T.y=cl(T.y+v)}',
motion_pointdir:a=>'T.dir=normDir(toNum('+a.DIR+'));',
var_set:a=>'{const n=String('+a.VAR+'),v='+a.V+';setVar(T,n,v)}',
var_change:a=>'{const n=String('+a.VAR+'),v='+a.V+',o=getVar(T,n);setVar(T,n,toNum(o)+toNum(v))}',
looks_show:()=>'T.vis=true;',looks_hide:()=>'T.vis=false;'};
function cjBuild(arr){
const K=[];let ok=true,uq=0;const kr=v=>{K.push(v);return'K['+(K.length-1)+']'};
const ex=x=>{if(!(x&&typeof x=='object')){const l=cjLit(x);return l!==null?l:kr(x)}
const d=BK[x.op];if(!d||!d.fn)return'0';if(d.ex){ok=false;return'0'}
const a={};let o='';for(const k in d.inp){a[k]=ex(x.in?x.in[k]:undefined);o+=(o?',':'')+JSON.stringify(k)+':'+a[k]}
if(x.op=='proc_arg')return'PA(th,'+JSON.stringify(String(x.in.P))+')';if(x.op=='proc_argb')return'PB(th,'+JSON.stringify(String(x.in.P))+')';
const f=CJX[x.op];if(f&&BK[x.op].cjok!==false)return f(a);return kr(d.fn)+'(T,{'+o+'},th,'+kr(x)+')'};
const body=(b,k)=>{let o='';const a=(b.c&&b.c[k])||[];for(const y of a)o+=st(y);return o};
const rdc=d=>d.cat=='pen'||d.op=='looks_hide'?'E.rd=1;':(d.cat=='motion'||d.cat=='looks')?'if(T.vis||(T.pen&&T.pen.down))E.rd=1;':'';
const st=b=>{const d=BK[b.op];let o='if(th.stop||T.dead)return;\n';if(!d)return o;const id=++uq,tail='if(th.stop||T.dead)return;if(WY(th))yield 1;';
switch(b.op){
case'control_repeat':return o+'{const n'+id+'=Math.floor(toNum('+ex(b.in.TIMES)+')+.5);for(let i'+id+'=0;i'+id+'<n'+id+';i'+id+'++){\n'+body(b,'SUB')+tail+'}}\n';
case'control_forever':return o+'for(;;){\n'+body(b,'SUB')+tail+'}\n';
case'control_if':return o+'if(toBool('+ex(b.in.COND)+')){\n'+body(b,'SUB')+'}\n';
case'control_ifelse':return o+'if(toBool('+ex(b.in.COND)+')){\n'+body(b,'SUB')+'}else{\n'+body(b,'SUB2')+'}\n';
case'control_repeatuntil':return o+'while(!toBool('+ex(b.in.COND)+')){\n'+body(b,'SUB')+tail+'}\n';
case'control_waituntil':return o+'while(!toBool('+ex(b.in.COND)+')){yield;if(th.stop||T.dead)return}\n';
case'control_wait':return o+'{const e'+id+'=now()+Math.max(0,toNum('+ex(b.in.SECS)+'))*1000;E.rd=1;do{yield;if(th.stop||T.dead)return}while(now()<e'+id+')}\n'}
if(!d.fn||isRep(d)||d.kind=='hat')return o;if(d.ex){ok=false;return o}
const a={};let args='';for(const k in d.inp){a[k]=ex(b.in?b.in[k]:undefined);args+=(args?',':'')+JSON.stringify(k)+':'+a[k]}
const f=CJS[b.op];
if(f)o+=f(a)+'\n'+rdc(d)+'\n';
else{const call=kr(d.fn)+'(T,{'+args+'},th,'+kr(b)+')';o+=d.gen?'yield* G('+call+',T,'+kr(d)+');\n':call+';\n'+rdc(d)+'\n'}
return o+'if(T.pen&&T.pen.down)penTrack(T);\n'};
let src='';try{for(const b of arr)src+=st(b)}catch(e){return null}
if(!ok||src.length>3e6)return null;
if(!HPC)HPC={E,toNum,toStr,toBool,cmp,cl,normDir,getVar,setVar,WY,G,penTrack,now,AND,OR,PA,PB};
try{const n=Object.keys(HPC);return new Function('K',...n,'return function*(T,th){\n'+src+'}')(K,...n.map(k=>HPC[k]))}catch(e){console.warn('コンパイルできないためインタプリタで実行します',e);return null}}
/* スクリプト(先頭のハットを除く本体)を動かすジェネレータを返す。コンパイル済みならそれ、だめならインタプリタ */
function scriptGen(s,T,th){if(ENG.compile===false)return runList(s.b.slice(1),T,th);let f=CJ.get(s);if(f===undefined){f=cjBuild(s.b.slice(1));CJ.set(s,f)}return f?f(T,th):runList(s.b.slice(1),T,th)}
H.scriptGen=scriptGen;
function ensureLoop(){if(!RT||RT.raf)return;RT.next=now();RT.raf=requestAnimationFrame(loop)}
/* 1フレーム分の実行(Scratchの Sequencer.stepThreads と同じ):
   全スレッドを1周 → まだ動けるスレッドがあり、画面更新が要求されておらず、時間に余裕があれば、もう1周。 */
function tickAll(){const t0=now();E.rd=0;const st=ENG.st;st.ticks++;
for(;;){let act=0;const L=RT.threads;st.passes++;const lim=L.length*2+5000;/* 自分自身にメッセージを送り続けるなど、1周の中でスレッドが増え続けても必ず戻れるようにする上限 */
for(let i=0;i<L.length&&i<lim;i++){const th=L[i];if(th.dead||th.T.dead){th.dead=true;continue}
try{const r=th.gen.next();if(r.done)th.dead=true;else if(r.value===1)act++}catch(e){th.dead=true;if(!RT.err){RT.err=e;toast('実行エラー: '+(e&&e.message||e))}console.error(e)}}
let k=0;for(let i=0;i<L.length;i++){const t=L[i];if(t.dead){if(RT.tmap.get(t.key)===t)RT.tmap.delete(t.key)}else L[k++]=t}L.length=k;
if(!act||E.rd||!L.length||now()-t0>=ENG.workMs)break}const dt=now()-t0;st.ms+=dt;if(dt>st.max)st.max=dt}
function loop(){if(!RT)return;RT.raf=-1;/* 実行中は予約済み扱い(tick中にスレッドが始まっても二重に予約しない) */const t=now(),fi=1000/ENG.fps;
if(t>=RT.next-1){tickAll();RT.next+=fi;if(RT.next<t-fi)RT.next=t;SCN.drawNow()}
if(!RT)return;RT.raf=0;if(RT.threads.length||(!RT.halt&&RT.list.some(T=>(T.hats.gt&&T.hats.gt.length)||(T.hats.ex&&T.hats.ex.length))))RT.raf=requestAnimationFrame(loop);else updateRunUI()}
function flag(){if(!S.open)return;if(H.stopSound)H.stopSound();if(!RT)buildRT();else killAll();RT.halt=0;RT.t0=now();RT.list.forEach(T=>{(T.hats.gt||[]).forEach(s=>{s._on=false});T.xon=null});for(const T of RT.list.slice())for(const s of T.hats.flag)startScript(T,s);ensureLoop();SCN.drawNow();updateRunUI()}
function killAll(){if(!RT)return;RT.threads.forEach(t=>{t.dead=true;t.stop=true});RT.threads=[];RT.tmap.clear();const L=RT.list.filter(t=>!t.isClone);RT.list.forEach(t=>{if(t.isClone)t.dead=true});RT.list=L;RT.clones=0}
function stopAll(){if(H.stopSound)H.stopSound();if(!RT)return;RT.halt=1;killAll();SCN.drawNow();updateRunUI()}
function reset(){micStop();if(H.stopSound)H.stopSound();if(!RT){updateRunUI();return}killAll();if(RT.raf)cancelAnimationFrame(RT.raf);RT=null;if(R.root){R.root.classList.remove('run');updateRunUI();SCN.drawNow();if(H.renderWS)H.renderWS();refreshProps()}}
H.reset=reset;
function click(X,Y){if(!RT)return;const T=pickAt(RT.list,X,Y,false);if(!T)return;for(const s of T.hats.click)startScript(T,s)}
H.click=click;H.stat=()=>RT?'スレッド '+RT.threads.length+(H.cloneStat?' / '+H.cloneStat():''):'';
function broadcast(msg){const out=[],m=String(msg).toLowerCase();for(const T of RT.list.slice())for(const s of T.hats.msg){if(String(s.b[0].in.MSG).toLowerCase()===m)out.push(startScript(T,s))}return out}
Object.assign(H,{startScript,broadcast,stopAll,killAll,hatIndex,ev,runList});
/* ---------- 当たり判定(ピクセル単位) ---------- */
const CV2=[document.createElement('canvas'),document.createElement('canvas')],CX2=CV2.map(c=>c.getContext('2d',{willReadFrequently:true}));
const aabb=cn=>[Math.min(...cn.map(p=>p[0])),Math.min(...cn.map(p=>p[1])),Math.max(...cn.map(p=>p[0])),Math.max(...cn.map(p=>p[1]))];
const mask=(x,o)=>drawObj(x,{x:o.x,y:o.y,size:o.size,dir:o.dir,rot:o.rot,stx:o.stx,sty:o.sty,vis:true,ghost:0,c:o.c},1);
function overlapSlow(a,b){if(!a.vis||!b.vis||!alive(a)||!alive(b))return false;const A=aabb(corners(a)),B=aabb(corners(b));let x0=Math.max(A[0],B[0],-100),y0=Math.max(A[1],B[1],-100),x1=Math.min(A[2],B[2],580),y1=Math.min(A[3],B[3],460);if(x1<=x0||y1<=y0)return false;
x0=Math.floor(x0);y0=Math.floor(y0);const W=Math.ceil(x1)-x0,Hh=Math.ceil(y1)-y0;if(W<=0||Hh<=0)return false;
const D=[a,b].map((o,i)=>{const c=CV2[i];c.width=W;c.height=Hh;const x=CX2[i];x.setTransform(1,0,0,1,-x0,-y0);mask(x,o);x.setTransform(1,0,0,1,0,0);return x.getImageData(0,0,W,Hh).data});
for(let i=3;i<D[0].length;i+=4)if(D[0][i]>0&&D[1][i]>0)return true;return false}
function touchEdgeSlow(a){if(!a.vis)return false;const bb=aabb(corners(a));if(bb[0]>0&&bb[1]>0&&bb[2]<480&&bb[3]<360)return false;if(bb[2]<0||bb[0]>480||bb[3]<0||bb[1]>360)return true;if(!alive(a))return true;
const x0=Math.floor(bb[0]),y0=Math.floor(bb[1]),W=Math.min(Math.ceil(bb[2])-x0,3000),Hh=Math.min(Math.ceil(bb[3])-y0,3000);const c=CV2[0];c.width=W;c.height=Hh;const x=CX2[0];x.setTransform(1,0,0,1,-x0,-y0);mask(x,a);x.setTransform(1,0,0,1,0,0);const D=x.getImageData(0,0,W,Hh).data;
for(let j=0;j<Hh;j++){const py=y0+j,yo=py<=0||py>=360;for(let i=0;i<W;i++){if(D[(j*W+i)*4+3]>0){const px=x0+i;if(yo||px<=0||px>=480)return true}}}return false}
/* ---------- 当たり判定の高速化(TurboWarpのシルエット方式) ----------
   実行中は、コスチュームの透明度を最初の1回だけ配列に読み出して使い回す。
   ・「触れた」「端に触れた」「クリックの判定」で、キャンバスの作り直しやピクセルの読み出しをしない
   ・ステージの1ピクセルごとに、各オブジェクトの絵の上の位置を求めて、透明でないか調べる(Scratchと同じ最近傍)
   ・文字(拡張機能)のオブジェクトなど、配列にできないものは従来の計算にする */
let SIL=new WeakMap();/* canvas → {w,h,a:透明度の配列} (実行のたびに作り直す) */
function silOf(cv){if(!cv)return null;let m=SIL.get(cv);const w=cv.width,h=cv.height;if(m&&m.w===w&&m.h===h)return m;if(!w||!h)return null;
try{const d=cv.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,a=new Uint8Array(w*h);for(let i=0,j=3;i<a.length;i++,j+=4)a[i]=d[j];m={w,h,a};SIL.set(cv,m);return m}catch(e){return null}}
/* オブジェクトの「ステージ座標 → 絵のピクセル」の一次式(px=ax*X+bx*Y+cx, py=ay*X+by*Y+cy)と透明度の配列 */
function silPack(o){const c=o.c,r=info(c);let cvs,ku,ox,oy;
if(c.k=='b'){if(r.empty)return{empty:1};if(c._tp){cvs=c._tp.cv;ox=c.cx-c._tp.ox;oy=c.cy-c._tp.oy}else{cvs=c.bc;ox=c.cx;oy=c.cy}ku=r.R}else{if(!r.cv||r.empty)return{empty:1};cvs=r.cv;ku=r.S;ox=(c.cx/r.R-r.bx)*r.S;oy=(c.cy/r.R-r.by)*r.S}
const sl=silOf(cvs);if(!sl)return null;const t=TR(o),k=t.k;
const kx=k*t.sx,ky=k*t.sy;
return{w:sl.w,h:sl.h,a:sl.a,ax:t.c/kx*ku,bx:t.s/kx*ku,cx:(-(240+o.x)*t.c+(o.y-180)*t.s)/kx*ku+ox,ay:-t.s/ky*ku,by:t.c/ky*ku,cy:((240+o.x)*t.s+(o.y-180)*t.c)/ky*ku+oy}}
const silOk=o=>!(H.extensionBox&&H.extensionBox(o));
function overlapFast(a,b){if(!silOk(a)||!silOk(b))return null;if(a.size<=0||b.size<=0)return false;
const A=aabb(corners(a)),B=aabb(corners(b));let x0=Math.max(A[0],B[0],-100),y0=Math.max(A[1],B[1],-100),x1=Math.min(A[2],B[2],580),y1=Math.min(A[3],B[3],460);if(x1<=x0||y1<=y0)return false;
x0=Math.floor(x0);y0=Math.floor(y0);x1=Math.ceil(x1);y1=Math.ceil(y1);if(x1<=x0||y1<=y0)return false;
const p=silPack(a),q=silPack(b);if(!p||!q)return null;if(p.empty||q.empty)return false;
const pw=p.w,ph=p.h,pa=p.a,qw=q.w,qh=q.h,qa=q.a,xs=x0+.5;
for(let Y=y0;Y<y1;Y++){const yc=Y+.5;let ux=p.ax*xs+p.bx*yc+p.cx,uy=p.ay*xs+p.by*yc+p.cy,vx=q.ax*xs+q.bx*yc+q.cx,vy=q.ay*xs+q.by*yc+q.cy;
for(let X=x0;X<x1;X++){if(ux>=0&&uy>=0&&ux<pw&&uy<ph&&pa[(uy|0)*pw+(ux|0)]&&vx>=0&&vy>=0&&vx<qw&&vy<qh&&qa[(vy|0)*qw+(vx|0)])return true;ux+=p.ax;uy+=p.ay;vx+=q.ax;vy+=q.ay}}
return false}
function touchEdgeFast(a){if(!silOk(a))return null;if(a.size<=0)return false;const bb=aabb(corners(a));
const x0=Math.floor(bb[0]),y0=Math.floor(bb[1]),x1=x0+Math.min(Math.ceil(bb[2])-x0,3000),y1=y0+Math.min(Math.ceil(bb[3])-y0,3000);
const p=silPack(a);if(!p)return null;if(p.empty)return false;const pw=p.w,ph=p.h,pa=p.a;
const row=(Y,xa,xb)=>{if(xb<xa)return false;const yc=Y+.5,xs=xa+.5;let ux=p.ax*xs+p.bx*yc+p.cx,uy=p.ay*xs+p.by*yc+p.cy;
for(let X=xa;X<=xb;X++){if(ux>=0&&uy>=0&&ux<pw&&uy<ph&&pa[(uy|0)*pw+(ux|0)])return true;ux+=p.ax;uy+=p.ay}return false};
for(let Y=y0;Y<y1;Y++){if(Y<=0||Y>=360){if(row(Y,x0,x1-1))return true}else{if(row(Y,x0,Math.min(0,x1-1)))return true;if(row(Y,Math.max(480,x0),x1-1))return true}}
return false}
function overlap(a,b){if(!a.vis||!b.vis||!alive(a)||!alive(b))return false;const f=RT?overlapFast(a,b):null;return f===null?overlapSlow(a,b):f}
function touchEdge(a){if(!a.vis)return false;const bb=aabb(corners(a));if(bb[0]>0&&bb[1]>0&&bb[2]<480&&bb[3]<360)return false;if(bb[2]<0||bb[0]>480||bb[3]<0||bb[1]>360)return true;if(!alive(a))return true;const f=RT?touchEdgeFast(a):null;return f===null?touchEdgeSlow(a):f}
Object.assign(H,{overlap,touchEdge});
/* ---------- ブロック定義 ---------- */
def('event_whenflag','event','hat','緑の旗が押されたとき');
def('event_whenkey','event','hat','[KEY]キーが押されたとき',{KEY:['m','key','space']});
/* キーが押されたとき: 実行中(緑の旗の後)にキーボードを押すと、該当するブロックのスクリプトを起動する */
function keyIds(e){const s=new Set(),k=e.key||'',c=e.code||'';let m;
if(k.length==1&&/[a-z0-9]/i.test(k))s.add(k.toLowerCase());
else{if(m=/^Key([A-Z])$/.exec(c))s.add(m[1].toLowerCase());else if(m=/^(?:Digit|Numpad)([0-9])$/.exec(c))s.add(m[1]);if(k.length==1&&k!=' ')s.add(k)}
if(k==' '||c=='Space')s.add('space');
const n={Enter:'enter',Shift:'shift',Control:'control',Alt:'alt',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'}[k];if(n)s.add(n);if(c=='NumpadEnter')s.add('enter');return s}
document.addEventListener('keydown',e=>{if(!S.open||!RT)return;const t=e.target;if(/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)||t.isContentEditable||document.querySelector('.sc-ov,#uidlg'))return;
const ids=keyIds(e);if(!ids.size)return;let hit=false;
for(const T of RT.list.slice())for(const s of T.hats.key){const v=String(s.b[0].in.KEY).toLowerCase();if(v=='any'||ids.has(v)){startScript(T,s);hit=true}}
if(hit&&!e.ctrlKey&&!e.metaKey&&!e.altKey)e.preventDefault()});
def('event_whenclicked','event','hat','このオブジェクトがクリックされたとき');
def('event_whenbroadcast','event','hat','メッセージ[MSG]を受け取ったとき',{MSG:['m','msg']});
def('motion_move','motion','stack','[N]歩動かす',{N:['n',10]},(T,A)=>{const a=T.dir*Math.PI/180,n=toNum(A.N);T.x=cl(T.x+n*Math.sin(a));T.y=cl(T.y+n*Math.cos(a))});
def('motion_turn','motion','stack','↻ [DEG]度回転する',{DEG:['n',15]},(T,A)=>{T.dir=normDir(T.dir+toNum(A.DEG))});
def('motion_turnleft','motion','stack','↺ [DEG]度回転する(左回り)',{DEG:['n',15]},(T,A)=>{T.dir=normDir(T.dir-toNum(A.DEG))});
def('motion_goto','motion','stack','X:[X] Y:[Y]へ移動する',{X:['n',0],Y:['n',0]},(T,A)=>{T.x=cl(toNum(A.X));T.y=cl(toNum(A.Y))});
def('motion_glide','motion','stack','[SECS]秒でX:[X] Y:[Y]へ移動する',{SECS:['n',1],X:['n',0],Y:['n',0]},function*(T,A,th){const t0=now(),dur=Math.max(0,toNum(A.SECS))*1000,sx=T.x,sy=T.y,ex=cl(toNum(A.X)),ey=cl(toNum(A.Y));
if(dur<=0){T.x=ex;T.y=ey;return}for(;;){const f=(now()-t0)/dur;if(f>=1){T.x=ex;T.y=ey;return}T.x=sx+(ex-sx)*f;T.y=sy+(ey-sy)*f;yield;if(th.stop||T.dead)return}});
def('motion_pointdir','motion','stack','[DIR]度の方向を向く',{DIR:['n',90]},(T,A)=>{T.dir=normDir(toNum(A.DIR))});
def('motion_xset','motion','stack','X座標を[X]にする',{X:['n',0]},(T,A)=>{T.x=cl(toNum(A.X))});
def('motion_yset','motion','stack','Y座標を[Y]にする',{Y:['n',0]},(T,A)=>{T.y=cl(toNum(A.Y))});
def('motion_xchange','motion','stack','X座標を[DX]ずつ変える',{DX:['n',10]},(T,A)=>{T.x=cl(T.x+toNum(A.DX))});
def('motion_ychange','motion','stack','Y座標を[DY]ずつ変える',{DY:['n',10]},(T,A)=>{T.y=cl(T.y+toNum(A.DY))});
def('motion_xpos','motion','r','X座標',{},T=>Math.round(T.x*1e6)/1e6);
def('motion_ypos','motion','r','Y座標',{},T=>Math.round(T.y*1e6)/1e6);
def('looks_show','looks','stack','表示する',{},T=>{T.vis=true});
def('looks_hide','looks','stack','隠す',{},T=>{T.vis=false});
def('looks_switchcostume','looks','stack','コスチュームを[C]にする',{C:['m','costume']},(T,A)=>{const L=costList(T);if(!L.length)return;let c=L.find(x=>x.n===String(A.C));if(!c&&String(A.C).trim()!==''&&isFinite(Number(A.C)))c=L[((Math.round(Number(A.C))-1)%L.length+L.length)%L.length];if(c){T.c=c;if(H.extensionCostume)H.extensionCostume(T);if(T.stage)bdFire(c.n)}});
def('looks_nextcostume','looks','stack','次のコスチュームにする',{},T=>{const L=costList(T);if(!L.length)return;const i=L.indexOf(T.c);T.c=L[(i+1)%L.length];if(H.extensionCostume)H.extensionCostume(T);if(T.stage)bdFire(T.c.n)});
def('looks_setsize','looks','stack','大きさを[S]%にする',{S:['n',100]},(T,A)=>{T.size=clamp(toNum(A.S),0,1e4)});
def('looks_changesize','looks','stack','大きさを[S]ずつ変える',{S:['n',10]},(T,A)=>{T.size=clamp(T.size+toNum(A.S),0,1e4)});
def('looks_setghost','looks','stack','透明度を[V]%にする',{V:['n',50]},(T,A)=>{T.ghost=clamp(toNum(A.V),0,100)});
def('looks_changeghost','looks','stack','透明度を[V]ずつ変える',{V:['n',10]},(T,A)=>{T.ghost=clamp(T.ghost+toNum(A.V),0,100)});
def('looks_front','looks','stack','前面に移動する',{},T=>{if(!RT)return;const i=RT.list.indexOf(T);if(i>=0){RT.list.splice(i,1);RT.list.push(T)}});
def('looks_back','looks','stack','背面に移動する',{},T=>{if(!RT)return;const i=RT.list.indexOf(T);if(i>=0){RT.list.splice(i,1);RT.list.unshift(T)}});
def('looks_costumenum','looks','r','コスチュームの番号',{},T=>costList(T).indexOf(T.c)+1);
def('looks_costumename','looks','r','コスチュームの名前',{},T=>T.c?T.c.n:'');
/* ----- TurboWarp「伸縮」拡張と同じブロック(横・縦を別々に拡大縮小。保存はせず、実行のたびに100%から始まる) ----- */
const stSet=(T,x,y)=>{if(T.stage)return;T.stx=clamp(x,-1e4,1e4);T.sty=clamp(y,-1e4,1e4)};
def('looks_setstretch','looks','stack','伸縮を 横[X]% 縦[Y]% にする',{X:['n',100],Y:['n',100]},(T,A)=>{stSet(T,toNum(A.X),toNum(A.Y))});
def('looks_changestretch','looks','stack','伸縮を 横[X] 縦[Y] ずつ変える',{X:['n',10],Y:['n',10]},(T,A)=>{stSet(T,(T.stx==null?100:T.stx)+toNum(A.X),(T.sty==null?100:T.sty)+toNum(A.Y))});
def('looks_setstretchx','looks','stack','横の伸縮を[X]%にする',{X:['n',100]},(T,A)=>{stSet(T,toNum(A.X),T.sty==null?100:T.sty)});
def('looks_setstretchy','looks','stack','縦の伸縮を[Y]%にする',{Y:['n',100]},(T,A)=>{stSet(T,T.stx==null?100:T.stx,toNum(A.Y))});
def('looks_stretchx','looks','r','横の伸縮',{},T=>T.stx==null?100:T.stx);
def('looks_stretchy','looks','r','縦の伸縮',{},T=>T.sty==null?100:T.sty);
def('control_wait','control','stack','[SECS]秒待つ',{SECS:['n',1]});
def('control_repeat','control','c','[TIMES]回繰り返す',{TIMES:['n',10]});
def('control_forever','control','c','ずっと繰り返す',{},null,{nonext:true});
def('control_if','control','c','もし[COND]なら',{COND:['b']});
def('control_ifelse','control','ce','もし[COND]なら',{COND:['b']});
def('control_waituntil','control','stack','[COND]まで待つ',{COND:['b']});
def('control_repeatuntil','control','c','[COND]まで繰り返す',{COND:['b']});
def('control_stopthis','control','cap','このスクリプトを止める',{},(T,A,th)=>{th.stop=true});
def('control_stopall','control','cap','すべてを止める',{},(T,A,th)=>{th.stop=true;stopAll()});
def('sense_touching','sense','b','[T]に触れた',{T:['m','touch','_mouse_']},(T,A)=>{if(!RT)return false;const n=String(A.T);if(n=='_mouse_')return T.vis&&hitPix(T,MS.x+240,180-MS.y);for(const o of RT.list)if(o!==T&&o.name===n&&overlap(T,o))return true;return false});
def('sense_touchingedge','sense','b','ステージの端に触れた',{},T=>touchEdge(T));
def('sense_x','sense','r','X座標',{},T=>Math.round(T.x*1e6)/1e6);
def('sense_y','sense','r','Y座標',{},T=>Math.round(T.y*1e6)/1e6);
def('sense_size','sense','r','大きさ',{},T=>Math.round(T.size*1e6)/1e6);
def('sense_dir','sense','r','向き',{},T=>Math.round(T.dir*1e6)/1e6);
def('sense_visible','sense','b','表示されている',{},T=>!!T.vis);
def('op_add','op','r','[A]+[B]',{A:['n',''],B:['n','']},(T,A)=>toNum(A.A)+toNum(A.B));
def('op_sub','op','r','[A]-[B]',{A:['n',''],B:['n','']},(T,A)=>toNum(A.A)-toNum(A.B));
def('op_mul','op','r','[A]×[B]',{A:['n',''],B:['n','']},(T,A)=>toNum(A.A)*toNum(A.B));
def('op_div','op','r','[A]÷[B]',{A:['n',''],B:['n','']},(T,A)=>toNum(A.A)/toNum(A.B));
def('op_gt','op','b','[A]>[B]',{A:['s',''],B:['s',50]},(T,A)=>cmp(A.A,A.B)>0);
def('op_lt','op','b','[A]<[B]',{A:['s',''],B:['s',50]},(T,A)=>cmp(A.A,A.B)<0);
def('op_eq','op','b','[A]=[B]',{A:['s',''],B:['s',50]},(T,A)=>cmp(A.A,A.B)===0);
def('op_and','op','b','[A]かつ[B]',{A:['b'],B:['b']},(T,A)=>toBool(A.A)&&toBool(A.B));
def('op_or','op','b','[A]または[B]',{A:['b'],B:['b']},(T,A)=>toBool(A.A)||toBool(A.B));
def('op_not','op','b','[A]ではない',{A:['b']},(T,A)=>!toBool(A.A));
def('op_random','op','r','[A]から[B]までの乱数',{A:['n',1],B:['n',10]},(T,A)=>{let a=toNum(A.A),b=toNum(A.B);if(a>b)[a,b]=[b,a];if(Number.isInteger(a)&&Number.isInteger(b))return a+Math.floor(Math.random()*(b-a+1));return a+Math.random()*(b-a)});
def('op_join','op','r','[A]と[B]',{A:['s','りんご'],B:['s','バナナ']},(T,A)=>toStr(A.A)+toStr(A.B));
def('op_letter','op','r','[B]の[A]文字目',{A:['n',1],B:['s','りんご']},(T,A)=>{const s=Array.from(toStr(A.B)),i=Math.floor(toNum(A.A));return i>=1&&i<=s.length?s[i-1]:''});
def('op_length','op','r','[A]の長さ',{A:['s','りんご']},(T,A)=>Array.from(toStr(A.A)).length);
def('op_mod','op','r','[A]を[B]で割った余り',{A:['n',''],B:['n','']},(T,A)=>{const a=toNum(A.A),b=toNum(A.B);let n=a%b;if(n/b<0)n+=b;return Number.isNaN(n)?0:n});
def('op_round','op','r','[A]を四捨五入',{A:['n','']},(T,A)=>Math.round(toNum(A.A)));
def('op_mathop','op','r','[OP]([A])',{OP:['m','mathop','abs'],A:['n','']},(T,A)=>{const n=toNum(A.A);switch(A.OP){case'abs':return Math.abs(n);case'floor':return Math.floor(n);case'ceil':return Math.ceil(n);case'sqrt':return Math.sqrt(n)||0;case'sin':return Math.round(Math.sin(n*Math.PI/180)*1e10)/1e10;case'cos':return Math.round(Math.cos(n*Math.PI/180)*1e10)/1e10;
case'tan':{const a=n%360;if(a===90||a===-270)return Infinity;if(a===270||a===-90)return -Infinity;return parseFloat(Math.tan(Math.PI*a/180).toFixed(10))}
case'asin':return Math.asin(n)*180/Math.PI;case'acos':return Math.acos(n)*180/Math.PI;case'atan':return Math.atan(n)*180/Math.PI;
case'ln':return Math.log(n);case'log':return Math.log(n)/Math.LN10;case'exp':return Math.exp(n);case'pow10':return Math.pow(10,n)}return 0});
def('msg_send','msg','stack','メッセージ[MSG]を送る',{MSG:['m','msg']},(T,A)=>{broadcast(A.MSG)});
def('msg_sendwait','msg','stack','メッセージ[MSG]を送って待つ',{MSG:['m','msg']},function*(T,A,th){const L=broadcast(A.MSG);while(L.some(t=>!t.dead)){yield;if(th.stop||T.dead)return}});
const MATHOPS=[['abs','絶対値'],['floor','切り捨て'],['ceil','切り上げ'],['sqrt','平方根'],['sin','sin'],['cos','cos'],['tan','tan'],['asin','asin'],['acos','acos'],['atan','atan'],['ln','ln'],['log','log'],['exp','e^'],['pow10','10^']];
/* ---------- データ検証(読み込み時) ---------- */
const dflIn=(bl,k)=>{const sp=BK[bl.op].inp[k];if(sp[0]=='m'){if(sp[2]!==undefined)return sp[2];const L=(menuDefs[sp[1]]||(()=>[]))(OBJ()).filter(x=>!x[0].startsWith('__'));return L.length?L[0][0]:''}return dfl(sp)};
const dfl=sp=>sp[0]=='b'?null:(sp[1]!==undefined&&sp[0]!='m'?sp[1]:(sp[2]!==undefined?sp[2]:''));
function vBlock(b,W,dep,cnt){if(!b||typeof b!='object'||typeof b.op!='string'||!BK[b.op]||dep>30||++cnt.n>6000){W.drop++;return null}const d=BK[b.op],o={op:b.op,in:{}};
for(const k in d.inp){const sp=d.inp[k],x=b.in&&typeof b.in=='object'?b.in[k]:undefined;
if(x&&typeof x=='object'){const kd=BK[x.op]&&BK[x.op].kind;if((sp[0]=='b'&&kd=='b')||((sp[0]=='n'||sp[0]=='s'||sp[0]=='c')&&(kd=='r'||kd=='b'))||(sp[0]=='m'&&d.kind!='hat'&&(kd=='r'||kd=='b'))){const y=vBlock(x,W,dep+1,cnt);o.in[k]=y||dfl(sp)}else{W.drop++;o.in[k]=dfl(sp)}}
else if(sp[0]=='b')o.in[k]=null;else if(typeof x=='number'&&Number.isFinite(x)||typeof x=='boolean')o.in[k]=x;else if(typeof x=='string')o.in[k]=x.slice(0,200);else o.in[k]=dfl(sp)}
if(d.subs.length){o.c={};d.subs.forEach(s=>o.c[s]=vBlocks(b.c&&b.c[s],W,dep+1,cnt))}return o}
function vBlocks(a,W,dep,cnt){const out=[];if(!Array.isArray(a))return out;dep=dep||0;cnt=cnt||{n:0};for(const b of a.slice(0,2000)){const v=vBlock(b,W,dep,cnt);if(v)out.push(v)}return out}
H.vBlocks=vBlocks;
/* ---------- ブロックの描画 ---------- */
const WS={cat:'motion',pal:null,ws:null,wsc:null,cats:null,wsw:null,zs:null,zl:null,z:1,cw:0,ch:0};
const ZMIN=.4,ZMAX=2.5,LIFT=22;/* ズーム範囲 / タッチ時にブロックを指より上へ持ち上げる量(px) */
const mkBlock=(op,pre)=>{const d=BK[op],b={op,in:{}};for(const k in d.inp)b.in[k]=dfl(d.inp[k]);if(d.subs.length){b.c={};d.subs.forEach(k=>b.c[k]=[])}if(pre)Object.assign(b.in,pre);return b};
H.mkBlock=mkBlock;
const menuDefs={};/* 種類 -> (obj)=>[[value,label],...] */
menuDefs.costume=o=>{const m=o&&alive(o)?ownerOf(o.c):null;return m?m.s.cs.map(c=>[c.n,c.n]):[]};
menuDefs.msg=()=>SC().msgs.map(m=>[m,m]).concat([['__newmsg__','新しいメッセージ…']]);
menuDefs.target=o=>SC().objs.filter(x=>x!==o).map(x=>[x.name,x.name]);
menuDefs.mathop=()=>MATHOPS;
const KEYLIST=(()=>{const L=[['space','スペース'],['enter','Enter'],['shift','Shift'],['control','Control'],['alt','Alt'],['up','↑ 上矢印'],['down','↓ 下矢印'],['left','← 左矢印'],['right','→ 右矢印']];
for(let i=0;i<26;i++){const c=String.fromCharCode(97+i);L.push([c,c.toUpperCase()])}for(let i=0;i<10;i++)L.push([String(i),String(i)]);
for(const c of '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')L.push([c,c]);L.push(['any','どれかのキー']);return L})();
menuDefs.key=()=>KEYLIST;
H.menuDefs=menuDefs;
function palPre(op,o){const d=BK[op],pre={};for(const k in d.inp){const sp=d.inp[k];if(sp[0]!='m')continue;const L=(menuDefs[sp[1]]||(()=>[]))(o).filter(x=>!x[0].startsWith('__'));if(sp[1]=='costume'&&o&&alive(o))pre[k]=o.c.n;else if(sp[2]!==undefined)pre[k]=sp[2];else if(L.length)pre[k]=L[0][0]}return pre}
function slotEl(b,name,sp,pal){const w=el('span','sb-slot'+(sp[0]=='b'?' bool':'')),v=b.in[name];w._o={b,name};w._spec=sp;
if(v&&typeof v=='object'){w.classList.remove('bool');w.append(renderBlock(v,pal));return w}
if(sp[0]=='b')return w;
if(sp[0]=='m'){const s=el('select'),L=(menuDefs[sp[1]]||(()=>[]))(OBJ());let cur=v==null?'':String(v);const opts=L.slice();if(cur!==''&&!opts.some(x=>x[0]===cur))opts.unshift([cur,cur]);opts.forEach(([val,lb])=>{const o=el('option');o.value=val;o.textContent=lb;s.append(o)});s.value=cur;s.setAttribute('aria-label',name);
s.onchange=async()=>{let val=s.value;const isNew=val.startsWith('__new');if(val=='__newmsg__'){const t=await askText('新しいメッセージの名前','');if(!t){s.value=cur;return}val=t.slice(0,40);if(!SC().msgs.includes(val)){SC().msgs.push(val)}}else if(val=='__newvar__'&&H.newVar){const t=await H.newVar();if(!t){s.value=cur;return}val=t}else if(val=='__newlist__'&&H.newList){const t=await H.newList();if(!t){s.value=cur;return}val=t}b.in[name]=val;touch();if(isNew){renderPal();if(!pal)renderWS()}};return w.appendChild(s)&&w}
if(sp[0]=='c'){const ci=el('input');ci.type='color';ci.value=/^#[0-9a-f]{6}$/i.test(v)?v:'#ff0000';ci.setAttribute('aria-label',name);ci.oninput=()=>{b.in[name]=ci.value;touch()};w.append(ci);return w}
const i=el('input');i.type='text';i.value=v==null?'':String(v);i.autocomplete='off';i.spellcheck=false;i.inputMode=sp[0]=='n'?'decimal':'text';i.setAttribute('aria-label',name);i.style.width=Math.max(2.2,Math.min(14,String(i.value).length*.95+1.4))+'em';
i.oninput=()=>{b.in[name]=i.value;i.style.width=Math.max(2.2,Math.min(14,i.value.length*.95+1.4))+'em';touch()};i.onkeydown=e=>{e.stopPropagation();if(e.key=='Enter'){e.preventDefault();i.blur()}};i.onfocus=()=>i.select();w.append(i);return w}
function renderBlock(b,pal){const d=BK[b.op],e=el('div','sb cat-'+d.cat);e._b=b;if(!pal&&b===WS.selB)e.classList.add('sel');
if(b.op=='proc_arg'||b.op=='proc_argb'){e.classList.add(b.op=='proc_arg'?'sb-r':'sb-b');const dd=(SC().defs||[]).find(z=>z.id===b.in.D),it=dd&&dd.items.find(z=>z.id===b.in.P),t=el('span');t.textContent=it?it.n:'?';e.append(t);return e}
if(b.op.startsWith('pd:')){e.classList.add('sb-hat');const dd=d.pdef,row=el('div','sb-row'),lb=el('span');lb.textContent='定義';row.append(lb);
(dd?dd.items:[]).forEach(it=>{if(it.k=='l'){const s=el('span');s.textContent=it.t;row.append(s)}else{const ch=renderBlock({op:it.k=='b'?'proc_argb':'proc_arg',in:{D:dd.id,P:it.id}},pal);ch._tpl=true;row.append(ch)}});e.append(row);return e}
if(b.op=='var_get'||b.op=='list_get'){e.classList.add('sb-r');const t=el('span');t.textContent=b.op=='var_get'?b.in.VAR:b.in.L;e.append(t);return e}
if(isRep(d)){e.classList.add(d.kind=='r'?'sb-r':'sb-b');d.parts.forEach(p=>{if(p.t){const t=el('span');t.textContent=p.t;e.append(t)}else e.append(slotEl(b,p.i,d.inp[p.i],pal))});return e}
e.classList.add(d.kind=='hat'?'sb-hat':d.kind=='cap'?'sb-cap':d.kind=='stack'?'sb-stack':'sb-c');if(d.nonext)e.classList.add('nonext');
const row=el('div','sb-row');d.parts.forEach(p=>{if(p.t){const t=el('span');t.textContent=p.t;row.append(t)}else row.append(slotEl(b,p.i,d.inp[p.i],pal))});e.append(row);
if(d.subs.length){d.subs.forEach((k,n)=>{if(n){const r2=el('div','sb-row');r2.textContent=d.els;e.append(r2)}const s=el('div','sb-sub');s._arr=b.c[k];s._owner=b;s._key=k;fillStack(s,b.c[k],pal);e.append(s)});e.append(el('div','sb-foot'))}
return e}
function fillStack(host,arr,pal){arr.forEach((b,i)=>{const e=renderBlock(b,pal);e._arr=arr;e._i=i;host.append(e)})}
function renderScript(s,pal){const e=el('div','sb-script');e._s=s;fillStack(e,s.b,pal);return e}
function renderWS(){if(!WS.wsc)return;const o=OBJ(),wsc=WS.wsc;wsc.innerHTML='';
if(!o){const t=el('div',null,'オブジェクトを選ぶと、ここにブロックを組み立てられます。');t.style.cssText='padding:20px;opacity:.7';wsc.append(t);return}
let mx=0,my=0;o.sc.forEach(s=>{const e=renderScript(s,false);e.style.left=s.x+'px';e.style.top=s.y+'px';wsc.append(e)});
wsc.querySelectorAll(':scope > .sb-script').forEach(e=>{mx=Math.max(mx,e._s.x+e.offsetWidth);my=Math.max(my,e._s.y+e.offsetHeight)});WS.cw=DG?Math.max(WS.cw,mx+300):mx+300;WS.ch=DG?Math.max(WS.ch,my+300):my+300;applyZoom();markRunning()}
function renderPal(){const p=WS.pal;if(!p)return;const o=OBJ(),cat=WS.cat;p.innerHTML='';if(PALX[cat])PALX[cat](p,o);(PAL[cat]||[]).forEach(op=>{if(op=='msg_send'&&0)return;const b=mkBlock(op,palPre(op,o));const sc=renderScript({b:[b]},true);p.append(sc)});p.scrollTop=0}
const PALX={};H.PALX=PALX;
PALX.msg=(p)=>{const b=el('button','sc-b','新しいメッセージ');b.type='button';b.onclick=async()=>{const t=await askText('新しいメッセージの名前','');if(!t)return;const v=t.slice(0,40);if(!SC().msgs.includes(v)){SC().msgs.push(v);touch()}renderPal()};p.append(b)};
function renderCats(){const c=WS.cats;c.innerHTML='';CATS.forEach(k=>{if(!(PAL[k.id]&&PAL[k.id].length)&&!PALX[k.id])return;const b=el('button',k.id==WS.cat?'on':'','<i></i><span></span>');b.type='button';b.style.setProperty('--c',k.c);b.lastChild.textContent=k.n;b.onclick=()=>{WS.cat=k.id;renderCats();renderPal()};c.append(b)});
const sp=el('span');sp.style.flex='1';const t=el('button','sc-b','整理');t.type='button';t.title='スクリプトを縦に整列';t.style.minHeight='34px';t.onclick=()=>{const o=OBJ();if(!o)return;let y=14;o.sc.forEach(s=>{s.x=14;s.y=y;const e=[...WS.wsc.querySelectorAll(':scope > .sb-script')].find(q=>q._s===s);y+=(e?e.offsetHeight:40)+22});touch();renderWS()};c.append(sp,t)}
H.buildCode=()=>{const p=el('div','p-code');WS.cats=el('div','sb-cats');const m=el('div','sb-main');WS.pal=el('div','sb-pal');WS.wsw=el('div','sb-wsw');WS.ws=el('div','sb-ws');WS.zs=el('div','sb-zs');WS.wsc=el('div','sb-wsc');WS.zs.append(WS.wsc);WS.ws.append(WS.zs);WS.wsw.append(WS.ws,zoomUI());m.append(WS.pal,WS.wsw);p.append(WS.cats,m,bpBuild());bindDrag(WS.pal,true);bindDrag(WS.ws,false);bindGesture(WS.ws);applyZoom();
WS.ws.addEventListener('contextmenu',e=>{const be=e.target.closest('.sb');if(!be||!be._b){if(!CLIP||e.target.closest('input,select'))return;e.preventDefault();const[px,py]=wsPoint(e.clientX,e.clientY);menuAt(e.clientX,e.clientY,[['ここに貼り付け',()=>pasteClip(px,py)]]);return}if(e.target.closest('input,select'))return;e.preventDefault();blockMenu(be,e.clientX,e.clientY)});
WS.ws.addEventListener('pointerdown',e=>{if(!e.target.closest('.sb')&&WS.selB){WS.selB=null;WS.wsc.querySelectorAll('.sb.sel').forEach(x=>x.classList.remove('sel'))}});return p};
H.refresh=()=>{if(!WS.wsc)return;renderCats();renderPal();renderWS()};H.renderWS=()=>{renderWS();renderPal()};H.onOpen=()=>{};
/* ---------- ドラッグ&ドロップ ---------- */
let PD=null,DG=null;
/* ---------- ブロック部分の拡大縮小 ---------- */
function applyZoom(){const z=WS.z,wsc=WS.wsc,zs=WS.zs,ws=WS.ws;if(!wsc||!zs||!ws)return;
wsc.style.width=WS.cw+'px';wsc.style.height=WS.ch+'px';wsc.style.transform=z==1?'':'scale('+z+')';
zs.style.width=Math.ceil(WS.cw*z)+'px';zs.style.height=Math.ceil(WS.ch*z)+'px';
const g=(20*z).toFixed(2)+'px';ws.style.backgroundSize=g+' '+g;
if(WS.zl)WS.zl.textContent=Math.round(z*100)+'%'}
function setZoom(nz,ax,ay){const ws=WS.ws;nz=clamp(nz,ZMIN,ZMAX);if(!ws||Math.abs(nz-WS.z)<1e-4)return;
const r=ws.getBoundingClientRect();if(ax==null){ax=r.left+r.width/2;ay=r.top+r.height/2}
const lx=(ws.scrollLeft+ax-r.left)/WS.z,ly=(ws.scrollTop+ay-r.top)/WS.z;WS.z=nz;applyZoom();ws.scrollLeft=lx*nz-(ax-r.left);ws.scrollTop=ly*nz-(ay-r.top)}
function zoomUI(){const b=el('div','sb-zoom'),mk=(t,tt,f)=>{const x=el('button','',t);x.type='button';x.title=tt;x.setAttribute('aria-label',tt);x.onclick=f;return x};
WS.zl=mk('100%','拡大率を100%に戻す',()=>setZoom(1));b.append(mk('−','ブロック部分を縮小',()=>setZoom(WS.z/1.2)),WS.zl,mk('+','ブロック部分を拡大',()=>setZoom(WS.z*1.2)));return b}
/* 慣性スクロール(タッチで指を離した後も少し流れる) */
function kinetic(box,vx,vy){if(Math.abs(vx)<.05&&Math.abs(vy)<.05)return;let last=performance.now();cancelAnimationFrame(box._kin);
const tick=t=>{const dt=Math.min(32,t-last);last=t;box.scrollLeft-=vx*dt;box.scrollTop-=vy*dt;const f=Math.pow(.94,dt/16);vx*=f;vy*=f;box._kin=(Math.abs(vx)>.02||Math.abs(vy)>.02)?requestAnimationFrame(tick):0};box._kin=requestAnimationFrame(tick)}
/* 作業エリア: 指1本=背景のスクロール / 指2本=ピンチ拡大縮小 / Ctrl+ホイール=拡大縮小 */
function bindGesture(ws){const TP=new Map();let pan=null,pz=null;
const two=()=>{const v=[...TP.values()];return v.length>=2?[v[0],v[1]]:null};
ws.addEventListener('pointerdown',e=>{if(e.pointerType=='mouse'||e.target.closest('button')||DG)return;cancelAnimationFrame(ws._kin);TP.set(e.pointerId,[e.clientX,e.clientY]);
if(TP.size>=2){if(PD&&!PD.go){clearTimeout(PD.lp);PD=null}pan=null;const t=two(),r=ws.getBoundingClientRect(),mx=(t[0][0]+t[1][0])/2,my=(t[0][1]+t[1][1])/2;
pz={d0:Math.max(10,Math.hypot(t[0][0]-t[1][0],t[0][1]-t[1][1])),z0:WS.z,lx:(ws.scrollLeft+mx-r.left)/WS.z,ly:(ws.scrollTop+my-r.top)/WS.z};try{ws.setPointerCapture(e.pointerId)}catch(x){}}
else if(!e.target.closest('.sb')&&!e.target.closest('input,select')){pan={id:e.pointerId,x:e.clientX,y:e.clientY,sl:ws.scrollLeft,st:ws.scrollTop,go:0,lx:e.clientX,ly:e.clientY,lt:performance.now(),vx:0,vy:0};try{ws.setPointerCapture(e.pointerId)}catch(x){}}});
ws.addEventListener('pointermove',e=>{if(!TP.has(e.pointerId))return;TP.set(e.pointerId,[e.clientX,e.clientY]);
if(pz&&TP.size>=2){const t=two(),r=ws.getBoundingClientRect(),d=Math.hypot(t[0][0]-t[1][0],t[0][1]-t[1][1]),mx=(t[0][0]+t[1][0])/2,my=(t[0][1]+t[1][1])/2,nz=clamp(pz.z0*d/pz.d0,ZMIN,ZMAX);
WS.z=nz;applyZoom();ws.scrollLeft=pz.lx*nz-(mx-r.left);ws.scrollTop=pz.ly*nz-(my-r.top);return}
if(pan&&pan.id==e.pointerId){const dx=e.clientX-pan.x,dy=e.clientY-pan.y;if(!pan.go&&Math.hypot(dx,dy)<4)return;pan.go=1;ws.scrollLeft=pan.sl-dx;ws.scrollTop=pan.st-dy;
const now=performance.now(),dt=now-pan.lt;if(dt>0){pan.vx=.6*pan.vx+.4*(e.clientX-pan.lx)/dt;pan.vy=.6*pan.vy+.4*(e.clientY-pan.ly)/dt}pan.lx=e.clientX;pan.ly=e.clientY;pan.lt=now}});
const end=e=>{if(!TP.has(e.pointerId))return;TP.delete(e.pointerId);if(pz&&TP.size<2){pz=null;pan=null}
if(pan&&pan.id==e.pointerId){if(pan.go&&e.type=='pointerup'&&performance.now()-pan.lt<90)kinetic(ws,pan.vx,pan.vy);pan=null}};
ws.addEventListener('pointerup',end);ws.addEventListener('pointercancel',end);
ws.addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();setZoom(WS.z*Math.exp(-e.deltaY*.002),e.clientX,e.clientY)},{passive:false})}
/* ドラッグ中、作業エリアの端で自動スクロール */
function autoScroll(){const D=DG;if(!D||!WS.ws)return;if(D.hit){D.zt=0;return}const ws=WS.ws,r=ws.getBoundingClientRect(),M=48,x=D.lx,y=D.ly;
if(x<r.left||x>r.right||y<r.top||y>r.bottom){D.zt=0;return}
const ax=x-r.left,bx=r.right-x,ay=y-r.top,by=r.bottom-y;let dx=0,dy=0;
if(ax<M)dx=-(M-ax)/M;else if(bx<M)dx=(M-bx)/M;if(ay<M)dy=-(M-ay)/M;else if(by<M)dy=(M-by)/M;
if(!dx&&!dy){D.zt=0;return}const now=performance.now();if(!D.zt)D.zt=now;if(now-D.zt<250)return;
if(dx>0&&ws.scrollLeft+ws.clientWidth>=ws.scrollWidth-1){WS.cw+=dx*16/WS.z;applyZoom()}
if(dy>0&&ws.scrollTop+ws.clientHeight>=ws.scrollHeight-1){WS.ch+=dy*16/WS.z;applyZoom()}
const sl=ws.scrollLeft,st=ws.scrollTop;ws.scrollLeft+=dx*16;ws.scrollTop+=dy*16;
if(ws.scrollLeft!==sl||ws.scrollTop!==st){D.C=collect();updateDrag({clientX:x,clientY:y})}}
/* ---------- ドラッグ開始の判定 ---------- */
function startPick(P){/* 長押しで持ち上げ(パレット・タッチ) */P.go=true;P.mode='drag';if(P.inp){try{P.root.setPointerCapture(P.id)}catch(x){}}beginDrag({clientX:P.lx,clientY:P.ly})}
function bindDrag(root,pal){
root.addEventListener('pointerdown',e=>{if(e.button>0||PD||DG)return;const touch=e.pointerType!='mouse';if(e.target.closest('button'))return;const inp=!!e.target.closest('input,select');if(inp&&!touch)return;
const be=e.target.closest('.sb');if(!be||!be._b)return;cancelAnimationFrame(root._kin);
PD={pal:pal||!!be._tpl,be,id:e.pointerId,x0:e.clientX,y0:e.clientY,lx:e.clientX,ly:e.clientY,lt:performance.now(),vx:0,vy:0,sl:root.scrollLeft,st:root.scrollTop,rect:be.getBoundingClientRect(),go:false,root,touch,inp,mode:0,bp:!!root._bp};if(!pal&&!be._tpl&&!root._bp&&WS.wsc)selBlock(be);
if(touch){if(pal)PD.lp=setTimeout(()=>{if(PD&&!PD.go&&!PD.mode)startPick(PD)},260);else PD.lp=setTimeout(()=>{if(PD&&!PD.go){const p=PD;PD=null;blockMenu(p.be,p.x0,p.y0)}},650)}
if(!inp){try{root.setPointerCapture(e.pointerId)}catch(x){}}});
root.addEventListener('pointermove',e=>{const P=PD;if(!P||P.id!==e.pointerId)return;
if(!P.go){const dx=e.clientX-P.x0,dy=e.clientY-P.y0,dist=Math.hypot(dx,dy);
if(P.mode!='scroll'){if(dist<(P.touch?5:6))return;
if(P.touch&&P.pal&&(P.bp?Math.abs(dx)>Math.abs(dy)*1.2:Math.abs(dy)>Math.abs(dx)*1.2)){P.mode='scroll';clearTimeout(P.lp)}/* パレットでは縦にこすったらスクロール */
else{clearTimeout(P.lp);P.go=true;P.mode='drag';if(P.inp){try{root.setPointerCapture(P.id)}catch(x){}}beginDrag(e)}}
if(P.mode=='scroll'){root.scrollTop=P.st-dy;root.scrollLeft=P.sl-dx;const now=performance.now(),dt=now-P.lt;if(dt>0){P.vx=.6*P.vx+.4*(e.clientX-P.lx)/dt;P.vy=.6*P.vy+.4*(e.clientY-P.ly)/dt}P.lx=e.clientX;P.ly=e.clientY;P.lt=now;return}}
P.lx=e.clientX;P.ly=e.clientY;if(DG)updateDrag(e)});
const up=e=>{if(!PD||PD.id!==e.pointerId)return;const P=PD;clearTimeout(P.lp);PD=null;
if(P.go&&DG)endDrag(e,e.type=='pointercancel');else if(P.mode=='scroll'&&e.type=='pointerup'&&performance.now()-P.lt<90)kinetic(root,P.vx,P.vy)};
root.addEventListener('pointerup',up);root.addEventListener('pointercancel',up)}
const kindOf=b=>BK[b.op].kind;
function pruneScripts(o){o.sc=o.sc.filter(s=>s.b.length)}
function beginDrag(e){const o=OBJ();if(!o)return;const be=PD.be;let held;
if(PD.pal){if(PD.bp){const se=be.closest('.sb-script'),it=se&&se._bp;if(!it||!bpUsable(it,1))return;held={arr:JSON.parse(JSON.stringify(it.blocks)),bp:it}}else{const m=JSON.parse(JSON.stringify(be._b));held={arr:[m]}}}
else{const b=be._b,par=be.parentNode;if(isRep(BK[b.op])&&par&&par._o){const ow=par._o;ow.b.in[ow.name]=dflIn(ow.b,ow.name);held={arr:[b],origin:{rep:1,ow}}}
else if(be._arr){const se=be.closest('.sb-script');held={arr:be._arr.splice(be._i),origin:{arr:be._arr,i:be._i,s:se&&se._s}};pruneScripts(o)}else return}
held.rep=isRep(BK[held.arr[0].op]);const g=el('div','sb-ghost');g.append(renderScript({b:held.arr},true));const gp=q('#scn')||document.body;/* #scn の中に作る(外だと入力欄などのスタイルが外れて大きくなる) */gp.append(g);const gs=PD.pal?1:WS.z;g.style.transformOrigin='0 0';if(gs!==1)g.style.transform='scale('+gs+')';
DG={held,g,ox:PD.x0-PD.rect.left,oy:PD.y0-PD.rect.top+(PD.touch?LIFT:0),hint:el('div','sb-hint'),C:null,best:null,fromPal:PD.pal,touch:PD.touch,lx:e.clientX,ly:e.clientY,zt:0,iv:0,m:PD.touch?1.7:1,R:PD.touch?58:38};gp.append(DG.hint);DG.hint.style.display='none';dropStrip(DG);
if(!PD.pal){renderWS();DG.C=collect()}else DG.C=collect();DG.gh=g.getBoundingClientRect().height;if(PD.touch&&navigator.vibrate){try{navigator.vibrate(8)}catch(x){}}DG.iv=setInterval(autoScroll,16);updateDrag(e)}
function collect(){const C={stack:[],tops:[],slots:[]},wsc=WS.wsc;wsc.querySelectorAll('.sb').forEach(be=>{const d=BK[be._b.op];if(isRep(d)||!be._arr)return;if(!isEnd(d)){const r=be.getBoundingClientRect();C.stack.push({x:r.left,y:r.bottom,arr:be._arr,i:be._i+1})}});
wsc.querySelectorAll('.sb-sub').forEach(s=>{const r=s.getBoundingClientRect();C.stack.push({x:r.left,y:r.top,arr:s._arr,i:0})});
wsc.querySelectorAll(':scope > .sb-script').forEach(se=>{const f=se._s.b[0];if(f&&BK[f.op].kind!='hat'&&!isRep(BK[f.op])){const r=se.getBoundingClientRect();C.tops.push({x:r.left,y:r.top,s:se._s})}});
wsc.querySelectorAll('.sb-slot').forEach(sl=>{if(sl._o)C.slots.push({r:sl.getBoundingClientRect(),o:sl._o,sp:sl._spec})});return C}
function updateDrag(e){const D=DG,gx=e.clientX-D.ox,gy=e.clientY-D.oy;D.lx=e.clientX;D.ly=e.clientY;D.g.style.left=gx+'px';D.g.style.top=gy+'px';const h=D.held,C=D.C;let best=null,bd=1e9;
if(!h.rep){const first=BK[h.arr[0].op],lastEnd=isEnd(BK[h.arr[h.arr.length-1].op]);
if(first.kind!='hat')for(const c of C.stack){if(lastEnd&&c.i!==c.arr.length)continue;const dd=Math.hypot(gx-c.x,gy-c.y);if(dd<D.R&&dd<bd){best={t:'stack',c};bd=dd}}
if(!lastEnd)for(const c of C.tops){const dd=Math.hypot(gx-c.x,gy+D.gh-c.y);if(dd<D.R&&dd<bd){best={t:'top',c};bd=dd}}}
else{const k=kindOf(h.arr[0]),px=gx+10,py=gy+D.gh/2;for(const c of C.slots){const ok=k=='b'?(c.sp[0]=='b'||c.sp[0]=='n'||c.sp[0]=='s'||c.sp[0]=='c'||(c.sp[0]=='m'&&BK[c.o.b.op].kind!='hat')):(c.sp[0]=='n'||c.sp[0]=='s'||c.sp[0]=='c'||(c.sp[0]=='m'&&BK[c.o.b.op].kind!='hat'));if(!ok)continue;const r=c.r;if(px>=r.left-10*D.m&&px<=r.right+10*D.m&&py>=r.top-12*D.m&&py<=r.bottom+12*D.m){const dd=Math.hypot(px-(r.left+4),py-(r.top+r.height/2));if(dd<bd){best={t:'slot',c};bd=dd}}}}
const hit=dropUI(D,e);if(hit)best=null;D.best=best;const hi=D.hint;if(!best)hi.style.display='none';else{hi.style.display='block';if(best.t=='slot'){const r=best.c.r;hi.style.cssText='display:block;background:transparent;left:'+(r.left-2)+'px;top:'+(r.top-2)+'px;width:'+(r.width+4)+'px;height:'+(r.height+4)+'px'}
else{const c=best.c;hi.style.cssText='display:block;background:#fff;left:'+c.x+'px;top:'+(c.y-3)+'px;width:64px;height:6px'}}}
function endDrag(e,cancel){const D=DG;DG=null;clearInterval(D.iv);const hit=cancel?null:dropHit(e.clientX,e.clientY);D.g.remove();D.hint.remove();dropClear(D);const o=OBJ();if(!o||cancel){if(o)restoreOrigin(D.held,o);renderWS();return}
if(hit){const h0=D.held;if(hit.t=='bp'){if(!h0.bp)bpAdd(h0.arr)}else if(hit.o!==o)copyToObject(hit.o,h0.arr,o,h0.bp);restoreOrigin(h0,o);touch();renderWS();return}
const wr=WS.ws.getBoundingClientRect(),inWs=e.clientX>=wr.left&&e.clientX<=wr.right&&e.clientY>=wr.top&&e.clientY<=wr.bottom;const h=D.held,b=D.best;
if(!inWs){touch();renderWS();return}/* パレットや外側に落としたら削除 */
if(h.bp){const r=prepBlocks(h.bp,o,h.arr);h.arr=r.blocks;r.extra.forEach(s=>o.sc.push(s));if(!h.arr.length){renderWS();return}}
if(b&&b.t=='stack'){b.c.arr.splice(b.c.i,0,...h.arr)}
else if(b&&b.t=='top'){const s=b.c.s;s.b.unshift(...h.arr);const gx=(e.clientX-D.ox-wr.left+WS.ws.scrollLeft)/WS.z,gy=(e.clientY-D.oy-wr.top+WS.ws.scrollTop)/WS.z;s.x=Math.max(0,Math.round(gx));s.y=Math.max(0,Math.round(gy))}
else if(b&&b.t=='slot'){const ow=b.c.o,old=ow.b.in[ow.name];ow.b.in[ow.name]=h.arr[0];if(old&&typeof old=='object'){const r=b.c.r;o.sc.push({id:uid(),x:Math.max(0,Math.round((r.left-wr.left+WS.ws.scrollLeft)/WS.z+30)),y:Math.max(0,Math.round((r.top-wr.top+WS.ws.scrollTop)/WS.z+30)),b:[old]})}}
else{const gx=(e.clientX-D.ox-wr.left+WS.ws.scrollLeft)/WS.z,gy=(e.clientY-D.oy-wr.top+WS.ws.scrollTop)/WS.z;o.sc.push({id:uid(),x:Math.max(0,Math.round(gx)),y:Math.max(0,Math.round(gy)),b:h.arr})}
touch();renderWS();thumbCurSafe()}
const thumbCurSafe=()=>{};
/* ---------- ブロックのコピー&ペースト / バックパック / スプライトへ複製 ---------- */
const CLK='ced_bclip',BPK='ced_bp',BPO='ced_bp_open';
const bclone=x=>JSON.parse(JSON.stringify(x));
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const BADN=new Set(['__proto__','constructor','prototype']);
function bwalk(arr,f){for(const b of arr||[]){if(!b||typeof b!='object'||typeof b.op!='string')continue;f(b);if(b.in&&typeof b.in=='object')for(const k in b.in){const v=b.in[k];if(v&&typeof v=='object')bwalk([v],f)}if(b.c&&typeof b.c=='object')for(const k in b.c)bwalk(b.c[k],f)}}
let CLIP=null;try{const t=localStorage.getItem(CLK);if(t){const c=JSON.parse(t);if(c&&Array.isArray(c.blocks))CLIP=c}}catch(e){}
/* 取り出したブロック + 使っている定義(と本体) + 変数名 をまとめる */
function packBlocks(blocks,o){const sc=SC(),pk={blocks:bclone(blocks),defs:[],scripts:[],vars:[],lists:[],lv:[],ll:[]};
const defs=sc.defs||[],bodyOf=id=>{for(const ob of sc.objs)for(const s of ob.sc||[])if(s.b[0]&&s.b[0].op==='pd:'+id)return s;return null};
const q=[],seen=new Set(),take=b=>{if(b.op.startsWith('pc:')||b.op.startsWith('pd:'))q.push(b.op.slice(3))};bwalk(pk.blocks,take);
while(q.length){const id=q.pop();if(seen.has(id))continue;seen.add(id);const d=defs.find(x=>x.id===id);if(!d)continue;pk.defs.push(bclone(d));const body=bodyOf(id);if(body){pk.scripts.push({id,b:bclone(body.b)});bwalk(body.b,take)}}
const all=pk.blocks.concat(...pk.scripts.map(s=>s.b));
bwalk(all,b=>{const i=b.in||{};if(b.op.startsWith('var_')&&typeof i.VAR=='string')pk.vars.push(i.VAR);if(b.op.startsWith('list_')&&typeof i.L=='string')pk.lists.push(i.L)});
pk.vars=[...new Set(pk.vars)];pk.lists=[...new Set(pk.lists)];pk.lv=o?pk.vars.filter(n=>hasOwn(o.vars,n)):[];pk.ll=o?pk.lists.filter(n=>hasOwn(o.lists,n)):[];return pk}
/* 貼り付け先(オブジェクト)に合わせて整える: 定義ブロックの複製・足りない定義/変数の補充・使えないブロックの除去 */
function prepBlocks(pk,o,blocks){const sc=SC();sc.defs=sc.defs||[];const extra=[],remap=new Map();let blk=bclone(blocks||pk.blocks);
const hasDef=id=>sc.defs.some(d=>d.id===id),hasBody=id=>sc.objs.some(ob=>(ob.sc||[]).some(s=>s.b[0]&&s.b[0].op==='pd:'+id))||extra.some(s=>s.b[0]&&s.b[0].op==='pd:'+id);
const findDef=id=>(pk.defs||[]).find(d=>d.id===id)||sc.defs.find(d=>d.id===id);
/* 定義ハット(pd:)そのものを貼るときは、同じIDの定義が2つできないよう新しい定義として複製 */
bwalk(blk,b=>{if(b.op.startsWith('pd:')){const id=b.op.slice(3);if(!remap.has(id)){const d0=findDef(id);if(d0){const nd=bclone(d0);nd.id=uid();sc.defs.push(nd);regProc(nd);remap.set(id,nd.id)}}}});
if(remap.size)bwalk(blk,b=>{if(b.op.startsWith('pd:')||b.op.startsWith('pc:')){const id=b.op.slice(3);if(remap.has(id))b.op=b.op.slice(0,3)+remap.get(id)}if((b.op=='proc_arg'||b.op=='proc_argb')&&b.in&&remap.has(b.in.D))b.in.D=remap.get(b.in.D)});
/* 呼び出している定義がこのシーンになければ、定義と本体を補う */
const ensure=(id,depth)=>{if(hasDef(id)||depth>50)return;const d0=(pk.defs||[]).find(d=>d.id===id);if(!d0)return;const nd=bclone(d0);sc.defs.push(nd);regProc(nd);const body=(pk.scripts||[]).find(s=>s.id===id);if(body&&!hasBody(id)){const s={id:uid(),x:20,y:20+extra.length*160,b:bclone(body.b)};extra.push(s);bwalk(s.b,b=>{if(b.op.startsWith('pc:'))ensure(b.op.slice(3),depth+1)})}};
bwalk(blk,b=>{if(b.op.startsWith('pc:'))ensure(b.op.slice(3),0)});
/* 変数・リスト: なければ、元がこのオブジェクトだけの変数ならローカル、それ以外は全体で作る */
(pk.vars||[]).forEach(n=>{if(BADN.has(n)||hasOwn(o.vars,n)||hasOwn(sc.gvars,n))return;if((pk.lv||[]).includes(n))o.vars[n]=0;else sc.gvars[n]=0});
(pk.lists||[]).forEach(n=>{if(BADN.has(n)||hasOwn(o.lists,n)||hasOwn(sc.glists,n))return;if((pk.ll||[]).includes(n)){o.lists=o.lists||{};o.lists[n]=[]}else{sc.glists=sc.glists||{};sc.glists[n]=[]}});
const W={drop:0};blk=H.vBlocks(blk,W);extra.forEach(s=>{s.b=H.vBlocks(s.b,W)});
if(W.drop)toast(W.drop+'個のブロックは、このプロジェクトでは使えないため省きました(拡張機能が未読込など)');
return{blocks:blk,extra:extra.filter(s=>s.b.length)}}
/* 作業エリアの見えている位置(ズーム込み) */
function wsPoint(cx,cy){const ws=WS.ws,r=ws.getBoundingClientRect();return[Math.max(0,Math.round((cx-r.left+ws.scrollLeft)/WS.z)),Math.max(0,Math.round((cy-r.top+ws.scrollTop)/WS.z))]}
function pasteInto(o,pk,x,y){const r=prepBlocks(pk,o);if(!r.blocks.length)return null;if(x==null){const ws=WS.ws,rr=ws.getBoundingClientRect(),n=(WS.pasteN=((WS.pasteN||0)+1)%8);[x,y]=wsPoint(rr.left+30+n*26,rr.top+30+n*26)}
const s={id:uid(),x,y,b:r.blocks};o.sc.push(s);r.extra.forEach(e=>{e.x=x;e.y=y+180+e.y;o.sc.push(e)});return s}
function clipSave(){try{localStorage.setItem(CLK,JSON.stringify(CLIP))}catch(e){}}
function copyBlocks(blocks,msg){const o=OBJ();if(!o||!blocks.length)return;CLIP=packBlocks(blocks,o);clipSave();bpRefreshBtns();toast(msg||'ブロックをコピーしました(貼り付けで出せます)')}
function pasteClip(x,y){const o=OBJ();if(!o)return;if(!CLIP){toast('コピーしたブロックがありません');return}const s=pasteInto(o,CLIP,x,y);if(!s)return;touch();renderWS();renderPal();toast('貼り付けました')}
/* 別のオブジェクトへ複製 */
function copyToObject(t,blocks,src,item){const pk=item||packBlocks(blocks,src),sc=t.sc||(t.sc=[]);let y=20;sc.forEach(s=>{y=Math.max(y,(s.y||0)+60+(s.b?s.b.length:1)*34)});const s=pasteInto(t,pk,20,Math.round(y));if(s){touch();toast('「'+t.name+'」にコピーしました')}}
function restoreOrigin(h,o){const g=h&&h.origin;if(!g)return;if(g.rep){g.ow.b.in[g.ow.name]=h.arr[0];return}if(g.s&&!o.sc.includes(g.s))o.sc.push(g.s);g.arr.splice(g.i,0,...h.arr)}
/* ----- バックパック(端末に保存。再読み込みしても残る) ----- */
const BP={items:[],open:false,el:null,strip:null,cnt:null,paste:null};
try{const t=localStorage.getItem(BPK);const a=t&&JSON.parse(t);if(Array.isArray(a))BP.items=a.filter(it=>it&&typeof it.id=='string'&&Array.isArray(it.blocks)&&it.blocks.every(b=>b&&typeof b.op=='string')).slice(0,100);BP.open=localStorage.getItem(BPO)=='1'}catch(e){}
function bpSave(){try{localStorage.setItem(BPK,JSON.stringify(BP.items))}catch(e){toast('バックパックを保存できませんでした(端末の保存容量がいっぱいかもしれません)')}try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}}
function bpAdd(blocks){const o=OBJ();if(!o||!blocks.length)return;if(BP.items.length>=100){toast('バックパックがいっぱいです(100個まで)。いらないものを削除してください');return}const pk=packBlocks(blocks,o);BP.items.push({id:uid(),blocks:pk.blocks,defs:pk.defs,scripts:pk.scripts,vars:pk.vars,lists:pk.lists,lv:pk.lv,ll:pk.ll});bpSave();bpRender();toast('バックパックに入れました')}
function bpReg(it){(it.defs||[]).forEach(d=>{if(d&&typeof d.id=='string'&&Array.isArray(d.items)&&!BK['pc:'+d.id]){try{regProc(d)}catch(e){}}})}
function bpUsable(it,say){bpReg(it);let ok=true;bwalk(it.blocks,b=>{if(!BK[b.op])ok=false});if(!ok&&say)toast('このブロックは、必要な拡張機能が読み込まれていないため使えません');return ok}
function bpRefreshBtns(){if(BP.paste)BP.paste.disabled=!CLIP}
function bpRender(){const st=BP.strip;if(!st)return;st.innerHTML='';if(BP.cnt)BP.cnt.textContent=BP.items.length?'('+BP.items.length+')':'';
if(!BP.items.length){const m=el('div','sb-bp-empty','ブロックをここ(バックパックの帯)にドラッグすると保存されます。他のスプライトでも、次に開いたときも使えます。');st.append(m);return}
BP.items.forEach(it=>{const c=el('div','sb-bp-item');let ok=true;try{ok=bpUsable(it)}catch(e){ok=false}
if(ok){try{const se=renderScript({b:bclone(it.blocks)},true);se._bp=it;c.append(se)}catch(e){ok=false}}
if(!ok){c.classList.add('bad');c.append(el('div','sb-bp-na','使えないブロック(拡張機能が必要)'))}
const x=el('button','sb-bp-x','×');x.type='button';x.title='バックパックから削除';x.setAttribute('aria-label','バックパックから削除');x.onclick=ev=>{ev.stopPropagation();BP.items=BP.items.filter(z=>z!==it);bpSave();bpRender()};c.append(x);
c.addEventListener('contextmenu',ev=>{ev.preventDefault();menuAt(ev.clientX,ev.clientY,[['バックパックから削除',()=>{BP.items=BP.items.filter(z=>z!==it);bpSave();bpRender()},'danger']])});st.append(c)})}
function bpBuild(){const bar=el('div','sb-bp'+(BP.open?' open':''));const hd=el('div','sb-bp-hd');const tg=el('button','sb-bp-tg');tg.type='button';tg.setAttribute('aria-expanded',BP.open);
tg.innerHTML='<span class="ar"></span><b>バックパック</b> <span class="cnt"></span>';BP.cnt=tg.querySelector('.cnt');
tg.onclick=()=>{BP.open=!BP.open;bar.classList.toggle('open',BP.open);tg.setAttribute('aria-expanded',BP.open);try{localStorage.setItem(BPO,BP.open?'1':'0')}catch(e){}};
const ps=el('button','sc-b','貼り付け');ps.type='button';ps.title='コピーしたブロックを作業エリアに貼り付け(Ctrl+V)';ps.onclick=()=>pasteClip();BP.paste=ps;
const hint=el('span','sb-bp-hint','ブロックをここにドラッグして保存');hd.append(tg,hint,ps);
const st=el('div','sb-bp-strip');st._bp=true;BP.strip=st;bar.append(hd,st);BP.el=bar;bindDrag(st,true);bpRender();bpRefreshBtns();return bar}
/* ----- ドロップ先(バックパック / スプライト)の判定 ----- */
function dropHit(x,y){const els=document.elementsFromPoint?document.elementsFromPoint(x,y):[];for(const n of els){const bp=n.closest&&n.closest('.sb-bp');if(bp)return{t:'bp',el:bp};const oi=n.closest&&n.closest('[data-oid]');if(oi){const ob=SC().objs.find(z=>z.id===oi.dataset.oid);if(ob)return{t:'obj',o:ob,el:oi}}}return null}
function dropUI(D,e){const hit=dropHit(e.clientX,e.clientY),cur=OBJ(),ok=hit&&!(hit.t=='obj'&&hit.o===cur)&&!(hit.t=='bp'&&D.held.bp);
if(D.hit&&(!hit||D.hit.el!==hit.el))D.hit.el.classList.remove('drop','dropok');D.hit=hit?{...hit,ok}:null;if(ok)hit.el.classList.add(hit.t=='bp'?'drop':'dropok');return hit}
function dropClear(D){if(D.hit)D.hit.el.classList.remove('drop','dropok');if(D.strip)D.strip.remove()}
/* 画面が狭くてスプライト一覧が見えないとき、ドラッグ中だけ「入れるスプライト」の帯を出す */
function dropStrip(D){if(!window.matchMedia||!matchMedia('(max-width:900px)').matches)return;const cur=OBJ(),objs=SC().objs.filter(x=>x!==cur);if(!objs.length)return;const gp=q('#scn')||document.body,r=WS.ws.getBoundingClientRect(),s=el('div','sb-dstrip');s.style.cssText='left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px';
objs.forEach(o=>{const c=el('div','sb-dstrip-i','<canvas width="72" height="54"></canvas><span class="nm"></span>');c.dataset.oid=o.id;c.querySelector('.nm').textContent=o.name;if(alive(o)){try{spThumb(c.firstChild,o.c)}catch(e){}}s.append(c)});gp.append(s);D.strip=s}
function selBlock(be){WS.selB=be._b;WS.wsc.querySelectorAll('.sb.sel').forEach(x=>x.classList.remove('sel'));be.classList.add('sel')}
function selFind(){if(!WS.selB||!WS.wsc)return null;return[...WS.wsc.querySelectorAll('.sb')].find(x=>x._b===WS.selB)||null}
/* キー: Ctrl+C(選んだブロックをコピー) / Ctrl+V(貼り付け) */
document.addEventListener('keydown',e=>{if(!S.open)return;if(!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey)return;const k=e.key.toLowerCase();if(k!='c'&&k!='v')return;const t=e.target;if(/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)||t.isContentEditable||document.querySelector('.sc-ov,#uidlg'))return;if(!WS.ws||!WS.ws.offsetParent)return;
if(k=='c'){const be=selFind();if(!be)return;e.preventDefault();const d=BK[be._b.op];copyBlocks(be._arr&&!isRep(d)?be._arr.slice(be._i):[be._b])}else{e.preventDefault();pasteClip()}});
function blockMenu(be,x,y){const o=OBJ();if(!o)return;const b=be._b,d=BK[b.op];const items=[];
items.push(['複製'+(be._arr&&!isRep(d)?'(このブロックと下のブロック)':''),()=>{const src=be._arr&&!isRep(d)?be._arr.slice(be._i):[b],cp=JSON.parse(JSON.stringify(src)),r=be.getBoundingClientRect(),wr=WS.ws.getBoundingClientRect();o.sc.push({id:uid(),x:Math.max(0,Math.round((r.left-wr.left+WS.ws.scrollLeft)/WS.z+24)),y:Math.max(0,Math.round((r.top-wr.top+WS.ws.scrollTop)/WS.z+24)),b:cp});touch();renderWS()}]);
const cs=be._arr&&!isRep(d)?be._arr.slice(be._i):[b],many=cs.length>1;
items.push(['コピー'+(many?'(このブロックと下のブロック)':''),()=>copyBlocks(cs)]);if(many)items.push(['コピー(このブロックだけ)',()=>copyBlocks([b])]);
items.push(['バックパックに入れる'+(many?'(このブロックと下のブロック)':''),()=>bpAdd(cs)]);if(CLIP)items.push(['貼り付け',()=>pasteClip()]);
items.push([isRep(d)?'このブロックを削除':'このブロックだけ削除',()=>{const par=be.parentNode;if(isRep(d)&&par&&par._o){const ow=par._o;ow.b.in[ow.name]=dflIn(ow.b,ow.name)}else if(be._arr){be._arr.splice(be._i,1);pruneScripts(o)}touch();renderWS()},'danger']);
items.push(['このスクリプト全体を削除',()=>{let t=be;while(t&&!(t.classList&&t.classList.contains('sb-script')&&t._s&&t.parentNode===WS.wsc))t=t.parentNode;if(t&&t._s){o.sc=o.sc.filter(s=>s!==t._s);touch();renderWS()}},'danger']);menuAt(x,y,items)}
function markRunning(){if(!WS.wsc)return;const o=OBJ();WS.wsc.querySelectorAll(':scope > .sb-script').forEach(e=>{const on=!!(RT&&o&&RT.threads.some(t=>!t.dead&&t.s.id===e._s.id&&t.T.src===o));e.classList.toggle('running',on)})}
setInterval(()=>{if(S.open&&RT)markRunning()},200);
/* ---------- 実行ボタン ---------- */
let RB={};
H.buildRunUI=c=>{RB.flag=BTN('sc_flag','','緑の旗(実行を開始。全オブジェクトの「緑の旗が押されたとき」を動かす)','flag');RB.stop=BTN('sc_stop','','停止(すべてのスクリプトとクローンを止める。見た目はそのまま)','stop');RB.reset=BTN('sc_reset','リセット','リセット(編集時の状態に戻し、クローンと変数も初期化)');
RB.flag.onclick=flag;RB.stop.onclick=stopAll;RB.reset.onclick=reset;
/* FPS(1秒あたりの実行回数)。数値で変更。シーンごとに保存され、実行中でもすぐ反映 */
const fl=el('label','sc-fps'),fs=el('span',null,'FPS'),fi=el('input');fi.type='number';fi.min=1;fi.max=250;fi.step=1;fi.inputMode='numeric';fi.title='1秒あたりの実行回数(1〜250)。実行中でも変えられます。Scratchは30、TurboWarpは30〜60が一般的';fi.setAttribute('aria-label','FPS');RB.fpsIn=fi;fl.append(fs,fi);
const setF=(commit)=>{const s=SC();if(!s)return;const n=Math.round(Number(fi.value));if(!Number.isFinite(n)||n<1||n>250){if(commit)fi.value=vFps(s.fps);return}if(s.fps!==n){s.fps=n;if(RT)ENG.fps=n;touch()}if(commit)fi.value=n};
fi.addEventListener('input',()=>setF(false));fi.addEventListener('change',()=>setF(true));fi.addEventListener('blur',()=>setF(true));fi.addEventListener('keydown',e=>{e.stopPropagation();if(e.key=='Enter')fi.blur()});
c.append(RB.flag,RB.stop,RB.reset,fl);syncFps()};
function syncFps(){const s=SC();if(RB.fpsIn&&s&&document.activeElement!==RB.fpsIn)RB.fpsIn.value=vFps(s.fps)}
function updateRunUI(){if(!RB.flag)return;RB.stop.disabled=!RT;RB.reset.disabled=!RT;RB.flag.classList.toggle('on',!!(RT&&RT.threads.length))}
Object.assign(SCN,{BK,def,flag,stopAll,reset,click,mkBlock,startScript,broadcast,overlap,touchEdge,renderWS,renderPal,markRunning,WS});

Object.defineProperty(SCN,'rt',{get:()=>RT});

/* ============================================================
   第3部: Scratch式クローン + 変数(ローカル/グローバル) + 変数モニター
   クローン = 元オブジェクトの状態・スクリプトを引き継ぐ「独立した実行主体」(座標・大きさ・向き・表示・ローカル変数を個別に持つ)
   ============================================================ */
const MAXC=300;
/* ---------- クローン ---------- */
function createClone(T,target){if(!RT)return null;let S0=T;if(target!=='_myself_'){S0=RT.list.find(t=>!t.isClone&&t.name===target);if(!S0)return null}
if(RT.clones>=MAXC){if(!RT.warnMax){RT.warnMax=1;toast('クローンの数が上限('+MAXC+'個)に達したため、新しいクローンは作りません')}return null}
const n={id:uid(),name:S0.name,src:S0.src,isClone:true,volume:S0.volume,x:S0.x,y:S0.y,size:S0.size,dir:S0.dir,rot:S0.rot,vis:S0.vis,ghost:S0.ghost,stx:S0.stx,sty:S0.sty,c:S0.c,vars:JSON.parse(JSON.stringify(S0.vars)),lists:JSON.parse(JSON.stringify(S0.lists||{})),fx:S0.fx?{...S0.fx}:null,pen:S0.pen?{...S0.pen}:null,_px:S0.x,_py:S0.y,sc:S0.sc,hats:S0.hats,dead:false};
const i=RT.list.indexOf(S0);RT.list.splice(i<0?0:i,0,n);RT.clones++;for(const s of n.hats.clone)startScript(n,s);return n}
function deleteClone(T,th){if(!RT||!T.isClone||T.dead)return;T.dead=true;th.stop=true;const i=RT.list.indexOf(T);if(i>=0)RT.list.splice(i,1);RT.clones=Math.max(0,RT.clones-1)}
menuDefs.clone=o=>[['_myself_','自分自身']].concat(SC().objs.map(x=>[x.name,x.name+(x===o?'(自分と同じ名前のオブジェクト)':'')]));
def('control_startasclone','event','hat','クローンされたとき');
def('control_clone','control','stack','[T]のクローンを作る',{T:['m','clone','_myself_']},(T,A)=>{createClone(T,String(A.T))});
def('control_deleteclone','control','cap','このクローンを削除する',{},(T,A,th)=>{deleteClone(T,th)});
H.cloneStat=()=>'クローン '+RT.clones+'/'+MAXC;
Object.assign(H,{createClone,deleteClone,MAXC});
/* ---------- 変数 ---------- */
PAL.var=[];CATS.splice(CATS.findIndex(c=>c.id=='msg'),0,{id:'var',n:'変数',c:'#ff8c1a'});
const getVar=(T,n)=>{if(T.vars&&Object.prototype.hasOwnProperty.call(T.vars,n))return T.vars[n];if(RT&&Object.prototype.hasOwnProperty.call(RT.g,n))return RT.g[n];return 0};
const setVar=(T,n,v)=>{if(T.vars&&Object.prototype.hasOwnProperty.call(T.vars,n))T.vars[n]=v;else if(RT&&Object.prototype.hasOwnProperty.call(RT.g,n))RT.g[n]=v};
def('var_get','var','r','',{VAR:['s','']},(T,A)=>getVar(T,String(A.VAR)),{pal:false});
def('var_set','var','stack','[VAR]を[V]にする',{VAR:['m','var'],V:['s',0]},(T,A)=>{setVar(T,String(A.VAR),A.V)});
def('var_change','var','stack','[VAR]を[V]ずつ変える',{VAR:['m','var'],V:['n',1]},(T,A)=>{const n=String(A.VAR),o=getVar(T,n);setVar(T,n,toNum(o)+toNum(A.V))});
def('var_show','var','stack','変数[VAR]を表示する',{VAR:['m','var']},(T,A)=>{if(!RT)return;const n=String(A.VAR),loc=T.vars&&Object.prototype.hasOwnProperty.call(T.vars,n);if(!loc&&!Object.prototype.hasOwnProperty.call(RT.g,n))return;RT.mon[(loc?T.id:'')+'|'+n]={name:n,T:loc?T:null}});
def('var_hide','var','stack','変数[VAR]を隠す',{VAR:['m','var']},(T,A)=>{if(!RT)return;const n=String(A.VAR),loc=T.vars&&Object.prototype.hasOwnProperty.call(T.vars,n);delete RT.mon[(loc?T.id:'')+'|'+n]});
const varNames=o=>{const out=[];Object.keys(SC().gvars).forEach(n=>out.push([n,false]));if(o)Object.keys(o.vars).forEach(n=>out.push([n,true]));return out};
menuDefs.var=o=>varNames(o).map(([n,l])=>[n,n+(l?'(このオブジェクトのみ)':'')]).concat([['__newvar__','新しい変数…']]);

/* ============================================================
   第4部: Scratchにあって未実装だったブロックの追加(拡張機能を除く)
   ============================================================ */
const MS={x:0,y:0,down:false},KD=new Map();let DRG=null;
document.addEventListener('pointermove',e=>{if(!RT||!R.cv)return;const r=R.cv.getBoundingClientRect();if(!r.width)return;MS.x=Math.round((e.clientX-r.left)*480/r.width-240);MS.y=Math.round(180-(e.clientY-r.top)*360/r.height);if(DRG&&DRG.id===e.pointerId){DRG.T.x=cl(MS.x+DRG.dx);DRG.T.y=cl(MS.y+DRG.dy);if(DRG.T.pen&&DRG.T.pen.down)penTrack(DRG.T);SCN.drawNow()}},true);
document.addEventListener('pointerdown',e=>{if(!RT||e.target!==R.cv)return;MS.down=true;const[X,Y]=stagePt(e),h=pickAt(RT.list,X,Y,false);if(h&&h.drag)DRG={T:h,id:e.pointerId,dx:h.x-(X-240),dy:h.y-(180-Y)}},true);
const mup=()=>{MS.down=false;DRG=null};document.addEventListener('pointerup',mup,true);document.addEventListener('pointercancel',mup,true);
document.addEventListener('keydown',e=>{if(S.open)KD.set(e.code||e.key,keyIds(e))},true);document.addEventListener('keyup',e=>KD.delete(e.code||e.key),true);addEventListener('blur',()=>KD.clear());
const keyDown=id=>{id=String(id).toLowerCase();for(const s of KD.values())if(id=='any'||s.has(id))return true;return false};
const tgt=(T,v)=>{v=String(v);if(v=='_random_')return[Math.round(Math.random()*480-240),Math.round(Math.random()*360-180)];if(v=='_mouse_')return[MS.x,MS.y];const o=RT&&RT.list.find(t=>t!==T&&t.name===v);return o?[o.x,o.y]:null};
menuDefs.gt=o=>[['_random_','ランダムな場所'],['_mouse_','マウスのポインター']].concat(menuDefs.target(o));
menuDefs.pt=o=>[['_mouse_','マウスのポインター']].concat(menuDefs.target(o));
menuDefs.touch=menuDefs.pt;
menuDefs.prop=()=>[['x','X座標'],['y','Y座標'],['dir','向き'],['cn','コスチュームの番号'],['cname','コスチュームの名前'],['size','大きさ']];
menuDefs.cur=()=>[['year','年'],['month','月'],['date','日'],['wday','曜日'],['hour','時'],['min','分'],['sec','秒']];
menuDefs.fx=()=>[['color','色'],['fisheye','魚眼'],['whirl','渦巻き'],['pixelate','ピクセル化'],['mosaic','モザイク'],['bright','明るさ'],['ghost','幽霊(透明度)']];
menuDefs.dragm=()=>[['1','ドラッグできる'],['0','ドラッグできない']];
menuDefs.layer=()=>[['f','手前'],['b','奥']];
menuDefs.gtw=()=>[['timer','タイマー'],['loudness','音量(マイク)']];
/* 動き */
def('motion_gotot','motion','stack','[T]へ行く',{T:['m','gt','_random_']},(T,A)=>{const p=tgt(T,A.T);if(p){T.x=cl(p[0]);T.y=cl(p[1])}});
def('motion_glidet','motion','stack','[SECS]秒で[T]へ行く',{SECS:['n',1],T:['m','gt','_random_']},function*(T,A,th){const p=tgt(T,A.T);if(!p)return;const t0=now(),d=Math.max(0,toNum(A.SECS))*1000,sx=T.x,sy=T.y;for(;;){const k=d?Math.min(1,(now()-t0)/d):1;T.x=cl(sx+(p[0]-sx)*k);T.y=cl(sy+(p[1]-sy)*k);if(k>=1)return;yield;if(th.stop||T.dead)return}});
def('motion_towards','motion','stack','[T]へ向ける',{T:['m','pt','_mouse_']},(T,A)=>{const p=tgt(T,A.T);if(p&&(p[0]!==T.x||p[1]!==T.y))T.dir=normDir(Math.atan2(p[0]-T.x,p[1]-T.y)*180/Math.PI)});
def('motion_bounce','motion','stack','端に触れたら跳ね返る',{},T=>{if(!T.vis)return;const b=aabb(corners(T)),d=[-b[0],b[2]-480,-b[1],b[3]-360];let m=0;for(let i=1;i<4;i++)if(d[i]>d[m])m=i;if(d[m]<=0)return;const a=T.dir*Math.PI/180;let dx=Math.sin(a),dy=Math.cos(a);if(m==0)dx=Math.abs(dx);else if(m==1)dx=-Math.abs(dx);else if(m==2)dy=-Math.abs(dy);else dy=Math.abs(dy);T.dir=normDir(Math.atan2(dx,dy)*180/Math.PI);if(d[0]>0)T.x+=d[0];if(d[1]>0)T.x-=d[1];if(d[2]>0)T.y-=d[2];if(d[3]>0)T.y+=d[3]});
def('motion_dir','motion','r','向き',{},T=>T.dir);
/* 見た目: 言う/考える・画像効果・重なり順 */
const say=(T,v,th)=>{const s=toStr(v);T.say=s===''?null:{t:s,th};return T.say};
def('looks_say','looks','stack','[M]と言う',{M:['s','こんにちは!']},(T,A)=>{say(T,A.M,0)});
def('looks_sayfor','looks','stack','[M]と[SECS]秒言う',{M:['s','こんにちは!'],SECS:['n',2]},function*(T,A,th){const s=say(T,A.M,0),end=now()+toNum(A.SECS)*1000;do{yield;if(th.stop||T.dead)break}while(now()<end);if(T.say===s)T.say=null});
def('looks_think','looks','stack','[M]と考える',{M:['s','うーん…']},(T,A)=>{say(T,A.M,1)});
def('looks_thinkfor','looks','stack','[M]と[SECS]秒考える',{M:['s','うーん…'],SECS:['n',2]},function*(T,A,th){const s=say(T,A.M,1),end=now()+toNum(A.SECS)*1000;do{yield;if(th.stop||T.dead)break}while(now()<end);if(T.say===s)T.say=null});
const fxo=T=>T.fx||(T.fx={color:0,fisheye:0,whirl:0,pixelate:0,mosaic:0,bright:0}),fxSet=(T,e,v,rel)=>{e=String(e);if(e=='ghost'){T.ghost=clamp((rel?T.ghost:0)+v,0,100);return}const f=fxo(T);if(!(e in f))return;f[e]=(rel?f[e]:0)+v;if(e=='bright')f[e]=clamp(f[e],-100,100)};
def('looks_fxchange','looks','stack','[E]の効果を[V]ずつ変える',{E:['m','fx','color'],V:['n',25]},(T,A)=>{fxSet(T,A.E,toNum(A.V),1)});
def('looks_fxset','looks','stack','[E]の効果を[V]にする',{E:['m','fx','color'],V:['n',0]},(T,A)=>{fxSet(T,A.E,toNum(A.V),0)});
def('looks_fxclear','looks','stack','画像効果をなくす',{},T=>{T.fx=null;T.ghost=0});
def('looks_layer','looks','stack','[D]へ[N]層動かす',{D:['m','layer','f'],N:['n',1]},(T,A)=>{const L=RT.list,i=L.indexOf(T);if(i<0)return;const n=Math.round(toNum(A.N))*(String(A.D)=='b'?-1:1);L.splice(i,1);L.splice(clamp(i+n,0,L.length),0,T)});
/* ---------- 画像効果(色・魚眼・渦巻き・ピクセル化・モザイク・明るさ) ----------
   TurboWarp/Scratchと同じく、GPU(WebGLのシェーダー)で1ピクセルずつ並列に計算する。
   - 元の絵(効果なし)の描画結果はオブジェクトごとに使い回し、変わった時だけ作り直す
   - GPUのテクスチャは絵が変わった時だけ送り直す(毎フレームの転送をなくす)
   - WebGLが使えない/失敗した時は、従来のCPU計算に自動で切り替わる(見た目は同じ)
   計算式はScratchと同じで、モザイク→ピクセル化→渦巻き→魚眼の順に座標を変換する。 */
const FXC=document.createElement('canvas'),FXX=FXC.getContext('2d',{willReadFrequently:true}),_do=drawObj;
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const M=Math.max(r,g,b),m=Math.min(r,g,b),l=(M+m)/2;let h=0,s=0;if(M!==m){const d=M-m;s=l>.5?d/(2-M-m):d/(M+m);h=M==r?(g-b)/d+(g<b?6:0):M==g?(b-r)/d+2:(r-g)/d+4;h/=6}return[h,s,l]}
function hsl2rgb(h,s,l){const f=(p,q,t)=>{t=((t%1)+1)%1;return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p};if(s==0)return[l*255,l*255,l*255];const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;return[f(p,q,h+1/3)*255,f(p,q,h)*255,f(p,q,h-1/3)*255]}
const FXV='attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
const FXF=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform sampler2D t;uniform vec2 sz;uniform float mos,bs,wh,fe,hu,br;uniform vec4 on;
vec3 toHsl(vec3 c){float M=max(c.r,max(c.g,c.b)),m=min(c.r,min(c.g,c.b)),l=(M+m)*.5,h=0.,s=0.;if(M!=m){float d=M-m;s=l>.5?d/(2.-M-m):d/(M+m);if(M==c.r)h=(c.g-c.b)/d+(c.g<c.b?6.:0.);else if(M==c.g)h=(c.b-c.r)/d+2.;else h=(c.r-c.g)/d+4.;h/=6.;}return vec3(h,s,l);}
float hv(float p,float q,float x){x=fract(x);if(x<1./6.)return p+(q-p)*6.*x;if(x<.5)return q;if(x<2./3.)return p+(q-p)*(2./3.-x)*6.;return p;}
vec3 fromHsl(vec3 c){if(c.y==0.)return vec3(c.z);float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y,p=2.*c.z-q;return vec3(hv(p,q,c.x+1./3.),hv(p,q,c.x),hv(p,q,c.x-1./3.));}
void main(){vec2 uv=v;
if(on.x>.5)uv=fract(uv*mos);
if(on.y>.5)uv=(floor(uv*sz/bs)+.5)*bs/sz;
if(on.z>.5){vec2 o=uv-.5;float m=length(o),fc=max(1.-m/.5,0.),a=wh*fc*fc,c=cos(a),s=sin(a);uv=.5+vec2(c*o.x-s*o.y,s*o.x+c*o.y);}
if(on.w>.5){vec2 w=(uv-.5)/.5;float len=length(w);if(len>0.){float r=pow(min(len,1.),fe)*max(1.,len);uv=.5+r*w/len*.5;}}
if(uv.x<0.||uv.x>=1.||uv.y<0.||uv.y>=1.){gl_FragColor=vec4(0.);return;}
uv=(floor(uv*sz+1e-4)+.5)/sz;vec4 s=texture2D(t,uv);if(s.a<=0.){gl_FragColor=vec4(0.);return;}
vec3 c=s.rgb;
if(hu!=0.){vec3 h=toHsl(c);if(h.z<.055){h.x=0.;h.y=1.;h.z=.055;}else if(h.y<.09){h.x=0.;h.y=.09;}h.x=fract(h.x+hu);c=fromHsl(h);}
c=clamp(c+br,0.,1.);gl_FragColor=vec4(c*s.a,s.a);}`;
let FXG=null,FXGfail=0;
function fxInitGL(){if(FXGfail>=3)return null;try{const cv=document.createElement('canvas');cv.width=cv.height=2;
const gl=cv.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});if(!gl)throw Error('no webgl');
const sh=(ty,src)=>{const s=gl.createShader(ty);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,FXV));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FXF));gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(pr));
gl.useProgram(pr);const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);[[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]].forEach(a=>gl.texParameteri(gl.TEXTURE_2D,a[0],a[1]));
gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
const U={};['t','sz','mos','bs','wh','fe','hu','br','on'].forEach(n=>U[n]=gl.getUniformLocation(pr,n));gl.uniform1i(U.t,0);
const g={cv,gl,pr,U,tex,max:Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE)||2048,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||2048,4096),lastId:-1,ok:0,nok:0};
cv.addEventListener('webglcontextlost',ev=>{ev.preventDefault();if(FXG===g)FXG=null;FXGfail++});return g}
catch(e){FXGfail=3;console.warn('画像効果: WebGLを使えないためCPUで計算します',e);return null}}
/* GPUで計算。成功したらWebGLのcanvasを返す(失敗ならnull→CPU計算へ) */
function fxGPU(p,e,W,H2){const g=FXG||(FXG=fxInitGL());if(!g||W>g.max||H2>g.max)return null;
try{const gl=g.gl;if(gl.isContextLost()){FXG=null;return null}
if(g.cv.width!==W||g.cv.height!==H2){g.cv.width=W;g.cv.height=H2}gl.viewport(0,0,W,H2);gl.useProgram(g.pr);
gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,g.tex);
if(g.lastId!==e.id||g.lastCv!==e.cv){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,e.cv);g.lastId=e.id;g.lastCv=e.cv}
const U=g.U;gl.uniform2f(U.sz,W,H2);gl.uniform1f(U.mos,p.mos);gl.uniform1f(U.bs,p.bs||1);gl.uniform1f(U.wh,p.wh);gl.uniform1f(U.fe,p.fe);gl.uniform1f(U.hu,p.hu);gl.uniform1f(U.br,p.br/255);gl.uniform4f(U.on,p.mos>1?1:0,p.bs?1:0,p.wh?1:0,p.fisheye?1:0);
gl.drawArrays(gl.TRIANGLE_STRIP,0,4);if(!g.ok){if(gl.getError()!==gl.NO_ERROR)return null;if(++g.nok>=3)g.ok=1}return g.cv}
catch(err){FXG=null;FXGfail++;return null}}
/* CPU計算(WebGLが使えない時の予備。従来と同じ処理) */
function fxCPU(p,e,W,H2){const S=e.x.getImageData(0,0,W,H2).data,D=new Uint8ClampedArray(S.length),{mos,bs,wh,fe,hu,br}=p;
for(let j=0;j<H2;j++)for(let i=0;i<W;i++){let u=(i+.5)/W,v=(j+.5)/H2;
if(mos>1){u=(u*mos)%1;v=(v*mos)%1}
if(bs){u=(Math.floor(u*W/bs)+.5)*bs/W;v=(Math.floor(v*H2/bs)+.5)*bs/H2}
if(wh){const ou=u-.5,ov=v-.5,m=Math.hypot(ou,ov),fc=Math.max(1-m/.5,0),a=wh*fc*fc,c=Math.cos(a),s=Math.sin(a);u=.5+c*ou-s*ov;v=.5+s*ou+c*ov}
if(p.fisheye){const vu=(u-.5)/.5,vv=(v-.5)/.5,len=Math.hypot(vu,vv);if(len>0){const rr=Math.pow(Math.min(len,1),fe)*Math.max(1,len);u=.5+rr*vu/len*.5;v=.5+rr*vv/len*.5}}
if(u<0||u>=1||v<0||v>=1)continue;const sx=Math.floor(u*W),sy=Math.floor(v*H2),si=(sy*W+sx)*4,di=(j*W+i)*4;let R=S[si],G=S[si+1],B=S[si+2];const A=S[si+3];if(!A)continue;
if(hu){let[h,sa,l]=rgb2hsl(R,G,B);if(l<.055){h=0;sa=1;l=.055}else if(sa<.09){h=0;sa=.09}[R,G,B]=hsl2rgb((h+hu)%1,sa,l)}
if(br){R+=br;G+=br;B+=br}D[di]=R;D[di+1]=G;D[di+2]=B;D[di+3]=A}
if(FXC.width!==W||FXC.height!==H2){FXC.width=W;FXC.height=H2}FXX.putImageData(new ImageData(D,W,H2),0,0);return FXC}
/* 効果をかける前の絵。実行中は(コスチューム・大きさ・解像度が同じ間)オブジェクトごとに使い回す */
let FXPX=1.2e6;const FXPX_MAX=1.2e6,FXPX_MIN=4e4;/* 1回の計算で扱う最大ピクセル数(大きなスプライトは解像度を少し下げて軽くする) */
const FXB=new WeakMap();let fxSeq=0;
function fxBase(x,o,lo,r,W,H2,bb){const c=o.c,run=!!(H.rt&&H.rt()),ok=run&&c&&alive(o)&&!(H.extensionBox&&H.extensionBox(o));let inf=null,m=null,key='';
if(ok){inf=info(c);m=FXB.get(o);if(!m)FXB.set(o,m={});key=r.toFixed(3);const e=m[key];if(e&&e.c===c&&e.inf===inf&&e.size===o.size&&e.W===W&&e.H===H2)return e;if(W*H2>2e6)m=null}
let cv,cx;if(m){cv=document.createElement('canvas');cv.width=W;cv.height=H2;cx=cv.getContext('2d')}else{cv=FXC;cx=FXX;if(FXC.width!==W||FXC.height!==H2){FXC.width=W;FXC.height=H2}else cx.clearRect(0,0,W,H2)}
cx.setTransform(r,0,0,r,-bb[0]*r,-bb[1]*r);_do(cx,lo,r);cx.setTransform(1,0,0,1,0,0);
const e={cv,x:cx,id:++fxSeq,c,inf,size:o.size,W,H:H2,keep:!!m,rk:'',rc:null};if(m){for(const k in m)delete m[k];m[key]=e}return e}
/* 色・明るさだけのエフェクト: 位置を動かさないので、コスチューム本来の大きさで1回だけ計算し、
   大きさ・向き・位置が毎フレーム変わっても同じ結果を拡大縮小して使い回す(従来は大きさが変わるたびに全部計算し直していた)。
   (コスチューム, 色, 明るさ) ごとに保存し、容量を超えたら古いものから捨てる。同じコスチュームのクローンは全員で共有 */
const FXR=new Map();let fxRpx=0;const FXRMAX=8e6;
function fxRecolorMake(P,hu,br){const w=P.sw,h=P.sh,cv=document.createElement('canvas');cv.width=w;cv.height=h;const small=w*h<=65536,cx=cv.getContext('2d',{willReadFrequently:small});cx.drawImage(P.cv,P.sx,P.sy,w,h,0,0,w,h);
if(!small){const g=FXG||(FXG=fxInitGL());if(g){const out=fxGPU({mos:1,bs:0,wh:0,fe:1,hu,br,fisheye:false},{id:++fxSeq,cv,x:cx},w,h);if(out){cx.clearRect(0,0,w,h);cx.drawImage(out,0,0);return cv}}}
const im=cx.getImageData(0,0,w,h),d=im.data;for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;let R=d[i],G=d[i+1],B=d[i+2];if(hu){let[hh,sa,l]=rgb2hsl(R,G,B);if(l<.055){hh=0;sa=1;l=.055}else if(sa<.09){hh=0;sa=.09}[R,G,B]=hsl2rgb((hh+hu)%1,sa,l)}if(br){R+=br;G+=br;B+=br}d[i]=R;d[i+1]=G;d[i+2]=B}cx.putImageData(im,0,0);return cv}
function fxRecolor(x,o,k,f){const c=o.c;if(!c||!alive(o)||(H.extensionBox&&H.extensionBox(o)))return false;const rt=H.rt&&H.rt();if(!rt)return false;if(FXR.rt!==rt){FXR.clear();fxRpx=0;FXR.rt=rt}
const hq=Math.round(((((f.color||0)/200)%1)+1)%1*360)%360,bq=Math.round(clamp((f.bright||0)/100*255,-255,255));if(!hq&&!bq)return false;
const r=info(c),P=paintSrc(c,r);if(!P)return false;const key=(c._fid||(c._fid=++fxSeq))+'|'+hq+'|'+bq;let e=FXR.get(key);
if(e&&e.inf===r){FXR.delete(key);FXR.set(key,e)}else{if(e){fxRpx-=e.px;FXR.delete(key)}e={cv:fxRecolorMake(P,hq/360,bq),inf:r,px:P.sw*P.sh};FXR.set(key,e);fxRpx+=e.px;for(const[kk,v]of FXR){if(fxRpx<=FXRMAX||kk===key)break;FXR.delete(kk);fxRpx-=v.px}}
x.save();x.globalAlpha=clamp(1-o.ghost/100,0,1);x.translate(240+o.x,180-o.y);x.rotate(rotF(o)[0]);const sz=Math.max(o.size,0)/100;x.scale(sz*rotF(o)[1]*stX(o),sz*stY(o));x.translate(-c.cx/r.R,-c.cy/r.R);
x.imageSmoothingEnabled=c.k=='b'?(k*sz/r.R)<1:true;x.drawImage(e.cv,0,0,P.sw,P.sh,P.dx,P.dy,P.dw,P.dh);x.restore();return true}
/* ===== 画面解像度で計算する空間エフェクト(魚眼・渦巻き・ピクセル化・モザイク)=====
   TurboWarp / Scratch と同じ考え方: スプライト全体の bbox を「予算内の解像度」で作って後から拡大するのをやめ、
   「画面に映っている部分のピクセルだけ」を、画面解像度のままシェーダーで計算する。
   ・出力は、スプライトの回転後の範囲 ∩ ステージ(480x360)だけ。スプライトがどれだけ巨大でも計算量は画面の画素数以下
   ・元の絵は bbox 用の中間キャンバスを作らず、コスチューム本来の画像(paintSrc)をそのままテクスチャにする
     (拡大時はニアレストで元のドットを保つ / 縮小時は 1/2 ずつ縮めた段階(ミップ)を作って線形補間 → ジャギーが出ない)
   ・出力ピクセル→bbox座標への変換(回転・移動・大きさ)は倍精度で作ったアフィン係数を渡す(巨大拡大でも精度が落ちない)
   WebGLが使えない時だけ、同じ式のCPU計算に切り替わり、その場合のみ解像度の自動調整(FXPX)が働く */
const FXF2=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform sampler2D t;uniform vec2 sz,pb,ts;uniform vec3 ux,uy;uniform vec4 tm;uniform float mos,wh,fe,hu,br,pm;uniform vec4 on;
vec3 toHsl(vec3 c){float M=max(c.r,max(c.g,c.b)),m=min(c.r,min(c.g,c.b)),l=(M+m)*.5,h=0.,s=0.;if(M!=m){float d=M-m;s=l>.5?d/(2.-M-m):d/(M+m);if(M==c.r)h=(c.g-c.b)/d+(c.g<c.b?6.:0.);else if(M==c.g)h=(c.b-c.r)/d+2.;else h=(c.r-c.g)/d+4.;h/=6.;}return vec3(h,s,l);}
float hv(float p,float q,float x){x=fract(x);if(x<1./6.)return p+(q-p)*6.*x;if(x<.5)return q;if(x<2./3.)return p+(q-p)*(2./3.-x)*6.;return p;}
vec3 fromHsl(vec3 c){if(c.y==0.)return vec3(c.z);float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y,p=2.*c.z-q;return vec3(hv(p,q,c.x+1./3.),hv(p,q,c.x),hv(p,q,c.x-1./3.));}
void main(){vec2 q=v*sz;vec2 uv=vec2(ux.x*q.x+ux.y*q.y+ux.z,uy.x*q.x+uy.y*q.y+uy.z);
if(uv.x<0.||uv.x>=1.||uv.y<0.||uv.y>=1.){gl_FragColor=vec4(0.);return;}
if(on.x>.5)uv=fract(uv*mos);
if(on.y>.5)uv=(floor(uv/pb)+.5)*pb;
if(on.z>.5){vec2 o=uv-.5;float m=length(o),fc=max(1.-m/.5,0.),a=wh*fc*fc,c=cos(a),s=sin(a);uv=.5+vec2(c*o.x-s*o.y,s*o.x+c*o.y);}
if(on.w>.5){vec2 w=(uv-.5)/.5;float len=length(w);if(len>0.){float r=pow(min(len,1.),fe)*max(1.,len);uv=.5+r*w/len*.5;}}
if(uv.x<0.||uv.x>=1.||uv.y<0.||uv.y>=1.){gl_FragColor=vec4(0.);return;}
vec2 tc=vec2(uv.x*tm.x+tm.y,uv.y*tm.z+tm.w);
if(tc.x<0.||tc.x>=1.||tc.y<0.||tc.y>=1.){gl_FragColor=vec4(0.);return;}
if(pm<.5)tc=(floor(tc*ts+1e-4)+.5)/ts;/* ドットの境界ぴったりでGPU/CPUがずれないように */
vec4 s=texture2D(t,tc);if(s.a<=0.){gl_FragColor=vec4(0.);return;}
vec3 c=pm>.5?s.rgb/s.a:s.rgb;
if(hu!=0.){vec3 h=toHsl(c);if(h.z<.055){h.x=0.;h.y=1.;h.z=.055;}else if(h.y<.09){h.x=0.;h.y=.09;}h.x=fract(h.x+hu);c=fromHsl(h);}
c=clamp(c+br,0.,1.);gl_FragColor=vec4(c*s.a,s.a);}`;
let FXG2=null,FXG2fail=0;
function fxInit2(){if(FXG2fail>=3)return null;try{const cv=document.createElement('canvas');cv.width=cv.height=2;
const gl=cv.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});if(!gl)throw Error('no webgl');
const hp=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);if(!hp||!hp.precision)throw Error('no highp');
const sh=(ty,src)=>{const s=gl.createShader(ty);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,FXV));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FXF2));gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(pr));
gl.useProgram(pr);const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
const U={};['t','sz','pb','ts','ux','uy','tm','mos','wh','fe','hu','br','pm','on'].forEach(n=>U[n]=gl.getUniformLocation(pr,n));gl.uniform1i(U.t,0);
const g={cv,gl,pr,U,tc:new Map(),tpx:0,tmp:null,CW:2,CH:2,ok:0,nok:0,max:Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE)||2048,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||2048,gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]||2048,4096)};
cv.addEventListener('webglcontextlost',ev=>{ev.preventDefault();if(FXG2===g)FXG2=null;FXG2fail++});return g}
catch(e){FXG2fail=3;console.warn('画面効果: WebGLを使えないためCPUで計算します',e);return null}}
const FXT_MAX=16e6;/* GPUに残すテクスチャの合計画素数(超えたら古いものから捨てる) */
function fxTex(g,cv,pm,lin,keep){const gl=g.gl;let e=keep?g.tc.get(cv):null;
if(e&&e.pm===pm&&e.lin===lin){g.tc.delete(cv);g.tc.set(cv,e);return e.tex}
if(e){gl.deleteTexture(e.tex);g.tpx-=e.px;g.tc.delete(cv)}
let tex;if(keep)tex=gl.createTexture();else tex=g.tmp||(g.tmp=gl.createTexture());
gl.bindTexture(gl.TEXTURE_2D,tex);const f=lin?gl.LINEAR:gl.NEAREST;[[gl.TEXTURE_MIN_FILTER,f],[gl.TEXTURE_MAG_FILTER,f],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]].forEach(a=>gl.texParameteri(gl.TEXTURE_2D,a[0],a[1]));
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!!pm);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cv);
if(keep){const px=cv.width*cv.height;g.tc.set(cv,{tex,pm,lin,px});g.tpx+=px;for(const[k2,v2]of g.tc){if(g.tpx<=FXT_MAX||k2===cv)break;gl.deleteTexture(v2.tex);g.tpx-=v2.px;g.tc.delete(k2)}}
return tex}
/* 元の絵(コスチューム画像の描く範囲)と、縮小用に1/2ずつ縮めた段階。実行中はコスチューム単位で使い回す */
function fxSrc(r,P,L,keep){let m=keep?r.fxl:null;
if(!m||m.cv!==P.cv||m.sx!==P.sx||m.sy!==P.sy||m.sw!==P.sw||m.sh!==P.sh){m={cv:P.cv,sx:P.sx,sy:P.sy,sw:P.sw,sh:P.sh,lv:[]};if(keep)r.fxl=m}
let a=m.lv[0];if(!a){a=document.createElement('canvas');a.width=P.sw;a.height=P.sh;const g=a.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(P.cv,P.sx,P.sy,P.sw,P.sh,0,0,P.sw,P.sh);m.lv[0]=a}
for(let i=1;i<=L;i++){let b=m.lv[i];if(!b){const p=m.lv[i-1];b=document.createElement('canvas');b.width=Math.max(1,Math.ceil(p.width/2));b.height=Math.max(1,Math.ceil(p.height/2));const g=b.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(p,0,0,p.width,p.height,0,0,b.width,b.height);m.lv[i]=b}}
return m.lv[L]}
/* GPU: 出力(W×H)を1回で計算。canvasは使い回し、viewportだけ変える(左上のW×Hが結果) */
function fxScreenGPU(p,A,src,lin,keep,W,H2){const g=FXG2||(FXG2=fxInit2());if(!g||W>g.max||H2>g.max)return null;
try{const gl=g.gl;if(gl.isContextLost()){FXG2=null;return null}
if(W>g.CW||H2>g.CH){g.CW=Math.min(g.max,Math.max(W,g.CW));g.CH=Math.min(g.max,Math.max(H2,g.CH));g.cv.width=g.CW;g.cv.height=g.CH}
gl.viewport(0,g.CH-H2,W,H2);gl.useProgram(g.pr);gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D,fxTex(g,src,lin,lin,keep));
const U=g.U;gl.uniform2f(U.sz,W,H2);gl.uniform2f(U.pb,p.pbx||1,p.pby||1);gl.uniform2f(U.ts,src.width,src.height);gl.uniform3f(U.ux,A.ux[0],A.ux[1],A.ux[2]);gl.uniform3f(U.uy,A.uy[0],A.uy[1],A.uy[2]);gl.uniform4f(U.tm,A.tm[0],A.tm[1],A.tm[2],A.tm[3]);
gl.uniform1f(U.mos,p.mos);gl.uniform1f(U.wh,p.wh);gl.uniform1f(U.fe,p.fe);gl.uniform1f(U.hu,p.hu);gl.uniform1f(U.br,p.br/255);gl.uniform1f(U.pm,lin?1:0);
gl.uniform4f(U.on,p.mos>1?1:0,p.bs?1:0,p.wh?1:0,p.fisheye?1:0);
gl.drawArrays(gl.TRIANGLE_STRIP,0,4);if(!g.ok){if(gl.getError()!==gl.NO_ERROR)return null;if(++g.nok>=3)g.ok=1}return g.cv}
catch(err){FXG2=null;FXG2fail++;return null}}
/* CPU: GPUと同じ式(WebGLが使えない時の予備) */
function fxScreenCPU(p,A,src,lin,keep,W,H2){let id=keep?src._fxd:null;if(!id){id=src.getContext('2d').getImageData(0,0,src.width,src.height);if(keep)src._fxd=id}
const S=id.data,sw=id.width,sh=id.height,D=new Uint8ClampedArray(W*H2*4),{mos,wh,fe,hu,br}=p,[ux0,ux1,ux2]=A.ux,[uy0,uy1,uy2]=A.uy,[ta,tb,tc2,td]=A.tm,pbx=p.pbx||1,pby=p.pby||1;
for(let j=0;j<H2;j++)for(let i=0;i<W;i++){const qx=i+.5,qy=j+.5;let u=ux0*qx+ux1*qy+ux2,v=uy0*qx+uy1*qy+uy2;
if(u<0||u>=1||v<0||v>=1)continue;
if(mos>1){u=(u*mos)%1;v=(v*mos)%1}
if(p.bs){u=(Math.floor(u/pbx)+.5)*pbx;v=(Math.floor(v/pby)+.5)*pby}
if(wh){const ou=u-.5,ov=v-.5,m=Math.hypot(ou,ov),fc=Math.max(1-m/.5,0),a=wh*fc*fc,c=Math.cos(a),s=Math.sin(a);u=.5+c*ou-s*ov;v=.5+s*ou+c*ov}
if(p.fisheye){const vu=(u-.5)/.5,vv=(v-.5)/.5,len=Math.hypot(vu,vv);if(len>0){const rr=Math.pow(Math.min(len,1),fe)*Math.max(1,len);u=.5+rr*vu/len*.5;v=.5+rr*vv/len*.5}}
if(u<0||u>=1||v<0||v>=1)continue;
const tx=u*ta+tb,ty=v*tc2+td;if(tx<0||tx>=1||ty<0||ty>=1)continue;
let R,G,B,Al;
if(!lin){const si=(Math.min(sh-1,Math.floor(ty*sh+1e-4))*sw+Math.min(sw-1,Math.floor(tx*sw+1e-4)))*4;Al=S[si+3];if(!Al)continue;R=S[si];G=S[si+1];B=S[si+2];Al/=255;R/=255;G/=255;B/=255}
else{const fx=tx*sw-.5,fy=ty*sh-.5,x0=Math.floor(fx),y0=Math.floor(fy),wx=fx-x0,wy=fy-y0;let pr=0,pg=0,pb2=0,pa=0;
for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=Math.min(sw-1,Math.max(0,x0+dx)),yy=Math.min(sh-1,Math.max(0,y0+dy)),w=(dx?wx:1-wx)*(dy?wy:1-wy),si=(yy*sw+xx)*4,a=S[si+3]/255;pa+=w*a;pr+=w*a*S[si]/255;pg+=w*a*S[si+1]/255;pb2+=w*a*S[si+2]/255}
if(pa<=0)continue;Al=pa;R=pr/pa;G=pg/pa;B=pb2/pa}
if(hu){let[h,sa,l]=rgb2hsl(R*255,G*255,B*255);if(l<.055){h=0;sa=1;l=.055}else if(sa<.09){h=0;sa=.09}const o2=hsl2rgb((h+hu)%1,sa,l);R=o2[0]/255;G=o2[1]/255;B=o2[2]/255}
if(br){R+=br/255;G+=br/255;B+=br/255}
const di=(j*W+i)*4;D[di]=R*255;D[di+1]=G*255;D[di+2]=B*255;D[di+3]=Al*255}
if(FXC.width!==W||FXC.height!==H2){FXC.width=W;FXC.height=H2}FXX.putImageData(new ImageData(D,W,H2),0,0);return FXC}
/* 本体: 成功したら true(描画した)。使えない物(拡張機能の絵・未読込のベクター等)は false → 従来の方法に任せる */
function fxScreen(x,o,k,f){if(!alive(o)||(H.extensionBox&&H.extensionBox(o)))return false;
const c=o.c,r=info(c);if(!r||r.empty)return false;const P=paintSrc(c,r);if(!P)return false;
const s=Math.max(o.size,0)/100;if(!(s>1e-4))return false;
const lb=lbox(o),bx0=lb[0]*s,by0=lb[1]*s,bw=(lb[2]-lb[0])*s,bh=(lb[3]-lb[1])*s;if(!(bw>0&&bh>0))return false;
const ab=aabb(corners(o)),a0=Math.max(0,ab[0]),b0=Math.max(0,ab[1]),a1=Math.min(480,ab[2]),b1=Math.min(360,ab[3]);
if(!(a1>a0&&b1>b0))return true;/* 画面の外: 何も見えない */
const gpu=!!(FXG2||(FXG2=fxInit2())),keep=!!(H.rt&&H.rt());
let rk=Math.max(k,.1);
if(gpu){const g=FXG2;rk=Math.min(rk,g.max/(a1-a0+2),g.max/(b1-b0+2))}else rk=Math.min(rk,Math.sqrt(FXPX/((a1-a0)*(b1-b0))));
let X0=Math.floor(a0*rk),Y0=Math.floor(b0*rk),W=Math.ceil(a1*rk)-X0,H2=Math.ceil(b1*rk)-Y0;if(W<1||H2<1)return true;
const vx0=X0/rk,vy0=Y0/rk;
const mos=f.mosaic?clamp(Math.round((Math.abs(f.mosaic)+10)/10),1,512):1;
const B=f.pixelate?Math.max(Math.abs(f.pixelate)/10,1/rk):0;
const p={fisheye:!!f.fisheye,mos,bs:B,pbx:B/bw,pby:B/bh,wh:f.whirl*Math.PI/180,fe:f.fisheye?Math.max(0,(f.fisheye+100)/100):1,br:f.bright/100*255,hu:f.color/200};
/* 出力ピクセル(px,py) → bbox の uv(0〜1) の係数。回転・移動・拡大は倍精度でここで済ませる */
const an=(o.dir-90)*Math.PI/180,cs=Math.cos(an),sn=Math.sin(an),dx0=vx0-240-o.x,dy0=vy0-180+o.y;
const ux=[cs/(rk*bw),sn/(rk*bw),(cs*dx0+sn*dy0-bx0)/bw],uy=[-sn/(rk*bh),cs/(rk*bh),(-sn*dx0+cs*dy0-by0)/bh];
/* bbox の uv → 元画像(切り出した範囲)のテクスチャ座標 */
const cxR=c.cx/r.R,cyR=c.cy/r.R,tm=[bw/(s*P.dw),(bx0/s+cxR-P.dx)/P.dw,bh/(s*P.dh),(by0/s+cyR-P.dy)/P.dh];
/* 画面上で元の絵1ドットが何pxになるか。1以上ならそのまま(ビットマップはニアレスト)、未満なら縮めた段階を使う */
const ms=rk*s/(Math.max(1e-6,P.sw/P.dw)*mos);let L=0,lin=c.k!='b';if(ms<1){lin=true;L=Math.min(14,Math.max(0,Math.floor(Math.log2(1/ms))))}
const src=fxSrc(r,P,L,keep),A={ux,uy,tm},t0=performance.now();
let out=gpu?fxScreenGPU(p,A,src,lin,keep,W,H2):null;
if(!out){if(gpu){/* GPUが途中で失敗: CPUの予算に合わせてやり直し */rk=Math.min(rk,Math.sqrt(FXPX/((a1-a0)*(b1-b0))));X0=Math.floor(a0*rk);Y0=Math.floor(b0*rk);W=Math.ceil(a1*rk)-X0;H2=Math.ceil(b1*rk)-Y0;if(W<1||H2<1)return true;
const vx1=X0/rk,vy1=Y0/rk,ddx=vx1-240-o.x,ddy=vy1-180+o.y;A.ux=[cs/(rk*bw),sn/(rk*bw),(cs*ddx+sn*ddy-bx0)/bw];A.uy=[-sn/(rk*bh),cs/(rk*bh),(-sn*ddx+cs*ddy-by0)/bh];}
out=fxScreenCPU(p,A,src,lin,keep,W,H2)}
const dvx=X0/rk,dvy=Y0/rk;
x.save();x.globalAlpha=clamp(1-o.ghost/100,0,1);x.imageSmoothingEnabled=true;x.drawImage(out,0,0,W,H2,dvx,dvy,W/rk,H2/rk);x.restore();
/* CPU計算のときだけ、重い端末で解像度を自動で下げる(GPUは画面の画素数分なので固定) */
if(out===FXC){const dt=performance.now()-t0;if(dt>8)FXPX=Math.max(FXPX_MIN,FXPX*(dt>25?.5:.8));else if(dt<2.5&&FXPX<FXPX_MAX)FXPX=Math.min(FXPX_MAX,FXPX*1.03)}
return true}
drawObj=function(x,o,k){const f=o.fx;if(!f||!o.vis||!(f.color||f.fisheye||f.whirl||f.pixelate||f.mosaic||f.bright)){_do(x,o,k);return}
if(!f.fisheye&&!f.whirl&&!f.pixelate&&!f.mosaic&&fxRecolor(x,o,k,f))return;
if((f.fisheye||f.whirl||f.pixelate||f.mosaic)&&fxScreen(x,o,k,f))return;/* 画面解像度で計算(重い従来方式は下の予備) */
const lo={...o,x:0,y:0,dir:90,ghost:0,vis:true,fx:null},bb=aabb(corners(lo)),bw=bb[2]-bb[0],bh=bb[3]-bb[1];if(!(bw>0&&bh>0)||bw>6000||bh>6000){_do(x,o,k);return}
const t0=performance.now(),r=Math.min(Math.max(k,1),1400/Math.max(bw,bh),Math.sqrt(FXPX/(bw*bh))),W=Math.max(1,Math.ceil(bw*r)),H2=Math.max(1,Math.ceil(bh*r));
const e=fxBase(x,o,lo,r,W,H2,bb);
const p={fisheye:!!f.fisheye,mos:f.mosaic?clamp(Math.round((Math.abs(f.mosaic)+10)/10),1,512):1,bs:f.pixelate?Math.max(1,Math.abs(f.pixelate)/10*r):0,wh:f.whirl*Math.PI/180,fe:f.fisheye?Math.max(0,(f.fisheye+100)/100):1,br:f.bright/100*255,hu:f.color/200};
const rk=[p.mos,p.bs,p.wh,p.fe,p.hu,p.br,p.fisheye].join();let out;
if(e.keep&&e.rc&&e.rk===rk)out=e.rc;/* 同じ効果の2回目以降(スタンプの連打・動かない効果)は計算せず使い回す */
else{out=fxGPU(p,e,W,H2)||fxCPU(p,e,W,H2);
if(e.keep){if(e.rk===rk){const rc=document.createElement('canvas');rc.width=W;rc.height=H2;rc.getContext('2d').drawImage(out,0,0);e.rc=rc;out=rc}else{e.rk=rk;e.rc=null}}}
x.save();x.globalAlpha=clamp(1-o.ghost/100,0,1);x.translate(240+o.x,180-o.y);x.rotate(rotF(o)[0]);x.imageSmoothingEnabled=true;x.drawImage(out,bb[0]-240,bb[1]-180,bw,bh);x.restore();
/* 重い端末では空間エフェクトの解像度を自動で下げ、余裕があれば戻す(毎フレーム計算し直す効果のとき効く) */
if(!(e.keep&&e.rk===rk&&out===e.rc)){const dt=performance.now()-t0;if(dt>8)FXPX=Math.max(FXPX_MIN,FXPX*(dt>25?.5:.8));else if(dt<2.5&&FXPX<FXPX_MAX)FXPX=Math.min(FXPX_MAX,FXPX*1.03)}};
SCN.drawObjFx=(x,o,k)=>drawObj(x,o,k);SCN.fxMode=()=>(FXG2||(FXG2=fxInit2()))?'gpu':'cpu';SCN.fxForceCPU=v=>{FXGfail=v?3:0;FXG2fail=v?3:0;if(v){FXG=null;FXG2=null}};
function drawBubbles(x){if(!RT)return;for(const T of RT.list){const s=T.say;if(!s||!T.vis)continue;const bb=aabb(corners(T));x.save();x.font='14px sans-serif';const lines=[];let cur='';for(const ch of s.t){if(x.measureText(cur+ch).width>170&&cur){lines.push(cur);cur=ch}else cur+=ch}lines.push(cur);
const w=Math.max(...lines.map(l=>x.measureText(l).width))+20,h=lines.length*18+14;let bx=bb[2]-4,left=false;if(bx+w>478){bx=bb[0]-w+4;left=true}bx=clamp(bx,2,478-w);const by=clamp(bb[1]-h-14,2,358-h),tx=left?bx+w-34:bx+16,ty=by+h;
x.fillStyle='#fff';x.strokeStyle='#8a8a8a';x.lineWidth=2;x.beginPath();x.roundRect(bx,by,w,h,12);x.fill();x.stroke();
if(s.th){[[tx+6,ty+6,4.5],[tx+1,ty+14,2.8]].forEach(c=>{x.beginPath();x.arc(c[0],c[1],c[2],0,7);x.fill();x.stroke()})}else{x.beginPath();x.moveTo(tx,ty-1);x.lineTo(tx+(left?16:0),ty+13);x.lineTo(tx+16,ty-1);x.fill();x.beginPath();x.moveTo(tx,ty);x.lineTo(tx+(left?16:0),ty+13);x.lineTo(tx+16,ty);x.stroke();x.fillStyle='#fff';x.fillRect(tx+1,ty-3,14,4)}
x.fillStyle='#333';x.textBaseline='top';lines.forEach((l,i)=>x.fillText(l,bx+10,by+8+i*18));x.restore()}}
H.drawBub=drawBubbles;
/* イベント */
def('event_whengt','event','hat','[W]が[N]より大きいとき',{W:['m','gtw','timer'],N:['n',10]});
{const _ta=tickAll;tickAll=function(){if(RT&&!RT.halt){const tm=(now()-RT.t0)/1000;for(const T of RT.list.slice())for(const s of T.hats.gt||[]){const v=(String(s.b[0].in.W)=='loudness'?micLoud():tm)>toNum(s.b[0].in.N);if(v&&!s._on)startScript(T,s);s._on=v}}_ta()}}
/* 制御 */
def('control_stopother','control','stack','このオブジェクトの他のスクリプトを止める',{},(T,A,th)=>{for(const t of RT.threads)if(t.T===T&&t!==th){t.dead=true;t.stop=true}});
/* 調べる */
function colorHit(T,c1,c2){const rgb=h=>{h=String(h).trim().replace('#','');if(h.length==3)h=[...h].map(c=>c+c).join('');const n=parseInt(h,16);return h.length==6&&!isNaN(n)?[n>>16&255,n>>8&255,n&255]:null},a=rgb(c1),b=c2==null?null:rgb(c2);if(!a||(c2!=null&&!b)||!T.vis)return false;
const bb=aabb(corners(T)),x0=Math.max(0,Math.floor(bb[0])),y0=Math.max(0,Math.floor(bb[1])),W=Math.min(480,Math.ceil(bb[2]))-x0,Hh=Math.min(360,Math.ceil(bb[3]))-y0;if(W<=0||Hh<=0)return false;
CX2.forEach((x,i)=>{CV2[i].width=W;CV2[i].height=Hh;x.setTransform(1,0,0,1,-x0,-y0)});const x=CX2[0];drawBackdrop(x,1);if(RT.pc)x.drawImage(RT.pc,0,0,480,360);RT.list.forEach(o=>{if(o!==T)drawObj(x,o,1)});mask(CX2[1],T);CX2.forEach(x=>x.setTransform(1,0,0,1,0,0));
const D=CX2.map(x=>x.getImageData(0,0,W,Hh).data),m=(d,i,c)=>(d[i]&248)==(c[0]&248)&&(d[i+1]&248)==(c[1]&248)&&(d[i+2]&248)==(c[2]&248);
for(let i=0;i<D[0].length;i+=4)if(D[1][i+3]>0&&m(D[0],i,a)&&(!b||m(D[1],i,b)))return true;return false}
def('sense_touchcolor','sense','b','色[C]に触れた',{C:['s','#ff0000']},(T,A)=>RT?colorHit(T,A.C):false);
def('sense_colortouch','sense','b','色[C]が色[D]に触れた',{C:['s','#ff0000'],D:['s','#0000ff']},(T,A)=>RT?colorHit(T,A.D,A.C):false);
def('sense_distance','sense','r','[T]までの距離',{T:['m','pt','_mouse_']},(T,A)=>{const p=tgt(T,A.T);return p?Math.hypot(p[0]-T.x,p[1]-T.y):10000});
def('sense_ask','sense','stack','[Q]と聞いて待つ',{Q:['s','名前は?']},function*(T,A,th){let done=false,v='';askText(toStr(A.Q),'').then(r=>{v=r||'';done=true});while(!done){yield;if(th.stop||T.dead)return}RT.ans=v});
def('sense_answer','sense','r','答え',{},()=>RT?RT.ans:'');
def('sense_keypressed','sense','b','[KEY]キーが押された',{KEY:['m','key','space']},(T,A)=>keyDown(A.KEY));
def('sense_mousedown','sense','b','マウスが押された',{},()=>MS.down);
def('sense_mousex','sense','r','マウスのX座標',{},()=>MS.x);
def('sense_mousey','sense','r','マウスのY座標',{},()=>MS.y);
def('sense_setdrag','sense','stack','[M]にする',{M:['m','dragm','1']},(T,A)=>{T.drag=String(A.M)=='1'});
def('sense_timer','sense','r','タイマー',{},()=>RT?(now()-RT.t0)/1000:0);
def('sense_resettimer','sense','stack','タイマーをリセット',{},()=>{if(RT)RT.t0=now()});
def('sense_of','sense','r','[P]([T])',{P:['m','prop','x'],T:['m','target']},(T,A)=>{const o=RT&&RT.list.find(t=>t.name===String(A.T));if(!o)return 0;const p=String(A.P);return p=='x'?o.x:p=='y'?o.y:p=='dir'?o.dir:p=='size'?o.size:p=='cn'?costList(o).indexOf(o.c)+1:(o.c&&o.c.n)||''});
def('sense_current','sense','r','現在の[U]',{U:['m','cur','year']},(T,A)=>{const d=new Date();return{year:d.getFullYear(),month:d.getMonth()+1,date:d.getDate(),wday:d.getDay()+1,hour:d.getHours(),min:d.getMinutes(),sec:d.getSeconds()}[String(A.U)]||0});
def('sense_days2000','sense','r','2000年からの日数',{},()=>(Date.now()-new Date(2000,0,1).getTime())/864e5);
def('sense_username','sense','r','ユーザー名',{},()=>'');
/* 演算 */
def('op_contains','op','b','[A]に[B]が含まれる',{A:['s','りんご'],B:['s','り']},(T,A)=>toStr(A.A).toLowerCase().includes(toStr(A.B).toLowerCase()));
/* 変数のリスト操作(リストは「変数を作る」で作った変数を、リストとして使います) */
const LST=(T,n)=>{if(T.lists&&Object.prototype.hasOwnProperty.call(T.lists,n))return T.lists[n];if(RT&&RT.gl&&Object.prototype.hasOwnProperty.call(RT.gl,n))return RT.gl[n];return[]},LI=(L,i,ins)=>{i=String(i).toLowerCase();return i=='last'?L.length-(ins?0:1):i=='random'?Math.floor(Math.random()*(L.length+(ins?1:0))):Math.round(toNum(i))-1};
def('list_add','var','stack','[V]を[L]に追加する',{V:['s','もの'],L:['m','list']},(T,A)=>{const l=LST(T,String(A.L));if(l.length<200000)l.push(A.V)});
def('list_delete','var','stack','[L]の[I]番目を削除する',{L:['m','list'],I:['s',1]},(T,A)=>{const l=LST(T,String(A.L));if(String(A.I).toLowerCase()=='all'){l.length=0;return}const i=LI(l,A.I);if(i>=0&&i<l.length)l.splice(i,1)});
def('list_deleteall','var','stack','[L]のすべてを削除する',{L:['m','list']},(T,A)=>{LST(T,String(A.L)).length=0});
def('list_insert','var','stack','[V]を[L]の[I]番目に挿入する',{V:['s','もの'],L:['m','list'],I:['s',1]},(T,A)=>{const l=LST(T,String(A.L)),i=LI(l,A.I,1);if(i>=0&&i<=l.length)l.splice(i,0,A.V)});
def('list_replace','var','stack','[L]の[I]番目を[V]で置き換える',{L:['m','list'],I:['s',1],V:['s','もの']},(T,A)=>{const l=LST(T,String(A.L)),i=LI(l,A.I);if(i>=0&&i<l.length)l[i]=A.V});
def('list_item','var','r','[L]の[I]番目',{L:['m','list'],I:['s',1]},(T,A)=>{const l=LST(T,String(A.L)),i=LI(l,A.I);return i>=0&&i<l.length?l[i]:''});
def('list_indexof','var','r','[L]の[V]の位置',{L:['m','list'],V:['s','もの']},(T,A)=>{const v=toStr(A.V).toLowerCase();return LST(T,String(A.L)).findIndex(x=>toStr(x).toLowerCase()===v)+1});
def('list_length','var','r','[L]の項目数',{L:['m','list']},(T,A)=>LST(T,String(A.L)).length);
def('list_contains','var','b','[L]に[V]が含まれる',{L:['m','list'],V:['s','もの']},(T,A)=>{const v=toStr(A.V).toLowerCase();return LST(T,String(A.L)).some(x=>toStr(x).toLowerCase()===v)});
function askVar(K){K=K||'変数';return new Promise(res=>{const ov=el('div','sc-ov'),d=el('div','sc-dl');d.innerHTML='<h3>新しい'+K+'</h3><input type="text" maxlength="40" placeholder="'+K+'名" autocomplete="off" spellcheck="false"><label class="rd"><input type="radio" name="scv" value="g" checked>すべてのオブジェクト用(グローバル)</label><label class="rd"><input type="radio" name="scv" value="l">このオブジェクトのみ(ローカル)</label><div class="acts"><button class="sc-b" type="button">キャンセル</button><button class="sc-b pri" type="button">作る</button></div>';
const inp=d.querySelector('input[type=text]'),[b0,b1]=d.querySelectorAll('button');let done=0;const fin=v=>{if(done)return;done=1;ov.remove();res(v)};
const ok=()=>{const n=inp.value.trim();if(!n)return;fin({name:n.slice(0,40),scope:d.querySelector('input[name=scv]:checked').value})};b0.onclick=()=>fin(null);b1.onclick=ok;
inp.onkeydown=e=>{e.stopPropagation();if(e.isComposing||e.keyCode==229)return;if(e.key=='Enter'){e.preventDefault();ok()}else if(e.key=='Escape'){e.preventDefault();fin(null)}};ov.onpointerdown=e=>{if(e.target===ov)fin(null)};ov.append(d);document.body.append(ov);inp.focus()})}
function addVar(name,scope,o){const s=SC();o=o||OBJ();
if(scope=='l'){if(!o){toast('オブジェクトを選んでください');return null}if(name in s.gvars||name in o.vars){toast('同じ名前の変数がすでにあります');return null}o.vars[name]=0}
else{if(name in s.gvars||s.objs.some(x=>name in x.vars)){toast('同じ名前の変数がすでにあります');return null}s.gvars[name]=0}touch();return name}
H.newVar=async()=>{const r=await askVar();return r?addVar(r.name,r.scope):null};
function walk(arr,f){for(const b of arr){f(b);if(b.in)for(const k in b.in)if(b.in[k]&&typeof b.in[k]=='object')walk([b.in[k]],f);if(b.c)for(const k in b.c)walk(b.c[k],f)}}
const VAROPS=['var_get','var_set','var_change','var_show','var_hide'];
function renameVar(name,local,o){return askText('「'+name+'」の新しい名前',name,'変更').then(n=>{if(!n||n===name)return;const s=SC();if(n in s.gvars||s.objs.some(x=>n in x.vars)){toast('同じ名前の変数がすでにあります');return}stopRun();
const objs=local?[o]:s.objs;if(local){const v={};Object.keys(o.vars).forEach(k=>v[k==name?n:k]=o.vars[k]);o.vars=v}else{const v={};Object.keys(s.gvars).forEach(k=>v[k==name?n:k]=s.gvars[k]);s.gvars=v}
objs.forEach(x=>x.sc.forEach(sc=>walk(sc.b,b=>{if(VAROPS.includes(b.op)&&b.in.VAR===name)b.in.VAR=n})));touch();renderPal();renderWS()})}
function purge(arr){for(let i=arr.length-1;i>=0;i--){const b=arr[i];if(b.in)for(const k in b.in)if(b.in[k]&&typeof b.in[k]=='object')b.in[k]=null;if(b.c)for(const k in b.c)purge(b.c[k])}}
async function deleteVar(name,local,o){if(!await uiConfirm('変数「'+name+'」を削除しますか?\n(この変数を使うブロックは無効になります)'))return;stopRun();const s=SC();if(local)delete o.vars[name];else delete s.gvars[name];
const objs=local?[o]:s.objs;objs.forEach(x=>{const rm=arr=>{for(let i=arr.length-1;i>=0;i--){const b=arr[i];if(VAROPS.includes(b.op)&&b.op!='var_get'&&b.in.VAR===name){arr.splice(i,1);continue}if(b.in)for(const k in b.in){const v=b.in[k];if(v&&typeof v=='object'){if(v.op=='var_get'&&v.in.VAR===name)b.in[k]=0;else rm2(v)}}if(b.c)for(const k in b.c)rm(b.c[k])}},rm2=b=>{if(b.in)for(const k in b.in){const v=b.in[k];if(v&&typeof v=='object'){if(v.op=='var_get'&&v.in.VAR===name)b.in[k]=0;else rm2(v)}}};x.sc.forEach(sc=>{rm(sc.b);if(sc.b[0]&&sc.b[0].op=='var_get'&&sc.b[0].in.VAR===name)sc.b.length=0});x.sc=x.sc.filter(z=>z.b.length)});touch();renderPal();renderWS()}
PALX.var=(p,o)=>{const b=el('button','sc-b','変数を作る');b.type='button';b.onclick=async()=>{const n=await H.newVar();if(n){renderPal();renderWS()}};p.append(b);
const L=varNames(o);if(!L.length){const t=el('div',null,'変数がありません');t.style.cssText='font-size:12px;opacity:.7;margin:6px 0';p.append(t)}
L.forEach(([n,loc])=>{const row=el('div','vrow'),e=renderScript({b:[mkBlock('var_get',{VAR:n})]},true);e.title=loc?'このオブジェクトのみの変数':'すべてのオブジェクトで共有する変数';const m=el('button','sc-b','⋯');m.type='button';m.title='名前の変更・削除';m.style.minWidth='34px';
m.onclick=ev=>{const r=m.getBoundingClientRect();menuAt(r.left,r.bottom,[['名前を変更',()=>renameVar(n,loc,o)],['削除',()=>deleteVar(n,loc,o),'danger']])};row.append(e,m);p.append(row)});
const h=el('div',null,'※変数名の横の「⋯」で変更・削除。ブロックを置いたあと、変数の選択欄からも選べます');h.style.cssText='font-size:11px;opacity:.65;margin:4px 0 8px';p.append(h)};

/* ============================================================
   第5部: リスト(変数とは別のデータ。グローバル/このオブジェクトのみ・名前変更・削除・ステージ表示)
   ============================================================ */
const LISTOPS=['list_get','list_add','list_delete','list_deleteall','list_insert','list_replace','list_item','list_indexof','list_length','list_contains','list_show','list_hide'];
menuDefs.list=o=>{const g=SC().glists||{},out=Object.keys(g).map(n=>[n,n]);if(o&&o.lists)Object.keys(o.lists).forEach(n=>out.push([n,n+'(このオブジェクトのみ)']));return out.concat([['__newlist__','新しいリスト…']])};
def('list_get','var','r','',{L:['s','']},(T,A)=>{const l=LST(T,String(A.L));return l.every(x=>toStr(x).length==1)?l.map(toStr).join(''):l.map(toStr).join(' ')},{pal:false});
def('list_show','var','stack','リスト[L]を表示する',{L:['m','list']},(T,A)=>{if(!RT)return;const n=String(A.L),loc=!!(T.lists&&Object.prototype.hasOwnProperty.call(T.lists,n));if(!loc&&!Object.prototype.hasOwnProperty.call(RT.gl,n))return;RT.lmon[(loc?T.id:'')+'|'+n]={name:n,T:loc?T:null}});
def('list_hide','var','stack','リスト[L]を隠す',{L:['m','list']},(T,A)=>{if(!RT)return;const n=String(A.L),loc=!!(T.lists&&Object.prototype.hasOwnProperty.call(T.lists,n));delete RT.lmon[(loc?T.id:'')+'|'+n]});
function addList(name,scope,o){const s=SC();o=o||OBJ();const g=s.glists||(s.glists={});
if(scope=='l'){if(!o){toast('オブジェクトを選んでください');return null}o.lists=o.lists||{};if(name in g||name in o.lists){toast('同じ名前のリストがすでにあります');return null}o.lists[name]=[]}
else{if(name in g||s.objs.some(x=>x.lists&&name in x.lists)){toast('同じ名前のリストがすでにあります');return null}g[name]=[]}touch();return name}
H.newList=async()=>{const r=await askVar('リスト');return r?addList(r.name,r.scope):null};
function renameList(name,local,o){return askText('「'+name+'」の新しい名前',name,'変更').then(n=>{if(!n||n===name)return;const s=SC();if((s.glists&&n in s.glists)||s.objs.some(x=>x.lists&&n in x.lists)){toast('同じ名前のリストがすでにあります');return}stopRun();
const re=m=>{const v={};Object.keys(m).forEach(k=>v[k==name?n:k]=m[k]);return v};if(local)o.lists=re(o.lists);else s.glists=re(s.glists);
(local?[o]:s.objs).forEach(x=>x.sc.forEach(sc=>walk(sc.b,b=>{if(LISTOPS.includes(b.op)&&b.in.L===name)b.in.L=n})));touch();renderPal();renderWS()})}
async function deleteList(name,local,o){if(!await uiConfirm('リスト「'+name+'」を削除しますか?\n(このリストを使うブロックは無効になります)'))return;stopRun();const s=SC();if(local)delete o.lists[name];else delete s.glists[name];
const isL=b=>b&&LISTOPS.includes(b.op)&&b.in&&b.in.L===name,fix=b=>{if(b.in)for(const k in b.in){const v=b.in[k];if(v&&typeof v=='object'){if(isL(v))b.in[k]=0;else fix(v)}}},rm=arr=>{for(let i=arr.length-1;i>=0;i--){const b=arr[i];if(isL(b)&&BK[b.op].kind=='stack'){arr.splice(i,1);continue}fix(b);if(b.c)for(const k in b.c)rm(b.c[k])}};
(local?[o]:s.objs).forEach(x=>{x.sc.forEach(sc=>{rm(sc.b);if(isL(sc.b[0]))sc.b.length=0});x.sc=x.sc.filter(z=>z.b.length)});touch();renderPal();renderWS()}
{const _pv=PALX.var;PALX.var=(p,o)=>{_pv(p,o);const b=el('button','sc-b','リストを作る');b.type='button';b.style.marginTop='10px';b.onclick=async()=>{const n=await H.newList();if(n){renderPal();renderWS()}};p.append(b);
const g=SC().glists||{},L=Object.keys(g).map(n=>[n,false]).concat(o&&o.lists?Object.keys(o.lists).map(n=>[n,true]):[]);
if(!L.length){const e=el('div',null,'リストがありません');e.style.cssText='font-size:12px;opacity:.7;margin:6px 0';p.append(e)}
L.forEach(([n,loc])=>{const row=el('div','vrow'),e=renderScript({b:[mkBlock('list_get',{L:n})]},true);e.title=loc?'このオブジェクトのみのリスト':'すべてのオブジェクトで共有するリスト';const m=el('button','sc-b','⋯');m.type='button';m.title='名前の変更・削除';m.style.minWidth='34px';
m.onclick=ev=>{const r=m.getBoundingClientRect();menuAt(r.left,r.bottom,[['名前を変更',()=>renameList(n,loc,o)],['削除',()=>deleteList(n,loc,o),'danger']])};row.append(e,m);p.append(row)})}}
function drawLists(x){if(!RT||!RT.lmon)return;let y=5;for(const k in RT.lmon){const m=RT.lmon[k],a=m.T?(m.T.lists||{})[m.name]:RT.gl[m.name];if(!a)continue;const lab=(m.T?m.T.name+': ':'')+m.name,n=Math.min(a.length,8),w=140,h=22+n*16+(a.length>n?14:0)+18,X=480-w-5;
x.save();x.font='11px system-ui,sans-serif';x.textBaseline='middle';x.fillStyle='#e6f0ff';x.strokeStyle='#c9d0d9';x.lineWidth=1;x.beginPath();x.roundRect?x.roundRect(X,y,w,h,4):x.rect(X,y,w,h);x.fill();x.stroke();
x.fillStyle='#575e75';x.textAlign='center';x.font='bold 11px system-ui,sans-serif';x.fillText(lab,X+w/2,y+11,w-8);x.font='11px system-ui,sans-serif';
for(let i=0;i<n;i++){const yy=y+22+i*16;x.fillStyle='#ff661a';x.fillRect(X+4,yy,w-8,14);x.fillStyle='#fff';x.textAlign='left';x.fillText((i+1)+'  '+toStr(a[i]),X+8,yy+7,w-16)}
if(a.length>n){x.fillStyle='#575e75';x.textAlign='center';x.fillText('…',X+w/2,y+22+n*16+7)}x.fillStyle='#575e75';x.textAlign='center';x.fillText('長さ '+a.length,X+w/2,y+h-9);x.restore();y+=h+4}}
H.drawBub=function(x){drawBubbles(x);drawLists(x)};

/* ============================================================
   第6部: 定義ブロック(自作ブロック) と 拡張機能「ペン」
   ============================================================ */
CATS.push({id:'proc',n:'定義ブロック',c:'#ff6680'},{id:'pen',n:'ペン',c:'#0fbd8c'});PAL.proc=[];PAL.pen=[];
const WY=th=>{if(!th.warp)return true;const n=now();if(n-(th.wt||0)>500){th.wt=n;return true}return false};
/* ----- 定義ブロック: 定義はシーン内で共有(scene.defs)。呼び出し=pc:ID / 定義ハット=pd:ID ----- */
def('proc_arg','proc','r','',{D:['s',''],P:['s','']},(T,A,th,b)=>{const m=th.as&&th.as[th.as.length-1];return m&&b.in.P in m?m[b.in.P]:0},{pal:false});
def('proc_argb','proc','b','',{D:['s',''],P:['s','']},(T,A,th,b)=>{const m=th.as&&th.as[th.as.length-1];return m&&b.in.P in m?toBool(m[b.in.P]):false},{pal:false});
const PSC=new WeakMap();/* T.sc(クローンと共有) → {定義ID: 定義スクリプト} */
function procScript(T,id){let m=PSC.get(T.sc);if(!m)PSC.set(T.sc,m=new Map());let s=m.get(id);if(s)return s;const h='pd:'+id,f=z=>z.b[0]&&z.b[0].op===h;s=T.sc.find(f);if(!s&&RT)for(const o of RT.list){s=o.sc.find(f);if(s)break}if(s)m.set(id,s);return s||null}
function procBody(T,id){const s=procScript(T,id);return s?s.b.slice(1):null}
function regProc(d){const inp={};let tpl='';d.items.forEach(it=>{if(it.k=='l')tpl+=String(it.t).replace(/[\[\]]/g,'')+' ';else{tpl+='['+it.id+'] ';inp[it.id]=it.k=='b'?['b']:['s','']}});tpl=tpl.trim()||'(名前なし)';
def('pc:'+d.id,'proc','stack',tpl,inp,function*(T,A,th,b){const dd=BK[b.op].pdef;if(!dd)return;const ps=procScript(T,dd.id);if(!ps||(th.depth||0)>=300)return;const m={};dd.items.forEach(it=>{if(it.k!='l')m[it.id]=A[it.id]});
th.depth=(th.depth||0)+1;(th.as||(th.as=[])).push(m);if(dd.warp){th.warp=(th.warp||0)+1;th.wt=now()}try{yield* scriptGen(ps,T,th)}finally{th.as.pop();th.depth--;if(dd.warp)th.warp--}},{pal:false}).pdef=d;
def('pd:'+d.id,'proc','hat','定義',{},null,{pal:false}).pdef=d}
const regAll=()=>(SC().defs||[]).forEach(regProc);
function vDefs(a){const out=[];if(!Array.isArray(a))return out;for(const d of a.slice(0,200)){if(!d||typeof d.id!='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(d.id)||!Array.isArray(d.items))continue;const items=[];let np=Math.max(0,Math.floor(nz(d.np)));
for(const it of d.items.slice(0,30)){if(!it)continue;if(it.k=='l')items.push({k:'l',t:String(it.t||'').slice(0,40)});else if(it.k=='s'||it.k=='b'){const id=/^P[0-9]{1,4}$/.test(it.id)?it.id:'P'+(++np);items.push({k:it.k,id,n:String(it.n||'x').slice(0,40)})}}
if(!items.length)continue;const x={id:d.id,items,warp:!!d.warp,np};out.push(x);regProc(x)}return out}
H.regProc=regProc;
function askDef(d0){return new Promise(res=>{const ov=el('div','sc-ov'),dl=el('div','sc-dl');dl.style.cssText='max-width:460px;width:92vw';
const items=d0?d0.items.map(i=>({...i})):[{k:'l',t:'ブロック'}];let warp=d0?!!d0.warp:false,done=0;const fin=v=>{if(done)return;done=1;ov.remove();res(v)};
const list=el('div');list.style.cssText='display:flex;flex-direction:column;gap:6px;margin:8px 0;max-height:44vh;overflow:auto';
const draw=()=>{list.innerHTML='';items.forEach((it,i)=>{const r=el('div');r.style.cssText='display:flex;gap:4px;align-items:center';const tg=el('span');tg.textContent=it.k=='l'?'ラベル':it.k=='b'?'条件':'入力';tg.style.cssText='font-size:11px;min-width:42px;opacity:.7';
const ip=el('input');ip.type='text';ip.maxLength=40;ip.value=it.k=='l'?it.t:it.n;ip.placeholder=it.k=='l'?'ブロックに表示する文字':'引数の名前';ip.style.flex='1';ip.oninput=()=>{if(it.k=='l')it.t=ip.value;else it.n=ip.value};ip.onkeydown=e=>e.stopPropagation();
const mk=(tx,f,ti)=>{const b=el('button','sc-b');b.type='button';b.textContent=tx;b.title=ti;b.style.minWidth='34px';b.onclick=f;return b};
r.append(tg,ip,mk('↑',()=>{if(i){[items[i-1],items[i]]=[items[i],items[i-1]];draw()}},'上へ'),mk('↓',()=>{if(i<items.length-1){[items[i+1],items[i]]=[items[i],items[i+1]];draw()}},'下へ'),mk('×',()=>{items.splice(i,1);draw()},'削除'));list.append(r)})};draw();
const add=el('div');add.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
[['＋ラベル',{k:'l',t:'ラベル'}],['＋入力(数値・文字)',{k:'s',n:'x'}],['＋条件',{k:'b',n:'条件'}]].forEach(([tx,o])=>{const b=el('button','sc-b');b.type='button';b.textContent=tx;b.onclick=()=>{if(items.length<30){items.push({...o});draw()}};add.append(b)});
const wl=el('label','rd'),wc=el('input');wc.type='checkbox';wc.checked=warp;wc.onchange=()=>{warp=wc.checked};wl.append(wc,document.createTextNode('画面を更新せずに実行する'));
const acts=el('div','acts'),b0=el('button','sc-b'),b1=el('button','sc-b pri');b0.type=b1.type='button';b0.textContent='キャンセル';b1.textContent=d0?'変更':'作る';b0.onclick=()=>fin(null);
b1.onclick=()=>{const it=items.map(i=>i.k=='l'?{k:'l',t:i.t.trim()}:{...i,n:(i.n||'').trim()||'x'}).filter(i=>i.k!='l'||i.t);if(!it.length){toast('ラベルか入力を1つ以上入れてください');return}let np=d0?d0.np||0:0;it.forEach(i=>{if(i.k!='l'&&!i.id)i.id='P'+(++np)});fin({items:it,warp,np})};acts.append(b0,b1);
const h=el('h3');h.textContent=d0?'ブロックを編集':'ブロックを作る';dl.append(h,list,add,wl,acts);ov.onpointerdown=e=>{if(e.target===ov)fin(null)};ov.append(dl);document.body.append(ov)})}
function purgeDef(id){const isC=b=>b&&(b.op=='pc:'+id||b.op=='pd:'+id),isA=v=>v&&(v.op=='proc_arg'||v.op=='proc_argb')&&v.in&&v.in.D===id;
const fix=b=>{if(b.in)for(const k in b.in){const v=b.in[k];if(v&&typeof v=='object'){if(isA(v)||isC(v))b.in[k]=0;else fix(v)}}},rm=arr=>{for(let i=arr.length-1;i>=0;i--){const b=arr[i];if(isC(b)||isA(b)){arr.splice(i,1);continue}fix(b);if(b.c)for(const k in b.c)rm(b.c[k])}};
SC().objs.forEach(x=>{x.sc=x.sc.filter(z=>!(z.b[0]&&z.b[0].op=='pd:'+id));x.sc.forEach(z=>rm(z.b));x.sc=x.sc.filter(z=>z.b.length)});delete BK['pc:'+id];delete BK['pd:'+id]}
H.purgeDef=purgeDef;
PALX.proc=(p,o)=>{regAll();const b=el('button','sc-b','ブロックを作る');b.type='button';b.onclick=async()=>{const r=await askDef();if(!r)return;const ob=OBJ();if(!ob){toast('オブジェクトを選んでください');return}const s=SC(),d={id:uid(),items:r.items,warp:r.warp,np:r.np};(s.defs||(s.defs=[])).push(d);regProc(d);
ob.sc.push({id:uid(),x:20,y:ob.sc.reduce((m,z)=>Math.max(m,z.y+120),20),b:[mkBlock('pd:'+d.id)]});touch();renderPal();renderWS()};p.append(b);
const L=SC().defs||[];if(!L.length){const e=el('div',null,'まだ定義ブロックがありません');e.style.cssText='font-size:12px;opacity:.7;margin:6px 0';p.append(e)}
L.forEach(d=>{const row=el('div','vrow'),e=renderScript({b:[mkBlock('pc:'+d.id)]},true),m=el('button','sc-b','⋯');m.type='button';m.title='編集・削除';m.style.minWidth='34px';
m.onclick=()=>{const r=m.getBoundingClientRect();menuAt(r.left,r.bottom,[['編集',async()=>{const x=await askDef(d);if(!x)return;d.items=x.items;d.warp=x.warp;d.np=x.np;regProc(d);touch();renderPal();renderWS()}],['削除',async()=>{if(!await uiConfirm('ブロック「'+(d.items.find(i=>i.k=='l')||{t:'?'}).t+'」を削除しますか?\n(定義と、これを使うブロックも消えます)'))return;stopRun();purgeDef(d.id);SC().defs=SC().defs.filter(z=>z!==d);touch();renderPal();renderWS()},'danger']])};row.append(e,m);p.append(row)});
const h=el('div',null,'※「ブロックを作る」を押すと、定義ブロックが作業エリアに置かれます。定義の下に、このブロックの中身を組み立ててください。定義ブロック内の入力(丸い部品)はドラッグしてコピーして使えます');h.style.cssText='font-size:11px;opacity:.65;margin:6px 0 8px';p.append(h)};
{const _bt=buildRT;buildRT=function(){regAll();_bt()};const _rw=renderWS;renderWS=function(){regAll();_rw()};H.renderWS=renderWS;SCN.renderWS=renderWS}
/* ----- 拡張機能: ペン(専用のレイヤーに描く。ステージの背景とオブジェクトの間に表示) ----- */
function hsv2rgb(h,s,v){const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),u=v*(1-(1-f)*s);return[[v,u,p],[q,v,p],[p,v,u],[p,q,v],[u,p,v],[v,p,q]][i%6].map(c=>Math.round(c*255))}
function rgb2hsv(r,g,b){r/=255;g/=255;b/=255;const M=Math.max(r,g,b),m=Math.min(r,g,b),d=M-m;let h=0;if(d){h=M==r?((g-b)/d+6)%6:M==g?(b-r)/d+2:(r-g)/d+4;h/=6}return[h,M?d/M:0,M]}
const PN=T=>T.pen||(T.pen={down:false,h:200/3,s:100,b:100,a:0,size:1}),penCol=P=>{const[r,g,b]=hsv2rgb(((P.h%100)+100)%100/100,clamp(P.s,0,100)/100,clamp(P.b,0,100)/100);return'rgba('+r+','+g+','+b+','+(1-clamp(P.a,0,100)/100)+')'};
const PS=3;/* ペン専用レイヤーの解像度(ステージの3倍) */
function penCtx(){if(!RT.pc){RT.pc=document.createElement('canvas');RT.pc.width=480*PS;RT.pc.height=360*PS;RT.px=RT.pc.getContext('2d');RT.px.setTransform(PS,0,0,PS,0,0);RT.px.lineCap='round';RT.px.lineJoin='round'}return RT.px}
function penDot(T){const P=PN(T),x=penCtx();x.fillStyle=penCol(P);x.beginPath();x.arc(240+T.x,180-T.y,P.size/2,0,7);x.fill()}
function penTrack(T){if(!RT||!T.pen)return;if(T._px==null||T._py==null){T._px=T.x;T._py=T.y;return}if(T._px===T.x&&T._py===T.y)return;const P=T.pen,x=penCtx();x.strokeStyle=penCol(P);x.lineWidth=P.size;x.beginPath();x.moveTo(240+T._px,180-T._py);x.lineTo(240+T.x,180-T.y);x.stroke();T._px=T.x;T._py=T.y}
/* どの方法で動いても(ブロック・ドラッグ・拡張機能)、1フレームの終わりに取りこぼしを描く */
{const _tp=tickAll;tickAll=function(){_tp();if(RT)for(const T of RT.list)if(T.pen&&T.pen.down)penTrack(T)}}
/* 色の読み取り: #rgb #rrggbb #rrggbbaa / 数値(0xRRGGBB) / rgb()・色名など → [r,g,b,a(0〜1)] */
const _pcx=document.createElement('canvas').getContext('2d');
function penRgb(v){if(typeof v=='number'||typeof v=='boolean'){const n=Math.floor(toNum(v))>>>0;return[n>>16&255,n>>8&255,n&255,1]}
const s=String(v==null?'':v).trim();if(!s)return null;if(/^-?\d+(\.\d+)?$/.test(s)){const n=Math.floor(Number(s))>>>0;return[n>>16&255,n>>8&255,n&255,1]}
const hx=s[0]=='#'?s.slice(1):(/^[0-9a-f]{6}$/i.test(s)?s:'');
if(hx&&/^[0-9a-f]+$/i.test(hx)&&[3,4,6,8].includes(hx.length)){const h=hx.length<=4?[...hx].map(c=>c+c).join(''):hx,n=parseInt(h.slice(0,6),16);return[n>>16&255,n>>8&255,n&255,h.length==8?parseInt(h.slice(6),16)/255:1]}
_pcx.fillStyle='#010203';_pcx.fillStyle=s;const f=String(_pcx.fillStyle);if(f==='#010203')return null;let m=/^#([0-9a-f]{6})$/i.exec(f);if(m){const n=parseInt(m[1],16);return[n>>16&255,n>>8&255,n&255,1]}
m=/^rgba?\(([^)]+)\)$/.exec(f);if(m){const q=m[1].split(',').map(Number);return[q[0],q[1],q[2],q.length>3?q[3]:1]}return null}
const PK={h:'h',color:'h','色':'h',s:'s',saturation:'s','鮮やかさ':'s',b:'b',brightness:'b','明るさ':'b',a:'a',transparency:'a','透明度':'a'},pkey=v=>PK[String(v).trim().toLowerCase()];
H.drawPen=x=>{if(RT&&RT.pc)x.drawImage(RT.pc,0,0,480,360)};
menuDefs.penp=()=>[['h','色'],['s','鮮やかさ'],['b','明るさ'],['a','透明度']];
def('pen_clear','pen','stack','すべて消す',{},()=>{if(RT&&RT.pc)penCtx().clearRect(0,0,480,360)});
def('pen_stamp','pen','stack','スタンプ',{},T=>{if(RT&&T.vis)drawObj(penCtx(),T,PS)});
def('pen_down','pen','stack','ペンを下ろす',{},T=>{const P=PN(T);if(!P.down){P.down=true;T._px=T.x;T._py=T.y;penDot(T)}});
def('pen_up','pen','stack','ペンを上げる',{},T=>{PN(T).down=false});
def('pen_setcolor','pen','stack','ペンの色を[C]にする',{C:['c','#0000ff']},(T,A)=>{const c=penRgb(A.C);if(!c)return;const[h,s,v]=rgb2hsv(c[0],c[1],c[2]);Object.assign(PN(T),{h:h*100,s:s*100,b:v*100,a:(1-clamp(c[3],0,1))*100})});
const penFix=P=>{P.h=((P.h%100)+100)%100;P.s=clamp(P.s,0,100);P.b=clamp(P.b,0,100);P.a=clamp(P.a,0,100)};
def('pen_change','pen','stack','ペンの[P]を[V]ずつ変える',{P:['m','penp','h'],V:['n',10]},(T,A)=>{const P=PN(T),k=pkey(A.P);if(k){P[k]+=toNum(A.V);penFix(P)}});
def('pen_set','pen','stack','ペンの[P]を[V]にする',{P:['m','penp','h'],V:['n',50]},(T,A)=>{const P=PN(T),k=pkey(A.P);if(k){P[k]=toNum(A.V);penFix(P)}});
def('pen_changesize','pen','stack','ペンの太さを[V]ずつ変える',{V:['n',1]},(T,A)=>{const P=PN(T);P.size=clamp(P.size+toNum(A.V),1,1200)});
def('pen_setsize','pen','stack','ペンの太さを[V]にする',{V:['n',1]},(T,A)=>{PN(T).size=clamp(toNum(A.V),1,1200)});
/* ============================================================
   第7部: カスタム拡張機能(TurboWarp形式のJavaScript拡張機能を読み込む仕組み)
   - 拡張機能 = Scratch.extensions.register(new クラス()) で登録する JS(.js)。getInfo() の blocks/menus をブロックに変換する
   - 対応: COMMAND / REPORTER / BOOLEAN / HAT(判定を毎フレーム実行) / EVENT(startHatsで起動) / LOOP / CONDITIONAL(startBranch) / BUTTON / LABEL / '---'
   - 非同期(Promiseを返すブロック)・util.stackFrame・util.yield()・メニュー(配列/メソッド名)に対応。サンドボックスなし(このページ内で実行)
   - 保存: シーンのJSON・プロジェクト・自動保存に拡張機能のコードごと含める(読み込み時は実行してよいか確認する)
   ============================================================ */
const EX={src:[],quiet:0};
const exFind=id=>{for(const s of EX.src)for(const e of s.exts)if(e.id===id)return e;return null};
let _exT=0;const exErr=e=>{console.error('[拡張機能]',e);const n=Date.now();if(n-_exT>1500){_exT=n;toast('拡張機能のエラー: '+((e&&e.message)||e))}};
const exVal=(d,v)=>{if(d.kind=='b')return toBool(v);if(v==null)return'';return typeof v=='number'||typeof v=='string'||typeof v=='boolean'?v:String(v)};
/* ---------- Scratch.Cast ---------- */
const exRgb=v=>{if(typeof v=='string'){const s=v.trim();let m=/^#?([0-9a-f]{6})$/i.exec(s);if(m){const n=parseInt(m[1],16);return[n>>16&255,n>>8&255,n&255]}m=/^#?([0-9a-f]{3})$/i.exec(s);if(m)return[...m[1]].map(c=>parseInt(c+c,16))}const n=Math.floor(toNum(v))>>>0;return[n>>16&255,n>>8&255,n&255]};
const CAST={toNumber:toNum,toString:v=>typeof v=='string'?v:toStr(v),toBoolean:toBool,compare:cmp,isWhiteSpace:v=>v==null||(typeof v=='string'&&v.trim().length==0),
isInt:v=>typeof v=='number'?Number.isInteger(v):typeof v=='boolean'?true:typeof v=='string'?Number.isInteger(parseFloat(v)):false,
toRgbColorList:exRgb,toRgbColorObject:v=>{const[r,g,b]=exRgb(v);return{r,g,b,a:255}},LIST_INVALID:'INVALID',LIST_ALL:'ALL',
toListIndex:(i,len,all)=>{if(typeof i!=='number'){if(i==='all')return all?'ALL':'INVALID';if(i==='last')return len>0?len:'INVALID';if(i==='random'||i==='any')return len>0?1+Math.floor(Math.random()*len):'INVALID'}i=Math.floor(toNum(i));return i<1||i>len?'INVALID':i}};
/* ---------- Scratch.vm.runtime などの互換(一部だけ) ---------- */
const EXW=new WeakMap();
function exTarget(T,src){const cache=src?src.targets:EXW;let w=cache.get(T);if(w)return w;
w=src?new src.canvas.RenderedTarget(T):{};Object.defineProperties(w,Object.getOwnPropertyDescriptors({get x(){return T.x},set x(v){T.x=cl(toNum(v))},get y(){return T.y},set y(v){T.y=cl(toNum(v))},get direction(){return T.dir},set direction(v){T.dir=normDir(toNum(v))},get size(){return T.size},set size(v){T.size=clamp(toNum(v),0,1e4)},get visible(){return!!T.vis},set visible(v){T.vis=!!v},
get currentCostume(){return costList(T).indexOf(T.c)},id:T.id,isStage:!!T.stage,sprite:{name:T.name},get isOriginal(){return!T.isClone},variables:{},getName:()=>T.name,lookupVariableByNameAndType:()=>null,
setXY(x,y){T.x=cl(toNum(x));T.y=cl(toNum(y))},setDirection(d){T.dir=normDir(toNum(d))},setSize(s){T.size=clamp(toNum(s),0,1e4)},setVisible(v){T.vis=!!v},
setCostume(i){const L=costList(T);if(L.length)T.c=L[((Math.round(toNum(i))%L.length)+L.length)%L.length];EXR.clearCostume(T)}}));cache.set(T,w);EXR.drawableFor(T);return w}
const exStage={isStage:true,variables:{},sprite:{name:'Stage'},getName:()=>'Stage',lookupVariableByNameAndType:()=>null};
function exRuntime(src){const rt={get targets(){return RT?RT.list.map(T=>exTarget(T,src)):[]},get currentMSecs(){return Date.now()},stageWidth:480,stageHeight:360,renderer:src.canvas.renderer,
ioDevices:{mouse:{getScratchX:()=>MS.x,getScratchY:()=>MS.y,getIsDown:()=>MS.down},keyboard:{getKeyIsDown:k=>keyDown(k)}},
startHats:(op,f)=>exStartHats(op,f),requestRedraw:()=>exRedraw(),getTargetForStage:()=>{const T=RT&&RT.list.find(t=>t.stage);return T?exTarget(T,src):exStage},
on(n,f){(src.ev[n]||(src.ev[n]=[])).push(f);return rt},off(n,f){src.ev[n]=(src.ev[n]||[]).filter(x=>x!==f);return rt},emit:(n,...a)=>exEmit(n,...a)};rt.removeListener=rt.off;return rt}
const exEmit=(n,...a)=>{for(const s of EX.src)(s.ev[n]||[]).slice().forEach(f=>{try{f(...a)}catch(e){exErr(e)}})};
const exUrlOk=u=>/^(https?:|data:|blob:)/i.test(String(u));
function exAPI(src){const rt=src.rt,
BT={COMMAND:'command',REPORTER:'reporter',BOOLEAN:'Boolean',HAT:'hat',EVENT:'event',LOOP:'loop',CONDITIONAL:'conditional',BUTTON:'button',LABEL:'label',XML:'xml'},
AT={ANGLE:'angle',BOOLEAN:'Boolean',COLOR:'color',NUMBER:'number',STRING:'string',MATRIX:'matrix',NOTE:'note',IMAGE:'image',COSTUME:'costume',SOUND:'sound'};
return{BlockType:BT,ArgumentType:AT,TargetType:{SPRITE:'sprite',STAGE:'stage'},Cast:CAST,
extensions:{register:inst=>exRegister(src,inst),unsandboxed:true,isPenguinMod:false},
vm:{runtime:rt,renderer:src.canvas.renderer,exports:{RenderedTarget:src.canvas.RenderedTarget},extensionManager:{refreshBlocks(){EX.src.forEach(s=>s.exts.forEach(e=>{try{exDefine(e)}catch(x){exErr(x)}}));exAfter()}}},runtime:rt,
translate:Object.assign((s,p)=>{let x=typeof s=='string'?s:(s&&s.default)||'';if(p)for(const k in p)x=x.split('{'+k+'}').join(String(p[k]));return x},{setup(){},language:'ja'}),
canFetch:u=>Promise.resolve(exUrlOk(u)),fetch:async(u,o)=>{if(!exUrlOk(u))throw Error('許可されていないURLです: '+u);return fetch(u,o)},
canOpenWindow:u=>Promise.resolve(/^https?:/i.test(String(u))),openWindow:async(u,f)=>{if(!/^https?:/i.test(String(u)))throw Error('http(s)のURLだけ開けます');if(!await uiConfirm('拡張機能が新しいタブで次のページを開こうとしています:\n'+u+'\n\n開きますか?','開く'))throw Error('ユーザーが拒否しました');return window.open(u,'_blank','noopener,noreferrer')},
canRedirect:()=>Promise.resolve(false),redirect:()=>Promise.reject(Error('このページの移動は許可されていません'))}}
/* ---------- 拡張機能の登録: getInfo() → ブロック定義 ---------- */
function exRegister(src,inst){if(!inst||typeof inst.getInfo!='function')throw Error('Scratch.extensions.register() には getInfo() を持つオブジェクトを渡してください');
const ext={src,inst,id:'',name:'',color:'#0fbd8c',cat:'',ops:[],items:[],menus:[],warn:[]};src.exts.push(ext);
try{exDefine(ext)}catch(e){src.exts.splice(src.exts.indexOf(ext),1);throw e}
exAfter();if(src.exts.length)src.name=src.exts.map(e=>e.name).join(' / ');return ext}
function exUndef(ext){ext.ops.forEach(o=>delete BK[o]);ext.ops=[];ext.menus.forEach(k=>delete menuDefs[k]);ext.menus=[];ext.items=[]}
function exDefine(ext){exUndef(ext);const info=ext.inst.getInfo();if(!info||typeof info!='object')throw Error('getInfo() がオブジェクトを返しませんでした');
const id=String(info.id==null?'':info.id);if(!/^[A-Za-z0-9_-]{1,40}$/.test(id))throw Error('拡張機能のID「'+id+'」は使えません(英数字・-・_ で40文字まで)');
const dup=exFind(id);if(dup&&dup!==ext)throw Error('ID「'+id+'」は、読み込み済みの拡張機能「'+dup.name+'」で使われています。先に削除してください');
ext.id=id;ext.name=String(info.name||id).slice(0,40);ext.color=/^#[0-9a-f]{6}$/i.test(String(info.color1))?info.color1:'#0FBD8C';ext.cat='x_'+id;const warn=ext.warn=[];
const menus=info.menus&&typeof info.menus=='object'?info.menus:{},mk=n=>'x:'+id+':'+n;
for(const n of Object.keys(menus)){const m=menus[n],items=Array.isArray(m)?m:(m&&m.items),key=mk(n);ext.menus.push(key);
menuDefs[key]=()=>{let a=items;try{if(typeof a=='string'){const f=ext.inst[a];a=typeof f=='function'?f.call(ext.inst):[]}}catch(e){exErr(e);a=[]}if(!Array.isArray(a))a=[];
const out=a.slice(0,500).map(x=>x&&typeof x=='object'?[String(x.value),String(x.text==null?x.value:x.text)]:[String(x),String(x)]);return out.length?out:[['','(なし)']]}}
const KINDS={command:'stack',reporter:'r',Boolean:'b',hat:'hat',event:'hat',loop:'c',conditional:'c'};
for(const bi of(Array.isArray(info.blocks)?info.blocks:[])){
if(bi==='---'){ext.items.push({t:'sep'});continue}if(!bi||typeof bi!='object')continue;const bt=bi.blockType||'command';
if(bt=='label'){ext.items.push({t:'label',text:String(bi.text||'')});continue}
if(bt=='button'){ext.items.push({t:'btn',text:String(bi.text||'ボタン'),func:String(bi.func||bi.opcode||'')});continue}
if(!(bt in KINDS)){warn.push('未対応のブロックタイプ「'+bt+'」を読み飛ばしました');continue}
const opc=String(bi.opcode==null?'':bi.opcode);if(!/^[A-Za-z0-9_]+$/.test(opc)){warn.push('opcode「'+opc+'」は使えないため読み飛ばしました');continue}
let kind=KINDS[bt];if(bt=='command'&&bi.isTerminal)kind='cap';const bc=Math.floor(nz(bi.branchCount,1));if(bt=='conditional'&&bc>=2)kind='ce';if(bc>2)warn.push('「'+opc+'」の分岐は2つまで対応です');
const texts=Array.isArray(bi.text)?bi.text.map(String):[String(bi.text==null?opc:bi.text)],args=bi.arguments&&typeof bi.arguments=='object'?bi.arguments:{},inp={},keys=[],idx={};
for(const n of Object.keys(args)){const a=args[n]||{},ty=a.type||'string',dv=a.defaultValue;if(ty=='image'){idx[n]=null;continue}const k='A'+keys.length;idx[n]=k;let sp;
if(a.menu!=null&&menus[a.menu]!==undefined)sp=['m',mk(a.menu),dv!==undefined?String(dv):undefined];else if(ty=='costume')sp=['m','costume'];
else if(ty=='number'||ty=='angle'||ty=='note')sp=['n',dv!==undefined?dv:(ty=='note'?60:'')];else if(ty=='Boolean')sp=['b'];
else if(ty=='color')sp=['c',/^#[0-9a-f]{6}$/i.test(String(dv))?String(dv):'#ff0000'];
else{sp=['s',dv!==undefined?dv:''];if(ty=='sound'||ty=='matrix')warn.push('引数の型「'+ty+'」は文字入力として扱います')}inp[k]=sp;keys.push([k,n,ty])}
const conv=s=>s.replace(/\[([^\[\]]+)\]/g,(m,n)=>n in idx?(idx[n]?'['+idx[n]+']':''):'［'+n+'］'),o2={pal:false};if(kind=='ce'){const e=texts[1]!=null?String(texts[1]).replace(/\[[^\]]*\]/g,'').trim():'';if(e)o2.els=e}
let d;const fn=kind=='r'||kind=='b'?(T,A,th,b)=>exRep(d,T,A,th,b):kind=='hat'?null:()=>{};
d=def(id+'.'+opc,ext.cat,kind,conv(texts[0]).trim()||opc,inp,fn,o2);
d.ex={ext,opc,full:id+'_'+opc,func:typeof bi.func=='string'&&bi.func?bi.func:opc,keys,edge:bi.isEdgeActivated!==false,ev:bt=='event'};ext.ops.push(id+'.'+opc);ext.items.push({t:'b',op:id+'.'+opc,hide:!!bi.hideFromPalette})}}
/* ---------- 実行: 引数→メソッド呼び出し(util互換) ---------- */
function exCall(d,A,util){const X=d.ex,a={};for(const[k,n,ty]of X.keys){let v=A[k];if(ty=='Boolean')v=toBool(v);a[n]=v}const f=X.ext.inst[X.func];if(typeof f!='function')throw Error('メソッド「'+X.func+'」が見つかりません');return f.call(X.ext.inst,a,util)}
function exUtil(T,th,b,src){return{stackFrame:{},target:exTarget(T,src),thread:th,runtime:src.rt,_y:false,_br:0,_lp:false,yield(){this._y=true},startBranch(n,lp){this._br=Math.floor(n)==2?2:1;this._lp=!!lp},isStuck:()=>false,stopThisScript(){if(th)th.stop=true},startHats:(op,f)=>exStartHats(op,f),ioQuery(){},getParam(){return undefined}}}
function exRep(d,T,A,th,b){const pc=th&&th.pc;if(pc&&pc.has(b))return pc.get(b);let r;
try{r=exCall(d,A,exUtil(T,th||{},b,d.ex.ext.src))}catch(e){exErr(e);return d.kind=='b'?false:''}
if(r&&typeof r.then=='function'){if(!th||th.poll||!th.gen){r.then(()=>{},()=>{});return d.kind=='b'?false:''}th.pw={b,p:r};throw PEND}return exVal(d,r)}
/* 命令・C字型ブロック: Promiseは完了まで待つ / util.yield() は次のフレームに同じブロックをもう一度実行 / util.startBranch(n,ループか) で中身を実行 */
function* exRun(b,d,T,th,A){const util=exUtil(T,th,b,d.ex.ext.src);
for(;;){util._y=false;util._br=0;util._lp=false;let r;try{r=exCall(d,A,util)}catch(e){exErr(e);return}
if(r&&typeof r.then=='function'){let st=0,er;r.then(()=>{st=1},e=>{st=2;er=e});while(!st){yield;if(th.stop||T.dead)return}if(st==2){exErr(er);return}}
if(T.pen&&T.pen.down)penTrack(T);
if(util._y){yield;if(th.stop||T.dead)return;continue}
if(util._br){yield* runList(sub(b,util._br==2?'SUB2':'SUB'),T,th);if(th.stop||T.dead)return;if(util._lp){yield;if(th.stop||T.dead)return;continue}}
return}}
/* HAT(判定の関数)は毎フレーム実行。EVENT は util.startHats / runtime.startHats で起動 */
function exStartHats(op,f){if(!RT)return[];op=String(op);const out=[];for(const T of RT.list.slice())for(const s of T.hats.xe||[]){const h=s.b[0],d=BK[h.op];if(!d||!d.ex||(d.ex.full!==op&&d.ex.opc!==op))continue;let ok=true;
if(f)for(const k in f){const kk=d.ex.keys.find(z=>z[1]==k);if(kk&&String(h.in[kk[0]]).toLowerCase()!==String(f[k]).toLowerCase())ok=false}if(ok)out.push(startScript(T,s))}return out}
function exPoll(){for(const T of RT.list.slice()){if(T.dead)continue;const on=T.xon||(T.xon={});for(const s of T.hats.ex||[]){const h=s.b[0],d=BK[h.op];if(!d||!d.ex)continue;let v=false;
try{const th={poll:1,pc:null},A={};for(const k in d.inp)A[k]=ev(h.in?h.in[k]:undefined,T,th);const r=exCall(d,A,exUtil(T,th,h,d.ex.ext.src));v=!(r&&typeof r.then=='function')&&toBool(r)}catch(e){exErr(e)}
if(d.ex.edge){if(v&&!on[s.id])startScript(T,s)}else if(v){const t=RT.tmap.get(T.id+'|'+s.id);if(!t||t.dead)startScript(T,s)}on[s.id]=v}}}
{const _ta=tickAll;tickAll=function(){if(RT&&!RT.halt)exPoll();_ta()}}
{const _fl=flag;flag=function(){_fl();exEmit('PROJECT_START')};const _sa=stopAll;stopAll=function(){_sa();exEmit('PROJECT_STOP_ALL')}}
/* ---------- パレット・カテゴリ・色 ---------- */
const exS=document.createElement('style');exS.id='ex_css';document.head.append(exS);
const EXCSS=`.sb-cats .ex-add{position:sticky;left:0;z-index:2;background:var(--pn2);border-color:var(--bd);gap:4px;padding:0 10px}.sb-cats .ex-add svg{width:18px;height:18px}
.ex-dl{width:min(640px,calc(100vw - 14px))}.ex-dl .ex-body{overflow:auto;display:flex;flex-direction:column;gap:8px;min-height:0}
.ex-dl .ex-note{font-size:12px;line-height:1.5;background:#ff980022;border:1px solid #ff980066;border-radius:8px;padding:6px 8px}
.ex-dl .ex-tabs{display:flex;gap:4px}.ex-dl .ex-tabs .sc-b{flex:1}.ex-dl .ex-tabs .sc-b.on{background:#855cd6;color:#fff;border-color:#855cd6}
.ex-dl textarea{min-height:150px;max-height:34vh;resize:vertical;font:12px/1.45 ui-monospace,Consolas,monospace;border:1px solid #b8c0cc;border-radius:8px;padding:8px;background:#fff;color:#222;tab-size:2;white-space:pre}
.ex-dl .ex-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ex-dl .ex-row input[type=text]{flex:1;min-width:160px}
.ex-dl .ex-list{display:flex;flex-direction:column;gap:6px}.ex-dl .ex-item{display:flex;align-items:center;gap:8px;border:1px solid #b8c0cc88;border-radius:8px;padding:4px 4px 4px 10px}
.ex-dl .ex-item i{width:14px;height:14px;border-radius:50%;flex:none}.ex-dl .ex-item .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ex-dl .ex-item small{opacity:.7;display:block}
.ex-dl h4{margin:4px 0 0;font-size:13px}.ex-dl .ex-msg{font-size:12px;line-height:1.5;white-space:pre-wrap;min-height:1.2em}.ex-dl .ex-msg.err{color:#c92a2a}`;
function exCss(){let s=EXCSS;for(const x of EX.src)for(const e of x.exts){const m=/^#(..)(..)(..)$/.exec(e.color),lum=m?.299*parseInt(m[1],16)+.587*parseInt(m[2],16)+.114*parseInt(m[3],16):0;s+='.cat-'+e.cat+'{--c:'+e.color+(lum>175?';color:#222':'')+'}'}exS.textContent=s}
function exPal(ext){return(p,o)=>{ext.items.forEach(it=>{if(it.t=='sep'){const e=el('div');e.style.height='14px';p.append(e)}else if(it.t=='label'){const e=el('h5');e.textContent=it.text;p.append(e)}
else if(it.t=='btn'){const b=el('button','sc-b');b.type='button';b.textContent=it.text;b.onclick=()=>{try{const f=ext.inst[it.func];if(typeof f=='function')f.call(ext.inst,{},{})}catch(e){exErr(e)}};p.append(b)}
else if(!it.hide&&BK[it.op])p.append(renderScript({b:[mkBlock(it.op,palPre(it.op,o))]},true))})}}
function exAfter(){for(let i=CATS.length-1;i>=0;i--)if(CATS[i].id.startsWith('x_'))CATS.splice(i,1);for(const k of Object.keys(PALX))if(k.startsWith('x_'))delete PALX[k];
for(const s of EX.src)for(const e of s.exts){CATS.push({id:e.cat,n:e.name,c:e.color});PALX[e.cat]=exPal(e)}
EXA=Object.values(BK).some(d=>d.ex&&(d.kind=='r'||d.kind=='b'));exCss();if(!CATS.some(c=>c.id==WS.cat))WS.cat='motion';if(H.refresh&&!EX.quiet)H.refresh()}
{const _rc=renderCats;renderCats=function(){_rc();const c=WS.cats;if(!c)return;const b=el('button','ex-add',ic('sc_ext',18)+'<span>拡張機能</span>');b.type='button';b.title='拡張機能を追加・管理(TurboWarp形式のJavaScript拡張機能)';b.onclick=exDialog;c.prepend(b)}}
/* ---------- 読み込み・削除・保存 ---------- */
function exLoad(code,meta){const src={code,name:String(meta&&meta.name||'拡張機能').slice(0,60),url:meta&&meta.url?String(meta.url).slice(0,500):'',exts:[],ev:{},targets:new WeakMap()};src.canvas=EXR.forSource(src);src.rt=exRuntime(src);EX.src.push(src);
try{new Function('Scratch',code)(exAPI(src))}catch(e){exUnload(src,false);throw e}if(src.exts.length)src.name=src.exts.map(e=>e.name).join(' / ');return src}
function exPurge(ops){const isX=b=>b&&typeof b=='object'&&ops.has(b.op),fix=b=>{if(b.in)for(const k in b.in){const v=b.in[k];if(v&&typeof v=='object'){if(isX(v))b.in[k]=dflIn(b,k);else fix(v)}}},
rm=a=>{for(let i=a.length-1;i>=0;i--){const b=a[i];if(isX(b)){a.splice(i,1);continue}fix(b);if(b.c)for(const k in b.c)rm(b.c[k])}};
S.scenes.forEach(s=>s.objs.forEach(o=>{o.sc=o.sc.filter(z=>!(z.b[0]&&isX(z.b[0])&&BK[z.b[0].op]&&BK[z.b[0].op].kind=='hat'));o.sc.forEach(z=>rm(z.b));o.sc=o.sc.filter(z=>z.b.length)}))}
function exUnload(src,purge){const ops=new Set();src.exts.forEach(e=>e.ops.forEach(o=>ops.add(o)));if(purge)exPurge(ops);EXR.release(src);src.ev={};src.targets=new WeakMap();src.exts.forEach(exUndef);const i=EX.src.indexOf(src);if(i>=0)EX.src.splice(i,1);exAfter()}
const exOk=r=>r&&typeof r=='object'&&typeof r.code=='string'&&r.code.length<=3e6;
H.exPack=()=>EX.src.map(s=>({kind:'custom',name:s.name,code:s.code,url:s.url||undefined,ids:s.exts.map(e=>e.id)}));
H.exRestore=(list,opt)=>{EX.quiet=1;try{return exRestore0(list,opt)}finally{EX.quiet=0}};
function exRestore0(list,opt){EX.src.slice().forEach(s=>exUnload(s,false));const L=Array.isArray(list)?list.filter(exOk).slice(0,20):[];if(!L.length)return'';
if(!(opt&&opt.trust))return'拡張機能('+L.map(r=>String(r.name||'?').slice(0,30)).join('、')+')は実行を許可しなかったため、そのブロックは読み込まれませんでした。';
const bad=[];for(const r of L){try{exLoad(r.code,r)}catch(e){bad.push(String(r.name||'?').slice(0,30)+': '+((e&&e.message)||e))}}return bad.length?'拡張機能を読み込めませんでした: '+bad.join(' / '):''}
H.exAsk=async list=>{const L=Array.isArray(list)?list.filter(exOk).slice(0,20):[];if(!L.length)return true;
return uiConfirm('このデータには拡張機能のプログラム(JavaScript)が含まれています:\n・'+L.map(r=>String(r.name||'?').slice(0,40)+(r.url?'('+String(r.url).slice(0,60)+')':'')).join('\n・')+'\n\n拡張機能のコードはこのページの中で制限なしに実行されます。信頼できるデータだけ許可してください。\n\n実行を許可しますか?(許可しない場合、拡張機能のブロックは読み込まれません)','実行を許可')};
H.exMerge=async list=>{const L=Array.isArray(list)?list.filter(exOk).slice(0,20):[];if(!L.length)return'';if(!await H.exAsk(L))return'拡張機能を許可しなかったため、そのブロックは読み込まれませんでした。';
const out=[];for(const r of L){if(EX.src.some(s=>s.code===r.code))continue;const clash=(r.ids||[]).find(id=>exFind(id));if(clash){out.push('拡張機能ID「'+clash+'」は読み込み済みのため、「'+String(r.name||'?').slice(0,30)+'」は読み込みませんでした');continue}
try{exLoad(r.code,r)}catch(e){out.push(String(r.name||'?').slice(0,30)+': '+((e&&e.message)||e))}}return out.length?'拡張機能: '+out.join(' / '):''};
/* ---------- 画面: 拡張機能ダイアログ ---------- */
const EX_SAMPLE=`// サンプル拡張機能(TurboWarp形式)。このまま「読み込む」で試せます
(function (Scratch) {
  'use strict';
  class SampleExt {
    getInfo() {
      return {
        id: 'sampleext',
        name: 'サンプル',
        color1: '#e64980',
        blocks: [
          { opcode: 'greet', blockType: Scratch.BlockType.REPORTER, text: 'あいさつ[WORD] [NAME]',
            arguments: {
              WORD: { type: Scratch.ArgumentType.STRING, menu: 'words', defaultValue: 'こんにちは' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'ネコ' } } },
          { opcode: 'isEven', blockType: Scratch.BlockType.BOOLEAN, text: '[N]は偶数',
            arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 } } },
          '---',
          { opcode: 'diag', blockType: Scratch.BlockType.COMMAND, text: 'ななめに[N]歩動かす',
            arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 } } },
          { opcode: 'later', blockType: Scratch.BlockType.REPORTER, text: '[SECS]秒待った後の時刻',
            arguments: { SECS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'times', blockType: Scratch.BlockType.LOOP, text: '[N]回くり返す(拡張)',
            arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 3 } } },
          { opcode: 'whenDown', blockType: Scratch.BlockType.HAT, text: 'マウスが押されたとき(拡張)', isEdgeActivated: true }
        ],
        menus: { words: { acceptReporters: true, items: ['こんにちは', 'おはよう', 'こんばんは'] } }
      };
    }
    greet(args) { return args.WORD + ' ' + args.NAME + 'さん'; }
    isEven(args) { return Scratch.Cast.toNumber(args.N) % 2 === 0; }
    diag(args, util) { const n = Scratch.Cast.toNumber(args.N) / Math.SQRT2; util.target.setXY(util.target.x + n, util.target.y + n); }
    later(args) { return new Promise(res => setTimeout(() => res(new Date().toLocaleTimeString('ja-JP')), Scratch.Cast.toNumber(args.SECS) * 1000)); }
    times(args, util) {
      const f = util.stackFrame;
      if (f.i === undefined) f.i = 0;
      if (f.i < Scratch.Cast.toNumber(args.N)) { f.i++; util.startBranch(1, true); }
    }
    whenDown() { return Scratch.vm.runtime.ioDevices.mouse.getIsDown(); }
  }
  Scratch.extensions.register(new SampleExt());
})(Scratch);
`;
function exDialog(){if(document.querySelector('.ex-dl'))return;const ov=el('div','sc-ov'),dl=el('div','sc-dl ex-dl'),body=el('div','ex-body');let busy=0;
const close=()=>ov.remove();ov.addEventListener('keydown',e=>{e.stopPropagation();if(e.key=='Escape'&&!e.isComposing){e.preventDefault();close()}});ov.onpointerdown=e=>{if(e.target===ov)close()};
const h=el('h3');h.textContent='拡張機能';const note=el('div','ex-note');note.textContent='TurboWarpなどで使われているJavaScriptの拡張機能(.js)を読み込んで、新しいブロックを追加できます。拡張機能のコードは、このページの中で制限なしに実行されます(サンドボックスなし)。信頼できるものだけを読み込んでください。';
const tabs=el('div','ex-tabs'),panels={},tb={};const msg=el('div','ex-msg');const say=(t,err)=>{msg.textContent=t;msg.className='ex-msg'+(err?' err':'')};
const show=k=>{for(const x in panels){panels[x].hidden=x!=k;tb[x].classList.toggle('on',x==k)}};
[['file','ファイル'],['text','テキスト'],['url','URL']].forEach(([k,t])=>{const b=el('button','sc-b');b.type='button';b.textContent=t;b.onclick=()=>show(k);tb[k]=b;tabs.append(b);panels[k]=el('div','ex-row');panels[k].style.flexDirection='column';panels[k].style.alignItems='stretch'});
const btn=(t,f,pri)=>{const b=el('button','sc-b'+(pri?' pri':''));b.type='button';b.textContent=t;b.onclick=f;return b};
const file=el('input');file.type='file';file.accept='.js,.mjs,.txt,text/javascript,application/javascript';file.hidden=true;
const ta=el('textarea');ta.spellcheck=false;ta.placeholder='ここに拡張機能のコードを貼り付け( Scratch.extensions.register(...) を呼ぶJS )';ta.setAttribute('aria-label','拡張機能のコード');
const ui=el('input');ui.type='text';ui.placeholder='https://…/extension.js  または  lab/text(公式ギャラリーの名前)';ui.setAttribute('aria-label','拡張機能のURL');
const list=el('div','ex-list');
async function add(code,meta){if(busy)return;if(!code||!code.trim()){say('コードが空です',1);return}if(code.length>3e6){say('コードが大きすぎます(3MBまで)',1);return}
if(!await uiConfirm('拡張機能のコードをこのページの中で実行します。\n'+(meta.url?'取得元: '+meta.url+'\n':'')+(meta.name?'名前: '+meta.name+'\n':'')+'サイズ: '+Math.ceil(code.length/1024)+'KB\n\n信頼できるコードだけ実行してください。実行しますか?','実行する'))return;
busy=1;say('読み込み中…');stopRun();let src;
try{src=exLoad(code,meta);for(let i=0;i<20&&!src.exts.length;i++)await new Promise(r=>setTimeout(r,100));
if(!src.exts.length){exUnload(src,false);throw Error('Scratch.extensions.register() が呼ばれませんでした(TurboWarp形式の拡張機能ではないかもしれません)')}
touch();const e=src.exts[0];WS.cat=e.cat;if(H.refresh)H.refresh();const n=src.exts.reduce((a,x)=>a+x.ops.length,0),w=src.exts.reduce((a,x)=>a.concat(x.warn),[]);
say('読み込みました: '+src.name+'('+n+'個のブロック)。ブロックの一覧の「'+e.name+'」にあります。'+(w.length?'\n注意: '+w.join(' / '):''))}
catch(e){say('読み込みに失敗しました: '+((e&&e.message)||e),1)}finally{busy=0;renderList()}}
function renderList(){list.innerHTML='';if(!EX.src.length){const e=el('div');e.style.cssText='font-size:12px;opacity:.7';e.textContent='読み込み済みの拡張機能はありません';list.append(e);return}
for(const s of EX.src){const r=el('div','ex-item'),c=el('i'),nm=el('div','nm'),b=btn('削除',async()=>{if(!await uiConfirm('拡張機能「'+s.name+'」を削除しますか?\n(この拡張機能のブロックを使っている部分も、すべてのシーンから消えます)'))return;stopRun();exUnload(s,true);touch();say('削除しました');renderList();if(H.refresh)H.refresh()});
c.style.background=(s.exts[0]&&s.exts[0].color)||'#999';const n1=el('div');n1.textContent=s.name;const sm=el('div');sm.style.cssText='font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis';sm.textContent='ID: '+s.exts.map(e=>e.id+'('+e.ops.length+'個)').join(' / ')+(s.url?'  '+s.url:'');nm.append(n1,sm);b.style.minHeight='36px';r.append(c,nm,b);list.append(r)}}
const fb=btn('ファイル(.js)を選んで読み込む',()=>file.click(),1);file.onchange=()=>{const f=file.files[0];file.value='';if(!f)return;if(f.size>3e6){say('ファイルが大きすぎます(3MBまで)',1);return}const rd=new FileReader();rd.onerror=()=>say('ファイルを読めませんでした',1);rd.onload=()=>add(String(rd.result),{name:f.name.replace(/\.[^.]*$/,'')});rd.readAsText(f)};
panels.file.append(fb,file);
const r1=el('div','ex-row');r1.append(btn('サンプルを入れる',()=>{ta.value=EX_SAMPLE;ta.scrollTop=0}),btn('この内容を読み込む',()=>add(ta.value,{name:'テキスト'}),1));panels.text.append(ta,r1);
/* URLの整形: 「stretch」「lab/text」のような名前だけ → 公式ギャラリー / ?extension=URL / GitHubのページURL / http→https */
const exNorm=raw=>{let u=String(raw||'').trim().replace(/^[<"']+|[>"']+$/g,'');if(!u)return'';let m;
if((m=/[?&]extension=([^&#]+)/.exec(u))&&/^https?:\/\/[^/]*turbowarp\.org\//i.test(u)){try{u=decodeURIComponent(m[1])}catch(e){u=m[1]}}
if(!/^[a-z][a-z0-9+.-]*:/i.test(u)){if(/^[\w-]+(\/[\w-]+)*(\.js)?$/i.test(u))u='https://extensions.turbowarp.org/'+u.replace(/\.js$/i,'')+'.js';else if(/^[\w-]+(\.[\w-]+)+(\/|$)/.test(u))u='https://'+u}
if(/^http:\/\//i.test(u)&&location.protocol=='https:'&&!/^http:\/\/(localhost|127\.|\[::1\])/i.test(u))u=u.replace(/^http:/i,'https:');
if(m=/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/?#]+)\/([^?#]+)/i.exec(u))u='https://raw.githubusercontent.com/'+m[1]+'/'+m[2]+'/'+m[3]+'/'+m[4];
if((m=/^https?:\/\/extensions\.turbowarp\.org\/([^?#]*?)\/?(?:[?#].*)?$/i.exec(u))&&m[1]&&!/\.js$/i.test(m[1]))u='https://extensions.turbowarp.org/'+m[1]+'.js';
return u};
const exAlt=u=>{const m=/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(u);return m?['https://cdn.jsdelivr.net/gh/'+m[1]+'/'+m[2]+'@'+m[3]+'/'+m[4]]:[]};
/* 1つのURLを取得。ヘッダーは付けない(Cache-Control等を付けるとCORSの事前確認が必要になり、公開元によっては失敗する) */
async function exFetch1(x){const c=new AbortController(),tm=setTimeout(()=>c.abort(),20000);try{const r=await fetch(x,{signal:c.signal,credentials:'omit',redirect:'follow'});if(!r.ok){const e=Error('HTTP '+r.status);e.http=r.status;throw e}return await r.text()}finally{clearTimeout(tm)}}
const exIsHtml=s=>/^\s*<(?:!doctype|html|head|body|\?xml)/i.test(s);
const ub=btn('読み込む',async()=>{if(busy)return;const u=exNorm(ui.value);if(!/^https?:\/\//i.test(u)){say('URL か、公式ギャラリーの名前(例: lab/text)を入れてください',1);return}ui.value=u;say('ダウンロード中…');let code=null,from=u,fail=null;
for(const x of[u,...exAlt(u)]){try{code=await exFetch1(x);from=x;fail=null;break}catch(e){fail=fail||e}}
if(code==null&&!(fail&&fail.http)){/* 通信自体が失敗(CORS等): 確認のうえ中継サービス経由で再挑戦 */
if(await uiConfirm('このURLを直接取得できませんでした(公開元がCORSを許可していない、など)。\n\n中継サービス(corsproxy.io)を経由して取得しますか?\n\n注意: 中継サービスはコードを書き換えられる可能性があります。信頼できる取得元のときだけ許可してください。\n\n取得元: '+u,'経由して取得')){try{code=await exFetch1('https://corsproxy.io/?url='+encodeURIComponent(u));from=u;fail=null}catch(e){fail=e}}}
if(code==null){const h=fail&&fail.http;say('取得できませんでした: '+(h==404?'HTTP 404(そのURLにファイルがありません。公式ギャラリーなら https://extensions.turbowarp.org/ で拡張機能を開き、名前を確認してください)':h?'HTTP '+h:(fail&&fail.name=='AbortError'?'時間切れ(20秒)':'通信できません(ネットワーク・CORS・http/https の違いなど)')+'。ファイルを保存して「ファイル」から読み込む方法も使えます'),1);return}
if(exIsHtml(code)){say('取得した内容がウェブページ(HTML)でした。拡張機能の .js ファイルそのもののURLを入れてください(GitHubなら「Raw」のURL)',1);return}
add(code,{name:u.split(/[?#]/)[0].split('/').pop().replace(/\.[^.]*$/,'')||'URL',url:from})},1);ui.onkeydown=e=>{if(e.key=='Enter'&&!e.isComposing){e.preventDefault();ub.click()}};const r2=el('div','ex-row');r2.append(ui,ub);panels.url.append(r2);
const gl=el('div');gl.style.cssText='font-size:12px;opacity:.75;margin-top:6px';gl.textContent='公式ギャラリー(extensions.turbowarp.org)の名前だけでも読み込めます。例:';const gr=el('div','ex-row');gr.style.flexWrap='wrap';
['lab/text','bitwise','fetch','files','local-storage'].forEach(n=>{const b=btn(n,()=>{ui.value=n;ub.click()});b.style.minHeight='34px';gr.append(b)});panels.url.append(gl,gr);
const lh=el('h4');lh.textContent='読み込み済み';body.append(note,tabs,panels.file,panels.text,panels.url,msg,lh,list);
const acts=el('div','acts');acts.append(btn('閉じる',close,1));dl.append(h,body,acts);ov.append(dl);document.body.append(ov);show('file');renderList()}
H.exDialog=exDialog;
/* ---------- Canvas描画API互換層: 拡張機能単位の状態・解放・クローン ---------- */
let exFrame=0;
function exRedraw(){
E.rd=1;if(exFrame)return;
exFrame=requestAnimationFrame(()=>{
exFrame=0;
if(RT&&!RT.halt)exEmit('BEFORE_EXECUTE');
SCN.drawNow();
if(RT&&!RT.halt&&S.open&&EX.src.some(s=>(s.ev.BEFORE_EXECUTE||[]).length))exRedraw();
});
}
const EXR=window.createPaintRenderer({
redraw:exRedraw,
clone(T,src){
if(src.cloneResult)return exTarget(src.cloneResult,src);
const n=createClone(T,'_myself_');return n?exTarget(n,src):null;
}
});
H.drawExtension=(x,T,k)=>EXR.draw(x,T,k);
H.extensionBox=T=>EXR.box(T);
H.extensionHit=(T,x,y)=>EXR.hit(T,x,y);
H.extensionCostume=T=>EXR.clearCostume(T);
function exRemoveTarget(T){
if(H.stopSound)H.stopSound(T.id);
for(const src of EX.src){
const w=src.targets.get(T);
if(w)for(const f of(src.ev.targetWasRemoved||[]).slice()){try{f(w)}catch(e){exErr(e)}}
src.targets.delete(T);
}
EXR.removeTarget(T);
}
{const base=createClone;createClone=function(T,name){
let original=T;if(name!=='_myself_')original=RT&&RT.list.find(t=>!t.isClone&&t.name===name);
const n=base(T,name);if(!n)return null;
for(const src of EX.src){src.cloneResult=n;try{
const w=exTarget(original,src);
src.canvas.RenderedTarget.prototype.makeClone.call(w);
for(const f of(src.ev.targetWasCreated||[]).slice())f(exTarget(n,src),w);
}catch(e){exErr(e)}finally{src.cloneResult=null}}
return n;
};H.createClone=createClone;}
{const base=deleteClone;deleteClone=function(T,th){if(T.isClone&&!T.dead)exRemoveTarget(T);return base(T,th)};H.deleteClone=deleteClone;}
{const base=killAll;killAll=function(){if(RT)for(const T of RT.list.slice())if(T.isClone)exRemoveTarget(T);return base()};H.killAll=killAll;}
{const base=reset;reset=function(){if(RT)for(const T of RT.list.slice())exRemoveTarget(T);return base()};H.reset=reset;SCN.reset=reset;}
{const base=flag;flag=function(){base();exRedraw()};SCN.flag=flag;}
{const base=stopAll;stopAll=function(){base();if(exFrame){cancelAnimationFrame(exFrame);exFrame=0}SCN.redraw()};H.stopAll=stopAll;SCN.stopAll=stopAll;}
{const base=tickAll;tickAll=function(){if(RT&&!RT.halt)exEmit('BEFORE_EXECUTE');return base()};}
/* Programmatic access uses the same loader, validation and persistence as the dialog. */
H.extensions={load:exLoad,unload:exUnload,sources:()=>EX.src.slice()};
/* ---------- Scratch 3の保存用ブロックを、既存のシーン用ブロックへ追加変換 ---------- */
const scratchUnsupported=(T,A)=>{throw Error('Scratch未対応ブロック: '+A.OP+'。元データは保持されています。')};
def('music_settempo','sound','stack','テンポを[T]にする',{T:['n',60]},(T,A)=>{RT.tempo=clamp(toNum(A.T),20,500)},{pal:false});
def('music_changetempo','sound','stack','テンポを[T]ずつ変える',{T:['n',20]},(T,A)=>{RT.tempo=clamp((RT.tempo||60)+toNum(A.T),20,500)},{pal:false});
def('music_gettempo','sound','r','テンポ',{},()=>RT.tempo||60,{pal:false});
def('scratch_unsupported','control','ce','未対応のScratchブロック [OP]',{OP:['s','']},scratchUnsupported,{pal:false});
def('scratch_unsupported_value','op','r','未対応 [OP]',{OP:['s','']},scratchUnsupported,{pal:false});
def('scratch_unsupported_bool','op','b','未対応 [OP]',{OP:['s','']},scratchUnsupported,{pal:false});
def('scratch_unsupported_hat','event','hat','未対応のScratchイベント [OP]',{OP:['s','']},null,{pal:false});

/* ---------- 追加ブロック: 回転方法 / 背景 / マイクの音量 (Scratch 3 の拡張機能以外のブロックを揃える) ---------- */
menuDefs.rotstyle=()=>[['all','自由に回転'],['lr','左右のみ'],['none','回転しない']];
def('motion_setrotstyle','motion','stack','回転方法を[ROT]にする',{ROT:['m','rotstyle','all']},(T,A)=>{const r=String(A.ROT);T.rot=r=='lr'||r=='none'?r:undefined});
/* 背景(=ステージのコスチューム) */
const stageT=()=>RT?RT.list.find(t=>t.stage&&!t.dead)||null:null;
const stageNames=()=>{const s=SC()&&SC().objs.find(x=>x.stage),m=s&&s.c&&ownerOf(s.c);return m?m.s.cs.map(c=>c.n):[]};
menuDefs.backdrop0=()=>{const L=stageNames();return L.length?L.map(n=>[n,n]):[['','(背景がありません)']]};
menuDefs.backdrop=()=>[...menuDefs.backdrop0(),['next backdrop','次の背景'],['previous backdrop','前の背景'],['random backdrop','ランダムな背景']];
menuDefs.numname=()=>[['number','番号'],['name','名前']];
function bdFire(name){const out=[];if(!RT)return out;const n=String(name);for(const T of RT.list.slice())for(const s of T.hats.bd||[]){if(String(s.b[0].in.B)===n)out.push(startScript(T,s))}return out}
function bdSet(req){const s=stageT();if(!s)return[];const L=costList(s);if(!L.length)return[];let c=null;const i0=Math.max(0,L.indexOf(s.c));
c=L.find(x=>x.n===String(req))||null;
if(!c){const r=String(req);if(r=='next backdrop')c=L[(i0+1)%L.length];else if(r=='previous backdrop')c=L[(i0-1+L.length)%L.length];
else if(r=='random backdrop'){if(L.length>1){let k=Math.floor(Math.random()*(L.length-1));if(k>=i0)k++;c=L[k]}else c=L[0]}
else if(r.trim()!==''&&isFinite(Number(r)))c=L[((Math.round(Number(r))-1)%L.length+L.length)%L.length]}
if(!c)return[];s.c=c;if(H.extensionCostume)H.extensionCostume(s);return bdFire(c.n)}
def('looks_switchbackdrop','looks','stack','背景を[B]にする',{B:['m','backdrop']},(T,A)=>{bdSet(A.B)});
def('looks_switchbackdropwait','looks','stack','背景を[B]にして待つ',{B:['m','backdrop']},function*(T,A,th){const L=bdSet(A.B);while(L.some(t=>!t.dead)){yield;if(th.stop||T.dead)return}});
def('looks_nextbackdrop','looks','stack','次の背景にする',{},()=>{bdSet('next backdrop')});
def('looks_backdropnn','looks','r','背景の[NN]',{NN:['m','numname','number']},(T,A)=>{const s=stageT(),L=s?costList(s):[];if(!s||!L.length)return A.NN=='name'?'':0;return A.NN=='name'?(s.c?s.c.n:''):L.indexOf(s.c)+1});
def('event_whenbackdrop','event','hat','背景が[B]に切り替わったとき',{B:['m','backdrop0']});
/* マイクの音量(Scratchの「音量」。マイクが使えないときは -1) */
const MIC={st:0,an:null,buf:null,ctx:null,stream:null,last:0};
function micStart(){if(MIC.st)return;MIC.st=1;
if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){MIC.st=3;return}
navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{if(MIC.st!=1){stream.getTracks().forEach(k=>k.stop());return}const AC=window.AudioContext||window.webkitAudioContext,ctx=new AC(),src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();an.fftSize=1024;src.connect(an);Object.assign(MIC,{an,ctx,stream,buf:new Float32Array(an.fftSize),st:2})},e=>{MIC.st=3;try{toast('マイクを使えませんでした')}catch(x){}})}
function micStop(){if(MIC.stream)MIC.stream.getTracks().forEach(k=>k.stop());if(MIC.ctx){try{MIC.ctx.close()}catch(e){}}Object.assign(MIC,{st:0,an:null,ctx:null,stream:null,buf:null,last:0})}
function micLoud(){micStart();if(MIC.st!=2)return -1;MIC.an.getFloatTimeDomainData(MIC.buf);let s=0;for(let i=0;i<MIC.buf.length;i++)s+=MIC.buf[i]*MIC.buf[i];const rms=Math.sqrt(s/MIC.buf.length);MIC.last=Math.max(rms,MIC.last*.6);return Math.round(Math.min(100,Math.max(0,Math.sqrt(MIC.last*1.63)*100)))}
H.micStop=micStop;
def('sense_loudness','sense','r','音量(マイク)',{},()=>micLoud());
/* パレットの並び(Scratchと同じ位置に置く) */
function palAfter(cat,op,after){const L=PAL[cat],i=L.indexOf(op);if(i<0)return;L.splice(i,1);const j=L.indexOf(after);L.splice(j<0?L.length:j+1,0,op)}
palAfter('motion','motion_setrotstyle','motion_bounce');
palAfter('looks','looks_switchbackdrop','looks_nextcostume');palAfter('looks','looks_switchbackdropwait','looks_switchbackdrop');palAfter('looks','looks_nextbackdrop','looks_switchbackdropwait');palAfter('looks','looks_backdropnn','looks_costumename');
palAfter('event','event_whenbackdrop','event_whenclicked');
palAfter('sense','sense_loudness','sense_mousey');
function scratchContext(scene,stage){
const g=scene.gvars||(scene.gvars={}),l=scene.glists||(scene.glists={}),conv=window.ScratchProgramImport;
return{registry:BK,makeId:uid,globalVars:g,globalLists:l,
globalVarIds:stage?conv.scope(stage.ex.variables,g):new Map(),
globalListIds:stage?conv.scope(stage.ex.lists,l):new Map(),
targetNames:new Map()};
}
function applyScratch(o,sp,scene,context){
const ex=sp.ex||{},program=window.ScratchProgramImport.convert({...ex,isStage:!!sp.stage},context);
o.stage=!!sp.stage;o.x=sp.stage?0:cl(nz(ex.x));o.y=sp.stage?0:cl(nz(ex.y));o.size=sp.stage?100:clamp(nz(ex.size,100),0,1e4);
o.dir=sp.stage?90:normDir(nz(ex.direction,90));o.vis=sp.stage||ex.visible!==false;
o.vars=program.vars;o.lists=program.lists;o.sc=program.scripts;
scene.defs=scene.defs||[];for(const d of program.defs){scene.defs.push(d);regProc(d)}
const valid={drop:0};o.sc.forEach(s=>{s.b=H.vBlocks(s.b,valid)});
if(valid.drop)program.warnings.push('入力形式の不一致 '+valid.drop+'件');
{const rs={'left-right':'lr',"don't rotate":'none'}[ex.rotationStyle];o.rot=rs;if(ex.rotationStyle&&ex.rotationStyle!='all around'&&!rs)program.warnings.push('回転方法 '+ex.rotationStyle+' (未対応のため自由に回転)')}
return program;
}
H.importScratch=(sprites,opt={})=>{
stopRun();reindex();const stage=sprites.find(sp=>sp.stage);
let scene=opt.replace||!SC()?newScene(String(opt.name||'Scratch').replace(/\.(sb3|sprite3|zip)$/i,'').slice(0,60)):SC();
const context=scratchContext(scene,stage),warnings=[];let scripts=0,objects=0;
const ordered=sprites.slice().sort((a,b)=>a.stage?-1:b.stage?1:nz(a.ex&&a.ex.layerOrder)-nz(b.ex&&b.ex.layerOrder));
const names=new Set(scene.objs.map(o=>o.name));
for(const sp of ordered){let name=sp.stage?'Stage':sp.n,base=name,n=2;while(names.has(name))name=base+' ('+(n++)+')';names.add(name);context.targetNames.set(sp.scratchName||sp.n,name)}
for(const sp of ordered){
const costume=sp.cs[clamp(sp.ci|0,0,sp.cs.length-1)];if(!costume)continue;
const o=newObj(costume,context.targetNames.get(sp.scratchName||sp.n));
const p=applyScratch(o,sp,scene,context);scene.objs.push(o);scripts+=o.sc.length;objects++;
warnings.push(...p.warnings.map(w=>o.name+': '+w));
for(const msg of Object.values((sp.ex||{}).broadcasts||{}))if(!scene.msgs.includes(String(msg)))scene.msgs.push(String(msg));
}
if(opt.replace){S.scenes=[scene];S.cur=0}else if(!S.scenes.includes(scene)){S.scenes.push(scene);S.cur=S.scenes.length-1}
S.sel=(scene.objs.find(o=>!o.stage)||scene.objs[0]||{}).id||null;
bindAll();touch();if(R.root)refreshAll();
return{objects,scripts,warnings};
};
H.attachScratch=(o,c)=>{
const owner=ownerOf(c);if(!owner||!Object.keys(owner.s.ex&&owner.s.ex.blocks||{}).length)return;
const scene=SC(),context=scratchContext(scene);
for(const sp of SPS)context.targetNames.set(sp.n,sp.n);
const p=applyScratch(o,owner.s,scene,context);
if(p.warnings.length)toast('Scratchプログラムを取り込みました。未対応: '+p.warnings.join(' / '));
};
/* ---------- Scratch書き出し: シーンのオブジェクトのプログラムを、スプライトごとのScratchブロックにする ----------
   ・同じスプライトを使うオブジェクトが複数あるとき、2つ目以降は「名前2」「名前3」…の複製スプライトにする
   ・使った拡張機能(ペン・音楽・伸縮・読み込み済みの拡張)は extensions / extensionURLs に入れる */
H.scratchInfo=()=>{reindex();const has=sc=>sc.objs.some(o=>o.sc&&o.sc.some(s=>s.b&&s.b.length));return{scenes:S.scenes.length,withScripts:S.scenes.filter(has).length,cur:SC()?has(SC()):false}};
H.scratchPlan=(opt={})=>{
reindex();const E=window.ScratchProgramExport;if(!E)return null;
const scenes=opt.mode=='all'?S.scenes.slice():(SC()?[SC()]:[]);
const plan={fps:scenes[0]?vFps(scenes[0].fps):30,entries:[],stage:null,globalVars:{},globalLists:{},broadcasts:{},extensions:[],extensionURLs:{},warnings:[]};
const gvIds=new Map(),glIds=new Map(),bcIds=new Map(),extReg=new Map(),used=new Map();
const gVar=(name,val)=>{name=String(name);if(gvIds.has(name))return gvIds.get(name);const id='pegv'+gvIds.size;gvIds.set(name,id);plan.globalVars[id]=[name,val===undefined?0:val];return id};
const gList=(name,val)=>{name=String(name);if(glIds.has(name))return glIds.get(name);const id='pegl'+glIds.size;glIds.set(name,id);plan.globalLists[id]=[name,Array.isArray(val)?val:[]];return id};
const bcast=name=>{name=String(name);if(bcIds.has(name))return bcIds.get(name);const id='pebc'+bcIds.size;bcIds.set(name,id);plan.broadcasts[id]=name;return id};
const exts=new Set(),b64=s=>btoa(unescape(encodeURIComponent(s)));
const extInfo=ext=>{const s=ext.src;let url=s.url&&/^https:\/\/extensions\.turbowarp\.org\//.test(s.url)?s.url:'data:application/javascript;base64,'+b64(s.code);plan.extensionURLs[ext.id]=url;return{id:ext.id,url}};
const spNames=new Set(SPS.map(s=>s.n));let seq=0;
const uniqName=base=>{const sep=/\d$/.test(base)?' ':'';let n=2,nm=base+sep+n;while(spNames.has(nm)){n++;nm=base+sep+n}spNames.add(nm);return nm};
const stageScripts=[];let stageEntry=null;
for(const scene of scenes){
for(const k of Object.keys(scene.gvars||{}))gVar(k,scene.gvars[k]);for(const k of Object.keys(scene.glists||{}))gList(k,scene.glists[k]);(scene.msgs||[]).forEach(bcast);
const defs=new Map((scene.defs||[]).map(d=>[d.id,d])),defScripts=new Map();
scene.objs.forEach(o=>(o.sc||[]).forEach(s=>{const f=s.b&&s.b[0];if(f&&typeof f.op=='string'&&f.op.startsWith('pd:')&&!defScripts.has(f.op.slice(3)))defScripts.set(f.op.slice(3),s)}));
/* 1) オブジェクト → 書き出す名前 */
const jobs=[],names=new Map();
for(const o of scene.objs){const m=o.c&&CI.get(o.c);if(!m){plan.warnings.push('「'+o.name+'」はコスチュームがないため、プログラムを書き出しません');continue}
const sp=m.s;if(opt.only&&sp.n!==opt.only)continue;
let name;if(sp.stage)name='Stage';else{const c=used.get(sp.n)||0;used.set(sp.n,c+1);name=c==0?sp.n:uniqName(sp.n)}
names.set(o.name,name);jobs.push({o,sp,m,name})}
/* 2) 変換 */
for(const j of jobs){const o=j.o;
const ctx={registry:BK,defs,defScripts,names,gVar:n=>gVar(n,scene.gvars&&scene.gvars[n]),gList:n=>gList(n,scene.glists&&scene.glists[n]),bcast,extInfo,globalsAsLocal:!!opt.globalsAsLocal,gvals:scene.gvars||{},glists:scene.glists||{}};
const res=E.build({key:'pe'+(++seq),isStage:!!j.sp.stage,name:o.name,scripts:JSON.parse(JSON.stringify(o.sc||[])),vars:o.vars||{},lists:o.lists||{}},ctx);
res.warnings.forEach(w=>plan.warnings.push(o.name+': '+w));res.exts.forEach(x=>exts.add(x));
(o.sc||[]).forEach(()=>0);
const e={spName:j.sp.n,stage:!!j.sp.stage,exportName:j.name,blocks:res.blocks,variables:res.variables,lists:res.lists,ci:j.m.i,costume:o.c.n,x:o.x,y:o.y,size:o.size,direction:o.dir,visible:!!o.vis,rotationStyle:o.rot=='lr'?'left-right':o.rot=='none'?"don't rotate":'all around'};
if(j.sp.stage){if(!stageEntry){stageEntry=e;plan.stage=e}else{Object.assign(stageEntry.blocks,e.blocks);Object.assign(stageEntry.variables,e.variables);Object.assign(stageEntry.lists,e.lists)}}
else plan.entries.push(e)}}
for(const x of exts){if(x=='stretch')plan.extensionURLs.stretch='https://extensions.turbowarp.org/stretch.js'}
plan.extensions=[...exts];
return plan};
/* ---------- 変数モニター(ステージ表示) ---------- */
H.drawMon=x=>{if(!RT)return;let i=0;for(const k in RT.mon){const m=RT.mon[k],v=m.T?m.T.vars[m.name]:RT.g[m.name],lab=(m.T?m.T.name+': ':'')+m.name,val=toStr(v===undefined?0:v);x.save();x.font='bold 11px system-ui,sans-serif';x.textBaseline='middle';
const w1=x.measureText(lab).width+10,w2=Math.max(30,x.measureText(val).width+10),y=5+i*22;x.fillStyle='#e6f0ff';x.strokeStyle='#c9d0d9';x.lineWidth=1;x.beginPath();x.roundRect?x.roundRect(5,y,w1+w2+4,19,4):x.rect(5,y,w1+w2+4,19);x.fill();x.stroke();
x.fillStyle='#575e75';x.fillText(lab,10,y+10);x.fillStyle='#ff8c1a';x.beginPath();x.roundRect?x.roundRect(5+w1+2,y+2,w2,15,3):x.rect(5+w1+2,y+2,w2,15);x.fill();x.fillStyle='#fff';x.textAlign='center';x.fillText(val,5+w1+2+w2/2,y+10);x.restore();i++}};

/* ---------- 起動 ---------- */
window.PaintAudio.installRuntime(SCN);
try{const t=localStorage.getItem('ced_scn');if(t){SCN.unpack(JSON.parse(t),{trust:true})}}catch(e){S.scenes=[]}
(function(){const M=q('#mbar');if(!M)return;const b=el('button','mbtn');b.id='scn_open';b.type='button';b.innerHTML=ic('sc_film',20)+'<span>アニメーション</span>';b.title='コスチュームを組み合わせて動かす(シーンエディタ・ブロック)';b.onclick=open;const v=q('#m_view');const w=v&&v.parentNode;if(w&&w.parentNode===M)w.after(b);else M.append(b)})();
SCN.test={refreshAll,drawStage,stagePt,fitStage,setPanel,addObj,newObj,importText,exportScenes,vScene,packScene,hitPix,build,bindAll};

})();
