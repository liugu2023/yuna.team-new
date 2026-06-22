const root=document.documentElement;const glow=document.getElementById('cursorGlow');const heroBg=document.getElementById('heroBg');const cursorRing=document.getElementById('cursorRing');const scrollProgress=document.getElementById('scrollProgress');
    window.addEventListener('pointermove',(e)=>{const x=e.clientX,y=e.clientY;root.style.setProperty('--mx',`${x}px`);root.style.setProperty('--my',`${y}px`);if(glow)glow.animate({transform:`translate(${x-140}px,${y-140}px)`},{duration:500,fill:'forwards',easing:'cubic-bezier(.2,.8,.2,1)'});if(cursorRing)cursorRing.animate({transform:`translate(${x-17}px,${y-17}px)`},{duration:260,fill:'forwards',easing:'cubic-bezier(.2,.8,.2,1)'});if(heroBg){const tx=(window.innerWidth/2-x)*.006,ty=(window.innerHeight/2-y)*.006;heroBg.style.setProperty('--bg-x',`${tx}px`);heroBg.style.setProperty('--bg-y',`${ty}px`)}});
    const updateScroll=()=>{const max=document.documentElement.scrollHeight-innerHeight;const pct=max>0?(scrollY/max)*100:0;if(scrollProgress)scrollProgress.style.width=`${pct}%`;document.body.classList.toggle('scrolled',scrollY>18)};updateScroll();addEventListener('scroll',updateScroll,{passive:true});
    document.querySelectorAll('.magnetic').forEach(el=>{el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--mag-x',`${(e.clientX-r.left-r.width/2)*.08}px`);el.style.setProperty('--mag-y',`${(e.clientY-r.top-r.height/2)*.08}px`)});el.addEventListener('pointerleave',()=>{el.style.setProperty('--mag-x','0px');el.style.setProperty('--mag-y','0px')})});
    document.querySelectorAll('.btn,.card,.knowledge-card,.resource-card,.member-card,.aside-card,.visual-card,.login-card,.stat').forEach(el=>{el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--spot-x',`${e.clientX-r.left}px`);el.style.setProperty('--spot-y',`${e.clientY-r.top}px`)});el.addEventListener('click',e=>{const r=el.getBoundingClientRect();const s=document.createElement('span');s.className='ripple';s.style.left=`${e.clientX-r.left}px`;s.style.top=`${e.clientY-r.top}px`;el.appendChild(s);setTimeout(()=>s.remove(),760)})});
    document.querySelectorAll('a,button,.card,.knowledge-card,.resource-card,.member-card,.aside-card,.big-logo,.logo-stage,.visual-card,.login-card').forEach(el=>{el.addEventListener('pointerenter',()=>document.body.classList.add('cursor-active'));el.addEventListener('pointerleave',()=>document.body.classList.remove('cursor-active'))});
    const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.15});document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=`${Math.min(i*40,220)}ms`;io.observe(el)});
    const canvas=document.getElementById('particleCanvas'),ctx=canvas?canvas.getContext('2d'):null;let particles=[];function resizeCanvas(){if(!canvas||!ctx)return;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;canvas.style.width=`${innerWidth}px`;canvas.style.height=`${innerHeight}px`;ctx.setTransform(dpr,0,0,dpr,0,0);const n=Math.min(76,Math.max(38,Math.floor(innerWidth/20)));particles=Array.from({length:n},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight*.78,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.16,r:Math.random()*1.8+.7,a:Math.random()*.42+.18}))}function drawParticles(){if(!ctx)return;ctx.clearRect(0,0,innerWidth,innerHeight);for(const p of particles){p.x+=p.vx;p.y+=p.vy;if(p.x<-20)p.x=innerWidth+20;if(p.x>innerWidth+20)p.x=-20;if(p.y<-20)p.y=innerHeight*.78+20;if(p.y>innerHeight*.82)p.y=-20;ctx.beginPath();ctx.fillStyle=`rgba(73,200,255,${p.a})`;ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){const a=particles[i],b=particles[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist<115){ctx.beginPath();ctx.strokeStyle=`rgba(73,200,255,${(1-dist/115)*.12})`;ctx.lineWidth=1;ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}requestAnimationFrame(drawParticles)}resizeCanvas();addEventListener('resize',resizeCanvas);requestAnimationFrame(drawParticles);

(function(){
  const $=(s,root=document)=>root.querySelector(s);
  const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));
  const isLiveAdmin=Boolean($('[data-title]')&&$('[data-markdown]')&&$('[data-editor-modal]'));

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
    const initial=buttons.find(btn=>btn.dataset[attr]===hash)?.dataset[attr] || buttons[0].dataset[attr];
    show(initial);
  }

  activateTabs('[data-home-tab]','[data-home-panel]','homeTab');
  activateTabs('[data-resource-tab]','[data-resource-panel]','resourceTab');
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
      map.addEventListener('wheel',event=>{
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
      render();
    });
  }
  initOfficeMaps();

  const articleCards=$$('[data-article-card]');
  const articleSearch=$('[data-article-search]');
  const articleCategory=$('[data-article-category]');
  const articleStatus=$('[data-article-status]');
  function filterArticles(){
    if(!articleCards.length) return;
    const q=(articleSearch?.value||'').trim().toLowerCase();
    const cat=articleCategory?.value||'all';
    const status=articleStatus?.value||'published';
    let visible=0;
    articleCards.forEach(card=>{
      const text=card.textContent.toLowerCase();
      const okText=!q||text.includes(q);
      const okCat=cat==='all'||card.dataset.category===cat;
      const okStatus=status==='all'||card.dataset.status===status;
      const show=okText&&okCat&&okStatus;
      card.hidden=!show;
      if(show) visible++;
    });
    const empty=$('[data-article-empty]');
    if(empty) empty.hidden=visible>0;
  }
  [articleSearch,articleCategory,articleStatus].forEach(el=>el&&el.addEventListener('input',filterArticles));
  filterArticles();

  const members=$$('[data-member]');
  const memberStatusPanel=$('.state-panel');
  const memberStatusTitle=$('[data-member-status-title]');
  const memberStatus=$('[data-member-status]');
  const memberCount=$('[data-member-count]');
  function setMemberStatus(title,text,mode='ready'){
    if(memberStatusTitle) memberStatusTitle.textContent=title;
    if(memberStatus) memberStatus.textContent=text;
    if(memberStatusPanel){
      memberStatusPanel.classList.toggle('is-loading',mode==='loading');
      memberStatusPanel.classList.toggle('is-error',mode==='error');
    }
  }
  function filterMembers(){
    if(!members.length) return;
    const q=($('[data-member-search]')?.value||'').trim().toLowerCase();
    const term=$('[data-member-term]')?.value||'all';
    const dept=$('[data-member-department]')?.value||'all';
    const role=$('[data-member-role]')?.value||'all';
    let visible=0;
    members.forEach(card=>{
      const text=card.textContent.toLowerCase();
      const show=(!q||text.includes(q))&&(term==='all'||card.dataset.term===term)&&(dept==='all'||card.dataset.department===dept)&&(role==='all'||card.dataset.role===role);
      card.hidden=!show;
      if(show) visible++;
    });
    const empty=$('[data-member-empty]');
    if(empty) empty.hidden=visible>0;
    if(memberCount) memberCount.textContent=String(visible);
    setMemberStatus(visible?'名册已加载':'没有匹配记录',visible?`显示 ${visible} 条成员记录。筛选无结果时会显示空状态；加载异常时保留重试入口。`:'当前筛选条件没有命中成员，请清空筛选或进入后台补录。',visible?'ready':'empty');
  }
  ['[data-member-search]','[data-member-term]','[data-member-department]','[data-member-role]'].forEach(sel=>{
    const el=$(sel);
    if(el) el.addEventListener(el.tagName==='INPUT'?'input':'change',filterMembers);
  });
  $('[data-clear-member-filters]')?.addEventListener('click',()=>{
    ['[data-member-search]','[data-member-term]','[data-member-department]','[data-member-role]'].forEach(sel=>{
      const el=$(sel);
      if(!el) return;
      el.value=sel==='[data-member-search]'?'':'all';
    });
    filterMembers();
  });
  $('[data-refresh-members]')?.addEventListener('click',()=>{
    setMemberStatus('正在刷新名册','正在重新加载成员信息，并保留当前筛选条件。','loading');
    setTimeout(filterMembers,620);
  });
  $$('[data-copy-site-record]').forEach(btn=>btn.addEventListener('click',async()=>{
    const key=btn.dataset.copySiteRecord;
    const value=`站点维护：${key}`;
    try{
      await navigator.clipboard?.writeText(value);
      flashMessage('[data-copy-message]',`已复制维护入口：${value}`);
    }catch{
      flashMessage('[data-copy-message]',`维护入口：${value}`);
    }
  }));
  filterMembers();

  $('[data-login-sim]')?.addEventListener('click',()=>{
    const msg=$('[data-login-message]');
    const bar=$('[data-login-progress]');
    const steps=['正在打开统一登录页面...','正在校验成员身份...','身份校验通过，可以进入后台。'];
    let i=0;
    if(bar) bar.style.width='0%';
    const tick=()=>{ if(msg) msg.textContent=steps[i]; if(bar) bar.style.width=`${(i+1)*33.34}%`; if(++i<steps.length) setTimeout(tick,520); };
    tick();
  });

  const markdown=$('[data-post-markdown]');
  const preview=$('[data-markdown-preview]');
  function renderPreview(){
    if(!markdown||!preview) return;
    const escaped=markdown.value.replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
    preview.innerHTML=escaped.replace(/^# (.*)$/gm,'<strong>$1</strong>').replace(/\n/g,'<br>');
  }
  markdown?.addEventListener('input',renderPreview);
  renderPreview();

  $$('[data-admin-post]').forEach(item=>item.addEventListener('click',()=>{
    $$('[data-admin-post]').forEach(x=>x.classList.remove('active'));
    item.classList.add('active');
    const title=item.querySelector('strong')?.textContent||'未命名文章';
    const titleInput=$('[data-post-title]');
    if(titleInput) titleInput.value=title;
    const msg=$('[data-editor-message]');
    if(msg) msg.textContent='已载入文章，尚未保存修改。';
  }));

  $('[data-admin-post-search]')?.addEventListener('input',e=>{
    const q=e.target.value.trim().toLowerCase();
    $$('[data-admin-post]').forEach(item=>{ item.hidden=q&&!item.textContent.toLowerCase().includes(q); });
  });

  function flashMessage(selector,text){
    const el=$(selector);
    if(el) el.textContent=text;
  }
  if(!isLiveAdmin){
    $('[data-publish-post]')?.addEventListener('click',()=>flashMessage('[data-editor-message]','已发布：文章会出现在前台列表中。'));
    $('[data-save-draft]')?.addEventListener('click',()=>flashMessage('[data-editor-message]','草稿已保存，只有后台成员可见。'));
  }

  function runProgress(barSelector,messageSelector,doneText){
    const bar=$(barSelector), msg=$(messageSelector);
    let pct=0;
    if(bar) bar.style.width='0%';
    if(msg) msg.textContent='准备上传...';
    const timer=setInterval(()=>{
      pct=Math.min(100,pct+20);
      if(bar) bar.style.width=`${pct}%`;
      if(msg) msg.textContent=pct<100?`上传中... ${pct}%`:doneText;
      if(pct===100) clearInterval(timer);
    },260);
  }
  $('[data-upload-article-file]')?.addEventListener('click',()=>runProgress('[data-upload-progress]','[data-editor-message]','附件已上传，并加入文章下载区。'));
  $('[data-test-upload]')?.addEventListener('click',()=>runProgress('[data-upload-test-progress]','[data-upload-test-message]','大文件上传完成。'));

  $('[data-open-editor]')?.addEventListener('click',()=>{ const modal=$('[data-editor-modal]'); if(modal) modal.hidden=false; });
  $$('[data-close-editor]').forEach(btn=>btn.addEventListener('click',()=>{ const modal=$('[data-editor-modal]'); if(modal) modal.hidden=true; }));

  $('[data-save-member]')?.addEventListener('click',()=>{
    const name=$('[data-new-member-name]')?.value.trim()||'新成员';
    const dept=$('[data-new-member-dept]')?.value||'开发部';
    const term=$('[data-new-member-term]')?.value||'第九届';
    $('[data-admin-member-list]')?.insertAdjacentHTML('afterbegin',`<article class="member-card"><div class="avatar">${name.slice(0,2).toUpperCase()}</div><h3>${name}</h3><p>${term} · ${dept} · 已保存</p></article>`);
    flashMessage('[data-member-admin-message]','成员已保存到成员名册。');
  });

  $('[data-save-fame]')?.addEventListener('click',()=>{
    const name=$('[data-fame-admin-name]')?.value.trim()||'新名人堂条目';
    const title=$('[data-fame-admin-title]')?.value.trim()||'优秀成员';
    $('[data-admin-fame-list]')?.insertAdjacentHTML('afterbegin',`<div class="admin-item"><strong>${name}</strong><p>${title} · 已保存</p></div>`);
    flashMessage('[data-fame-admin-message]','名人堂条目已保存。');
  });

  if(!isLiveAdmin){
    $('[data-sync-markdown]')?.addEventListener('click',()=>flashMessage('[data-sync-message]','备份完成：当前文章、页面和成员资料已记录。'));
    $('[data-export-db]')?.addEventListener('click',()=>flashMessage('[data-db-message]','已导出站点数据备份。'));
    $('[data-import-db]')?.addEventListener('click',()=>flashMessage('[data-db-message]','导入完成：当前内容已按备份更新。'));
    $('[data-gallery-scale]')?.addEventListener('input',e=>flashMessage('[data-gallery-message]',`当前缩放：${Number(e.target.value).toFixed(2)}x`));
    $('[data-add-gallery]')?.addEventListener('click',()=>{
      $('[data-gallery-list]')?.insertAdjacentHTML('afterbegin','<div class="gallery-tile">新上传背景</div>');
      flashMessage('[data-gallery-message]','图片已裁剪并加入首页图库。');
    });
  }
})();
