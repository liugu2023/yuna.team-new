// 全站交互与小巧思：无依赖、空值安全；prefers-reduced-motion 下关闭所有动效类效果。
//   1. 顶栏：滚动收紧 .is-scrolled、≤1024px 下滑隐藏 .topbar-hide、汉堡全屏菜单 .nav-open、当前页滑动指示器 .nav-indicator
//   2. .reveal 入场：进入视口加 .visible，同一批进入的元素自动错开（--reveal-delay）；之后动态插入的 .reveal 也会被接管
//   3. 横滑标签条：右侧还有内容时加 .scroll-more
//   4. 聚光：.spotlight 或 [data-spotlight] 的直接子元素，pointermove 写 --x / --y（rAF 节流）
//   5. 计数：[data-count="数字"] 进入视口后滚动到目标值；data-count 之后被改写（如 posts.js 写入实时数）会重新计数
//   6. 关键词轮换：[data-rotator] > .rotator-word × N
//   7. 快捷键：[data-hotkey="/"] 在非输入状态按下该键时聚焦元素
//   8. 阅读进度：[data-scroll-progress] 写 --progress（0–1）；属性值可填选择器，只统计该元素范围
//   9. 正文增强：所有 .article-body 自动调用 markdown.js 的 enhanceArticleBody（标题锚点、代码块头栏与复制）
//  10. 后台标签页、办公室地图（原有功能）
//  11. 命令行胶囊 [data-copy-command]：点击复制命令（站点上的 `yuna join --with curiosity`）
// 所有选择器与 API 说明见 .ui-notes/SYSTEM-v2.md。
(function(){
  const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)");
  const compactNav=matchMedia("(max-width:1024px)");
  const finePointer=matchMedia("(hover:hover) and (pointer:fine)");
  const hasIO="IntersectionObserver" in window;

  /* ---------- 1. 顶栏 ---------- */
  const topbar=document.querySelector(".topbar");
  const topbarInner=topbar?topbar.querySelector(".topbar-inner"):null;
  const siteNav=topbarInner?topbarInner.querySelector(".nav"):null;
  const navItemSelector=":scope > a, :scope > button, [data-user-nav] > a, [data-user-nav] > button";
  const navItems=()=>siteNav?Array.from(siteNav.querySelectorAll(navItemSelector)):[];

  let lastY=Math.max(0,scrollY);
  let scrollQueued=false;
  const onScrollFrame=()=>{
    scrollQueued=false;
    const y=Math.max(0,scrollY);
    if(topbar){
      topbar.classList.toggle("is-scrolled",y>8);
      if(!compactNav.matches||topbar.classList.contains("nav-open")||y<=80) topbar.classList.remove("topbar-hide");
      else if(y>lastY+6) topbar.classList.add("topbar-hide");
      else if(y<lastY-6) topbar.classList.remove("topbar-hide");
    }
    updateProgress();
    lastY=y;
  };
  const onScroll=()=>{
    if(scrollQueued) return;
    scrollQueued=true;
    requestAnimationFrame(onScrollFrame);
  };
  addEventListener("scroll",onScroll,{passive:true});
  topbar?.addEventListener("focusin",()=>topbar.classList.remove("topbar-hide"));

  if(topbar&&topbarInner&&siteNav){
    if(!siteNav.id) siteNav.id="siteNav";

    // 汉堡按钮 + 全屏菜单：点链接、点菜单空白处、焦点离开顶栏、按 Esc、回到桌面宽度时收起
    const navToggle=document.createElement("button");
    navToggle.type="button";
    navToggle.className="nav-toggle";
    navToggle.setAttribute("aria-controls",siteNav.id);
    navToggle.setAttribute("aria-expanded","false");
    navToggle.setAttribute("aria-label","打开导航菜单");
    navToggle.innerHTML="<span></span><span></span>";
    topbarInner.appendChild(navToggle);
    const isOpen=()=>topbar.classList.contains("nav-open");
    const setNavOpen=(open)=>{
      topbar.classList.toggle("nav-open",open);
      document.body.classList.toggle("menu-open",open&&compactNav.matches);
      if(open) topbar.classList.remove("topbar-hide");
      navToggle.setAttribute("aria-expanded",String(open));
      navToggle.setAttribute("aria-label",open?"关闭导航菜单":"打开导航菜单");
    };
    navToggle.addEventListener("click",()=>setNavOpen(!isOpen()));
    siteNav.addEventListener("click",e=>{
      if(!isOpen()) return;
      if(e.target===siteNav||(e.target instanceof Element&&e.target.closest("a,button"))) setNavOpen(false);
    });
    document.addEventListener("click",e=>{if(isOpen()&&e.target instanceof Node&&!topbar.contains(e.target)) setNavOpen(false);});
    topbar.addEventListener("focusout",e=>{
      if(isOpen()&&e.relatedTarget instanceof Node&&!topbar.contains(e.relatedTarget)) setNavOpen(false);
    });
    addEventListener("keydown",e=>{
      if(e.key==="Escape"&&isOpen()){setNavOpen(false);navToggle.focus();}
    });
    compactNav.addEventListener?.("change",e=>{if(!e.matches) setNavOpen(false);});

    // 菜单项错开入场用的序号（按视觉顺序：普通链接 → CTA → 登录态链接）
    const indexNavItems=()=>{
      const items=navItems();
      const rank=el=>el.classList.contains("nav-cta")?1:(el.parentElement&&el.parentElement.hasAttribute("data-user-nav"))||el.hasAttribute("data-logout")?2:0;
      items.slice().sort((a,b)=>rank(a)-rank(b)).forEach((el,i)=>el.style.setProperty("--i",String(i)));
    };

    // 桌面端滑动指示器：静止时停在当前页，悬停 / 键盘聚焦时滑过去
    const indicator=document.createElement("span");
    indicator.className="nav-indicator";
    indicator.setAttribute("aria-hidden","true");
    siteNav.prepend(indicator);
    siteNav.classList.add("has-indicator");
    const indicatorTargets=()=>navItems().filter(el=>!el.classList.contains("nav-cta"));
    const activeItem=()=>indicatorTargets().find(el=>el.classList.contains("active")||el.getAttribute("aria-current")==="page")||null;
    let indicatorOn=null;
    const moveIndicator=(el,instant)=>{
      if(!el||compactNav.matches){
        indicator.classList.remove("is-visible");
        indicatorOn=null;
        return;
      }
      const jump=instant||reduceMotion.matches||!indicator.classList.contains("is-visible");
      if(jump) indicator.classList.add("no-transition");
      indicator.style.setProperty("--indicator-x",`${el.offsetLeft}px`);
      indicator.style.setProperty("--indicator-w",`${el.offsetWidth}px`);
      indicator.classList.add("is-visible");
      indicatorOn=el;
      if(jump){
        void indicator.offsetWidth;
        requestAnimationFrame(()=>indicator.classList.remove("no-transition"));
      }
    };
    const itemFrom=target=>{
      if(!(target instanceof Element)) return null;
      const el=target.closest("a,button");
      return el&&indicatorTargets().includes(el)?el:null;
    };
    siteNav.addEventListener("pointerover",e=>{const el=itemFrom(e.target);if(el) moveIndicator(el);});
    siteNav.addEventListener("pointerleave",()=>moveIndicator(activeItem()));
    siteNav.addEventListener("focusin",e=>{const el=itemFrom(e.target);if(el) moveIndicator(el);});
    siteNav.addEventListener("focusout",e=>{
      if(!(e.relatedTarget instanceof Node)||!siteNav.contains(e.relatedTarget)) moveIndicator(activeItem());
    });
    const resync=()=>moveIndicator(indicatorOn&&indicatorOn.isConnected?indicatorOn:activeItem(),true);
    addEventListener("resize",resync);
    compactNav.addEventListener?.("change",resync);
    document.fonts?.ready.then(resync);
    // nav.js 异步替换登录态链接后重新定位、重新编号
    new MutationObserver(()=>{indexNavItems();resync();}).observe(siteNav,{childList:true,subtree:true});
    indexNavItems();
    resync();
  }

  /* ---------- 8. 阅读进度 ---------- */
  function updateProgress(){
    const bars=document.querySelectorAll("[data-scroll-progress]");
    if(!bars.length) return;
    bars.forEach(bar=>{
      const selector=bar.getAttribute("data-scroll-progress");
      const scope=selector?document.querySelector(selector):null;
      let start=0;
      let end=document.documentElement.scrollHeight-innerHeight;
      if(scope){
        const rect=scope.getBoundingClientRect();
        start=rect.top+scrollY-innerHeight*.2;
        end=rect.bottom+scrollY-innerHeight;
      }
      const range=end-start;
      const progress=range>0?Math.min(1,Math.max(0,(scrollY-start)/range)):0;
      if(bar instanceof HTMLElement) bar.style.setProperty("--progress",progress.toFixed(4));
    });
  }
  addEventListener("resize",updateProgress);
  onScrollFrame();

  /* ---------- 2. reveal ---------- */
  const revealSeen=new WeakSet();
  const revealIO=hasIO?new IntersectionObserver(entries=>{
    let batch=0;
    entries.forEach(entry=>{
      if(!entry.isIntersecting) return;
      const el=entry.target;
      revealIO.unobserve(el);
      if(batch&&!reduceMotion.matches&&el instanceof HTMLElement) el.style.setProperty("--reveal-delay",`${Math.min(batch*70,350)}ms`);
      batch+=1;
      el.classList.add("visible");
    });
  },{threshold:0,rootMargin:"0px 0px -8% 0px"}):null;
  const bindReveal=el=>{
    if(revealSeen.has(el)||el.classList.contains("visible")) return;
    revealSeen.add(el);
    if(revealIO) revealIO.observe(el);
    else el.classList.add("visible");
  };

  /* ---------- 3. 横滑标签条 ---------- */
  const stripSel=".tabs,.team-term-switcher,.resource-tabs,.admin-tabs";
  const stripSeen=new WeakSet();
  const bindStrip=el=>{
    if(stripSeen.has(el)) return;
    stripSeen.add(el);
    const sync=()=>el.classList.toggle("scroll-more",el.scrollWidth-el.clientWidth-el.scrollLeft>12);
    el.addEventListener("scroll",sync,{passive:true});
    addEventListener("resize",sync);
    new MutationObserver(sync).observe(el,{childList:true,subtree:true});
    sync();
  };

  /* ---------- 5. 计数 ---------- */
  const countSeen=new WeakSet();
  const countBound=new WeakSet();
  const countFrames=new WeakMap();
  const formatCount=n=>Math.round(n).toLocaleString("zh-CN");
  const runCount=el=>{
    const to=Number(el.getAttribute("data-count"));
    if(!Number.isFinite(to)) return;
    const previous=countFrames.get(el);
    if(previous) cancelAnimationFrame(previous);
    if(reduceMotion.matches||to<=0){el.textContent=formatCount(to);return;}
    const parsed=parseInt((el.textContent||"").replace(/[^\d]/g,""),10);
    const from=Number.isFinite(parsed)&&parsed<to?parsed:0;
    const duration=Math.min(2000,900+Math.log10(to+1)*300);
    const startAt=performance.now();
    const step=now=>{
      const p=Math.min(1,(now-startAt)/duration);
      const eased=p>=1?1:1-Math.pow(2,-10*p);
      el.textContent=formatCount(from+(to-from)*eased);
      if(p<1) countFrames.set(el,requestAnimationFrame(step));
      else countFrames.delete(el);
    };
    countFrames.set(el,requestAnimationFrame(step));
  };
  const countIO=hasIO?new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting) return;
      countIO.unobserve(entry.target);
      countSeen.add(entry.target);
      runCount(entry.target);
    });
  },{threshold:.5}):null;
  const countAttrs=new MutationObserver(records=>{
    records.forEach(record=>{
      const el=record.target;
      if(!(el instanceof Element)) return;
      if(countSeen.has(el)||!countIO) runCount(el);
      else if(!reduceMotion.matches&&Number.isFinite(Number(el.getAttribute("data-count")))) el.textContent="0";
    });
  });
  const bindCount=el=>{
    if(countBound.has(el)) return;
    countBound.add(el);
    countAttrs.observe(el,{attributes:true,attributeFilter:["data-count"]});
    if(!countIO){runCount(el);return;}
    if(!reduceMotion.matches&&Number.isFinite(Number(el.getAttribute("data-count")))) el.textContent="0";
    countIO.observe(el);
  };

  /* ---------- 6. 关键词轮换 ---------- */
  const rotatorSeen=new WeakSet();
  const bindRotator=el=>{
    if(rotatorSeen.has(el)) return;
    rotatorSeen.add(el);
    const words=Array.from(el.querySelectorAll(".rotator-word"));
    if(words.length<2||reduceMotion.matches||!(el instanceof HTMLElement)) return;
    let index=0;
    el.classList.add("is-ready");
    words[0].classList.add("is-active");
    const fit=()=>{el.style.width=`${words[index] instanceof HTMLElement?words[index].offsetWidth:0}px`;};
    fit();
    addEventListener("resize",fit);
    document.fonts?.ready.then(fit);
    setInterval(()=>{
      if(document.hidden) return;
      const prev=words[index];
      index=(index+1)%words.length;
      const next=words[index];
      prev.classList.remove("is-active");
      prev.classList.add("is-leaving");
      next.classList.remove("is-leaving");
      next.classList.add("is-active");
      fit();
      setTimeout(()=>prev.classList.remove("is-leaving"),700);
    },2600);
  };

  /* ---------- 统一扫描：首屏 + 之后动态插入的节点 ---------- */
  const scan=()=>{
    document.querySelectorAll(".reveal").forEach(bindReveal);
    document.querySelectorAll(stripSel).forEach(bindStrip);
    document.querySelectorAll("[data-count]").forEach(bindCount);
    document.querySelectorAll("[data-rotator]").forEach(bindRotator);
    const enhance=window.blog&&window.blog.enhanceArticleBody;
    if(typeof enhance==="function") document.querySelectorAll(".article-body").forEach(el=>enhance(el));
  };
  scan();
  let scanQueued=false;
  new MutationObserver(()=>{
    if(scanQueued) return;
    scanQueued=true;
    requestAnimationFrame(()=>{scanQueued=false;scan();});
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["data-count"]});

  /* ---------- 4. 聚光 ---------- */
  if(finePointer.matches&&!reduceMotion.matches){
    let pending=null;
    let frame=0;
    document.addEventListener("pointermove",e=>{
      if(e.pointerType&&e.pointerType!=="mouse") return;
      const target=e.target instanceof Element?e.target.closest(".spotlight, [data-spotlight] > *"):null;
      if(!(target instanceof HTMLElement)) return;
      pending={el:target,x:e.clientX,y:e.clientY};
      if(frame) return;
      frame=requestAnimationFrame(()=>{
        frame=0;
        if(!pending) return;
        const rect=pending.el.getBoundingClientRect();
        pending.el.style.setProperty("--x",`${(pending.x-rect.left).toFixed(1)}px`);
        pending.el.style.setProperty("--y",`${(pending.y-rect.top).toFixed(1)}px`);
      });
    },{passive:true});
  }

  /* ---------- 7. 快捷键 ---------- */
  document.addEventListener("keydown",e=>{
    if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.isComposing) return;
    const active=e.target;
    if(active instanceof HTMLElement&&(active.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
    if(document.body.classList.contains("modal-open")) return;
    const target=Array.from(document.querySelectorAll("[data-hotkey]")).find(el=>el.getAttribute("data-hotkey")===e.key&&el instanceof HTMLElement&&el.offsetParent!==null);
    if(!(target instanceof HTMLElement)) return;
    e.preventDefault();
    target.focus();
    if(target instanceof HTMLInputElement) target.select();
  });
})();

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
})();

/* ---------- 11. 命令行胶囊：点击复制真实命令 ----------
   站点上的 `yuna join --with curiosity` 只是一个装饰胶囊；这里让它真的可用：
   复制 data-copy-command 里的命令，复制失败时直接把命令显示出来让人手动选中。 */
(function(){
  const buttons=document.querySelectorAll("[data-copy-command]");
  if(!buttons.length) return;

  function legacyCopy(text){
    try{
      const area=document.createElement("textarea");
      area.value=text;
      area.setAttribute("readonly","");
      area.style.position="fixed";
      area.style.top="-1000px";
      area.style.opacity="0";
      document.body.appendChild(area);
      area.select();
      const ok=document.execCommand("copy");
      area.remove();
      return ok;
    }catch(error){ return false; }
  }

  function copyText(text){
    if(navigator.clipboard&&window.isSecureContext){
      return navigator.clipboard.writeText(text).then(()=>true,()=>legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  buttons.forEach((button)=>{
    const command=button.getAttribute("data-copy-command")||"";
    if(!command) return;
    const original=button.innerHTML;
    let timer=0;
    let busy=false;
    button.addEventListener("click",()=>{
      if(busy) return;
      busy=true;
      copyText(command).then((ok)=>{
        button.classList.toggle("is-copied",ok);
        button.innerHTML=ok
          ?'<span aria-hidden="true">$</span> 已复制，粘到终端运行'
          :'<span aria-hidden="true">$</span> '+command.replace(/[<>&]/g,"");
        clearTimeout(timer);
        timer=setTimeout(()=>{
          button.innerHTML=original;
          button.classList.remove("is-copied");
          busy=false;
        },ok?2400:5000);
      });
    });
  });
})();
