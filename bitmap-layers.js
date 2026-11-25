/* ======================================================================
   ビットマップレイヤー(bitmap-layers.js)  ※読み込み順: costume-editor.js の直後・animation.js の前

   考え方(既存の描画エンジンは作り直さない):
   ・レイヤーを使っていないコスチュームは従来どおり(c.ly が無い)。何も変わらない。
   ・レイヤーを使うコスチュームは c.ly = {L:[レイヤー…(下→上の順)], a:選択中レイヤーのID} を持つ。
     レイヤー = {id, n(名前), v(表示), lk(ロック), o(不透明度0〜1), cv(canvas)}。IDは重複しない文字列。
   ・「いま描く対象」である c.bc を選択中レイヤーの canvas に差し替えるだけ。
     ブラシ・消しゴム・図形・塗りつぶし・範囲選択の移動/変形・フィルターなど既存ツールは、そのまま選択中レイヤーに効く。
   ・合成は表示(dcv)と書き出し/サムネイル(dc)だけが行う。PNG・SB3・SVG(画像埋め込み)・サムネイル・オニオンスキンは dc を通るので、
     表示中のレイヤーだけが不透明度つきで1枚に統合される。
   ・アニメーション側が読む c._tp(絵のある部分だけの小さなcanvas)には、全体サイズの合成結果を入れて見せる。
   ・履歴(Undo/Redo)は costume-editor.js の st()/rs() にレイヤー構造と画素を載せる。
   ・保存は costume の JSON に ly を足す。bm(統合済みPNG)も従来どおり入れるので、古い版でも統合画像として開ける。
   ====================================================================== */
(function(){
'use strict';
const MAXL=30,MAXPX=80e6;/* レイヤー数の上限 / 全レイヤー合計の画素数の上限(960×720なら約115枚ぶん。先に枚数の上限に当たる) */
const BL=window.BL={MAXL,MAXPX,_m:0};
let seq=0;
const uid=()=>'ly'+Date.now().toString(36)+(++seq).toString(36);
const mkcv=(w,h)=>{const o=document.createElement('canvas');o.width=Math.max(1,w|0);o.height=Math.max(1,h|0);return o};
const act=c=>c.ly.L.find(l=>l.id===c.ly.a)||c.ly.L[c.ly.L.length-1];
const touch=l=>{l._ss=null;l._du=null};/* 画素が変わった(または変わりうる)レイヤーのキャッシュを捨てる */
BL.on=c=>!!(c&&c.k=='b'&&c.ly);

/* ---------- 合成 ---------- */
let scr=null;
/* x に表示中のレイヤーを下から重ねる。o.pv=選択中レイヤーの代わりに使うプレビュー画像 / o.fl=浮かせ中の範囲選択(選択中レイヤーの位置に重ねる) */
function flat(x,c,o){o=o||{};const A=c.ly.a,ga=x.globalAlpha;
for(const l of c.ly.L){if(!l.v)continue;let src=l.cv;
if(l.id===A){if(o.pv)src=o.pv;
if(o.fl&&o.fl.cvs){if(!scr)scr=mkcv(1,1);if(scr.width!==c.w||scr.height!==c.h){scr.width=c.w;scr.height=c.h}
const sx=scr.getContext('2d');sx.setTransform(1,0,0,1,0,0);sx.globalAlpha=1;sx.globalCompositeOperation='source-over';sx.clearRect(0,0,c.w,c.h);sx.drawImage(src,0,0);stampSel(sx,o.fl);src=scr}}
x.globalAlpha=ga*l.o;x.drawImage(src,0,0)}
x.globalAlpha=ga}
BL.dcv=(x,c)=>{const b=c===C()&&sel[0]&&sel[0].t=='bs'?vs(sel[0]):0;flat(x,c,{pv:PRV.bm,fl:b&&b.cvs?b:null})};
BL.dc=(x,c)=>{const f=c===C()&&sel[0]&&sel[0].t=='bs'&&sel[0].cvs?sel[0]:null;flat(x,c,{fl:f})};
/* アニメーション等が読む c._tp(全体サイズ・位置0,0)を最新の合成結果にする */
function refresh(c){if(!c.ly)return;let t=c._tp;
if(!t||!t.cv||t.cv.width!==c.w||t.cv.height!==c.h){t={cv:mkcv(c.w,c.h),ox:0,oy:0};c._tp=t}
const x=t.cv.getContext('2d');x.setTransform(1,0,0,1,0,0);x.globalAlpha=1;x.clearRect(0,0,c.w,c.h);flat(x,c,null);c._bb=undefined}
BL.refresh=refresh;
BL.px=(c,x,y)=>{const o=mkcv(1,1),q=o.getContext('2d',{willReadFrequently:true});for(const l of c.ly.L){if(!l.v)continue;q.globalAlpha=l.o;q.drawImage(l.cv,-x,-y)}return q.getImageData(0,0,1,1).data};

/* ---------- 履歴(Undo/Redo) ---------- */
/* 選択中レイヤーは毎回撮り直し、ほかのレイヤーは前に撮った画素(_ss)を使い回す。ImageDataは作ったあと書き換えないので共有して安全 */
function snap(c){const A=c.ly.a;return{a:A,L:c.ly.L.map(l=>{let im;
if(l.id===A||!l._ss){im=l.cv.getContext('2d').getImageData(0,0,l.cv.width,l.cv.height);l._ss=l.id===A?null:im}else im=l._ss;
return{id:l.id,n:l.n,v:l.v,lk:l.lk,o:l.o,im}})}}
BL.st=c=>({k:'b',sh:JSON.stringify(c.sh||[],rep),bm:0,tp:null,w:c.w,h:c.h,cx:c.cx,cy:c.cy,res:RS(c),ly:snap(c)});
BL.sz=a=>{const l=a.ly.L.find(q=>q.id===a.ly.a)||a.ly.L[0];return l&&l.im?l.im.data.length:0};
BL.rs=(c,t,rs0)=>{
if(!t.ly){c.ly=null;c._tp=null;c._bb=undefined;return rs0(c,t)}/* レイヤーあり → レイヤーなしの状態へ戻す */
const was=c.ly;
c.k='b';c.sh=[];c.w=t.w;c.h=t.h;c.cx=t.cx;c.cy=t.cy;c.res=+t.res>0?+t.res:1;
if(!was){const d=Object.getOwnPropertyDescriptor(c,'bc');if(d&&d.get)cpDrop(c,mkcv(1,1));else c._tp=null}
const old=new Map(was?was.L.map(l=>[l.id,l]):[]);
const L=t.ly.L.map(s=>{let l=old.get(s.id);if(l)old.delete(s.id);else l={id:s.id,cv:mkcv(t.w,t.h)};
l.n=s.n;l.v=s.v;l.lk=s.lk;l.o=s.o;if(l.cv.width!==t.w||l.cv.height!==t.h){l.cv.width=t.w;l.cv.height=t.h}
l.cv.getContext('2d').putImageData(s.im,0,0);l._ss=s.im;l._du=null;return l});
c.ly={L,a:L.some(l=>l.id===t.ly.a)?t.ly.a:L[L.length-1].id};
const a=act(c);a._ss=null;c.bc=a.cv;refresh(c)};

/* ---------- 編集の保護(ロック・非表示) ---------- */
/* 履歴を積む操作(=画素を書き換える操作)の入口。選択中レイヤーがロック/非表示なら中断する。レイヤー自身の操作は BL.free 経由で通す */
BL.guard=()=>{if(BL._m)return;const c=C();if(!c||!BL.on(c))return;const l=act(c);if(!l.lk&&l.v)return;
toast(l.lk?'ロック中のレイヤーは編集できません':'非表示のレイヤーには描けません');const e=new Error('bitmap layer is protected');e.lyLock=1;throw e};
BL.free=f=>{BL._m++;try{return f()}finally{BL._m--}};
addEventListener('error',e=>{if(e.error&&e.error.lyLock)e.preventDefault()});
/* 描き始め・移動の開始時に先に止める(描いてから消えるのを避ける)。止めたら true */
BL.blocked=(c,p,quiet)=>{if(!BL.on(c))return false;const l=act(c);if(l.v&&!l.lk)return false;let b=false;
if(['brush','eras','brect','bell','bline','fill'].includes(tool))b=true;
else if(tool=='bsel'&&p){const s=sel[0];if(s&&s.t=='bs'&&bsPx(s)>0){if(hitH(p))b=true;else{const q=w2l(s,p[0],p[1]);if(Math.abs(q[0])<=s.w/2&&Math.abs(q[1])<=s.h/2)b=true}}}
else if(quiet)b=true;
if(b)toast(l.lk?'ロック中のレイヤーは編集できません':'非表示のレイヤーには描けません');return b};

/* ---------- 構造の操作 ---------- */
function setAct(c,id){const l=c.ly.L.find(q=>q.id===id);if(!l)return;c.ly.a=l.id;c.bc=l.cv;touch(l)}
/* 既存のビットマップをそのまま1枚目のレイヤーにする(画素は一切コピー・変更しない) */
function ensure(c){if(c.ly)return;bcommit();const base=c.bc;const l={id:uid(),n:'レイヤー1',v:true,lk:false,o:1,cv:base};c.ly={L:[l],a:l.id};c.bc=base;refresh(c)}
/* 履歴を1つ積んでから構造を変える。fn の中では履歴を積まない */
function meta(fn){const c=C();if(!c||c.k!='b')return;bcommit();pvClear();BL.free(()=>hist());fn(c);fin()}
function room(c,n){const k=c.ly?c.ly.L.length:1;
if(k+n>MAXL){uiAlert('レイヤーは1つのコスチュームに最大'+MAXL+'枚までです。');return false}
if((k+n)*c.w*c.h>MAXPX){uiAlert('画像が大きいため、これ以上レイヤーを増やせません(メモリ保護)。');return false}return true}
function newName(c){const used=new Set(c.ly?c.ly.L.map(l=>l.n):[]);for(let i=1;;i++)if(!used.has('レイヤー'+i))return'レイヤー'+i}
function add(){const c=C();if(c.k!='b'||!room(c,1))return;meta(()=>{ensure(c);const l={id:uid(),n:newName(c),v:true,lk:false,o:1,cv:mkcv(c.w,c.h)};c.ly.L.splice(c.ly.L.indexOf(act(c))+1,0,l);setAct(c,l.id)})}
function useLayers(){const c=C();if(c.k!='b'||c.ly)return;meta(()=>ensure(c))}
function dup(){const c=C();if(!BL.on(c)||!room(c,1))return;meta(()=>{const l=act(c),cv=mkcv(c.w,c.h);cv.getContext('2d').drawImage(l.cv,0,0);
const n={id:uid(),n:l.n+' のコピー',v:l.v,lk:false,o:l.o,cv};c.ly.L.splice(c.ly.L.indexOf(l)+1,0,n);setAct(c,n.id)})}
function del(){const c=C();if(!BL.on(c))return;const l=act(c);
if(c.ly.L.length<2){uiAlert('最後の1枚は削除できません。\nレイヤーをやめるには「結合」→「通常の画像に戻す」を使ってください。');return}
if(l.lk){toast('ロック中のレイヤーは削除できません');return}
meta(()=>{const i=c.ly.L.indexOf(l);c.ly.L.splice(i,1);setAct(c,c.ly.L[Math.max(0,i-1)].id)})}
function rename(id){const c=C();if(!BL.on(c))return;const l=c.ly.L.find(q=>q.id===(id||c.ly.a));if(!l)return;
const n=prompt('レイヤー名',l.n);if(n==null)return;const s=n.trim().slice(0,60);if(!s||s===l.n)return;meta(()=>{l.n=s})}
function move(d){const c=C();if(!BL.on(c))return;const i=c.ly.L.indexOf(act(c)),j=i+d;if(j<0||j>=c.ly.L.length)return;
meta(()=>{const L=c.ly.L;[L[i],L[j]]=[L[j],L[i]]})}
function moveTo(id,to){const c=C();if(!BL.on(c))return;const L=c.ly.L,i=L.findIndex(l=>l.id===id);if(i<0||to<0||to>=L.length||i===to)return;
meta(()=>{const[m]=L.splice(i,1);L.splice(to,0,m)})}
function toggle(id,k){const c=C();if(!BL.on(c))return;const l=c.ly.L.find(q=>q.id===id);if(!l)return;meta(()=>{l[k]=!l[k]})}
function pick(id){const c=C();if(!BL.on(c)||c.ly.a===id)return;bcommit();pvClear();setAct(c,id);sel=[];selPt=-1;fin()}
/* 不透明度: つまみを動かしている間は1回だけ履歴を積む */
let opDirty=0;
function opacity(v,done){const c=C();if(!BL.on(c))return;const l=act(c);v=Math.min(100,Math.max(0,Math.round(+v)));if(!isFinite(v))return;
if(!opDirty&&v/100!==l.o){bcommit();pvClear();BL.free(()=>hist());opDirty=1}
if(opDirty){l.o=v/100;refresh(c);draw();if(!done)syncOp(c)}
if(done){opDirty=0;fin()}}
/* 結合 */
const hasLockedOrHidden=(L)=>L.some(l=>l.lk||!l.v);
function blendInto(dst,list){/* list(下→上)を、各レイヤーの不透明度を反映して dst.cv に合成して書き込む(dst.o は 1 になる) */
const c=C(),tmp=mkcv(c.w,c.h),x=tmp.getContext('2d');for(const l of list){x.globalAlpha=l.o;x.drawImage(l.cv,0,0)}
const d=dst.cv.getContext('2d');d.setTransform(1,0,0,1,0,0);d.globalAlpha=1;d.globalCompositeOperation='source-over';d.clearRect(0,0,c.w,c.h);d.drawImage(tmp,0,0);dst.o=1;touch(dst)}
function mergeDown(){const c=C();if(!BL.on(c))return;const L=c.ly.L,i=L.indexOf(act(c));
if(i<1){uiAlert('いちばん下のレイヤーは、下に結合できません。');return}
const a=L[i],b=L[i-1];if(!a.v||!b.v){uiAlert('非表示のレイヤーは結合できません。表示してからやり直してください。');return}
if(a.lk||b.lk){uiAlert('ロック中のレイヤーは結合できません。ロックを解除してからやり直してください。');return}
meta(()=>{blendInto(b,[b,a]);L.splice(i,1);setAct(c,b.id)})}
function mergeVisible(){const c=C();if(!BL.on(c))return;const L=c.ly.L,V=L.filter(l=>l.v);
if(V.length<2){uiAlert('表示中のレイヤーが2枚以上ないと結合できません。');return}
if(V.some(l=>l.lk)){uiAlert('ロック中のレイヤーがあるため結合できません。ロックを解除してからやり直してください。');return}
meta(()=>{const base=V[0];blendInto(base,V);for(const l of V.slice(1))L.splice(L.indexOf(l),1);setAct(c,base.id)})}
async function flatten(){const c=C();if(!BL.on(c))return;const hid=c.ly.L.filter(l=>!l.v).length;
if(hid&&!await uiConfirm('非表示のレイヤーが'+hid+'枚あります。通常の画像に戻すと、非表示のレイヤーは捨てられます。続けますか?','続ける','キャンセル'))return;
meta(()=>{const o=mkcv(c.w,c.h);flat(o.getContext('2d'),c,null);c.ly=null;c._tp=null;c._bb=undefined;c.bc=o})}
/* 選択中の範囲(浮かせる前)の画素を新しいレイヤーへ分ける。元の位置は透明になる */
function split(){const c=C();if(!BL.on(c))return;const b=sel[0];
if(!b||b.t!='bs'||b.cvs||!b.src||!(b.src[2]>0)){uiAlert('「範囲」ツールで分けたい部分を選んでから押してください。\n(移動・変形を始める前の選択範囲が対象です)');return}
const l=act(c);if(l.lk||!l.v){toast(l.lk?'ロック中のレイヤーは編集できません':'非表示のレイヤーは編集できません');return}
if(!room(c,1))return;const[X,Y,w,h]=b.src;
meta(()=>{const cv=mkcv(c.w,c.h);cv.getContext('2d').drawImage(l.cv,X,Y,w,h,X,Y,w,h);l.cv.getContext('2d').clearRect(X,Y,w,h);touch(l);
const n={id:uid(),n:newName(c),v:true,lk:false,o:1,cv};c.ly.L.splice(c.ly.L.indexOf(l)+1,0,n);setAct(c,n.id);sel=[]})}
async function mergeMenu(){const c=C();if(!BL.on(c))return;
const v=await uiDlg('レイヤーの結合',[{t:'キャンセル',v:null},{t:'下のレイヤーと結合',v:'down'},{t:'表示中のレイヤーをすべて結合',v:'vis'},{t:'通常の画像に戻す(すべて統合)',v:'flat'}],{esc:null,focus:1});
if(cs.indexOf(c)<0||c!==C())return;if(v=='down')mergeDown();else if(v=='vis')mergeVisible();else if(v=='flat')flatten()}
/* キャンバスを広げるとき、すべてのレイヤーを同じ大きさにそろえる */
BL.grow=(c,W,H)=>{for(const l of c.ly.L){const o=mkcv(l.cv.width,l.cv.height);o.getContext('2d').drawImage(l.cv,0,0);l.cv.width=W;l.cv.height=H;l.cv.getContext('2d').drawImage(o,0,0);touch(l)}};

/* ---------- 保存・読み込み ---------- */
/* 選択中以外のレイヤーは変わらない間だけ、PNG化の結果(_du)を使い回す */
BL.ser=c=>({ver:1,a:c.ly.a,L:c.ly.L.map(l=>{const ca=c===C()&&l.id===c.ly.a;let u=ca?null:l._du;if(!u){u=l.cv.toDataURL();if(!ca)l._du=u;else l._du=null}return{id:l.id,n:l.n,v:l.v,lk:l.lk,o:l.o,u}})});
BL.enter=c=>{if(c&&c.ly)c.ly.L.forEach(l=>{l._du=null;l._ss=null})};
BL.load=async(c,q)=>{const y=q.ly;if(!y||!Array.isArray(y.L)||!y.L.length)return false;const used=new Set(),L=[];
for(const s of y.L){if(!s||typeof s!='object')continue;const id=typeof s.id=='string'&&s.id&&!used.has(s.id)?s.id:uid();used.add(id);const cv=mkcv(q.w,q.h);
if(typeof s.u=='string'&&s.u.startsWith('data:image/'))await new Promise(r=>{const im=new Image;im.onload=()=>{try{cv.getContext('2d').drawImage(im,0,0)}catch(e){}r()};im.onerror=()=>r();im.src=s.u});
const o=+s.o;L.push({id,n:typeof s.n=='string'&&s.n?s.n.slice(0,60):'レイヤー'+(L.length+1),v:s.v!==false,lk:!!s.lk,o:isFinite(o)?Math.min(1,Math.max(0,o)):1,cv})}
if(!L.length)return false;c.k='b';c.ly={L,a:L.some(l=>l.id===y.a)?y.a:L[L.length-1].id};c.bc=act(c).cv;c._tp=null;refresh(c);return true};

/* ---------- パネル ---------- */
const E=id=>document.getElementById(id);
function syncOp(c){const l=BL.on(c)?act(c):null,r=E('bly_op'),n=E('bly_opn');if(!r)return;const v=l?Math.round(l.o*100):100;
if(document.activeElement!==r)r.value=v;if(document.activeElement!==n)n.value=v;r.disabled=n.disabled=!l}
function thumbs(c){const w=E('bly');if(!w||!BL.on(c))return;const m=new Map(c.ly.L.map(l=>[l.id,l]));
w.querySelectorAll('.bl').forEach(r=>{const l=m.get(r.dataset.id),t=r.querySelector('canvas');if(!l||!t)return;const x=t.getContext('2d');x.clearRect(0,0,t.width,t.height);x.imageSmoothingQuality='medium';x.drawImage(l.cv,0,0,t.width,t.height)})}
let LK=null;
function build(){const wrap=E('bly_wrap');if(!wrap)return;const c=C();wrap.hidden=!c||c.k!='b';if(wrap.hidden)return;
const on=BL.on(c);E('bly_off').hidden=on;E('bly_on').hidden=!on;if(!on){LK=null;return}
const A=act(c),L=c.ly.L,i=L.indexOf(A);
E('bly_up').disabled=i>=L.length-1;E('bly_dn').disabled=i<1;E('bly_dl').disabled=L.length<2;syncOp(c);
const key=[ci,A.id,...L.map(l=>[l.id,l.n,l.v?1:0,l.lk?1:0].join(':'))].join('|');
if(key!==LK){LK=key;const e=E('bly');e.innerHTML='';
for(let k=L.length-1;k>=0;k--){const l=L[k],r=document.createElement('div');r.className='lr bl'+(l.id===A.id?' on':'')+(l.v?'':' hd');r.dataset.id=l.id;r.draggable=true;r.setAttribute('role','button');r.setAttribute('aria-pressed',l.id===A.id);
r.title=l.n+(l.lk?'(ロック中)':'')+(l.v?'':'(非表示)');
r.innerHTML=`<button type="button" class="bv" title="表示/非表示" aria-label="表示/非表示">${ic(l.v?'eye':'eyeoff',16)}</button><button type="button" class="bk" title="ロック/解除" aria-label="ロック/解除">${ic(l.lk?'lock':'unlock',16)}</button><canvas width="28" height="21"></canvas><span>${esc(l.n)}</span>`;
const[b1,b2]=r.querySelectorAll('button');
b1.onclick=ev=>{ev.stopPropagation();toggle(l.id,'v')};b2.onclick=ev=>{ev.stopPropagation();toggle(l.id,'lk')};
r.onclick=()=>pick(l.id);r.ondblclick=()=>rename(l.id);
r.ondragstart=ev=>{ev.dataTransfer.setData('text/plain',l.id);LD=l.id};r.ondragover=ev=>{ev.preventDefault();r.classList.add('dr')};r.ondragleave=()=>r.classList.remove('dr');
r.ondrop=ev=>{ev.preventDefault();r.classList.remove('dr');if(LD)moveTo(LD,L.indexOf(l));LD=null};
e.append(r)}}
thumbs(c)}
let LD=null;
BL.sync=build;
BL.fin=()=>{const c=C();if(c&&BL.on(c)){refresh(c);thumbs(c)}};
function wire(){const g=E('bly_wrap');if(!g||wire.d)return;wire.d=1;
E('bly_use').onclick=useLayers;E('bly_add').onclick=add;E('bly_dp').onclick=dup;E('bly_dl').onclick=del;E('bly_up').onclick=()=>move(1);E('bly_dn').onclick=()=>move(-1);
E('bly_rn').onclick=()=>rename();E('bly_mg').onclick=mergeMenu;E('bly_sp').onclick=split;
const r=E('bly_op'),n=E('bly_opn');
r.addEventListener('input',()=>{n.value=r.value;opacity(r.value,false)});r.addEventListener('change',()=>opacity(r.value,true));
n.addEventListener('input',()=>{if(n.value==='')return;opacity(n.value,false)});n.addEventListener('change',()=>{const c=C();opacity(n.value===''?(BL.on(c)?act(c).o*100:100):n.value,true);syncOp(C())})}
BL.wire=wire;
BL.api={add,dup,del,rename,move,moveTo,toggle,pick,opacity,mergeDown,mergeVisible,flatten,split,useLayers};/* 動作確認(テスト)用 */
if(document.readyState!='loading')wire();else document.addEventListener('DOMContentLoaded',wire);
})();
