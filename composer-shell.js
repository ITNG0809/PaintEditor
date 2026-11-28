/* bgm-shell.js — otamesi 由来の機能(音源設定 / 音源ブラウザ / ファイル保存)を、
   元のBGMの画面構成(ウィンドウなし)のまま動かすための小さな接続層。
   ・音源設定は、BGM標準のダイアログ風パネルで開く(フローティングウィンドウ・タスクバーは使わない)
   ・instrument.js が使う window.BGMNotpcLMMSUI の最小限の互換実装を提供する */
(()=>{
'use strict';
if(typeof S==='undefined'||typeof EMBED_AUTO==='undefined'||EMBED_AUTO)return;
const $=s=>document.querySelector(s);

/* ---- 音源設定ダイアログ ---- */
function makeWindow(el,{title,subtitle,closeAction}={}){
  const ov=document.createElement('div');ov.className='bgmdlg-ov';ov.hidden=true;
  const dlg=document.createElement('div');dlg.className='bgmdlg';dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');
  const bar=document.createElement('div');bar.className='bgmdlg-bar';
  bar.innerHTML='<strong></strong><small></small><span class="sp"></span><button type="button" class="bgmdlg-x" aria-label="閉じる" title="閉じる(Esc)">✕</button>';
  bar.querySelector('strong').textContent=title||'';bar.querySelector('small').textContent=subtitle||'';
  dlg.appendChild(bar);dlg.appendChild(el);ov.appendChild(dlg);document.body.appendChild(ov);
  const onKey=e=>{if(e.key==='Escape'&&!ov.hidden)close()};
  function close(){document.removeEventListener('keydown',onKey);if(closeAction)closeAction();ov.remove()}
  bar.querySelector('.bgmdlg-x').onclick=close;
  ov.addEventListener('pointerdown',e=>{if(e.target===ov)close()});
  document.addEventListener('keydown',onKey);
  return {el,bar,restore(){ov.hidden=false}};
}
window.BGMNotpcLMMSUI={makeWindow,syncWindowButtons(){},restoreEffects(){},restoreSF2Library(){}};

/* ---- EditorS(親ページ)との連携: 画面を離れるとき再生を止める ---- */
addEventListener('message',e=>{
  if(e.source!==window.parent||window.parent===window)return;
  const m=e.data;if(!m||typeof m!=='object'||m.ns!=='editors-composer'||m.v!==1)return;
  if(m.type==='hide'){try{if(playing)pause(true);if(RP&&RP.playing)rollHalt(true)}catch(_){}}
  else if(m.type==='show'){try{if(ctx&&ctx.state==='suspended')ctx.resume()}catch(_){}}
});

/* ---- ファイル保存/読み込み(.bgmnp): ヘッダーのボタンから ---- */
const IO=()=>window.BGMProjectIO;
/* 元のBGM-notpcでは $('save') と書かれており(querySelectorなのでid指定の # が無く)、ボタンが反応しなかったため # を付けて直した */
if($('#save'))$('#save').onclick=()=>IO().save();
if($('#saveAs'))$('#saveAs').onclick=()=>IO().saveAs();
if($('#openP'))$('#openP').onclick=()=>IO().open();
addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&(e.key||'').toLowerCase()==='s'){e.preventDefault();e.shiftKey?IO().saveAs():IO().save()}
});

/* ---- 左の欄: 音源(内蔵シンセ / SoundFont)ブラウザの表示切り替え ---- */
const aact=$('aside .aact'),ibr=$('#ibr');
if(aact&&ibr){
  const q=document.createElement('input');q.id='lmmsBrowserSearch';q.type='search';q.placeholder='音源を検索…';q.setAttribute('aria-label','音源を検索');q.className='ibsearch';
  ibr.parentNode.insertBefore(q,ibr);
  const b=document.createElement('button');b.id='ibToggle';b.className='ib lbl';b.setAttribute('data-tip','音源(内蔵シンセ / SoundFont)を探して、選択中のトラックに割り当て');b.setAttribute('aria-label','音源ブラウザ');
  b.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-folder"/></svg><span class="lb">音源</span>';
  aact.appendChild(b);
  const show=on=>{ibr.hidden=!on;q.hidden=!on;b.classList.toggle('on',on);if(on){try{window.BGMInst&&window.BGMInst.refreshBrowser()}catch(_){}q.scrollIntoView({block:'nearest'})}};
  b.onclick=()=>show(ibr.hidden);show(false);
}
})();
