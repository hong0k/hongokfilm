const $ = (id) => document.getElementById(id);
const canvas = $('result');
const ctx = canvas.getContext('2d');
const fourBoxes = [ [60,160], [620,160], [60,800], [620,800] ].map(([x,y]) => ({x,y,w:520,h:610}));
let boxes=fourBoxes;
const wideBoxes=[{x:100,y:290,w:1000,h:470},{x:100,y:840,w:1000,h:470}];
const activePhotos=()=>photos.slice(0,boxes.length);
const photos = Array(4).fill(null);
const customPoses = Array(4).fill(null);
let selected = 0, mode = 'together', frame = 'basic', basicStyle = 'white', character = 0, config, stream, facing = 'user', busy = false, cameraVersion = 0, captureVersion = 0;
const assets = new Map(), assetLoads = new Map(), failedAssets = new Map();
const status = (message) => { $('status').textContent = message; };
function imageFrom(url) { return new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('이미지를 불러오지 못했어요.')); image.src = url; }); }
function cover(image,w,h) { return Math.max(w/image.naturalWidth,h/image.naturalHeight); }
// Redraws are batched to one per frame; the timer covers browsers that pause animation frames.
let drawRequest=false,drawFrame=0,drawTimer=0;
function scheduleDraw(){
  if(drawRequest)return;drawRequest=true;
  const run=()=>{if(!drawRequest)return;drawRequest=false;cancelAnimationFrame(drawFrame);clearTimeout(drawTimer);draw();};
  drawFrame=requestAnimationFrame(run);drawTimer=setTimeout(run,100);
}
// Images load only when a frame or character needs them, so the first visit stays light.
function requestAsset(path){
  if(!path)return Promise.resolve(null);
  if(assets.has(path))return Promise.resolve(assets.get(path));
  if(assetLoads.has(path))return assetLoads.get(path);
  const attempts=(failedAssets.get(path)?.attempts??0)+1;failedAssets.delete(path);
  const load=imageFrom(new URL(path,document.baseURI).href)
    .then(image=>{assets.set(path,image);return image;})
    .catch(()=>{failedAssets.set(path,{time:Date.now(),attempts});status('일부 이미지를 불러오지 못해 다시 시도하고 있어요. 계속되면 페이지를 새로고침해주세요.');if(attempts<3)setTimeout(()=>{scheduleDraw();if(!$('gallery-view').hidden)renderGallery();},3200);return null;})
    .finally(()=>{assetLoads.delete(path);scheduleDraw();if(!$('gallery-view').hidden)renderGallery();});
  assetLoads.set(path,load);return load;
}
// A failed image is retried on the next redraw a few seconds later (e.g. after a brief network drop).
function asset(path){if(!path)return undefined;const image=assets.get(path);const failed=failedAssets.get(path);if(!image&&(!failed||(failed.attempts<3&&Date.now()-failed.time>3000)))requestAsset(path);return image;}
// Large uploads are reduced once; output is 1200px wide, so 2400px keeps full detail and saves phone memory.
function fitUpload(image,max=2400){
  const w=image.naturalWidth,h=image.naturalHeight,scale=Math.min(1,max/Math.max(w,h));
  if(scale===1)return image;
  const c=document.createElement('canvas');c.width=Math.round(w*scale);c.height=Math.round(h*scale);
  c.getContext('2d').drawImage(image,0,0,c.width,c.height);c.naturalWidth=c.width;c.naturalHeight=c.height;return c;
}
// Canvas ctx.filter is off in iOS Safari, so colour effects are applied to pixels instead.
// The same result is produced on every browser and cached per image, which also keeps dragging smooth.
const filterCache=new WeakMap();
function colorSpec(){
  if(frame==='basic'&&basicStyle==='mono')return {key:'gray',gray:true};
  if(frame==='miniroom'){const a=Math.round(Number($('softness').value)/5)*5/100;if(a>0)return {key:'soft'+a,b:1+a*.13,c:1-a*.20,s:1-a*.22};}
  return null;
}
function filtered(image,spec){
  if(!spec||!image)return image;
  let cache=filterCache.get(image);if(!cache){cache=new Map();filterCache.set(image,cache);}
  if(cache.has(spec.key))return cache.get(spec.key);
  const w=image.naturalWidth,h=image.naturalHeight,out=document.createElement('canvas');out.width=w;out.height=h;
  const c=out.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);
  const pixels=c.getImageData(0,0,w,h),d=pixels.data;
  const clamp=v=>v<0?0:v>255?255:v;
  if(spec.gray){
    for(let i=0;i<d.length;i+=4){const l=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];d[i]=d[i+1]=d[i+2]=l;}
  }else{
    const s=spec.s,m=[.213+.787*s,.715-.715*s,.072-.072*s,.213-.213*s,.715+.285*s,.072-.072*s,.213-.213*s,.715-.715*s,.072+.928*s];
    for(let i=0;i<d.length;i+=4){
      const r=clamp((clamp(d[i]*spec.b)-127.5)*spec.c+127.5),g=clamp((clamp(d[i+1]*spec.b)-127.5)*spec.c+127.5),bl=clamp((clamp(d[i+2]*spec.b)-127.5)*spec.c+127.5);
      d[i]=m[0]*r+m[1]*g+m[2]*bl;d[i+1]=m[3]*r+m[4]*g+m[5]*bl;d[i+2]=m[6]*r+m[7]*g+m[8]*bl;
    }
  }
  c.putImageData(pixels,0,0);out.naturalWidth=w;out.naturalHeight=h;
  if(cache.size>=3)cache.delete(cache.keys().next().value);
  cache.set(spec.key,out);return out;
}
// Soft-focus for the Cyworld frame: a small down-and-up resample, which works without ctx.filter.
let softenCanvas;
function softenBox(c,b,amount){
  if(amount<=0)return;
  const factor=1+amount*.6,w=Math.max(1,Math.round(b.w/factor)),h=Math.max(1,Math.round(b.h/factor));
  softenCanvas??=document.createElement('canvas');softenCanvas.width=w;softenCanvas.height=h;
  const s=softenCanvas.getContext('2d');s.imageSmoothingQuality='high';s.drawImage(c.canvas,b.x,b.y,b.w,b.h,0,0,w,h);
  c.save();c.imageSmoothingQuality='high';c.drawImage(softenCanvas,0,0,w,h,b.x,b.y,b.w,b.h);c.restore();
}
function drawPhoto(photo,b,index,spec) {
  const area=b,image=filtered(photo.image,spec);
  const s=cover(image,area.w,area.h)*photo.zoom;
  const iw=image.naturalWidth*s,ih=image.naturalHeight*s;
  const limitX=(iw+area.w)/2-24,limitY=(ih+area.h)/2-24;
  photo.x=Math.max(-limitX,Math.min(limitX,photo.x));
  photo.y=Math.max(-limitY,Math.min(limitY,photo.y));
  ctx.save();ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();
  ctx.translate(area.x+area.w/2+photo.x,area.y+area.h/2+photo.y);ctx.rotate(photo.rotation??0);ctx.scale(photo.mirror?-1:1,1);ctx.drawImage(image,-iw/2,-ih/2,iw,ih);ctx.restore();
}
function editable(){return $('edit-layer').value==='character'&&character==='custom'&&mode==='together'?customPoses[selected]:photos[selected];}
function drawCustomPose(pose,b,c=ctx,spec=null){
  const wide=frame==='miniroom',image=filtered(pose.image,spec);
  const fillWide=wide&&$('character-fit').value==='cover';
  const scale=(fillWide?Math.max(b.w*.5/image.naturalWidth,b.h/image.naturalHeight):Math.min(b.w*(wide?.5:.48)/image.naturalWidth,b.h*(wide?1:.93)/image.naturalHeight))*pose.zoom;
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  c.save();c.beginPath();c.rect(wide?b.x+b.w*.5:b.x,b.y,wide?b.w*.5:b.w,b.h);c.clip();
  c.translate(b.x+b.w*(wide?.75:.76)+pose.x,(fillWide?b.y+h/2:b.y+b.h-h/2)+pose.y);c.rotate(pose.rotation??0);c.scale(pose.mirror?-1:1,1);
  c.drawImage(image,-w/2,-h/2,w,h);c.restore();
}
function registeredPosePath(index,characterIndex=character,frameName=frame){
  if(characterIndex==='custom')return null;
  const entry=config?.characters[characterIndex];
  const set=entry?.pose_sets?.[frameName]??entry?.pose_sets?.[frameName==='halloween'?'halloween':'basic'];
  return set?.length?set[index%set.length]:entry?.poses?.[index];
}
function registeredPose(index){return asset(registeredPosePath(index));}
// Every image the current preview needs; saving waits until all of them are ready.
function neededAssets(){
  if(!config)return [];
  const theme=document.documentElement.dataset.theme||'lime',halloweenTheme=['cyworld','simple'].includes(theme)?'pink':theme;
  const list=[frame==='halloween'?config.backgrounds?.halloween?.[halloweenTheme]:config.backgrounds?.[frame]];
  if(frame==='halloween'&&halloweenTheme==='pink')list.push(config.decoration_sources?.pink);
  if(frame==='miniroom')list.push(config.decoration_sources?.cyworld_tape);
  if(mode==='together')boxes.forEach((_,i)=>list.push(registeredPosePath(i)));
  return list.filter(path=>path&&typeof path==='string');
}
const assetsReady=()=>neededAssets().every(path=>assets.has(path)||failedAssets.has(path));
function drawRegisteredPose(image,b,c=ctx,index=selected){
  if(['basic','miniroom'].includes(frame)&&config?.characters[character]?.id==='kim'){
    const wide=frame==='miniroom',poseIndex=wide?(index===0?0:3):index;
    const left=wide?index===0:[0,2].includes(index);
    const [sx,sy,sw,sh]=[[0,0,1216,832],[307,21,586,811],[323,1,570,831],[118,44,985,763]][poseIndex];
    const basicScales=[Math.min(b.w*.95/sw,b.h*.76/sh),b.h*.80/sh,b.h*.78/sh,Math.min(b.w*.95/sw,b.h*.62/sh)];
    const scale=wide?Math.min(b.w*.62/sw,b.h*.96/sh):basicScales[index];
    const w=sw*scale,h=sh*scale;
    c.save();c.beginPath();c.rect(b.x,b.y,b.w,b.h);c.clip();
    const x=left?b.x:b.x+b.w-w;
    const transparentInset=!wide&&index===0?198*scale:0;
    // Pose 4's artwork ends in a slanted cut (bottom 773–805px). Hide that cut below the slot edge
    // while keeping the same size, so no empty strip shows under the torso.
    const visible=poseIndex===3?726:sh,vh=visible*scale;
    c.drawImage(image,sx,sy,sw,visible,x-transparentInset,b.y+b.h-vh,w,vh);c.restore();return;
  }
  if(frame==='miniroom'&&config?.characters[character]?.id==='han'){
    // Wide frame: black-hair Han on the left of the top slot, silver Han on the right of the bottom slot.
    // Both are upper-body close-ups: only the head-to-waist band of each artwork is drawn, filling the
    // slot height, so the artwork's own bottom cut never shows inside the slot.
    const left=index===0,band=left?1120:980,sh=Math.min(band,image.naturalHeight);
    const scale=b.h*.98/sh,w=image.naturalWidth*scale,h=sh*scale;
    c.save();c.beginPath();c.rect(left?b.x:b.x+b.w/2,b.y,b.w/2,b.h);c.clip();
    c.drawImage(image,0,0,image.naturalWidth,sh,b.x+b.w*(left?.25:.75)-w/2,b.y+b.h-h,w,h);c.restore();return;
  }
  if(frame==='miniroom'&&config?.characters[character]?.id==='min'){
    const left=index===1;
    const scale=Math.max(b.w*.5/image.naturalWidth,b.h/image.naturalHeight);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    c.save();c.beginPath();c.rect(b.x+(left?0:b.w*.5),b.y,b.w*.5,b.h);c.clip();
    c.drawImage(image,left?b.x:b.x+b.w-w,b.y+14,w,h);c.restore();return;
  }
  if((['basic','miniroom'].includes(frame)&&config?.characters[character]?.id==='min')||(frame==='basic'&&['ok','han'].includes(config?.characters[character]?.id))){
    const left=config?.characters[character]?.id==='min'&&(frame==='miniroom'?index===1:index===3);
    const height=Math.min(b.h*.90,b.w*.78*1216/1000);
    const scale=config?.characters[character]?.id==='han'&&index===0?Math.min(height/image.naturalHeight,b.w*.85/image.naturalWidth):height/image.naturalHeight;
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    c.save();c.beginPath();c.rect(b.x,b.y,b.w,b.h);c.clip();
    const x=config?.characters[character]?.id==='han'&&index===0?b.x+b.w-w:b.x+b.w*(left?.40:.74)-w/2;
    c.drawImage(image,x,b.y+b.h-h,w,h);c.restore();return;
  }
  const width=b.w/2;
  const scale=Math.max(width/image.naturalWidth,b.h/image.naturalHeight);
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  c.save();c.beginPath();c.rect(b.x+width,b.y,width,b.h);c.clip();
  const focus=frame==='halloween'&&config?.characters[character]?.id==='han'?({2:.30,3:.44}[index]):undefined;
  const offset=focus===undefined?(width-w)/2:Math.max(width-w,Math.min(0,width/2-w*focus));
  c.drawImage(image,b.x+width+offset,b.y,w,h);c.restore();
}
function updateCharacterUI(){
  const custom=character==='custom';
  $('custom-character').setAttribute('aria-pressed',String(custom));
  $('library-character').setAttribute('aria-pressed',String(!custom));
  $('characters').hidden=custom;
  $('custom-panel').hidden=!custom;
  $('wide-fit-label').hidden=frame!=='miniroom';
  $('edit-layer-label').hidden=!custom||mode!=='together';
  if(!custom||mode!=='together')$('edit-layer').value='photo';
  [...$('characters').children].forEach((b,j)=>{b.classList.toggle('active',j===character);b.setAttribute('aria-pressed',String(j===character));});
  $('custom-progress').textContent=`캐릭터 ${customPoses.slice(0,boxes.length).filter(Boolean).length} / ${boxes.length}칸 · 선택한 칸 ${selected+1}`;
  $('repeat-character').disabled=!customPoses[selected];
}
// Keep original artwork untouched. Isolate the existing bright corner ornaments
// from the earlier decorated source once, excluding its regenerated title/background.
let pinkOrnaments;
function drawPinkDecorations(c=ctx){
  const source=asset(config?.decoration_sources?.pink);
  if(source&&!pinkOrnaments){
    pinkOrnaments=document.createElement('canvas');
    pinkOrnaments.width=source.naturalWidth;pinkOrnaments.height=source.naturalHeight;
    const mask=pinkOrnaments.getContext('2d');mask.drawImage(source,0,0);
    const pixels=mask.getImageData(0,0,pinkOrnaments.width,pinkOrnaments.height);
    for(let y=0;y<pinkOrnaments.height;y++)for(let x=0;x<pinkOrnaments.width;x++){
      const i=(y*pinkOrnaments.width+x)*4;
      const nx=x/pinkOrnaments.width,ny=y/pinkOrnaments.height;
      const corner=(ny<0.135&&(nx<0.17||nx>0.86))||(ny>0.875&&(nx<0.20||nx>0.80));
      const bright=pixels.data[i]>195&&pixels.data[i+1]>70&&pixels.data[i+2]>125;
      if(!corner||!bright)pixels.data[i+3]=0;
    }
    mask.putImageData(pixels,0,0);
  }
  // Muted wallpaper is a separate layer, below photos and outside the title band.
  c.save();c.beginPath();c.rect(0,160,1200,1250);c.clip();
  c.fillStyle='#b76b91';c.globalAlpha=0.14;
  const bat=new Path2D('M-100 12 Q-85-35-110-55 Q-48-54-15-8 L-7-26 0-16 7-26 15-8 Q48-54 110-55 Q85-35 100 12 Q65-4 47 25 Q20 9 0 50 Q-20 9-47 25 Q-65-4-100 12Z');
  for(const [x,y,scale,angle] of [[80,285,1.5,-.3],[1090,430,1.5,.25],[535,720,1.4,-.2],[55,1010,1.4,.1],[1110,1180,1.5,-.2]]){
    c.save();c.translate(x,y);c.rotate(angle);c.scale(scale,scale);c.fill(bat);c.restore();
  }
  const cross=new Path2D('M-12-90 L0-106 12-90 12-28 48-28 64-12 48 4 12 4 12 100 0 117-12 100-12 4-48 4-64-12-48-28-12-28Z');
  for(const [x,y,angle] of [[470,360,0],[1070,740,.25],[710,1040,.2],[190,1260,-.2]]){
    c.save();c.translate(x,y);c.rotate(angle);c.fill(cross);c.restore();
  }
  c.restore();
  if(pinkOrnaments)c.drawImage(pinkOrnaments,0,0,1200,1560);
}
const basicPalettes={
  white:{paper:'#ffffff',ink:'#1b1b1b',muted:'#666666',slot:'#efefef'},
  black:{paper:'#111111',ink:'#f5f5f1',muted:'#c4c4c0',slot:'#303030'},
  mono:{paper:'#deddd9',ink:'#272727',muted:'#585858',slot:'#c3c3c0'}
};
function drawBasicHeader(){
  const p=basicPalettes[basicStyle];ctx.fillStyle=p.ink;
  ctx.textAlign='center';ctx.font=basicStyle==='white'?'bold 48px Georgia,serif':basicStyle==='black'?'bold 43px sans-serif':'italic 46px Georgia,serif';
  ctx.save();ctx.textBaseline='alphabetic';const titleTop=ctx.measureText('HONGOK FILM').actualBoundingBoxAscent;ctx.fillText('HONGOK FILM',600,60+titleTop);ctx.restore();
  ctx.strokeStyle=basicStyle==='black'?'#555555':'#aeaeaa';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(60,133);ctx.lineTo(1140,133);ctx.stroke();
}
function drawBasicDetails(){
  const p=basicPalettes[basicStyle];
  function text(value,x,size=12){ctx.font=`bold ${size+2}px monospace`;ctx.fillStyle=p.muted;ctx.fillText(value,x,0);}
  function marker(x,number){
    ctx.fillStyle=p.ink;ctx.beginPath();ctx.moveTo(x,-3);ctx.lineTo(x+12,0);ctx.lineTo(x,3);ctx.closePath();ctx.fill();
    text(number,x+19,11);
  }
  // Sparse film-stock captions and frame counters, without barcode-like decoration.
  ctx.save();ctx.translate(30,785);ctx.rotate(-Math.PI/2);ctx.textAlign='left';ctx.textBaseline='middle';
  text(basicStyle==='mono'?'MONO FILM 400':'COLOR FILM 400',-520,11);
  marker(-130,'21');text('21A',360,12);
  ctx.restore();
  ctx.save();ctx.translate(1170,785);ctx.rotate(Math.PI/2);ctx.textAlign='left';ctx.textBaseline='middle';
  text('22A',-555,12);text(basicStyle==='mono'?'MONO FILM 400':'COLOR FILM 400',-85,11);
  marker(470,'22');
  ctx.restore();
  if(basicStyle==='mono'){
    ctx.strokeStyle='#a2a29e';ctx.lineWidth=2;
    boxes.forEach(b=>ctx.strokeRect(b.x-4,b.y-4,b.w+8,b.h+8));
  }
  ctx.textAlign='center';
}
function cyworldFilter(){
  const amount=Number($('softness').value)/100;
  return amount===0?'none':`brightness(${1+amount*.13}) contrast(${1-amount*.20}) saturate(${1-amount*.22}) blur(${amount*.65}px)`;
}
function drawMiniroomHeader(){
  ctx.fillStyle='#fffdfb';ctx.fillRect(0,0,1200,1560);
  ctx.textAlign='center';ctx.fillStyle='#8b7f7f';ctx.font='24px "Hongok Hand",sans-serif';
  ctx.fillText('ⓛⓞⓥⓔ  ⓨⓞⓤ  ·  그때 그 감성',600,63);
  ctx.fillStyle='#51484b';ctx.font='49px "Hongok Hand",sans-serif';
  ctx.fillText('너랑 찍은 오늘, 즐겨찾기..♡',600,139);
  ctx.fillStyle='#a5969a';ctx.font='26px "Hongok Hand",sans-serif';
  ctx.fillText('그 시절, 우린 주인공이었지',600,198);
  ctx.fillStyle='#b6aaad';ctx.font='14px monospace';ctx.fillText('HONGOK FILM  /  LOVE STORY',600,248);
  ctx.strokeStyle='#e5dce0';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(480,223);ctx.lineTo(720,223);ctx.stroke();
  ctx.fillStyle='#b6a3ad';ctx.font='40px "Hongok Hand",sans-serif';
  ctx.fillText('♡',50,525);ctx.fillText('˚',1150,525);ctx.fillText('˚',50,1075);ctx.fillText('♡',1150,1075);
}
function drawMiniroomDetails(){
  ctx.strokeStyle='#e2dcdf';ctx.lineWidth=1;
  boxes.forEach((b,i)=>{
    ctx.strokeRect(b.x-1,b.y-1,b.w+2,b.h+2);
    ctx.textAlign='left';ctx.fillStyle='#a4969d';ctx.font='20px "Hongok Hand",sans-serif';ctx.fillText(String(i+1).padStart(2,'0')+'。',b.x,b.y+b.h+34);
    ctx.textAlign='center';ctx.fillStyle='#857780';ctx.font='29px "Hongok Hand",sans-serif';
    ctx.fillText(i===0?'남푠♡마누라 – 바람피면 주거 ㅋㅋ':'우리의 이야기는 아직 진행 중。',600,b.y+b.h+40);
  });
  ctx.textAlign='center';ctx.fillStyle='#b2a3ad';ctx.font='24px "Hongok Hand",sans-serif';ctx.fillText('┌  오늘의 우리를, 오래오래 기억할게  ┘',600,1413);
  const tape=asset(config?.decoration_sources?.cyworld_tape);
  if(tape){
    for(const [x,y,angle] of [[1050,290,.18],[150,1310,.30]]){
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=.82;
      const h=190*tape.naturalHeight/tape.naturalWidth;
      ctx.drawImage(tape,-95,-h/2,190,h);ctx.restore();
    }
  }
}
// Empty-slot guide: a dashed figure showing where the photo (grey) and the character (purple)
// will go. Preview only; it is never part of a saved image.
// Halloween slots use a solid dark colour that sits in each theme's background, instead of light beige.
// Near-black slots at the brightness of the poster reference (#0e0c11), tinted per theme:
// lime = green-black, pumpkin = brown-black, pink = plum-black.
const halloweenSlot={lime:'#0e120c',pumpkin:'#150e0a',pink:'#150c12'};
// Halloween slot backdrop: the flat reference colour with a faint print grain (about 1%).
// The grain uses a fixed seed, so the preview and the saved image are identical.
let grainTile;
function grainPattern(c){
  if(!grainTile){
    grainTile=document.createElement('canvas');grainTile.width=grainTile.height=160;
    const g=grainTile.getContext('2d'),img=g.createImageData(160,160);let seed=20261028;
    const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<img.data.length;i+=4){const v=rand()<.5?0:255;img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=Math.round(rand()*6);}
    g.putImageData(img,0,0);
  }
  return c.createPattern(grainTile,'repeat');
}
function drawBackdrop(c,b,color){
  c.save();c.fillStyle=color;c.fillRect(b.x,b.y,b.w,b.h);
  c.translate(b.x,b.y);c.fillStyle=grainPattern(c);c.fillRect(0,0,b.w,b.h);c.restore();
}
// Photo-silhouette colours: grey on light slots, soft white on the dark Halloween slots.
const photoGuide=()=>frame==='halloween'?{fill:'#ffffff12',line:'#ffffff80',ink:'#ffffffc0'}:{fill:'#00000012',line:'#8f8a8c',ink:'#7d777a'};
function silhouetteGeometry(b,cx,scale=1){
  const wide=frame==='miniroom',half=Math.min(b.w*.5*.42,b.h*(wide?.25:.2))*scale;
  const archTop=b.y+b.h-b.h*(wide?.5:.42)*scale,r=half*.55,headY=archTop-r*1.35;
  return {cx,half,archTop,r,headY};
}
function drawSilhouette(c,b,side,label,spot){
  if(spot?.badge){
    const x=b.x+spot.cx,y=b.y+spot.cy,r=spot.r;
    const guide=photoGuide();c.save();c.setLineDash([Math.max(4,r*.16),Math.max(3,r*.11)]);c.lineWidth=Math.max(2,r*.06);c.fillStyle=guide.fill;c.strokeStyle=guide.line;
    c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.stroke();c.setLineDash([]);
    c.textAlign='center';c.textBaseline='middle';c.fillStyle=guide.ink;c.font=`bold ${Math.round(r*1.2)}px sans-serif`;c.fillText('?',x,y+r*.06);
    c.font=`bold ${Math.round(Math.max(20,r*.5))}px sans-serif`;c.fillText(label,x,y+r*1.6);c.restore();c.textBaseline='alphabetic';return;
  }
  const character=side==='right';
  const g=silhouetteGeometry(b,spot?b.x+spot.cx:b.x+b.w*(character?(frame==='miniroom'?.75:.74):(frame==='miniroom'?.25:.27)),spot?.scale??1);
  const {cx,half,archTop,r,headY}=g;
  const guide=photoGuide(),fill=character?'#ddd3e2':guide.fill,line=character?'#6b3f73':guide.line,ink=character?'#6b3f73':guide.ink;
  c.save();c.beginPath();c.rect(b.x,b.y,b.w,b.h);c.clip();
  c.setLineDash([Math.max(4,r*.16),Math.max(3,r*.11)]);c.lineWidth=Math.max(2,r*.06);c.fillStyle=fill;c.strokeStyle=line;
  c.beginPath();c.arc(cx,headY,r,0,Math.PI*2);c.fill();c.stroke();
  c.beginPath();c.moveTo(cx-half,b.y+b.h+4);c.lineTo(cx-half,archTop+half*.9);c.ellipse(cx,archTop+half*.9,half,half*.9,0,Math.PI,0);c.lineTo(cx+half,b.y+b.h+4);c.fill();c.stroke();
  c.setLineDash([]);c.textAlign='center';c.textBaseline='middle';c.fillStyle=ink;
  c.font=`bold ${Math.round(r*1.2)}px sans-serif`;c.fillText('?',cx,headY+r*.06);
  c.font=`bold ${Math.round(Math.max(20,Math.min(r*.5,half*.36)))}px sans-serif`;c.fillText(label,cx,spot?.peek?archTop+half*.55:b.y+b.h-Math.max(28,r*.65));
  c.restore();c.textBaseline='alphabetic';
}
// Every character pose sits differently, so the "내 사진" figure is placed where the drawn
// character leaves room: the pose is rendered into a small mask and the largest figure that
// fits without touching it is chosen (nearest to the usual left spot). Results are cached.
const silhouetteSpots=new Map();
function photoSilhouetteSpot(b,index){
  if(mode!=='together')return null;
  const custom=character==='custom',pose=custom?customPoses[index]:registeredPose(index);
  if(!pose)return null;
  const key=[frame,custom?'custom':character,index,b.w,b.h,custom?[Math.round(pose.x/20),Math.round(pose.y/20),pose.zoom.toFixed(1),(pose.rotation??0).toFixed(1),pose.mirror,$('character-fit').value].join(','):''].join('|');
  if(silhouetteSpots.has(key))return silhouetteSpots.get(key);
  if(silhouetteSpots.size>300)silhouetteSpots.clear();
  const k=.1,mw=Math.ceil(b.w*k),mh=Math.ceil(b.h*k),m=document.createElement('canvas');m.width=mw;m.height=mh;
  const mc=m.getContext('2d',{willReadFrequently:true});mc.scale(k,k);
  const local={x:0,y:0,w:b.w,h:b.h};
  if(frame==='miniroom'&&!['min','kim','han'].includes(config?.characters[character]?.id)){mc.beginPath();mc.rect(b.w/2,0,b.w/2,b.h);mc.clip();}
  try{if(custom)drawCustomPose(pose,local,mc);else drawRegisteredPose(pose,local,mc,index);}catch{return null;}
  const alpha=mc.getImageData(0,0,mw,mh).data,solid=[];
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++)if(alpha[(y*mw+x)*4+3]>40)solid.push([(x+.5)/k,(y+.5)/k]);
  const preferred=b.w*(frame==='miniroom'?.25:.27),pad=12;
  // peek=true only checks the head and top of the body: the figure stands behind the
  // character, whose artwork covers its lower half, and the label moves up under the head.
  const search=(scales,peek)=>{
    let best=null;
    for(const scale of scales){
      const half=silhouetteGeometry(local,0,scale).half;
      for(let cx=half+10;cx<=b.w-half-10;cx+=6){
        const g=silhouetteGeometry(local,cx,scale),bodyY=g.archTop+g.half*.9,limit=peek?g.archTop+g.half*1.1:Infinity;let hits=0;
        for(const [px,py] of solid){
          if(py>limit)continue;
          const head=Math.hypot(px-cx,py-g.headY)<g.r+pad;
          const body=py>=g.archTop-pad&&Math.abs(px-cx)<=g.half+pad&&(py>=bodyY||((px-cx)/(g.half+pad))**2+((py-bodyY)/(g.half*.9+pad))**2<=1);
          if(head||body){hits++;if(best&&hits>=best.hits)break;}
        }
        const distance=Math.abs(cx-preferred);
        if(!best||hits<best.hits||(hits===best.hits&&distance<best.distance))best={cx,scale,hits,distance,peek};
      }
      if(best?.hits===0)return best;
    }
    return best;
  };
  let best=search([1,.9,.8,.7,.6],false);
  if(best.hits>0){const peek=search([1,.9,.8,.7,.6],true);if(peek.hits===0)best=peek;}
  if(best.hits>0){
    // No standing room at all: fall back to a small badge (dashed head + label) in the
    // emptiest spot, so it never sits on top of the artwork.
    const r=Math.min(b.w,b.h)*.075,labelW=r*2.4;let badge=null;
    for(let y=r+12;y<=b.h-r*2.2-12;y+=8)for(let x=Math.max(r,labelW/2)+12;x<=b.w-Math.max(r,labelW/2)-12;x+=8){
      let hits=0;
      for(const [px,py] of solid){
        if(Math.hypot(px-x,py-y)<r+pad||(Math.abs(px-x)<labelW/2+pad&&py>y+r&&py<y+r*2.2+pad)){hits++;if(badge&&hits>=badge.hits)break;}
      }
      const distance=Math.hypot(x-preferred,y-b.h*.45);
      if(!badge||hits<badge.hits||(hits===badge.hits&&distance<badge.distance))badge={badge:true,cx:x,cy:y,r,hits,distance};
    }
    if(badge&&badge.hits<best.hits)best=badge;
  }
  silhouetteSpots.set(key,best);return best;
}
function draw(forExport=false) {
  ctx.fillStyle=frame==='halloween'?'#392342':basicPalettes[basicStyle].paper;ctx.fillRect(0,0,1200,1560);
  const theme=document.documentElement.dataset.theme||'lime';
  const halloweenTheme=['cyworld','simple'].includes(theme)?'pink':theme;
  const backgroundPath=frame==='halloween'?config?.backgrounds?.halloween?.[halloweenTheme]:config?.backgrounds?.[frame];
  const background=asset(backgroundPath);if(background){
    ctx.drawImage(background,0,0,1200,1560);
    const assetName=backgroundPath?.split('?')[0];
    const adjusted=['assets/background-01.webp','assets/background-02.webp'].includes(assetName);
    if(frame==='halloween'&&adjusted){
      // Map the entire decorative edge strip into each 60px gutter, with 4px inset.
      // Source art is wider than the gutter; scaling keeps complete objects visible.
      const iw=background.naturalWidth,ih=background.naturalHeight;
      if(assetName==='assets/background-01.webp'){
        for(const x of [10,1015])ctx.drawImage(background,x/1100*iw,750/1430*ih,75/1100*iw,1,x/1100*1200,665/1430*1560,75/1100*1200,85/1430*1560);
      }
      const sy=160/1560*ih,sh=1250/1560*ih,sw=90/1100*iw;
      for(const [sx,dx] of [[0,4],[iw-sw,1144]]){
        const cleanX=(sx===0?100:1000)/1100*iw;
        ctx.drawImage(background,cleanX,sy,1,sh,dx-4,160,60,1250);
        ctx.save();ctx.beginPath();ctx.rect(dx,160,52,1250);ctx.clip();
        ctx.drawImage(background,sx,sy,sw,sh,dx,160,52,1250);
        if(assetName==='assets/background-01.webp'){
          // Remove the skulls at their generated height before placing them at Y≈800.
          ctx.drawImage(background,sx,750/1430*ih,sw,1,dx,665/1430*1560,52,85/1430*1560);
        }
        ctx.restore();
      }
      if(assetName==='assets/background-01.webp'){
        ctx.drawImage(background,10/1100*iw,665/1430*ih,75/1100*iw,85/1430*ih,6,765,46,45);
        ctx.drawImage(background,1015/1100*iw,665/1430*ih,75/1100*iw,85/1430*ih,1148,765,46,45);
      }
    }
  }
  if(frame==='halloween'&&halloweenTheme==='pink')drawPinkDecorations();
  if(frame==='miniroom')drawMiniroomHeader();
  ctx.textAlign='center';ctx.fillStyle=frame==='halloween'?'#f7bf83':'#3e2e44';ctx.font='bold 32px sans-serif';if(frame==='basic')drawBasicHeader();
  const spec=colorSpec(),softness=frame==='miniroom'?Number($('softness').value)/100:0;
  ctx.save();
  boxes.forEach((b,i) => {
    if(frame==='halloween')drawBackdrop(ctx,b,halloweenSlot[halloweenTheme]);
    else {ctx.fillStyle=frame==='miniroom'?'#F7F5F1':basicPalettes[basicStyle].slot;ctx.fillRect(b.x,b.y,b.w,b.h);}
    if(photos[i]) drawPhoto(photos[i],b,i,spec);
    else if(mode==='together')drawSilhouette(ctx,b,'left','내 사진',photoSilhouetteSpot(b,i));
    else {ctx.fillStyle='#84758b';ctx.font='26px sans-serif';ctx.fillText(`＋ ${i+1}번째 사진`,b.x+b.w/2,b.y+b.h/2);}
    if(mode==='together') {
      ctx.save();
      if(frame==='miniroom'&&!['min','kim','han'].includes(config?.characters[character]?.id)){ctx.beginPath();ctx.rect(b.x+b.w/2,b.y,b.w/2,b.h);ctx.clip();}
      const posePath=registeredPosePath(i),pose=registeredPose(i);
      if(character==='custom'){
        if(customPoses[i])drawCustomPose(customPoses[i],b,ctx,spec);
        else if(!forExport)drawSilhouette(ctx,b,'right','캐릭터');
      } else
      if(pose) {drawRegisteredPose(filtered(pose,spec),b,ctx,i);}
      else if(posePath) {ctx.fillStyle='#84758b';ctx.font='18px sans-serif';ctx.fillText(failedAssets.has(posePath)?'캐릭터를 불러오지 못했어요 · 새로고침해주세요':'캐릭터 불러오는 중…',b.x+b.w*(failedAssets.has(posePath)?.5:.75),b.y+b.h-30);}
      else {
        ctx.save();ctx.beginPath();ctx.rect(b.x+b.w*(frame==='miniroom'?.5:.57),b.y,b.w*(frame==='miniroom'?.5:.43),b.h);ctx.clip();
        ctx.fillStyle='#bea9ca99';ctx.fillRect(b.x+b.w*(frame==='miniroom'?.5:.57),b.y,b.w*(frame==='miniroom'?.5:.43),b.h);
        ctx.fillStyle='#745b8655';ctx.beginPath();ctx.arc(b.x+b.w*.81,b.y+215,68,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(b.x+b.w*.81,b.y+480,125,180,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#55415e';ctx.font='bold 24px sans-serif';ctx.fillText(config?.characters[character].name??'',b.x+b.w*.79,b.y+b.h-70);ctx.font='16px sans-serif';ctx.fillText('캐릭터 준비 중',b.x+b.w*.79,b.y+b.h-38);ctx.restore();
      }
      ctx.restore();
    }
    if(softness>0){softenBox(ctx,b,softness);ctx.save();ctx.globalAlpha=softness*.10;ctx.fillStyle='#fff9f3';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.restore();}
    if(frame==='halloween') {ctx.fillStyle='#ffffff55';ctx.font='26px sans-serif';ctx.fillText(['✦','☾','☾','✦'][i],b.x+b.w-24,b.y+35);}
  });
  ctx.restore();if(frame==='basic')drawBasicDetails();if(frame==='miniroom')drawMiniroomDetails();
  const overlay=asset(config?.overlays?.[frame==='basic'?'together':frame]);if(overlay)ctx.drawImage(overlay,0,0,1200,1560);
  ctx.fillStyle=frame==='halloween'?(['cyworld','simple'].includes(theme)?'#cdbcc3':getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()||'#f4d5b3'):frame==='miniroom'?'#8d857b':basicPalettes[basicStyle].muted;ctx.font=frame==='miniroom'?'29px "Hongok Hand",sans-serif':'24px sans-serif';
  ctx.fillText($('caption').value.trim()||(forExport===true?'':'문구를 입력해주세요. (선택사항)'),600,1470,1080);
  ctx.font='16px sans-serif';ctx.fillText('HONGOK FILM  ·  '+new Date().toLocaleDateString('ko-KR'),600,1515);
  const count=activePhotos().filter(Boolean).length,ready=assetsReady();$('progress').textContent=`${count} / ${boxes.length}`;$('download').disabled=count!==boxes.length||busy||!ready;$('share').disabled=count!==boxes.length||busy||!ready;
  $('asset-status').hidden=ready;
  if($('camera-dialog').open)renderCameraCharacter();
}
function select(index) {
  selected=index;updateCharacterUI();
  document.querySelectorAll('.slot').forEach((el,i)=>{el.classList.toggle('active',i===index);el.setAttribute('aria-pressed',String(i===index));});
  const item=editable(), isCharacter=$('edit-layer').value==='character';
  $('selected-label').textContent=`${index+1}번째 ${isCharacter?'캐릭터':'사진'}`;
  $('remove').textContent=isCharacter?'이 캐릭터 지우기':'이 사진 지우기';
  $('zoom').min='0.3';$('zoom').disabled=!item;$('zoom').value=item?.zoom??1;
  $('zoom-value').textContent=Math.round(Number($('zoom').value)*100)+'%';
  $('mirror').checked=item?.mirror??false;$('mirror').disabled=!item;$('remove').disabled=!item;updateCameraLabel();
}

function buildSlots(){
  const container=$('slots');container.replaceChildren();
  const pointers=new Map();let gesture,suppressClickUntil=0;
  const baseline=()=>{
    const item=editable(),points=[...pointers.values()];
    if(!item||!points.length){gesture=null;return;}
    const a=points[0],b=points[1]??a;
    // The paper is tilted with CSS; map finger movement back into the un-tilted canvas.
    const transform=getComputedStyle(canvas.parentElement).transform,m=transform&&transform!=='none'?new DOMMatrix(transform):null;
    gesture={item,x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y),px:item.x,py:item.y,zoom:item.zoom,rotation:item.rotation??0,angle:Math.atan2(b.y-a.y,b.x-a.x),tilt:m?Math.atan2(m.b,m.a):0,scale:1200/(canvas.offsetWidth||canvas.getBoundingClientRect().width)};
  };
  boxes.forEach((b,i)=>{
    const el=document.createElement('button');el.className='slot';el.dataset.slot=String(i);
    el.style.cssText=`left:${b.x/12}%;top:${b.y/15.6}%;width:${b.w/12}%;height:${b.h/15.6}%`;
    el.setAttribute('aria-label',`${i+1}번째 사진 불러오기 또는 선택 및 위치 조정`);el.textContent=`${i+1}번째 사진`;
    // A tap on a slot without a photo always opens the photo picker, even while the character layer is being edited.
    el.onclick=()=>{if(Date.now()<suppressClickUntil)return;select(i);if(!photos[i]&&!busy)$('upload').click();};
    el.onkeydown=(e)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;select(i);if(!editable())return;e.preventDefault();editable().x+=e.key==='ArrowLeft'?-15:e.key==='ArrowRight'?15:0;editable().y+=e.key==='ArrowUp'?-15:e.key==='ArrowDown'?15:0;draw();};
    container.append(el);
  });
  container.onpointerdown=(e)=>{
    if(!pointers.size){const slot=e.target.closest('.slot');if(!slot)return;select(Number(slot.dataset.slot));}
    if(!editable())return;
    // Capture starts only once the finger moves, so a plain tap still reaches the slot as a click.
    e.preventDefault();
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
    if(pointers.size>1){suppressClickUntil=Date.now()+500;capture();}
    baseline();
  };
  container.onpointermove=(e)=>{
    if(!pointers.has(e.pointerId)||!gesture||editable()!==gesture.item)return;
    e.preventDefault();const point=pointers.get(e.pointerId);point.x=e.clientX;point.y=e.clientY;
    const points=[...pointers.values()],a=points[0],b=points[1]??a;
    const scale=gesture.scale,item=gesture.item,cos=Math.cos(gesture.tilt),sin=Math.sin(gesture.tilt);
    const sx=(a.x+b.x)/2-gesture.x,sy=(a.y+b.y)/2-gesture.y,dx=sx*cos+sy*sin,dy=-sx*sin+sy*cos;
    if(Math.hypot(point.x-point.startX,point.y-point.startY)>4||points.length>1){suppressClickUntil=Date.now()+500;capture();}
    item.x=gesture.px+dx*scale;item.y=gesture.py+dy*scale;
    if(points.length>1&&gesture.distance>0){
      item.zoom=Math.max(.3,Math.min(3,gesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance));
      const angle=Math.atan2(b.y-a.y,b.x-a.x)-gesture.angle;
      item.rotation=gesture.rotation+Math.atan2(Math.sin(angle),Math.cos(angle));
      $('zoom').value=item.zoom;$('zoom-value').textContent=Math.round(item.zoom*100)+'%';
    }
    scheduleDraw();
  };
  function capture(){for(const id of pointers.keys()){try{if(!container.hasPointerCapture(id))container.setPointerCapture(id);}catch{}}}
  const release=(e)=>{if(!pointers.delete(e.pointerId))return;baseline();};
  container.onpointerup=container.onpointercancel=container.onlostpointercapture=release;
}

buildSlots();
function setPhoto(image,index){photos[index]={image,x:0,y:0,zoom:1,mirror:false,rotation:0};}
$('upload').onchange=async(e)=>{
  const files=[...e.target.files];if(!files.length)return;
  const targets=[selected,...boxes.map((_,i)=>i).filter(i=>i!==selected&&!photos[i])];
  busy=true;draw();let loaded=0,failed=0;
  for(let j=0;j<Math.min(files.length,targets.length);j++){
    const url=URL.createObjectURL(files[j]);
    try{const image=fitUpload(await imageFrom(url));setPhoto(image,targets[j]);loaded++;}catch{failed++;}finally{URL.revokeObjectURL(url);}
  }
  busy=false;$('edit-layer').value='photo';select(selected);draw();e.target.value='';
  status(`${loaded}장의 사진을 추가했어요.${failed?' 읽을 수 없는 사진은 JPG·PNG·WebP로 변환해 다시 올려주세요.':''}${files.length>targets.length?' 빈 칸보다 많은 사진은 제외했어요.':''}`);
};
$('zoom').oninput=()=>{if(editable())editable().zoom=Number($('zoom').value);$('zoom-value').textContent=Math.round(Number($('zoom').value)*100)+'%';scheduleDraw();};
$('mirror').onchange=()=>{if(editable())editable().mirror=$('mirror').checked;draw();};
$('center').onclick=()=>{if(editable())Object.assign(editable(),{x:0,y:0,zoom:1,mirror:false,rotation:0});select(selected);draw();};
$('remove').onclick=()=>{if($('edit-layer').value==='character')customPoses[selected]=null;else photos[selected]=null;select(selected);draw();status('선택한 이미지를 지웠어요.');};
$('reset').onclick=()=>{if((photos.some(Boolean)||customPoses.some(Boolean))&&!window.confirm('추가한 사진·내 캐릭터·문구를 모두 지울까요?'))return;photos.fill(null);customPoses.fill(null);$('caption').value='';select(0);draw();status('새로운 추억을 시작해요.');};
$('caption').oninput=draw;
document.querySelectorAll('.mode').forEach(el=>el.onclick=()=>{mode=el.dataset.mode;document.querySelectorAll('.mode').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',String(b===el));});$('character-section').hidden=mode!=='together';$('camera-guide').hidden=mode!=='together';updateCharacterUI();select(selected);draw();updateCameraLabel();});
function selectFrame(nextFrame){
  frame=nextFrame;boxes=frame==='miniroom'?wideBoxes:fourBoxes;
  selected=Math.min(selected,boxes.length-1);buildSlots();select(selected);updateLayoutCopy();
  $('basic-style-panel').hidden=frame!=='basic';$('cyworld-options').hidden=frame!=='miniroom';
  document.querySelectorAll('.frame').forEach(b=>{const active=b.dataset.frame===frame;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  draw();updateCameraLabel();
}
function selectBasicStyle(style){
  basicStyle=style;
  document.querySelectorAll('[data-basic]').forEach(b=>{const active=b.dataset.basic===style;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('basic-style-note').textContent={white:'화이트 프레임 · 사진의 원래 색상을 유지해요.',black:'블랙 프레임 · 사진의 원래 색상을 유지해요.',mono:'모노크롬 프레임 · 사진과 캐릭터를 흑백으로 담아요.'}[basicStyle];
  draw();
}
document.querySelectorAll('.frame').forEach(el=>el.onclick=()=>selectFrame(el.dataset.frame));
document.querySelectorAll('[data-basic]').forEach(button=>button.onclick=()=>selectBasicStyle(button.dataset.basic));
function updateLayoutCopy(){
  const two=boxes.length===2;
  $('character-upload-note').innerHTML=`투명 PNG를 추천해요. 일반 이미지는 배경까지 표시됩니다.<br>1장을 올리면 ${two?'두':'네'} 칸에 적용하고, 여러 장은 순서대로 넣어요.`;
  $('photo-step-title').textContent=two?'두 장의 순간을 채워주세요':'네 장의 순간을 채워주세요';
  $('download').innerHTML=(two?'두컷 사진 저장하기':'사진 저장하기')+' <span>↓</span>';
  $('download-note').textContent=`사진 ${boxes.length}장을 채우면 고해상도 JPG 또는 PNG로 저장할 수 있어요.`;
  canvas.setAttribute('aria-label',two?'완성될 와이드 두컷 사진 미리보기':'완성될 네컷 사진 미리보기');
  document.querySelector('.preview-panel').setAttribute('aria-label',two?'두컷 미리보기':'네컷 미리보기');
}
$('character-fit').onchange=()=>{draw();};
$('softness').oninput=()=>{$('softness-value').textContent=$('softness').value+'%';scheduleDraw();};
function exportFormat(){const jpg=$('format').value==='jpg';return {extension:jpg?'jpg':'png',type:jpg?'image/jpeg':'image/png'};}
async function blob(type){
  // The export waits for the handwriting font and every image the frame uses.
  if(frame==='miniroom'){try{await document.fonts.load('29px "Hongok Hand"');}catch{}}
  await Promise.all(neededAssets().map(requestAsset));
  const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
  try{draw(true);output.getContext('2d').drawImage(canvas,0,0);}finally{draw();}
  return new Promise((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(new Error('이미지를 만들지 못했어요.')),type,0.95));
}
// Phones and in-app browsers (X, KakaoTalk, Instagram…) often ignore file downloads,
// so on touch devices the finished image is also shown for long-press saving.
const inAppBrowser=/KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER\(inapp|DaumApps|Twitter|BAND\/|everytimeApp|; wv\)/i.test(navigator.userAgent);
const touchDevice=matchMedia('(pointer: coarse)').matches;
let savedUrl,savedBlob,savedName;
function triggerDownload(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();}
function saveImage(image,name,report){
  if(savedUrl)URL.revokeObjectURL(savedUrl);
  savedBlob=image;savedName=name;savedUrl=URL.createObjectURL(image);
  if(!touchDevice&&!inAppBrowser){triggerDownload(savedUrl,name);report('이미지 저장을 요청했어요. 다운로드 폴더를 확인해주세요.');return;}
  $('save-image').src=savedUrl;
  $('save-share').hidden=!(navigator.canShare&&navigator.canShare({files:[new File([image],name,{type:image.type})]}));
  $('save-dialog').showModal();
  report('완성된 이미지를 길게 눌러 저장하거나, 아래 버튼을 이용해주세요.');
}
$('save-download').onclick=()=>{if(savedUrl)triggerDownload(savedUrl,savedName);};
$('save-share').onclick=async()=>{try{await navigator.share({files:[new File([savedBlob],savedName,{type:savedBlob.type})]});}catch(e){if(e.name!=='AbortError')$('save-help').textContent='공유하지 못했어요. 이미지를 길게 눌러 저장해주세요.';}};
$('save-close').onclick=()=>$('save-dialog').close();
$('download').onclick=async()=>{
  if($('download').disabled)return;$('download').disabled=true;
  try{const format=exportFormat();const image=await blob(format.type);saveImage(image,`hongokfilm-${frame==='basic'?basicStyle:frame}-${mode}-${Date.now()}.${format.extension}`,status);}
  catch{status('이미지 저장에 실패했어요. 다시 시도해주세요.');}
  finally{draw();}
};
function updateShare(){const format=exportFormat();$('share').hidden=!(navigator.canShare&&navigator.canShare({files:[new File([''],`photo.${format.extension}`,{type:format.type})]}));}
$('format').onchange=updateShare;updateShare();
$('share').onclick=async()=>{try{const format=exportFormat();const image=await blob(format.type);await navigator.share({files:[new File([image],`hongokfilm-photo.${format.extension}`,{type:format.type})]});}catch(e){if(e.name!=='AbortError')status('공유에 실패했어요. 이미지 저장을 이용해주세요.');}};
function renderCameraCharacter(){
  const preview=$('camera-character'), c=preview.getContext('2d'),box=boxes[selected];
  preview.width=box.w;preview.height=box.h;
  document.querySelector('.camera-stage').style.aspectRatio=`${box.w}/${box.h}`;
  c.clearRect(0,0,box.w,box.h);
  const monochrome=frame==='basic'&&basicStyle==='mono';
  const filter=monochrome?'grayscale(1)':frame==='miniroom'?cyworldFilter():'none';
  $('video').style.filter=filter;preview.style.filter=filter;
  const custom=mode==='together'&&character==='custom'&&customPoses[selected];
  const registered=mode==='together'?registeredPose(selected):null;
  preview.hidden=!custom&&!registered;
  $('camera-guide').hidden=mode!=='together'||Boolean(custom||registered);
  $('camera-range').hidden=mode!=='solo';
  if(custom)drawCustomPose(custom,{x:0,y:0,w:box.w,h:box.h},c);
  else if(registered)drawRegisteredPose(registered,{x:0,y:0,w:box.w,h:box.h},c);
}
function updateCameraLabel(){
  $('camera-label').textContent=`${selected+1}번째 사진 촬영 · ${mode==='together'?(character==='custom'?'내 캐릭터':(config?.characters[character]?.name??''))+'와 함께':'혼자 찍기'}`;
  renderCameraCharacter();
}
function stopStream(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;}
function closeCamera(){cameraVersion++;captureVersion++;stopStream();$('capture').disabled=true;$('countdown').textContent='';}
async function startCamera(){
  const version=++cameraVersion;stopStream();$('capture').disabled=true;$('camera-status').textContent='카메라를 연결하고 있어요…';
  if(!navigator.mediaDevices?.getUserMedia){$('camera-status').textContent='카메라는 HTTPS 또는 localhost에서 지원되는 브라우저가 필요해요. 사진 업로드도 사용할 수 있어요.';return;}
  try{
    const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:1440}},audio:false});
    if(version!==cameraVersion||!$('camera-dialog').open){next.getTracks().forEach(t=>t.stop());return;}
    stream=next;$('video').srcObject=stream;await $('video').play();if(version!==cameraVersion)return;
    $('capture').disabled=false;$('camera-status').textContent='준비됐어요. 촬영 버튼을 눌러주세요.';
  }catch(e){if(version!==cameraVersion)return;stopStream();$('camera-status').textContent=e.name==='NotAllowedError'?'카메라 권한이 필요해요. 브라우저 설정에서 허용하거나 사진을 업로드해주세요.':'카메라를 사용할 수 없어요. 다른 앱이 사용 중인지 확인하거나 사진을 업로드해주세요.';}
}
$('open-camera').onclick=()=>{updateCameraLabel();$('camera-dialog').showModal();renderCameraCharacter();startCamera();};
$('close-camera').onclick=()=>$('camera-dialog').close();$('camera-dialog').addEventListener('close',closeCamera);$('camera-dialog').addEventListener('cancel',closeCamera);
$('switch-camera').onclick=()=>{captureVersion++;$('countdown').textContent='';facing=facing==='user'?'environment':'user';startCamera();};
$('camera-mirror').onchange=()=>{$('video').style.transform=$('camera-mirror').checked?'scaleX(-1)':'none';};$('camera-mirror').onchange();
$('capture').onclick=async()=>{
  if(!stream)return;const version=++captureVersion;const target=selected;$('capture').disabled=true;$('switch-camera').disabled=true;
  try{
    for(let n=Number($('timer').value);n>0;n--){if(version!==captureVersion)return;$('countdown').textContent=n;await new Promise(resolve=>setTimeout(resolve,1000));}
    if(version!==captureVersion||!stream)return;$('countdown').textContent='';
    const video=$('video');if(!video.videoWidth)throw new Error('not ready');
    const shot=document.createElement('canvas');shot.width=boxes[target].w*2;shot.height=boxes[target].h*2;const c=shot.getContext('2d');
    const scale=Math.max(shot.width/video.videoWidth,shot.height/video.videoHeight);const w=video.videoWidth*scale,h=video.videoHeight*scale;
    if($('camera-mirror').checked){c.translate(shot.width,0);c.scale(-1,1);}c.drawImage(video,(shot.width-w)/2,(shot.height-h)/2,w,h);
    const image=await imageFrom(shot.toDataURL('image/png'));if(version!==captureVersion)return;setPhoto(image,target);$('edit-layer').value='photo';
    const visible=activePhotos();const next=visible.findIndex((p,i)=>i>target&&!p);select(next>=0?next:visible.findIndex(p=>!p)>=0?visible.findIndex(p=>!p):target);draw();
    if(activePhotos().every(Boolean)){$('camera-dialog').close();status('사진이 모두 준비됐어요! 사진을 조정하고 저장해주세요.');}
    else $('camera-status').textContent='촬영했어요! 다음 사진도 찍어주세요.';
  }catch{$('camera-status').textContent='촬영하지 못했어요. 카메라가 준비되면 다시 시도해주세요.';}
  finally{$('switch-camera').disabled=false;if(stream)$('capture').disabled=false;}
};
window.addEventListener('pagehide',closeCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('camera-dialog').open)$('camera-dialog').close();});
$('library-character').onclick=()=>{if(character==='custom')character=0;updateCharacterUI();select(selected);draw();};
$('custom-character').onclick=()=>{character='custom';$('edit-layer').value='character';updateCharacterUI();select(selected);draw();};
$('edit-layer').onchange=()=>select(selected);
async function uploadCharacter(event,singleSlot){
  const files=[...event.target.files];if(!files.length)return;
  busy=true;draw();let failed=0,loaded=0;
  for(let i=0;i<Math.min(files.length,singleSlot?1:boxes.length);i++){
    const url=URL.createObjectURL(files[i]);
    try{
      const image=fitUpload(await imageFrom(url));const pose={image,x:0,y:0,zoom:1,mirror:false,rotation:0};
      if(!singleSlot&&files.length===1)for(let j=0;j<4;j++)customPoses[j]={...pose};
      else customPoses[singleSlot?selected:i]=pose;
      loaded++;
    }catch{failed++;}finally{URL.revokeObjectURL(url);}
  }
  busy=false;event.target.value='';character='custom';$('edit-layer').value='character';select(selected);draw();
  status(`${loaded}개의 캐릭터 이미지를 불러왔어요.${failed?' 읽을 수 없는 파일은 JPG·PNG로 변환해주세요.':''}${files.length>boxes.length?' 칸 수보다 많은 이미지는 제외했어요.':''} 칸을 선택하고 드래그·확대로 위치를 맞춰주세요.`);
}
$('character-upload').onchange=e=>uploadCharacter(e,false);
$('pose-upload').onchange=e=>uploadCharacter(e,true);
$('repeat-character').onclick=()=>{
  if(!customPoses[selected])return;
  if(!window.confirm('선택한 캐릭터의 포즈·위치를 모든 칸에 적용할까요?'))return;
  const pose=customPoses[selected];for(let i=0;i<4;i++)customPoses[i]={...pose};select(selected);draw();status('선택한 캐릭터를 모든 칸에 적용했어요.');
};
async function init(){
  // The handwriting font loads in the background; the preview redraws once it arrives.
  document.fonts?.load('29px "Hongok Hand"').then(scheduleDraw,()=>{});
  try{
    const response=await fetch('./assets/frames.json?v=20261028.3');if(!response.ok)throw new Error('config');config=await response.json();
    config.characters.forEach((c,i)=>{const button=document.createElement('button');button.textContent=c.name;button.classList.toggle('active',i===character);button.setAttribute('aria-pressed',String(i===character));button.onclick=()=>{character=i;updateCharacterUI();select(selected);draw();updateCameraLabel();};$('characters').append(button);});
  }catch{status('캐릭터 설정을 불러오지 못했어요. 페이지를 새로고침해주세요.');}
  select(0);draw();initGallery();
}
init();

function setTheme(theme){
  if(!['simple','lime','pumpkin','pink','cyworld'].includes(theme))theme='lime';
  document.documentElement.dataset.theme=theme;
  document.querySelectorAll('.theme-picker button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.theme===theme)));
  document.querySelector('meta[name="theme-color"]').content={lime:'#1b1622',pumpkin:'#1d0d0a',pink:'#191919',cyworld:'#fffaf5',simple:'#ffffff'}[theme];
  try{localStorage.setItem('hongok-theme',theme);}catch{}
  if(theme==='simple')selectBasicStyle('white');
  selectFrame(theme==='simple'?'basic':theme==='cyworld'?'miniroom':'halloween');
}
document.querySelectorAll('.theme-picker button').forEach(button=>button.onclick=()=>setTheme(button.dataset.theme));
setTheme('simple');

// Character-only collection has independent selection and canvas; editor state is untouched.
let galleryCharacter='min';
function galleryEntry(){return config?.characters.find(c=>c.id===galleryCharacter);}
function galleryPaths(){return (galleryEntry()?.pose_sets?.halloween??[]).filter(Boolean);}
function initGallery(){
  if(!config){$('gallery-empty').hidden=false;$('gallery-content').hidden=true;return;}
  $('gallery-characters').replaceChildren();
  config.characters.forEach(entry=>{
    const button=document.createElement('button');button.textContent=entry.name;button.dataset.character=entry.id;
    button.onclick=()=>{galleryCharacter=entry.id;updateGallery();};$('gallery-characters').append(button);
  });
  updateGallery();
}
function updateGallery(){
  const entry=galleryEntry(),paths=galleryPaths();
  [...$('gallery-characters').children].forEach(b=>{const active=b.dataset.character===galleryCharacter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('gallery-empty').hidden=paths.length>0;$('gallery-content').hidden=!paths.length;
  $('gallery-title').textContent=(entry?.name??'')+' · 할로윈 원본 사진';
  $('gallery-images').replaceChildren();$('gallery-status').textContent='';
  paths.forEach((path,i)=>{
    const card=document.createElement('article');card.className='gallery-card';
    const img=document.createElement('img');img.src=path;img.alt=`${entry.name} 할로윈 포즈 ${i+1}`;img.loading='lazy';
    const link=document.createElement('a');link.href=path;link.download=`${entry.id}-halloween-${String(i+1).padStart(2,'0')}.${path.split('?')[0].split('.').pop()}`;link.textContent=`${String(i+1).padStart(2,'0')} · 원본 저장 ↓`;
    card.append(img,link);$('gallery-images').append(card);
  });
  renderGallery();
}
function renderGallery(){
  if($('gallery-view').hidden)return;
  const paths=galleryPaths(),target=$('gallery-result'),c=target.getContext('2d'),style=$('gallery-frame').value;
  const basic=['white','black','mono'].includes(style);
  const background=basic?null:asset(config?.backgrounds?.halloween?.[style]);
  const needed=[...paths.slice(0,4),...(basic?[]:[config?.backgrounds?.halloween?.[style]]),...(style==='pink'?[config?.decoration_sources?.pink]:[])].filter(Boolean);
  const ready=paths.length>=4&&needed.every(path=>assets.has(path));
  const failed=needed.some(path=>failedAssets.has(path));
  $('gallery-download').disabled=!ready;$('gallery-loading').hidden=ready||!paths.length;
  $('gallery-loading').textContent=failed?'일부 사진을 불러오지 못했어요. 캐릭터를 다시 눌러주세요.':'사진을 불러오는 중이에요…';
  c.fillStyle=basic?basicPalettes[style].paper:'#201521';c.fillRect(0,0,1200,1560);
  if(!basic&&background)c.drawImage(background,0,0,1200,1560);
  if(style==='pink')drawPinkDecorations(c);
  if(basic){
    c.textAlign='center';c.fillStyle=basicPalettes[style].ink;c.font=style==='black'?'bold 44px sans-serif':'italic 46px Georgia,serif';c.fillText('HONGOK FILM',600,100);
  }
  fourBoxes.forEach((box,i)=>{
    c.fillStyle=basic?basicPalettes[style].slot:'#e9e1dc';c.fillRect(box.x,box.y,box.w,box.h);
    const image=filtered(asset(paths[i]),style==='mono'?{key:'gray',gray:true}:null);if(!image)return;
    // Collection framing is independent of the together-photo focus settings.
    const rotate=galleryCharacter==='han'&&i===1;
    const scale=rotate?Math.max(box.w/image.naturalHeight,box.h/image.naturalWidth):cover(image,box.w,box.h);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    c.save();c.beginPath();c.rect(box.x,box.y,box.w,box.h);c.clip();
    if(rotate){c.translate(box.x+box.w/2,box.y+box.h/2);c.rotate(Math.PI/2);c.drawImage(image,-w/2,-h/2,w,h);}
    else c.drawImage(image,box.x+(box.w-w)/2,box.y,w,h);
    c.restore();
  });
  c.textAlign='center';c.fillStyle=basic?basicPalettes[style].muted:({lime:'#c8bacd',pumpkin:'#d5b6a3',pink:'#cdbcc3'}[style]);
  c.font='26px sans-serif';c.fillText(galleryEntry()?.name??'',600,1470);
  c.font='16px sans-serif';c.fillText('HONGOK FILM  ·  HALLOWEEN COLLECTION',600,1515);
}
function selectView(view){
  const gallery=view==='gallery';$('studio-view').hidden=gallery;$('gallery-view').hidden=!gallery;
  [$('studio-tab'),$('gallery-tab')].forEach((tab,i)=>{const active=gallery?i===1:i===0;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
  if(gallery){if($('camera-dialog').open)$('camera-dialog').close();renderGallery();}
}
$('studio-tab').onclick=()=>selectView('studio');$('gallery-tab').onclick=()=>selectView('gallery');
[$('studio-tab'),$('gallery-tab')].forEach(tab=>tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const gallery=e.key==='End'||(e.key!=='Home'&&tab===$('studio-tab'));selectView(gallery?'gallery':'studio');(gallery?$('gallery-tab'):$('studio-tab')).focus();}});
$('gallery-frame').onchange=renderGallery;
$('gallery-download').onclick=()=>{
  const jpg=$('gallery-format').value==='jpg';renderGallery();
  $('gallery-result').toBlob(blob=>{
    if(!blob){$('gallery-status').textContent='저장하지 못했어요. 다시 시도해주세요.';return;}
    saveImage(blob,`hongokfilm-${galleryCharacter}-halloween-four-${Date.now()}.${jpg?'jpg':'png'}`,message=>{$('gallery-status').textContent=message;});
  },jpg?'image/jpeg':'image/png',.95);
};

if(inAppBrowser){
  $('inapp-banner').hidden=false;
  $('inapp-copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.href.split('#')[0]);$('inapp-copy').textContent='복사됐어요 ✓';}catch{$('inapp-copy').textContent=location.href.split('?')[0];}};
}
