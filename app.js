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
const assets = new Map();
const status = (message) => { $('status').textContent = message; };
function imageFrom(url) { return new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('이미지를 불러오지 못했어요.')); image.src = url; }); }
function cover(image,w,h) { return Math.max(w/image.naturalWidth,h/image.naturalHeight); }
function drawPhoto(photo,b,index) {
  const area=b;
  const s=cover(photo.image,area.w,area.h)*photo.zoom;
  const iw=photo.image.naturalWidth*s,ih=photo.image.naturalHeight*s;
  const limitX=(iw+area.w)/2-24,limitY=(ih+area.h)/2-24;
  photo.x=Math.max(-limitX,Math.min(limitX,photo.x));
  photo.y=Math.max(-limitY,Math.min(limitY,photo.y));
  ctx.save();ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();
  ctx.translate(area.x+area.w/2+photo.x,area.y+area.h/2+photo.y);ctx.rotate(photo.rotation??0);ctx.scale(photo.mirror?-1:1,1);ctx.drawImage(photo.image,-iw/2,-ih/2,iw,ih);ctx.restore();
}
function editable(){return $('edit-layer').value==='character'&&character==='custom'&&mode==='together'?customPoses[selected]:photos[selected];}
function drawCustomPose(pose,b,c=ctx){
  const wide=frame==='miniroom';
  const fillWide=wide&&$('character-fit').value==='cover';
  const scale=(fillWide?Math.max(b.w*.5/pose.image.naturalWidth,b.h/pose.image.naturalHeight):Math.min(b.w*(wide?.5:.48)/pose.image.naturalWidth,b.h*(wide?1:.93)/pose.image.naturalHeight))*pose.zoom;
  const w=pose.image.naturalWidth*scale,h=pose.image.naturalHeight*scale;
  c.save();c.beginPath();c.rect(wide?b.x+b.w*.5:b.x,b.y,wide?b.w*.5:b.w,b.h);c.clip();
  c.translate(b.x+b.w*(wide?.75:.76)+pose.x,(fillWide?b.y+h/2:b.y+b.h-h/2)+pose.y);c.rotate(pose.rotation??0);c.scale(pose.mirror?-1:1,1);
  c.drawImage(pose.image,-w/2,-h/2,w,h);c.restore();
}
function registeredPose(index){
  if(character==='custom')return null;
  const entry=config?.characters[character];
  const set=entry?.pose_sets?.[frame]??entry?.pose_sets?.[frame==='halloween'?'halloween':'basic'];
  const path=set?.length?set[index%set.length]:entry?.poses?.[index];
  return assets.get(path);
}
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
    c.drawImage(image,sx,sy,sw,sh,x-transparentInset,b.y+b.h-h,w,h);c.restore();return;
  }
  if(frame==='miniroom'&&config?.characters[character]?.id==='han'){
    const scale=Math.min(b.w*.5/image.naturalWidth,b.h*.96/image.naturalHeight);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    c.save();c.beginPath();c.rect(b.x+b.w/2,b.y,b.w/2,b.h);c.clip();
    c.drawImage(image,b.x+b.w*.75-w/2,b.y+b.h-h,w,h);c.restore();return;
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
    const scale=height/image.naturalHeight;
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    c.save();c.beginPath();c.rect(b.x,b.y,b.w,b.h);c.clip();
    c.drawImage(image,b.x+b.w*(left?.40:.74)-w/2,b.y+b.h-h,w,h);c.restore();return;
  }
  const width=b.w/2;
  const scale=Math.max(width/image.naturalWidth,b.h/image.naturalHeight);
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  c.save();c.beginPath();c.rect(b.x+width,b.y,width,b.h);c.clip();
  c.drawImage(image,b.x+width+(width-w)/2,b.y,w,h);c.restore();
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
  const source=assets.get(config?.decoration_sources?.pink);
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
  const tape=assets.get(config?.decoration_sources?.cyworld_tape);
  if(tape){
    for(const [x,y,angle] of [[1050,290,.18],[150,1310,.30]]){
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=.82;
      const h=190*tape.naturalHeight/tape.naturalWidth;
      ctx.drawImage(tape,-95,-h/2,190,h);ctx.restore();
    }
  }
}
function draw(forExport=false) {
  ctx.fillStyle=frame==='halloween'?'#392342':basicPalettes[basicStyle].paper;ctx.fillRect(0,0,1200,1560);
  const theme=document.documentElement.dataset.theme||'lime';
  const halloweenTheme=['cyworld','simple'].includes(theme)?'pink':theme;
  const backgroundPath=frame==='halloween'?config?.backgrounds?.halloween?.[halloweenTheme]:config?.backgrounds?.[frame];
  const background=assets.get(backgroundPath);if(background){
    ctx.drawImage(background,0,0,1200,1560);
    const assetName=backgroundPath?.split('?')[0];
    const adjusted=['assets/background-01.png','assets/background-02.png'].includes(assetName);
    if(frame==='halloween'&&adjusted){
      // Map the entire decorative edge strip into each 60px gutter, with 4px inset.
      // Source art is wider than the gutter; scaling keeps complete objects visible.
      const iw=background.naturalWidth,ih=background.naturalHeight;
      if(assetName==='assets/background-01.png'){
        for(const x of [10,1015])ctx.drawImage(background,x/1100*iw,750/1430*ih,75/1100*iw,1,x/1100*1200,665/1430*1560,75/1100*1200,85/1430*1560);
      }
      const sy=160/1560*ih,sh=1250/1560*ih,sw=90/1100*iw;
      for(const [sx,dx] of [[0,4],[iw-sw,1144]]){
        const cleanX=(sx===0?100:1000)/1100*iw;
        ctx.drawImage(background,cleanX,sy,1,sh,dx-4,160,60,1250);
        ctx.save();ctx.beginPath();ctx.rect(dx,160,52,1250);ctx.clip();
        ctx.drawImage(background,sx,sy,sw,sh,dx,160,52,1250);
        if(assetName==='assets/background-01.png'){
          // Remove the skulls at their generated height before placing them at Y≈800.
          ctx.drawImage(background,sx,750/1430*ih,sw,1,dx,665/1430*1560,52,85/1430*1560);
        }
        ctx.restore();
      }
      if(assetName==='assets/background-01.png'){
        ctx.drawImage(background,10/1100*iw,665/1430*ih,75/1100*iw,85/1430*ih,6,765,46,45);
        ctx.drawImage(background,1015/1100*iw,665/1430*ih,75/1100*iw,85/1430*ih,1148,765,46,45);
      }
    }
  }
  if(frame==='halloween'&&halloweenTheme==='pink')drawPinkDecorations();
  if(frame==='miniroom')drawMiniroomHeader();
  ctx.textAlign='center';ctx.fillStyle=frame==='halloween'?'#f7bf83':'#3e2e44';ctx.font='bold 32px sans-serif';if(frame==='basic')drawBasicHeader();
  ctx.save();if(frame==='basic'&&basicStyle==='mono')ctx.filter='grayscale(1)';else if(frame==='miniroom')ctx.filter=cyworldFilter();
  boxes.forEach((b,i) => {
    ctx.fillStyle=frame==='halloween'?'#e5d4c7':frame==='miniroom'?'#F7F5F1':basicPalettes[basicStyle].slot;ctx.fillRect(b.x,b.y,b.w,b.h);
    if(photos[i]) drawPhoto(photos[i],b,i);
    else {ctx.fillStyle='#84758b';ctx.font='26px sans-serif';ctx.fillText(`＋ ${i+1}번째 사진`,b.x+b.w/2,b.y+b.h/2);}
    if(mode==='together') {
      ctx.save();
      if(frame==='miniroom'&&!['min','kim'].includes(config?.characters[character]?.id)){ctx.beginPath();ctx.rect(b.x+b.w/2,b.y,b.w/2,b.h);ctx.clip();}
      const pose=registeredPose(i);
      if(character==='custom'){
        if(customPoses[i])drawCustomPose(customPoses[i],b);
        else {ctx.fillStyle='#766782';ctx.font='18px sans-serif';ctx.fillText('내 캐릭터를 올려주세요',b.x+b.w*.73,b.y+b.h-30);}
      } else
      if(pose) {drawRegisteredPose(pose,b,ctx,i);}
      else {
        ctx.save();ctx.beginPath();ctx.rect(b.x+b.w*(frame==='miniroom'?.5:.57),b.y,b.w*(frame==='miniroom'?.5:.43),b.h);ctx.clip();
        ctx.fillStyle='#bea9ca99';ctx.fillRect(b.x+b.w*(frame==='miniroom'?.5:.57),b.y,b.w*(frame==='miniroom'?.5:.43),b.h);
        ctx.fillStyle='#745b8655';ctx.beginPath();ctx.arc(b.x+b.w*.81,b.y+215,68,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(b.x+b.w*.81,b.y+480,125,180,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#55415e';ctx.font='bold 24px sans-serif';ctx.fillText(config?.characters[character].name??'',b.x+b.w*.79,b.y+b.h-70);ctx.font='16px sans-serif';ctx.fillText('캐릭터 준비 중',b.x+b.w*.79,b.y+b.h-38);ctx.restore();
      }
      ctx.restore();
    }
    if(frame==='miniroom'&&Number($('softness').value)>0){ctx.save();ctx.filter='none';ctx.globalAlpha=Number($('softness').value)/100*.10;ctx.fillStyle='#fff9f3';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.restore();}
    if(frame==='halloween') {ctx.fillStyle='#633b6c';ctx.font='26px sans-serif';ctx.fillText(['✦','☾','☾','✦'][i],b.x+b.w-24,b.y+35);}
  });
  ctx.restore();if(frame==='basic')drawBasicDetails();if(frame==='miniroom')drawMiniroomDetails();
  const overlay=assets.get(config?.overlays[frame==='basic'?'together':frame]);if(overlay)ctx.drawImage(overlay,0,0,1200,1560);
  ctx.fillStyle=frame==='halloween'?(['cyworld','simple'].includes(theme)?'#cdbcc3':getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()||'#f4d5b3'):frame==='miniroom'?'#8d857b':basicPalettes[basicStyle].muted;ctx.font=frame==='miniroom'?'29px "Hongok Hand",sans-serif':'24px sans-serif';
  ctx.fillText($('caption').value.trim()||(forExport===true?'':'문구를 입력해주세요. (선택사항)'),600,1470,1080);
  ctx.font='16px sans-serif';ctx.fillText('HONGOK FILM  ·  '+new Date().toLocaleDateString('ko-KR'),600,1515);
  const count=activePhotos().filter(Boolean).length;$('progress').textContent=`${count} / ${boxes.length}`;$('download').disabled=count!==boxes.length||busy;$('share').disabled=count!==boxes.length||busy;
  renderCameraCharacter();
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
$('slots').replaceChildren();
boxes.forEach((b,i)=>{
  const el=document.createElement('button');el.className='slot';el.style.cssText=`left:${b.x/12}%;top:${b.y/15.6}%;width:${b.w/12}%;height:${b.h/15.6}%`;el.setAttribute('aria-label',`${i+1}번째 사진 불러오기 또는 선택 및 위치 조정`);el.textContent=`${i+1}번째 사진`;el.onclick=()=>{select(i);if(!photos[i]&&!busy){$('edit-layer').value='photo';select(i);$('upload').click();}};$('slots').append(el);
  const pointers=new Map();let gesture;
  const baseline=()=>{
    const item=editable(),points=[...pointers.values()];
    if(!item||!points.length){gesture=null;return;}
    const a=points[0],b=points[1]??a;
    gesture={item,x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y),px:item.x,py:item.y,zoom:item.zoom,rotation:item.rotation??0,angle:Math.atan2(b.y-a.y,b.x-a.x)};
  };
  el.onpointerdown=(e)=>{select(i);if(!editable())return;e.preventDefault();el.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});baseline();};
  el.onpointermove=(e)=>{
    if(!pointers.has(e.pointerId)||!gesture||editable()!==gesture.item)return;
    e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const points=[...pointers.values()],a=points[0],b=points[1]??a;
    const scale=1200/canvas.getBoundingClientRect().width,item=gesture.item;
    item.x=gesture.px+((a.x+b.x)/2-gesture.x)*scale;
    item.y=gesture.py+((a.y+b.y)/2-gesture.y)*scale;
    if(points.length>1&&gesture.distance>0){
      item.zoom=Math.max(.3,Math.min(3,gesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance));
      const angle=Math.atan2(b.y-a.y,b.x-a.x)-gesture.angle;
      item.rotation=gesture.rotation+Math.atan2(Math.sin(angle),Math.cos(angle));
      $('zoom').value=item.zoom;$('zoom-value').textContent=Math.round(item.zoom*100)+'%';
    }
    draw();
  };
  const release=(e)=>{pointers.delete(e.pointerId);baseline();};
  el.onpointerup=el.onpointercancel=el.onlostpointercapture=release;
  el.onkeydown=(e)=>{if(!editable()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();editable().x+=e.key==='ArrowLeft'?-15:e.key==='ArrowRight'?15:0;editable().y+=e.key==='ArrowUp'?-15:e.key==='ArrowDown'?15:0;draw();};
});
}
buildSlots();
function setPhoto(image,index){photos[index]={image,x:0,y:0,zoom:1,mirror:false,rotation:0};}
$('upload').onchange=async(e)=>{
  const files=[...e.target.files];if(!files.length)return;
  const targets=[selected,...boxes.map((_,i)=>i).filter(i=>i!==selected&&!photos[i])];
  busy=true;draw();let loaded=0,failed=0;
  for(let j=0;j<Math.min(files.length,targets.length);j++){
    const url=URL.createObjectURL(files[j]);
    try{const image=await imageFrom(url);setPhoto(image,targets[j]);loaded++;}catch{failed++;}finally{URL.revokeObjectURL(url);}
  }
  busy=false;$('edit-layer').value='photo';select(selected);draw();e.target.value='';
  status(`${loaded}장의 사진을 추가했어요.${failed?' 읽을 수 없는 사진은 JPG·PNG·WebP로 변환해 다시 올려주세요.':''}${files.length>targets.length?' 빈 칸보다 많은 사진은 제외했어요.':''}`);
};
$('zoom').oninput=()=>{if(editable())editable().zoom=Number($('zoom').value);$('zoom-value').textContent=Math.round(Number($('zoom').value)*100)+'%';draw();};
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
  $('download').innerHTML=(two?'두컷 사진 저장하기':'네컷 사진 저장하기')+' <span>↓</span>';
  $('download-note').textContent=`사진 ${boxes.length}장을 채우면 고해상도 JPG 또는 PNG로 저장할 수 있어요.`;
  canvas.setAttribute('aria-label',two?'완성될 와이드 두컷 사진 미리보기':'완성될 네컷 사진 미리보기');
  document.querySelector('.preview-panel').setAttribute('aria-label',two?'두컷 미리보기':'네컷 미리보기');
}
$('character-fit').onchange=()=>{draw();};
$('softness').oninput=()=>{$('softness-value').textContent=$('softness').value+'%';draw();};
function exportFormat(){const jpg=$('format').value==='jpg';return {extension:jpg?'jpg':'png',type:jpg?'image/jpeg':'image/png'};}
function blob(type){
  const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
  try{draw(true);output.getContext('2d').drawImage(canvas,0,0);}finally{draw();}
  return new Promise((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(new Error('이미지를 만들지 못했어요.')),type,0.95));
}
$('download').onclick=async()=>{try{const format=exportFormat();const image=await blob(format.type);const url=URL.createObjectURL(image);const a=document.createElement('a');a.href=url;a.download=`plot-${frame==='basic'?basicStyle:frame}-${mode}-${Date.now()}.${format.extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status(`${format.extension.toUpperCase()} 이미지 저장을 요청했어요. 모바일에서 저장이 어렵다면 이미지 공유를 이용해주세요.`);}catch{status('이미지 저장에 실패했어요. 다시 시도해주세요.');}};
function updateShare(){const format=exportFormat();$('share').hidden=!(navigator.canShare&&navigator.canShare({files:[new File([''],`photo.${format.extension}`,{type:format.type})]}));}
$('format').onchange=updateShare;updateShare();
$('share').onclick=async()=>{try{const format=exportFormat();const image=await blob(format.type);await navigator.share({files:[new File([image],`plot-photo.${format.extension}`,{type:format.type})]});}catch(e){if(e.name!=='AbortError')status('공유에 실패했어요. 이미지 저장을 이용해주세요.');}};
function renderCameraCharacter(){
  const preview=$('camera-character'), c=preview.getContext('2d'),box=boxes[selected];
  preview.width=box.w;preview.height=box.h;
  document.querySelector('.camera-stage').style.aspectRatio=`${box.w}/${box.h}`;
  c.clearRect(0,0,box.w,box.h);
  const monochrome=frame==='basic'&&basicStyle==='mono';
  const filter=monochrome?'grayscale(1)':frame==='miniroom'?cyworldFilter():'none';
  $('video').style.filter=filter;c.filter=filter;
  const custom=mode==='together'&&character==='custom'&&customPoses[selected];
  const registered=mode==='together'?registeredPose(selected):null;
  preview.hidden=!custom&&!registered;
  $('camera-guide').hidden=mode!=='together'||Boolean(custom||registered);
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
      const image=await imageFrom(url);const pose={image,x:0,y:0,zoom:1,mirror:false,rotation:0};
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
  try{await document.fonts.load('29px "Hongok Hand"');}catch{}
  try{
    const response=await fetch('./assets/frames.json?v=20261027.1');if(!response.ok)throw new Error('config');config=await response.json();
    const paths=[...config.characters.flatMap(c=>[...c.poses,...Object.values(c.pose_sets??{}).flat()]),...Object.values(config.overlays),...Object.values(config.decoration_sources??{}),...Object.values(config.backgrounds??{}).flatMap(value=>value&&typeof value==='object'?Object.values(value):[value])].filter(Boolean);
    await Promise.all([...new Set(paths)].map(async path=>{try{assets.set(path,await imageFrom(new URL(path,document.baseURI).href));}catch{status('일부 프레임을 불러오지 못해 임시 디자인을 표시해요.');}}));
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
  const paths=galleryPaths(),target=$('gallery-result'),c=target.getContext('2d'),style=$('gallery-frame').value;
  const basic=['white','black','mono'].includes(style);
  const background=assets.get(config?.backgrounds?.halloween?.[style]);
  const ready=paths.length>=4&&paths.slice(0,4).every(path=>assets.has(path));
  $('gallery-download').disabled=!ready;
  c.fillStyle=basic?basicPalettes[style].paper:'#201521';c.fillRect(0,0,1200,1560);
  if(!basic&&background)c.drawImage(background,0,0,1200,1560);
  if(style==='pink')drawPinkDecorations(c);
  if(basic){
    c.textAlign='center';c.fillStyle=basicPalettes[style].ink;c.font=style==='black'?'bold 44px sans-serif':'italic 46px Georgia,serif';c.fillText('HONGOK FILM',600,100);
  }
  fourBoxes.forEach((box,i)=>{
    c.fillStyle=basic?basicPalettes[style].slot:'#e9e1dc';c.fillRect(box.x,box.y,box.w,box.h);
    const image=assets.get(paths[i]);if(!image)return;
    const scale=cover(image,box.w,box.h),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    c.save();c.beginPath();c.rect(box.x,box.y,box.w,box.h);c.clip();
    if(style==='mono')c.filter='grayscale(1)';
    c.drawImage(image,box.x+(box.w-w)/2,box.y,w,h);c.restore();
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
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${galleryCharacter}-halloween-four-${Date.now()}.${jpg?'jpg':'png'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('gallery-status').textContent='캐릭터 네컷 이미지 저장을 요청했어요.';
  },jpg?'image/jpeg':'image/png',.95);
};
