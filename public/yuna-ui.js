const root=document.documentElement;const finePointer=matchMedia('(hover:hover) and (pointer:fine)');const glow=document.getElementById('cursorGlow');const heroBg=document.getElementById('heroBg');const cursorRing=document.getElementById('cursorRing');const scrollProgress=document.getElementById('scrollProgress');
    window.addEventListener('pointermove',(e)=>{const x=e.clientX,y=e.clientY;root.style.setProperty('--mx',`${x}px`);root.style.setProperty('--my',`${y}px`);if(glow&&finePointer.matches)glow.animate({transform:`translate(${x-140}px,${y-140}px)`},{duration:500,fill:'forwards',easing:'cubic-bezier(.2,.8,.2,1)'});if(cursorRing&&finePointer.matches)cursorRing.animate({transform:`translate(${x-17}px,${y-17}px)`},{duration:260,fill:'forwards',easing:'cubic-bezier(.2,.8,.2,1)'});if(heroBg){const tx=(window.innerWidth/2-x)*.006,ty=(window.innerHeight/2-y)*.006;heroBg.style.setProperty('--bg-x',`${tx}px`);heroBg.style.setProperty('--bg-y',`${ty}px`)}},{passive:true});
    const updateScroll=()=>{const max=document.documentElement.scrollHeight-innerHeight;const pct=max>0?(scrollY/max)*100:0;if(scrollProgress)scrollProgress.style.width=`${pct}%`;document.body.classList.toggle('scrolled',scrollY>18)};updateScroll();addEventListener('scroll',updateScroll,{passive:true});
    document.querySelectorAll('.magnetic').forEach(el=>{el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--mag-x',`${(e.clientX-r.left-r.width/2)*.08}px`);el.style.setProperty('--mag-y',`${(e.clientY-r.top-r.height/2)*.08}px`)});el.addEventListener('pointerleave',()=>{el.style.setProperty('--mag-x','0px');el.style.setProperty('--mag-y','0px')})});
    // 聚光/涟漪/悬停光标改为事件委托：动态渲染出来的卡片（文章列表、成员卡）也能拿到同一套交互。
    const SPOT_SELECTOR='.btn,.card,.knowledge-card,.resource-card,.member-card,.aside-card,.visual-card,.login-card,.stat';
    const HOVER_SELECTOR='a,button,.card,.knowledge-card,.resource-card,.member-card,.aside-card,.big-logo,.logo-stage,.visual-card,.login-card';
    document.addEventListener('pointermove',e=>{const el=e.target instanceof Element?e.target.closest(SPOT_SELECTOR):null;if(!el)return;const r=el.getBoundingClientRect();el.style.setProperty('--spot-x',`${e.clientX-r.left}px`);el.style.setProperty('--spot-y',`${e.clientY-r.top}px`)},{passive:true});
    document.addEventListener('click',e=>{const el=e.target instanceof Element?e.target.closest(SPOT_SELECTOR):null;if(!el)return;const r=el.getBoundingClientRect();const s=document.createElement('span');s.className='ripple';s.style.left=`${e.clientX-r.left}px`;s.style.top=`${e.clientY-r.top}px`;el.appendChild(s);setTimeout(()=>s.remove(),760)});
    document.addEventListener('pointerover',e=>{const el=e.target instanceof Element?e.target.closest(HOVER_SELECTOR):null;document.body.classList.toggle('cursor-active',Boolean(el))});
    document.documentElement.addEventListener('pointerleave',()=>document.body.classList.remove('cursor-active'));
    const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.15});document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=`${Math.min(i*40,220)}ms`;io.observe(el)});
    // 粒子背景：画布被 CSS 隐藏（移动端/减少动效）或标签页不可见时停帧，避免空转烧 CPU。
    const canvas=document.getElementById('particleCanvas'),ctx=canvas?canvas.getContext('2d'):null;let particles=[];let particlesRunning=false;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    function resizeCanvas(){if(!canvas||!ctx)return;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;canvas.style.width=`${innerWidth}px`;canvas.style.height=`${innerHeight}px`;ctx.setTransform(dpr,0,0,dpr,0,0);const n=Math.min(76,Math.max(38,Math.floor(innerWidth/20)));particles=Array.from({length:n},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight*.78,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.16,r:Math.random()*1.8+.7,a:Math.random()*.42+.18}))}
    function drawParticles(){if(!ctx||!particlesRunning)return;ctx.clearRect(0,0,innerWidth,innerHeight);for(const p of particles){p.x+=p.vx;p.y+=p.vy;if(p.x<-20)p.x=innerWidth+20;if(p.x>innerWidth+20)p.x=-20;if(p.y<-20)p.y=innerHeight*.78+20;if(p.y>innerHeight*.82)p.y=-20;ctx.beginPath();ctx.fillStyle=`rgba(73,200,255,${p.a})`;ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){const a=particles[i],b=particles[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist<115){ctx.beginPath();ctx.strokeStyle=`rgba(73,200,255,${(1-dist/115)*.12})`;ctx.lineWidth=1;ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}requestAnimationFrame(drawParticles)}
    function syncParticles(){if(!canvas||!ctx)return;const shouldRun=!document.hidden&&!reducedMotion.matches&&getComputedStyle(canvas).display!=='none';if(shouldRun&&!particlesRunning){particlesRunning=true;requestAnimationFrame(drawParticles)}else if(!shouldRun){particlesRunning=false}}
    resizeCanvas();addEventListener('resize',()=>{resizeCanvas();syncParticles()});document.addEventListener('visibilitychange',syncParticles);reducedMotion.addEventListener?.('change',syncParticles);syncParticles();

(function(){
  const $=(s,root=document)=>root.querySelector(s);
  const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));

  function activateTabs(buttonSelector,panelSelector,attr){
    const buttons=$$(buttonSelector), panels=$$(panelSelector);
    if(!buttons.length) return;
    const show=(name)=>{
      buttons.forEach(btn=>{
        const active=btn.dataset[attr]===name;
        btn.classList.toggle('active',active);
        btn.classList.toggle('is-active',active);
        btn.setAttribute('aria-pressed',active?'true':'false');
      });
      panels.forEach(panel=>{ panel.hidden=panel.dataset[attr.replace('Tab','Panel')]!==name; });
    };
    buttons.forEach(btn=>btn.addEventListener('click',()=>show(btn.dataset[attr])));
    const hash=location.hash.replace('#','');
    const queryTab=attr==='adminTab'?new URLSearchParams(location.search).get('tab'):'';
    const initial=buttons.find(btn=>btn.dataset[attr]===hash)?.dataset[attr] || buttons.find(btn=>btn.dataset[attr]===queryTab)?.dataset[attr] || buttons[0].dataset[attr];
    show(initial);
  }

  activateTabs('[data-admin-tab]','[data-admin-panel]','adminTab');

  function initOfficeMaps(){
    const maps=$$('[data-office-map]');
    if(!maps.length) return;
    const tileSize=256;
    const minZoom=14;
    const maxZoom=18;
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    const project=(lng,lat,zoom)=>{
      const scale=Math.pow(2,zoom);
      const sin=clamp(Math.sin((lat*Math.PI)/180),-.9999,.9999);
      return {
        x:((lng+180)/360)*scale,
        y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale
      };
    };
    const tileUrl=(x,y,zoom)=>{
      const server=((x+y)%4+4)%4+1;
      return `https://webrd0${server}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${zoom}`;
    };
    maps.forEach(map=>{
      const tiles=$('.office-map-tiles',map);
      if(!tiles) return;
      const lat=Number(map.dataset.mapLat||map.dataset.lat);
      const lng=Number(map.dataset.mapLng||map.dataset.lng);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)) return;
      let zoom=clamp(Number(map.dataset.zoom)||17,minZoom,maxZoom);
      let lastPinchDistance=0;
      const render=()=>{
        const p=project(lng,lat,zoom);
        const tileX=Math.floor(p.x);
        const tileY=Math.floor(p.y);
        const focusX=(1+p.x-tileX)*tileSize;
        const focusY=(1+p.y-tileY)*tileSize;
        tiles.style.transform=`translate(${-focusX}px,${-focusY}px)`;
        const frag=document.createDocumentFragment();
        for(let dy=-1;dy<=1;dy++){
          for(let dx=-1;dx<=1;dx++){
            const img=document.createElement('img');
            img.src=tileUrl(tileX+dx,tileY+dy,zoom);
            img.alt='';
            img.loading='lazy';
            img.decoding='async';
            img.referrerPolicy='no-referrer';
            img.draggable=false;
            frag.appendChild(img);
          }
        }
        tiles.replaceChildren(frag);
        map.dataset.zoom=String(zoom);
      };
      const setZoom=(next)=>{
        const value=clamp(next,minZoom,maxZoom);
        if(value===zoom) return;
        zoom=value;
        render();
      };
      const getTouchDistance=(touches)=>{
        const a=touches[0];
        const b=touches[1];
        return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
      };
      // 仅在按住 Ctrl/⌘ 时缩放，普通滚轮让页面正常滚动，不劫持。
      map.addEventListener('wheel',event=>{
        if(!event.ctrlKey&&!event.metaKey) return;
        event.preventDefault();
        setZoom(zoom+(event.deltaY<0?1:-1));
      },{passive:false});
      map.addEventListener('touchstart',event=>{
        if(event.touches.length!==2) return;
        lastPinchDistance=getTouchDistance(event.touches);
      },{passive:true});
      map.addEventListener('touchmove',event=>{
        if(event.touches.length!==2||!lastPinchDistance) return;
        event.preventDefault();
        const distance=getTouchDistance(event.touches);
        const ratio=distance/lastPinchDistance;
        if(ratio>1.18){
          setZoom(zoom+1);
          lastPinchDistance=distance;
        }else if(ratio<.85){
          setZoom(zoom-1);
          lastPinchDistance=distance;
        }
      },{passive:false});
      map.addEventListener('touchend',event=>{
        if(event.touches.length<2) lastPinchDistance=0;
      });
      map.addEventListener('touchcancel',()=>{lastPinchDistance=0;});
      // 可见的缩放按钮：不依赖 Ctrl+滚轮/双指手势，键盘也可操作。
      const controls=document.createElement('div');
      controls.className='office-map-zoom';
      const zoomIn=document.createElement('button');
      zoomIn.type='button';
      zoomIn.textContent='+';
      zoomIn.setAttribute('aria-label','放大地图');
      const zoomOut=document.createElement('button');
      zoomOut.type='button';
      zoomOut.textContent='−';
      zoomOut.setAttribute('aria-label','缩小地图');
      zoomIn.addEventListener('click',()=>setZoom(zoom+1));
      zoomOut.addEventListener('click',()=>setZoom(zoom-1));
      controls.append(zoomIn,zoomOut);
      map.appendChild(controls);
      render();
    });
  }
  initOfficeMaps();

  // 装饰动画容器滚出视口后暂停，减少常驻 GPU/CPU 占用。
  const animRoots=$$('.logo-stage,.page-visual');
  if(animRoots.length&&'IntersectionObserver' in window){
    const animIo=new IntersectionObserver(entries=>{
      entries.forEach(entry=>entry.target.classList.toggle('anim-offscreen',!entry.isIntersecting));
    },{rootMargin:'80px'});
    animRoots.forEach(el=>animIo.observe(el));
  }
})();
