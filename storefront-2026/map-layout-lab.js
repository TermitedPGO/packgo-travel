/* THROWAWAY PROTOTYPE — one automatic route-layout engine, four itinerary-density stress cases. */
const BC_MAP_LAYOUT_LAB_CASES = [
  {
    id: "spain",
    country: { zh:"西班牙", en:"Spain" },
    title: { zh:"卡斯提亞到巴斯克・五日", en:"Castile to the Basque Country · 5 days" },
    summary: { zh:"單向跨區路線：測試長短陸路、城市標籤與不折返的順序。", en:"Open-jaw route testing mixed ground legs, city labels and a clean forward sequence." },
    days: [
      { day:1, city:{zh:"馬德里",en:"Madrid"}, metroKey:"madrid", geo:[40.4168,-3.7038] },
      { day:2, city:{zh:"塞戈維亞",en:"Segovia"}, metroKey:"segovia", geo:[40.9429,-4.1088] },
      { day:3, city:{zh:"薩拉曼卡",en:"Salamanca"}, metroKey:"salamanca", geo:[40.9701,-5.6635] },
      { day:4, city:{zh:"巴利亞多利德",en:"Valladolid"}, metroKey:"valladolid", geo:[41.6523,-4.7245] },
      { day:5, city:{zh:"畢爾巴鄂",en:"Bilbao"}, metroKey:"bilbao", geo:[43.2630,-2.9350] }
    ],
    legs:["rail","road","rail","road"]
  },
  {
    id: "japan",
    country: { zh:"日本", en:"Japan" },
    title: { zh:"富士與古都慢旅・七日", en:"Fuji and Ancient Capitals · 7 days" },
    summary: { zh:"重複城市與航空回程：東京、京都群組必須保留真實錨點。", en:"Repeated metros and an air return: Tokyo and Kyoto must retain true geographic anchors." },
    days: [
      { day:1, city:{zh:"東京羽田",en:"Tokyo Haneda"}, metroKey:"tokyo", geo:[35.5494,139.7798] },
      { day:2, city:{zh:"東京下町",en:"Old Tokyo"}, metroKey:"tokyo", geo:[35.7148,139.7967] },
      { day:3, city:{zh:"河口湖",en:"Kawaguchiko"}, metroKey:"kawaguchiko", geo:[35.5171,138.7518] },
      { day:4, city:{zh:"京都",en:"Kyoto"}, metroKey:"kyoto", geo:[34.9858,135.7588] },
      { day:5, city:{zh:"京都古寺",en:"Kyoto temples"}, metroKey:"kyoto", geo:[35.0037,135.7788] },
      { day:6, city:{zh:"大阪",en:"Osaka"}, metroKey:"osaka", geo:[34.6937,135.5023] },
      { day:7, city:{zh:"東京羽田",en:"Tokyo Haneda"}, metroKey:"tokyo", geo:[35.5520,139.7860] }
    ],
    legs:["local","road","rail","local","rail","air"]
  },
  {
    id: "italy",
    country: { zh:"義大利", en:"Italy" },
    title: { zh:"古城、湖區與北義・九日", en:"Cities, Lakes and Northern Italy · 9 days" },
    summary: { zh:"長行程與雙城市群：測試九天密度、重複住宿城市與手機降階。", en:"A longer route with two repeated metros, testing nine-day density and mobile fallback." },
    days: [
      { day:1, city:{zh:"羅馬機場",en:"Rome Fiumicino"}, metroKey:"rome", geo:[41.8003,12.2389] },
      { day:2, city:{zh:"羅馬古城",en:"Historic Rome"}, metroKey:"rome", geo:[41.9028,12.4964] },
      { day:3, city:{zh:"佛羅倫斯",en:"Florence"}, metroKey:"florence", geo:[43.7696,11.2558] },
      { day:4, city:{zh:"波隆那",en:"Bologna"}, metroKey:"bologna", geo:[44.4949,11.3426] },
      { day:5, city:{zh:"威尼斯",en:"Venice"}, metroKey:"venice", geo:[45.4408,12.3155] },
      { day:6, city:{zh:"維洛納",en:"Verona"}, metroKey:"verona", geo:[45.4384,10.9916] },
      { day:7, city:{zh:"米蘭",en:"Milan"}, metroKey:"milan", geo:[45.4642,9.1900] },
      { day:8, city:{zh:"科莫湖",en:"Lake Como"}, metroKey:"como", geo:[45.9840,9.2572] },
      { day:9, city:{zh:"米蘭機場",en:"Milan Malpensa"}, metroKey:"milan", geo:[45.6301,8.7231] }
    ],
    legs:["local","rail","rail","rail","rail","rail","road","road"]
  },
  {
    id: "med-cruise",
    journeyType: "cruise",
    country: { zh:"地中海郵輪", en:"Mediterranean cruise" },
    title: { zh:"西地中海到亞得里亞海・二十日", en:"Western Mediterranean to the Adriatic · 20 days" },
    summary: { zh:"長程郵輪壓力測試：20 個日期全部可點，桌機滑過查看港名，海上日也保留在旅程順序。", en:"A long-cruise stress test: all 20 days remain interactive, with port names revealed on desktop hover and sea days retained in sequence." },
    days: [
      { day:1, city:{zh:"巴塞隆納登船",en:"Embark Barcelona"}, metroKey:"barcelona", geo:[41.3500,2.1500], major:true, kind:"port" },
      { day:2, city:{zh:"馬賽",en:"Marseille"}, metroKey:"marseille", geo:[43.2965,5.3698], kind:"port" },
      { day:3, city:{zh:"熱那亞",en:"Genoa"}, metroKey:"genoa", geo:[44.4056,8.9463], kind:"port" },
      { day:4, city:{zh:"羅馬・奇維塔韋基亞",en:"Rome · Civitavecchia"}, metroKey:"civitavecchia", geo:[42.0924,11.7957], major:true, kind:"port" },
      { day:5, city:{zh:"拿坡里",en:"Naples"}, metroKey:"naples", geo:[40.8518,14.2681], kind:"port" },
      { day:6, city:{zh:"巴勒摩",en:"Palermo"}, metroKey:"palermo", geo:[38.1157,13.3615], kind:"port" },
      { day:7, city:{zh:"海上巡航",en:"At sea"}, metroKey:"sea-07", geo:[36.8000,14.3000], kind:"sea" },
      { day:8, city:{zh:"瓦萊塔",en:"Valletta"}, metroKey:"valletta", geo:[35.8989,14.5146], kind:"port" },
      { day:9, city:{zh:"海上巡航",en:"At sea"}, metroKey:"sea-09", geo:[35.6000,17.2000], kind:"sea" },
      { day:10, city:{zh:"聖托里尼",en:"Santorini"}, metroKey:"santorini", geo:[36.3932,25.4615], kind:"port" },
      { day:11, city:{zh:"雅典・比雷埃夫斯",en:"Athens · Piraeus"}, metroKey:"piraeus", geo:[37.9420,23.6465], major:true, kind:"port" },
      { day:12, city:{zh:"米克諾斯",en:"Mykonos"}, metroKey:"mykonos", geo:[37.4467,25.3289], kind:"port" },
      { day:13, city:{zh:"庫薩達西",en:"Kuşadası"}, metroKey:"kusadasi", geo:[37.8597,27.2566], kind:"port" },
      { day:14, city:{zh:"羅德島",en:"Rhodes"}, metroKey:"rhodes", geo:[36.4349,28.2176], kind:"port" },
      { day:15, city:{zh:"海上巡航",en:"At sea"}, metroKey:"sea-15", geo:[35.5000,25.5000], kind:"sea" },
      { day:16, city:{zh:"克里特・哈尼亞",en:"Crete · Chania"}, metroKey:"chania", geo:[35.5138,24.0180], kind:"port" },
      { day:17, city:{zh:"海上巡航",en:"At sea"}, metroKey:"sea-17", geo:[38.5000,19.0000], kind:"sea" },
      { day:18, city:{zh:"杜布羅夫尼克",en:"Dubrovnik"}, metroKey:"dubrovnik", geo:[42.6507,18.0944], kind:"port" },
      { day:19, city:{zh:"斯普利特",en:"Split"}, metroKey:"split", geo:[43.5081,16.4402], kind:"port" },
      { day:20, city:{zh:"威尼斯離船",en:"Disembark Venice"}, metroKey:"venice", geo:[45.4408,12.3155], major:true, kind:"port" }
    ],
    legs:Array(19).fill("cruise")
  }
];

let bcMapLayoutLabInstances = [];

function bcMapLayoutLabText(value) {
  if (typeof value === "string") return value;
  return state.language === "zh" ? value.zh : value.en;
}

function bcMapLayoutModeLabel(mode) {
  return ({
    local:{zh:"市內",en:"Local"}, road:{zh:"陸路",en:"Road"}, rail:{zh:"鐵路",en:"Rail"}, air:{zh:"航空",en:"Air"}, cruise:{zh:"郵輪",en:"Cruise"}
  })[mode] || {zh:mode,en:mode};
}

function mapLayoutLabBC() {
  const cases = BC_MAP_LAYOUT_LAB_CASES.map((journey,index) => {
    const isLong=journey.days.length>=13;
    const isCruise=journey.journeyType==="cruise";
    const days = journey.days.map(day => `<button type="button" data-layout-day="${day.day}" aria-pressed="${day.day===1}"><b>DAY ${String(day.day).padStart(2,"0")}</b><span>${bcMapLayoutLabText(day.city)}</span></button>`).join("");
    const status=isCruise
      ? `<span>${L("點線：郵輪航線","DOTTED · CRUISE ROUTE")}</span><span>${L("數字：每日港口／海上日","NUMBER · PORT / SEA DAY")}</span><span>${L("滑過數字：查看港名","HOVER NUMBER · PORT NAME")}</span>`
      : `<span>${L("實線：陸路／鐵路","SOLID · GROUND / RAIL")}</span><span>${L("虛線：航空","DASHED · AIR")}</span><span>${L("滑過數字：查看地名","HOVER NUMBER · PLACE NAME")}</span>`;
    return `<section class="bc-layout-case ${isLong?"is-long":""} ${isCruise?"is-cruise":""}" id="layout-${journey.id}">
      <header class="bc-layout-case-head">
        <div><p class="eyebrow">CASE ${String(index+1).padStart(2,"0")} · ${journey.days.length} DAYS · AUTO LAYOUT</p><h2>${bcMapLayoutLabText(journey.title)}</h2></div>
        <p>${bcMapLayoutLabText(journey.summary)}</p>
      </header>
      ${isCruise?`<p class="bc-layout-pan-cue">${L("← 左右滑動地圖；點下方日期查看完整港名 →","← Swipe the map; tap a day below for the full port name →")}</p>`:""}
      <div class="bc-layout-map-frame">
        <div class="bc-layout-map" data-layout-map="${journey.id}" aria-label="${bcMapLayoutLabText(journey.country)} ${journey.days.length} ${L("日行程自動排版地圖","day automatic route map")}"></div>
        <div class="bc-layout-map-status">${status}</div>
        <small class="bc-layout-attribution"><a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · ${L("路線與排版為設計示意","route and layout are design demos")}</small>
      </div>
      <div class="bc-layout-case-foot"><div class="bc-layout-day-rail" style="--day-count:${journey.days.length}" aria-label="${L("每日路線","Daily route")}">${days}</div><p class="bc-layout-selection" aria-live="polite">DAY 01 · ${bcMapLayoutLabText(journey.days[0].city)}</p></div>
    </section>`;
  }).join("");
  return `<main class="bc-layout-lab">
    <section class="bc-layout-lab-hero"><div><p class="eyebrow">THROWAWAY MAP LAYOUT LAB · DESIGN DEMO</p><h1>${L("同一套引擎，跑四種旅程密度。","One engine across four itinerary densities.")}</h1></div><p>${L("從五日陸路到二十日郵輪，先驗證地理錨點、標籤避讓、交通分段與方向，再決定是否替換詳情頁地圖。這裡不會建立訂位或送出資料。","From a five-day ground route to a 20-day cruise, validate geographic anchors, label avoidance, transport legs and direction before replacing the detail-page map. No booking or data submission occurs here.")}</p></section>
    <nav class="bc-layout-lab-index" aria-label="${L("測試案例","Test cases")}">${BC_MAP_LAYOUT_LAB_CASES.map(item=>`<a href="#layout-${item.id}"><b>${bcMapLayoutLabText(item.country)}</b><span>${item.days.length} ${L("日","days")}</span></a>`).join("")}</nav>
    ${cases}
  </main>`;
}

function bcDestroyMapLayoutLab() {
  bcMapLayoutLabInstances.forEach(map => { try { map.remove(); } catch (_) {} });
  bcMapLayoutLabInstances = [];
}

function bcLayoutLabCurve(from,to,mode,index) {
  const start=[from[1],from[0]],end=[to[1],to[0]];
  const dx=end[0]-start[0],dy=end[1]-start[1],distance=Math.hypot(dx,dy);
  if (distance < .025) return [start,end];
  const air=mode==="air";
  const cruise=mode==="cruise";
  const direction=air?1:(index%2===0?1:-1);
  const bend=Math.min(distance*(air?.22:cruise?.025:.055),air?1.15:cruise?.15:.18)*direction;
  const control=[(start[0]+end[0])/2-(dy/distance)*bend,(start[1]+end[1])/2+(dx/distance)*bend];
  const pointCount=air?25:13;
  return Array.from({length:pointCount},(_,step)=>{
    const t=step/(pointCount-1),r=1-t;
    return [r*r*start[0]+2*r*t*control[0]+t*t*end[0],r*r*start[1]+2*r*t*control[1]+t*t*end[1]];
  });
}

function bcLayoutLabPreviewRect(button,direction,width,height=32) {
  const rect=button.getBoundingClientRect(),gap=7;
  if(direction==="left") return {left:rect.left+4-width,right:rect.left+4,top:rect.top+(rect.height-height)/2,bottom:rect.top+(rect.height+height)/2};
  if(direction==="top") return {left:rect.left+rect.width/2-width/2,right:rect.left+rect.width/2+width/2,top:rect.top-gap-height,bottom:rect.top-gap};
  if(direction==="bottom") return {left:rect.left+rect.width/2-width/2,right:rect.left+rect.width/2+width/2,top:rect.bottom+gap,bottom:rect.bottom+gap+height};
  return {left:rect.right-4,right:rect.right-4+width,top:rect.top+(rect.height-height)/2,bottom:rect.top+(rect.height+height)/2};
}

function bcLayoutLabPlacePreviewName(button) {
  const caseRoot=button.closest(".bc-layout-case,.bc-journey-map-scope"),map=button.closest(".bc-layout-map"),span=button.querySelector("span");
  if(!caseRoot||!map||!span)return;
  const mapRect=map.getBoundingClientRect(),root=button.closest(".bc-layout-marker-root");
  const width=Math.min(170,Math.max(48,span.scrollWidth+24)),height=32,edgeGap=10,safetyGap=6;
  const buttons=[...caseRoot.querySelectorAll(".bc-layout-marker-labels button")].filter(item=>item!==button).map(item=>item.getBoundingClientRect());
  const fixed=[caseRoot.querySelector(".bc-layout-map-status"),caseRoot.querySelector(".bc-layout-attribution")].filter(Boolean).map(item=>item.getBoundingClientRect());
  const rootPrefersLeft=root?.classList.contains("pos-left")||root?.classList.contains("pos-top-left")||root?.classList.contains("pos-bottom-left");
  const order=root?.classList.contains("is-cluster")?["bottom","top",rootPrefersLeft?"left":"right",rootPrefersLeft?"right":"left"]:[rootPrefersLeft?"left":"right",rootPrefersLeft?"right":"left","bottom","top"];
  let best={direction:order[0],score:Infinity};
  order.forEach((direction,rank)=>{
    const rect=bcLayoutLabPreviewRect(button,direction,width,height);
    const overflow=Math.max(0,mapRect.left+edgeGap-rect.left)+Math.max(0,rect.right-(mapRect.right-edgeGap))+Math.max(0,mapRect.top+edgeGap-rect.top)+Math.max(0,rect.bottom-(mapRect.bottom-edgeGap));
    let score=overflow*10000+rank*.1;
    [...buttons,...fixed].forEach(obstacle=>{
      const overlapX=Math.max(0,Math.min(rect.right,obstacle.right+safetyGap)-Math.max(rect.left,obstacle.left-safetyGap));
      const overlapY=Math.max(0,Math.min(rect.bottom,obstacle.bottom+safetyGap)-Math.max(rect.top,obstacle.top-safetyGap));
      score+=overlapX*overlapY*100;
    });
    if(score<best.score)best={direction,score};
  });
  button.classList.remove("name-left","name-right","name-top","name-bottom");
  button.classList.add(`name-${best.direction}`);
}

function bcLayoutLabMarkerButton(day,isLong,selectedDay=1) {
  const button=document.createElement("button");
  button.type="button";
  button.dataset.layoutDay=String(day.day);
  button.className=`${isLong?"is-compact ":""}${day.kind==="sea"?"is-sea":""}`.trim();
  button.setAttribute("aria-pressed",String(day.day===selectedDay));
  button.setAttribute("aria-label",`DAY ${String(day.day).padStart(2,"0")} · ${bcMapLayoutLabText(day.city)}`);
  button.innerHTML=`<b>${String(day.day).padStart(2,"0")}</b><span>${bcMapLayoutLabText(day.city)}</span>`;
  if(matchMedia("(hover:hover)").matches){
    const showName=()=>{bcLayoutLabPlacePreviewName(button);button.classList.add("is-preview");},hideName=()=>button.classList.remove("is-preview");
    button.addEventListener("pointerenter",showName);
    button.addEventListener("pointerleave",hideName);
    button.addEventListener("focus",showName);
    button.addEventListener("blur",hideName);
  }
  return button;
}

function bcMountMapLayoutLabMap(target,journey,options={}) {
  const isLong=journey.days.length>=13;
  const isCruise=journey.journeyType==="cruise";
  const selectedDay=Number(options.selectedDay)||1;
  const map=new maplibregl.Map({container:target,style:"https://tiles.openfreemap.org/styles/positron",center:[journey.days[0].geo[1],journey.days[0].geo[0]],zoom:5,interactive:false,attributionControl:false,fadeDuration:0,renderWorldCopies:false,localIdeographFontFamily:'"Noto Sans TC", system-ui, sans-serif'});
  bcMapLayoutLabInstances.push(map);
  map.on("load",()=>{
    if (!document.body.contains(target)) return;
    const caseRoot=options.scope||target.closest(".bc-layout-case,.bc-journey-map-scope");
    const markerScope=caseRoot||target;
    const bounds=new maplibregl.LngLatBounds();
    journey.days.forEach(day=>bounds.extend([day.geo[1],day.geo[0]]));
    map.fitBounds(bounds,{padding:matchMedia("(max-width:760px)").matches?{top:100,right:52,bottom:104,left:52}:{top:110,right:isLong?105:150,bottom:120,left:isLong?105:150},maxZoom:7.2,duration:0});
    const features=[];
    journey.days.slice(0,-1).forEach((day,index)=>{
      const next=journey.days[index+1],mode=journey.legs[index] || "road";
      const coordinates=bcLayoutLabCurve(day.geo,next.geo,mode,index);
      if (Math.hypot(day.geo[0]-next.geo[0],day.geo[1]-next.geo[1])<.006) return;
      features.push({type:"Feature",properties:{mode,from:day.day,to:next.day},geometry:{type:"LineString",coordinates}});
    });
    const routeCollection={type:"FeatureCollection",features};
    map.addSource("layout-route",{type:"geojson",data:routeCollection});
    map.addLayer({id:"layout-route-halo",type:"line",source:"layout-route",paint:{"line-color":"#fff","line-width":5.5,"line-opacity":.96},layout:{"line-cap":"round","line-join":"round"}});
    map.addLayer({id:"layout-route-ground",type:"line",source:"layout-route",filter:["all",["!=",["get","mode"],"air"],["!=",["get","mode"],"local"],["!=",["get","mode"],"cruise"]],paint:{"line-color":"#111","line-width":1.9,"line-opacity":.96},layout:{"line-cap":"round","line-join":"round"}});
    map.addLayer({id:"layout-route-local",type:"line",source:"layout-route",filter:["==",["get","mode"],"local"],paint:{"line-color":"#111","line-width":1.35,"line-opacity":.9},layout:{"line-cap":"round","line-join":"round"}});
    map.addLayer({id:"layout-route-air",type:"line",source:"layout-route",filter:["==",["get","mode"],"air"],paint:{"line-color":"#111","line-width":1.9,"line-dasharray":[2.4,2.2],"line-opacity":.96},layout:{"line-cap":"round","line-join":"round"}});
    map.addLayer({id:"layout-route-cruise",type:"line",source:"layout-route",filter:["==",["get","mode"],"cruise"],paint:{"line-color":"#111","line-width":1.8,"line-dasharray":[.7,1.55],"line-opacity":.96},layout:{"line-cap":"round","line-join":"round"}});

    const hubs=new Map();
    journey.days.forEach(day=>{ const list=hubs.get(day.metroKey)||[]; list.push(day); hubs.set(day.metroKey,list); });
    const markerRecords=[];
    hubs.forEach(days=>{
      const coordinate=days.reduce((sum,day)=>[sum[0]+day.geo[1]/days.length,sum[1]+day.geo[0]/days.length],[0,0]);
      const root=document.createElement("div");
      root.className=`bc-layout-marker-root ${days.length>1?"is-cluster":"is-single"} pos-top`;
      root.innerHTML=`<i class="bc-layout-geo-anchor" aria-hidden="true"></i><i class="bc-layout-leader" aria-hidden="true"></i>`;
      const labels=document.createElement("div"); labels.className="bc-layout-marker-labels";
      days.forEach(day=>labels.append(bcLayoutLabMarkerButton(day,isLong,selectedDay)));
      root.append(labels);
      new maplibregl.Marker({element:root,anchor:"center"}).setLngLat(coordinate).addTo(map);
      markerRecords.push({root,labels,days,coordinate});
      if(days.length>1) days.forEach(day=>{
        const anchor=document.createElement("span"); anchor.className="bc-layout-day-anchor"; anchor.dataset.anchorDay=String(day.day); anchor.setAttribute("aria-hidden","true");
        new maplibregl.Marker({element:anchor,anchor:"center"}).setLngLat([day.geo[1],day.geo[0]]).addTo(map);
      });
    });

    const arrowRecords=features.map((feature,routeIndex)=>({feature,routeIndex})).filter(({feature,routeIndex})=>feature.properties.mode!=="cruise"||routeIndex%3===1||routeIndex===features.length-1).map(({feature,routeIndex})=>{
      const coordinates=feature.geometry.coordinates,index=Math.floor(coordinates.length*.58),point=coordinates[index],next=coordinates[Math.min(coordinates.length-1,index+1)];
      const el=document.createElement("span"); el.className=`bc-layout-route-arrow is-${feature.properties.mode}`; el.innerHTML="<i></i>"; el.setAttribute("aria-hidden","true");
      const marker=new maplibregl.Marker({element:el,anchor:"center"}).setLngLat(point).addTo(map);
      return {el,marker,routeIndex};
    });

    const candidates=["pos-top","pos-bottom","pos-left","pos-right","pos-top-left","pos-top-right","pos-bottom-left","pos-bottom-right"];
    const layoutLabels=()=>{
      const mapRect=target.getBoundingClientRect();
      const routePoints=features.flatMap(feature=>feature.geometry.coordinates.filter((_,index)=>index%2===0).map(point=>map.project(point)));
      const placed=[];
      markerRecords.sort((a,b)=>b.days.length-a.days.length).forEach(record=>{
        let best={name:candidates[0],score:Infinity,rect:null};
        candidates.forEach((name,rank)=>{
          record.root.classList.remove(...candidates); record.root.classList.add(name);
          const rect=record.labels.getBoundingClientRect();
          let score=rank*.15;
          const left=Math.max(0,mapRect.left+10-rect.left),right=Math.max(0,rect.right-(mapRect.right-10)),top=Math.max(0,mapRect.top+10-rect.top),bottom=Math.max(0,rect.bottom-(mapRect.bottom-10));
          score+=(left+right+top+bottom)*1000;
          const safetyGap=10;
          placed.forEach(other=>{ const overlap=Math.max(0,Math.min(rect.right,other.right+safetyGap)-Math.max(rect.left,other.left-safetyGap))*Math.max(0,Math.min(rect.bottom,other.bottom+safetyGap)-Math.max(rect.top,other.top-safetyGap)); score+=overlap*100; });
          routePoints.forEach(point=>{ const x=mapRect.left+point.x,y=mapRect.top+point.y; if(x>rect.left-8&&x<rect.right+8&&y>rect.top-8&&y<rect.bottom+8)score+=25; });
          if(score<best.score) best={name,score,rect};
        });
        record.root.classList.remove(...candidates); record.root.classList.add(best.name);
        placed.push(record.labels.getBoundingClientRect());
      });
      const displayPoints=new Map();
      journey.days.forEach(day=>{
        const badge=markerScope.querySelector(`.bc-layout-marker-labels [data-layout-day="${day.day}"] b`);
        if(!badge)return;
        const rect=badge.getBoundingClientRect();
        const point=map.unproject([rect.left-mapRect.left+rect.width/2,rect.top-mapRect.top+rect.height/2]);
        displayPoints.set(day.day,[point.lng,point.lat]);
      });
      const displayFeatures=features.map((feature,index)=>{
        const original=feature.geometry.coordinates,from=displayPoints.get(feature.properties.from)||original[0],to=displayPoints.get(feature.properties.to)||original[original.length-1],mode=feature.properties.mode;
        return {type:"Feature",properties:{...feature.properties},geometry:{type:"LineString",coordinates:bcLayoutLabCurve([from[1],from[0]],[to[1],to[0]],mode,index)}};
      });
      map.getSource("layout-route")?.setData({type:"FeatureCollection",features:displayFeatures});
      arrowRecords.forEach(record=>{
        const feature=displayFeatures[record.routeIndex];
        if(!feature){record.el.hidden=true;return;}
        const coordinates=feature.geometry.coordinates,index=Math.floor(coordinates.length*.58),point=coordinates[index],next=coordinates[Math.min(coordinates.length-1,index+1)];
        record.marker.setLngLat(point);
        record.el.hidden=false;
        const a=map.project(point),b=map.project(next);
        record.el.style.setProperty("--route-angle",`${Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}deg`);
        const arrowRect=record.el.getBoundingClientRect(),gap=4;
        record.el.hidden=placed.some(labelRect=>Math.min(arrowRect.right,labelRect.right+gap)-Math.max(arrowRect.left,labelRect.left-gap)>0&&Math.min(arrowRect.bottom,labelRect.bottom+gap)-Math.max(arrowRect.top,labelRect.top-gap)>0);
      });
    };
    requestAnimationFrame(layoutLabels);
    map.once("idle",()=>{
      requestAnimationFrame(layoutLabels);
      setTimeout(layoutLabels,120);
    });
    map.on("resize",layoutLabels);

    markerScope.querySelectorAll("[data-layout-day]").forEach(button=>button.addEventListener("click",()=>{
      const day=journey.days.find(item=>item.day===Number(button.dataset.layoutDay));
      if(options.onDaySelect&&day){options.onDaySelect(day);return;}
      caseRoot.querySelectorAll("[data-layout-day]").forEach(item=>{const active=item.dataset.layoutDay===button.dataset.layoutDay;item.classList.toggle("is-active",active);item.setAttribute("aria-pressed",String(active));});
      const selection=caseRoot.querySelector(".bc-layout-selection");
      if(selection&&day)selection.textContent=`DAY ${String(day.day).padStart(2,"0")} · ${bcMapLayoutLabText(day.city)}`;
    }));
  });
  return map;
}

function bcMountMapLayoutLab() {
  bcDestroyMapLayoutLab();
  if (typeof maplibregl!=="object" || typeof maplibregl.Map!=="function") return;
  document.querySelectorAll("[data-layout-map]").forEach(target=>{
    const journey=BC_MAP_LAYOUT_LAB_CASES.find(item=>item.id===target.dataset.layoutMap);
    if(journey) bcMountMapLayoutLabMap(target,journey);
  });
  const layoutTarget=state.layoutCase?`#layout-${state.layoutCase}`:location.hash.startsWith("#layout-")?location.hash:"";
  if (layoutTarget) {
    const revealCase=()=>document.querySelector(layoutTarget)?.scrollIntoView({block:"start"});
    requestAnimationFrame(revealCase);
    setTimeout(revealCase,900);
  }
}
