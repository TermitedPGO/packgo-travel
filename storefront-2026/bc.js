/*
  THROWAWAY PROTOTYPE — BC
  One data-driven visual system for the public storefront, services, booking demo,
  and DEMO MEMBER center. All dates, prices, seats, orders, documents and actions
  below are design samples only.
*/

const BC_IMG = {
  madrid: IMG.madrid,
  avila: IMG.segovia,
  bilbao: IMG.bilbao,
  spainFood: IMG.food,
  london: IMG.london,
  cotswolds: "https://images.unsplash.com/photo-1529260830199-42c24126f198?auto=format&fit=crop&w=1600&q=86",
  edinburgh: "https://images.unsplash.com/photo-1506377585622-bedcbb027afc?auto=format&fit=crop&w=1600&q=86",
  bath: "https://images.unsplash.com/photo-1544986581-efac024faf62?auto=format&fit=crop&w=1600&q=86",
  tokyo: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=86",
  kyoto: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1600&q=86",
  fuji: "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?auto=format&fit=crop&w=1600&q=86",
  nara: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1600&q=86",
  plane: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1800&q=86",
  passport: "https://images.unsplash.com/photo-1544396821-4dd40b938ad3?auto=format&fit=crop&w=1800&q=86",
  custom: IMG.journey2,
  group: IMG.journey1,
  transfer: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1800&q=86",
  hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1800&q=86",
  southeastAsia: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1800&q=86",
  americas: "https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?auto=format&fit=crop&w=1800&q=86",
  oceania: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=1800&q=86",
  africaMiddleEast: "https://images.unsplash.com/photo-1539020140153-e479b8c22e70?auto=format&fit=crop&w=1800&q=86",
  cruise: "https://images.unsplash.com/photo-1548574505-5e239809ee19?auto=format&fit=crop&w=1800&q=86",
  support: IMG.desk,
  about: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1800&q=86",
  taiwanForestTrain: "./assets/taiwan/formosensis-forest-train.jpg",
  taiwanForestCabin: "./assets/taiwan/formosensis-cabin.jpg",
  taiwanFutureTrain: "./assets/taiwan/future-express.jpg",
  taiwanFutureCabin: "./assets/taiwan/future-express-cabin.jpg"
};

const BC_BRAND = {
  mark: "./assets/packgo-symbol-black.png",
  wordmark: "./assets/packgo-wordmark-black.png",
  wordmarkMobile: "./assets/packgo-wordmark-only-black.png"
};

const bcI18n = (zh, en, es) => ({ zh, en, es: es || en });
const bcTxt = value => typeof value === "string" ? value : value?.[state.language] || value?.en || "";
const bcCostText = value => bcTxt(value).replace(/US\$([\d,]+)/g, (_, raw) => money(Number(raw.replaceAll(",", ""))));

// BC editorial rule: visible interface copy uses no decorative punctuation.
// Technical formats that would become ambiguous (price, date, contact and codes)
// are explicitly exempted instead of being rewritten as prose.
function bcStripVisiblePunctuation(root) {
  if (!root) return;
  const keep = "address,code,time,.bc-home-trust dd,.bc-home-desk>aside,.bc-home-quick-facts,.bc-home-compare-price,.bc-nav-close,.drawer-close,[data-share-close],[data-keep-punctuation]";
  const marks = /[，。；：、！？,.!?:;·・•—–→←↗↘／\/（）()「」『』【】\[\]…｜|“”‘’\"'＋+×−]/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    if (!node.nodeValue?.trim() || node.parentElement?.closest(keep)) return;
    const text = node.nodeValue;
    // Prices dates ranges contact details flight times and identifiers are data,
    // not decorative prose. Removing their separators makes the transaction
    // harder to understand and can change the meaning of legal copy.
    const containsTechnicalData = /US\$|NT\$|@|#|\d[.,:\/\-–—→]\d|\b[A-Z]{2,4}\s?\d{2,4}\b/.test(text);
    if (containsTechnicalData) return;
    node.nodeValue = text.replace(marks, " ").replace(/\s{2,}/g, " ");
  });
}

// Keep unfinished actions honest without showing internal prototype language
// to travelers. DEMO MEMBER remains because it is the required anonymous
// identity used by member screens.
function bcRemovePrototypeLanguage(root) {
  if (!root) return;
  const replacements = [
    [/前台設計原型/g, ""],
    [/設計原型/g, ""],
    [/介面設計示意/g, ""],
    [/介面示意/g, ""],
    [/設計示意/g, ""],
    [/DESIGN[ -]DEMO/gi, ""],
    [/DESIGN SAMPLE/gi, ""],
    [/INTERFACE SAMPLE/gi, ""],
    [/THROWAWAY DESIGN PROTOTYPE/gi, "LOCAL VERSION"],
    [/STOREFRONT PROTOTYPE/gi, "STOREFRONT"],
    [/PROTOTYPE STATUS/gi, "AVAILABILITY"],
    [/DEMO DE DISEÑO/gi, "AÚN NO DISPONIBLE"],
    [/PROTOTIPO BC/gi, "PACK&GO BC"],
    [/本原型/g, "此頁面"],
    [/\bthis prototype\b/gi, "this page"],
    [/\bthe prototype\b/gi, "the page"],
    [/\bprototype\b/gi, "preview"],
    [/示意/g, "暫定"]
  ];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    if (!node.nodeValue) return;
    const demoMemberToken = "__PACKGO_DEMO_MEMBER__";
    const protectedText = node.nodeValue.replace(/DEMO MEMBER/gi, demoMemberToken);
    node.nodeValue = replacements.reduce((text, [pattern, value]) => text.replace(pattern, value), protectedText)
      .replace(/\bDEMO\b/gi, "PREVIEW")
      .replaceAll(demoMemberToken, "DEMO MEMBER")
      .replace(/\s{2,}/g, " ")
      .trimStart();
  });
}

// BC serves Traditional Chinese and English. Keep those language names readable
// in the active interface language; brand names, product codes, currency,
// airport codes and required map attribution remain in their official form.
function bcLocalizeVisibleLanguage(root) {
  if (!root) return;
  root.querySelectorAll('select[id*="language"] option[value="es"]').forEach(option => option.remove());
  root.querySelectorAll('select[id*="currency"] option').forEach(option => {
    if (option.value === "CAD" || option.textContent.trim() === "CAD") option.remove();
  });
  const languageNames = state.language === "zh"
    ? {zh:"繁體中文", en:"英文", es:"西班牙文"}
    : state.language === "en"
      ? {zh:"Traditional Chinese", en:"English", es:"Spanish"}
      : {zh:"Chino tradicional", en:"Inglés", es:"Español"};
  root.querySelectorAll('select[id*="language"] option').forEach(option => {
    if (languageNames[option.value]) option.textContent = languageNames[option.value];
  });
  if (state.language !== "zh") return;
  const translations = [
    ["GUIDED JOURNEY FINDER", "引導式旅程探索"],
    ["CURATED GROUP JOURNEYS", "精選團體旅程"],
    ["FULL JOURNEY FINDER", "完整旅程搜尋"],
    ["5 DAY ROUTE", "五日旅程路線"],
    ["5 DAYS", "五日"],
    ["5 DAY", "五日"],
    ["ROUTE", "路線"],
    ["BOOKING DECISION", "訂購判斷"],
    ["DECISION DETAILS", "訂購重點"],
    ["REFERENCE FLIGHT", "參考航班"],
    ["THE WHOLE COST", "完整費用"],
    ["DEPARTURES · SAMPLE DATA", "暫定班期資料"],
    ["DEPARTURES SAMPLE DATA", "暫定班期資料"],
    ["STAY & MOVEMENT", "住宿與移動"],
    ["CANCELLATION & TRUST", "取消規則與信任保障"],
    ["FLIGHT BRIEF", "航班需求"],
    ["CHINA VISA DETAIL", "中國簽證詳情"],
    ["CHINA VISA PRE-CHECK", "中國簽證預檢"],
    ["CHINA VISA", "中國簽證"],
    ["PRE-CHECK", "預檢"],
    ["DETAILS", "詳細資料"],
    ["DETAIL", "詳情"],
    ["CUSTOM TRAVEL", "客製旅行"],
    ["TRAVEL BRIEF", "旅程需求"],
    ["AIRPORT TRANSFER", "機場接送"],
    ["TRANSFER BRIEF", "接送需求"],
    ["HOTEL PATH", "住宿選擇"],
    ["CONTACT & SUPPORT", "聯絡與支援"],
    ["SUPPORT TRIAGE", "支援分流"],
    ["ABOUT PACK&GO", "關於 PACK&GO"],
    ["PACK&GO SERVICES", "PACK&GO 旅行服務"],
    ["START IN THE RIGHT PLACE", "從正確入口開始"],
    ["SELF-SERVICE", "自助完成"],
    ["HUMAN REVIEW", "真人審核"],
    ["HELP & POLICIES", "支援與政策"],
    ["EXCEPTIONS", "例外情況"],
    ["WHAT STAYS HUMAN", "真人負責的部分"],
    ["TRUST, NOT BADGES", "信任來自清楚揭露"],
    ["TRUST NOT BADGES", "信任來自清楚揭露"],
    ["PACK&GO · PRIVATE JOURNEY", "PACK&GO 私人旅程"],
    ["PACK&GO PRIVATE JOURNEY", "PACK&GO 私人旅程"],
    ["PACK&GO JOURNEY 01", "PACK&GO 旅程一"],
    ["ORDERS", "我的訂單"],
    ["NEXT ACTION", "下一步"],
    ["NEXT STOP", "下一站"],
    ["AFTER CONFIRMATION", "確認之後"],
    ["TRAVELER WALLET", "旅客資料夾"],
    ["TRAVELER DETAILS", "旅客資料"],
    ["TRAVELER", "旅客"],
    ["DOCUMENT STATUS", "文件狀態"],
    ["PAYMENT CENTER", "付款中心"],
    ["TRANSACTIONS & RECEIPTS", "交易與收據"],
    ["SAVED · DEVICE-ONLY", "本機收藏"],
    ["SAVED DEVICE-ONLY", "本機收藏"],
    ["MEMBERSHIP · ANNUAL VALUE", "會員年度價值"],
    ["MEMBERSHIP ANNUAL VALUE", "會員年度價值"],
    ["PAID VIP · DESIGN HYPOTHESIS", "尊享會員價值測試"],
    ["PAID VIP DESIGN HYPOTHESIS", "尊享會員價值測試"],
    ["VIP ACCESS · DESIGN HYPOTHESIS", "尊享會員禮遇測試"],
    ["VIP ACCESS", "尊享會員禮遇"],
    ["HONEST VALUE TEST", "實際價值試算"],
    ["CHECKOUT", "付款確認"],
    ["JOURNEY MOMENT", "旅程時刻"],
    ["MAP STORY LAB", "地圖故事實驗室"],
    ["THROWAWAY MAP LAYOUT LAB", "路線地圖版型實驗室"],
    ["DESIGN D ZOOM-TO-STORY", "設計 D 地圖聚焦故事"],
    ["AUTO LAYOUT", "自動排版"],
    ["CASE", "案例"],
    ["PAYMENT METHOD", "付款方式"],
    ["KNOWN TRIP TOTAL", "已知旅費總額"],
    ["KNOWN TOTAL", "已知總額"],
    ["PAID LATER", "之後另付"],
    ["CHARGED TODAY BY PACK&GO", "今天由 PACK&GO 收取"],
    ["CHARGED TODAY", "今天收取"],
    ["TODAY", "今天"],
    ["PAYEE", "收款人"],
    ["EXTRAS", "自選服務"],
    ["REAL STATUS", "實際狀態"],
    ["CURRENT LEVEL · MEMBER", "目前會員等級"],
    ["DEMO MEMBER A", "測試旅客甲"],
    ["DEMO MEMBER", "測試會員"],
    ["PREVIEW-PG-1042", "測試訂單 PG-1042"],
    ["PREVIEW-PG-1078", "測試訂單 PG-1078"],
    ["TRAVELER 01", "旅客一"],
    ["TRAVELER 02", "旅客二"],
    ["TRAVELER 03", "旅客三"],
    ["FLIGHTS", "機票服務"],
    ["HOTELS", "飯店服務"],
    ["Email", "電子郵件"],
    ["English", "英文"],
    ["Español", "西班牙文"],
    ["California Seller of Travel", "加州旅行銷售商"],
    ["Newark Business License", "紐華克市商業執照"],
    ["NOT YET AVAILABLE", "尚未開放"],
    ["PREVIEW", "預覽"],
    ["BOOKING", "訂購"],
    ["PAYMENT", "付款"],
    ["MEMBER", "一般會員"],
    ["VIP", "尊享會員"],
    ["REAL", "真實資訊"]
  ];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    if (!node.nodeValue || node.parentElement?.closest("script,style")) return;
    node.nodeValue = translations.reduce((text, [from, to]) => text.replaceAll(from, to), node.nodeValue)
      .replace(/\bDAY\s+(\d{1,2})\b/g, "第 $1 天")
      .replace(/\b(\d+)\s+DAYS?\b/g, "$1 日")
      .replace(/\bpreview\b/gi, "預覽");
  });
}

const bcFee = (id, category, labelZh, labelEn, amount, payeeType, paymentTiming, requiredForTrip = true, unit = "per_person") => ({
  id, category, label:bcI18n(labelZh,labelEn), amount, currency:"USD", unit,
  includedInPackgoCharge:false, requiredForTrip, payeeType, paymentTiming,
  sourceStatus:"demo_estimate"
});

// Prototype contract for future backend identification. A fee is selected by
// product + departure + market + destination jurisdiction, never by parsing UI copy.
const BC_FEE_CONTRACTS = {
  2: {
    contractId:"fees-MAD-5D-USCA-ES-v1", productId:"MAD-5D", originMarket:"US-CA",
    destinationJurisdictions:["ES"], displayRegion:bcI18n("西班牙","Spain"),
    validFrom:"2026-10-04", validTo:"2026-11-12", sourceStatus:"demo_estimate",
    fees:[
      bcFee("MAD-5D-airfare-estimate","mandatory","國際機票預估","Estimated international airfare",980,"airline","before_departure"),
      bcFee("MAD-5D-guide-gratuity","tips","司導服務費／小費","Guide gratuity / service fee",120,"guide_and_driver","during_trip"),
      bcFee("MAD-5D-unlisted-meals","self","未列餐食估計","Estimated unlisted meals",160,"restaurant_or_traveler_choice","during_trip"),
      bcFee("MAD-5D-single-supplement","optional","單人房差","Single supplement",340,"PACKGO_or_hotel","if_selected",false,"per_booking"),
      bcFee("MAD-5D-flamenco-dinner","optional","佛朗明哥晚宴","Flamenco dinner",95,"local_supplier","if_selected",false)
    ]
  },
  3: {
    contractId:"fees-UKH-6D-USCA-GB-v1", productId:"UKH-6D", originMarket:"US-CA",
    destinationJurisdictions:["GB"], displayRegion:bcI18n("英國","United Kingdom"),
    validFrom:"2026-10-11", validTo:"2026-12-25", sourceStatus:"demo_estimate",
    fees:[
      bcFee("UKH-6D-uk-eta","mandatory","英國 ETA 預估","UK ETA estimate",25,"UK_government","before_departure"),
      bcFee("UKH-6D-leader-driver-gratuity","tips","領隊與司機服務費／小費","Leader and driver gratuity",150,"leader_and_driver","during_trip"),
      bcFee("UKH-6D-unlisted-meals","self","未列餐食估計","Estimated unlisted meals",180,"restaurant_or_traveler_choice","during_trip"),
      bcFee("UKH-6D-single-supplement","optional","單人房差","Single supplement",520,"PACKGO_or_hotel","if_selected",false,"per_booking"),
      bcFee("UKH-6D-west-end-musical","optional","西區音樂劇","West End musical",130,"ticket_supplier","if_selected",false)
    ]
  },
  21: {
    contractId:"fees-JPN-7D-USCA-JP-v1", productId:"JPN-7D", originMarket:"US-CA",
    destinationJurisdictions:["JP"], displayRegion:bcI18n("日本","Japan"),
    validFrom:"2026-11-01", validTo:"2027-03-27", sourceStatus:"demo_estimate",
    fees:[
      bcFee("JPN-7D-leader-driver-gratuity","tips","領隊與司機服務費／小費","Leader and driver gratuity",175,"leader_and_driver","during_trip"),
      bcFee("JPN-7D-unlisted-meals","self","未列餐食估計","Estimated unlisted meals",140,"restaurant_or_traveler_choice","during_trip"),
      bcFee("JPN-7D-single-supplement","optional","單人房差","Single supplement",610,"PACKGO_or_hotel","if_selected",false,"per_booking"),
      bcFee("JPN-7D-kimono-experience","optional","和服體驗","Kimono experience",80,"local_supplier","if_selected",false)
    ]
  },
  88: {
    contractId:"fees-TWN-8D-USCA-TW-pending-v1", productId:"TWN-8D", originMarket:"US-CA",
    destinationJurisdictions:["TW"], displayRegion:bcI18n("台灣","Taiwan"),
    validFrom:null, validTo:null, sourceStatus:"awaiting_supplier_quote", fees:[]
  }
};

function bcResolveFeeContract(t, departure) {
  const contract = BC_FEE_CONTRACTS[t.id];
  if (!contract) return { contractId:`fees-${t.code}-unresolved`, productId:t.code, originMarket:"US-CA", destinationJurisdictions:[t.world?.region || "UNRESOLVED"], displayRegion:t.destination, sourceStatus:"unresolved", fees:[] };
  const date = (departure?.start || t.nextDate || "").replaceAll(".","-");
  const inRange = !contract.validFrom || !contract.validTo || date >= contract.validFrom && date <= contract.validTo;
  return { ...contract, sourceStatus:inRange ? contract.sourceStatus : "outside_contract_validity" };
}

function bcFeePayeeText(type) {
  return ({
    airline:L("航空公司","airline"),
    UK_government:L("英國政府","UK government"),
    guide_and_driver:L("司導／司機","guide / driver"),
    leader_and_driver:L("領隊／司機","leader / driver"),
    restaurant_or_traveler_choice:L("餐廳或旅客自選供應商","restaurant or traveler-selected provider"),
    PACKGO_or_hotel:L("PACK&GO 或飯店，依最終確認","PACK&GO or hotel, as confirmed"),
    local_supplier:L("當地供應商","local supplier"),
    ticket_supplier:L("票券供應商","ticket supplier")
  })[type] || L("待確認收款對象","payee pending");
}

function bcFeeTimingText(timing) {
  return ({
    before_departure:L("出發前另付","paid separately before departure"),
    during_trip:L("旅途中另付","paid separately during the trip"),
    if_selected:L("選擇後才確認與支付","confirmed and paid only if selected")
  })[timing] || L("支付時間待確認","payment timing pending");
}

function bcFeeUnits(item, guests) {
  return item.unit === "per_person" ? guests : 1;
}

function bcFeeTotal(item, guests) {
  return item.amount * bcFeeUnits(item, guests);
}

function bcFeeUnitText(item) {
  return item.unit === "per_person" ? L("每人","PER PERSON") : L("每次訂購","PER BOOKING");
}

function bcSelectedOptionalFees(t, departure, guests, selectedIds = [...state.bookingOptions]) {
  const model = bcBookingFeeModel(t, departure, guests);
  const chosen = new Set(selectedIds || []);
  const items = model.categories.optional.filter(item => chosen.has(item.id));
  return { items, total:items.reduce((sum,item)=>sum+bcFeeTotal(item,guests),0) };
}

function bcBookingFeeModel(t, departure, guests, chargeAmount = departure.price * guests) {
  const contract = bcResolveFeeContract(t, departure);
  const required = contract.fees.filter(item => item.requiredForTrip);
  const categories = {
    mandatory: contract.fees.filter(item => item.category === "mandatory"),
    tips: contract.fees.filter(item => item.category === "tips"),
    self: contract.fees.filter(item => item.category === "self"),
    optional: contract.fees.filter(item => item.category === "optional")
  };
  const tripTotal = departure.price * guests;
  const requiredTotal = required.reduce((sum,item)=>sum+bcFeeTotal(item,guests),0);
  return { t, departure, guests, chargeAmount, tripTotal, contract, categories, knownTotal:tripTotal + requiredTotal };
}

function bcBookingFeeDisclosure(t, departure, guests, chargeAmount = departure.price * guests) {
  const model = bcBookingFeeModel(t, departure, guests, chargeAmount);
  const section = (key, title, note) => {
    const items = model.categories[key];
    if (!items.length) return "";
    const subtotal = items.reduce((sum, item) => sum + bcFeeTotal(item,guests), 0);
    return `<section class="bc-fee-category bc-fee-${key}"><header><div><h3>${title}</h3><p>${note}</p></div><strong>${key === "optional" ? L("未計入","NOT INCLUDED") : money(subtotal)}</strong></header><ul>${items.map(item => `<li data-fee-id="${item.id}" data-payee-type="${item.payeeType}" data-payment-timing="${item.paymentTiming}"><span><b>${bcTxt(item.label)}</b><small>${bcFeeUnitText(item)} ${money(item.amount)} · ${L("付給","PAY TO")} ${bcFeePayeeText(item.payeeType)} · ${bcFeeTimingText(item.paymentTiming)}</small></span><strong>${money(bcFeeTotal(item,guests))}</strong></li>`).join("")}</ul></section>`;
  };
  return `<section class="bc-fee-disclosure" data-fee-contract-id="${model.contract.contractId}" data-product-id="${model.contract.productId}" data-origin-market="${model.contract.originMarket}" data-destination-jurisdictions="${model.contract.destinationJurisdictions.join(",")}" data-source-status="${model.contract.sourceStatus}" aria-label="${L("付款前完整費用揭露","Complete pre-payment cost disclosure")}">
    <header class="bc-fee-disclosure-head"><div><p class="eyebrow">COMPLETE COST DISCLOSURE · DESIGN DEMO</p><h2>${L("這次收多少，之後還要付什麼。","What is charged now—and what is paid later.")}</h2><small>${L("適用地區","REGION")}: ${bcTxt(model.contract.displayRegion)} · ${model.contract.productId} · ${model.contract.sourceStatus === "demo_estimate" ? L("示意估算","DEMO ESTIMATE") : L("資料待確認","DATA PENDING")}</small></div><span>${guests} ${L("位旅客","TRAVELERS")}</span></header>
    <div class="bc-fee-pay-now"><span><small>${L("本次由 PACK&GO 收取・設計示意","CHARGED BY PACK&GO NOW · DESIGN DEMO")}</small><b>${L("本次團費／尾款","Tour payment / balance")}</b></span><strong>${money(chargeAmount)}</strong></div>
    ${section("mandatory",L("必付費用・另外支付","Mandatory costs · paid separately"),L("完成旅程所需，但不包含在本次 PACK&GO 收款。","Required for the trip but not collected in this PACK&GO payment."))}
    ${section("tips",L("小費與服務費・另外支付","Gratuities and service fees · paid separately"),L("不包含在本次刷卡金額，支付時間與對象必須明列。","Not in this card charge; timing and recipient must be stated."))}
    ${section("self",L("旅途中自付估計","Estimated traveler-paid costs"),L("餐食等預估支出；實際依旅客選擇。","Estimated meals and personal spending; actual cost varies."))}
    ${section("optional",L("可選自費・不計入總額","Optional extras · excluded from total"),L("只有旅客主動選擇時才加入。","Added only when the traveler chooses them."))}
    <div class="bc-fee-known-total"><span><small>${L("全體預估已知總花費","ESTIMATED KNOWN TRIP TOTAL")}</small><b>${L("團費＋必付＋小費＋自付估計；不含可選自費","Tour + mandatory + tips + estimated traveler-paid costs; optional extras excluded")}</b></span><strong>${money(model.knownTotal)}</strong></div>
    <p class="bc-fee-disclosure-note">${L("所有金額均為設計示意。正式付款前須再次確認金額、收款對象、支付時間、退改與供應商條款。","All figures are design samples. Production must reconfirm amount, payee, timing, cancellation and supplier terms before payment.")}</p>
  </section>`;
}

const BC_TOURS = [
  {
    id: 2,
    code: "MAD-5D",
    destination: bcI18n("西班牙・馬德里", "Spain · Madrid", "España · Madrid"),
    world: { city: bcI18n("馬德里", "Madrid", "Madrid"), region: "ES", lon: -3.7038, lat: 40.4168, x: 471.6, y: 131.4 },
    title: bcI18n("馬德里黃金時代", "Madrid Golden Age", "La edad de oro de Madrid"),
    days: 5,
    nights: 4,
    nextDate: "2026.10.04",
    returnDate: "2026.10.08",
    price: 1550,
    air: false,
    formed: true,
    seats: 4,
    group: bcI18n("最多 8 人", "Up to 8 guests", "Máximo 8 viajeros"),
    status: bcI18n("已成行・可報名", "Confirmed · bookable", "Confirmado · disponible"),
    features: [bcI18n("世界遺產城市", "Heritage cities", "Ciudades patrimonio"), bcI18n("中文司導", "Chinese-speaking guide", "Guía en chino"), bcI18n("小團慢行", "Slow small-group pace", "Ritmo pausado")],
    image: BC_IMG.madrid,
    gallery: [BC_IMG.madrid, BC_IMG.avila, BC_IMG.bilbao],
    flight: {
      type: bcI18n("參考航班・機票另計", "Reference flight · airfare separate", "Vuelo de referencia · no incluido"),
      outbound: "UA 194 · SFO 13:35 → MAD 09:25+1",
      inbound: "UA 195 · MAD 11:15 → SFO 14:35",
      note: bcI18n("直飛示意；最終以旅客自行購票或確認書為準", "Nonstop sample; final details follow the ticket or confirmation", "Ejemplo sin escalas; prevalece el billete final")
    },
    includes: [bcI18n("4 晚四星或同級住宿", "4 nights, four-star or equivalent", "4 noches, hotel de 4 estrellas"), bcI18n("行程內交通與中文司導", "Itinerary transport and Chinese-speaking guide", "Transporte y guía en chino"), bcI18n("列明景點首道門票", "Listed first-entry admissions", "Primeras entradas indicadas"), bcI18n("每日早餐與 3 餐特色餐", "Daily breakfast and 3 featured meals", "Desayuno diario y 3 comidas")],
    required: [bcI18n("國際機票預估 US$980", "Estimated airfare US$980", "Vuelo estimado US$980"), bcI18n("司導服務費 US$120", "Guide gratuity US$120", "Propina de guía US$120"), bcI18n("未列餐食預估 US$160", "Unlisted meals est. US$160", "Comidas no incluidas est. US$160")],
    optional: [bcI18n("單人房差 US$340", "Single supplement US$340", "Suplemento individual US$340"), bcI18n("佛朗明哥晚宴約 US$95", "Flamenco dinner about US$95", "Cena flamenca aprox. US$95")],
    estimate: 2810,
    hotels: bcI18n("阿維拉、巴利亞多利德、畢爾巴鄂與昆卡四星或同級；正式確認書提供最終飯店。", "Four-star or equivalent stays in Ávila, Valladolid, Bilbao and Cuenca; final hotels appear in the confirmation.", "Hoteles de 4 estrellas o similares en Ávila, Valladolid, Bilbao y Cuenca; los hoteles finales figuran en la confirmación."),
    transport: bcI18n("9 人座專車串連多個跨城路段；正式行程將逐日列出預估車程，市區以步行為主。", "A nine-seat private vehicle links several intercity legs; the final itinerary will list estimated drive time by day, with walking in city centers.", "Vehículo privado de 9 plazas para varios trayectos; el itinerario final indicará el tiempo estimado diario y los recorridos a pie."),
    cancellation: bcI18n("出發 61 日前可退已收團費，扣除不可退第三方成本；60–31 日、30–15 日與 14 日內採階梯費率。正式付款前須再次確認完整條款。", "Before 61 days, paid tour fees are refundable less non-refundable third-party costs. Tiered fees apply at 60–31, 30–15 and within 14 days. Full terms must be confirmed before payment.", "Antes de 61 días se reembolsa menos costos no recuperables. Se aplican cargos escalonados; confirme las condiciones antes de pagar."),
    departures: [
      { start: "2026.10.04", end: "2026.10.08", status: bcI18n("已成行・可報名", "Confirmed · bookable", "Confirmado · disponible"), seats: 4, price: 1550 },
      { start: "2026.10.18", end: "2026.10.22", status: bcI18n("收客中", "Collecting guests", "Formando grupo"), seats: 6, price: 1550 },
      { start: "2026.11.08", end: "2026.11.12", status: bcI18n("已成行・餘少", "Confirmed · limited", "Confirmado · últimas plazas"), seats: 2, price: 1620 }
    ],
    route: [
      { day: 1, city: bcI18n("馬德里・阿維拉", "Madrid · Ávila", "Madrid · Ávila"), sights: bcI18n("抵達、阿維拉城牆、老城黃昏散步", "Arrival, Ávila walls and old-town sunset walk", "Llegada, murallas de Ávila y paseo al atardecer"), meals: bcI18n("晚餐", "Dinner", "Cena"), hotel: bcI18n("Ávila 四星或同級", "Ávila four-star or equivalent", "Hotel 4 estrellas en Ávila"), image: BC_IMG.avila, geo: [40.6565, -4.6812], x: 92, y: 290 },
      { day: 2, city: bcI18n("薩拉曼卡・巴利亞多利德", "Salamanca · Valladolid", "Salamanca · Valladolid"), sights: bcI18n("大教堂、石造老城、歷史街區", "Cathedral, stone old town and historic quarter", "Catedral, casco histórico de piedra"), meals: bcI18n("早餐・午餐", "Breakfast · lunch", "Desayuno · almuerzo"), hotel: bcI18n("Valladolid 四星或同級", "Valladolid four-star or equivalent", "Hotel 4 estrellas en Valladolid"), image: IMG.salamanca, geo: [41.6523, -4.7245], x: 148, y: 205 },
      { day: 3, city: bcI18n("佈爾戈斯・畢爾巴鄂", "Burgos · Bilbao", "Burgos · Bilbao"), sights: bcI18n("世界遺產、古根漢美術館、巴斯克街區", "World heritage, Guggenheim and Basque neighborhoods", "Patrimonio, Guggenheim y barrios vascos"), meals: bcI18n("早餐・晚餐", "Breakfast · dinner", "Desayuno · cena"), hotel: bcI18n("Bilbao 四星或同級", "Bilbao four-star or equivalent", "Hotel 4 estrellas en Bilbao"), image: BC_IMG.bilbao, geo: [43.2630, -2.9350], x: 245, y: 110 },
      { day: 4, city: bcI18n("塞戈維亞・昆卡", "Segovia · Cuenca", "Segovia · Cuenca"), sights: bcI18n("古羅馬水道橋、古城與山城風景", "Roman aqueduct, old town and hill-city views", "Acueducto romano, casco antiguo y ciudad de montaña"), meals: bcI18n("早餐・午餐", "Breakfast · lunch", "Desayuno · almuerzo"), hotel: bcI18n("Cuenca 四星或同級", "Cuenca four-star or equivalent", "Hotel 4 estrellas en Cuenca"), image: IMG.segovia, geo: [40.0704, -2.1374], x: 365, y: 225 },
      { day: 5, city: bcI18n("托萊多・馬德里", "Toledo · Madrid", "Toledo · Madrid"), sights: bcI18n("風車村、托萊多古城、返回馬德里", "Windmill village, Toledo old town and Madrid return", "Molinos, casco antiguo de Toledo y regreso a Madrid"), meals: bcI18n("早餐・午餐", "Breakfast · lunch", "Desayuno · almuerzo"), hotel: bcI18n("行程結束", "Journey ends", "Fin del viaje"), image: BC_IMG.madrid, geo: [40.4168, -3.7038], x: 280, y: 330 }
    ]
  },
  {
    id: 3,
    code: "UKH-6D",
    destination: bcI18n("英國・倫敦", "United Kingdom · London", "Reino Unido · Londres"),
    world: { city: bcI18n("倫敦", "London", "Londres"), region: "GB", lon: -0.1276, lat: 51.5072, x: 479.7, y: 100.5 },
    title: bcI18n("英倫古堡與鄉間六日", "Castles and English Countryside", "Castillos y campiña inglesa"),
    days: 6,
    nights: 5,
    nextDate: "2026.10.11",
    returnDate: "2026.10.16",
    price: 2480,
    air: true,
    formed: true,
    seats: 3,
    group: bcI18n("最多 12 人", "Up to 12 guests", "Máximo 12 viajeros"),
    status: bcI18n("已成行・餘 3 位", "Confirmed · 3 seats", "Confirmado · 3 plazas"),
    features: [bcI18n("倫敦西區", "London West End", "West End de Londres"), bcI18n("科茲窩鄉村", "Cotswolds villages", "Pueblos de Cotswolds"), bcI18n("含國際機票", "International air included", "Vuelo internacional incluido")],
    image: BC_IMG.london,
    gallery: [BC_IMG.london, BC_IMG.cotswolds, BC_IMG.bath],
    flight: {
      type: bcI18n("團體參考航班・已含經濟艙", "Group reference flight · economy included", "Vuelo de grupo · económica incluida"),
      outbound: "VS 020 · SFO 17:30 → LHR 12:10+1",
      inbound: "VS 019 · LHR 11:15 → SFO 14:20",
      note: bcI18n("航班時間可能調整；最終以行前確認書為準", "Schedules may change; final details follow the pre-departure confirmation", "Los horarios pueden cambiar; prevalece la confirmación final")
    },
    includes: [bcI18n("國際來回經濟艙", "Round-trip international economy air", "Vuelo internacional ida y vuelta"), bcI18n("4 晚四星或同級住宿與 1 晚機上", "4 hotel nights plus 1 overnight flight", "4 noches de hotel y 1 noche a bordo"), bcI18n("專車、中文領隊與列明門票", "Coach, Chinese-speaking leader and listed admissions", "Autocar, líder en chino y entradas indicadas"), bcI18n("每日早餐與 4 餐團體餐", "Daily breakfast and 4 group meals", "Desayuno diario y 4 comidas")],
    required: [bcI18n("英國 ETA 預估 US$25", "UK ETA est. US$25", "ETA del Reino Unido aprox. US$25"), bcI18n("領隊與司機服務費 US$150", "Leader and driver gratuity US$150", "Propinas US$150"), bcI18n("未列餐食預估 US$180", "Unlisted meals est. US$180", "Comidas no incluidas est. US$180")],
    optional: [bcI18n("單人房差 US$520", "Single supplement US$520", "Suplemento individual US$520"), bcI18n("西區音樂劇約 US$130", "West End musical about US$130", "Musical del West End aprox. US$130")],
    estimate: 2835,
    hotels: bcI18n("倫敦、牛津與巴斯四星或同級；正式確認書提供最終飯店。", "Four-star or equivalent stays in London, Oxford and Bath; final hotels appear in the confirmation.", "Hoteles de 4 estrellas o similares en Londres, Oxford y Bath; los hoteles finales figuran en la confirmación."),
    transport: bcI18n("國際航班、英國境內遊覽車與倫敦地鐵示意；每日步行約 8,000–12,000 步。", "International air, UK coach and sample London Underground segments; about 8,000–12,000 steps daily.", "Vuelo internacional, autocar y metro de Londres; 8.000–12.000 pasos diarios."),
    cancellation: bcI18n("機票與部分飯店確認後可能不可退。出發 90 日內依實際已發生成本及階梯取消費計算；付款前須確認完整契約。", "Air and some hotels may be non-refundable after confirmation. Within 90 days, actual committed costs and tiered cancellation fees apply. Confirm the full contract before payment.", "El vuelo y algunos hoteles pueden no ser reembolsables. Dentro de 90 días se aplican costos reales y cargos escalonados."),
    departures: [
      { start: "2026.10.11", end: "2026.10.16", status: bcI18n("已成行・餘少", "Confirmed · limited", "Confirmado · últimas plazas"), seats: 3, price: 2480 },
      { start: "2026.11.15", end: "2026.11.20", status: bcI18n("已成行・可報名", "Confirmed · bookable", "Confirmado · disponible"), seats: 7, price: 2560 },
      { start: "2026.12.20", end: "2026.12.25", status: bcI18n("收客中", "Collecting guests", "Formando grupo"), seats: 9, price: 2690 }
    ],
    route: [
      { day: 1, city: bcI18n("舊金山・倫敦", "San Francisco · London", "San Francisco · Londres"), sights: bcI18n("搭機前往倫敦", "Overnight flight to London", "Vuelo nocturno a Londres"), meals: bcI18n("機上餐", "In-flight meals", "Comidas a bordo"), hotel: bcI18n("機上", "Overnight flight", "A bordo"), image: BC_IMG.plane, geo: [51.4700, -0.4543], x: 70, y: 300 },
      { day: 2, city: bcI18n("倫敦西區", "London West End", "West End de Londres"), sights: bcI18n("西敏寺外觀、泰晤士河、柯芬園", "Westminster exterior, Thames and Covent Garden", "Westminster, Támesis y Covent Garden"), meals: bcI18n("早餐・晚餐", "Breakfast · dinner", "Desayuno · cena"), hotel: bcI18n("倫敦四星或同級", "London four-star or equivalent", "Hotel 4 estrellas en Londres"), image: BC_IMG.london, geo: [51.5074, -0.1278], x: 145, y: 245 },
      { day: 3, city: bcI18n("溫莎・牛津", "Windsor · Oxford", "Windsor · Oxford"), sights: bcI18n("溫莎城堡、牛津學院區", "Windsor Castle and Oxford colleges", "Castillo de Windsor y colegios de Oxford"), meals: bcI18n("早餐・午餐", "Breakfast · lunch", "Desayuno · almuerzo"), hotel: bcI18n("Oxford 四星或同級", "Oxford four-star or equivalent", "Hotel 4 estrellas en Oxford"), image: BC_IMG.bath, geo: [51.7520, -1.2577], x: 215, y: 185 },
      { day: 4, city: bcI18n("科茲窩", "The Cotswolds", "Cotswolds"), sights: bcI18n("水上伯頓、石造村落、鄉間午後", "Bourton-on-the-Water, stone villages and a country afternoon", "Bourton-on-the-Water y pueblos de piedra"), meals: bcI18n("早餐", "Breakfast", "Desayuno"), hotel: bcI18n("Bath 四星或同級", "Bath four-star or equivalent", "Hotel 4 estrellas en Bath"), image: BC_IMG.cotswolds, geo: [51.8850, -1.7580], x: 290, y: 150 },
      { day: 5, city: bcI18n("巴斯・巨石陣", "Bath · Stonehenge", "Bath · Stonehenge"), sights: bcI18n("羅馬浴場、皇家新月樓、巨石陣", "Roman Baths, Royal Crescent and Stonehenge", "Termas romanas, Royal Crescent y Stonehenge"), meals: bcI18n("早餐・晚餐", "Breakfast · dinner", "Desayuno · cena"), hotel: bcI18n("倫敦四星或同級", "London four-star or equivalent", "Hotel 4 estrellas en Londres"), image: BC_IMG.bath, geo: [51.1789, -1.8262], x: 350, y: 230 },
      { day: 6, city: bcI18n("倫敦・舊金山", "London · San Francisco", "Londres · San Francisco"), sights: bcI18n("飯店早餐後前往機場", "Airport transfer after breakfast", "Traslado al aeropuerto después del desayuno"), meals: bcI18n("早餐・機上餐", "Breakfast · in-flight meals", "Desayuno · comidas a bordo"), hotel: bcI18n("行程結束", "Journey ends", "Fin del viaje"), image: BC_IMG.plane, geo: [51.4720, -0.4620], x: 430, y: 310 }
    ]
  },
  {
    id: 21,
    code: "JPN-7D",
    destination: bcI18n("日本・東京與京都", "Japan · Tokyo and Kyoto", "Japón · Tokio y Kioto"),
    world: { city: bcI18n("東京", "Tokyo", "Tokio"), region: "JP", lon: 139.6917, lat: 35.6895, x: 801.6, y: 144.9 },
    title: bcI18n("富士與古都慢旅七日", "Fuji and Ancient Capitals", "Fuji y antiguas capitales"),
    days: 7,
    nights: 6,
    nextDate: "2026.11.01",
    returnDate: "2026.11.07",
    price: 2890,
    air: true,
    formed: false,
    seats: 8,
    group: bcI18n("最多 10 人", "Up to 10 guests", "Máximo 10 viajeros"),
    status: bcI18n("收客中・可報名", "Collecting · bookable", "Formando grupo · disponible"),
    features: [bcI18n("富士山溫泉", "Fuji hot spring", "Onsen del Fuji"), bcI18n("京都連泊", "Two Kyoto nights", "Dos noches en Kioto"), bcI18n("含國際機票", "International air included", "Vuelo internacional incluido")],
    image: BC_IMG.fuji,
    gallery: [BC_IMG.fuji, BC_IMG.kyoto, BC_IMG.tokyo],
    flight: {
      type: bcI18n("團體參考航班・已含經濟艙", "Group reference flight · economy included", "Vuelo de grupo · económica incluida"),
      outbound: "NH 107 · SFO 00:20 → HND 04:30+1",
      inbound: "NH 108 · HND 22:55 → SFO 15:50",
      note: bcI18n("航班與機場可能調整；最終以行前確認書為準", "Flight or airport may change; final details follow the confirmation", "El vuelo o aeropuerto puede cambiar; prevalece la confirmación")
    },
    includes: [bcI18n("國際來回經濟艙", "Round-trip international economy air", "Vuelo internacional ida y vuelta"), bcI18n("4 晚飯店、1 晚溫泉旅館與 1 晚機上", "4 hotel nights, 1 ryokan night and 1 overnight flight", "4 noches de hotel, 1 ryokan y 1 noche a bordo"), bcI18n("新幹線、專車與中文領隊", "Bullet train, coach and Chinese-speaking leader", "Tren bala, autocar y líder en chino"), bcI18n("每日早餐與 6 餐特色餐", "Daily breakfast and 6 featured meals", "Desayuno diario y 6 comidas")],
    required: [bcI18n("領隊與司機服務費 US$175", "Leader and driver gratuity US$175", "Propinas US$175"), bcI18n("未列餐食預估 US$140", "Unlisted meals est. US$140", "Comidas no incluidas est. US$140")],
    optional: [bcI18n("單人房差 US$610", "Single supplement US$610", "Suplemento individual US$610"), bcI18n("和服體驗約 US$80", "Kimono experience about US$80", "Experiencia de kimono aprox. US$80")],
    estimate: 3205,
    hotels: bcI18n("東京與京都四星或同級、河口湖溫泉旅館及大阪四星或同級；正式確認書提供最終飯店。", "Four-star or equivalent stays in Tokyo, Kyoto and Osaka, plus a Kawaguchiko ryokan; final hotels appear in the confirmation.", "Hoteles de 4 estrellas o similares en Tokio, Kioto y Osaka, más un ryokan en Kawaguchiko; los hoteles finales figuran en la confirmación."),
    transport: bcI18n("國際航班、專車、新幹線與市區大眾運輸；部分車站需自行提取行李。", "International air, coach, bullet train and local transit; travelers handle luggage at some stations.", "Vuelo, autocar, tren bala y transporte local; equipaje propio en algunas estaciones."),
    cancellation: bcI18n("機票、新幹線與溫泉旅館可能在確認後產生不可退費用。出發 90 日內依契約階梯與實際成本計算。", "Air, bullet-train and ryokan costs may become non-refundable after confirmation. Within 90 days, contract tiers and committed costs apply.", "Vuelo, tren bala y ryokan pueden no ser reembolsables; se aplican cargos escalonados."),
    departures: [
      { start: "2026.11.01", end: "2026.11.07", status: bcI18n("收客中・可報名", "Collecting · bookable", "Formando grupo · disponible"), seats: 8, price: 2890 },
      { start: "2026.11.22", end: "2026.11.28", status: bcI18n("已成行・餘少", "Confirmed · limited", "Confirmado · últimas plazas"), seats: 2, price: 2980 },
      { start: "2027.03.21", end: "2027.03.27", status: bcI18n("預先登記", "Advance registration", "Registro anticipado"), seats: 10, price: 3150 }
    ],
    route: [
      { day: 1, city: bcI18n("舊金山・東京", "San Francisco · Tokyo", "San Francisco · Tokio"), sights: bcI18n("夜間航班前往日本", "Overnight flight to Japan", "Vuelo nocturno a Japón"), meals: bcI18n("機上餐", "In-flight meals", "Comidas a bordo"), hotel: bcI18n("機上", "Overnight flight", "A bordo"), image: BC_IMG.plane, geo: [35.5494, 139.7798], x: 65, y: 320 },
      { day: 2, city: bcI18n("東京下町", "Old Tokyo", "Tokio tradicional"), sights: bcI18n("淺草、隅田川、清澄白河", "Asakusa, Sumida River and Kiyosumi-Shirakawa", "Asakusa, río Sumida y Kiyosumi-Shirakawa"), meals: bcI18n("早餐・晚餐", "Breakfast · dinner", "Desayuno · cena"), hotel: bcI18n("東京四星或同級", "Tokyo four-star or equivalent", "Hotel 4 estrellas en Tokio"), image: BC_IMG.tokyo, geo: [35.7148, 139.7967], x: 130, y: 245 },
      { day: 3, city: bcI18n("鎌倉・河口湖", "Kamakura · Kawaguchiko", "Kamakura · Kawaguchiko"), sights: bcI18n("鎌倉大佛、海岸電車、富士山夕景", "Great Buddha, coastal train and Fuji sunset", "Gran Buda, tren costero y atardecer del Fuji"), meals: bcI18n("早餐・午餐・晚餐", "Breakfast · lunch · dinner", "Desayuno · almuerzo · cena"), hotel: bcI18n("河口湖溫泉旅館", "Kawaguchiko ryokan", "Ryokan en Kawaguchiko"), image: BC_IMG.fuji, geo: [35.5171, 138.7518], x: 195, y: 180 },
      { day: 4, city: bcI18n("河口湖・京都", "Kawaguchiko · Kyoto", "Kawaguchiko · Kioto"), sights: bcI18n("湖畔晨景、新幹線、京都晚間散步", "Lake morning, bullet train and evening Kyoto walk", "Mañana junto al lago, tren bala y paseo en Kioto"), meals: bcI18n("早餐・晚餐", "Breakfast · dinner", "Desayuno · cena"), hotel: bcI18n("京都四星或同級", "Kyoto four-star or equivalent", "Hotel 4 estrellas en Kioto"), image: BC_IMG.kyoto, geo: [34.9858, 135.7588], x: 260, y: 135 },
      { day: 5, city: bcI18n("京都古寺", "Kyoto temples", "Templos de Kioto"), sights: bcI18n("清水寺、哲學之道、祇園", "Kiyomizu-dera, Philosopher's Path and Gion", "Kiyomizu-dera, Camino del Filósofo y Gion"), meals: bcI18n("早餐・午餐", "Breakfast · lunch", "Desayuno · almuerzo"), hotel: bcI18n("京都四星或同級", "Kyoto four-star or equivalent", "Hotel 4 estrellas en Kioto"), image: BC_IMG.kyoto, geo: [35.0037, 135.7788], x: 315, y: 205 },
      { day: 6, city: bcI18n("奈良・大阪", "Nara · Osaka", "Nara · Osaka"), sights: bcI18n("奈良公園、東大寺、大阪河岸夜景", "Nara Park, Todai-ji and Osaka riverfront", "Parque de Nara, Todai-ji y ribera de Osaka"), meals: bcI18n("早餐・晚餐", "Breakfast · dinner", "Desayuno · cena"), hotel: bcI18n("大阪四星或同級", "Osaka four-star or equivalent", "Hotel 4 estrellas en Osaka"), image: BC_IMG.nara, geo: [34.6937, 135.5023], x: 370, y: 260 },
      { day: 7, city: bcI18n("大阪・東京・舊金山", "Osaka · Tokyo · San Francisco", "Osaka · Tokio · San Francisco"), mapLabel: bcI18n("東京羽田", "Tokyo Haneda", "Tokio Haneda"), sights: bcI18n("國內段銜接國際航班返美", "Domestic connection to the international flight home", "Conexión nacional al vuelo internacional"), meals: bcI18n("早餐・機上餐", "Breakfast · in-flight meals", "Desayuno · comidas a bordo"), hotel: bcI18n("行程結束", "Journey ends", "Fin del viaje"), image: BC_IMG.plane, geo: [35.5520, 139.7860], x: 440, y: 325 }
    ]
  }
];

function bcTaiwanStop(id, nameZh, nameEn, summaryZh, summaryEn, descriptionZh, descriptionEn, geo, kind, image, markerOffset = [0, 0]) {
  return {
    id,
    name: bcI18n(nameZh, nameEn),
    summary: bcI18n(summaryZh, summaryEn),
    description: bcI18n(descriptionZh, descriptionEn),
    geo,
    kind,
    image,
    markerOffset,
    sourceStatus: "source_document",
    visitStatus: kind === "rail" ? "route_or_stop_unconfirmed" : kind === "stay" ? "proposed_stay" : "planned_from_source",
    mediaStatus: "demo_placeholder",
    mediaRightsStatus: "prototype_only"
  };
}

// Route-content preview created from the itinerary document supplied for this
// prototype. It deliberately stays out of BC_TOURS until PACK&GO confirms live
// departures, price, inventory, inclusions and image rights.
const BC_TAIWAN_TOUR = {
  id: 88,
  code: "TWN-8D",
  previewOnly: true,
  destination: bcI18n("台灣・經典環島", "Taiwan · Classic circuit"),
  world: { city: bcI18n("台灣", "Taiwan"), region: "TW", lon: 120.9605, lat: 23.6978, x: 724, y: 225 },
  title: bcI18n("福森號 × 鳴日號｜經典台灣環島八日", "Formosensis × Future Express · Classic Taiwan Circuit"),
  days: 8,
  nights: 7,
  status: bcI18n("行程地圖設計中・不可訂購", "Route-map preview · not bookable"),
  group: bcI18n("團型與人數待確認", "Group size to be confirmed"),
  features: [bcI18n("阿里山森林鐵路", "Alishan forest railway"), bcI18n("鳴日號東部幹線", "Future Express east-coast rail"), bcI18n("文化與職人體驗", "Culture and artisan experiences")],
  image: BC_IMG.taiwanForestCabin,
  gallery: [BC_IMG.taiwanForestCabin, BC_IMG.taiwanForestTrain, BC_IMG.taiwanFutureTrain, BC_IMG.taiwanFutureCabin],
  route: [
    {
      day: 1,
      city: bcI18n("桃園・霧峰・嘉義", "Taoyuan · Wufeng · Chiayi", "Taoyuan · Wufeng · Chiayi"),
      sights: bcI18n("機場接機、台式早餐、霧峰林家宮保第與嘉義入住", "Airport welcome, Taiwanese breakfast, Wufeng Lin Family and Chiayi arrival", "Recepción en el aeropuerto, desayuno taiwanés, residencia Lin de Wufeng y llegada a Chiayi"),
      meals: bcI18n("台式豆漿早餐・与玥樓粵菜・飯店晚餐", "Soy-milk breakfast · Cantonese lunch · hotel dinner", "Desayuno con leche de soja · almuerzo cantonés · cena en el hotel"),
      hotel: bcI18n("嘉義福容 voco 酒店或同級・尚未確認", "Fullon Hotel Chiayi voco or equivalent · unconfirmed", "Fullon Hotel Chiayi voco o equivalente · sin confirmar"),
      image: BC_IMG.taiwanForestTrain,
      geo: [24.0616, 120.6994],
      stops: [
        bcTaiwanStop("d1-taoyuan-airport", "桃園國際機場", "Taoyuan International Airport", "接機與台灣第一頓早餐", "Airport welcome and first Taiwanese breakfast", "抵達後由接機服務銜接台式豆漿早餐，再向台中霧峰前進。航班、接機時間與車輛仍待正式確認。", "Meet the arrival transfer, begin with a Taiwanese soy-milk breakfast, then continue to Wufeng. Flight and vehicle details remain unconfirmed.", [25.0797, 121.2342], "arrival", BC_IMG.taiwanForestTrain, [-10, -4]),
        bcTaiwanStop("d1-wufeng-lin", "霧峰林家宮保第園區", "Wufeng Lin Family Mansion", "走進中台灣望族與修復後的歷史建築", "Enter a restored historic estate of a major central-Taiwan family", "霧峰林家為台灣五大家族之一。園區承載十九世紀中台灣的地方史，也見證 921 地震後由後代持續修復、重現原貌的過程。", "One of Taiwan's five prominent historic families, this estate connects nineteenth-century central Taiwan with the long restoration that followed the 1999 earthquake.", [24.0616, 120.6994], "heritage", BC_IMG.taiwanForestTrain),
        bcTaiwanStop("d1-chiayi-voco", "嘉義福容 voco 酒店", "Fullon Hotel Chiayi voco", "在高樓層看阿里山、玉山與嘉南平原", "High-floor views toward Alishan, Yushan and the western plain", "文件以『嘉義 101』形容這座高樓旅宿；住房位於十六樓以上。此處為預定住宿方向，仍保留『或同級』條件。", "The itinerary describes a high-rise stay with mountain or plain views. It remains a proposed hotel category and may be replaced by an equivalent property.", [23.4876, 120.4439], "stay", BC_IMG.taiwanForestCabin)
      ]
    },
    {
      day: 2,
      city: bcI18n("阿里山林鐵・奮起湖至北門", "Alishan railway · Fenqihu to Beimen", "Ferrocarril de Alishan · Fenqihu a Beimen"),
      sights: bcI18n("福森號森品茗套裝遊程，沿山林鐵路回到嘉義", "Formosensis tea journey along the forest railway to Chiayi", "Viaje de té a bordo del Formosensis por el ferrocarril forestal hasta Chiayi"),
      meals: bcI18n("飯店早餐・山芙蓉茶業午餐・voco 半自助晚餐", "Hotel breakfast · tea-estate lunch · semi-buffet dinner", "Desayuno en el hotel · almuerzo en finca de té · cena semibufé"),
      hotel: bcI18n("嘉義福容 voco 酒店或同級・尚未確認", "Fullon Hotel Chiayi voco or equivalent · unconfirmed", "Fullon Hotel Chiayi voco o equivalente · sin confirmar"),
      image: BC_IMG.taiwanForestCabin,
      geo: [23.5049, 120.6950],
      stops: [
        bcTaiwanStop("d2-fenqihu", "奮起湖", "Fenqihu", "福森號森品茗旅程的山城起點", "Mountain-town origin of the Formosensis tea journey", "午餐後由奮起湖登上福森號。車內以阿里山高山茶、茶點、古典旋律與山嵐景觀串起林鐵記憶。", "Board the Formosensis after lunch for high-mountain tea, small bites, music and forest views that connect the journey to Alishan railway heritage.", [23.5049, 120.6950], "rail", BC_IMG.taiwanForestCabin),
        bcTaiwanStop("d2-shuisheliao", "水社寮站", "Shuisheliao Station", "山林鐵路中的路線節點", "A route node in the mountain railway", "文件把水社寮列在福森號行經順序中，但沒有明示下車或入場安排；原型因此只標示為可辨識的鐵路節點。", "The source lists Shuisheliao in the rail sequence without confirming a stop or visit, so the prototype treats it only as a route node.", [23.5095, 120.6597], "rail", BC_IMG.taiwanForestTrain),
        bcTaiwanStop("d2-jiaoliping", "交力坪站", "Jiaoliping Station", "山線由高處向嘉義過渡", "The railway transitions from the highlands toward Chiayi", "交力坪位於福森號奮起湖至北門的行經線上；是否停靠與實際時刻仍以林鐵核定公告為準。", "Jiaoliping sits on the listed Fenqihu–Beimen rail sequence. Any actual stop and timing remain subject to the approved railway schedule.", [23.4977, 120.6038], "rail", BC_IMG.taiwanForestTrain),
        bcTaiwanStop("d2-zhuqi", "竹崎站", "Zhuqi Station", "森林鐵路進入嘉義平原前的重要節點", "A key railway point before the Chiayi plain", "竹崎是文件列出的福森號行經站之一。原型保留地理位置，但不把路線經過誤寫成已安排下車。", "Zhuqi is named in the supplied rail sequence. The map preserves its geography without presenting a pass-through as a confirmed visit.", [23.5222, 120.5482], "rail", BC_IMG.taiwanForestTrain),
        bcTaiwanStop("d2-beimen", "北門車站", "Beimen Station", "森品茗旅程終點，回到嘉義市區", "End of the tea journey and return to Chiayi", "福森號預定由奮起湖行至北門，之後回飯店晚餐。實際發車與抵達時間需以林鐵核定公告為主。", "The planned Formosensis segment ends at Beimen before returning to the hotel. Final departure and arrival times require railway approval.", [23.4936, 120.4521], "rail", BC_IMG.taiwanForestTrain)
      ]
    },
    {
      day: 3,
      city: bcI18n("嘉義・日月潭", "Chiayi · Sun Moon Lake", "Chiayi · Sun Moon Lake"),
      sights: bcI18n("紅茶莊園戶外茶席、日月潭遊船與伊達邵", "Tea-estate tasting, lake cruise and Ita Thao", "Degustación en finca de té, paseo por el lago e Ita Thao"),
      meals: bcI18n("飯店早餐・雲品套餐・丹彤自助晚餐", "Hotel breakfast · Fleur de Chine set lunch · buffet dinner", "Desayuno en el hotel · menú en Fleur de Chine · cena bufé"),
      hotel: bcI18n("日月潭雲品溫泉酒店湖景房或同級・尚未確認", "Fleur de Chine lake-view room or equivalent · unconfirmed", "Fleur de Chine, habitación con vista al lago o equivalente · sin confirmar"),
      image: BC_IMG.taiwanForestCabin,
      geo: [23.8659, 120.9159],
      stops: [
        bcTaiwanStop("d3-sun-moon-lake", "日月潭", "Sun Moon Lake", "群山環抱的湖上航行", "A lake journey framed by mountains", "抵達日月潭後，以遊船把湖景、聚落與山線放在同一段行程中。文件標示海拔約 760 公尺。", "A lake cruise connects the mountain setting and lakeside communities. The supplied itinerary places the lake at roughly 760 metres above sea level.", [23.8659, 120.9159], "landscape", BC_IMG.taiwanForestCabin),
        bcTaiwanStop("d3-dongfeng-tea", "東峰紅茶莊園・戶外茶席", "Dongfeng black-tea estate", "從環境、採摘到製茶的五感品茶", "A sensory tasting from terroir and picking to production", "講師從台灣茶、環境管理、採摘與製茶談起，再以戶外茶席完成五感品飲。文件另稱『東峰戶外茶席』，正式名稱仍待確認。", "A host introduces Taiwan tea, land stewardship, picking and processing before a sensory outdoor tasting. The final activity name remains to be confirmed.", [23.8858, 120.9272], "experience", BC_IMG.taiwanForestCabin, [9, -4]),
        bcTaiwanStop("d3-ita-thao", "伊達邵老街與碼頭", "Ita Thao village and pier", "邵族聚落、碼頭與逐鹿市集", "Thao community, pier and Zhulu market", "伊達邵是邵族主要聚落與遊艇據點；逐鹿市集集結藝品、風味餐、小吃與在地農產。", "Ita Thao is a principal Thao community and lake-pier hub. Its market brings together crafts, Indigenous flavours, snacks and local produce.", [23.8496, 120.9304], "culture", BC_IMG.taiwanForestCabin, [8, 7]),
        bcTaiwanStop("d3-fleur-de-chine", "雲品溫泉酒店", "Fleur de Chine Hotel", "湖景住宿與當日晚餐", "Lake-view stay and dinner", "文件指定湖景房，但仍寫『或同等級』；原型只呈現住宿方向，不表示飯店已完成訂房。", "The source requests a lake-view room while retaining an equivalent-hotel condition. This is a proposed stay, not a confirmed reservation.", [23.8825, 120.9120], "stay", BC_IMG.taiwanForestCabin, [-8, -3])
      ]
    },
    {
      day: 4,
      city: bcI18n("日月潭・北埔・台北", "Sun Moon Lake · Beipu · Taipei", "Sun Moon Lake · Beipu · Taipéi"),
      sights: bcI18n("客家老街、歷史建築與擂茶 DIY", "Hakka old street, historic buildings and lei-cha workshop", "Calle antigua hakka, edificios históricos y taller de lei-cha"),
      meals: bcI18n("飯店早餐・客家粄條・粵亮廣式料理", "Hotel breakfast · Hakka noodles · Cantonese dinner", "Desayuno en el hotel · fideos hakka · cena cantonesa"),
      hotel: bcI18n("台北六福萬怡酒店或同級・尚未確認", "Courtyard Taipei or equivalent · unconfirmed", "Courtyard Taipei o equivalente · sin confirmar"),
      image: BC_IMG.taiwanForestTrain,
      geo: [24.6991, 121.0572],
      stops: [
        bcTaiwanStop("d4-beipu-old-street", "北埔老街", "Beipu Old Street", "用一條街讀懂客家聚落日常", "Read Hakka community life through one historic street", "老街保存歷史建築與客家生活風貌，也是金廣福、慈天宮與周邊家廟的步行起點。", "The old street preserves historic buildings and everyday Hakka character, forming the walkable base for nearby heritage sites.", [24.6991, 121.0572], "heritage", BC_IMG.taiwanForestTrain, [-22, -12]),
        bcTaiwanStop("d4-jinguangfu", "金廣福公館", "Jinguangfu House", "清代拓墾與族群合作的歷史據點", "A Qing-era frontier office tied to cross-community cooperation", "金廣福公館是清代拓墾據點；文件以它說明漢人與原住民族在開墾歷史中的合作關係。", "A Qing-era frontier office used in the itinerary to discuss settlement history and cooperation between Han and Indigenous communities.", [24.6996, 121.0570], "heritage", BC_IMG.taiwanForestTrain, [-7, -1]),
        bcTaiwanStop("d4-citian-temple", "慈天宮", "Citian Temple", "北埔以媽祖為中心的信仰場域", "Beipu's Mazu-centered community temple", "慈天宮主祀媽祖，是北埔聚落的信仰中心之一，與老街生活緊密相連。", "Dedicated to Mazu, Citian Temple is one of Beipu's community faith centers and remains closely tied to old-street life.", [24.6990, 121.0576], "culture", BC_IMG.taiwanForestTrain, [10, -10]),
        bcTaiwanStop("d4-jiang-ancestral", "姜氏家廟", "Jiang Family Ancestral Hall", "典型客家宗祠建築", "A representative Hakka ancestral hall", "姜氏家廟以宗祠空間、家族脈絡與客家建築語彙補完整段北埔歷史步行。", "The ancestral hall adds family history and Hakka architectural language to the Beipu heritage walk.", [24.6979, 121.0570], "heritage", BC_IMG.taiwanForestTrain, [22, 5]),
        bcTaiwanStop("d4-lei-cha", "擂茶 DIY", "Lei-cha workshop", "親手研磨茶與穀物，完成一杯客家滋味", "Grind tea and grains to make a Hakka drink", "以傳統工具研磨食材，從動作、香氣與味道理解擂茶文化；不是只看展示，而是親手完成。", "Use traditional tools to grind ingredients and understand lei-cha through movement, aroma and taste rather than passive viewing.", [24.6985, 121.0582], "experience", BC_IMG.taiwanForestCabin, [1, 18])
      ]
    },
    {
      day: 5,
      city: bcI18n("台北城市文化", "Taipei city culture", "Cultura urbana de Taipéi"),
      sights: bcI18n("故宮、艋舺、剝皮寮與台北 101", "National Palace Museum, Monga, Bopiliao and Taipei 101", "National Palace Museum, Monga, Bopiliao y Taipei 101"),
      meals: bcI18n("飯店早餐・鼎泰豐・台北無菜單料理", "Hotel breakfast · Din Tai Fung · chef's-menu dinner", "Desayuno en el hotel · Din Tai Fung · cena de menú del chef"),
      hotel: bcI18n("台北六福萬怡酒店或同級・尚未確認", "Courtyard Taipei or equivalent · unconfirmed", "Courtyard Taipei o equivalente · sin confirmar"),
      image: BC_IMG.taiwanFutureTrain,
      geo: [25.1024, 121.5485],
      stops: [
        bcTaiwanStop("d5-palace-museum", "國立故宮博物院", "National Palace Museum", "從書畫、瓷器、玉器與青銅器讀中國藝術史", "Read Chinese art history through painting, ceramics, jade and bronzes", "文件以逾七十萬件典藏概括故宮的跨朝代收藏。實際展品會輪替，原型不承諾看見特定文物。", "The itinerary describes a collection of more than 700,000 works across dynasties. Displays rotate, so the prototype promises no specific object.", [25.1024, 121.5485], "museum", BC_IMG.taiwanFutureTrain),
        bcTaiwanStop("d5-longshan", "艋舺龍山寺", "Longshan Temple", "觀音信仰、青草巷與艋舺日常", "Guanyin devotion, Herb Alley and Monga life", "龍山寺建於 1738 年，由泉州移民合資興建。行程延伸到擲筊求籤、月老信仰與周邊青草巷。", "Founded in 1738 by immigrants from Quanzhou, the temple visit extends to divination customs, the matchmaker deity and nearby Herb Alley.", [25.0372, 121.4999], "culture", BC_IMG.taiwanFutureTrain, [-9, -2]),
        bcTaiwanStop("d5-bopiliao", "剝皮寮歷史街區", "Bopiliao Historic Block", "紅磚街屋裡的清代與日治城市層次", "Qing and Japanese-era urban layers in red-brick streets", "剝皮寮保留台北少見的清代街區尺度，紅磚街屋融合閩式與日治巴洛克立面，與龍山寺步行串連。", "A rare surviving Qing-era urban block, Bopiliao combines Minnan brick streets with Japanese-era Baroque façades near Longshan Temple.", [25.0367, 121.5022], "heritage", BC_IMG.taiwanFutureTrain, [12, 9]),
        bcTaiwanStop("d5-taipei-101", "台北 101 觀景台", "Taipei 101 Observatory", "從高空讀台北盆地與城市軸線", "Read the Taipei basin and city grid from above", "行程包含觀景台門票。建築由李祖原設計，以『八』為結構與外觀的重要單元。", "The itinerary includes observatory admission. Designed by C. Y. Lee, the tower uses the auspicious number eight as a structural and visual motif.", [25.0339, 121.5645], "landmark", BC_IMG.taiwanFutureTrain)
      ]
    },
    {
      day: 6,
      city: bcI18n("鳴日號・北迴線至台東", "Future Express · northeast coast to Taitung", "Future Express · costa noreste a Taitung"),
      sights: bcI18n("龜山島慢行眺望、東里田野、成功海光走讀與南島之夜", "Guishan Island views, Dongli fields, Chenggong walk and Austronesian night", "Vistas de Guishan Island, campos de Dongli, paseo por Chenggong y noche austronesia"),
      meals: bcI18n("鳴日早餐盒・列車餐盒・方舟音樂餐廳晚宴", "Rail breakfast box · train lunch · Ark music dinner", "Caja de desayuno · caja de almuerzo a bordo · cena en Ark Music Restaurant"),
      hotel: bcI18n("台東 The GAYA Hotel 或同級・尚未確認", "The GAYA Hotel Taitung or equivalent · unconfirmed", "The GAYA Hotel Taitung o equivalente · sin confirmar"),
      image: BC_IMG.taiwanFutureCabin,
      geo: [25.0522, 121.6071],
      stops: [
        bcTaiwanStop("d6-nangang", "南港站・鳴日月台", "Nangang Station · Future Express platform", "交行李、報到並認識美學車廂", "Check luggage, register and meet the design train", "旅客需在發車前至少二十分鐘完成報到。行李交由服務人員後登車，先從月台與車廂認識鳴日設計。", "Guests must complete registration at least twenty minutes before departure, hand over luggage and begin with an introduction to the train and platform.", [25.0522, 121.6071], "rail", BC_IMG.taiwanFutureCabin, [-6, -5]),
        bcTaiwanStop("d6-shicheng-dali", "石城－大里龜山島觀景段", "Shicheng–Dali scenic rail segment", "列車緩行看蘭陽海岸與龜山島", "A slow rail passage along the Lanyang coast and Guishan Island", "這一段安排列車緩行遠眺龜山島與海岸，不代表旅客會在石城或大里下車。", "The train is planned to slow for coast and island views; the source does not state that passengers disembark at either station.", [24.9718, 121.9224], "landscape", BC_IMG.taiwanFutureCabin),
        bcTaiwanStop("d6-dongli", "東里站", "Dongli Station", "田野、中央山脈與月台迎賓", "Fields, Central Range views and a platform welcome", "架高月台被田野包圍，季節可見油菜花、水田、綠田或稻浪；文件另安排月台迎賓表演。", "An elevated station framed by fields and the Central Range, with seasonal crop colours and a planned welcome performance.", [23.2731, 121.3047], "rail", BC_IMG.taiwanFutureTrain),
        bcTaiwanStop("d6-chenggong-walk", "成功鎮・海光走讀", "Chenggong · Sea-light story walk", "以音樂與文學串起海岸職人故事", "Music and literature connect coastal craft and family stories", "由製作人鍾慧君帶領，以音樂、漁法、家族記憶與地方空間展開成功鎮的海光走讀。", "Producer Chung Hui-chun leads a story walk linking music, fishing techniques, family memory and the coastal townscape.", [23.1002, 121.3768], "culture", BC_IMG.taiwanFutureTrain, [-18, -8]),
        bcTaiwanStop("d6-yiwan-church", "宜灣卡片教堂", "Yiwan Card Church", "海岸聚落中的小型信仰建築", "A small church woven into a coastal community", "卡片教堂是海光走讀的一站，透過建築與地方人物理解海岸聚落的信仰與生活。", "A stop on the Sea-light walk, using architecture and local voices to introduce faith and daily life in the coastal settlement.", [23.1742, 121.3930], "heritage", BC_IMG.taiwanFutureTrain, [8, -5]),
        bcTaiwanStop("d6-xiaocou-harbor", "小湊漁港", "Xiaocou Fishing Harbor", "從漁港讀成功海岸的產業節奏", "Read the working rhythm of the Chenggong coast", "小湊漁港讓走讀回到捕魚、港口與家族生計；實際停留方式與動線仍依當日導覽安排。", "The harbor grounds the walk in fishing, port work and family livelihoods. The final stop pattern follows the on-site guide.", [23.1370, 121.3950], "harbor", BC_IMG.taiwanFutureTrain, [14, 5]),
        bcTaiwanStop("d6-tianhou", "成廣澳百年天后宮", "Chengguang'ao Tianhou Temple", "海上信仰與港口聚落記憶", "Maritime faith and port-community memory", "百年天后宮把媽祖信仰、航海安全與成廣澳聚落的歷史放進同一段海岸敘事。", "The century-old temple connects Mazu devotion, safety at sea and the historical memory of the Chengguang'ao settlement.", [23.0990, 121.3786], "culture", BC_IMG.taiwanFutureTrain, [15, -11]),
        bcTaiwanStop("d6-diving-school", "潛水小學校", "Diving School", "由海洋教育看成功的下一代", "See Chenggong's future through marine education", "文件把潛水小學校列入走讀，以教育、海洋與地方青年補充漁業之外的成功故事。", "The walk uses this marine-learning stop to add education and local youth to Chenggong's story beyond the fishing industry.", [23.1030, 121.3812], "culture", BC_IMG.taiwanFutureTrain, [28, 7]),
        bcTaiwanStop("d6-ark-music", "方舟音樂餐廳・南島 Fusion 之夜", "Ark Music Restaurant · Austronesian Fusion Night", "以音樂與晚宴談南島文化交會", "A dinner and music evening about Austronesian connections", "晚宴以音樂與料理呈現南島語族與現代台灣的文化融合；正式演出內容仍以當日確認為準。", "Music and food frame the cultural connections between Austronesian peoples and contemporary Taiwan. The final program remains subject to confirmation.", [22.7572, 121.1500], "dining", BC_IMG.taiwanFutureCabin, [-9, -5]),
        bcTaiwanStop("d6-gaya", "The GAYA Hotel", "The GAYA Hotel", "以海、土地、人文與山為色彩概念的旅宿", "A design hotel shaped by sea, land, culture and mountain palettes", "文件以四色概念與藝術收藏介紹 GAYA；這是住宿方向，不表示房間已完成確認。", "The itinerary introduces GAYA through four place-based colour themes and its art collection. It is a proposed stay, not a confirmed room.", [22.7554, 121.1486], "stay", BC_IMG.taiwanFutureCabin, [12, 9])
      ]
    },
    {
      day: 7,
      city: bcI18n("台東山林・鹿野・花蓮", "Taitung highlands · Luye · Hualien", "Tierras altas de Taitung · Luye · Hualien"),
      sights: bcI18n("布農部落體驗、鳴日號縱谷北上與花蓮海景住宿", "Bunun community experience, valley rail and Hualien views", "Experiencia en comunidad bunun, tren por el valle y vistas de Hualien"),
      meals: bcI18n("飯店早餐・布農火塘煙燻文化餐桌・飯店晚餐", "Hotel breakfast · Bunun fire-smoked table · hotel dinner", "Desayuno en el hotel · mesa cultural bunun · cena en el hotel"),
      hotel: bcI18n("花蓮遠雄悅來大飯店或同級・尚未確認", "Farglory Hotel Hualien or equivalent · unconfirmed", "Farglory Hotel Hualien o equivalente · sin confirmar"),
      image: BC_IMG.taiwanFutureTrain,
      geo: [22.9380, 121.0880],
      stops: [
        bcTaiwanStop("d7-uninang", "永康部落・烏尼囊", "Yongkang community · Uninang", "石板陷阱、射箭、山林知識與八部合音", "Stone traps, archery, forest knowledge and eight-part harmony", "『烏尼囊』在布農語中帶有感謝與祝福之意。體驗包含狩獵知識、植物利用、火塘餐食與八部合音；山區路段使用九人座小巴。", "Uninang carries meanings of thanks and blessing in Bunun. Activities cover hunting knowledge, plants, fire-cooked food and eight-part harmony, with nine-seat minibuses used in the mountain area.", [22.9400, 121.0840], "culture", BC_IMG.taiwanFutureTrain),
        bcTaiwanStop("d7-luye", "鹿野站", "Luye Station", "鳴日號花東縱谷段的登車點", "Boarding point for the Future Express valley segment", "本日鳴日號實際列車路線為鹿野至花蓮；部落到車站的接駁細節仍待正式行程補齊。", "The day's stated Future Express segment runs from Luye to Hualien. Transfer details from the community to the station remain to be finalized.", [22.9125, 121.1373], "rail", BC_IMG.taiwanFutureCabin),
        bcTaiwanStop("d7-hualien", "花蓮站", "Hualien Station", "結束縱谷列車段，轉往海岸山脈住宿", "End the valley rail segment and transfer toward the coastal range", "抵達花蓮後銜接飯店。列車時刻與接駁時間仍須配合最終台鐵核准。", "Arrival connects to the hotel transfer. Rail and ground-transfer times remain subject to the approved final schedule.", [23.9927, 121.6013], "rail", BC_IMG.taiwanFutureTrain, [-8, -5]),
        bcTaiwanStop("d7-farglory", "花蓮遠雄悅來大飯店", "Farglory Hotel Hualien", "東望太平洋、西看中央山脈與縱谷", "Pacific, Central Range and valley views", "飯店位於海岸山脈北端，可從高處理解太平洋、中央山脈與花東縱谷的地理關係；仍保留『或同級』條件。", "Set on the northern coastal range, the hotel overlooks the Pacific, Central Range and Hualien valley. An equivalent-property condition still applies.", [23.9019, 121.6035], "stay", BC_IMG.taiwanFutureTrain)
      ]
    },
    {
      day: 8,
      city: bcI18n("壽豐・花蓮・南港・桃園", "Shoufeng · Hualien · Nangang · Taoyuan", "Shoufeng · Hualien · Nangang · Taoyuan"),
      sights: bcI18n("台灣玉工藝、鳴日號返抵南港與機場送行", "Taiwan jade craft, Future Express return and airport transfer", "Artesanía de jade taiwanés, regreso en Future Express y traslado al aeropuerto"),
      meals: bcI18n("飯店早餐・闔家歡南北餚午餐・晚餐未列", "Hotel breakfast · local lunch · dinner not listed", "Desayuno en el hotel · almuerzo local · cena no indicada"),
      hotel: bcI18n("不安排住宿・行程結束", "No hotel · journey ends", "Sin hotel · fin del viaje"),
      image: BC_IMG.taiwanFutureCabin,
      geo: [23.8510, 121.4969],
      stops: [
        bcTaiwanStop("d8-jade-workshop", "如豐琢玉工坊", "Rufeng jade workshop", "認識豐田礦區台灣玉並親手加工", "Learn about Fengtian jade and shape a piece by hand", "工坊從豐田礦區、台灣軟玉與閃玉歷史談起，旅客挑選玉料並完成加工體驗。", "The workshop introduces Fengtian mining and Taiwan nephrite before guests choose and work a piece of jade.", [23.8510, 121.4969], "experience", BC_IMG.taiwanFutureCabin),
        bcTaiwanStop("d8-hualien", "花蓮站", "Hualien Station", "登上鳴日號，開始最後一段北返", "Board the Future Express for the final northbound segment", "本日列車路線為花蓮至南港；實際發車時間與抵達時間仍以台鐵最終核准為主。", "The stated rail segment runs from Hualien to Nangang. Departure and arrival times remain subject to final railway approval.", [23.9927, 121.6013], "rail", BC_IMG.taiwanFutureTrain, [9, 5]),
        bcTaiwanStop("d8-nangang", "南港站", "Nangang Station", "鳴日號旅程終點與送機轉接", "End of the Future Express journey and airport-transfer connection", "文件寫晚間抵達南港後再送桃園機場，航班銜接時間尚未提供；正式安排前必須保留充分緩衝。", "The source places an airport transfer after an evening Nangang arrival but provides no flight time. A safe connection buffer must be confirmed.", [25.0522, 121.6071], "rail", BC_IMG.taiwanFutureCabin, [11, 8]),
        bcTaiwanStop("d8-taoyuan-airport", "桃園國際機場", "Taoyuan International Airport", "行程送機終點・航班銜接待確認", "Airport drop-off · flight connection unconfirmed", "這是文件列出的送機終點，不代表航班或送機時間已接線；正式版必須先核對南港抵達與航班報到時間。", "This is the listed drop-off point, not a confirmed flight connection. Production must reconcile the Nangang arrival with airline check-in time.", [25.0797, 121.2342], "departure", BC_IMG.taiwanFutureCabin, [12, 7])
      ]
    }
  ]
};

const BC_DETAIL_TOURS = [...BC_TOURS, BC_TAIWAN_TOUR];

// Prototype-only movement estimates. These make trip intensity visible before
// booking; production must replace them with supplier-confirmed routing data.
const BC_DAY_MOVEMENT = {
  2: [
    ["9 人座專車", "Private minivan", "約 1 小時 15 分", "Approx. 1 hr 15 min", "馬德里機場 → 阿維拉", "Madrid airport → Ávila"],
    ["9 人座專車", "Private minivan", "約 2 小時 25 分", "Approx. 2 hr 25 min", "阿維拉 → 薩拉曼卡約 1:10；薩拉曼卡 → 巴利亞多利德約 1:15", "Ávila → Salamanca approx. 1:10; Salamanca → Valladolid approx. 1:15"],
    ["9 人座專車", "Private minivan", "約 3 小時 05 分", "Approx. 3 hr 05 min", "巴利亞多利德 → 佈爾戈斯約 1:20；佈爾戈斯 → 畢爾巴鄂約 1:45", "Valladolid → Burgos approx. 1:20; Burgos → Bilbao approx. 1:45"],
    ["9 人座專車・長途移動日", "Private minivan · long transfer day", "約 5 小時 45 分", "Approx. 5 hr 45 min", "畢爾巴鄂 → 塞戈維亞約 3:15；塞戈維亞 → 昆卡約 2:30", "Bilbao → Segovia approx. 3:15; Segovia → Cuenca approx. 2:30"],
    ["9 人座專車", "Private minivan", "約 4 小時 05 分", "Approx. 4 hr 05 min", "昆卡 → 風車村約 2:15；續往托萊多與馬德里約 1:50", "Cuenca → windmill village approx. 2:15; onward to Toledo and Madrid approx. 1:50"]
  ],
  3: [
    ["國際航班", "International flight", "夜間航班", "Overnight flight", "舊金山 → 倫敦；地面接駁依航班抵達時間安排", "San Francisco → London; ground transfer follows the final arrival time"],
    ["市區地鐵與步行", "Underground and walking", "市區移動約 1 小時", "Approx. 1 hr local transit", "西敏寺、泰晤士河與柯芬園間分段移動", "Short transfers between Westminster, the Thames and Covent Garden"],
    ["遊覽車", "Touring coach", "約 2 小時", "Approx. 2 hr", "倫敦 → 溫莎約 1:00；溫莎 → 牛津約 1:00", "London → Windsor approx. 1:00; Windsor → Oxford approx. 1:00"],
    ["遊覽車", "Touring coach", "約 2 小時 30 分", "Approx. 2 hr 30 min", "牛津 → 科茲窩村落 → 巴斯，依村落停靠順序調整", "Oxford → Cotswolds villages → Bath; timing varies with village order"],
    ["遊覽車", "Touring coach", "約 3 小時", "Approx. 3 hr", "巴斯 → 巨石陣約 1:00；巨石陣 → 倫敦約 2:00", "Bath → Stonehenge approx. 1:00; Stonehenge → London approx. 2:00"],
    ["機場接送＋國際航班", "Airport transfer + international flight", "接送約 1 小時 15 分", "Transfer approx. 1 hr 15 min", "倫敦市區 → 希斯洛機場；航班時間另列", "Central London → Heathrow; flight duration shown separately"]
  ],
  21: [
    ["國際航班", "International flight", "夜間航班", "Overnight flight", "舊金山 → 東京；地面接駁依航班抵達時間安排", "San Francisco → Tokyo; ground transfer follows the final arrival time"],
    ["地鐵與步行", "Metro and walking", "市區移動約 1 小時 15 分", "Approx. 1 hr 15 min local transit", "淺草、隅田川與清澄白河間分段移動", "Short transfers between Asakusa, the Sumida River and Kiyosumi-Shirakawa"],
    ["電車＋專車", "Rail + private vehicle", "約 3 小時 30 分", "Approx. 3 hr 30 min", "東京 → 鎌倉約 1:00；鎌倉 → 河口湖約 2:30", "Tokyo → Kamakura approx. 1:00; Kamakura → Kawaguchiko approx. 2:30"],
    ["巴士＋新幹線", "Bus + bullet train", "約 4 小時", "Approx. 4 hr", "河口湖 → 新幹線轉乘站 → 京都；含轉乘緩衝", "Kawaguchiko → bullet-train interchange → Kyoto, including transfer buffer"],
    ["市區大眾運輸與步行", "Local transit and walking", "市區移動約 1 小時", "Approx. 1 hr local transit", "清水寺、哲學之道與祇園間分段移動", "Short transfers among Kiyomizu-dera, Philosopher's Path and Gion"],
    ["近鐵／專車", "Rail / private vehicle", "約 2 小時", "Approx. 2 hr", "京都 → 奈良約 1:00；奈良 → 大阪約 1:00", "Kyoto → Nara approx. 1:00; Nara → Osaka approx. 1:00"],
    ["機場接送＋國內／國際航班", "Airport transfer + domestic / international flights", "地面接送約 1 小時", "Ground transfer approx. 1 hr", "大阪市區 → 機場；空中段與轉機時間另列", "Central Osaka → airport; flight and connection times shown separately"]
  ],
  88: [
    ["專車接駁", "Private transfer", "約 2 小時 30 分", "Approx. 2 hr 30 min", "桃園 → 霧峰 → 嘉義；依抵達航班與用餐時間調整", "Taoyuan → Wufeng → Chiayi; adjusted to flight arrival and meal timing"],
    ["福森號＋接駁車", "Formosensis train + transfer", "交通約 4 小時", "Approx. 4 hr in transit", "嘉義 → 阿里山茶鄉；列車時刻待台鐵最終核准", "Chiayi → Alishan tea country; rail timing awaits final approval"],
    ["專車接駁", "Private transfer", "約 3 小時", "Approx. 3 hr", "阿里山 → 日月潭；山區路況可能延長", "Alishan → Sun Moon Lake; mountain-road conditions may add time"],
    ["專車接駁", "Private transfer", "約 3 小時 30 分", "Approx. 3 hr 30 min", "日月潭 → 北埔 → 台北，分段停靠", "Sun Moon Lake → Beipu → Taipei with intermediate stops"],
    ["專車＋市區移動", "Private transfer + local transit", "約 2 小時", "Approx. 2 hr", "台北近郊與市區景點分段接駁", "Short transfers across greater Taipei and city stops"],
    ["鳴日號", "Future Express", "列車約 4 小時", "Approx. 4 hr by rail", "南港 → 台東；實際時刻待台鐵最終核准", "Nangang → Taitung; final schedule awaits railway approval"],
    ["9 人座小巴＋鳴日號", "Nine-seat minibus + Future Express", "交通約 4 小時", "Approx. 4 hr in transit", "台東近郊小巴行程後銜接花蓮列車段", "Taitung minibus touring followed by the rail segment to Hualien"],
    ["鳴日號＋機場接送", "Future Express + airport transfer", "交通約 4 小時 30 分", "Approx. 4 hr 30 min", "花蓮 → 南港 → 桃園機場；必須保留航班報到緩衝", "Hualien → Nangang → Taoyuan Airport; airline check-in buffer is required"]
  ]
};

function bcJourneyDayMovement(t, day) {
  const movement = day.dataContract?.movement;
  if (!movement) return { mode:bcI18n("交通待確認","Transport pending"), total:bcI18n("時間待確認","Timing pending"), detail:bcI18n("正式路線與供應商確認後補入。","Added after route and supplier confirmation.") };
  return { mode:movement.mode, total:movement.displayDuration, detail:movement.displayDetail, durationMinutes:movement.durationMinutes, status:movement.status };
}

// Detail-map stops are attached to the same route objects used by the day story.
// A day may contain more than one real stop; the regional map therefore never
// pretends that a two-city day happened at one arbitrary coordinate.
const BC_ROUTE_STOPS = {
  2: [
    [["馬德里", "Madrid", "Madrid", 40.4168, -3.7038], ["阿維拉", "Ávila", "Ávila", 40.6565, -4.6812]],
    [["薩拉曼卡", "Salamanca", "Salamanca", 40.9701, -5.6635], ["巴利亞多利德", "Valladolid", "Valladolid", 41.6523, -4.7245]],
    [["佈爾戈斯", "Burgos", "Burgos", 42.3439, -3.6969], ["畢爾巴鄂", "Bilbao", "Bilbao", 43.2630, -2.9350]],
    [["塞戈維亞", "Segovia", "Segovia", 40.9429, -4.1088], ["昆卡", "Cuenca", "Cuenca", 40.0704, -2.1374]],
    [["托萊多", "Toledo", "Toledo", 39.8628, -4.0273], ["馬德里", "Madrid", "Madrid", 40.4168, -3.7038]]
  ],
  3: [
    [["倫敦希斯洛機場", "London Heathrow", "Londres Heathrow", 51.4700, -0.4543]],
    [["西敏寺", "Westminster", "Westminster", 51.4993, -0.1273], ["柯芬園", "Covent Garden", "Covent Garden", 51.5117, -0.1240]],
    [["溫莎", "Windsor", "Windsor", 51.4839, -0.6044], ["牛津", "Oxford", "Oxford", 51.7520, -1.2577]],
    [["水上伯頓", "Bourton-on-the-Water", "Bourton-on-the-Water", 51.8850, -1.7580]],
    [["巴斯", "Bath", "Bath", 51.3811, -2.3590], ["巨石陣", "Stonehenge", "Stonehenge", 51.1789, -1.8262]],
    [["倫敦希斯洛機場", "London Heathrow", "Londres Heathrow", 51.4720, -0.4620]]
  ],
  21: [
    [["東京羽田機場", "Tokyo Haneda", "Tokio Haneda", 35.5494, 139.7798]],
    [["淺草", "Asakusa", "Asakusa", 35.7148, 139.7967], ["清澄白河", "Kiyosumi-Shirakawa", "Kiyosumi-Shirakawa", 35.6817, 139.8002]],
    [["鎌倉", "Kamakura", "Kamakura", 35.3192, 139.5467], ["河口湖", "Kawaguchiko", "Kawaguchiko", 35.5171, 138.7518]],
    [["河口湖", "Kawaguchiko", "Kawaguchiko", 35.5171, 138.7518], ["京都", "Kyoto", "Kioto", 34.9858, 135.7588]],
    [["清水寺", "Kiyomizu-dera", "Kiyomizu-dera", 34.9949, 135.7850], ["祇園", "Gion", "Gion", 35.0037, 135.7788]],
    [["奈良", "Nara", "Nara", 34.6851, 135.8048], ["大阪", "Osaka", "Osaka", 34.6937, 135.5023]],
    [["大阪", "Osaka", "Osaka", 34.6937, 135.5023], ["東京羽田機場", "Tokyo Haneda", "Tokio Haneda", 35.5520, 139.7860]]
  ]
};

BC_DETAIL_TOURS.forEach(tour => tour.route.forEach((day, index) => {
  const fallbackName = typeof day.city === "string" ? [day.city, day.city, day.city] : [day.city.zh, day.city.en, day.city.es || day.city.en];
  const source = day.stops?.length ? day.stops : (BC_ROUTE_STOPS[tour.id]?.[index] || [[...fallbackName, ...day.geo]]);
  day.stops = source.map((stop, stopIndex) => Array.isArray(stop)
    ? { id: `d${day.day}-p${stopIndex + 1}`, name: bcI18n(stop[0], stop[1], stop[2]), geo: [stop[3], stop[4]], summary: day.sights, description: day.sights, image: day.image, kind: "place", markerOffset: [0, 0], sourceStatus: "demo_estimate", visitStatus: "planned_demo", mediaStatus: "demo_placeholder", mediaRightsStatus: "prototype_only" }
    : { summary: day.sights, description: day.sights, image: day.image, kind: "place", markerOffset: [0, 0], sourceStatus: "demo_estimate", visitStatus: "planned_demo", mediaStatus: "demo_placeholder", mediaRightsStatus: "prototype_only", ...stop, id: stop.id || `d${day.day}-p${stopIndex + 1}` });
}));

function bcMealStatusText(status, mealType) {
  const label = ({
    breakfast: bcI18n("早餐", "Breakfast"),
    lunch: bcI18n("午餐", "Lunch"),
    dinner: bcI18n("晚餐", "Dinner")
  })[mealType];
  if (status === "included") return bcI18n(`${label.zh}已含・餐廳待確認`, `${label.en} included · venue pending`);
  if (status === "included_unconfirmed") return bcI18n(`${label.zh}預計包含・供應商待確認`, `${label.en} expected included · supplier pending`);
  if (status === "in_flight") return bcI18n("機上餐・依航空公司安排", "In-flight meal · airline arrangement");
  if (status === "pending") return bcI18n(`${label.zh}未列・待確認`, `${label.en} not listed · pending`);
  return bcI18n(`${label.zh}自理或未列`, `${label.en} on your own or not listed`);
}

function bcBuildItineraryContract(tour) {
  const meta = globalThis.BC_ITINERARY_CONTRACT_META?.[tour.id];
  if (!meta) return null;
  const feeContract = BC_FEE_CONTRACTS[tour.id];
  const days = tour.route.map((routeDay, index) => {
    const sourceDay = meta.days[index];
    if (!sourceDay) return null;
    const legacyMovement = BC_DAY_MOVEMENT[tour.id]?.[index];
    const taiwanMeals = tour.id === 88 ? BC_TAIWAN_DAY_MEALS[routeDay.day] : null;
    const taiwanStay = tour.id === 88 ? BC_TAIWAN_DAY_STAYS[routeDay.day] : null;
    const pois = routeDay.stops.map((stop, stopIndex) => {
      const poi = {
        id: `${tour.code}-${stop.id}`,
        uiStopId: stop.id,
        sequence: stopIndex + 1,
        kind: stop.kind,
        name: stop.name,
        geo: { lat: stop.geo?.[0] ?? null, lon: stop.geo?.[1] ?? null, status: stop.geo?.length === 2 ? "prototype_coordinate" : "missing" },
        visitStatus: stop.visitStatus,
        sourceStatus: stop.sourceStatus,
        media: {
          id: `${tour.code}-${stop.id}-MEDIA-01`,
          src: stop.image,
          sourceStatus: stop.mediaStatus,
          rightsStatus: stop.mediaRightsStatus,
          productionAssetId: null
        }
      };
      stop.dataContract = poi;
      return poi;
    });
    const meals = Object.entries(sourceDay.meals).map(([mealType, serviceStatus]) => ({
      id: `${sourceDay.id}-MEAL-${mealType.toUpperCase()}`,
      mealType,
      serviceStatus,
      displayName: taiwanMeals?.[mealType] || bcMealStatusText(serviceStatus, mealType),
      venueId: null,
      reservationStatus: "unconfirmed",
      sourceStatus: meta.sourceStatus
    }));
    const staySource = taiwanStay || {};
    const stay = {
      ...sourceDay.stay,
      id: `${sourceDay.id}-STAY-01`,
      propertyId: null,
      displayName: staySource.name || routeDay.hotel,
      level: staySource.level || (sourceDay.stay.rating.value ? bcI18n(`${sourceDay.stay.rating.value} 星或同級`, `${sourceDay.stay.rating.value}-star or equivalent`) : sourceDay.stay.propertyStatus === "not_applicable" ? bcI18n("不安排飯店", "No hotel stay") : bcI18n("星級待確認", "Rating pending")),
      note: staySource.note || bcI18n("實際飯店、房型與訂位狀態待正式確認", "Hotel, room and booking status remain subject to confirmation"),
      rating: {
        ...sourceDay.stay.rating,
        value: staySource.stars === 0 ? 0 : staySource.stars || sourceDay.stay.rating.value,
        sourceStatus: staySource.ratingNote ? "source_document_claim" : sourceDay.stay.rating.sourceStatus,
        sourceLabel: staySource.ratingNote || (sourceDay.stay.rating.value ? bcI18n("依行程住宿標準・尚未驗證", "Based on itinerary standard · unverified") : null)
      }
    };
    const segment = {
      id: `${sourceDay.id}-SEG-01`,
      fromPoiId: pois[0]?.id || null,
      toPoiId: pois.at(-1)?.id || null,
      mode: legacyMovement ? bcI18n(legacyMovement[0], legacyMovement[1]) : bcI18n("交通待確認", "Transport pending"),
      durationMinutes: sourceDay.movement.durationMinutes,
      distanceKm: sourceDay.movement.distanceKm,
      status: sourceDay.movement.status,
      sourceId: sourceDay.movement.sourceId,
      displayDuration: legacyMovement ? bcI18n(legacyMovement[2], legacyMovement[3]) : bcI18n("時間待確認", "Timing pending"),
      displayDetail: legacyMovement ? bcI18n(legacyMovement[4], legacyMovement[5]) : bcI18n("正式路線與供應商確認後補入。", "Added after route and supplier confirmation.")
    };
    const contractDay = {
      ...sourceDay,
      dayNumber: routeDay.day,
      title: routeDay.city,
      theme: routeDay.sights,
      pois,
      meals,
      stay,
      segments: [segment],
      movement: { ...sourceDay.movement, mode: segment.mode, displayDuration: segment.displayDuration, displayDetail: segment.displayDetail }
    };
    routeDay.dataContract = contractDay;
    return contractDay;
  }).filter(Boolean);
  return {
    ...meta,
    feeContractId: feeContract?.contractId || null,
    days,
    validationStatus: "prototype_validated"
  };
}

function bcValidateItineraryContract(contract) {
  const errors = [];
  if (!contract?.schemaVersion || !contract?.itineraryId || !contract?.itineraryVersion) errors.push("missing itinerary identity");
  if (!contract?.destinationJurisdictions?.length) errors.push("missing destination jurisdiction");
  contract?.days?.forEach((day, index) => {
    if (!day?.id || day.dayNumber !== index + 1) errors.push(`invalid day ${index + 1}`);
    if (!day?.pois?.length || day.pois.some(poi => !poi.id || poi.geo.lat == null || poi.geo.lon == null)) errors.push(`invalid POI data on ${day?.id}`);
    if (day?.meals?.length !== 3 || day.meals.some(meal => !meal.id || !meal.serviceStatus)) errors.push(`invalid meal data on ${day?.id}`);
    if (!day?.stay?.id || !day.stay.propertyStatus || !day.stay.rating?.sourceStatus) errors.push(`invalid stay data on ${day?.id}`);
    if (!day?.segments?.length || day.segments.some(segment => !segment.id || !segment.status)) errors.push(`invalid movement data on ${day?.id}`);
  });
  return errors;
}

function bcCurrentTour() {
  return BC_DETAIL_TOURS.find(t => t.id === state.tourId) || BC_TOURS[0];
}

function bcDemoNotice(subject = L("價格、日期、餘位與操作", "prices, dates, seats and actions", "precios, fechas, plazas y acciones")) {
  return `<div class="prototype-notice"><b>${L("設計示意", "DESIGN DEMO", "DEMO DE DISEÑO")}</b><span>${L(`${subject}為介面示意；不會送出資料、扣款、訂位或寄信。`, `${subject} are demos; no data, charge, booking or email.`, `${subject} son demos; sin datos, cobros, reservas ni correos.`)}</span></div>`;
}

function legacy_bcHeader() {
  const primaryLinks = [
    ["tours", L("團體行程", "Journeys", "Circuitos"), L("路線與班期", "Routes & dates", "Rutas y fechas")],
    ["flights", L("機票服務", "Flights", "Vuelos"), L("航班與行李", "Flights & baggage", "Vuelos y equipaje")],
    ["visa", L("中國簽證", "China visa", "Visado chino"), L("資格與文件", "Eligibility & documents", "Requisitos y documentos")]
  ];
  const serviceLinks = [
    ["custom", L("客製旅行", "Custom travel", "Viaje a medida"), L("特殊路線與條件", "Special routes and constraints", "Rutas y condiciones especiales")],
    ["group", L("私人包團", "Private groups", "Grupos privados"), L("親友、社團與企業", "Friends, clubs and companies", "Familias, clubes y empresas")],
    ["transfer", L("機場接送", "Airport transfer", "Traslado"), L("航班與車輛安排", "Flight-aware ground transport", "Traslado coordinado con el vuelo")],
    ["hotel", L("飯店服務", "Hotels", "Hoteles"), L("住宿與特殊房型", "Stays and special rooms", "Alojamiento y habitaciones especiales")]
  ];
  const siteLinks = [
    ["services", L("全部旅行服務", "All travel services", "Todos los servicios")],
    ["contact", L("聯絡與支援", "Contact and support", "Contacto y soporte")],
    ["about", L("關於 PACK&GO", "About PACK&GO", "Acerca de PACK&GO")]
  ];
  const memberViews = ["orders","order-detail","travelers","payments","favorites"];
  const activeRoot = memberViews.includes(state.view) ? "member" : state.view === "china-visa" ? "visa" : state.view;
  const moreActive = [...serviceLinks, ...siteLinks].some(([view]) => view === state.view);
  const primaryPanel = primaryLinks.map(([view,label,description], index) => `<button class="bc-nav-priority-link ${activeRoot===view?"active":""}" data-view="${view}" ${activeRoot===view?'aria-current="page"':""}><span class="bc-nav-index">0${index + 1}</span><span><strong>${label}</strong><small>${description}</small></span>${icon("arrow")}</button>`).join("");
  const servicePanel = serviceLinks.map(([view,label,description]) => `<button class="bc-nav-service-link ${state.view===view?"active":""}" data-view="${view}" ${state.view===view?'aria-current="page"':""}><span><strong>${label}</strong><small>${description}</small></span>${icon("arrow")}</button>`).join("");
  const sitePanel = siteLinks.map(([view,label]) => `<button class="bc-nav-site-link ${state.view===view?"active":""}" data-view="${view}" ${state.view===view?'aria-current="page"':""}>${label}</button>`).join("");
  return `<header class="bc-nav"><div class="bc-nav-inner">
      <button class="bc-brand" data-view="home" aria-label="PACK&GO ${L("旅行社首頁","travel agency home","agencia de viajes")}"><img class="bc-brand-mark" src="${BC_BRAND.mark}" alt=""/><picture class="bc-brand-wordmark"><source media="(max-width: 760px)" srcset="${BC_BRAND.wordmarkMobile}"/><img src="${BC_BRAND.wordmark}" alt=""/></picture></button>
      <nav class="bc-nav-links" aria-label="${L("主要導覽","Primary navigation","Navegación principal")}">${primaryLinks.map(([view,label],index)=>`<button class="bc-nav-link ${index===0?"is-primary":""} ${activeRoot===view?"active":""}" data-view="${view}" ${activeRoot===view?'aria-current="page"':""}>${label}</button>`).join("")}<button id="bc-more-menu" class="bc-more-button ${state.mobileOpen||moreActive?"active":""}" data-nav-toggle aria-label="${state.mobileOpen?L("收起更多服務","Close more services","Cerrar más servicios"):L("展開更多服務","Open more services","Abrir más servicios")}" aria-expanded="${state.mobileOpen}" aria-controls="bc-site-menu"><span>${L("更多服務","More","Más")}</span><b aria-hidden="true">${state.mobileOpen?"−":"+"}</b></button></nav>
      <div class="bc-nav-tools">
        <select id="language-select" class="bc-select" aria-label="${L("語言","Language","Idioma")}"><option value="zh" ${state.language==="zh"?"selected":""}>繁中</option><option value="en" ${state.language==="en"?"selected":""}>EN</option><option value="es" ${state.language==="es"?"selected":""}>ES</option></select>
        <select id="currency-select" class="bc-select" aria-label="${L("幣別","Currency","Moneda")}"><option ${state.currency==="USD"?"selected":""}>USD</option><option ${state.currency==="TWD"?"selected":""}>TWD</option><option ${state.currency==="CNY"?"selected":""}>CNY</option><option ${state.currency==="CAD"?"selected":""}>CAD</option></select>
        <button class="bc-member-button" data-view="member" ${activeRoot==="member"?'aria-current="page"':""}>${L("會員中心","Member center","Área personal")}</button>
        <button id="mobile-menu" class="bc-menu-toggle" data-nav-toggle aria-label="${state.mobileOpen?L("關閉選單","Close menu","Cerrar menú"):L("開啟選單","Open menu","Abrir menú")}" aria-expanded="${state.mobileOpen}" aria-controls="bc-site-menu">${state.mobileOpen?"×":"☰"}</button>
      </div>
    </div>${state.mobileOpen?`<div class="bc-nav-scrim" data-nav-close aria-hidden="true"></div><nav id="bc-site-menu" class="bc-nav-panel" aria-label="${L("完整導覽","Full navigation","Navegación completa")}"><div class="bc-nav-panel-top"><div><p class="eyebrow">${L("導覽","MENU","MENÚ")}</p><h2 class="bc-nav-title-desktop">${L("其他需要，都放這裡。","Everything else, kept together.","Todo lo demás, en un solo lugar.")}</h2><h2 class="bc-nav-title-mobile">${L("先做最重要的選擇。","Start with what matters.","Empiece por lo esencial.")}</h2></div><button class="bc-nav-close" data-nav-close aria-label="${L("關閉選單","Close menu","Cerrar menú")}">×</button></div><section class="bc-nav-priority" aria-labelledby="bc-priority-title"><p id="bc-priority-title" class="bc-nav-section-label">${L("先從這裡開始","START HERE","EMPIECE AQUÍ")}</p><div class="bc-nav-priority-links">${primaryPanel}</div></section><aside class="bc-nav-aside"><p class="bc-nav-section-label">${L("其他旅行服務","OTHER TRAVEL SERVICES","OTROS SERVICIOS")}</p><div class="bc-nav-service-links">${servicePanel}</div><div class="bc-nav-site-links">${sitePanel}</div><button class="bc-nav-panel-member" data-view="member" ${activeRoot==="member"?'aria-current="page"':""}>${L("會員中心","Member center","Área personal")}<span>${icon("arrow")}</span></button><div class="bc-nav-panel-tools"><label><span>${L("語言","Language","Idioma")}</span><select id="mobile-language-select" class="bc-select" aria-label="${L("語言","Language","Idioma")}"><option value="zh" ${state.language==="zh"?"selected":""}>繁體中文</option><option value="en" ${state.language==="en"?"selected":""}>English</option><option value="es" ${state.language==="es"?"selected":""}>Español</option></select></label><label><span>${L("幣別","Currency","Moneda")}</span><select id="mobile-currency-select" class="bc-select" aria-label="${L("幣別","Currency","Moneda")}"><option ${state.currency==="USD"?"selected":""}>USD</option><option ${state.currency==="TWD"?"selected":""}>TWD</option><option ${state.currency==="CNY"?"selected":""}>CNY</option><option ${state.currency==="CAD"?"selected":""}>CAD</option></select></label></div></aside></nav>`:""}</header>`;
}

function bcFooter() {
  const memberEntry = view => state.demoAuthenticated ? view : "login";
  const col = (title,items) => `<div class="bc-footer-col"><h3>${title}</h3>${items.map(([view,label])=>`<button data-view="${view}">${label}</button>`).join("")}</div>`;
  const social = (network, mark) => `<button class="bc-footer-social-link" data-social="${network}" aria-label="${network}">${mark}<span>${network}</span></button>`;
  const instagramMark = `<svg class="bc-social-mark bc-social-mark-instagram" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="6" y="6" width="36" height="36" rx="11"></rect><circle cx="24" cy="24" r="8.5"></circle><circle class="bc-social-mark-dot" cx="35" cy="13" r="2.2"></circle></svg>`;
  const facebookMark = `<svg class="bc-social-mark bc-social-mark-facebook" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="19"></circle><path d="M27.2 42V27.7h5.1l.8-6.1h-5.9v-3.9c0-1.8.5-3 3.1-3h3.2V9.2c-.6-.1-2.5-.2-4.7-.2-4.6 0-7.8 2.8-7.8 8v4.5h-5.2v6.1H21V42"></path></svg>`;
  return `<footer class="bc-site-footer"><div class="bc-footer-inner"><div class="bc-footer-top">
    <div class="bc-footer-brand"><img class="bc-footer-wordmark" src="${BC_BRAND.wordmark}" alt="PACK&GO ${L("旅行社","Travel Agency","Agencia de viajes")}"/><p>${L("用旅圖看見嚮往　用清楚的班期與價格安心出發　需要判斷的地方始終有人接手", "See where you want to go through images then depart with clear dates prices and personal support", "Vea el destino en imágenes y viaje con fechas precios y apoyo claros")}</p><div class="bc-footer-social"><small>${L("旅行靈感與出發提醒","TRAVEL NOTES & DEPARTURE UPDATES","IDEAS Y AVISOS DE VIAJE")}</small><div>${social("Instagram", instagramMark)}${social("Facebook", facebookMark)}</div><em>${L("設計示意・官方網址待接線","Design demo · official URLs pending","Demo · enlaces oficiales pendientes")}</em></div></div>
    ${col(L("尋找旅程","FIND A JOURNEY","ENCONTRAR VIAJE"),[["tours",L("團體行程","Group journeys","Circuitos")],["favorites",L("收藏行程","Saved journeys","Favoritos")],["custom",L("客製旅行","Custom travel","Viaje a medida")],["about",L("認識 PACK&GO","Meet PACK&GO","Conocer PACK&GO")]])}
    ${col(L("旅行服務","TRAVEL SERVICES","SERVICIOS"),[["flights",L("機票服務","Flight service","Vuelos")],["china-visa",L("中國簽證","China visa","Visado chino")],["custom",L("客製旅行與包團","Custom travel and groups","Viajes a medida y grupos")],["transfer",L("機場接送","Airport transfer","Traslados")],["hotel",L("飯店服務","Hotels","Hoteles")]])}
    ${col(L("會員與支援","MEMBER & SUPPORT","MIEMBRO Y SOPORTE"),[[memberEntry("member"),L("我的旅程","My journey","Mi viaje")],[memberEntry("orders"),L("訂單進度","Order progress","Estado del pedido")],[memberEntry("travelers"),L("旅客與文件","Travelers and documents","Viajeros y documentos")],[memberEntry("payments"),L("付款與收據","Payments and receipts","Pagos y recibos")],["contact",L("聯絡與支援","Contact and support","Contacto y soporte")]])}
  </div><div class="bc-footer-bottom"><nav class="bc-footer-utility-links" aria-label="${L("頁尾導覽","Footer navigation","Navegación del pie")}"><button data-view="help">${L("幫助中心","Help center","Centro de ayuda")}</button><button data-view="membership">${L("會員方案","Membership plans","Planes de membresía")}</button></nav><address>PACK&GO · 39055 Cedar Blvd #126, Newark, CA 94560<br>+1 (510) 634-2307 · support@packgoplay.com</address><div><span data-keep-punctuation>California Seller of Travel CST #2166984 · Newark Business License #115594</span><br><span>${L("TCRF 適用條件以付款前揭露與加州法律為準。設計原型，不建立真實交易。", "TCRF eligibility follows pre-payment disclosure and California law. Design prototype; no real transaction is created.", "La elegibilidad TCRF depende de la divulgación previa y la ley de California. Prototipo sin transacciones reales.")}</span></div></div></div></footer>`;
}

function bcPageIntro(eyebrow, title, copy, image) {
  return `<section class="bc-page-intro bc-shell"><div class="bc-page-intro-grid"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${copy}</p></div><div class="bc-intro-photo"><img src="${image}" alt="" fetchpriority="high"/></div></div></section>`;
}

function bcHomeFeature(t, primary = false) {
  return `<article class="${primary ? "bc-feature-primary" : "bc-feature-mini"}">
    <img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/>
    <div class="bc-feature-caption"><p class="eyebrow">${t.code} · ${bcTxt(t.destination)}</p><h3>${bcTxt(t.title)}</h3>
      <div class="bc-feature-facts"><span>${t.days} ${L("天","days","días")}</span><span>${t.nextDate}</span><span>${t.air?L("含機票","Air included","Vuelo incluido"):L("機票另計","Air separate","Vuelo no incluido")}</span></div>
      <div class="bc-feature-price"><strong>${money(t.price)} ${L("起","from","desde")}</strong><button class="btn light small" data-tour="${t.id}">${L("查看旅程","View journey","Ver viaje")}</button></div>
    </div></article>`;
}

function bcServiceRows() {
  const items = [
    ["01","flights",L("機票服務","Flight service","Vuelos"),L("看清行李、轉機、退改與付款對象，再決定怎麼買。","Compare baggage, connections, changes and payee before buying.","Compare equipaje, escalas, cambios y quién cobra.")],
    ["02","china-visa",L("中國簽證","China visa","Visado chino"),L("灣區中國簽證資格預檢、文件、費用與進度；不先上傳護照。","Bay Area China-visa pre-check, documents, fees and progress.","Revisión de visado chino, documentos, costo y progreso.")],
    ["03","custom",L("客製旅行","Custom travel","Viaje a medida"),L("從個人旅行到多人包團都先回答人數，再自動進入適合的問題。","Solo trips and private groups start with party size, then follow the right questions.","Viajes individuales y grupos empiezan por el tamaño y siguen la ruta adecuada.")],
    ["04","transfer",L("機場接送","Airport transfer","Traslado de aeropuerto"),L("航班、地址、人數與行李先確認，價格與取消規則隨後。","Confirm flight, address, guests and luggage before price and terms.","Confirme vuelo, dirección, viajeros y equipaje antes del precio.")],
    ["05","hotel",L("飯店服務","Hotel service","Hoteles"),L("標準訂房自助比較，連通房、團體房與特殊需求再升級。","Self-serve standard stays; escalate connected rooms and special needs.","Reserve estancias estándar; escale habitaciones especiales.")]
  ];
  return `<div class="bc-service-index">${items.map(x=>`<button class="bc-service-row" data-view="${x[1]}"><span>${x[0]}</span><h3>${x[2]}</h3><p>${x[3]}</p><span class="bc-row-cta">${L("打開服務 →","Open service →","Abrir →")}</span></button>`).join("")}</div>`;
}

function bcSocialSection() {
  const stories = [
    [BC_IMG.kyoto,L("目的地旅圖","DESTINATION NOTES","NOTAS DEL DESTINO")],
    [BC_IMG.cotswolds,L("行程上架與成團提醒","NEW JOURNEYS & DEPARTURES","NUEVOS VIAJES Y SALIDAS")],
    [BC_IMG.madrid,L("出發前準備","BEFORE YOU GO","ANTES DE SALIR")]
  ];
  return `<section class="bc-shell section-tight" aria-labelledby="bc-social-title"><div class="bc-social-editorial"><div class="bc-social-gallery">${stories.map(([image,label])=>`<figure><img src="${image}" alt="" loading="lazy"/><figcaption>${label}</figcaption></figure>`).join("")}</div><div class="bc-social-copy"><p class="eyebrow">PACK&GO SOCIAL · DESIGN DEMO</p><h2 id="bc-social-title">${L("關注 PACK&GO，也把喜歡的旅程傳給旅伴。","Follow PACK&GO—and send a favorite journey to your travel partner.","Siga a PACK&GO y comparta su viaje favorito con sus acompañantes.")}</h2><p>${L("先把公開行程傳給正在一起決定的人，再從社群收到旅圖、成團提醒與出發準備；真正的價格、訂位與付款仍回網站確認。","Send the public journey to the people deciding with you, then follow for destination notes, departure updates and preparation. Prices, booking and payment stay here.","Comparta el viaje público con quienes deciden con usted y siga las novedades. Precios, reservas y pagos se confirman aquí.")}</p><div class="bc-social-actions"><button class="bc-social-primary" data-share="tour">${L("傳給旅伴一起選 ↗","Send to a travel partner ↗","Enviar a un acompañante ↗")}</button><button class="bc-social-secondary" data-social="Instagram">${L("追蹤 Instagram ↗","Follow Instagram ↗","Seguir en Instagram ↗")}</button></div><small>${L("分享與官方社群網址均為設計示意・尚未接線","Sharing and official social URLs are design demos · not connected","Compartir y enlaces sociales son demos · no conectados")}</small></div></div></section>`;
}

function bcAdvocacyLabSwitcher() {
  if (!state.shareLab) return "";
  const names = {
    A: L("出發分享卡","Departure card","Tarjeta de salida"),
    B: L("旅伴共決","Travel-partner decision","Decisión compartida"),
    C: L("旅後故事","Post-trip story","Historia posviaje")
  };
  return `<div class="bc-advocacy-switcher" aria-label="${L("分享引導設計切換器","Sharing-design switcher","Selector de diseño para compartir")}"><button data-advocacy-step="-1" aria-label="${L("上一個分享設計","Previous sharing design","Diseño anterior")}">←</button><div><b>${state.advocacy} · ${names[state.advocacy]}</b><small>SHARE ADVOCACY LAB · DESIGN DEMO</small></div><button data-advocacy-step="1" aria-label="${L("下一個分享設計","Next sharing design","Diseño siguiente")}">→</button></div>`;
}

function bcAdvocacyBlock(t) {
  const variant = state.advocacy || "A";
  if (variant === "B") return `<section id="bc-advocacy-variant" tabindex="-1" class="bc-advocacy bc-advocacy-companion"><header><p class="eyebrow">B · TRAVEL-PARTNER DECISION · DESIGN DEMO</p><h2>${L("不是替品牌轉發，是一起把旅行選清楚。","Not promotion work—just a clearer decision together.","No es promocionar la marca: es decidir mejor juntos.")}</h2><p>${L("把公開商品頁傳到旅伴群組；同行者看到相同的日期、天數、機票與價格，再回網站完成下一步。","Send the public product page to the travel group so everyone sees the same date, duration, air and price before returning here.","Envíe la página pública al grupo para que todos vean fecha, duración, vuelo y precio.")}</p></header><div class="bc-companion-link-preview"><img src="${t.image}" alt=""/><div><small>${t.code} · ${bcTxt(t.destination)}</small><h3>${bcTxt(t.title)}</h3><p>${t.days} ${L("天","days","días")} · ${t.nextDate} · ${money(t.price)} ${L("起","from","desde")}</p></div><button data-share="tour">${L("傳給旅伴","Send","Enviar")} →</button></div><ol><li><b>01</b><span>${L("只分享公開商品","Public journey only","Solo viaje público")}</span></li><li><b>02</b><span>${L("一起比較與決定","Compare together","Comparar juntos")}</span></li><li><b>03</b><span>${L("回網站看總價","Return for total","Volver para el total")}</span></li></ol>${bcAdvocacyLabSwitcher()}</section>`;
  if (variant === "C") return `<section id="bc-advocacy-variant" tabindex="-1" class="bc-advocacy bc-advocacy-story"><div class="bc-story-photos"><img src="${t.gallery[1]}" alt=""/><img src="${t.gallery[2]}" alt=""/></div><div><p class="eyebrow">C · POST-TRIP STORY · DESIGN DEMO</p><h2>${L("回來後，分享一張真正喜歡的照片。","After the trip, share one photo you genuinely love.","Al volver, comparta una foto que realmente le guste.")}</h2><p>${L("旅程完成後再邀請旅客選照片、寫一句旅行提醒；是否允許 PACK&GO 轉載必須獨立同意，也能撤回。","After travel, guests may choose a photo and one useful note. PACK&GO reuse requires separate, revocable consent.","Después del viaje se puede elegir una foto y un consejo. La reutilización requiere consentimiento separado y revocable.")}</p><div class="bc-story-steps"><span>01 ${L("選 1–3 張照片","Choose 1–3 photos","Elegir 1–3 fotos")}</span><span>02 ${L("寫一句真實提醒","Write one honest note","Escribir un consejo")}</span><span>03 ${L("另行決定是否授權轉載","Choose reuse separately","Elegir reutilización")}</span></div><button class="btn" data-share-action="ugc">${L("預覽旅後分享流程・設計示意","Preview post-trip sharing · demo","Vista previa posviaje · demo")}</button><small>${L("不會上傳照片、發布內容或取得授權。","No photo upload, publishing or consent occurs.","No se suben fotos, publica contenido ni obtiene permiso.")}</small></div>${bcAdvocacyLabSwitcher()}</section>`;
  return `<section id="bc-advocacy-variant" tabindex="-1" class="bc-advocacy bc-advocacy-departure"><div class="bc-departure-share-card"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div class="bc-departure-share-brand"><img src="${BC_BRAND.wordmark}" alt="PACK&GO"/></div><div class="bc-departure-share-copy"><p>NEXT STOP · ${t.nextDate.slice(0,7)}</p><h3>${bcTxt(t.destination)}</h3><span>${bcTxt(t.title)}</span></div></div><div class="bc-advocacy-copy"><p class="eyebrow">A · AFTER CONFIRMATION · DESIGN DEMO</p><h2>${L("讓出發的好消息，自己走出去。","Let the good news of departure travel on its own.","Deje que la noticia del viaje llegue más lejos.")}</h2><p>${L("供應商確認後才提供一張可公開分享的旅圖。朋友看見目的地與 PACK&GO，再從公開行程頁了解服務；客人不是在替品牌工作，只是在分享自己的期待。","Only after supplier confirmation, offer a public travel card. Friends see the destination and PACK&GO, then learn through the public journey page. Guests share anticipation—not brand work.","Solo tras la confirmación, ofrezca una tarjeta pública. Amigos ven el destino y PACK&GO y consultan la página pública.")}</p><div class="bc-advocacy-privacy"><b>${L("分享卡只包含","THE CARD INCLUDES","LA TARJETA INCLUYE")}</b><span>${L("目的地・出發月份・團名・品牌・公開行程連結","Destination · month · journey · brand · public link","Destino · mes · viaje · marca · enlace público")}</span><small>${L("不含姓名、訂單編號、價格、旅客人數或付款狀態。","No name, order number, price, guest count or payment state.","Sin nombre, pedido, precio, viajeros ni estado de pago.")}</small></div><div class="bc-advocacy-actions"><button class="btn" data-share-action="download">${L("下載分享圖・設計示意","Download share card · demo","Descargar tarjeta · demo")}</button><button class="btn ghost" data-share-action="copy">${L("複製公開行程連結・示意","Copy public journey link · demo","Copiar enlace público · demo")}</button></div></div>${bcAdvocacyLabSwitcher()}</section>`;
}

function bcShareDrawer() {
  if (!state.shareOpen) return "";
  const t = bcCurrentTour();
  return `<div class="bc-share-backdrop" data-share-close></div><aside class="bc-share-drawer" role="dialog" aria-modal="true" aria-labelledby="bc-share-title"><header><div><p class="eyebrow">PUBLIC JOURNEY · DESIGN DEMO</p><h2 id="bc-share-title" tabindex="-1">${L("先傳給旅伴，一起決定。","Send it to a travel partner and decide together.","Envíelo a un acompañante y decidan juntos.")}</h2></div><button data-share-close aria-label="${L("關閉分享預覽","Close sharing preview","Cerrar vista previa")}">×</button></header><div class="bc-share-preview"><img src="${t.image}" alt=""/><div><small>${t.code} · ${bcTxt(t.destination)}</small><h3>${bcTxt(t.title)}</h3><p>${t.days} ${L("天","days","días")} · ${t.nextDate} · ${money(t.price)} ${L("起","from","desde")}</p><span>PACK&GO · ${L("公開商品頁示意","PUBLIC JOURNEY DEMO","VIAJE PÚBLICO DEMO")}</span></div></div><p>${L("正式版只會分享公開商品內容，不帶會員、旅客、訂單或付款資料。現在的網址仍是 localhost，因此不建立假分享連結。","Production shares only public product content—never member, traveler, order or payment data. This is still localhost, so no fake link is created.","La versión final comparte solo contenido público, nunca datos personales o de pago. Al ser localhost, no se crea un enlace falso.")}</p><div class="bc-share-actions"><button class="btn" data-share-action="copy">${L("複製公開連結・設計示意","Copy public link · demo","Copiar enlace · demo")}</button><button class="btn ghost" data-share-action="message">${L("傳到旅伴群組・設計示意","Send to travel group · demo","Enviar al grupo · demo")}</button></div><small>${L("沒有複製、傳送、發文或建立追蹤資料。","Nothing is copied, sent, posted or tracked.","No se copia, envía, publica ni rastrea nada.")}</small></aside>`;
}

const BC_WORLD_ORIGIN = { city: bcI18n("加州・Newark", "California · Newark", "California · Newark"), lon: -122.04, lat: 37.53, x: 201.1, y: 139.6 };

function bcWorldSelectedTour() {
  return BC_TOURS.find(t => t.id === state.mapTourId) || BC_TOURS[0];
}

function bcWorldRoutePath(t) {
  if (t.id === 21) return `M ${BC_WORLD_ORIGIN.x} ${BC_WORLD_ORIGIN.y} Q 88 42 -16 141 M 976 141 Q 890 54 ${t.world.x} ${t.world.y}`;
  const controlY = t.id === 3 ? 24 : 43;
  return `M ${BC_WORLD_ORIGIN.x} ${BC_WORLD_ORIGIN.y} Q 344 ${controlY} ${t.world.x} ${t.world.y}`;
}

function bcWorldMapCanvas(selected, className = "") {
  const pin = t => `<button class="bc-world-pin bc-world-pin-${t.id} ${selected.id===t.id?"active":""}" style="left:${(t.world.x/9.6).toFixed(2)}%;top:${(t.world.y/5).toFixed(2)}%" data-map-tour="${t.id}" aria-pressed="${selected.id===t.id}" aria-label="${L(`選擇${bcTxt(t.world.city)}行程`,`Choose ${bcTxt(t.world.city)} journey`,`Elegir viaje a ${bcTxt(t.world.city)}`)}"><i aria-hidden="true"></i><span>${bcTxt(t.world.city)}</span></button>`;
  return `<div class="bc-world-map-canvas ${className}"><div class="bc-world-map-kicker"><span>37.53°N · 122.04°W</span><b>${L("從灣區出發","DEPARTING THE BAY AREA","SALIDAS DESDE LA BAHÍA")}</b></div><div class="bc-world-map-stage"><svg viewBox="0 0 960 500" role="img" aria-label="${L("從加州 Newark 前往馬德里、倫敦與東京的示意航線","Sample routes from Newark, California to Madrid, London and Tokyo","Rutas de ejemplo desde Newark, California a Madrid, Londres y Tokio")}"><image href="./assets/world-110m.svg" width="960" height="500"/><g class="bc-world-routes">${BC_TOURS.map(t=>`<path class="${selected.id===t.id?"active":""}" d="${bcWorldRoutePath(t)}"/>`).join("")}</g></svg><span class="bc-world-origin" style="left:${(BC_WORLD_ORIGIN.x/9.6).toFixed(2)}%;top:${(BC_WORLD_ORIGIN.y/5).toFixed(2)}%"><i></i><b>NEWARK</b></span>${BC_TOURS.map(pin).join("")}</div><div class="bc-world-map-caption"><span>${L("只標示目前可購買的目的地","ONLY BOOKABLE DESTINATIONS ARE SHOWN","SOLO DESTINOS DISPONIBLES")}</span><span>${L("地圖與座標為設計示意","MAP & COORDINATES · DESIGN DEMO","MAPA Y COORDENADAS · DEMO")}</span></div></div>`;
}

function bcWorldTourFacts(t) {
  return `<div class="bc-world-tour-facts"><span><small>${L("最近班期","NEXT DATE","PRÓXIMA")}</small><b>${t.nextDate}</b></span><span><small>${L("天數","DURATION","DURACIÓN")}</small><b>${t.days} ${L("天","days","días")}</b></span><span><small>${L("機票","AIR","VUELO")}</small><b>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</b></span><span><small>${L("狀態","STATUS","ESTADO")}</small><b>${bcTxt(t.status)}</b></span></div>`;
}

function bcWorldProduct(t, compact = false) {
  return `<article class="bc-world-product ${compact?"compact":""}"><button class="bc-world-product-image" data-tour="${t.id}" aria-label="${L(`打開${bcTxt(t.title)}`,`Open ${bcTxt(t.title)}`,`Abrir ${bcTxt(t.title)}`)}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/><span>${t.code} · ${bcTxt(t.destination)}</span></button><div class="bc-world-product-copy"><p class="eyebrow">${L("目前選擇","SELECTED JOURNEY","VIAJE SELECCIONADO")}</p><h3>${bcTxt(t.title)}</h3>${bcWorldTourFacts(t)}<div class="bc-world-product-bottom"><div><small>${L("每人起・設計示意","PER PERSON · DEMO","POR PERSONA · DEMO")}</small><strong>${money(t.price)}</strong></div><button class="btn small" data-tour="${t.id}">${L("查看旅程","View journey","Ver viaje")} →</button></div></div></article>`;
}

function bcWorldDestinationTabs(selected) {
  return `<nav class="bc-world-destination-tabs" aria-label="${L("選擇目的地","Choose a destination","Elegir destino")}">${BC_TOURS.map(t=>`<button class="${selected.id===t.id?"active":""}" data-map-tour="${t.id}" aria-pressed="${selected.id===t.id}"><span>${t.code}</span><b>${bcTxt(t.world.city)}</b><small>${t.nextDate.slice(5)} · ${money(t.price)}</small></button>`).join("")}</nav>`;
}

function bcWorldVariantA(selected) {
  return `<div class="bc-world-board bc-world-board-a">${bcWorldMapCanvas(selected)}${bcWorldProduct(selected)}</div>${bcWorldDestinationTabs(selected)}`;
}

function bcWorldVariantB(selected) {
  const ordered = [selected, ...BC_TOURS.filter(t=>t.id!==selected.id)];
  return `<div class="bc-photo-atlas"><div class="bc-photo-atlas-world" aria-hidden="true"><img src="./assets/world-110m.svg" alt=""/></div><div class="bc-photo-atlas-grid">${ordered.map((t,index)=>`<article class="bc-photo-atlas-card ${index===0?"lead":""}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/><div><p>${t.code} · ${bcTxt(t.destination)}</p><h3>${bcTxt(t.title)}</h3><span>${t.nextDate} · ${t.days} ${L("天","days","días")} · ${money(t.price)} ${L("起","from","desde")}</span><button data-tour="${t.id}">${L("打開旅程","Open journey","Abrir viaje")} →</button></div></article>`).join("")}</div></div>${bcWorldDestinationTabs(selected)}`;
}

function bcWorldVariantC(selected) {
  return `<div class="bc-route-lens"><div class="bc-route-lens-map">${bcWorldMapCanvas(selected,"lens")}<div class="bc-route-lens-title"><p>${L("一條路線，一個決定","ONE ROUTE · ONE DECISION","UNA RUTA · UNA DECISIÓN")}</p><h3>${bcTxt(BC_WORLD_ORIGIN.city)}<br>→ ${bcTxt(selected.world.city)}</h3></div></div><div class="bc-route-lens-story"><img src="${selected.image}" alt="${bcTxt(selected.title)}" loading="lazy"/><div><p class="eyebrow">${selected.code} · ${bcTxt(selected.destination)}</p><h3>${bcTxt(selected.title)}</h3>${bcWorldTourFacts(selected)}<div class="bc-world-product-bottom"><div><small>${L("每人起・設計示意","PER PERSON · DEMO","POR PERSONA · DEMO")}</small><strong>${money(selected.price)}</strong></div><button class="btn small" data-tour="${selected.id}">${L("查看旅程","View journey","Ver viaje")} →</button></div></div></div></div>${bcWorldDestinationTabs(selected)}`;
}

const BC_REGION_META = {
  2: {
    name: bcI18n("西班牙中北部", "Northern and central Spain", "Norte y centro de España"),
    copy: bcI18n("從城牆古城走到巴斯克海岸，再回到馬德里；每天的主要停靠地會直接落在地圖上。", "From walled cities to the Basque coast and back to Madrid, with each day's main stop placed on the map.", "De ciudades amuralladas a la costa vasca y regreso a Madrid; cada parada principal aparece en el mapa."),
    focus: [41.7, -3.5], scale: 22
  },
  3: {
    name: bcI18n("倫敦與英格蘭南部", "London and southern England", "Londres y el sur de Inglaterra"),
    copy: bcI18n("城市、古堡、學院城與鄉間村落的距離一眼看懂，避免只看到一串地名。", "See the distance between city, castle, university town and countryside instead of reading a list of names.", "Vea la relación entre ciudad, castillo, universidad y campo, no solo una lista de nombres."),
    focus: [51.62, -1.0], scale: 27
  },
  21: {
    name: bcI18n("關東・富士・關西", "Kanto, Fuji and Kansai", "Kanto, Fuji y Kansai"),
    copy: bcI18n("從東京到富士山，再用新幹線進入京都、奈良與大阪；地圖讓跨區移動與每天活動一起成立。", "Move from Tokyo to Fuji, then by bullet train to Kyoto, Nara and Osaka, with geography and daily plans shown together.", "De Tokio al Fuji y en tren bala a Kioto, Nara y Osaka, uniendo geografía y plan diario."),
    focus: [35.35, 137.55], scale: 21
  },
  88: {
    name: bcI18n("台灣經典環島", "Classic Taiwan circuit", "Circuito clásico de Taiwán"),
    copy: bcI18n("從西部山城、日月潭與台北，再沿東部海岸與花東縱谷返回北部。", "From western mountain towns and Taipei to the east coast and Huatung Valley before returning north.", "Del oeste montañoso y Taipéi a la costa este y el valle de Huatung antes de volver al norte."),
    focus: [23.72, 120.96], scale: 30
  }
};

let bcRegionalMapInstance = null;
let bcRegionalMapResizeObserver = null;
let bcProfessionalMapInstance = null;

function bcRegionMeta(t) {
  return BC_REGION_META[t.id] || BC_REGION_META[2];
}

function bcRegionalSelectedDay(t) {
  const day = Math.min(Math.max(Number(state.mapDay) || 1, 1), t.route.length);
  state.mapDay = day;
  return t.route[day - 1];
}

function bcWorldVariantD(selected) {
  const worldMode = state.mapScope === "world";
  const meta = bcRegionMeta(selected);
  const d = bcRegionalSelectedDay(selected);
  const breadcrumb = worldMode
    ? `<span aria-current="page">WORLD</span><i>/</i><b>${L("選一個可出發地區","CHOOSE A BOOKABLE REGION","ELIJA UNA REGIÓN")}</b>`
    : `<button data-map-scope="world">WORLD</button><i>/</i><b>${bcTxt(meta.name)}</b>`;
  const scopeAction = worldMode
    ? `<button class="bc-region-scope-action" data-map-scope="region">${L("放大這條路線","Zoom into this route","Ampliar esta ruta")} ↗</button>`
    : `<button class="bc-region-scope-action" data-map-scope="world">${L("返回世界","Back to world","Volver al mundo")} −</button>`;
  const story = worldMode
    ? `<article class="bc-region-story bc-region-overview" aria-live="polite"><div class="bc-region-story-image"><img src="${selected.image}" alt="${bcTxt(selected.title)}" loading="lazy"/><span>${selected.code} · ${bcTxt(selected.world.city)}</span></div><div class="bc-region-story-copy"><p class="eyebrow">${L("目前選擇的地區","SELECTED REGION","REGIÓN SELECCIONADA")}</p><h3 id="bc-region-story-title" tabindex="-1">${bcTxt(selected.title)}</h3><p>${bcTxt(meta.copy)}</p>${bcWorldTourFacts(selected)}<div class="bc-region-story-actions"><button class="btn" data-map-scope="region">${L("進入地區看每天做什麼","Open the daily map","Ver el mapa diario")} →</button><button class="btn ghost" data-tour="${selected.id}">${L("完整行程","Full journey","Viaje completo")}</button></div></div></article>`
    : `<article class="bc-region-story" aria-live="polite"><div class="bc-region-story-image"><img src="${d.image}" alt="${bcTxt(d.city)}" loading="lazy"/><span>DAY ${String(d.day).padStart(2,"0")} · ${L("設計示意","DESIGN DEMO","DEMO")}</span></div><div class="bc-region-story-copy"><p class="eyebrow">${bcTxt(meta.name)} · DAY ${String(d.day).padStart(2,"0")}</p><h3 id="bc-region-story-title" tabindex="-1">${bcTxt(d.city)}</h3><p class="bc-region-do"><b>${L("這天在做什麼","WHAT HAPPENS HERE","QUÉ SE HACE AQUÍ")}</b>${bcTxt(d.sights)}</p><dl><div><dt>${L("餐食","MEALS","COMIDAS")}</dt><dd>${bcTxt(d.meals)}</dd></div><div><dt>${L("住宿","STAY","HOTEL")}</dt><dd>${bcTxt(d.hotel)}</dd></div></dl><div class="bc-region-story-bottom"><div><small>${selected.code} · ${selected.nextDate}</small><strong>${money(selected.price)} ${L("起","from","desde")}</strong></div><button class="btn small" data-tour="${selected.id}">${L("查看完整旅程","Full journey","Ver viaje")} →</button></div></div></article>`;
  const dayRail = worldMode ? "" : `<nav class="bc-region-day-rail" aria-label="${L("選擇行程日期","Choose an itinerary day","Elegir día del viaje")}">${selected.route.map(day=>`<button class="${day.day===d.day?"active":""}" data-map-day="${day.day}" aria-pressed="${day.day===d.day}"><small>DAY ${String(day.day).padStart(2,"0")}</small><b>${bcTxt(day.city)}</b><span>${bcTxt(day.sights)}</span></button>`).join("")}</nav>`;
  return `<div class="bc-region-explorer ${worldMode?"is-world":"is-region"}"><section class="bc-region-map-pane"><header><div class="bc-region-breadcrumb">${breadcrumb}</div>${scopeAction}</header><div id="bc-region-map" class="bc-region-map-canvas" data-map-scope="${worldMode?"world":"region"}" aria-label="${worldMode?L("可點選西班牙、英國或日本的世界目的地地圖","World map with clickable Spain, United Kingdom and Japan","Mapa mundial con España, Reino Unido y Japón"):L(`${bcTxt(meta.name)}每日停靠地互動地圖`,`${bcTxt(meta.name)} interactive daily-stop map`,`Mapa interactivo de ${bcTxt(meta.name)}`)}"></div><footer><span>${worldMode?L("點國家或城市進入 close-up","CHOOSE A COUNTRY OR CITY TO ZOOM","ELIJA UN PAÍS O CIUDAD"):L("點天數，照片與『這裡做什麼』同步切換","CHOOSE A DAY · MAP AND STORY STAY IN SYNC","ELIJA UN DÍA · MAPA E HISTORIA SINCRONIZADOS")}</span><small>${L("地理點、路線與日期皆為設計示意","GEOGRAPHY, ROUTES & DATES · DESIGN DEMO","GEOGRAFÍA, RUTAS Y FECHAS · DEMO")}</small></footer></section>${story}</div>${dayRail}${bcWorldDestinationTabs(selected)}`;
}

function bcDestroyRegionalExplorer() {
  bcRegionalMapResizeObserver?.disconnect();
  bcRegionalMapResizeObserver = null;
  if (bcRegionalMapInstance) {
    try { bcRegionalMapInstance.destroy(); } catch (_) {}
    bcRegionalMapInstance = null;
  }
  if (bcProfessionalMapInstance) {
    try { bcProfessionalMapInstance.remove(); } catch (_) {}
    bcProfessionalMapInstance = null;
  }
}

function bcSelectRegionalMarker(index, regionMode) {
  if (regionMode) {
    state.mapDay = Number(index) + 1;
    state.uiFocusSelector = `[data-map-day="${state.mapDay}"]`;
  } else {
    const t = BC_TOURS[Number(index)];
    if (!t) return;
    state.mapTourId = t.id;
    state.mapDay = 1;
    state.mapScope = "region";
    state.uiFocusSelector = "#bc-region-story-title";
  }
  renderPage();
}

function bcMountRegionalExplorer() {
  const target = document.getElementById("bc-region-map");
  if (!target) return;
  bcDestroyRegionalExplorer();
  if (typeof jsVectorMap !== "function") {
    target.innerHTML = `<p class="bc-region-map-fallback">${L("互動地圖載入失敗；請使用下方目的地與日期按鈕。","Interactive map unavailable; use the destination and day buttons below.","Mapa no disponible; use los botones inferiores.")}</p>`;
    return;
  }
  const t = bcWorldSelectedTour();
  const d = bcRegionalSelectedDay(t);
  const meta = bcRegionMeta(t);
  const regionMode = state.mapScope !== "world";
  const markers = regionMode
    ? t.route.map(day => ({ name: `D${String(day.day).padStart(2,"0")} · ${bcTxt(day.city)}`, coords: day.geo }))
    : BC_TOURS.map(tour => ({ name: `${tour.code} · ${bcTxt(tour.world.city)}`, coords: [tour.world.lat, tour.world.lon] }));
  const lines = regionMode ? markers.slice(1).map((marker,index)=>({ from: markers[index].name, to: marker.name })) : [];
  const selectedIndex = regionMode ? d.day - 1 : Math.max(0, BC_TOURS.findIndex(tour=>tour.id===t.id));
  const options = {
    selector: "#bc-region-map",
    map: "world",
    backgroundColor: "#000",
    draggable: false,
    zoomButtons: false,
    zoomOnScroll: false,
    zoomAnimate: true,
    zoomMax: 30,
    bindTouchEvents: false,
    showTooltip: true,
    focusOn: regionMode ? { coords: meta.focus, scale: meta.scale, animate: false } : undefined,
    regionsSelectable: false,
    selectedRegions: regionMode ? [t.world.region] : [],
    regionStyle: {
      initial: { fill: "#1d1d1d", fillOpacity: 1, stroke: "#000", strokeWidth: .5 },
      hover: { fill: "#333", fillOpacity: 1, cursor: regionMode ? "default" : "pointer" },
      selected: { fill: "#fff", stroke: "#000", strokeWidth: 1 },
      selectedHover: { fill: "#fff" }
    },
    markers,
    markersSelectable: true,
    markersSelectableOne: true,
    selectedMarkers: [selectedIndex],
    markerStyle: {
      initial: { r: 7, fill: "#000", stroke: "#fff", strokeWidth: 3, strokeOpacity: 1 },
      hover: { r: 9, fill: "#000", stroke: "#fff", cursor: "pointer" },
      selected: { r: 10, fill: "#fff", stroke: "#000", strokeWidth: 4 },
      selectedHover: { fill: "#fff", stroke: "#000" }
    },
    labels: { markers: { render: (marker,index) => regionMode ? `0${Number(index)+1}` : bcTxt(BC_TOURS[Number(index)]?.world.city) } },
    markerLabelStyle: {
      initial: { fontFamily: '"Noto Sans TC", system-ui, sans-serif', fontSize: 9, fontWeight: 800, fill: regionMode ? "#000" : "#fff" },
      hover: { cursor: "pointer" },
      selected: { fill: "#000" },
      selectedHover: { fill: "#000" }
    },
    lines,
    lineStyle: { stroke: "#000", strokeWidth: 2, strokeLinecap: "round", curvature: .08 },
    onRegionClick(event, code) {
      if (regionMode) return;
      const tour = BC_TOURS.find(item=>item.world.region===code);
      if (!tour) return;
      state.mapTourId = tour.id;
      state.mapDay = 1;
      state.mapScope = "region";
      state.uiFocusSelector = "#bc-region-story-title";
      renderPage();
    },
    onMarkerClick(event, index) { bcSelectRegionalMarker(index, regionMode); },
    onRegionTooltipShow(event, tooltip, code) {
      const tour = BC_TOURS.find(item=>item.world.region===code);
      if (!tour) event.preventDefault();
      else tooltip.text(`${bcTxt(tour.destination)} · ${money(tour.price)} ${L("起","from","desde")}`);
    },
    onMarkerTooltipShow(event, tooltip, index) {
      tooltip.text(regionMode ? markers[Number(index)]?.name : `${markers[Number(index)]?.name} · ${money(BC_TOURS[Number(index)]?.price || 0)} ${L("起","from","desde")}`);
    }
  };
  bcRegionalMapInstance = new jsVectorMap(options);
  if ("ResizeObserver" in window) {
    bcRegionalMapResizeObserver = new ResizeObserver(()=>{
      try { bcRegionalMapInstance?.updateSize(); } catch (_) {}
    });
    bcRegionalMapResizeObserver.observe(target);
  }
  requestAnimationFrame(()=>{
    target.querySelectorAll(".jvm-marker").forEach((marker,index)=>{
      marker.setAttribute("tabindex","0");
      marker.setAttribute("role","button");
      marker.setAttribute("aria-label", regionMode ? `${L("第","Day","Día")} ${index+1} · ${bcTxt(t.route[index]?.city)}` : `${L("查看","View","Ver")} ${bcTxt(BC_TOURS[index]?.destination)}`);
      marker.addEventListener("keydown", event=>{
        if (!["Enter"," "].includes(event.key)) return;
        event.preventDefault();
        bcSelectRegionalMarker(index, regionMode);
      });
    });
    if (!regionMode) {
      BC_TOURS.forEach(tour=>{
        const region = target.querySelector(`.jvm-region[data-code="${tour.world.region}"]`);
        if (!region) return;
        region.setAttribute("tabindex","0");
        region.setAttribute("role","button");
        region.setAttribute("aria-label", `${L("放大","Zoom into","Ampliar")} ${bcTxt(tour.destination)}`);
        region.addEventListener("keydown", event=>{
          if (!["Enter"," "].includes(event.key)) return;
          event.preventDefault();
          state.mapTourId = tour.id;
          state.mapDay = 1;
          state.mapScope = "region";
          state.uiFocusSelector = "#bc-region-story-title";
          renderPage();
        });
      });
    }
  });
}

function bcSelectDetailMapStop(index, stops) {
  const stop = stops[Number(index)];
  if (!stop) return;
  state.day = stop.day;
  state.poi = stop.id;
  state.uiFocusSelector = "#bc-detail-stop-title";
  renderPage();
}

const BC_TAIWAN_MAP = { width: 460, height: 760, minLon: 119.95, maxLon: 122.12, minLat: 21.78, maxLat: 25.42 };

function bcTaiwanGeoPoint(stop) {
  const [lat, lon] = stop.geo;
  return {
    x: ((lon - BC_TAIWAN_MAP.minLon) / (BC_TAIWAN_MAP.maxLon - BC_TAIWAN_MAP.minLon)) * BC_TAIWAN_MAP.width,
    y: ((BC_TAIWAN_MAP.maxLat - lat) / (BC_TAIWAN_MAP.maxLat - BC_TAIWAN_MAP.minLat)) * BC_TAIWAN_MAP.height
  };
}

const BC_TAIWAN_DAY_ANCHORS = {
  1: "d1-chiayi-voco",
  2: "d2-fenqihu",
  3: "d3-sun-moon-lake",
  4: "d4-beipu-old-street",
  5: "d5-taipei-101",
  6: "d6-chenggong-walk",
  7: "d7-hualien",
  8: "d8-taoyuan-airport"
};

const BC_TAIWAN_DAY_STORIES = [
  {
    lede: bcI18n("從一碗熱豆漿開始，旅程把長途飛行慢慢交還給台灣的日常。", "The journey begins with warm soy milk, easing the transition from a long flight into the rhythms of everyday Taiwan.", "El viaje comienza con un tazón de leche de soja caliente, dejando atrás el vuelo largo para entrar poco a poco en el ritmo cotidiano de Taiwán."),
    body: bcI18n("抵達桃園後，先享用台式早餐，再前往霧峰林家宮保第，閱讀中台灣家族與歷史建築的修復故事；傍晚抵達嘉義，為隔日的山林鐵道安穩落腳。", "After arriving in Taoyuan, continue to Wufeng Lin Family Mansion to trace the family history and restoration of this central-Taiwan estate. The day ends in Chiayi, ready for tomorrow's forest railway.", "Tras llegar a Taoyuan, se continúa hacia la residencia de la familia Lin de Wufeng para conocer su historia y restauración. Al atardecer, el recorrido termina en Chiayi, listo para el ferrocarril forestal del día siguiente.")
  },
  {
    lede: bcI18n("山林把速度放慢，茶香、古典旋律與窗外山嵐一起進入車廂。", "The forest slows the pace as tea, classical music and mountain mist enter the carriage together.", "El bosque baja el ritmo; el aroma del té, la música clásica y la niebla de la montaña entran juntos en el vagón."),
    body: bcI18n("午餐後從奮起湖登上福森號，沿森林鐵路經水社寮、交力坪與竹崎方向下行，最後抵達北門、返回嘉義；實際停靠與時刻仍以林鐵核定為準。", "After lunch, board the Formosensis at Fenqihu and descend toward Beimen along the forest railway, following the route through Shuisheliao, Jiaoliping and Zhuqi before returning to Chiayi. Final stops and timings remain subject to railway approval.", "Después del almuerzo, el Formosensis parte de Fenqihu y desciende hacia Beimen por la línea forestal, siguiendo la ruta por Shuisheliao, Jiaoliping y Zhuqi antes de regresar a Chiayi. Las paradas y horarios definitivos dependen de la aprobación ferroviaria.")
  },
  {
    lede: bcI18n("湖面收住群山的倒影，午後則從一席紅茶慢慢展開。", "The lake holds the reflection of the mountains, while the afternoon unfolds over black tea.", "El lago guarda el reflejo de las montañas, mientras la tarde se abre alrededor del té negro."),
    body: bcI18n("這一天串起紅茶莊園戶外茶席、日月潭遊船與伊達邵聚落；從製茶與品飲的五感體驗走到湖上風景，夜晚回到湖景住宿，讓山與水留在窗前。", "The day connects an outdoor tea-estate tasting, a cruise on Sun Moon Lake and the Ita Thao community. It moves from the senses of tea making and tasting to open water, ending with a proposed lake-view stay.", "La jornada enlaza una degustación al aire libre en una finca de té, un paseo en barco por Sun Moon Lake y la comunidad de Ita Thao. Pasa de los sentidos del té al paisaje del lago y termina con una estancia prevista frente al agua.")
  },
  {
    lede: bcI18n("離開湖區後，旅程在北埔放慢腳步，從一條老街讀懂客家日常。", "Leaving the lake behind, the journey slows in Beipu and reads Hakka life through one old street.", "Al dejar el lago, el viaje baja el ritmo en Beipu y descubre la vida hakka a través de una calle antigua."),
    body: bcI18n("步行串連北埔老街、金廣福公館、慈天宮與姜氏家廟，再親手研磨茶與穀物完成擂茶；傍晚前往台北，從聚落歷史轉入城市節奏。", "Walk between Beipu Old Street, Jinguangfu House, Citian Temple and the Jiang ancestral hall, then grind tea and grains in a hands-on lei-cha workshop. The route continues to Taipei, shifting from community history into the rhythm of the city.", "El paseo enlaza Beipu Old Street, Jinguangfu House, el templo Citian y el salón ancestral Jiang, seguido de un taller de lei-cha. Después, la ruta continúa hacia Taipéi y cambia la historia del poblado por el pulso urbano.")
  },
  {
    lede: bcI18n("台北很快，廟埕、紅磚街屋與博物館卻保存著不同年代的時間。", "Taipei moves quickly, yet museum galleries, temple courts and red-brick streets preserve different layers of time.", "Taipéi avanza deprisa, pero los museos, patios de templos y edificios de ladrillo conservan distintos tiempos de la ciudad."),
    body: bcI18n("從故宮的跨朝代典藏出發，走進艋舺龍山寺、青草巷與剝皮寮歷史街區，最後登上台北 101；一天之內，從器物、信仰與街巷一路讀到城市天際線。", "Begin with the National Palace Museum's collection, then walk through Longshan Temple, Herb Alley and the Bopiliao Historic Block before rising above the city at Taipei 101. The day moves from objects and belief to streets and skyline.", "La jornada comienza en el National Palace Museum, continúa por Longshan Temple, Herb Alley y el barrio histórico de Bopiliao, y termina en Taipei 101. En un día se pasa de los objetos y la fe a las calles y el horizonte urbano.")
  },
  {
    lede: bcI18n("鳴日號貼著海岸南下，窗外的島嶼從龜山島、田野一路換成太平洋。", "The Future Express follows the coast south as Guishan Island, open fields and the Pacific replace one another beyond the window.", "El Future Express sigue la costa hacia el sur mientras Guishan Island, los campos y el Pacífico se suceden tras la ventana."),
    body: bcI18n("從南港登車，列車在石城至大里段慢行眺望海岸，經東里田野後，行程轉入成功鎮；海光走讀以音樂、漁港與聚落故事展開，夜晚以南島料理與音樂收束。", "Board at Nangang and slow through the Shicheng-Dali coastal section before passing the fields around Dongli. The journey then turns to Chenggong, where music, fishing harbours and community stories shape the Sea-light walk, followed by an Austronesian-inspired evening.", "El tren parte de Nangang y reduce la velocidad entre Shicheng y Dali para contemplar la costa, antes de pasar por los campos de Dongli. Después, el recorrido continúa hacia Chenggong con música, puertos pesqueros e historias locales, y concluye con una velada de inspiración austronesia.")
  },
  {
    lede: bcI18n("離開月台後，山林、火塘與歌聲用另一種語言迎接旅人。", "Beyond the platform, forest, fire and song welcome travellers in another language.", "Más allá del andén, el bosque, el fuego y el canto reciben al viajero en otro idioma."),
    body: bcI18n("先走進永康部落的烏尼囊體驗，從狩獵知識、植物利用與火塘餐桌認識布農文化；再由鹿野登上鳴日號，沿花東縱谷北上花蓮，最後在海岸山脈高處休息。", "Enter the Uninang experience in the Yongkang community to learn about Bunun culture through hunting knowledge, plants, a fire-cooked table and harmony. Then board the Future Express at Luye for the valley journey north to Hualien, ending high on the coastal range.", "La experiencia Uninang en la comunidad de Yongkang presenta la cultura bunun mediante conocimientos de caza, plantas, cocina al fuego y canto. Después, el Future Express parte de Luye y recorre el valle hacia Hualien, donde el día termina en lo alto de la cordillera costera.")
  },
  {
    lede: bcI18n("最後一天不急著告別，先把花蓮的石頭與手作記憶帶在身上。", "The final day does not rush the farewell; it begins by carrying a little of Hualien's stone and craft away.", "El último día no apresura la despedida; comienza llevando consigo algo de la piedra y la artesanía de Hualien."),
    body: bcI18n("在如豐琢玉工坊認識豐田礦區與台灣玉，並親手完成加工體驗；之後從花蓮登上鳴日號北返南港，再銜接桃園機場送行，實際時間仍需配合列車與航班確認。", "Learn about Fengtian mining and Taiwan jade at the Rufeng workshop, then shape a piece by hand. Board the Future Express in Hualien for the final ride to Nangang before the airport transfer; the rail and flight connection still requires confirmation.", "En el taller Rufeng se conoce la historia minera de Fengtian y el jade de Taiwán antes de trabajar una pieza a mano. Después, el Future Express regresa de Hualien a Nangang y conecta con el traslado al aeropuerto; los horarios de tren y vuelo aún deben confirmarse.")
  }
];

function bcTaiwanStoryLine(day) {
  return bcTxt(BC_TAIWAN_DAY_STORIES[Math.min(8, Math.max(1, day)) - 1].lede);
}

function bcTaiwanStoryBody(day) {
  return bcTxt(BC_TAIWAN_DAY_STORIES[Math.min(8, Math.max(1, day)) - 1].body);
}

const BC_TAIWAN_DAY_MEALS = {
  1: {
    breakfast: bcI18n("台式豆漿早餐", "Taiwanese soy-milk breakfast", "Desayuno taiwanés con leche de soja"),
    lunch: bcI18n("与玥樓頂級粵菜餐廳", "Cantonese lunch at 与玥樓 · official English name unconfirmed", "Almuerzo cantonés en 与玥樓 · nombre oficial sin confirmar"),
    dinner: bcI18n("飯店內用晚餐", "Dinner at the hotel", "Cena en el hotel")
  },
  2: {
    breakfast: bcI18n("飯店早餐", "Hotel breakfast", "Desayuno en el hotel"),
    lunch: bcI18n("FKUO 山芙蓉茶業午餐・尚未確認", "Lunch at FKUO 山芙蓉茶業 · unconfirmed", "Almuerzo en FKUO 山芙蓉茶業 · sin confirmar"),
    dinner: bcI18n("嘉義福容 voco 酒店半自助晚餐", "Semi-buffet dinner at Fullon Hotel Chiayi voco", "Cena semibufé en Fullon Hotel Chiayi voco")
  },
  3: {
    breakfast: bcI18n("飯店早餐", "Hotel breakfast", "Desayuno en el hotel"),
    lunch: bcI18n("雲品套餐", "Set lunch at Fleur de Chine Hotel", "Almuerzo de menú en Fleur de Chine Hotel"),
    dinner: bcI18n("雲品・丹彤自助晚餐", "Buffet dinner at 丹彤, Fleur de Chine Hotel · official English name unconfirmed", "Cena bufé en 丹彤, Fleur de Chine Hotel · nombre oficial sin confirmar")
  },
  4: {
    breakfast: bcI18n("飯店早餐", "Hotel breakfast", "Desayuno en el hotel"),
    lunch: bcI18n("Bebu 春嬌粄條", "Hakka flat-noodle lunch at Bebu 春嬌粄條 · official English name unconfirmed", "Almuerzo de fideos planos hakka en Bebu 春嬌粄條 · nombre oficial sin confirmar"),
    dinner: bcI18n("粵亮廣式料理", "Cantonese dinner at 粵亮 · official English name unconfirmed", "Cena cantonesa en 粵亮 · nombre oficial sin confirmar")
  },
  5: {
    breakfast: bcI18n("飯店早餐", "Hotel breakfast", "Desayuno en el hotel"),
    lunch: bcI18n("鼎泰豐", "Din Tai Fung", "Din Tai Fung"),
    dinner: bcI18n("台北無菜單料理・餐廳未列", "Taipei chef's-menu dinner · restaurant not listed", "Cena de menú del chef en Taipéi · restaurante no indicado")
  },
  6: {
    breakfast: bcI18n("鳴日早餐盒", "Future Express breakfast box", "Caja de desayuno del Future Express"),
    lunch: bcI18n("鳴日列車餐盒", "Future Express train lunch box", "Caja de almuerzo a bordo del Future Express"),
    dinner: bcI18n("方舟音樂餐廳晚宴或同級・尚未確認", "Ark Music Restaurant dinner or equivalent · unconfirmed", "Cena en Ark Music Restaurant o equivalente · sin confirmar")
  },
  7: {
    breakfast: bcI18n("飯店早餐", "Hotel breakfast", "Desayuno en el hotel"),
    lunch: bcI18n("布農族在地文化餐桌・火塘煙燻料理", "Bunun local cultural table · fire-smoked cooking", "Mesa cultural local bunun · cocina ahumada al fuego"),
    dinner: bcI18n("飯店內晚餐", "Dinner at the hotel", "Cena en el hotel")
  },
  8: {
    breakfast: bcI18n("飯店早餐", "Hotel breakfast", "Desayuno en el hotel"),
    lunch: bcI18n("闔家歡南北餚餐館或同級・尚未確認", "Lunch at 闔家歡南北餚餐館 or equivalent · unconfirmed", "Almuerzo en 闔家歡南北餚餐館 o equivalente · sin confirmar"),
    dinner: bcI18n("晚餐未列・待確認", "Dinner not listed · to be confirmed", "Cena no indicada · por confirmar")
  }
};

function bcTaiwanDayMeals(day) {
  return BC_TAIWAN_DAY_MEALS[Math.min(8, Math.max(1, day))];
}

const BC_TAIWAN_DAY_STAYS = {
  1: { name: bcI18n("嘉義福容 voco 酒店", "Fullon Hotel Chiayi voco", "Fullon Hotel Chiayi voco"), stars: null, level: bcI18n("待確認", "Pending", "Pendiente"), note: bcI18n("或同級・實際入住尚未確認", "or equivalent · actual stay unconfirmed", "o equivalente · alojamiento sin confirmar") },
  2: { name: bcI18n("嘉義福容 voco 酒店", "Fullon Hotel Chiayi voco", "Fullon Hotel Chiayi voco"), stars: null, level: bcI18n("待確認", "Pending", "Pendiente"), note: bcI18n("或同級・實際入住尚未確認", "or equivalent · actual stay unconfirmed", "o equivalente · alojamiento sin confirmar") },
  3: { name: bcI18n("日月潭雲品溫泉酒店・湖景房", "Fleur de Chine Hotel · lake-view room", "Fleur de Chine Hotel · habitación con vista al lago"), stars: null, level: bcI18n("待確認", "Pending", "Pendiente"), note: bcI18n("或同級・實際入住尚未確認", "or equivalent · actual stay unconfirmed", "o equivalente · alojamiento sin confirmar") },
  4: { name: bcI18n("台北六福萬怡酒店", "Courtyard Taipei", "Courtyard Taipei"), stars: null, level: bcI18n("待確認", "Pending", "Pendiente"), note: bcI18n("或同級・實際入住尚未確認", "or equivalent · actual stay unconfirmed", "o equivalente · alojamiento sin confirmar") },
  5: { name: bcI18n("台北六福萬怡酒店", "Courtyard Taipei", "Courtyard Taipei"), stars: null, level: bcI18n("待確認", "Pending", "Pendiente"), note: bcI18n("或同級・實際入住尚未確認", "or equivalent · actual stay unconfirmed", "o equivalente · alojamiento sin confirmar") },
  6: { name: bcI18n("台東 The GAYA Hotel", "The GAYA Hotel Taitung", "The GAYA Hotel Taitung"), stars: null, level: bcI18n("待確認", "Pending", "Pendiente"), note: bcI18n("或同級・實際入住尚未確認", "or equivalent · actual stay unconfirmed", "o equivalente · alojamiento sin confirmar") },
  7: { name: bcI18n("花蓮遠雄悅來大飯店", "Farglory Hotel Hualien", "Farglory Hotel Hualien"), stars: 5, level: bcI18n("五星級飯店", "Five-star hotel", "Hotel de cinco estrellas"), ratingNote: bcI18n("來源文件明示", "Stated in the supplied itinerary", "Indicado en el itinerario"), note: bcI18n("指定飯店或同級・實際入住尚未確認", "named hotel or equivalent · actual stay unconfirmed", "hotel indicado o equivalente · alojamiento sin confirmar") },
  8: { name: bcI18n("不安排住宿", "No hotel", "Sin hotel"), stars: 0, level: bcI18n("不適用", "Not applicable", "No aplica"), note: bcI18n("行程結束", "Journey ends", "Fin del viaje") }
};

function bcTaiwanDayStay(day) {
  return BC_TAIWAN_DAY_STAYS[Math.min(8, Math.max(1, day))];
}

const BC_ITINERARY_CONTRACTS = Object.fromEntries(BC_DETAIL_TOURS.map(tour => {
  const contract = bcBuildItineraryContract(tour);
  tour.dataContract = contract;
  const errors = bcValidateItineraryContract(contract);
  if (errors.length) {
    contract.validationStatus = "prototype_invalid";
    console.warn(`[PACK&GO itinerary contract] ${tour.code}`, errors);
  }
  return [tour.id, contract];
}));
globalThis.BC_ITINERARY_CONTRACTS = BC_ITINERARY_CONTRACTS;

function bcJourneyStoryLine(t, day) {
  if (t.id === 88) return bcTaiwanStoryLine(day.day);
  return L(
    `${bcTxt(day.city)}不是一張打卡清單；今天用${bcTxt(day.sights)}，慢慢讀懂這一段旅程。`,
    `${bcTxt(day.city)} is not a checklist. Today, ${bcTxt(day.sights)} become the thread through this part of the journey.`,
    `${bcTxt(day.city)} no es una lista. Hoy, ${bcTxt(day.sights)} dan sentido a esta parte del viaje.`
  );
}

function bcJourneyStoryBody(t, day) {
  if (t.id === 88) return bcTaiwanStoryBody(day.day);
  const stops = (day.stops || []).slice(0, 3).map(stop => bcTxt(stop.name));
  const route = stops.length ? stops.join(" → ") : bcTxt(day.city);
  return L(
    `這一天依序走過 ${route}。主題、停靠、餐食與住宿使用同一份行程資料同步呈現；實際時間與供應商仍以出發前確認為準。`,
    `The day moves through ${route}. Theme, stops, meals and stay share one itinerary source; final timing and suppliers remain subject to pre-departure confirmation.`,
    `El día recorre ${route}. Tema, paradas, comidas y hotel comparten los mismos datos; horarios y proveedores se confirman antes de salir.`
  );
}

function bcJourneyDayMeals(t, day) {
  const meals = day.dataContract?.meals || [];
  return Object.fromEntries(meals.map(meal => [meal.mealType, meal.displayName]));
}

function bcJourneyDayStay(t, day) {
  const stay = day.dataContract?.stay;
  if (!stay) return { name: day.hotel, stars: null, level: bcI18n("星級待確認", "Rating pending"), note: bcI18n("實際飯店、房型與訂位狀態待正式確認", "Hotel, room and booking status remain subject to confirmation") };
  return {
    name: stay.displayName,
    stars: stay.rating.value,
    level: stay.level,
    ratingNote: stay.rating.sourceLabel,
    note: stay.note,
    propertyStatus: stay.propertyStatus,
    bookingStatus: stay.bookingStatus
  };
}

function bcTaiwanStayRating(stay) {
  if (stay.stars === 0) return "";
  const starMarks = stay.stars ? `<span class="bc-dive-stay-stars" aria-hidden="true">${"★".repeat(stay.stars)}</span>` : `<span class="bc-dive-stay-label">${L("飯店星級","HOTEL RATING","CLASIFICACIÓN")}</span>`;
  const source = stay.ratingNote ? `<em>${bcTxt(stay.ratingNote)}</em>` : "";
  return `<span class="bc-dive-stay-rating ${stay.stars ? "is-confirmed" : "is-pending"}">${starMarks}<b>${bcTxt(stay.level)}</b>${source}</span>`;
}

const BC_TAIWAN_DAY_MEDIA = {
  1: [BC_IMG.taiwanForestTrain, BC_IMG.taiwanForestCabin, BC_IMG.taiwanForestTrain],
  2: [BC_IMG.taiwanForestCabin, BC_IMG.taiwanForestTrain, BC_IMG.taiwanForestCabin],
  3: [BC_IMG.taiwanForestCabin, BC_IMG.taiwanForestTrain, BC_IMG.taiwanForestCabin],
  4: [BC_IMG.taiwanForestTrain, BC_IMG.taiwanForestCabin, BC_IMG.taiwanForestTrain],
  5: [BC_IMG.taiwanFutureTrain, BC_IMG.taiwanFutureCabin, BC_IMG.taiwanFutureTrain],
  6: [BC_IMG.taiwanFutureCabin, BC_IMG.taiwanFutureTrain, BC_IMG.taiwanFutureCabin],
  7: [BC_IMG.taiwanFutureTrain, BC_IMG.taiwanFutureCabin, BC_IMG.taiwanFutureTrain],
  8: [BC_IMG.taiwanFutureCabin, BC_IMG.taiwanFutureTrain, BC_IMG.taiwanFutureCabin]
};

function bcTaiwanDayMedia(t, dayNumber) {
  const day = t.route[Math.min(t.route.length, Math.max(1, dayNumber)) - 1];
  if (t.id === 88) return BC_TAIWAN_DAY_MEDIA[day.day].slice();
  const rotatedGallery = t.gallery.map((_, index) => t.gallery[(index + dayNumber - 1) % t.gallery.length]);
  const media = [];
  [day.image, ...(day.stops || []).map(stop => stop.image), ...rotatedGallery].filter(Boolean).forEach(src => {
    if (!media.includes(src)) media.push(src);
  });
  while (media.length < 3) media.push(t.gallery[media.length % t.gallery.length]);
  return media.slice(0, 3);
}

function bcTaiwanStoryMediaChoices(t, day, media, meals, stay) {
  const choices = [{
    id: "day",
    kind: L("本日主題", "DAY STORY", "HISTORIA DEL DÍA"),
    title: bcTxt(day.city),
    summary: bcJourneyStoryLine(t, day),
    description: bcJourneyStoryBody(t, day),
    image: media[0],
    photoNote: L("來源文件主題圖・設計示意", "SOURCE THEME IMAGE · DESIGN DEMO", "IMAGEN DE FUENTE · DEMO")
  }];
  (day.stops || []).forEach((stop, index) => choices.push({
    id: `stop:${stop.id}`,
    kind: bcPoiKindLabel(stop.kind),
    title: bcTxt(stop.name),
    summary: bcTxt(stop.summary),
    description: bcTxt(stop.description),
    image: stop.kind === "rail" ? (stop.image || media[(index + 1) % media.length]) : media[0],
    photoNote: stop.kind === "rail"
      ? L("來源文件列車情境圖・非該站實景・設計示意", "SOURCE RAIL MOOD IMAGE · NOT THE ACTUAL STOP · DESIGN DEMO", "IMAGEN FERROVIARIA · NO ES LA PARADA REAL · DEMO")
      : L("保留本日主圖・該景點實景待補・設計示意", "DAY IMAGE RETAINED · ACTUAL VENUE PHOTO PENDING · DESIGN DEMO", "IMAGEN DEL DÍA · FOTO REAL PENDIENTE · DEMO")
  }));
  [["breakfast", L("早餐", "BREAKFAST", "DESAYUNO")], ["lunch", L("午餐", "LUNCH", "ALMUERZO")], ["dinner", L("晚餐", "DINNER", "CENA")]].forEach(([key, label], index) => choices.push({
    id: `meal:${key}`,
    kind: label,
    title: bcTxt(meals[key]),
    summary: L("餐食名稱與供應狀態依提供行程整理。", "Meal name and status follow the supplied itinerary.", "El nombre y estado siguen el itinerario proporcionado."),
    description: L("餐廳與菜色實景照片仍待正式素材；目前保留本日主圖，只示意點選後的敘事回應。", "Actual restaurant and dish photography is pending; the day image stays in place while the prototype demonstrates the narrative response.", "Las fotos reales están pendientes; se conserva la imagen del día para demostrar la respuesta narrativa."),
    image: media[0],
    photoNote: L("保留本日主圖・餐食實景待補・設計示意", "DAY IMAGE RETAINED · ACTUAL MEAL PHOTO PENDING · DESIGN DEMO", "IMAGEN DEL DÍA · FOTO DE COMIDA PENDIENTE · DEMO")
  }));
  if (stay.stars !== 0) choices.push({
    id: "stay",
    kind: L("今晚住宿", "TONIGHT'S STAY", "ALOJAMIENTO"),
    title: bcTxt(stay.name),
    summary: `${bcTxt(stay.level)} · ${bcTxt(stay.note)}`,
    description: L("住宿名稱與星級依提供行程整理；實際入住與房型仍待確認。", "The hotel name and rating follow the supplied itinerary; the actual stay and room type remain unconfirmed.", "El nombre y categoría siguen el itinerario; la estancia y habitación siguen sin confirmar."),
    image: media[0],
    photoNote: L("保留本日主圖・指定飯店實景待補・設計示意", "DAY IMAGE RETAINED · NAMED HOTEL PHOTO PENDING · DESIGN DEMO", "IMAGEN DEL DÍA · FOTO DEL HOTEL PENDIENTE · DEMO")
  });
  return choices;
}

function bcTaiwanStoryAnchorPoint(t, dayNumber) {
  const stops = bcDetailRouteStops(t);
  const day = t.route[Math.min(t.route.length, Math.max(1, dayNumber)) - 1];
  const stop = stops.find(item => item.id === BC_TAIWAN_DAY_ANCHORS[day.day])
    || stops.find(item => item.day === day.day);
  const point = bcTaiwanGeoPoint(stop);
  const offset = ({ 1:[-12, 8], 2:[12, -8] }[day.day] || [0, 0]);
  return { x: point.x + offset[0], y: point.y + offset[1], stop, day };
}

function bcTaiwanRoutePoster(t, mode = "ledger") {
  const stops = bcDetailRouteStops(t);
  const selectedDay = Math.min(t.days, Math.max(1, Number(state.day) || 1));
  const storyMode = mode === "story";
  const dayAttribute = storyMode ? "data-story-day" : "data-day";
  const idSuffix = storyMode ? "story" : "ledger";
  const points = t.route.map(day => {
    if (storyMode) return bcTaiwanStoryAnchorPoint(t, day.day);
    const stop = stops.find(item => item.id === BC_TAIWAN_DAY_ANCHORS[day.day]) || stops.find(item => item.day === day.day);
    return { ...bcTaiwanGeoPoint(stop), stop, day };
  });
  const days = points.map(point => {
    const active = point.day.day === selectedDay;
    return `<g class="bc-taiwan-poster-day ${active ? "active" : ""}" ${dayAttribute}="${point.day.day}" tabindex="${active ? "0" : "-1"}" role="button" aria-pressed="${active}" aria-label="${L(`第 ${point.day.day} 天・${bcTxt(point.day.city)}`,`Day ${point.day.day} · ${bcTxt(point.day.city)}`,`Día ${point.day.day} · ${bcTxt(point.day.city)}`)}" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})"><circle class="bc-taiwan-poster-hit" r="34"/><circle class="bc-taiwan-poster-marker" r="18"/><text y=".5">D${point.day.day}</text></g>`;
  }).join("");
  return `<svg class="bc-taiwan-route-poster" viewBox="0 0 ${BC_TAIWAN_MAP.width} ${BC_TAIWAN_MAP.height}" role="group" aria-labelledby="bc-taiwan-poster-title-${idSuffix} bc-taiwan-poster-desc-${idSuffix}"><title id="bc-taiwan-poster-title-${idSuffix}">${L("台灣八日行程地圖","Eight-day Taiwan itinerary map","Mapa de ocho días por Taiwán")}</title><desc id="bc-taiwan-poster-desc-${idSuffix}">${storyMode ? L("八個日期節點；點選後，照片與短篇故事會同步換日。","Eight day markers. Choose one to update the photographs and short story.","Ocho marcadores diarios. Elija uno para actualizar fotos y relato.") : L("八個日期節點；點選每天可前往下方完整行程。","Eight day markers. Choose one to open its full itinerary below.","Ocho marcadores diarios. Elija uno para abrir su itinerario.")}</desc><image href="./assets/vendor/taiwan-map/taiwan-counties.svg" width="460" height="760" aria-hidden="true"/>${days}<text class="bc-taiwan-map-wordmark" x="28" y="735">TAIWAN · 8 DAY MAP</text></svg>`;
}

const BC_WORLD_POSTER = {
  width: 900,
  height: 440.70631074413296,
  radius: 6381372,
  centralMeridian: 11.5,
  bbox: { minX:-20004297.151525836, minY:-12671671.123330014, maxX:20026572.39474939, maxY:6930392.025135122 }
};

function bcWorldPosterPoint(geo) {
  const [lat, lon] = geo;
  const rad = Math.PI / 180;
  const projectedX = BC_WORLD_POSTER.radius * (lon - BC_WORLD_POSTER.centralMeridian) * rad;
  const projectedY = -BC_WORLD_POSTER.radius * Math.log(Math.tan((45 + .4 * lat) * rad)) / .8;
  const { minX,minY,maxX,maxY } = BC_WORLD_POSTER.bbox;
  return {
    x: ((projectedX - minX) / (maxX - minX)) * BC_WORLD_POSTER.width,
    y: ((projectedY - minY) / (maxY - minY)) * BC_WORLD_POSTER.height
  };
}

function bcJourneyStoryAnchorPoint(t, dayNumber) {
  if (t.id === 88) return { ...bcTaiwanStoryAnchorPoint(t, dayNumber), map: BC_TAIWAN_MAP };
  const day = t.route[Math.min(t.route.length, Math.max(1, dayNumber)) - 1];
  const stop = bcDetailRouteStops(t).find(item => item.day === day.day) || { geo: day.geo };
  return { ...bcWorldPosterPoint(day.geo), stop, day, map: BC_WORLD_POSTER };
}

const BC_ROUTE_ARRIVAL_LABELS = {
  "2-1": bcI18n("阿維拉", "Ávila"),
  "2-2": bcI18n("巴利亞多利德", "Valladolid"),
  "2-3": bcI18n("畢爾巴鄂", "Bilbao"),
  "2-4": bcI18n("昆卡", "Cuenca"),
  "2-5": bcI18n("馬德里", "Madrid"),
  "3-1": bcI18n("倫敦希斯洛", "London Heathrow"),
  "3-2": bcI18n("倫敦西區", "London West End"),
  "3-3": bcI18n("牛津", "Oxford"),
  "3-4": bcI18n("科茲窩", "Cotswolds"),
  "3-5": bcI18n("巨石陣", "Stonehenge"),
  "3-6": bcI18n("倫敦希斯洛", "London Heathrow"),
  "21-1": bcI18n("東京羽田", "Tokyo Haneda"),
  "21-2": bcI18n("東京下町", "Old Tokyo"),
  "21-3": bcI18n("河口湖", "Kawaguchiko"),
  "21-4": bcI18n("京都", "Kyoto"),
  "21-5": bcI18n("京都古寺", "Kyoto temples"),
  "21-6": bcI18n("大阪", "Osaka"),
  "21-7": bcI18n("東京羽田", "Tokyo Haneda")
};

function bcRouteArrivalLabel(t, day) {
  return bcTxt(day.mapLabel || BC_ROUTE_ARRIVAL_LABELS[`${t.id}-${day.day}`] || day.city);
}

function bcDetailJourneyMapModel(t) {
  const coordinates=t.route.map(day=>[day.geo[1],day.geo[0]]);
  const parent=coordinates.map((_,index)=>index);
  const find=index=>parent[index]===index?index:(parent[index]=find(parent[index]));
  const join=(a,b)=>{const rootA=find(a),rootB=find(b);if(rootA!==rootB)parent[rootB]=rootA;};
  coordinates.forEach((point,index)=>coordinates.slice(index+1).forEach((other,offset)=>{
    const latitude=(point[1]+other[1])/2*Math.PI/180;
    if(Math.hypot((point[0]-other[0])*Math.cos(latitude),point[1]-other[1])<.22)join(index,index+offset+1);
  }));
  const prescribed={
    2:["road","road","road","road"],
    3:["local","road","road","road","road"],
    21:["local","road","rail","local","rail","air"],
    88:["road","rail","road","road","road","rail","rail"]
  }[t.id];
  const legs=t.route.slice(0,-1).map((day,index)=>{
    if(prescribed?.[index])return prescribed[index];
    const next=t.route[index+1],distance=Math.hypot(day.geo[0]-next.geo[0],day.geo[1]-next.geo[1]);
    return distance<.08?"local":t.air&&distance>3.2?"air":"road";
  });
  return {
    id:`detail-${t.id}`,
    country:t.destination,
    title:t.title,
    days:t.route.map((day,index)=>({day:day.day,city:bcRouteArrivalLabel(t,day),metroKey:`metro-${find(index)}`,geo:day.geo})),
    legs
  };
}

function bcProfessionalMapMarkup(t) {
  return `<div class="bc-prof-route-map-wrap bc-journey-map-scope bc-layout-map-frame"><div id="bc-prof-route-map" class="bc-prof-route-map bc-layout-map" data-tour="${t.id}" aria-label="${L(`${bcTxt(t.destination)}真實地理行程地圖`,`${bcTxt(t.destination)} geographic itinerary map`,`Mapa geográfico de ${bcTxt(t.destination)}`)}"></div><div class="bc-prof-map-local-fallback" hidden>${bcJourneyEditorialPoster(t,"story")}</div><div class="bc-layout-map-status"><span>${L("實線・陸路／鐵路","SOLID · GROUND / RAIL")}</span><span>${L("虛線・航空","DASHED · AIR")}</span><span>${L("滑過日期・查看抵達地","HOVER DAY · ARRIVAL")}</span></div><div class="bc-prof-map-attribution bc-layout-attribution"><span>${L("真實地理底圖・路線為設計示意","GEOGRAPHIC BASEMAP · ROUTE DESIGN DEMO","MAPA GEOGRÁFICO · RUTA DEMO")}</span><span><a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></span></div></div>`;
}

function bcShowProfessionalMapFallback(target, t) {
  const wrap = target?.closest(".bc-prof-route-map-wrap");
  const fallback = wrap?.querySelector(".bc-prof-map-local-fallback");
  if (!wrap || !fallback || wrap.classList.contains("is-fallback")) return;
  try { bcProfessionalMapInstance?.remove(); } catch (_) {}
  bcProfessionalMapInstance = null;
  target.hidden = true;
  fallback.hidden = false;
  wrap.classList.add("is-fallback");
  const label = wrap.querySelector(".bc-prof-map-attribution span:first-child");
  if (label) label.textContent = L("本地編輯地圖・地圖服務暫時無法載入","LOCAL EDITORIAL MAP · MAP SERVICE UNAVAILABLE","MAPA EDITORIAL LOCAL · SERVICIO NO DISPONIBLE");
}

function bcMountProfessionalJourneyMap() {
  const target = document.getElementById("bc-prof-route-map");
  if (!target) return;
  const t = bcCurrentTour();
  if (typeof maplibregl !== "object" || typeof maplibregl.Map !== "function") {
    bcShowProfessionalMapFallback(target, t);
    return;
  }
  const compact = matchMedia("(max-width: 760px)").matches;
  const coordinates = t.route.map(day => [day.geo[1], day.geo[0]]);
  bcProfessionalMapInstance = new maplibregl.Map({
    container: target,
    style: "https://tiles.openfreemap.org/styles/positron",
    center: coordinates[0],
    zoom: 5,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    renderWorldCopies: false,
    localIdeographFontFamily: '"Noto Sans TC", system-ui, sans-serif'
  });
  bcProfessionalMapInstance.on("load", () => {
    if (!bcProfessionalMapInstance || !document.body.contains(target)) return;
    const curveLeg=(from,to,index)=>{
      const dx=to[0]-from[0],dy=to[1]-from[1],distance=Math.hypot(dx,dy);
      if(distance<.08) return [from,to];
      const closesJourney=index===coordinates.length-2 && coordinates.slice(0,-1).some(point=>Math.hypot(point[0]-to[0],point[1]-to[1])<.3);
      const bend=Math.min(distance*(closesJourney?.18:.09),closesJourney?.72:.3)*(closesJourney?1:index%2===0?1:-1);
      const control=[(from[0]+to[0])/2-(dy/distance)*bend,(from[1]+to[1])/2+(dx/distance)*bend];
      return Array.from({length:9},(_,step)=>{
        const progress=step/8,remaining=1-progress;
        return [remaining*remaining*from[0]+2*remaining*progress*control[0]+progress*progress*to[0],remaining*remaining*from[1]+2*remaining*progress*control[1]+progress*progress*to[1]];
      });
    };
    const routeCoordinates=coordinates.slice(1).flatMap((to,index)=>curveLeg(coordinates[index],to,index).slice(index===0?0:1));
    const routeData={type:"Feature",properties:{},geometry:{type:"LineString",coordinates:routeCoordinates}};
    bcProfessionalMapInstance.addSource("packgo-route", { type:"geojson", data:routeData });
    bcProfessionalMapInstance.addLayer({ id:"packgo-route-halo", type:"line", source:"packgo-route", paint:{ "line-color":"#fff", "line-width":6, "line-opacity":.98 }, layout:{ "line-cap":"round", "line-join":"round" } });
    bcProfessionalMapInstance.addLayer({ id:"packgo-route", type:"line", source:"packgo-route", paint:{ "line-color":"#111", "line-width":2.25, "line-opacity":.94 }, layout:{ "line-cap":"round", "line-join":"round" } });
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach(coordinate => bounds.extend(coordinate));
    bcProfessionalMapInstance.fitBounds(bounds, { padding:compact ? {top:76,right:76,bottom:86,left:76} : {top:92,right:130,bottom:112,left:130}, maxZoom:t.id===3?7.4:t.id===2?6.8:6.1, duration:0 });
    const longitudes=coordinates.map(coordinate=>coordinate[0]);
    const longitudeMid=(Math.min(...longitudes)+Math.max(...longitudes))/2;
    const clusterParent=coordinates.map((_,index)=>index);
    const clusterFind=index=>clusterParent[index]===index?index:(clusterParent[index]=clusterFind(clusterParent[index]));
    const clusterJoin=(a,b)=>{ const rootA=clusterFind(a),rootB=clusterFind(b); if(rootA!==rootB) clusterParent[rootB]=rootA; };
    const samePlaceDistance=.22;
    coordinates.forEach((point,index)=>coordinates.slice(index+1).forEach((other,offset)=>{
      const latitude=(point[1]+other[1])/2*Math.PI/180;
      const geographicDistance=Math.hypot((point[0]-other[0])*Math.cos(latitude),point[1]-other[1]);
      if(geographicDistance<samePlaceDistance) clusterJoin(index,index+offset+1);
    }));
    const markerClusters=new Map();
    coordinates.forEach((_,index)=>{ const root=clusterFind(index); const group=markerClusters.get(root) || []; group.push(index); markerClusters.set(root,group); });
    const makeDayButton=(day,index,side,clustered=false)=>{
      const button = document.createElement("button");
      const active = day.day === Number(state.day || 1);
      const shortCity = bcRouteArrivalLabel(t, day);
      button.type = "button";
      button.className = `bc-prof-map-marker ${side}${clustered ? " is-clustered" : ""}${active ? " active" : ""}`;
      button.dataset.day=String(day.day);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", L(`第 ${day.day} 天・${bcTxt(day.city)}`,`Day ${day.day} · ${bcTxt(day.city)}`,`Día ${day.day} · ${bcTxt(day.city)}`));
      button.innerHTML = `<b>D${day.day}</b><span>${shortCity}</span>`;
      button.addEventListener("click", () => {
        const previousDay = state.day;
        state.mapStoryPreviousDay = previousDay;
        state.day = day.day;
        state.poi = "";
        state.storyItem = "";
        state.mapStoryDesign = "D";
        state.mapStoryFocus = true;
        state.mapStoryReturning = false;
        state.mapStoryRefocus = false;
        renderPage();
        focusStoryDayAfterRender();
      });
      return button;
    };
    markerClusters.forEach(group=>{
      const markerCoordinate=group.reduce((sum,item)=>[sum[0]+coordinates[item][0]/group.length,sum[1]+coordinates[item][1]/group.length],[0,0]);
      const onEastSide=markerCoordinate[0]>longitudeMid;
      const side=onEastSide?"label-left":"label-right";
      if(group.length===1){
        const index=group[0];
        new maplibregl.Marker({element:makeDayButton(t.route[index],index,side),anchor:"center"}).setLngLat(markerCoordinate).addTo(bcProfessionalMapInstance);
        return;
      }
      const groupElement=document.createElement("div");
      groupElement.className=`bc-prof-map-group ${onEastSide?"extends-left":"extends-right"}`;
      groupElement.setAttribute("role","group");
      groupElement.setAttribute("aria-label",L("同一地區的行程日期","Journey days in the same area","Días en la misma zona"));
      group.forEach(index=>groupElement.append(makeDayButton(t.route[index],index,"label-right",true)));
      const groupOffset=onEastSide?[compact?4:-10,-42]:[compact?-85:10,-42];
      new maplibregl.Marker({element:groupElement,anchor:onEastSide?"right":"left",offset:groupOffset}).setLngLat(markerCoordinate).addTo(bcProfessionalMapInstance);
    });
  });
  const mountedMap = bcProfessionalMapInstance;
  setTimeout(() => {
    if (bcProfessionalMapInstance !== mountedMap || !document.body.contains(target) || mountedMap.loaded()) return;
    bcShowProfessionalMapFallback(target, t);
  }, 4000);
}

function bcMountApprovedJourneyMap() {
  const target=document.getElementById("bc-prof-route-map");
  if(!target)return;
  const t=bcCurrentTour();
  if(typeof bcMountMapLayoutLabMap!=="function"){
    bcMountProfessionalJourneyMap();
    return;
  }
  if(typeof maplibregl!=="object"||typeof maplibregl.Map!=="function"){
    bcShowProfessionalMapFallback(target,t);
    return;
  }
  const scope=target.closest(".bc-journey-map-scope");
  const journey=bcDetailJourneyMapModel(t);
  const selectDay=day=>{
    state.mapStoryPreviousDay=state.day;
    state.day=day.day;
    state.poi="";
    state.storyItem="";
    state.mapStoryDesign="D";
    state.mapStoryFocus=true;
    state.mapStoryReturning=false;
    state.mapStoryRefocus=false;
    renderPage();
    focusStoryDayAfterRender();
  };
  bcProfessionalMapInstance=bcMountMapLayoutLabMap(target,journey,{scope,selectedDay:state.day,onDaySelect:selectDay});
  const mountedMap=bcProfessionalMapInstance;
  setTimeout(()=>{
    if(bcProfessionalMapInstance!==mountedMap||!document.body.contains(target)||mountedMap?.loaded())return;
    bcShowProfessionalMapFallback(target,t);
  },4000);
}

function bcJourneyEditorialPoster(t, mode = "story") {
  if (t.id === 88) return bcTaiwanRoutePoster(t, mode);
  const selectedDay = Math.min(t.days, Math.max(1, Number(state.day) || 1));
  const points = t.route.map((day,index,route) => {
    const point = bcWorldPosterPoint(day.geo);
    const overlapCount = route.slice(0,index).filter(previous => {
      const prior = bcWorldPosterPoint(previous.geo);
      return Math.hypot(point.x-prior.x,point.y-prior.y) < 1.2;
    }).length;
    const offsets = [[0,0],[.95,-.75],[-.95,-.75],[0,1.05],[1.2,.9],[-1.2,.9]];
    const [offsetX,offsetY] = offsets[Math.min(overlapCount,offsets.length-1)];
    return { x: point.x + offsetX, y: point.y + offsetY, day };
  });
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const routeCenterX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const routeCenterY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const compact = matchMedia("(max-width: 760px)").matches;
  const desktopFrames = { 2:[24,14.65], 3:[16,9.75], 21:[28,17.1] };
  const mobileFrames = { 2:[11,18.8], 3:[10,17], 21:[16,27.3] };
  const [viewWidth,viewHeight] = (compact ? mobileFrames : desktopFrames)[t.id] || (compact ? [16,25.6] : [26,19.7]);
  const minX = Math.max(0, routeCenterX - viewWidth / 2);
  const minY = Math.max(0, routeCenterY - viewHeight / 2);
  const markerRadius = compact ? .72 : .62;
  const routeLine = points.map((point,index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const markers = points.map(point => {
    const active = point.day.day === selectedDay;
    return `<g class="bc-taiwan-poster-day bc-journey-poster-day ${active ? "active" : ""}" data-story-day="${point.day.day}" tabindex="${active ? "0" : "-1"}" role="button" aria-pressed="${active}" aria-label="${L(`第 ${point.day.day} 天・${bcTxt(point.day.city)}`,`Day ${point.day.day} · ${bcTxt(point.day.city)}`,`Día ${point.day.day} · ${bcTxt(point.day.city)}`)}" transform="translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})"><circle class="bc-taiwan-poster-hit" r="${markerRadius * 1.35}" style="r:${(markerRadius * 1.35).toFixed(2)}px"/><circle class="bc-taiwan-poster-marker" r="${markerRadius}" style="r:${markerRadius}px"/><text class="bc-journey-poster-label" y="${(markerRadius * .22).toFixed(2)}" style="font-size:${(markerRadius * .72).toFixed(2)}px">D${point.day.day}</text></g>`;
  }).join("");
  const wordmarkX = minX + viewWidth * .045, wordmarkY = minY + viewHeight * .945;
  const regionLabel = t.id === 2 ? L("西班牙中北部","CENTRAL & NORTHERN SPAIN","CENTRO Y NORTE DE ESPAÑA") : t.id === 3 ? L("英格蘭南部","SOUTHERN ENGLAND","SUR DE INGLATERRA") : L("本州・關東至關西","HONSHU · KANTO TO KANSAI","HONSHU · KANTO A KANSAI");
  const regionAsset = t.id === 2 ? "spain" : t.id === 3 ? "england" : "japan";
  return `<svg class="bc-taiwan-route-poster bc-journey-route-poster" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${viewWidth.toFixed(2)} ${viewHeight.toFixed(2)}" preserveAspectRatio="xMidYMid meet" role="group" aria-labelledby="bc-journey-poster-title bc-journey-poster-desc"><title id="bc-journey-poster-title">${L(`${bcTxt(t.destination)} ${t.days} 日行程地圖`,`${t.days}-day ${bcTxt(t.destination)} itinerary map`,`Mapa de ${t.days} días · ${bcTxt(t.destination)}`)}</title><desc id="bc-journey-poster-desc">${L(`依 D1 到 D${t.days} 排列；點選後主圖與當日資料同步切換。`,`Ordered D1 through D${t.days}; choosing a day updates the main image and daily facts.`,`Ordenado D1–D${t.days}; al elegir un día cambian imagen y datos.`)}</desc><image href="./assets/vendor/region-maps/${regionAsset}.svg" width="900" height="440.70631074413296" aria-hidden="true"/><path class="bc-journey-route-halo" d="${routeLine}"/><path class="bc-journey-route-line" d="${routeLine}"/>${markers}<text class="bc-journey-region-label" x="${wordmarkX.toFixed(2)}" y="${(minY + viewHeight * .075).toFixed(2)}" style="font-size:${(viewWidth*.022).toFixed(2)}px">${regionLabel}</text><text class="bc-taiwan-map-wordmark" x="${wordmarkX.toFixed(2)}" y="${wordmarkY.toFixed(2)}" style="font-size:${(viewWidth*.018).toFixed(2)}px">${t.code} · ${t.days} DAY ROUTE · DESIGN DEMO</text></svg>`;
}

function bcJourneyRoutePoster(t, mode = "story") {
  return bcProfessionalMapMarkup(t);
}

function bcTaiwanStoryRail(t, className = "") {
  const selected = bcDetailSelectedDay(t);
  return `<nav class="bc-map-story-day-rail ${className}" style="--journey-days:${t.route.length}" aria-label="${L("切換旅程日期","Choose a journey day","Elegir día del viaje")}">${t.route.map(day => `<button class="bc-map-story-day ${day.day === selected.day ? "active" : ""}" data-story-day="${day.day}" aria-pressed="${day.day === selected.day}" ${day.day === selected.day ? 'aria-current="step"' : ""}><small>D${String(day.day).padStart(2,"0")}</small><b>${bcTxt(day.city)}</b><span>${L("抵達","ARRIVE","LLEGADA")} · ${bcRouteArrivalLabel(t, day)}</span></button>`).join("")}</nav>`;
}

function bcTaiwanStoryHeader(kicker, title, intro) {
  return `<header class="bc-map-story-header"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div><p>${intro}</p></header>`;
}

function bcTaiwanStoryCopy(t, className = "") {
  const day = bcDetailSelectedDay(t);
  return `<article class="bc-map-story-copy ${className}"><p class="bc-map-story-index">DAY ${String(day.day).padStart(2,"0")} / 08</p><h2 id="bc-map-story-title" tabindex="-1">${bcTxt(day.city)}</h2><blockquote>${bcTaiwanStoryLine(day.day)}</blockquote><p class="bc-map-story-fact">${bcTxt(day.sights)}</p><dl><div><dt>${L("餐食","MEALS","COMIDAS")}</dt><dd>${bcTxt(day.meals)}</dd></div><div><dt>${L("住宿","STAY","HOTEL")}</dt><dd>${bcTxt(day.hotel)}</dd></div></dl><button class="btn" data-day="${day.day}">${L(`查看第 ${day.day} 天完整行程`,`Open the full day ${day.day} plan`,`Ver el plan completo del día ${day.day}`)}</button></article>`;
}

function bcTaiwanStoryA(t) {
  const day = bcDetailSelectedDay(t);
  const media = bcTaiwanDayMedia(t, day.day);
  return `<section id="bc-map-story-variant" class="bc-map-story-lab bc-map-story-a" tabindex="-1">${bcTaiwanStoryHeader("DESIGN A · EDITORIAL ATLAS",L("地圖是索引，照片是主舞台。","The map is the index. Photography is the stage.","El mapa es el índice. La fotografía es el escenario."),L("先在台灣地圖選一天；右頁只留下三張情境圖、一句想像與必要事實。","Choose a day on the Taiwan map; the facing page keeps three source images, one evocative line and essential facts.","Elija un día; la página muestra tres imágenes, una frase y los datos esenciales."))}<div class="bc-atlas-story-spread"><div class="bc-atlas-story-map">${bcTaiwanRoutePoster(t,"story")}</div><div class="bc-atlas-story-page"><div class="bc-atlas-story-collage"><figure class="lead"><img src="${media[0]}" alt="${L(`第 ${day.day} 天來源文件情境圖`,`Day ${day.day} source-document mood image`,`Imagen de referencia del día ${day.day}`)}"/><figcaption>${L("來源文件照片・設計示意","SOURCE-DOCUMENT IMAGE · DESIGN DEMO","IMAGEN DE FUENTE · DEMO")}</figcaption></figure><img src="${media[1]}" alt="" aria-hidden="true"/><img src="${media[2]}" alt="" aria-hidden="true"/></div>${bcTaiwanStoryCopy(t,"bc-atlas-story-copy")}</div></div>${bcTaiwanStoryRail(t,"bc-atlas-story-rail")}</section>`;
}

function bcTaiwanStoryB(t) {
  const day = bcDetailSelectedDay(t);
  const media = bcTaiwanDayMedia(t, day.day);
  return `<section id="bc-map-story-variant" class="bc-map-story-lab bc-map-story-b" tabindex="-1">${bcTaiwanStoryHeader("DESIGN B · CINEMATIC STAGE",L("先看風景，再決定要讀多深。","See the scene first. Decide how deep to read.","Primero la escena. Después, cuánto quiere leer."),L("彩色主畫面承擔情緒；地圖縮成可玩的黑色導航器，完整資訊只在需要時展開。","The colour image carries the emotion. The map becomes a compact black navigator; full detail opens only on request.","La imagen lleva la emoción. El mapa se vuelve un navegador compacto y el detalle se abre al pedirlo."))}<div class="bc-cinema-stage"><img class="bc-cinema-hero" src="${media[0]}" alt="${L(`第 ${day.day} 天來源文件情境圖`,`Day ${day.day} source-document mood image`,`Imagen de referencia del día ${day.day}`)}"/><div class="bc-cinema-map">${bcTaiwanRoutePoster(t,"story")}</div><div class="bc-cinema-caption"><p>DAY ${String(day.day).padStart(2,"0")} / 08</p><h2 id="bc-map-story-title" tabindex="-1">${bcTxt(day.city)}</h2><blockquote>${bcTaiwanStoryLine(day.day)}</blockquote><span>${L("來源文件照片・設計示意","SOURCE-DOCUMENT IMAGE · DESIGN DEMO","IMAGEN DE FUENTE · DEMO")}</span></div><div class="bc-cinema-stills"><img src="${media[1]}" alt="" aria-hidden="true"/><img src="${media[2]}" alt="" aria-hidden="true"/></div></div><nav class="bc-cinema-filmstrip" aria-label="${L("以照片切換日期","Choose a day by photograph","Elegir día por fotografía")}">${t.route.map(routeDay => `<button class="bc-map-story-day ${routeDay.day === day.day ? "active" : ""}" data-story-day="${routeDay.day}" aria-pressed="${routeDay.day === day.day}" ${routeDay.day === day.day ? 'aria-current="step"' : ""}><img src="${routeDay.image}" alt="" aria-hidden="true"/><span>D${String(routeDay.day).padStart(2,"0")}</span><b>${bcTxt(routeDay.city)}</b></button>`).join("")}</nav><div class="bc-cinema-facts"><p>${bcTxt(day.sights)}</p><div><span><small>${L("餐食","MEALS","COMIDAS")}</small>${bcTxt(day.meals)}</span><span><small>${L("住宿","STAY","HOTEL")}</small>${bcTxt(day.hotel)}</span></div><button class="btn" data-day="${day.day}">${L(`查看完整第 ${day.day} 天`,`Open full day ${day.day}`,`Ver el día ${day.day} completo`)}</button></div></section>`;
}

function bcTaiwanStoryC(t) {
  const day = bcDetailSelectedDay(t);
  const media = bcTaiwanDayMedia(t, day.day);
  return `<section id="bc-map-story-variant" class="bc-map-story-lab bc-map-story-c" tabindex="-1">${bcTaiwanStoryHeader("DESIGN C · EIGHT-DAY PHOTO RIBBON",L("八天攤開，一眼找出想停留的那一天。","Spread out eight days and spot where you want to linger.","Despliegue ocho días y elija dónde quiere quedarse."),L("照片緞帶是一張視覺目錄；選中的一天會展開，地圖與下方短篇同步回應。","The photo ribbon is a visual contents page. The chosen day expands while the map and short story answer together.","La cinta fotográfica es un índice visual. El día elegido se abre y el mapa responde."))}<nav class="bc-photo-ribbon" aria-label="${L("八日照片目錄","Eight-day photo contents","Índice fotográfico de ocho días")}">${t.route.map(routeDay => `<button class="bc-photo-ribbon-day ${routeDay.day === day.day ? "active" : ""}" data-story-day="${routeDay.day}" aria-pressed="${routeDay.day === day.day}" ${routeDay.day === day.day ? 'aria-current="step"' : ""}><img src="${routeDay.image}" alt="" aria-hidden="true"/><span>D${String(routeDay.day).padStart(2,"0")}</span><div><b>${bcTxt(routeDay.city)}</b><small>${routeDay.day === day.day ? bcTaiwanStoryLine(routeDay.day) : ""}</small></div></button>`).join("")}</nav><div class="bc-ribbon-reader"><div class="bc-ribbon-map">${bcTaiwanRoutePoster(t,"story")}</div><div class="bc-ribbon-story"><div class="bc-ribbon-detail-photos"><img src="${media[1]}" alt="" aria-hidden="true"/><img src="${media[2]}" alt="" aria-hidden="true"/></div>${bcTaiwanStoryCopy(t,"bc-ribbon-story-copy")}<p class="bc-ribbon-source">${L("影像來自提供文件・僅作版面與互動示意","Images from the supplied document · layout and interaction demo only","Imágenes del documento suministrado · solo demo")}</p></div></div></section>`;
}

function bcTaiwanStoryD(t, context = "lab") {
  const day = bcDetailSelectedDay(t);
  const itineraryContract = t.dataContract;
  const dayContract = day.dataContract;
  const detailMode = context === "detail";
  const media = bcTaiwanDayMedia(t, day.day);
  const meals = bcJourneyDayMeals(t, day);
  const stay = bcJourneyDayStay(t, day);
  const mediaChoices = bcTaiwanStoryMediaChoices(t, day, media, meals, stay);
  const selectedMedia = mediaChoices.find(choice => choice.id === state.storyItem) || mediaChoices[0];
  const mediaTrigger = (id, content, label) => `<button type="button" class="bc-dive-media-trigger ${selectedMedia.id === id ? "is-active" : ""}" data-story-media="${id}" aria-pressed="${selectedMedia.id === id}" aria-label="${label}"><span>${content}</span><i aria-hidden="true">↗</i></button>`;
  const dayStops = day.stops || [];
  const previousDay = day.day > 1 ? t.route[day.day - 2] : null;
  const nextDay = day.day < t.route.length ? t.route[day.day] : null;
  const focus = bcJourneyStoryAnchorPoint(t, day.day);
  const previousFocus = bcJourneyStoryAnchorPoint(t, state.mapStoryPreviousDay || day.day);
  const focusX = ((focus.x / focus.map.width) * 100).toFixed(2);
  const focusY = ((focus.y / focus.map.height) * 100).toFixed(2);
  const previousFocusX = ((previousFocus.x / previousFocus.map.width) * 100).toFixed(2);
  const previousFocusY = ((previousFocus.y / previousFocus.map.height) * 100).toFixed(2);
  const stageState = state.mapStoryFocus ? `is-focused${state.mapStoryRefocus ? " is-refocusing" : ""}` : state.mapStoryReturning ? "is-returning" : "is-overview";
  const neighbor = (target, direction) => target
    ? `<button data-story-day="${target.day}" aria-label="${direction === "previous" ? L("前往上一天","Open previous day","Abrir día anterior") : L("前往下一天","Open next day","Abrir día siguiente")}・${bcTxt(target.city)}"><span>${direction === "previous" ? "← " : ""}D${String(target.day).padStart(2,"0")}${direction === "next" ? " →" : ""}</span><b>${bcTxt(target.city)}</b></button>`
    : detailMode && direction === "next"
      ? `<button data-book><span>${L(`完成 ${t.days} 日探索`,"JOURNEY COMPLETE","VIAJE COMPLETO")}</span><b>${L("查看可訂狀態 →","Check booking status →","Ver disponibilidad →")}</b></button>`
    : `<button disabled><span>${direction === "previous" ? "← " : ""}${direction === "previous" ? L("旅程起點","JOURNEY START","INICIO") : L("旅程終點","JOURNEY END","FINAL")}${direction === "next" ? " →" : ""}</span><b>${direction === "previous" ? L("沒有上一天","No previous day","Sin día anterior") : L("沒有下一天","No next day","Sin día siguiente")}</b></button>`;
  const logisticsBlock = `<section class="bc-dive-logistics-block" data-day-id="${dayContract?.id || ""}" data-stay-id="${dayContract?.stay?.id || ""}" aria-labelledby="bc-day-logistics-title">
    <p id="bc-day-logistics-title" class="bc-dive-logistics-title">${L("今天吃什麼・住哪裡","MEALS & TONIGHT'S STAY","COMIDAS Y ALOJAMIENTO")}</p>
    <dl class="bc-dive-logistics">
      <div><dt>${L("早餐","BREAKFAST","DESAYUNO")}</dt><dd>${mediaTrigger("meal:breakfast", bcTxt(meals.breakfast), L("切換主圖，查看早餐說明","Change the main image for breakfast details","Cambiar imagen para ver el desayuno"))}</dd></div>
      <div><dt>${L("午餐","LUNCH","ALMUERZO")}</dt><dd>${mediaTrigger("meal:lunch", bcTxt(meals.lunch), L("切換主圖，查看午餐說明","Change the main image for lunch details","Cambiar imagen para ver el almuerzo"))}</dd></div>
      <div><dt>${L("晚餐","DINNER","CENA")}</dt><dd>${mediaTrigger("meal:dinner", bcTxt(meals.dinner), L("切換主圖，查看晚餐說明","Change the main image for dinner details","Cambiar imagen para ver la cena"))}</dd></div>
      <div class="bc-dive-stay"><dt>${L("今晚住宿","TONIGHT'S STAY","ALOJAMIENTO")}</dt><dd>${stay.stars !== 0 ? mediaTrigger("stay", `${bcTaiwanStayRating(stay)}<strong>${bcTxt(stay.name)}</strong><small>${bcTxt(stay.note)}</small>`, L("切換主圖，查看住宿說明","Change the main image for stay details","Cambiar imagen para ver el alojamiento")) : `<span class="bc-dive-no-media"><strong>${bcTxt(stay.name)}</strong><small>${bcTxt(stay.note)}</small></span>`}</dd></div>
    </dl>
    <p class="bc-dive-logistics-note">${L("餐廳、房型與訂位狀態以正式確認為準・設計示意","Restaurants, rooms and reservations remain subject to confirmation · design demo","Restaurantes, habitaciones y reservas sujetos a confirmación · demo")}</p>
  </section>`;
  const showStory = state.mapStoryFocus || state.mapStoryReturning;
  const reveal = showStory ? `<article class="bc-dive-chapter" aria-label="${L(`第 ${day.day} 天影像故事`,`Day ${day.day} image story`,`Historia visual del día ${day.day}`)}" ${state.mapStoryReturning ? 'aria-hidden="true" inert' : ""}>
    <div class="bc-dive-visual">
      <img class="bc-dive-hero" src="${selectedMedia.image || media[0]}" alt="${selectedMedia.kind}・${selectedMedia.title}・${selectedMedia.photoNote}"/>
      <div class="bc-dive-media-caption ${selectedMedia.id !== "day" ? "is-subject" : ""}" aria-live="polite" aria-atomic="true">
        <small data-story-media-kind>${selectedMedia.kind}</small>
        <h2 id="bc-map-story-title" tabindex="-1" data-story-media-title>${selectedMedia.title}</h2>
        <p data-story-media-summary>${selectedMedia.summary}</p>
        <span data-story-media-note>${selectedMedia.photoNote}</span>
        <button type="button" class="bc-dive-media-reset ${selectedMedia.id === "day" ? "is-active" : ""}" data-story-media="day" aria-pressed="${selectedMedia.id === "day"}">${L("回到本日主圖","Back to the day image","Volver a la imagen del día")} ↖</button>
      </div>
    </div>
    <section class="bc-dive-copy">
      <header class="bc-dive-copy-head"><button class="bc-dive-back" data-map-story-overview><span aria-hidden="true">←</span>${L(`${t.days} 日全圖`,`${t.days}-day map`,`Mapa de ${t.days} días`)}</button><span>DAY ${String(day.day).padStart(2,"0")} / ${String(t.days).padStart(2,"0")}</span></header>
      <div class="bc-dive-copy-body">
        <div class="bc-dive-story">${detailMode ? `<section class="bc-dive-day-plan" aria-labelledby="bc-day-plan-title"><header><div><h3 id="bc-day-plan-title">${L("今天怎麼走","TODAY’S PLACES","LUGARES DE HOY")}</h3><small>${L("點選地點，左側主圖會同步切換","Choose a place to update the main image","Elija un lugar para cambiar la imagen")}</small></div><b>${dayStops.length} ${L("個地點","places","lugares")}</b></header><ol>${dayStops.map((stop,index) => `<li data-poi-id="${stop.dataContract?.id || stop.id}" data-visit-status="${stop.dataContract?.visitStatus || "pending"}" data-source-status="${stop.dataContract?.sourceStatus || "pending"}">${mediaTrigger(`stop:${stop.id}`, `<span class="bc-dive-stop-number" aria-hidden="true">${String(index + 1).padStart(2,"0")}</span><span class="bc-dive-stop-copy"><strong>${bcTxt(stop.name)}</strong><span class="bc-dive-stop-summary">${bcTxt(stop.summary)}</span></span>`, L(`切換主圖，查看${bcTxt(stop.name)}`,`Change the main image for ${bcTxt(stop.name)}`,`Cambiar imagen para ver ${bcTxt(stop.name)}`))}</li>`).join("")}</ol></section>` : ""}</div>
        ${logisticsBlock}
      </div>
      <footer class="bc-dive-copy-foot"><nav class="bc-dive-neighbors" aria-label="${L("切換前後日行程","Choose previous or next day","Elegir día anterior o siguiente")}">${neighbor(previousDay,"previous")}${neighbor(nextDay,"next")}</nav></footer>
    </section>
  </article>` : "";
  const overviewRail = state.mapStoryFocus ? "" : bcTaiwanStoryRail(t,"bc-zoom-story-rail");
  const storyHeader = detailMode
    ? bcTaiwanStoryHeader(L(`${t.days} 日互動行程`,`${t.days}-DAY INTERACTIVE ITINERARY`,`ITINERARIO INTERACTIVO DE ${t.days} DÍAS`),bcTxt(t.features.slice(0,2).map(bcTxt).join("・")),L(`點 D1–D${t.days}，查看當日主圖、景點、早午晚餐、飯店與星級；待確認資料都會明標。`,`Choose D1–D${t.days} to see the day image, places, meals, hotel and rating; pending details remain clearly marked.`,`Elija D1–D${t.days} para ver imagen, lugares, comidas y hotel.`))
    : bcTaiwanStoryHeader("DESIGN D · ZOOM-TO-STORY",L("地圖拉近後退場，旅程從一張照片裡展開。","The map moves closer, fades away, and the journey unfolds from one image.","El mapa se acerca, se desvanece y el viaje nace de una sola imagen."),L("點 D1–D8：鏡頭先向該地區推進，黑白地圖淡成背景，再浮出一張主題照片與完整的當日介紹。","Choose D1–D8: the camera moves toward that region, the monochrome map fades back, then one theme image and a clear day story emerge.","Elija D1–D8: la cámara se acerca, el mapa se desvanece y aparecen una imagen temática y un relato claro del día."));
  const overviewGuide = !state.mapStoryFocus && !state.mapStoryReturning ? `<div class="bc-route-guide" aria-label="${L("互動地圖使用說明","Interactive map guide","Guía del mapa interactivo")}"><span>${t.days} DAY ROUTE</span><strong>${L(`點 D1–D${t.days}，看每天怎麼走。`,`Choose D1–D${t.days} to follow each day.`,`Elija D1–D${t.days} para seguir cada día.`)}</strong><small>${L("圖片、景點、餐食與住宿同步","Photos, places, meals and stay update together","Fotos, lugares, comidas y hotel cambian juntos")}</small></div>` : "";
  return `<section id="bc-map-story-variant" class="bc-map-story-lab bc-map-story-d ${detailMode ? "bc-guided-story" : ""}" data-itinerary-id="${itineraryContract?.itineraryId || t.code}" data-itinerary-version="${itineraryContract?.itineraryVersion || ""}" data-schema-version="${itineraryContract?.schemaVersion || ""}" data-day-id="${dayContract?.id || ""}" data-contract-status="${itineraryContract?.validationStatus || "pending"}" tabindex="-1">${storyHeader}${overviewGuide}<div id="bc-zoom-stage" class="bc-zoom-stage ${stageState}" tabindex="-1" role="region" aria-label="${L(`${bcTxt(t.destination)} ${t.days} 日互動行程地圖`,`Interactive ${t.days}-day ${bcTxt(t.destination)} itinerary map`,`Mapa interactivo de ${t.days} días · ${bcTxt(t.destination)}`)}" style="--focus-x:${focusX}%;--focus-y:${focusY}%;--previous-focus-x:${previousFocusX}%;--previous-focus-y:${previousFocusY}%"><div class="bc-zoom-map-frame"><div class="bc-zoom-map-shift"><div class="bc-zoom-map-scale">${bcJourneyRoutePoster(t,"story")}</div></div></div>${reveal}</div>${overviewRail}</section>`;
}

function bcApplyTaiwanStoryMedia(itemId) {
  const t = bcCurrentTour();
  const day = bcDetailSelectedDay(t);
  const media = bcTaiwanDayMedia(t, day.day);
  const choices = bcTaiwanStoryMediaChoices(t, day, media, bcJourneyDayMeals(t, day), bcJourneyDayStay(t, day));
  const selected = choices.find(choice => choice.id === itemId) || choices[0];
  const hero = document.querySelector(".bc-dive-hero");
  const caption = document.querySelector(".bc-dive-media-caption");
  if (!hero) return;
  caption?.classList.toggle("is-subject", selected.id !== "day");

  state.storyItem = selected.id === "day" ? "" : selected.id;
  hero.classList.remove("is-swapping");
  hero.src = selected.image || media[0];
  hero.alt = `${selected.kind}・${selected.title}・${selected.photoNote}`;
  void hero.offsetWidth;
  hero.classList.add("is-swapping");
  caption?.classList.remove("is-swapping");
  document.querySelector("[data-story-media-kind]")?.replaceChildren(selected.kind);
  document.querySelector("[data-story-media-title]")?.replaceChildren(selected.title);
  document.querySelector("[data-story-media-summary]")?.replaceChildren(selected.summary);
  document.querySelector("[data-story-media-note]")?.replaceChildren(selected.photoNote);
  document.querySelector("[data-story-media-foot]")?.replaceChildren(selected.photoNote);
  if (caption) {
    void caption.offsetWidth;
    caption.classList.add("is-swapping");
  }
  document.querySelectorAll("[data-story-media]").forEach(control => {
    const active = control.dataset.storyMedia === selected.id;
    control.classList.toggle("is-active", active);
    control.setAttribute("aria-pressed", String(active));
  });
  updateUrl();
}

function bcTaiwanMapStoryLabSwitcher() {
  if (!state.mapStoryLab || state.mapStoryFocus || state.mapStoryReturning) return "";
  const names = { A:L("地圖 × 圖片編輯跨頁","Map × editorial spread","Mapa × doble página"), B:L("電影式旅程舞台","Cinematic journey stage","Escenario cinematográfico"), C:L("八日照片緞帶","Eight-day photo ribbon","Cinta fotográfica de ocho días"), D:L("拉近・淡化・圖文浮現","Zoom · fade · reveal","Acercar · desvanecer · revelar") };
  return `<div class="bc-map-design-switcher bc-map-story-design-switcher" aria-label="${L("行程地圖互動設計切換器","Itinerary-map design switcher","Selector del diseño interactivo")}"><button data-map-story-step="-1" aria-label="${L("上一個互動設計","Previous interaction design","Diseño anterior")}">←</button><div aria-live="polite"><b>${state.mapStoryDesign} · ${names[state.mapStoryDesign]}</b><small>MAP + STORY LAB · DESIGN DEMO</small></div><button data-map-story-step="1" aria-label="${L("下一個互動設計","Next interaction design","Diseño siguiente")}">→</button></div>`;
}

function bcTaiwanMapStoryLab(t) {
  const variant = state.mapStoryDesign === "B" ? bcTaiwanStoryB(t) : state.mapStoryDesign === "C" ? bcTaiwanStoryC(t) : state.mapStoryDesign === "D" ? bcTaiwanStoryD(t) : bcTaiwanStoryA(t);
  return `${variant}${bcTaiwanMapStoryLabSwitcher()}`;
}

function mapStoryDemoBC() {
  const t = BC_TAIWAN_TOUR;
  return `<main class="bc-map-story-demo-page"><section class="bc-shell bc-map-story-demo-wrap"><div class="bc-map-story-demo-note"><span>${L("獨立比較樣板・D 版已採用為詳情頁主體","STANDALONE COMPARISON · D NOW LEADS THE DETAIL PAGE","COMPARACIÓN · D YA GUÍA LA FICHA")}</span><button data-view="detail">${L("查看新版引導詳情頁","Open guided detail page","Ver ficha guiada")} ↗</button></div>${bcTaiwanMapStoryLab(t)}</section></main>`;
}

function bcMountDetailRouteMap() {
  const target = document.getElementById("bc-detail-region-map");
  if (!target) return;
  bcDestroyRegionalExplorer();
  const t = bcCurrentTour();
  if (typeof jsVectorMap !== "function") {
    target.innerHTML = `<p class="bc-region-map-fallback">${L("互動地圖載入失敗；仍可使用下方日期查看完整行程。","Interactive map unavailable; use the day controls below to view the itinerary.","Mapa no disponible; use los días inferiores para ver el itinerario.")}</p>`;
    return;
  }
  const selected = bcDetailSelectedPoi(t);
  const d = t.route[selected.day - 1];
  const meta = bcRegionMeta(t);
  const stops = bcDetailRouteStops(t);
  const compact = matchMedia("(max-width: 760px)").matches;
  const markers = stops.map(stop => ({ name: stop.markerName, coords: stop.geo }));
  const lines = markers.slice(1).map((marker,index)=>({ from: markers[index].name, to: marker.name }));
  const selectedIndex = Math.max(0, stops.findIndex(stop => stop.id === selected.id));
  const options = {
    selector: "#bc-detail-region-map",
    map: "world",
    backgroundColor: "#000",
    draggable: !compact,
    zoomButtons: !compact,
    zoomOnScroll: false,
    zoomAnimate: true,
    zoomMax: 30,
    bindTouchEvents: false,
    showTooltip: true,
    focusOn: { coords: meta.focus, scale: meta.scale, animate: false },
    regionsSelectable: false,
    selectedRegions: [t.world.region],
    regionStyle: {
      initial: { fill: "#1d1d1d", fillOpacity: 1, stroke: "#000", strokeWidth: .5 },
      hover: { fill: "#303030", fillOpacity: 1, cursor: "grab" },
      selected: { fill: "#f4f4f1", stroke: "#000", strokeWidth: 1 },
      selectedHover: { fill: "#f4f4f1" }
    },
    markers,
    markersSelectable: true,
    markersSelectableOne: true,
    selectedMarkers: [selectedIndex],
    markerStyle: {
      initial: { r: compact ? 6 : 7, fill: "#000", stroke: "#fff", strokeWidth: 3, strokeOpacity: 1 },
      hover: { r: compact ? 8 : 9, fill: "#000", stroke: "#fff", cursor: "pointer" },
      selected: { r: compact ? 8 : 10, fill: "#fff", stroke: "#000", strokeWidth: 4 },
      selectedHover: { fill: "#fff", stroke: "#000" }
    },
    labels: { markers: { render: (marker,index) => {
      const stop = stops[Number(index)];
      const letter = String.fromCharCode(65 + stop.stopIndex);
      return stop.id === selected.id && !compact ? `${String(stop.day).padStart(2,"0")} ${bcTxt(stop.name)}` : `${stop.day}${letter}`;
    } } },
    markerLabelStyle: {
      initial: { fontFamily: '"Noto Sans TC", system-ui, sans-serif', fontSize: compact ? 7 : 8, fontWeight: 800, fill: "#000" },
      hover: { cursor: "pointer" },
      selected: { fill: "#000" },
      selectedHover: { fill: "#000" }
    },
    lines,
    lineStyle: { stroke: "#777", strokeWidth: 2.5, strokeLinecap: "round", curvature: .06 },
    onMarkerClick(event, index) { bcSelectDetailMapStop(index, stops); },
    onRegionTooltipShow(event) { event.preventDefault(); },
    onMarkerTooltipShow(event, tooltip, index) {
      const stop = stops[Number(index)];
      tooltip.text(`DAY ${String(stop.day).padStart(2,"0")} · ${bcTxt(stop.name)} · ${bcTxt(stop.summary)}`);
    }
  };
  bcRegionalMapInstance = new jsVectorMap(options);
  if ("ResizeObserver" in window) {
    bcRegionalMapResizeObserver = new ResizeObserver(()=>{
      try { bcRegionalMapInstance?.updateSize(); } catch (_) {}
    });
    bcRegionalMapResizeObserver.observe(target);
  }
  requestAnimationFrame(()=>{
    target.querySelectorAll(".jvm-marker").forEach((marker,index)=>{
      const stop = stops[index];
      marker.setAttribute("tabindex","0");
      marker.setAttribute("role","button");
      marker.setAttribute("aria-label", `${L("第","Day","Día")} ${stop.day} · ${bcTxt(stop.name)} · ${bcTxt(stop.summary)}`);
      marker.addEventListener("keydown", event=>{
        if (!["Enter"," "].includes(event.key)) return;
        event.preventDefault();
        bcSelectDetailMapStop(index, stops);
      });
    });
  });
}

function bcMapLabSwitcher() {
  if (!state.mapLab) return "";
  const names = { A:L("世界出發板","World departures","Salidas del mundo"), B:L("影像旅行誌","Photo atlas","Atlas fotográfico"), C:L("單線聚焦","Route lens","Enfoque de ruta"), D:L("地區行程地圖","Regional journey map","Mapa regional") };
  return `<div class="bc-map-design-switcher" aria-label="${L("世界地圖設計切換器","World-map design switcher","Selector de diseño del mapa")}"><button data-map-design-step="-1" aria-label="${L("上一個地圖設計","Previous map design","Diseño anterior")}">←</button><div><b>${state.mapDesign} · ${names[state.mapDesign]}</b><small>WORLD MAP LAB · DESIGN DEMO</small></div><button data-map-design-step="1" aria-label="${L("下一個地圖設計","Next map design","Diseño siguiente")}">→</button></div>`;
}

function bcWorldMapSection() {
  const selected = bcWorldSelectedTour();
  const variant = state.mapDesign === "D" ? bcWorldVariantD(selected) : state.mapDesign === "B" ? bcWorldVariantB(selected) : state.mapDesign === "C" ? bcWorldVariantC(selected) : bcWorldVariantA(selected);
  const regional = state.mapDesign === "D";
  return `<section id="bc-world-map" tabindex="-1" class="bc-shell section bc-world-section ${regional?"bc-world-section-regional":""}"><div class="bc-section-head"><div><p class="eyebrow">${regional?"REGIONAL JOURNEY EXPLORER":"WORLD DEPARTURES · FROM NEWARK"}</p><h2>${regional?L("放大一個地區，看清每天在哪裡、要做什麼。","Zoom into one region and see where every day goes.","Amplíe una región y vea dónde va cada día."):L("世界很大，只先標出現在能出發的地方。","A large world—showing only where you can depart now.","Un mundo grande: solo mostramos adónde puede salir ahora.")}</h2></div><p>${regional?L("先選西班牙、英國或日本，再點地圖上的天數；地點、彩色照片、活動、餐食與住宿使用同一份行程資料同步切換。","Choose Spain, Britain or Japan, then select a day on the map. Place, image, activity, meals and stay update from the same itinerary data.","Elija España, Reino Unido o Japón y después un día. Lugar, foto, actividad, comidas y hotel se actualizan juntos."):L("地圖不是裝飾。點選目的地後，彩色旅圖、最近班期、天數、機票、狀態與價格會一起更新。","This map is not decoration. Choose a destination and its image, next date, duration, air, status and price update together.","El mapa no es decoración. Elija un destino y se actualizarán imagen, fecha, duración, vuelo, estado y precio.")}</p></div>${variant}${bcMapLabSwitcher()}</section>`;
}

function bcHomeQuickFacts(t) {
  return `<div class="bc-home-quick-facts"><span><small>${L("天數","DURATION","DURACIÓN")}</small><b>${t.days} ${L("天","days","días")}</b></span><span><small>${L("最近班期","NEXT","PRÓXIMA")}</small><b>${t.nextDate}</b></span><span><small>${L("機票","AIR","VUELO")}</small><b>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</b></span><span><small>${L("狀態","STATUS","ESTADO")}</small><b>${bcTxt(t.status)}</b></span></div>`;
}

function bcHomeCompareRow(t, index) {
  return `<article class="bc-home-compare-row"><button class="bc-home-compare-image" data-tour="${t.id}" aria-label="${bcTxt(t.title)}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/></button><div class="bc-home-compare-name"><small>0${index + 1} · ${bcTxt(t.destination)}</small><h3>${bcTxt(t.title)}</h3><p>${t.features.slice(0,3).map(bcTxt).join(" · ")}</p></div>${bcHomeQuickFacts(t)}<div class="bc-home-compare-price"><small>${L("每人起・設計示意","PER PERSON · DEMO","POR PERSONA · DEMO")}</small><strong>${money(t.price)}</strong><button data-tour="${t.id}">${L("查看旅程","View journey","Ver viaje")} →</button></div></article>`;
}

function bcHomeComparison() {
  return `<section class="bc-shell bc-home-comparison" aria-labelledby="bc-home-compare-title"><header><div><p class="eyebrow">BOOKABLE JOURNEYS · DESIGN DEMO</p><h2 id="bc-home-compare-title">${L("現在能出發的，先放這裡。","Start with what you can book now.","Empiece por lo que puede reservar ahora.")}</h2></div><p>${L("同一順序看目的地、天數、班期、機票、成團狀態與價格；不必打開三個頁面才知道差別。","Destination, duration, date, air, departure status and price always appear in the same order.","Destino, duración, fecha, vuelo, estado y precio aparecen siempre en el mismo orden.")}</p></header><div class="bc-home-compare-list">${BC_TOURS.slice(0,3).map(bcHomeCompareRow).join("")}</div><button class="bc-home-all-journeys" data-view="tours">${L("比較全部團體行程","Compare all journeys","Comparar todos los viajes")} →</button></section>`;
}

function bcHomeServicePriority() {
  const services = [
    ["flights","01",L("機票","Flights","Vuelos"),L("先看行李、轉機與退改，再決定怎麼買。","See baggage, connections and changes before buying.","Vea equipaje, escalas y cambios antes de comprar.")],
    ["china-visa","02",L("中國簽證","China visa","Visado chino"),L("資格、文件、費用與進度一次看清。","Requirements, documents, fees and progress in one place.","Requisitos, documentos, tasas y progreso.")],
    ["custom","03",L("客製旅行","Custom travel","Viaje a medida"),L("回答一題再出現下一題，不丟給你整張表。","One guided question at a time—not a blank form.","Una pregunta guiada cada vez.")]
  ];
  return `<section class="bc-shell bc-home-services" aria-labelledby="bc-home-services-title"><header><p class="eyebrow">TRAVEL DESK</p><h2 id="bc-home-services-title">${L("不是找團？選一件現在要完成的事。","Not booking a tour? Choose one thing to complete.","¿No busca un circuito? Elija una tarea.")}</h2></header><div class="bc-home-service-grid">${services.map(([view,no,title,copy])=>`<button data-view="${view}"><small>${no}</small><span><b>${title}</b><em>${copy}</em></span><i>→</i></button>`).join("")}</div><button class="bc-home-service-more" data-view="services">${L("其餘服務：接送、飯店、支援與更多","Transfers, hotels, support and every other service","Traslados, hoteles, soporte y más")} →</button></section>`;
}

function bcHomeTrust() {
  return `<section class="bc-shell bc-home-trust"><div><p class="eyebrow">PACK&GO · NEWARK, CALIFORNIA</p><h2>${L("看見風景，也看清責任。","See the place—and who is responsible.","Vea el destino y quién responde.")}</h2></div><dl><div><dt>${L("旅行社登記","REGISTRATION","REGISTRO")}</dt><dd>CST #2166984<br>Newark #115594</dd></div><div><dt>${L("中英真人支援","HUMAN SUPPORT","SOPORTE HUMANO")}</dt><dd>+1 (510) 634-2307<br>support@packgoplay.com</dd></div><div><dt>${L("交易原則","COMMERCE RULE","REGLA COMERCIAL")}</dt><dd>${L("付款前揭露總價、另付費用與退改。","Total, later costs and cancellation before payment.","Total, costos posteriores y cancelación antes del pago.")}</dd></div></dl></section>`;
}

function bcHomeHeroA(lead) {
  return `<section class="bc-home-cover"><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><div class="bc-home-cover-copy"><p class="eyebrow">PACK&GO · SEASON 2026</p><h1>${L("先喜歡上一個地方，<br>再決定怎麼去。","Fall for a place.<br>Then decide how to go.","Enamórese de un lugar.<br>Después decida cómo ir.")}</h1><p>${L("主打旅程的日期、天數、餘位、機票與價格，就在風景旁邊。","Dates, duration, seats, air and price sit right beside the view.","Fecha, duración, plazas, vuelo y precio junto a la imagen.")}</p></div><aside><small>${lead.code} · ${lead.nextDate}</small><h2>${bcTxt(lead.title)}</h2>${bcHomeQuickFacts(lead)}<div><strong>${money(lead.price)}</strong><span>${L("每人起・設計示意","per person · demo","por persona · demo")}</span></div><button data-tour="${lead.id}">${L("走進這趟旅程","Enter this journey","Entrar en este viaje")} →</button></aside></section>`;
}

function bcHomeHeroB(lead) {
  return `<section class="bc-home-desk"><div class="bc-home-desk-copy"><p class="eyebrow">PACK&GO · CALIFORNIA</p><h1>${L("先找到想去的地方，<br>再看哪一團適合你。","Find the place first.<br>Then choose the right journey.","Encuentre primero el lugar.<br>Después elija el viaje.")}</h1><p>${L("彩色旅圖先讓你看見目的地；路線、日期、總價與責任，再整理成可以自己決定的資訊。","See the destination first; then compare route, date, total and responsibility clearly.","Vea primero el destino y después compare ruta, fecha y total.")}</p><div><button class="bc-home-primary-cta" data-view="tour-finder">${L("進入專業找團引導","Open guided journey finder","Abrir buscador guiado")} →</button><button class="bc-home-text-cta" data-view="tours">${L("直接比較全部行程","Compare every journey","Comparar todos los viajes")}</button></div></div><figure><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><figcaption><small>${L("本季主打","FEATURED NOW","DESTACADO")} · ${lead.code}</small><b>${bcTxt(lead.title)}</b></figcaption></figure><aside><div><small>${lead.nextDate} · ${lead.days} ${L("天","days","días")}</small><b>${bcTxt(lead.status)}</b></div><div><small>${lead.air?L("含國際機票","AIR INCLUDED","VUELO INCLUIDO"):L("機票另計","AIR SEPARATE","VUELO APARTE")}</small><strong>${money(lead.price)}</strong><span>${L("每人起・設計示意","per person · demo","por persona · demo")}</span></div><button data-tour="${lead.id}">${L("查看完整旅程","View full journey","Ver viaje completo")} →</button></aside></section>`;
}

function bcHomeHeroC() {
  return `<section class="bc-home-market"><header><p class="eyebrow">PACK&GO · DEPARTURE EDIT</p><h1>${L("三趟旅程，<br>先選你想看的風景。","Three journeys.<br>Choose the view first.","Tres viajes.<br>Elija primero la vista.")}</h1><p>${L("不先解釋品牌；先把目前可以比較的商品、價格與班期放到眼前。","No brand speech first—just the journeys, prices and dates available to compare.","Primero los viajes, precios y fechas; después la marca.")}</p></header><div class="bc-home-market-grid">${BC_TOURS.slice(0,3).map((t,index)=>`<article class="${index===0?"is-lead":""}"><button data-tour="${t.id}"><img src="${t.image}" alt="${bcTxt(t.title)}" fetchpriority="${index===0?"high":"auto"}"/><span><small>0${index+1} · ${bcTxt(t.destination)}</small><b>${bcTxt(t.title)}</b><em>${t.days} ${L("天","days","días")} · ${t.nextDate.slice(5)} · ${money(t.price)} ${L("起","from","desde")}</em></span></button></article>`).join("")}</div></section>`;
}

function bcHomeHeroD(lead) {
  return `<section class="bc-home-focus"><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><div class="bc-home-focus-copy"><p class="eyebrow">PACK&GO</p><h1>${L("馬德里","Madrid","Madrid")}</h1><p>${bcTxt(lead.title)}</p><div class="bc-home-focus-meta" data-keep-punctuation><span>${lead.days} ${L("天","days","días")}</span><span>${lead.nextDate}</span><strong>${money(lead.price)} ${L("起","from","desde")}</strong></div><div class="bc-home-focus-actions"><button data-tour="${lead.id}">${L("看這趟旅程","See this journey","Ver este viaje")}</button><button data-view="tour-finder">${L("找適合我的團","Find my journey","Encontrar mi viaje")}</button></div></div></section>`;
}

function bcHomeMinimalJourneys() {
  return `<section class="bc-home-minimal" aria-labelledby="bc-home-minimal-title"><header><p class="eyebrow">SEASON 2026</p><h2 id="bc-home-minimal-title">${L("本季三選","Three journeys this season","Tres viajes esta temporada")}</h2><button data-view="tours">${L("看全部行程","See all journeys","Ver todos los viajes")}</button></header><div>${BC_TOURS.slice(0,3).map(t=>`<article><button data-tour="${t.id}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/><span><small>${bcTxt(t.destination)}</small><b>${bcTxt(t.title)}</b><em data-keep-punctuation>${t.days} ${L("天","days","días")} ${t.nextDate.slice(5)} ${money(t.price)} ${L("起","from","desde")}</em></span></button></article>`).join("")}</div></section>`;
}

function bcHomeHeroE(lead) {
  return `<section class="bc-home-editorial"><header class="bc-home-editorial-intro"><p class="eyebrow">PACK&GO TRAVEL EDITION</p><h1>${L("<span>先看世界</span><span>再決定下一站</span>","<span>See the world</span><span>Choose what is next</span>","<span>Vea el mundo</span><span>Elija lo próximo</span>")}</h1><aside class="bc-home-editorial-guide"><small>${L("還不知道去哪裡","NOT SURE WHERE TO GO","AÚN NO SABE ADÓNDE IR")}</small><p>${L("回答三題<br>從風景 價位和天數開始","Answer three questions<br>Begin with scenery price range and time","Responda tres preguntas<br>Empiece por paisaje precio y tiempo")}</p><button data-view="tour-finder">${L("開始探索","Start exploring","Empezar a explorar")}</button><button class="bc-home-editorial-all" data-view="tours">${L("直接看全部行程","View every journey","Ver todos los viajes")}</button></aside></header><figure class="bc-home-editorial-feature"><div class="bc-home-editorial-image"><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><span>${bcTxt(lead.destination)}</span></div><figcaption><div class="bc-home-editorial-product"><small>${L("本季主打","FEATURED THIS SEASON","DESTACADO DE TEMPORADA")}</small><h2>${bcTxt(lead.title)}</h2></div><dl data-keep-punctuation><div><dt>${L("出發","DEPARTURE","SALIDA")}</dt><dd>${lead.nextDate}</dd></div><div><dt>${L("天數","DURATION","DURACIÓN")}</dt><dd>${lead.days} ${L("天","days","días")}</dd></div><div><dt>${L("狀態","STATUS","ESTADO")}</dt><dd>${bcTxt(lead.status)}</dd></div></dl><div class="bc-home-editorial-price" data-keep-punctuation><small>${L("每人起","PER PERSON","POR PERSONA")}</small><strong>${money(lead.price)}</strong></div><button data-tour="${lead.id}">${L("查看完整旅程","View full journey","Ver viaje completo")}</button></figcaption></figure></section>`;
}

function bcHomeModernJourneys() {
  return `<section class="bc-home-journey-index" aria-labelledby="bc-home-journey-index-title"><header><div><p class="eyebrow">CURATED JOURNEYS</p><h2 id="bc-home-journey-index-title">${L("本季旅程","Journeys this season","Viajes de temporada")}</h2></div><p>${L("圖片先吸引<br>日期 天數和價格緊接在後","Images lead<br>Dates duration and price follow","Las imágenes primero<br>Después fechas duración y precio")}</p><button data-view="tours">${L("比較全部行程","Compare all journeys","Comparar todos los viajes")}</button></header><div class="bc-home-journey-list">${BC_TOURS.slice(0,3).map((t,index)=>`<article><span class="bc-home-journey-no">0${index+1}</span><button class="bc-home-journey-image" data-tour="${t.id}" aria-label="${bcTxt(t.title)}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="${index===0?"eager":"lazy"}"/></button><div class="bc-home-journey-copy"><small>${bcTxt(t.destination)}</small><h3>${bcTxt(t.title)}</h3><p>${t.features.slice(0,2).map(bcTxt).join("　")}</p></div><div class="bc-home-journey-meta" data-keep-punctuation><span>${t.nextDate}</span><span>${t.days} ${L("天","days","días")}</span><b>${bcTxt(t.status)}</b></div><div class="bc-home-journey-price" data-keep-punctuation><strong>${money(t.price)}</strong><small>${L("每人起","per person","por persona")}</small></div><button class="bc-home-journey-open" data-tour="${t.id}">${L("查看旅程","View journey","Ver viaje")}</button></article>`).join("")}</div></section>`;
}

/* Three continuous-layout homepage prototypes on the existing home route.
   Switch with homeDesign=A-C. These are throwaway design explorations. */
function bcWebTripFacts(t) {
  return `<dl class="bc-web-trip-facts" data-keep-punctuation><div><dt>${L("出發","DEPARTURE","SALIDA")}</dt><dd>${t.nextDate}</dd></div><div><dt>${L("天數","DURATION","DURACIÓN")}</dt><dd>${t.days} ${L("天","days","días")}</dd></div><div><dt>${L("機票","AIR","VUELO")}</dt><dd>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</dd></div></dl>`;
}

function bcWebMiniTrip(t, index) {
  return `<article class="bc-web-mini-trip"><button class="bc-web-mini-image" data-tour="${t.id}" aria-label="${bcTxt(t.title)}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="${index===0?"eager":"lazy"}"/></button><div><small>0${index+1}　${bcTxt(t.destination)}</small><b>${bcTxt(t.title)}</b><span data-keep-punctuation>${t.days} ${L("天","days","días")}　${t.nextDate.slice(5)}　${money(t.price)} ${L("起","from","desde")}</span></div><button class="bc-web-mini-open" data-tour="${t.id}" aria-label="${L("查看旅程","View journey","Ver viaje")}">${L("查看","View","Ver")}</button></article>`;
}

/* Three scalable catalog-entry studies inside the approved A homepage.
   Imported-tour counts remain layout samples until the catalog feed is connected. */
function bcScaleCatalogPreset(key, no, title, copy, count) {
  return `<button data-catalog-preset="${key}"><em>${no}</em><span><b>${title}</b><small>${copy}</small></span><strong data-keep-punctuation>${count}</strong><i aria-hidden="true">→</i></button>`;
}

function bcScaleCatalogFeature(t) {
  return `<article class="bc-scale-feature"><button data-tour="${t.id}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/><span><small>${L("本週編輯精選","EDITOR'S SELECTION","SELECCIÓN EDITORIAL")}</small><b>${bcTxt(t.title)}</b><em data-keep-punctuation>${t.nextDate}　${t.days} ${L("天","days","días")}　${money(t.price)} ${L("起","from","desde")}</em></span></button></article>`;
}

function bcScaleCatalogA() {
  const lead = BC_TOURS[1];
  return `<section id="bc-scale-catalog" class="bc-scale-catalog bc-scale-catalog-a" tabindex="-1"><header><div><p>${L("旅程資料庫　導入規模示意","JOURNEY LIBRARY　SCALE DEMO","BIBLIOTECA DE VIAJES　DEMO")}</p><h2><strong data-keep-punctuation>3,000+</strong><span>${L("條路線<br>不必全部看完","journeys<br>you do not need to see them all","viajes<br>sin tener que verlos todos")}</span></h2></div><p>${L("先選一個方向<br>再讓目的地 月份 天數與價位逐步縮小範圍","Choose one direction first<br>Then narrow by destination month duration and price range","Elija una dirección<br>Después reduzca por destino mes duración y precio")}</p></header><div class="bc-scale-a-stage"><nav aria-label="${L("快速縮小旅程範圍","Quick journey filters","Filtros rápidos")}">${bcScaleCatalogPreset("europe","01",L("從歐洲開始","Begin with Europe","Empezar por Europa"),L("城市 歷史與長程文化旅行","Cities history and cultural journeys","Ciudades historia y cultura"),"1,240")}${bcScaleCatalogPreset("asia","02",L("從亞洲開始","Begin with Asia","Empezar por Asia"),L("日本與亞洲區域精選","Japan and selected Asian regions","Japón y regiones de Asia"),"1,120")}${bcScaleCatalogPreset("short","03",L("先看短假期","Start with shorter journeys","Viajes más cortos"),L("五天左右即可出發","Around five days","Alrededor de cinco días"),"420")}${bcScaleCatalogPreset("value","04",L("先選定價位","Choose a price range","Elegir un precio"),L("每人兩千美元以內","Under two thousand dollars per person","Menos de dos mil dólares"),"220")}</nav><div class="bc-scale-a-edit">${bcScaleCatalogFeature(lead)}<div class="bc-scale-a-next">${BC_TOURS.filter(t=>t.id!==lead.id).slice(0,2).map((t,index)=>`<button data-tour="${t.id}"><img src="${t.image}" alt="" loading="lazy"/><span><small>0${index+2}　${bcTxt(t.destination)}</small><b>${bcTxt(t.title)}</b></span><strong data-keep-punctuation>${money(t.price)} ${L("起","from","desde")}</strong><i>→</i></button>`).join("")}</div></div></div><footer><p>${L("數量為未來導入規模的設計示意　正式版依即時商品資料更新","Counts illustrate the future import scale　Production will use live catalog data","Las cantidades ilustran la escala futura　La versión final usará datos reales")}</p><button data-catalog-preset="all">${L("進入完整旅程目錄","Open the complete journey library","Abrir toda la biblioteca")} →</button></footer></section>`;
}

function bcScaleCatalogB() {
  const shortcut = (key,no,title,copy) => `<button data-catalog-preset="${key}"><em>${no}</em><span><b>${title}</b><small>${copy}</small></span><i aria-hidden="true">→</i></button>`;
  return `<section id="bc-scale-catalog" class="bc-scale-catalog bc-scale-catalog-b" tabindex="-1"><header><p>${L("PACK&GO　本季旅選","PACK&GO　SEASONAL EDIT","PACK&GO　SELECCIÓN")}</p><h2>${L("風景先行","Begin with the view","Primero el paisaje")}</h2><span>${L("讓下一站先映入眼前","Let the next destination come into view","Deje que aparezca el próximo destino")}</span><button data-catalog-preset="all">${L("查看全部旅程","View every journey","Ver todos los viajes")}</button></header><div class="bc-scale-b-film">${BC_TOURS.slice(0,3).map((t,index)=>`<button data-tour="${t.id}" class="${index===0?"is-lead":""}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/><span><small>0${index+1}　${bcTxt(t.destination)}</small><b>${bcTxt(t.title)}</b><em data-keep-punctuation>${t.nextDate}　${t.days} ${L("天","days","días")}　${money(t.price)} ${L("起","from","desde")}</em></span></button>`).join("")}</div><nav aria-label="${L("快速探索旅程","Quick journey discovery","Explorar viajes")}">${shortcut("europe","01",L("歐洲漫遊","Europe in depth","Europa a fondo"),L("古城　藝術與文化風景","Old cities　art　culture","Ciudades　arte　cultura"))}${shortcut("asia","02",L("亞洲風景","Views of Asia","Paisajes de Asia"),L("山海　古都與在地日常","Landscapes　heritage　local life","Paisajes　historia　vida local"))}${shortcut("short","03",L("五日輕旅","Five day journeys","Viajes de cinco días"),L("短假期也能完整出發","A complete journey in a shorter break","Un viaje completo en pocos días"))}</nav></section>`;
}

function bcScaleCatalogC() {
  const lead = BC_TOURS[2];
  return `<section id="bc-scale-catalog" class="bc-scale-catalog bc-scale-catalog-c" tabindex="-1"><div class="bc-scale-c-directory"><header><p>${L("目的地索引　導入規模示意","DESTINATION INDEX　SCALE DEMO","ÍNDICE DE DESTINOS　DEMO")}</p><h2>${L("<span>像翻旅行雜誌</span><span>一樣進入</span><span>三千條路線</span>","<span>Enter three thousand journeys</span><span>like opening a travel journal</span>","<span>Entre en tres mil viajes</span><span>como en una revista</span>")}</h2></header><nav>${bcScaleCatalogPreset("europe","01",L("歐洲","Europe","Europa"),L("西班牙 英國與更多地區","Spain United Kingdom and more","España Reino Unido y más"),"1,240")}${bcScaleCatalogPreset("asia","02",L("亞洲","Asia","Asia"),L("日本與更多地區","Japan and more regions","Japón y más regiones"),"1,120")}${bcScaleCatalogPreset("short","03",L("依天數閱讀","Browse by duration","Ver por duración"),L("先從五天左右開始","Begin around five days","Empezar por cinco días"),"420")}${bcScaleCatalogPreset("value","04",L("依價位閱讀","Browse by price range","Ver por precio"),L("先看兩千美元以內","Begin under two thousand dollars","Menos de dos mil dólares"),"220")}</nav><button class="bc-scale-c-all" data-catalog-preset="all">${L("查看全部目的地與班期","View all destinations and dates","Ver destinos y fechas")} →</button></div><figure><img src="${lead.image}" alt="${bcTxt(lead.title)}" loading="lazy"/><figcaption><small>${L("本季影像索引","SEASONAL IMAGE INDEX","ÍNDICE DE TEMPORADA")}</small><h3>${bcTxt(lead.destination)}</h3><p>${bcTxt(lead.title)}</p><button data-tour="${lead.id}">${L("打開這趟旅程","Open this journey","Abrir este viaje")} →</button></figcaption></figure></section>`;
}

function bcScaleCatalogLabSwitcher() {
  if (!state.catalogLab) return "";
  const names = {A:L("編輯式目錄","Editorial directory","Directorio editorial"),B:L("電影式畫廊","Cinematic gallery","Galería cinematográfica"),C:L("目的地索引","Destination index","Índice de destinos")};
  return `<div class="bc-catalog-design-switcher" aria-label="${L("旅程目錄設計切換器","Journey library design switcher","Selector de biblioteca")}"><button data-catalog-design-step="-1">←</button><div><b>${state.catalogDesign}　${names[state.catalogDesign]}</b><small>3,000+ JOURNEY LAB　DESIGN DEMO</small></div><button data-catalog-design-step="1">→</button></div>`;
}

function bcHomeScaleCatalog() {
  return ({A:bcScaleCatalogA,B:bcScaleCatalogB,C:bcScaleCatalogC}[state.catalogDesign] || bcScaleCatalogA)() + bcScaleCatalogLabSwitcher();
}

function bcHomeCtaButton() {
  if (!state.ctaLab) return `<button data-view="tour-finder"><span>${L("準備出發","Ready to depart","Listo para partir")}</span></button>`;
  const variants = {
    A:L("開始探索","Start exploring","Empezar a explorar"),
    B:L("去看世界","See the world","Ver el mundo"),
    C:L("找到嚮往","Find your calling","Encontrar su rumbo"),
    D:L("看見遠方","See beyond","Mirar más allá")
  };
  const key = variants[state.ctaDesign] ? state.ctaDesign : "A";
  const label = variants[key];
  const word = state.language === "zh"
    ? [...label].map((character,index)=>`<span style="--bc-cta-letter:${index}">${character}</span>`).join("")
    : `<span>${label}</span>`;
  return `<button class="bc-cta-prototype bc-cta-${key.toLowerCase()}" data-view="tour-finder" aria-label="${label}"><span class="bc-cta-label">${word}</span></button>`;
}

function bcCtaLabSwitcher() {
  if (!state.ctaLab || state.variant !== "BC" || state.view !== "home") return "";
  const names = {
    A:L("開始探索　黑幕推進","Start exploring　Curtain sweep","Empezar　Telón"),
    B:L("去看世界　鏡頭聚焦","See the world　Aperture","Ver el mundo　Apertura"),
    C:L("找到嚮往　雙幕合場","Find your calling　Split screen","Encontrar rumbo　Doble telón"),
    D:L("看見遠方　旅圖揭露","See beyond　Image reveal","Mirar más allá　Revelado")
  };
  return `<div id="bc-cta-lab-switcher" class="bc-cta-lab-switcher" tabindex="-1" aria-label="${L("首頁主行動設計切換器","Homepage CTA design switcher","Selector del CTA")}"><button data-cta-design-step="-1" aria-label="${L("上一個主行動設計","Previous CTA design","Diseño anterior")}">←</button><div><b>${state.ctaDesign}　${names[state.ctaDesign]}</b><small>CTA MOTION LAB　DESIGN DEMO</small></div><button data-cta-design-step="1" aria-label="${L("下一個主行動設計","Next CTA design","Diseño siguiente")}">→</button></div>`;
}

function bcHomeVersionALegacy(lead) {
  return `<section class="bc-cohesive-a"><div class="bc-cohesive-a-stage"><figure><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/></figure><div class="bc-cohesive-a-copy"><p>PACK&GO JOURNEY 01</p><h1>${L("<span>讓嚮往先有畫面</span><span>再從容決定出發</span>","<span>Give the journey a picture</span><span>Then choose when to go</span>","<span>Dé forma a lo que desea</span><span>Después decida cuándo partir</span>")}</h1><p class="bc-cohesive-a-lead">${L("先看見想去的地方<br>再確認班期 天數與完整價格","See where you want to go first<br>Then review dates duration and the full price","Primero vea adónde quiere ir<br>Después revise fechas duración y precio total")}</p><div class="bc-cohesive-a-actions">${bcHomeCtaButton()}</div></div><div class="bc-cohesive-a-trip"><div class="bc-cohesive-a-identity"><small>${L("本季主打","FEATURED THIS SEASON","DESTACADO DE TEMPORADA")}　${lead.code}　${bcTxt(lead.status)}</small><h2>${bcTxt(lead.title)}</h2></div>${bcWebTripFacts(lead)}<div class="bc-cohesive-a-price" data-keep-punctuation><small>${L("每人起","PER PERSON","POR PERSONA")}</small><strong>${money(lead.price)}</strong></div><button data-tour="${lead.id}">${L("查看完整旅程","View the full journey","Ver el viaje completo")}</button></div></div><div class="bc-cohesive-a-discovery"><section class="bc-cohesive-a-guide" aria-labelledby="bc-cohesive-guide-title"><span>${L("尚未決定下一站","DESTINATION UNDECIDED","DESTINO POR DECIDIR")}</span><h2 id="bc-cohesive-guide-title">${L("從一張喜歡的風景開始","Begin with a view you love","Empiece por un paisaje que le guste")}</h2><p>${L("選擇地區 價位與旅程長度<br>三題後替你收斂成真正值得比較的方向","Choose region price range and duration<br>Then keep only the directions worth comparing","Elija región precio y duración<br>Después compare solo las opciones relevantes")}</p><button data-view="tour-finder">${L("尋找方向","Find my direction","Encontrar dirección")}</button></section><header class="bc-cohesive-a-index-head"><div><span>${L("本季精選","CURATED THIS SEASON","SELECCIÓN DE TEMPORADA")}</span><h2>${L("三條可以開始比較的路線","Three routes ready to compare","Tres rutas para comparar")}</h2></div><button data-view="tours">${L("查看全部班期與價格","View all dates and prices","Ver fechas y precios")}</button></header><nav class="bc-cohesive-a-index" aria-label="${L("本季旅程","Season journeys","Viajes de temporada")}">${BC_TOURS.slice(0,3).map((t,index)=>`<button data-tour="${t.id}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="${index===0?"eager":"lazy"}"/><span class="bc-cohesive-a-index-no">0${index+1}</span><span class="bc-cohesive-a-journey"><small>${bcTxt(t.destination)}</small><b>${bcTxt(t.title)}</b><em data-keep-punctuation>${t.days} ${L("天","days","días")}　${t.nextDate.slice(5)}　${money(t.price)} ${L("起","from","desde")}</em></span></button>`).join("")}</nav></div></section>`;
}

function bcHomeVersionA(lead) {
  const legacy = bcHomeVersionALegacy(lead);
  const oldIndexStart = legacy.indexOf('<header class="bc-cohesive-a-index-head">');
  if (oldIndexStart < 0) return legacy;
  return `${legacy.slice(0,oldIndexStart)}${bcHomeScaleCatalog()}</div></section>`;
}

function bcHomeVersionB(lead) {
  return `<section class="bc-cohesive-b"><aside><p>PACK&GO TRAVEL EDIT</p><h1>${L("把世界<br>看成下一段生活","See the world<br>as the next chapter","Vea el mundo<br>como el próximo capítulo")}</h1><span>${L("我們先用旅圖讓你找到感覺<br>再把班期與價格說清楚","Find the feeling through travel images<br>Then see dates and prices clearly","Encuentre primero la sensación<br>Después vea fechas y precios")}</span><button data-view="tour-finder">${L("沒有方向 從三題開始","No direction  Start with three questions","Sin dirección  Empiece con tres preguntas")}</button><button data-view="tours">${L("直接看所有旅程","View every journey","Ver todos los viajes")}</button><small>${L("設計示意 所有價格與班期需正式確認","Design demo  Dates and prices require confirmation","Demo  Fechas y precios por confirmar")}</small></aside><div class="bc-cohesive-b-field"><figure><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><figcaption><span>${bcTxt(lead.destination)}</span><b>${bcTxt(lead.title)}</b></figcaption></figure><div class="bc-cohesive-b-list">${BC_TOURS.slice(0,3).map((t,index)=>`<button data-tour="${t.id}"><span>0${index+1}</span><b>${bcTxt(t.title)}</b><small data-keep-punctuation>${t.days} ${L("天","days","días")}　${t.nextDate}　${bcTxt(t.status)}</small><strong data-keep-punctuation>${money(t.price)}</strong></button>`).join("")}</div></div></section>`;
}

function bcHomeVersionC() {
  const lead = BC_TOURS[0];
  return `<section class="bc-cohesive-c"><header><div><p>PACK&GO JOURNEYS 2026</p><h1>${L("三趟旅程<br>從一張照片開始","Three journeys<br>Begin with one image","Tres viajes<br>Empiece con una imagen")}</h1></div><nav><button data-view="tour-finder">${L("幫我找到方向","Help me find a direction","Ayúdeme a elegir")}</button><button data-view="tours">${L("所有班期與價格","All dates and prices","Todas las fechas y precios")}</button></nav></header><div class="bc-cohesive-c-stage"><figure><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><figcaption>${bcTxt(lead.destination)}</figcaption></figure><aside><p>01　${lead.code}</p><h2>${bcTxt(lead.title)}</h2><span>${lead.features.slice(0,3).map(bcTxt).join("　")}</span>${bcWebTripFacts(lead)}<div class="bc-cohesive-c-price" data-keep-punctuation><small>${bcTxt(lead.status)}</small><strong>${money(lead.price)}</strong><button data-tour="${lead.id}">${L("打開旅程","Open journey","Abrir viaje")}</button></div><div class="bc-cohesive-c-other">${BC_TOURS.slice(1,3).map((t,index)=>`<button data-tour="${t.id}"><span>0${index+2}</span><b>${bcTxt(t.title)}</b><small data-keep-punctuation>${t.days} ${L("天","days","días")}　${money(t.price)} ${L("起","from","desde")}</small></button>`).join("")}</div></aside></div><footer><b>${L("還不知道哪一趟適合","Still unsure which journey fits","Aún no sabe cuál elegir")}</b><span>${L("回答地區 價位與天數 三題後再比較","Answer region price range and duration before comparing","Responda región precio y duración")}</span><button data-view="tour-finder">${L("開始引導","Start guidance","Empezar")}</button></footer></section>`;
}

function bcHomeVersionD(lead) {
  return `<section class="bc-web-d"><header><div><p class="eyebrow">DESTINATION NAVIGATOR</p><h1>${L("先選目的地<br>再打開完整旅程","Choose a destination<br>Then open the full journey","Elija un destino<br>Después abra el viaje")}</h1></div><button data-view="tour-finder">${L("還沒決定 讓我引導","Not decided  Guide me","No estoy seguro  Guíeme")}</button></header><div class="bc-web-d-stage"><nav aria-label="${L("可選目的地","Available destinations","Destinos disponibles")}">${BC_TOURS.slice(0,3).map((t,index)=>`<button class="${index===0?"active":""}" data-tour="${t.id}"><span>0${index+1}</span><b>${bcTxt(t.destination)}</b><small data-keep-punctuation>${t.days} ${L("天","days","días")}　${money(t.price)} ${L("起","from","desde")}</small></button>`).join("")}</nav><figure><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/><figcaption>${L("彩色旅圖先確認你想看的風景","Use the image to choose the view first","Use la imagen para elegir el paisaje")}</figcaption></figure><aside><small>${L("目前主打","CURRENT FEATURE","DESTACADO")}</small><h2>${bcTxt(lead.title)}</h2><p>${lead.features.slice(0,3).map(bcTxt).join("　")}</p>${bcWebTripFacts(lead)}<div class="bc-web-d-price" data-keep-punctuation><span>${bcTxt(lead.status)}</span><strong>${money(lead.price)}</strong><small>${L("每人起","per person","por persona")}</small></div><button data-tour="${lead.id}">${L("查看完整旅程","View full journey","Ver viaje completo")}</button></aside></div></section>`;
}

function bcHomeVersionE(lead) {
  const second = BC_TOURS[1];
  const third = BC_TOURS[2];
  return `<section class="bc-web-e"><header><div><p class="eyebrow">PACK&GO TRAVEL EDIT</p><h1>${L("本週精選旅程","Journeys selected this week","Viajes seleccionados esta semana")}</h1></div><div><button data-view="tour-finder">${L("不知道去哪裡","Not sure where to go","No sabe adónde ir")}</button><button data-view="tours">${L("查看全部行程","View all journeys","Ver todos los viajes")}</button></div></header><div class="bc-web-e-stage"><div class="bc-web-e-gallery"><button class="bc-web-e-main" data-tour="${lead.id}"><img src="${lead.image}" alt="${bcTxt(lead.title)}" fetchpriority="high"/></button><button data-tour="${second.id}"><img src="${second.image}" alt="${bcTxt(second.title)}" loading="lazy"/><span>${bcTxt(second.destination)}</span></button><button data-tour="${third.id}"><img src="${third.image}" alt="${bcTxt(third.title)}" loading="lazy"/><span>${bcTxt(third.destination)}</span></button></div><aside><small>${L("編輯首選","EDITOR PICK","SELECCIÓN")}</small><h2>${bcTxt(lead.title)}</h2><p>${L("五天看見西班牙歷史城市<br>小團節奏與中文司導一次說清楚","Five days through Spain heritage cities<br>with a small group and Chinese speaking guide","Cinco días por ciudades históricas<br>con grupo pequeño y guía en chino")}</p>${bcWebTripFacts(lead)}<div class="bc-web-e-status" data-keep-punctuation><span>${bcTxt(lead.status)}</span><strong>${money(lead.price)}</strong><small>${L("每人起","per person","por persona")}</small></div><button class="bc-web-primary" data-tour="${lead.id}">${L("查看完整旅程","View full journey","Ver viaje completo")}</button><button class="bc-web-secondary" data-view="tour-finder">${L("改找其他旅程","Find another journey","Buscar otro viaje")}</button></aside></div></section>`;
}

function bcWelcomeGuide() {
  if (!state.welcomeOpen || state.variant !== "BC" || state.view !== "home") return "";
  const lead = BC_TOURS[0];
  const choices = [
    ["tour-finder","01",L("我想找一趟旅程","I want to find a journey","Quiero encontrar un viaje"),L("從地區 價位與天數開始推薦現成行程","Start with region price range and duration","Empiece por región precio y duración")],
    ["custom","02",L("我已經有旅行想法","I already have a travel idea","Ya tengo una idea de viaje"),L("規劃私人旅行或沿用現有路線包團","Plan a private trip or private departure","Planifique un viaje privado")],
    ["services","03",L("我只需要旅行服務","I only need a travel service","Solo necesito un servicio"),L("機票 中國簽證 接送與飯店從這裡開始","Flights China visa transfers and hotels","Vuelos visado traslados y hoteles")],
    ["login","04",L("我已經有訂位或訂單","I already have a booking","Ya tengo una reserva"),L("登入 DEMO MEMBER 查看進度 付款與文件","Open DEMO MEMBER for progress payments and documents","Abra DEMO MEMBER para ver el progreso")]
  ];
  return `<div class="bc-welcome-backdrop" aria-hidden="true"></div><section class="bc-welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="bc-welcome-title"><figure class="bc-welcome-visual"><img src="${lead.image}" alt="${bcTxt(lead.destination)}"/><figcaption><p>PACK&GO FIRST VISIT</p><h2>${L("第一次來<br>不必先懂全部","First time here<br>You do not need to learn everything","Primera visita<br>No necesita entenderlo todo")}</h2><span>${L("選一件現在要完成的事<br>我們帶你到正確入口","Choose one thing to do now<br>We will take you to the right place","Elija una tarea<br>Le llevaremos al lugar correcto")}</span></figcaption></figure><div class="bc-welcome-content"><header><div><p class="eyebrow">PACK&GO TRAVEL CONCIERGE</p><h1 id="bc-welcome-title" tabindex="-1">${L("今天想先完成什麼","What would you like to do first","Qué desea hacer primero")}</h1></div><button data-welcome-close>${L("直接瀏覽網站","Browse the website","Ver el sitio")}</button></header><p class="bc-welcome-intro">${L("不用先研究導覽列<br>選一個最接近的方向就好","Do not study the navigation first<br>Choose the closest direction","No estudie la navegación<br>Elija la opción más cercana")}</p><div class="bc-welcome-choices">${choices.map(([view,no,title,copy])=>`<button data-welcome-view="${view}"><span>${no}</span><b>${title}<small>${copy}</small></b><i>${L("開始","Open","Abrir")}</i></button>`).join("")}</div><footer>${L("設計示意 不會送出資料 建立訂位或付款","Design demo  Nothing is submitted booked or charged","Demo de diseño  No se envían datos ni pagos")}</footer></div></section>`;
}

function bcHomeLabSwitcher() {
  if (!state.homeLab) return "";
  const names = {A:L("沉浸旅程","Immersive journey","Viaje inmersivo"),B:L("黑色編輯場","Black editorial field","Campo editorial negro"),C:L("旅程索引","Journey index","Índice de viajes")};
  return `<div class="bc-home-design-switcher" aria-label="${L("首頁設計切換器","Homepage design switcher","Selector de inicio")}"><button data-home-design-step="-1" aria-label="${L("上一個首頁設計","Previous homepage design","Diseño anterior")}">←</button><div><b>${state.homeDesign} · ${names[state.homeDesign]}</b><small>HOME REDESIGN LAB · DESIGN DEMO</small></div><button data-home-design-step="1" aria-label="${L("下一個首頁設計","Next homepage design","Diseño siguiente")}">→</button></div>`;
}

function bcTourFinderRank(answers) {
  return BC_TOURS.map(t => {
    let score = 0;
    if (answers.region === "europe" && ["ES","GB"].includes(t.world?.region)) score += 6;
    if (["asia","east-asia"].includes(answers.region) && t.world?.region === "JP") score += 6;
    if (answers.priority === "value") score += Math.max(0, 4 - t.price / 900);
    if (answers.priority === "air" && t.air) score += 5;
    if (answers.priority === "small" && t.id === 2) score += 5;
    if (answers.pace === "short" && t.days <= 5) score += 4;
    if (answers.pace === "immersive" && t.days >= 6) score += 4;
    return {t,score};
  }).sort((a,b)=>b.score-a.score || a.t.price-b.t.price).map(x=>x.t);
}

function bcTourFinderAnswerSummary(answers) {
  const labels = {
    land:L("陸上旅程","Land journey","Viaje terrestre"),
    cruise:L("郵輪航程","Cruise journey","Crucero"),
    europe:L("歐洲","Europe","Europa"),
    "east-asia":L("東亞","East Asia","Asia oriental"),
    "southeast-asia":L("東南亞","Southeast Asia","Sudeste asiático"),
    americas:L("美洲","The Americas","América"),
    oceania:L("大洋洲","Oceania","Oceanía"),
    "africa-middle-east":L("非洲與中東","Africa and Middle East","África y Oriente Medio"),
    value:L("費用透明","Transparent pricing","Precio transparente"),
    air:L("機票一起安排","Airfare arranged together","Vuelo incluido en la planificación"),
    small:L("小團節奏","Smaller group pace","Ritmo de grupo pequeño"),
    short:L("五天左右","About five days","Unos cinco días"),
    immersive:L("六至八天","Six to eight days","De seis a ocho días"),
    open:L("天數彈性","Flexible duration","Duración flexible"),
    mediterranean:L("地中海","Mediterranean","Mediterráneo"),
    alaska:L("阿拉斯加","Alaska","Alaska"),
    caribbean:L("加勒比海","Caribbean","Caribe"),
    northernEurope:L("北歐","Northern Europe","Norte de Europa"),
    asiaCruise:L("亞洲航線","Asia","Asia"),
    worldCruise:L("世界長航","Long voyage","Vuelta al mundo"),
    week:L("五至七天","Five to seven days","Cinco a siete días"),
    fortnight:L("八至十四天","Eight to fourteen days","Ocho a catorce días"),
    longVoyage:L("十五至二十天以上","Fifteen days or longer","Quince días o más"),
    westCoast:L("美國西岸","United States West Coast","Costa oeste de Estados Unidos"),
    eastCoast:L("美國東岸","United States East Coast","Costa este de Estados Unidos"),
    overseas:L("亞洲或歐洲","Asia or Europe","Asia o Europa"),
    flexiblePort:L("出發港彈性","Flexible departure port","Puerto flexible")
  };
  const values = answers.mode === "cruise"
    ? [answers.mode,answers.sailingRegion,answers.cruiseDuration,answers.departurePort]
    : [answers.mode || "land",answers.region,answers.priority,answers.pace];
  return values.map(value=>labels[value]).filter(Boolean);
}

function bcTourFinderMatchReasons(t, answers) {
  const reasons = [];
  if (answers.region === "europe" && ["ES","GB"].includes(t.world?.region)) reasons.push(L("符合你選擇的歐洲方向","Matches your Europe direction","Coincide con Europa"));
  if (["east-asia","southeast-asia"].includes(answers.region) && t.world?.region === "JP") reasons.push(L("符合你選擇的亞洲方向","Matches your Asia direction","Coincide con Asia"));
  if (answers.pace === "short" && t.days <= 5) reasons.push(L(`${t.days} 天適合較短假期`,`${t.days} days suits a shorter break`,`${t.days} días para una pausa corta`));
  if (answers.pace === "immersive" && t.days >= 6) reasons.push(L(`${t.days} 天可以更深入目的地`,`${t.days} days gives the destination more time`,`${t.days} días para conocer mejor el destino`));
  if (answers.priority === "value") reasons.push(L("班期 團費與完整費用可繼續核對","Dates tour price and full costs are ready to compare","Fechas precio y costos listos para comparar"));
  if (answers.priority === "air") reasons.push(t.air?L("目前行程包含機票安排","Airfare is included in this journey","El viaje incluye vuelo"):L("機票另計並在旅程頁清楚標示","Airfare is separate and clearly shown","El vuelo se muestra por separado"));
  if (answers.priority === "small") reasons.push(L("可優先確認同行人數與每日節奏","Review group size and daily pace first","Revise primero el tamaño y el ritmo"));
  return reasons.slice(0,3);
}

function bcTourFinderResultCard(t, index, answers) {
  const reasons = bcTourFinderMatchReasons(t,answers);
  return `<article class="${index===0?"is-primary":""}"><figure><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/><figcaption><span>0${index+1}</span>${index===0?L("首選","First match","Primera opción"):L("延伸比較","Also compare","También compare")}</figcaption></figure><div><header><small>${index===0?L("最符合目前選擇","Best match for your choices","Mejor opción"):L("另一條值得比較","Another journey to compare","Otra opción")}　${t.code}</small><h3>${bcTxt(t.title)}</h3><p class="bc-finder-match-reason">${reasons.join("<br>")}</p></header><dl class="bc-finder-result-facts" data-keep-punctuation><div><dt>${L("最近班期","Next date","Próxima fecha")}</dt><dd>${t.nextDate}</dd></div><div><dt>${L("旅程天數","Duration","Duración")}</dt><dd>${t.days} ${L("天","days","días")}</dd></div><div><dt>${L("機票方式","Airfare","Vuelo")}</dt><dd>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</dd></div><div><dt>${L("成團狀態","Status","Estado")}</dt><dd>${bcTxt(t.status)}</dd></div></dl><footer><span><small>${L("每人起","Per person from","Por persona desde")}</small><strong data-keep-punctuation>${money(t.price)}</strong></span><button data-tour="${t.id}">${L("打開完整旅程","Open full journey","Abrir viaje")}</button></footer></div></article>`;
}

function bcCruiseFinderResult(answers) {
  const answerSummary = bcTourFinderAnswerSummary(answers);
  return `<section id="bc-tour-finder" class="bc-home-finder bc-home-finder-result bc-cruise-finder-result" aria-labelledby="bc-tour-finder-result"><header class="bc-finder-result-head"><div><p class="eyebrow">${L("郵輪條件完成","Cruise choices complete","Selección de crucero completa")}</p><h2 id="bc-tour-finder-result" tabindex="-1">${L("郵輪要用另一套資料找","Cruises need a different search","Los cruceros requieren otra búsqueda")}</h2></div><p>${L("航區 天數與出發港已整理<br>接入郵輪供應商後可直接配對真實班期","Region duration and departure port are ready<br>Supplier inventory can be matched directly when connected","Región duración y puerto listos<br>Se conectarán con inventario real")}</p></header><div class="bc-finder-answer-summary" aria-label="${L("你的郵輪選擇","Your cruise choices","Sus elecciones de crucero")}">${answerSummary.map((label,index)=>`<span><small>0${index+1}</small><b>${label}</b></span>`).join("")}</div><article class="bc-cruise-data-stage"><figure><img src="${BC_IMG.cruise}" alt="${L("郵輪航程","Cruise journey","Crucero")}"/></figure><div><p class="eyebrow">${L("郵輪商品資料","CRUISE PRODUCT DATA","DATOS DE CRUCERO")}</p><h3>${L("先把真正會影響選擇的資訊放齊","Show every fact that changes the decision","Mostrar todos los datos importantes")}</h3><p>${L("每個航程會同時顯示船公司 船名 房型 出發港 停靠港 海上日 港口稅 每日小費與取消規則","Every sailing will show the cruise line ship cabin departure port ports of call sea days port taxes daily gratuities and cancellation rules","Cada crucero mostrará naviera barco camarote puertos impuestos propinas y cancelación")}</p><dl><div><dt>${L("航區","Region","Región")}</dt><dd>${answerSummary[1] || L("尚未選擇","Not selected","Sin selección")}</dd></div><div><dt>${L("天數","Duration","Duración")}</dt><dd>${answerSummary[2] || L("尚未選擇","Not selected","Sin selección")}</dd></div><div><dt>${L("出發港","Departure port","Puerto de salida")}</dt><dd>${answerSummary[3] || L("尚未選擇","Not selected","Sin selección")}</dd></div><div><dt>${L("價格呈現","Price display","Precio")}</dt><dd>${L("含稅費比較","Taxes and fees included","Impuestos incluidos")}</dd></div></dl><strong>${L("目前尚未匯入郵輪供應商班期 因此不顯示假航程或假價格","Cruise supplier departures are not imported yet so no invented sailing or price is shown","Aún no hay salidas importadas por eso no se muestran viajes ni precios inventados")}</strong></div></article><div class="bc-home-finder-actions"><button data-tour-finder-reset>${L("重新選擇","Choose again","Elegir de nuevo")}</button><button data-view="services">${L("查看其他旅行服務","View other travel services","Ver otros servicios")}</button></div></section>`;
}

function bcHomeTourFinder() {
  const flow = state.guidedFlows.tourFinder || {step:0,answers:{}};
  const modeQuestion = {key:"mode",title:L("這次想怎麼旅行","How would you like to travel","Cómo desea viajar"),options:[
    ["land",L("陸上旅程","Land journey","Viaje terrestre"),L("跟團深度遊與多城市路線","Guided journeys and multi city routes","Circuitos guiados y varias ciudades")],
    ["cruise",L("郵輪航程","Cruise journey","Crucero"),L("先選航區 天數與出發港","Choose region duration and departure port","Elija región duración y puerto")]
  ]};
  const landQuestions = [
    {key:"region",title:L("比較想從哪個方向開始","Where would you like to begin","Por dónde desea comenzar"),options:[
      ["europe",L("歐洲","Europe","Europa"),L("西班牙 英國與更多地區","Spain Britain and more","España Reino Unido y más")],
      ["east-asia",L("東亞","East Asia","Asia oriental"),L("日本 韓國與中國","Japan Korea and China","Japón Corea y China")],
      ["southeast-asia",L("東南亞","Southeast Asia","Sudeste asiático"),L("泰國 越南與新加坡","Thailand Vietnam and Singapore","Tailandia Vietnam y Singapur")],
      ["americas",L("美洲","The Americas","América"),L("美國 加拿大與拉丁美洲","United States Canada and Latin America","Estados Unidos Canadá y Latinoamérica")],
      ["oceania",L("大洋洲","Oceania","Oceanía"),L("澳洲與紐西蘭","Australia and New Zealand","Australia y Nueva Zelanda")],
      ["africa-middle-east",L("非洲與中東","Africa and Middle East","África y Oriente Medio"),L("自然古文明與沙漠城市","Nature heritage and desert cities","Naturaleza patrimonio y ciudades del desierto")]
    ]},
    {key:"priority",title:L("這次最在意哪一件事","What matters most this time","Qué importa más esta vez"),options:[["value",L("費用透明","Transparent pricing","Precio transparente"),L("先看完整總價與必付費用","Review the full price and required costs first","Revise primero el precio total")],["air",L("機票一起安排","Arrange airfare together","Incluir vuelo"),L("減少自行銜接與分開購買","Reduce separate arrangements","Menos gestiones")],["small",L("偏好小團節奏","Prefer a smaller group","Grupo pequeño"),L("希望同行人數更少","Prefer fewer travelers","Menos viajeros")]]},
    {key:"pace",title:L("想留多少時間給這趟旅程","How much time would you give this journey","Cuánto tiempo desea viajar"),options:[["short",L("五天左右","About five days","Unos cinco días"),L("適合較短假期","Fits a shorter break","Para una pausa corta")],["immersive",L("六至八天","Six to eight days","De seis a ocho días"),L("用更多時間深入目的地","Spend longer in the destination","Más tiempo en el destino")],["open",L("天數彈性","Flexible","Flexible"),L("先以行程內容決定","Let the journey decide","Priorizar el viaje")]]}
  ];
  const cruiseQuestions = [
    {key:"sailingRegion",title:L("最想從哪片海開始","Which waters interest you most","Qué región marítima prefiere"),options:[
      ["mediterranean",L("地中海","Mediterranean","Mediterráneo"),L("南歐港口與古城","Southern Europe ports and historic cities","Puertos del sur de Europa")],
      ["alaska",L("阿拉斯加","Alaska","Alaska"),L("冰河 峽灣與野生自然","Glaciers fjords and wildlife","Glaciares fiordos y naturaleza")],
      ["caribbean",L("加勒比海","Caribbean","Caribe"),L("島嶼 海灘與暖陽","Islands beaches and warm weather","Islas playas y sol")],
      ["northernEurope",L("北歐","Northern Europe","Norte de Europa"),L("峽灣 波羅的海與北境城市","Fjords the Baltic and northern cities","Fiordos Báltico y ciudades del norte")],
      ["asiaCruise",L("亞洲航線","Asia","Asia"),L("日本 台灣與東南亞港口","Japan Taiwan and Southeast Asia ports","Japón Taiwán y Sudeste Asiático")],
      ["worldCruise",L("世界長航","Long voyage","Vuelta al mundo"),L("跨洲段落與長天數航程","Multi region and extended sailings","Viajes largos entre regiones")]
    ]},
    {key:"cruiseDuration",title:L("希望在船上與岸上待多久","How long should the sailing be","Cuánto debe durar el crucero"),options:[
      ["week",L("五至七天","Five to seven days","Cinco a siete días"),L("適合第一次郵輪旅行","A good first cruise length","Ideal para el primer crucero")],
      ["fortnight",L("八至十四天","Eight to fourteen days","Ocho a catorce días"),L("停靠更多城市與島嶼","More ports and destinations","Más puertos y destinos")],
      ["longVoyage",L("十五天以上","Fifteen days or longer","Quince días o más"),L("包含二十天以上長航程","Includes voyages longer than twenty days","Incluye viajes de más de veinte días")]
    ]},
    {key:"departurePort",title:L("從哪裡登船最方便","Which departure area works best","Qué zona de salida le conviene"),options:[
      ["westCoast",L("美國西岸","United States West Coast","Costa oeste de Estados Unidos"),L("舊金山 洛杉磯 西雅圖與溫哥華","San Francisco Los Angeles Seattle and Vancouver","San Francisco Los Ángeles Seattle y Vancouver")],
      ["eastCoast",L("美國東岸","United States East Coast","Costa este de Estados Unidos"),L("紐約 邁阿密與佛州港口","New York Miami and Florida ports","Nueva York Miami y Florida")],
      ["overseas",L("亞洲或歐洲","Asia or Europe","Asia o Europa"),L("飛往航區後登船","Fly to the sailing region","Volar a la región de salida")],
      ["flexiblePort",L("出發港彈性","Flexible departure port","Puerto flexible"),L("先以航線內容決定","Let the itinerary decide","Priorizar el itinerario")]
    ]}
  ];
  const total = 4;
  const progress = Math.min(flow.step,total);
  if (flow.step >= total && flow.answers.mode === "cruise") return bcCruiseFinderResult(flow.answers);
  if (flow.step >= total) {
    const ranked = bcTourFinderRank(flow.answers).slice(0,2);
    const answerSummary = bcTourFinderAnswerSummary(flow.answers);
    return `<section id="bc-tour-finder" class="bc-home-finder bc-home-finder-result" aria-labelledby="bc-tour-finder-result"><header class="bc-finder-result-head"><div><p class="eyebrow">${L("配對完成","Match complete","Selección completa")}</p><h2 id="bc-tour-finder-result" tabindex="-1">${L("最適合先看的兩趟旅程","The two journeys to see first","Los dos viajes para ver primero")}</h2></div><p>${L("依照你的四個選擇排序<br>進入旅程後可確認班期與完整價格","Ranked from your four choices<br>Open a journey to review dates and the full price","Ordenado según sus cuatro elecciones<br>Abra el viaje para confirmar fechas y precio")}</p></header><div class="bc-finder-answer-summary" aria-label="${L("你的選擇","Your choices","Sus elecciones")}">${answerSummary.map((label,index)=>`<span><small>0${index+1}</small><b>${label}</b></span>`).join("")}</div><div class="bc-home-finder-results">${ranked.map((t,index)=>bcTourFinderResultCard(t,index,flow.answers)).join("")}</div><div class="bc-home-finder-actions"><button data-tour-finder-reset>${L("重新選擇","Choose again","Elegir de nuevo")}</button><button data-tour-finder-results>${L("帶著這些選擇繼續比較","Continue with these choices","Continuar con estas opciones")}</button></div></section>`;
  }
  const branchQuestions = flow.answers.mode === "cruise" ? cruiseQuestions : landQuestions;
  const q = flow.step === 0 ? modeQuestion : branchQuestions[flow.step - 1];
  const optionImages = {
    land:BC_TOURS[0].image,cruise:BC_IMG.cruise,
    europe:BC_TOURS[0].image,"east-asia":BC_TOURS[2].image,"southeast-asia":BC_IMG.southeastAsia,
    americas:BC_IMG.americas,oceania:BC_IMG.oceania,"africa-middle-east":BC_IMG.africaMiddleEast,
    open:BC_TOURS[1].image,value:BC_TOURS[0].image,air:BC_IMG.plane,small:BC_TOURS[2].image,
    short:BC_TOURS[0].image,immersive:BC_TOURS[1].image,
    mediterranean:BC_IMG.madrid,alaska:BC_IMG.americas,caribbean:BC_IMG.cruise,northernEurope:BC_IMG.cotswolds,asiaCruise:BC_IMG.fuji,worldCruise:BC_IMG.oceania,
    week:BC_IMG.cruise,fortnight:BC_IMG.madrid,longVoyage:BC_IMG.oceania,
    westCoast:BC_IMG.americas,eastCoast:BC_IMG.cruise,overseas:BC_IMG.madrid,flexiblePort:BC_IMG.oceania
  };
  return `<section id="bc-tour-finder" class="bc-home-finder" aria-labelledby="bc-tour-finder-question"><header class="bc-finder-progress"><div><p>${L("四個選擇 找到方向","Four choices to find a direction","Cuatro elecciones para encontrar rumbo")}</p>${progress?`<button class="bc-finder-progress-back" data-tour-finder-back>${L("返回上一題","Previous question","Pregunta anterior")}</button>`:""}</div><ol aria-label="${L("找團進度","Finder progress","Progreso")}">${[0,1,2,3].map(i=>`<li class="${i===progress?"active":i<progress?"done":""}"><span>0${i+1}</span></li>`).join("")}</ol></header><div class="bc-home-finder-question bc-home-finder-question-${q.key}"><p>${L(`第 ${progress+1} 題　共 4 題`,`Question ${progress+1} of 4`,`Pregunta ${progress+1} de 4`)}</p><h3 id="bc-tour-finder-question" tabindex="-1">${q.title}</h3><div>${q.options.map(([value,title,copy],index)=>`<button data-tour-finder-answer="${value}" data-tour-finder-key="${q.key}"><img src="${optionImages[value]}" alt="" aria-hidden="true" loading="${index===0?"eager":"lazy"}"/><em>${String(index+1).padStart(2,"0")}</em><span><b>${title}</b><small>${copy}</small></span></button>`).join("")}</div></div></section>`;
}

function homeBC() {
  const lead = BC_TOURS[0];
  const versions = {
    A:()=>bcHomeVersionA(lead),
    B:()=>bcHomeVersionB(lead),
    C:()=>bcHomeVersionC()
  };
  return `<main id="bc-home-redesign" tabindex="-1" class="bc-home-redesign bc-home-${state.homeDesign.toLowerCase()}">${versions[state.homeDesign]()}${bcHomeLabSwitcher()}${bcCtaLabSwitcher()}</main>`;
}

function tourFinderBC() {
  return `<main class="bc-tour-finder-page"><header class="bc-shell bc-tour-finder-page-head"><div><p class="eyebrow">${L("旅程探索","PACK&GO JOURNEY FINDER","BUSCADOR DE VIAJES")}</p><h1>${L("找到下一站","Find what is next","Encuentre su próximo destino")}</h1></div><button data-view="tours">${L("查看全部旅程","View every journey","Ver todos los viajes")}</button></header>${bcHomeTourFinder()}</main>`;
}

function bcTourCard(t) {
  const saved = state.savedTours.has(t.id);
  const searchable = [bcTxt(t.destination),bcTxt(t.title),t.code,...t.features.map(bcTxt)].join(" ").toLowerCase();
  return `<article class="bc-tour-card" data-tour-card data-status="${t.formed?"confirmed":"collecting"}" data-air="${t.air?"included":"separate"}" data-search="${searchable}">
    <div class="bc-tour-media"><button class="link-button" data-tour="${t.id}" aria-label="${bcTxt(t.title)}"><img src="${t.image}" alt="${bcTxt(t.title)}" loading="lazy"/></button><span class="bc-tour-status">${bcTxt(t.status)}</span><button class="bc-tour-save ${saved?"saved":""}" data-save-tour="${t.id}" aria-label="${L("收藏行程","Save journey","Guardar viaje")}">${saved?"♥":"♡"}</button><div class="bc-tour-compare-rail" aria-label="${L("行程快速比較","Quick journey comparison","Comparación rápida")}"><span><small>${L("天數","DURATION","DURACIÓN")}</small><b>${t.days} ${L("天","days","días")}</b></span><span><small>${L("最近班期","NEXT DATE","PRÓXIMA")}</small><b>${t.nextDate.slice(5)}</b></span><span><small>${L("機票","AIRFARE","VUELO")}</small><b>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</b></span><span class="price"><small>${L("每人起","FROM","DESDE")}</small><b>${money(t.price)}</b></span></div></div>
    <div class="bc-tour-body"><div class="bc-tour-heading"><div><span class="bc-tour-code">${t.code} · ${bcTxt(t.destination)}</span><h2>${bcTxt(t.title)}</h2></div></div>
      <div class="bc-tour-facts"><div class="bc-tour-fact"><small>${L("天數","DURATION","DURACIÓN")}</small><b>${t.days} ${L("天","days","días")}</b></div><div class="bc-tour-fact"><small>${L("最近班期","NEXT DATE","PRÓXIMA")}</small><b>${t.nextDate.slice(5)}</b></div><div class="bc-tour-fact"><small>${L("機票","AIR","VUELO")}</small><b>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</b></div></div>
      <p class="bc-tour-features">${t.features.map(bcTxt).join(" · ")}</p>
      <div class="bc-tour-bottom"><div class="bc-tour-price"><small>${L("每人起・設計示意","PER PERSON · DEMO","POR PERSONA · DEMO")}</small><strong>${money(t.price)}</strong></div><button class="btn small" data-tour="${t.id}">${L("查看詳情","View details","Ver detalles")}</button></div>
    </div></article>`;
}

function bcCatalogMatch(t) {
  const f = state.catalogFacets;
  if (f.region === "europe" && !["ES","GB"].includes(t.world?.region)) return false;
  if (f.region === "asia" && t.world?.region !== "JP") return false;
  if (f.month !== "all" && !t.nextDate.startsWith(f.month)) return false;
  if (f.duration === "short" && t.days > 5) return false;
  if (f.duration === "long" && t.days < 6) return false;
  if (f.budget === "under2000" && t.price >= 2000) return false;
  if (f.budget === "over2000" && t.price < 2000) return false;
  if (f.status === "confirmed" && !t.formed) return false;
  if (f.air === "included" && !t.air) return false;
  if (f.air === "separate" && t.air) return false;
  return true;
}

function bcCatalogFacetData() {
  return {
    region:{label:L("目的地","DESTINATION","DESTINO"),options:[["all",L("不限地區","Any region","Cualquier región")],["europe",L("歐洲・2 個團","Europe · 2 journeys","Europa · 2 viajes")],["asia",L("亞洲・1 個團","Asia · 1 journey","Asia · 1 viaje")]]},
    month:{label:L("出發月份","DEPARTURE","SALIDA"),options:[["all",L("不限月份","Any month","Cualquier mes")],["2026.10",L("2026 年 10 月・2 個團","October 2026 · 2 journeys","Octubre 2026 · 2 viajes")],["2026.11",L("2026 年 11 月・1 個團","November 2026 · 1 journey","Noviembre 2026 · 1 viaje")]]},
    duration:{label:L("旅行天數","DURATION","DURACIÓN"),options:[["all",L("不限天數","Any duration","Cualquier duración")],["short",L("5 天左右・1 個團","About 5 days · 1 journey","Unos 5 días · 1 viaje")],["long",L("6–8 天・2 個團","6–8 days · 2 journeys","6–8 días · 2 viajes")]]},
    budget:{label:L("每人價位","PRICE RANGE","RANGO DE PRECIO"),options:[["all",L("不限價位","Any price","Cualquier precio")],["under2000",`${L("低於","Under","Menos de")} ${money(2000)} · 1`],["over2000",`${money(2000)}+ · 2`]]},
    status:{label:L("成團狀態","DEPARTURE STATUS","ESTADO"),options:[["all",L("不限狀態","Any status","Cualquier estado")],["confirmed",L("只看已成行・3 個團","Confirmed only · 3 journeys","Confirmados · 3 viajes")]]},
    air:{label:L("機票方式","AIRFARE","VUELO"),options:[["all",L("不限機票方式","Any airfare setup","Cualquier opción")],["included",L("團費含機票・1 個團","Air included · 1 journey","Vuelo incluido · 1 viaje")],["separate",L("機票另計・2 個團","Air separate · 2 journeys","Vuelo aparte · 2 viajes")]]}
  };
}

function bcCatalogFacetButton(key) {
  const data = bcCatalogFacetData()[key];
  const value = state.catalogFacets[key];
  const selected = data.options.find(option=>option[0]===value);
  const active = value !== "all";
  return `<button class="bc-catalog-facet-button ${active?"is-selected":""}" data-catalog-facet-open="${key}" aria-expanded="${state.catalogFacetOpen===key}"><span><small>${data.label}</small><b>${active?selected[1]:L("選擇","Choose","Elegir")}</b></span><i aria-hidden="true">${state.catalogFacetOpen===key?"−":"+"}</i></button>`;
}

function bcCatalogChoiceGroup(key) {
  const data = bcCatalogFacetData()[key];
  return `<section><h3>${data.label}</h3><div>${data.options.map(([value,label])=>`<button class="${state.catalogFacets[key]===value?"is-selected":""}" data-catalog-choice="${key}" data-catalog-value="${value}" aria-pressed="${state.catalogFacets[key]===value}"><span>${label}</span><i>${state.catalogFacets[key]===value?"✓":"→"}</i></button>`).join("")}</div></section>`;
}

function bcCatalogFilters(resultCount) {
  const open = state.catalogFacetOpen;
  const panel = !open ? "" : open === "more" ? `${bcCatalogChoiceGroup("status")}${bcCatalogChoiceGroup("air")}` : bcCatalogChoiceGroup(open);
  return `<section class="bc-catalog-finder" aria-labelledby="bc-catalog-finder-title"><header><div><p class="eyebrow">FULL JOURNEY FINDER</p><h2 id="bc-catalog-finder-title">${L("先選一個條件，再決定要不要繼續縮小。","Choose one condition, then decide whether to narrow further.","Elija una condición y después refine.")}</h2></div><span data-tour-results-count>${L(`${resultCount} 個符合行程`,`${resultCount} matching journeys`,`${resultCount} viajes`)}</span></header><label class="bc-catalog-search bc-catalog-search-wide">${icon("search")}<input data-catalog-search value="${state.catalogQuery}" placeholder="${L("搜尋目的地、團名或特色","Search destination, journey or feature","Buscar destino, viaje o característica")}"/></label><div class="bc-catalog-filter-bar">${["region","month","duration","budget"].map(bcCatalogFacetButton).join("")}<button class="bc-catalog-facet-button bc-catalog-more-button" data-catalog-facet-open="more" aria-expanded="${open==="more"}"><span><small>${L("其他條件","MORE","MÁS")}</small><b>${L("機票與成團狀態","Airfare and status","Vuelo y estado")}</b></span><i>${open==="more"?"−":"+"}</i></button></div>${panel?`<div class="bc-catalog-option-panel">${panel}<button class="bc-catalog-panel-reset" data-catalog-reset>${L("清除全部條件","Clear all filters","Borrar filtros")}</button></div>`:""}</section>`;
}

function bcTaiwanCatalogEntry() {
  const t = BC_TAIWAN_TOUR;
  const destination = L("台灣・經典環島","Taiwan · Classic circuit","Taiwán · circuito clásico");
  const title = L("福森號 × 鳴日號｜經典台灣環島八日","Formosensis × Future Express · Classic Taiwan Circuit","Formosensis × Future Express · Circuito clásico de Taiwán");
  return `<article class="bc-catalog-preview" aria-labelledby="bc-taiwan-catalog-title">
    <button class="bc-catalog-preview-image" data-tour="${t.id}" aria-label="${L("查看台灣八日行程內容","View the Taiwan 8-day itinerary","Ver el itinerario de 8 días por Taiwán")}"><img src="${t.image}" alt="${title}" loading="lazy"/></button>
    <div class="bc-catalog-preview-copy"><header><p class="eyebrow">${L("行程內容預覽","ITINERARY PREVIEW","VISTA PREVIA DEL ITINERARIO")}</p><small>${t.code} · ${destination}</small><h2 id="bc-taiwan-catalog-title">${title}</h2><p>${L("完整八日路線已整理，先看每天停靠、鐵路與文化體驗；正式班期與價格確認後才會開放訂購。","The complete eight-day route is ready to explore, including daily stops, rail journeys and cultural experiences. Booking opens only after dates and prices are confirmed.","Explore la ruta completa de ocho días con paradas, trenes y experiencias culturales. Las reservas abrirán cuando se confirmen fechas y precios.")}</p></header>
      <dl class="bc-catalog-preview-facts"><div><dt>${L("天數","DURATION","DURACIÓN")}</dt><dd>${t.days} ${L("天","days","días")}</dd></div><div><dt>${L("住宿","NIGHTS","NOCHES")}</dt><dd>${t.nights} ${L("晚","nights","noches")}</dd></div><div><dt>${L("目前狀態","STATUS","ESTADO")}</dt><dd>${L("內容預覽・不可訂購","Content preview · not bookable","Vista previa · no reservable")}</dd></div></dl>
      <div class="bc-catalog-preview-action"><span><small>${L("班期與價格","DATES & PRICE","FECHAS Y PRECIO")}</small><b>${L("待確認","Pending confirmation","Por confirmar")}</b></span><button data-tour="${t.id}">${L("查看八日行程","View 8-day itinerary","Ver itinerario de 8 días")} →</button></div>
    </div>
  </article>`;
}

function toursBC() {
  const query = state.catalogQuery.trim().toLowerCase();
  const list = BC_TOURS.filter(bcCatalogMatch).filter(t => !query || [bcTxt(t.destination),bcTxt(t.title),t.code,...t.features.map(bcTxt)].join(" ").toLowerCase().includes(query));
  return `<main class="bc-tours-page">${bcPageIntro("CURATED GROUP JOURNEYS",L("先回答條件，再比較適合的團。","Set your needs, then compare the right journeys.","Defina sus necesidades y compare."),L("目的地、月份、天數與價位先縮小選擇；機票與成團狀態放在更多條件。所有結果仍使用相同欄位比較。","Destination, month, duration and price range narrow the list first; airfare and departure status stay under more filters.","Destino, mes, duración y precio reducen la lista."),BC_IMG.cotswolds)}<section class="bc-shell section-tight">${bcDemoNotice()}${bcCatalogFilters(list.length)}<div class="bc-tour-grid">${list.map(bcTourCard).join("")}</div><p id="bc-empty-results" class="bc-catalog-empty" ${list.length?"hidden":""}><b>${L("目前沒有完全符合的團。","No journey matches every condition.","No hay viajes que coincidan.")}</b><span>${L("清除一項條件，或查看全部三個示意行程。","Clear one filter or return to all three sample journeys.","Quite un filtro o vea los tres viajes.")}</span><button data-catalog-reset>${L("清除全部條件","Clear all filters","Borrar filtros")}</button></p>${bcTaiwanCatalogEntry()}</section></main>`;
}

function bcDetailSelectedDay(t) {
  const day = Math.min(Math.max(Number(state.day) || 1, 1), t.route.length);
  state.day = day;
  return t.route[day - 1];
}

function bcDetailRouteStops(t) {
  return t.route.flatMap(day => (day.stops || [{ name: day.city, geo: day.geo }]).map((stop, stopIndex) => ({
    ...stop,
    id: stop.id || `d${day.day}-p${stopIndex + 1}`,
    day: day.day,
    stopIndex,
    markerName: `D${String(day.day).padStart(2,"0")}.${stopIndex + 1} · ${bcTxt(stop.name)}`
  })));
}

function bcDetailSelectedPoi(t) {
  const stops = bcDetailRouteStops(t);
  const d = bcDetailSelectedDay(t);
  const selected = stops.find(stop => stop.id === state.poi && stop.day === d.day)
    || stops.find(stop => stop.day === d.day)
    || stops[0];
  if (!selected) return null;
  state.day = selected.day;
  state.poi = selected.id;
  return selected;
}

function bcPoiKindLabel(kind) {
  const labels = {
    arrival: L("抵達與接駁", "ARRIVAL & TRANSFER", "LLEGADA Y TRASLADO"),
    departure: L("送機與離境", "AIRPORT DEPARTURE", "SALIDA AL AEROPUERTO"),
    rail: L("鐵路節點", "RAIL NODE", "PUNTO FERROVIARIO"),
    heritage: L("歷史建築", "HERITAGE", "PATRIMONIO"),
    culture: L("文化體驗", "CULTURE", "CULTURA"),
    experience: L("職人體驗", "HANDS-ON EXPERIENCE", "EXPERIENCIA"),
    landscape: L("風景段落", "LANDSCAPE", "PAISAJE"),
    museum: L("博物館", "MUSEUM", "MUSEO"),
    landmark: L("城市地標", "LANDMARK", "MONUMENTO"),
    harbor: L("海岸與漁港", "COAST & HARBOR", "COSTA Y PUERTO"),
    dining: L("餐飲與演出", "DINING & PERFORMANCE", "CENA Y ESPECTÁCULO"),
    stay: L("住宿方向・尚未確認", "PROPOSED STAY · UNCONFIRMED", "HOTEL PROPUESTO"),
    place: L("行程停靠", "ITINERARY STOP", "PARADA")
  };
  return labels[kind] || labels.place;
}

function bcDayMealGrid(day) {
  const mealByType = Object.fromEntries((day.dataContract?.meals || []).map(meal => [meal.mealType, meal]));
  const meal = (type, label) => {
    const status = mealByType[type]?.serviceStatus || "pending";
    const included = status === "included" || status === "included_unconfirmed";
    const text = status === "included" ? L("已含","Included") : status === "included_unconfirmed" ? L("預計包含・待確認","Expected included · pending") : status === "in_flight" ? L("機上餐・待航班確認","In-flight · flight pending") : status === "self" ? L("自理","On your own") : L("未列・待確認","Not listed · pending");
    return `<div data-meal-id="${mealByType[type]?.id || ""}" data-service-status="${status}"><dt>${label}</dt><dd class="${included?"included":status === "self"?"self":"pending"}">${text}</dd></div>`;
  };
  return `<dl class="bc-detail-meal-grid">${meal("breakfast",L("早餐","BREAKFAST"))}${meal("lunch",L("午餐","LUNCH"))}${meal("dinner",L("晚餐","DINNER"))}</dl>`;
}

function bcHotelTier(day, tour) {
  const stay = day.dataContract?.stay;
  if (!stay) return L("星級待正式確認","Rating pending confirmation");
  if (stay.propertyStatus === "not_applicable") return L("當日不住宿／機上過夜","No hotel stay / overnight flight");
  if (stay.rating.value) return L(`${stay.rating.value} 星或同級`,`${stay.rating.value}-star or equivalent`);
  return L("星級待正式確認","Rating pending confirmation");
}

function bcDetailRouteExplorer(t) {
  const selected = bcDetailSelectedPoi(t);
  const d = t.route[selected.day - 1];
  const meta = bcRegionMeta(t);
  const stops = bcDetailRouteStops(t);
  const selectedIndex = stops.findIndex(stop => stop.id === selected.id);
  const previous = stops[selectedIndex - 1];
  const next = stops[selectedIndex + 1];
  const dayStops = stops.filter(stop => stop.day === d.day);
  const mapContent = "";
  const dayRail = `<nav class="bc-region-day-rail bc-detail-day-rail" aria-label="${L("選擇逐日行程","Choose an itinerary day","Elegir día del itinerario")}">${t.route.map(day=>`<button class="${day.day===d.day?"active":""}" data-day="${day.day}" aria-pressed="${day.day===d.day}"><small>D${String(day.day).padStart(2,"0")}</small><b>${bcTxt(day.city)}</b></button>`).join("")}</nav>`;
  const stopChoices = dayStops.length > 1 ? `<nav class="bc-detail-stop-choices" aria-label="${L(`第 ${d.day} 天景點`, `Day ${d.day} places`, `Lugares del día ${d.day}`)}">${dayStops.map((stop,index)=>`<button class="${stop.id===selected.id?"active":""}" data-poi="${stop.id}" data-day="${stop.day}" aria-pressed="${stop.id===selected.id}"><span>${String(index+1).padStart(2,"0")}</span><b>${bcTxt(stop.name)}</b></button>`).join("")}</nav>` : "";
  const routeStep = (stop, direction) => stop ? `<button data-poi="${stop.id}" data-day="${stop.day}" aria-label="${direction} ${bcTxt(stop.name)}"><small>${direction}</small><b>${bcTxt(stop.name)}</b></button>` : `<button disabled><small>${direction}</small><b>${direction === L("上一站","PREVIOUS","ANTERIOR") ? L("旅程開始","Journey begins","Inicio del viaje") : L("旅程結束","Journey ends","Fin del viaje")}</b></button>`;
  return `<div class="bc-detail-route-explorer">${dayRail}<div class="bc-region-explorer bc-detail-route-spread"><section class="bc-region-map-pane bc-detail-map-pane"><header><div class="bc-region-breadcrumb"><span>${t.code}</span><i>/</i><b>${bcTxt(meta.name)}</b></div><span class="bc-detail-map-count">${t.days} ${L("天","DAYS","DÍAS")} · ${stops.length} ${L("個行程節點","ROUTE STOPS","PARADAS")}</span></header><div id="bc-detail-region-map" class="bc-region-map-canvas bc-detail-region-map" aria-label="${L(`${bcTxt(meta.name)}行程停靠地互動地圖`,`${bcTxt(meta.name)} interactive itinerary map`,`Mapa interactivo de ${bcTxt(meta.name)}`)}">${mapContent}</div><footer><span>${L("點日期或地圖節點，照片與資料會同步切換","CHOOSE A DAY OR MAP STOP; THE STORY UPDATES WITH IT","ELIJA UN DÍA O PUNTO")}</span><small>${L("地理位置為設計示意，非即時導航","DESIGN DEMO · NOT LIVE NAVIGATION","DEMO · NO ES NAVEGACIÓN")}</small></footer></section><article class="bc-region-story bc-detail-day-story" aria-live="polite"><div class="bc-region-story-image"><img src="${selected.image || d.image}" alt="${bcTxt(selected.name)}" loading="lazy"/><span>DAY ${String(d.day).padStart(2,"0")} · ${L("設計示意","DESIGN DEMO","DEMO")}</span></div><div class="bc-region-story-copy"><p class="eyebrow">DAY ${String(d.day).padStart(2,"0")} · ${bcPoiKindLabel(selected.kind)}</p><h3 id="bc-detail-stop-title" tabindex="-1">${bcTxt(d.city)}</h3><p class="bc-detail-poi-summary">${bcTxt(d.sights)}</p>${stopChoices}<p class="bc-region-do"><b>${L("今天怎麼玩","THE DAY IN ONE PARAGRAPH","EL DÍA EN UN PÁRRAFO")}</b>${bcTxt(selected.description || selected.summary || d.sights)}</p><section class="bc-detail-day-answers" aria-label="${L("本日餐食與住宿","Meals and hotel for this day","Comidas y hotel del día")}"><div><p class="eyebrow">${L("吃什麼","MEALS","COMIDAS")}</p>${bcDayMealGrid(d)}</div><div class="bc-detail-stay-answer"><p class="eyebrow">${L("住哪裡","STAY","HOTEL")}</p><b>${bcHotelTier(d,t)}</b><span>${bcTxt(d.hotel)}</span></div></section><div class="bc-detail-route-position"><small>${L("沿路繼續探索","KEEP EXPLORING","SEGUIR EXPLORANDO")}</small><div class="bc-detail-poi-stepper">${routeStep(previous,L("上一天","PREVIOUS DAY","DÍA ANTERIOR"))}${routeStep(next,L("下一天","NEXT DAY","DÍA SIGUIENTE"))}</div></div></div></article></div></div>`;
}

function bcDetailGallery(t) {
  const galleryLabel = t.previewOnly
    ? L("4 張來源文件圖片・本地設計示意", "4 source-document images · local demo", "4 imágenes del documento · demo")
    : L("查看全部 12 張・設計示意", "View all 12 · design demo", "Ver las 12 · demo");
  return `<div class="bc-gallery ${t.previewOnly?"bc-preview-gallery":""}"><div class="bc-gallery-main"><img src="${t.gallery[0]}" alt="${bcTxt(t.title)}" fetchpriority="high"/><button class="bc-gallery-more" data-demo-action>${galleryLabel}</button></div><div class="bc-gallery-side"><div><img src="${t.gallery[1]}" alt=""/></div><div><img src="${t.gallery[2]}" alt=""/></div></div></div>`;
}

function bcDetailSummary(t) {
  if (t.previewOnly) return `<section class="bc-detail-summary bc-preview-detail-summary"><div><span class="bc-tour-code">${t.code} · ${bcTxt(t.destination)} · ${L("設計示意","DESIGN DEMO","DEMO")}</span><h1>${bcTxt(t.title)}</h1><div class="bc-summary-meta"><span>${bcTxt(t.group)}</span><span>${bcTxt(t.status)}</span><span>${L("內容依提供行程文件整理","Structured from the supplied itinerary","Basado en el itinerario suministrado")}</span></div></div><div class="bc-summary-facts"><div><small>${L("行程","DURATION","DURACIÓN")}</small><b>${t.days} ${L("天","days","días")}</b></div><div><small>${L("路線地圖","ROUTE MAP","MAPA")}</small><b>${L("一張全圖","Single view","Vista única")}</b></div><div><small>${L("交易資料","COMMERCE","VENTA")}</small><b>${L("尚未提供","Pending","Pendiente")}</b></div></div><div class="bc-summary-actions"><a class="btn" href="#bc-itinerary">${L("查看台灣路線圖","View Taiwan route map","Ver mapa de Taiwán")}</a><button class="btn ghost" disabled>${L("班期與價格待確認","Dates & price pending","Fechas y precio pendientes")}</button></div></section>`;
  return `<section class="bc-detail-summary"><div><span class="bc-tour-code">${t.code} · ${bcTxt(t.destination)}</span><h1>${bcTxt(t.title)}</h1><div class="bc-summary-meta"><span>${bcTxt(t.group)}</span><span>${bcTxt(t.status)}</span><span>${L("更新示意 2026.08.01","Sample updated 2026.08.01","Actualizado 2026.08.01")}</span></div></div><div class="bc-summary-facts"><div><small>${L("行程","DURATION","DURACIÓN")}</small><b>${t.days} ${L("天","days","días")}</b></div><div><small>${L("最近班期","NEXT DATE","PRÓXIMA")}</small><b>${t.nextDate.slice(5)}</b></div><div><small>${L("每人起","FROM","DESDE")}</small><b>${money(t.price)}</b></div></div><div class="bc-summary-actions"><button class="btn" data-book>${L("選日期與人數","Choose date & guests","Elegir fecha y viajeros")}</button><button class="btn ghost" data-save-tour="${t.id}">${state.savedTours.has(t.id)?"♥ ":"♡ "}${L("收藏","Save","Guardar")}</button><button class="btn ghost" data-share="tour">${L("傳給旅伴 ↗","Send to a travel partner ↗","Enviar a un acompañante ↗")}</button></div></section>`;
}

function bcDetailNav() {
  return `<nav class="bc-shell bc-detail-nav bc-detail-nav-sticky" aria-label="${L("行程內容","Journey sections","Secciones del viaje")}"><a href="#bc-detail-overview">${L("行程總覽","Overview","Resumen")}</a><a href="#bc-guided-itinerary">${L("每日行程","Daily journey","Itinerario")}</a><a href="#bc-flight">${L("航班","Flight","Vuelo")}</a><a href="#bc-cost">${L("完整費用","Full cost","Costo total")}</a><a href="#bc-dates">${L("班期餘位","Dates and seats","Fechas y plazas")}</a><a href="#bc-stay">${L("飯店交通","Stay and transport","Hotel y transporte")}</a><a href="#bc-policy">${L("退改保障","Terms and trust","Condiciones")}</a></nav>`;
}

function bcDetailDataState(t) {
  if (t.previewOnly) return "";
  return `<section class="bc-shell bc-detail-data-state" aria-label="${L("價格與供應商資料狀態","Price and supplier data status","Estado de precio y proveedor")}"><header><div><p class="eyebrow">DATA CONFIDENCE</p><h2>${L("現在看得到什麼　付款前還會確認什麼","What is visible now and what is rechecked before payment","Qué se muestra y qué se confirma antes del pago")}</h2></div><b>${L("付款前再次確認","RECHECK BEFORE PAYMENT","REVISAR ANTES DEL PAGO")}</b></header><div><span><small>${L("行程內容","ITINERARY","ITINERARIO")}</small><strong>${L("已整理可閱讀","Ready to review","Listo para revisar")}</strong></span><span><small>${L("價格與餘位","PRICE AND SEATS","PRECIO Y PLAZAS")}</small><strong>${L("付款前即時重查","Live recheck before payment","Revisión antes del pago")}</strong></span><span><small>${L("航班與飯店","FLIGHT AND HOTEL","VUELO Y HOTEL")}</small><strong>${L("依供應商最終確認","Supplier confirmation required","Requiere confirmación")}</strong></span><button data-demo-action>${L("重新檢查示意","Preview status check","Vista de revisión")} →</button></div></section>`;
}

function bcDetailDecisionStrip(t) {
  return `<section class="bc-detail-decision-strip" aria-label="${L("行程快速解答","Journey quick answers","Respuestas rápidas")}"><div><small>${L("機票","AIRFARE","VUELO")}</small><b>${t.air?L("團費已含","Included","Incluido"):L("另計・有預估","Separate · estimate shown","No incluido")}</b></div><div><small>${L("團體規模","GROUP SIZE","GRUPO")}</small><b>${bcTxt(t.group)}</b></div><div><small>${L("飯店標準","HOTEL LEVEL","HOTEL")}</small><b>${L("四星或同級","4-star or equivalent","4 estrellas o similar")}</b></div><div><small>${L("旅行節奏","TRIP PACE","RITMO")}</small><b>${bcTxt(t.features[2] || t.features[0])}</b></div></section>`;
}

function bcBookingCard(t) {
  return `<aside class="bc-booking-card"><p class="eyebrow">${L("最近可報名班期・設計示意","NEXT SAMPLE DEPARTURE","PRÓXIMA SALIDA DE EJEMPLO")}</p><h2>${money(t.price)}</h2><p>${L("每人起；選日期與人數後顯示本次總價。","Per person from; choose date and guests to see the trip total.","Desde por persona; elija fecha y viajeros para ver el total.")}</p><div class="date-row"><span>${t.nextDate}–${t.returnDate.slice(5)}</span><b>${t.seats} ${L("位","seats","plazas")}</b></div><div class="date-row"><span>${L("成團狀態","Departure","Estado")}</span><b>${bcTxt(t.status)}</b></div><div class="date-row"><span>${L("機票","Air","Vuelo")}</span><b>${t.air?L("已含","Included","Incluido"):L("另計","Separate","No incluido")}</b></div><button class="btn light" data-book>${L("選日期與人數","Choose date & guests","Elegir fecha y viajeros")}</button><button class="btn ghost-dark" data-save-tour="${t.id}">${state.savedTours.has(t.id)?"♥ ":"♡ "}${L("收藏行程","Save journey","Guardar viaje")}</button><p>${L("不會扣款或建立訂位。正式付款前須揭露完整總價、取消條款與保障。","No charge or booking is created. Full price, cancellation and protections must appear before real payment.","No se cobra ni se reserva. El precio total y las condiciones deben mostrarse antes del pago real.")}</p></aside>`;
}

function bcHighlights(t) {
  const highlights = [t.route[1] || t.route[0], t.route[Math.floor(t.route.length/2)], t.route[t.route.length-2]];
  return `<section id="bc-highlights" class="bc-editorial-section"><p class="eyebrow">PLACES, NOT PROMISES</p><h2>${L("真正會走進的地方","Places you will actually enter","Lugares que realmente visitará")}</h2><div class="bc-highlight-grid">${highlights.map(d=>`<article class="bc-highlight"><img src="${d.image}" alt="${bcTxt(d.city)}" loading="lazy"/><div><p>DAY 0${d.day}</p><h3>${bcTxt(d.city)}</h3><p>${bcTxt(d.sights)}</p></div></article>`).join("")}</div></section>`;
}

function bcFlightSection(t) {
  return `<section id="bc-flight" class="bc-editorial-section"><p class="eyebrow">REFERENCE FLIGHT</p><h2>${L("航班摘要先說清楚","See the flight before you decide","Vea el vuelo antes de decidir")}</h2><div class="bc-flight-summary"><div><small>${L("票價關係","FARE STATUS","ESTADO")}</small><b>${bcTxt(t.flight.type)}</b></div><div><small>${L("去程示意","OUTBOUND SAMPLE","IDA")}</small><b>${t.flight.outbound}</b></div><div><small>${L("回程示意","RETURN SAMPLE","REGRESO")}</small><b>${t.flight.inbound}</b></div></div><p style="margin-top:10px;font-size:14px">${bcTxt(t.flight.note)}</p></section>`;
}

function bcItinerarySection(t) {
  const selected = bcDetailSelectedDay(t).day;
  const ledger = `<div class="bc-itinerary-ledger"><div class="bc-itinerary-ledger-head"><div><p class="eyebrow">COMPLETE DAILY PLAN</p><h3>${L("完整逐日行程","Complete daily itinerary","Itinerario diario completo")}</h3></div></div><div class="bc-day-list">${t.route.map(d=>{const movement=bcJourneyDayMovement(t,d);return `<button id="bc-day-${d.day}" class="bc-day-card ${selected===d.day?"active":""}" data-day="${d.day}" aria-pressed="${selected===d.day}"><span class="bc-day-number">${String(d.day).padStart(2,"0")}</span><span><h3>${bcTxt(d.city)}</h3><p>${bcTxt(d.sights)}</p><span class="bc-day-meta"><span>${L("交通","Transport","Transporte")}: ${bcTxt(movement.total)}</span><span>${L("餐食","Meals","Comidas")}: ${bcTxt(d.meals)}</span><span>${L("住宿","Stay","Hotel")}: ${bcTxt(d.hotel)}</span></span></span></button>`;}).join("")}</div></div>`;
  if (t.previewOnly) {
    state.poi = "";
    const experience = `<div class="bc-taiwan-map-only">${bcTaiwanRoutePoster(t)}</div>`;
    return `<section id="bc-itinerary" class="bc-editorial-section bc-itinerary-section bc-taiwan-itinerary">${experience}${ledger}</section>`;
  }
  const heading = t.previewOnly
    ? L("先選一天，再自由點每個景點。", "Choose a day, then open any place.", "Elija un día y luego cualquier lugar.")
    : L("這趟路線怎麼走，每一站做什麼", "See the route and what happens at every stop", "Vea la ruta y qué sucede en cada parada");
  const intro = t.previewOnly
    ? L("這是台灣本島近距離地圖，不是世界地圖。日期、路線、景點介紹、餐食與住宿使用同一份八日資料；地理點位與連線仍屬設計示意。", "This is a close-up Taiwan map, not a world map. Days, route, place stories, meals and stays share one eight-day dataset; points and lines remain a design approximation.", "Este es un mapa cercano de Taiwán. Días, ruta, lugares, comidas y hoteles comparten los mismos datos; los puntos siguen siendo una aproximación.")
    : L("地圖不是世界總覽，而是這一團的實際行經區域。點城市或日期後，照片、景點、餐食與住宿會一起切換。", "This is the journey's actual region, not a world overview. Choose a city or day to update the image, activities, meals and stay together.", "Esta es la región real del viaje, no un mapa mundial. Elija ciudad o día para actualizar imagen, actividades, comidas y hotel.");
  return `<section id="bc-itinerary" class="bc-editorial-section bc-itinerary-section"><div class="bc-itinerary-heading"><div><p class="eyebrow">DAY-BY-DAY CLOSE-UP MAP</p><h2>${heading}</h2></div><p>${intro}</p></div>${bcDetailRouteExplorer(t)}</section>`;
}

function bcCostSection(t) {
  return `<section id="bc-cost" class="bc-editorial-section"><p class="eyebrow">THE WHOLE COST</p><h2>${L("起價之外，還要知道最低總花費","Beyond the starting price, see the known trip total","Más allá del precio inicial, vea el total conocido")}</h2><div class="bc-cost-grid"><div class="bc-cost-column"><h3>${L("團費已含","Included","Incluido")}</h3><ul>${t.includes.map(x=>`<li>${bcTxt(x)}</li>`).join("")}</ul></div><div class="bc-cost-column"><h3>${L("必須另付","Required extra","Pago obligatorio")}</h3><ul>${t.required.map(x=>`<li>${bcCostText(x)}</li>`).join("")}</ul></div><div class="bc-cost-column dark"><h3>${L("可選自費","Optional","Opcional")}</h3><ul>${t.optional.map(x=>`<li>${bcCostText(x)}</li>`).join("")}</ul></div></div><div class="bc-estimate"><div><p class="eyebrow">${L("每人預估已知總花費・設計示意","ESTIMATED KNOWN TOTAL · DEMO","TOTAL CONOCIDO ESTIMADO · DEMO")}</p><h3>${L("依起始團費與列明必要支出計算","Starting tour price plus listed required costs","Precio inicial más costos obligatorios indicados")}</h3></div><strong>${money(t.estimate)}</strong></div></section>`;
}

function bcDatesSection(t) {
  return `<section id="bc-dates" class="bc-editorial-section"><p class="eyebrow">DEPARTURES · SAMPLE DATA</p><h2>${L("班期、餘位與價格放在同一列","Date, seats and price in one row","Fecha, plazas y precio en una sola fila")}</h2><div class="bc-departure-table">${t.departures.map(d=>`<div class="bc-departure-row"><div><b>${d.start} → ${d.end}</b><small>${bcTxt(d.status)}</small></div><div><small>${L("示意餘位","SAMPLE SEATS","PLAZAS")}</small><b>${d.seats} ${L("位","seats","plazas")}</b></div><div><small>${L("每人","PER PERSON","POR PERSONA")}</small><b>${money(d.price)}</b></div><button class="btn small" data-book data-book-date="${d.start}">${L("選擇","Choose","Elegir")}</button></div>`).join("")}</div></section>`;
}

function bcStayPolicySections(t) {
  return `<section id="bc-stay" class="bc-editorial-section"><p class="eyebrow">STAY & MOVEMENT</p><h2>${L("飯店與交通，不留到出發後才知道","Know the stay and transport before departure","Conozca hotel y transporte antes de salir")}</h2><div class="bc-info-split"><article class="bc-info-panel"><h3>${L("住宿示意","Hotel sample","Hotel de ejemplo")}</h3><p>${bcTxt(t.hotels)}</p></article><article class="bc-info-panel"><h3>${L("交通與體力","Transport and pace","Transporte y ritmo")}</h3><p>${bcTxt(t.transport)}</p></article></div></section>
  <section id="bc-policy" class="bc-editorial-section"><p class="eyebrow">CANCELLATION & TRUST</p><h2>${L("退改摘要與旅行社責任","Cancellation summary and agency trust","Resumen de cancelación y confianza")}</h2><div class="bc-info-split"><article class="bc-info-panel"><h3>${L("取消與退改摘要","Cancellation summary","Resumen de cancelación")}</h3><p>${bcTxt(t.cancellation)}</p></article><article class="bc-info-panel"><h3>${L("誰對這趟交易負責","Who stands behind the transaction","Quién responde por la transacción")}</h3><p>PACK&GO · California Seller of Travel CST #2166984 · Newark Business License #115594. ${L("TCRF 適用範圍依付款前揭露與加州法律。旅途中高風險事件由真人支援。","TCRF eligibility follows pre-payment disclosure and California law. People handle high-risk events during travel.","La elegibilidad TCRF depende de la divulgación previa y la ley de California. Una persona gestiona incidentes de alto riesgo.")}</p></article></div>${bcDemoNotice(L("取消條款、保障與信任資訊","cancellation, protections and trust information","cancelación, protecciones y confianza"))}</section>`;
}

function bcTaiwanGuidedHero(t) {
  return `<section class="bc-guided-detail-hero" aria-labelledby="bc-guided-detail-title">
    <figure class="bc-guided-hero-visual">
      <img src="${t.gallery[0]}" alt="${bcTxt(t.title)}" fetchpriority="high"/>
      <figcaption>${L("一座島・兩列特色列車・8 天 7 晚","ONE ISLAND · TWO SIGNATURE TRAINS · 8 DAYS / 7 NIGHTS","UNA ISLA · DOS TRENES · 8 DÍAS / 7 NOCHES")}</figcaption>
    </figure>
    <div class="bc-guided-detail-copy">
      <p class="eyebrow">${t.code} · ${L("台灣雙列車環島・設計示意","TWO-TRAIN TAIWAN CIRCUIT · DESIGN DEMO","CIRCUITO EN DOS TRENES · DEMO")}</p>
      <h1 id="bc-guided-detail-title"><span>${L("福森號 × 鳴日號","Formosensis × Future Express","Formosensis × Future Express")}</span><span>${L("經典台灣環島八日","Classic Taiwan Circuit","Circuito clásico de Taiwán")}</span></h1>
      <p>${L("兩列特色觀光列車，串起阿里山茶鄉、日月潭、台北人文與花東山海；八天從西部走向東部，再回到桃園。","Two signature trains connect Alishan tea country, Sun Moon Lake, Taipei culture and Taiwan’s eastern coast—an eight-day circuit from west to east and back to Taoyuan.","Dos trenes conectan Alishan, el lago Sun Moon, Taipéi y la costa este en un circuito de ocho días.")}</p>
      <dl class="bc-guided-answer-grid" aria-label="${L("行程一眼重點","Journey at a glance","Resumen del viaje")}">
        <div><dt>${L("路線","ROUTE","RUTA")}</dt><dd>${L("桃園 → 霧峰／嘉義 → 阿里山 → 日月潭 → 北埔／台北 → 台東 → 花蓮 → 南港／桃園","Taoyuan → Wufeng / Chiayi → Alishan → Sun Moon Lake → Beipu / Taipei → Taitung → Hualien → Nangang / Taoyuan","Taoyuan → Wufeng / Chiayi → Alishan → lago Sun Moon → Taipéi → Taitung → Hualien → Taoyuan")}</dd></div>
        <div><dt>${L("列車與接駁","RAIL & TRANSFERS","TRENES Y TRASLADOS")}</dt><dd>${L("福森號 D2・鳴日號 D6–D8・D7 九人座小巴","Formosensis D2 · Future Express D6–D8 · nine-seat minibus D7","Formosensis D2 · Future Express D6–D8 · minibús D7")}</dd></div>
        <div><dt>${L("餐食","MEALS","COMIDAS")}</dt><dd>${L("23 餐逐日列明・8 早／8 午／7 晚","23 listed meals · 8 breakfasts / 8 lunches / 7 dinners","23 comidas · 8 desayunos / 8 almuerzos / 7 cenas")}</dd></div>
        <div><dt>${L("飯店","HOTELS","HOTELES")}</dt><dd>${L("7 晚逐日列明・D7 來源明示五星","Seven nights listed · D7 explicitly five-star","Siete noches · D7 indicado como cinco estrellas")}</dd></div>
        <div><dt>${L("可訂狀態","BOOKING STATUS","DISPONIBILIDAD")}</dt><dd>${L("尚未開放・班期、售價與餘位待確認","Not open · departures, price and seats pending","No disponible · fechas, precio y plazas pendientes")}</dd></div>
      </dl>
      <div class="bc-guided-detail-question"><div><button class="bc-guided-primary" data-guided-start="map">${L("展開八日旅程","Explore the eight-day journey","Explorar los ocho días")}<span>↓</span></button><button data-guided-start="first">${L("直接從 D1 開始","Start directly with Day 1","Empezar por el día 1")}<span>→</span></button></div></div>
    </div>
  </section>`;
}

function bcTaiwanGuidedDecision(t) {
  const returnAction = state.mapStoryFocus
    ? `<button class="bc-guided-decision-link" data-map-story-overview>← ${L("回到八日全圖","Back to the eight-day map","Volver al mapa de ocho días")}</button>`
    : `<button class="bc-guided-decision-link" data-guided-start="map">← ${L("回到八日全圖","Back to the eight-day map","Volver al mapa de ocho días")}</button>`;
  return `<section id="bc-guided-decision" class="bc-guided-decision" aria-labelledby="bc-guided-decision-title"><header><div><p class="eyebrow">BOOKING STATUS · DESIGN DEMO</p><h2 id="bc-guided-decision-title" tabindex="-1">${L("喜歡這趟旅程？先確認可訂狀態。","Interested in this journey? Check booking status first.","¿Le interesa este viaje? Consulte primero la disponibilidad.")}</h2></div><p>${L("正式班期、每人價格與餘位尚未提供；資料接線後，這裡會直接進入日期、人數、旅客資料與總價確認。","Confirmed departures, per-person price and seats are not yet available. Once connected, this continues directly to date, guests, traveler details and total review.","Las fechas, el precio y las plazas aún no están disponibles. Al conectarse, seguirá a viajeros y total.")}</p></header><dl class="bc-guided-decision-status"><div><dt>${L("正式班期","DEPARTURES","SALIDAS")}</dt><dd>${L("尚未提供","Pending","Pendientes")}</dd></div><div><dt>${L("每人價格","PRICE PER PERSON","PRECIO POR PERSONA")}</dt><dd>${L("尚未提供","Pending","Pendiente")}</dd></div><div><dt>${L("目前狀態","CURRENT STATUS","ESTADO ACTUAL")}</dt><dd>${L("可查看流程・不可建立訂位","Flow preview · no booking created","Vista del flujo · sin reserva")}</dd></div></dl><div class="bc-guided-decision-actions">${returnAction}<button class="btn bc-guided-final-book" data-book>${L("查看可訂狀態","Check booking status","Ver disponibilidad")} →</button></div><small>${L("按下後只開啟狀態與訂購介面示意；不會建立訂位、扣款或寄信。","The button opens only the status and booking-interface demo; it creates no booking, charge or email.","El botón solo abre la demo; no crea reservas, cobros ni correos.")}</small></section>`;
}

function bcTaiwanBookingRail(t) {
  return `<aside class="bc-guided-booking-rail" aria-label="${L("查看可訂狀態・設計示意","Check booking status · design demo","Ver disponibilidad · demo")}"><div class="bc-guided-booking-name"><small>${t.code} · ${L("互動旅程","INTERACTIVE JOURNEY","VIAJE INTERACTIVO")}</small><strong>${bcTxt(t.title)}</strong></div><div class="bc-guided-booking-status"><small>${L("班期・每人價格","DATE · PRICE","FECHA · PRECIO")}</small><b>${L("正式資料待確認","Official details pending","Datos oficiales pendientes")}</b></div><button data-book><span><small>${L("狀態預覽・設計示意","STATUS PREVIEW · DESIGN DEMO","ESTADO · DEMO")}</small><b>${L("查看可訂狀態","Check booking status","Ver disponibilidad")}</b></span><i aria-hidden="true">→</i></button></aside>`;
}

function bcJourneyGuidedHero(t) {
  if (t.previewOnly) return bcTaiwanGuidedHero(t);
  const route = t.route.map(day => bcTxt(day.city).split("・")[0].split(" · ")[0]).join(" → ");
  const hotelLevel = bcHotelTier(t.route.find(day => !/行程結束|journey ends|fin del viaje|機上|overnight flight/i.test(bcTxt(day.hotel))) || t.route[0], t);
  return `<section class="bc-guided-detail-hero bc-commerce-guided-hero" aria-labelledby="bc-guided-detail-title">
    <figure class="bc-guided-hero-visual"><img src="${t.gallery[0]}" alt="${bcTxt(t.title)}" fetchpriority="high"/><figcaption>${t.days} ${L("天","DAYS","DÍAS")} · ${t.nights} ${L("晚","NIGHTS","NOCHES")} · ${bcTxt(t.destination)}</figcaption></figure>
    <div class="bc-guided-detail-copy">
      <p class="eyebrow">${t.code} · ${bcTxt(t.destination)} · ${L("設計示意","DESIGN DEMO","DEMO")}</p>
      <h1 id="bc-guided-detail-title"><span>${bcTxt(t.title)}</span></h1>
      <p>${t.features.map(bcTxt).join("・")}。${L("先用互動地圖看懂每天，再確認航班、完整費用、班期與退改。","Explore every day on the interactive map, then review flights, complete cost, departures and terms.","Explore cada día en el mapa y después revise vuelos, costo, fechas y condiciones.")}</p>
      <dl class="bc-guided-answer-grid" aria-label="${L("行程一眼重點","Journey at a glance","Resumen del viaje")}">
        <div><dt>${L("路線","ROUTE","RUTA")}</dt><dd>${route}</dd></div>
        <div><dt>${L("機票","AIRFARE","VUELO")}</dt><dd>${t.air?L("團費已含・航班仍待最終確認","Included · flight subject to final confirmation","Incluido · vuelo sujeto a confirmación"):L("團費另計・頁面提供預估","Separate · estimate shown below","No incluido · estimación abajo")}</dd></div>
        <div><dt>${L("餐食","MEALS","COMIDAS")}</dt><dd>${L(`${t.days} 天逐日標明早、午、晚餐`,`${t.days} days with breakfast, lunch and dinner status`,`Estado de desayuno, almuerzo y cena durante ${t.days} días`)}</dd></div>
        <div><dt>${L("飯店","HOTELS","HOTELES")}</dt><dd>${hotelLevel} · ${L("逐日列明","listed by day","indicado por día")}</dd></div>
        <div><dt>${L("可訂狀態","BOOKING STATUS","DISPONIBILIDAD")}</dt><dd>${bcTxt(t.status)} · ${t.nextDate} · ${money(t.price)} ${L("起","from","desde")}</dd></div>
      </dl>
      <div class="bc-guided-detail-question"><div><button class="bc-guided-primary" data-guided-start="map">${L(`展開 ${t.days} 日旅程`,`Explore all ${t.days} days`,`Explorar ${t.days} días`)}<span>↓</span></button><button data-guided-start="first">${L("直接從 D1 開始","Start directly with Day 1","Empezar por el día 1")}<span>→</span></button></div></div>
    </div>
  </section>`;
}

function bcJourneyGuidedDecision(t) {
  if (t.previewOnly) return bcTaiwanGuidedDecision(t);
  return `<section id="bc-guided-decision" class="bc-guided-decision" aria-labelledby="bc-guided-decision-title"><header><div><p class="eyebrow">BOOKING DECISION · DESIGN DEMO</p><h2 id="bc-guided-decision-title" tabindex="-1">${L("看懂旅程後，直接選班期與人數。","Once the journey is clear, choose a date and party size.","Cuando el viaje esté claro, elija fecha y viajeros.")}</h2></div><p>${L("最近班期、每人起價、機票關係與成團狀態先放在同一處；訂購抽屜會再顯示本次團費與預估已知總花費。","Next date, starting price, airfare and departure status stay together; the booking drawer then shows the party total and estimated known trip cost.","Fecha, precio, vuelo y estado aparecen juntos; el panel muestra el total del grupo y costo estimado.")}</p></header><dl class="bc-guided-decision-status"><div><dt>${L("最近班期","NEXT DEPARTURE","PRÓXIMA SALIDA")}</dt><dd>${t.nextDate} → ${t.returnDate}</dd></div><div><dt>${L("每人起價","FROM PER PERSON","DESDE POR PERSONA")}</dt><dd>${money(t.price)}</dd></div><div><dt>${L("目前狀態","CURRENT STATUS","ESTADO ACTUAL")}</dt><dd>${bcTxt(t.status)} · ${t.seats} ${L("位示意餘位","sample seats","plazas de ejemplo")}</dd></div></dl><div class="bc-guided-decision-actions"><button class="bc-guided-decision-link" data-guided-start="map">← ${L(`回到 ${t.days} 日全圖`,`Back to the ${t.days}-day map`,`Volver al mapa de ${t.days} días`)}</button><button class="btn bc-guided-final-book" data-book>${L("選日期與人數","Choose date and guests","Elegir fecha y viajeros")} →</button></div><small>${L("設計示意：按下後不會建立訂位、扣款或寄信。","Design demo: this creates no booking, charge or email.","Demo: no crea reservas, cobros ni correos.")}</small></section>`;
}

function bcJourneyBookingRail(t) {
  if (t.previewOnly) return bcTaiwanBookingRail(t);
  return `<aside class="bc-guided-booking-rail" aria-label="${L("選日期與人數・設計示意","Choose date and guests · design demo","Elegir fecha y viajeros · demo")}"><div class="bc-guided-booking-name"><small>${t.code} · ${t.days} ${L("日互動旅程","DAY INTERACTIVE JOURNEY","DÍAS · VIAJE INTERACTIVO")}</small><strong>${bcTxt(t.title)}</strong></div><div class="bc-guided-booking-status"><small>${L("最近班期・每人起","NEXT DATE · FROM","FECHA · DESDE")}</small><b>${t.nextDate} · ${money(t.price)}</b></div><button data-book><span><small>${bcTxt(t.status)}</small><b>${L("選日期與人數","Choose date and guests","Elegir fecha y viajeros")}</b></span><i aria-hidden="true">→</i></button></aside>`;
}

function bcTaiwanSourceNotes(collapsed = false) {
  const notes = [
    L("文件沒有正式出發日期、售價、餘位、團型與費用包含項目，因此訂購按鈕只開啟設計示意，不提供真實班期或交易。", "The source contains no confirmed date, price, seats, group size or inclusions, so the booking button opens only a design demo and offers no real departure or transaction."),
    L("福森號發車時間須以林鐵核定公告為主；鳴日號三段時刻與最終路線須以台鐵核准為主。", "Formosensis timing requires Alishan railway approval; Future Express segments and final routing require Taiwan Railways approval."),
    L("第 6 天需在發車前至少 20 分鐘完成報到；第 7 天部落路段使用 9 人座小巴。", "Day 6 requires check-in at least 20 minutes before departure; Day 7 uses nine-seat minibuses in the mountain community."),
    L("第 8 天晚間抵達南港後再送桃園機場，航班銜接尚待確認，不能視為已成立。", "The Day 8 airport connection after an evening Nangang arrival remains unresolved and is not presented as confirmed."),
    L("住宿名稱均保留『或同級』條件；本頁沒有假裝房間已訂妥。", "Hotel names retain the source's 'or equivalent' condition; no room is presented as booked."),
    L("照片取自提供文件，只限本地設計示意；正式公開前仍需確認素材使用權。", "Photos come from the supplied document for local design use only; publishing rights must be confirmed before release.")
  ];
  const content = `<section id="bc-source-notes" class="bc-editorial-section bc-taiwan-source-notes"><p class="eyebrow">SOURCE BOUNDARIES · DESIGN DEMO</p><h2>${L("哪些已經畫出來，哪些仍不能當成承諾。", "What is mapped—and what is not yet a promise.", "Qué está representado y qué aún no es una promesa.")}</h2><ol>${notes.map(note=>`<li>${note}</li>`).join("")}</ol><p>${L("台灣底圖採用 g0v twgeojson 的 CC0 縣市資料並做本地向量簡化；座標與路線只供體驗設計，不是導航。", "The Taiwan base uses CC0 county data from g0v twgeojson, locally simplified to SVG. Coordinates and route lines support interface design, not navigation.", "El mapa usa datos CC0 de g0v twgeojson, simplificados localmente. No es navegación.")}</p></section>`;
  if (!collapsed) return content;
  return `<details class="bc-guided-source-disclosure"><summary><span>${L("仍待確認的內容與素材邊界","Pending details and source boundaries","Detalles pendientes y límites de fuentes")}</span><b>${L("需要時再展開 6 項說明","Open six notes when needed","Abra seis notas cuando las necesite")}</b></summary>${content}</details>`;
}

function detailBC() {
  const t = bcCurrentTour();
  state.mapStoryDesign = "D";
  state.poi = "";
  const commerce = t.previewOnly
    ? bcTaiwanSourceNotes(true)
    : `<div class="bc-guided-commerce-details"><div class="bc-guided-commerce-intro"><p class="eyebrow">DECISION DETAILS</p><h2>${L("喜歡之後　所有交易問題一次解答","After the inspiration answer every transaction question","Después de inspirarse resuelva cada pregunta de compra")}</h2><p>${L("航班　完整費用　班期　飯店交通與退改責任都留在同一個詳情頁","Flights complete cost dates stay transport and terms remain on this one detail page","Vuelos costo fechas hotel transporte y condiciones permanecen en esta ficha")}</p></div>${bcFlightSection(t)}${bcCostSection(t)}${bcDatesSection(t)}${bcStayPolicySections(t)}</div>`;
  return `<main class="${t.previewOnly ? "bc-taiwan-detail" : "bc-destination-detail"} bc-guided-detail bc-unified-detail"><section id="bc-detail-overview" class="bc-shell bc-guided-detail-shell">${bcJourneyGuidedHero(t)}</section>${bcDetailNav()}${bcDetailDataState(t)}<section id="bc-guided-itinerary" class="bc-shell bc-guided-story-wrap">${bcTaiwanStoryD(t,"detail")}</section><section class="bc-shell bc-guided-detail-tail">${bcJourneyGuidedDecision(t)}${commerce}</section>${bcJourneyBookingRail(t)}</main>`;
}

function bcServiceHero(image, eyebrow, title, copy, briefTitle, briefCopy, position = "center", start = false, startLabel = "", startView = "") {
  const actionLabel = startLabel || L("開始整理需求","Start my brief","Empezar solicitud");
  const action = start ? startView
    ? `<button class="btn light bc-service-start" data-view="${startView}">${actionLabel} →</button>`
    : `<a class="btn light bc-service-start" href="#bc-service-flow">${actionLabel} →</a>`
    : "";
  return `<section class="bc-service-hero"><img src="${image}" alt="" style="object-position:${position}" fetchpriority="high"/><div class="bc-service-hero-inner bc-shell"><div class="bc-service-hero-copy"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${copy}</p>${action}</div><aside class="bc-service-brief"><p class="eyebrow">${L("服務入口","SERVICE PATH","RUTA DEL SERVICIO")}</p><h3>${briefTitle}</h3><p>${briefCopy}</p></aside></div></section>`;
}

function servicesBC() {
  return `<main>${bcServiceHero(BC_IMG.custom,"PACK&GO SERVICES",L("旅行不是只有買一個團。","Travel is more than buying a tour.","Viajar es más que comprar un circuito."),L("機票、中國簽證、客製旅行、接送與飯店各有清楚入口；私人包團由客製旅行依人數自動分流。","Flights, China visas, custom travel, transfers and hotels each have a clear path; private groups branch inside custom travel by party size.","Vuelos, visado chino, viajes a medida, traslados y hoteles tienen rutas claras; los grupos se derivan según su tamaño."),L("五類需求，五個入口","Five needs, five paths","Cinco necesidades, cinco rutas"),L("每個入口先說明費用、付款對象、責任與下一步，不從空白訊息開始。","Each path explains cost, payee, responsibility and next step before asking for a message.","Cada ruta explica costo, responsable y siguiente paso antes de pedir un mensaje."),"center 52%")}
  <section class="bc-shell section"><div class="bc-section-head"><div><p class="eyebrow">START IN THE RIGHT PLACE</p><h2>${L("先找到正確入口，再完成事情。","Find the right path, then finish the task.","Encuentre la ruta correcta y complete la tarea.")}</h2></div><p>${L("所有流程只收必要資料，行動前揭露價格與責任，例外才升級給真人。","Every flow collects only necessary data, discloses price and responsibility before action, and escalates exceptions.","Cada flujo recoge solo lo necesario, revela precio y responsabilidad y escala excepciones.")}</p></div>${bcDemoNotice()}${bcServiceRows()}</section>
  <section class="bc-shell section-tight"><div class="bc-info-split"><article class="bc-info-panel"><p class="eyebrow">01 · SELF-SERVICE</p><h3>${L("標準需求直接前進","Standard requests move directly","Las solicitudes estándar avanzan")}</h3><p>${L("清楚選項收齊目的地、日期、人數、行李與文件狀態。","Clear choices collect destination, dates, guests, baggage and document status.","Opciones claras reúnen destino, fechas, viajeros, equipaje y documentos.")}</p></article><article class="bc-info-panel dark"><p class="eyebrow">02 · HUMAN REVIEW</p><h3>${L("真正需要判斷才接手","People handle real judgment","Las personas resuelven excepciones")}</h3><p>${L("複雜改票、特殊身分、無障礙與高風險案件進入人工支援。","Complex changes, special status, accessibility and high-risk cases move to human support.","Cambios complejos, situaciones especiales y casos de alto riesgo pasan a soporte humano.")}</p></article></div></section></main>`;
}

function legacy_flightsBC() {
  return `<main>${bcServiceHero(BC_IMG.plane,"FLIGHTS",L("先比較整趟成本，不只看第一個票價。","Compare the whole trip cost, not the first fare.","Compare el costo total, no solo la primera tarifa."),L("標準來回先自助看行李、轉機、退改與最終付款對象；多城市、特殊行李與複雜改票再交給真人。","For standard round trips, compare baggage, connections, changes and payee. People handle multi-city, special baggage and complex changes.","Para viajes estándar compare equipaje, escalas, cambios y quién cobra. Los casos complejos pasan a una persona."),L("自己比價，清楚付款","Compare and pay clearly","Compare y pague con claridad"),L("正式版本若導向合作平台，必須先揭露 PACK&GO 是否取得佣金，以及由誰出票與退款。","A production partner link must disclose any PACK&GO commission and who tickets or refunds.","Un enlace asociado debe revelar comisión y quién emite o reembolsa."),"center 58%")}
  <section class="bc-shell section"><div class="bc-service-layout"><div><section class="bc-form-section"><p class="eyebrow">SEARCH BRIEF · DESIGN DEMO</p><h2>${L("建立一次清楚的航班搜尋","Build one clear flight search","Cree una búsqueda clara")}</h2><p>${L("這個原型不會開外站、不會出票，也不會建立機票訂單。","This prototype opens no external site, issues no ticket and creates no flight order.","Este prototipo no abre sitios externos, emite billetes ni crea pedidos.")}</p><div class="bc-field-grid"><div class="bc-field"><label>${L("出發地","FROM","ORIGEN")}</label><input value="SFO"/></div><div class="bc-field"><label>${L("目的地","TO","DESTINO")}</label><input value="MAD"/></div><div class="bc-field"><label>${L("去程","DEPARTURE","IDA")}</label><input type="date" value="2026-10-03"/></div><div class="bc-field"><label>${L("回程","RETURN","REGRESO")}</label><input type="date" value="2026-10-09"/></div><div class="bc-field"><label>${L("旅客","TRAVELERS","VIAJEROS")}</label><select><option>2 ${L("位成人","adults","adultos")}</option></select></div><div class="bc-field"><label>${L("艙等","CABIN","CABINA")}</label><select><option>${L("經濟艙","Economy","Económica")}</option><option>${L("豪華經濟艙","Premium economy","Económica prémium")}</option></select></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("查看示意搜尋結果","View sample results","Ver resultados de ejemplo")}</button><span class="bc-demo-stamp">${L("設計示意・不會導向外站","DESIGN DEMO · NO REDIRECT","DEMO · SIN REDIRECCIÓN")}</span></div></section>
    <section class="bc-editorial-section"><p class="eyebrow">COMPARE BEFORE BUYING</p><h2>${L("票價後面，還有四件要比較","Four facts sit behind the fare","Cuatro datos detrás de la tarifa")}</h2><div class="bc-step-list"><div class="bc-step-row"><h3>${L("行李","Baggage","Equipaje")}</h3><p>${L("隨身、托運與超尺寸規則要和總價一起顯示。","Carry-on, checked and oversized rules belong beside the total.","Equipaje de mano, facturado y especial junto al total.")}</p></div><div class="bc-step-row"><h3>${L("轉機","Connections","Escalas")}</h3><p>${L("機場、停留時間、是否過夜與是否需重新托運。","Airport, layover, overnight and re-check information.","Aeropuerto, duración, noche y nueva facturación.")}</p></div><div class="bc-step-row"><h3>${L("退改","Changes","Cambios")}</h3><p>${L("可否退、改票費與票差，不只寫模糊的『依航空公司』。","Refundability, change fee and fare difference, stated plainly.","Reembolso, cargo por cambio y diferencia tarifaria.")}</p></div><div class="bc-step-row"><h3>${L("付款責任","Payee","Responsable del cobro")}</h3><p>${L("付款前顯示由航空公司、合作平台或 PACK&GO 收款。","Show whether the airline, partner or PACK&GO receives payment.","Muestre si cobra la aerolínea, socio o PACK&GO.")}</p></div></div></section></div>
    <aside class="bc-service-aside"><div class="bc-aside-panel"><p class="eyebrow">SELF-SERVICE FIRST</p><h3>${L("標準來回票","Standard round trip","Ida y vuelta estándar")}</h3><p>${L("比價後由旅客在明示的出票平台完成。","The traveler completes purchase on the disclosed ticketing platform.","El viajero compra en la plataforma de emisión indicada.")}</p><div class="bc-aside-list"><div><span>${L("搜尋與付款","Search & pay","Buscar y pagar")}</span><b>${L("合作平台","Partner","Socio")}</b></div><div><span>${L("售後與退款","Changes & refunds","Cambios y reembolsos")}</span><b>${L("依出票方","Ticketing party","Emisor")}</b></div></div></div><div class="bc-aside-panel light"><h3>${L("什麼時候交給真人","When a person steps in","Cuándo interviene una persona")}</h3><p>${L("多城市、嬰兒、輪椅、寵物、特殊行李、姓名錯誤或複雜改票。","Multi-city, infants, wheelchairs, pets, special baggage, name errors or complex changes.","Multiciudad, bebés, silla de ruedas, mascotas, equipaje especial o cambios complejos.")}</p><button class="btn ghost wide" style="margin-top:16px" data-view="contact">${L("建立機票支援案件","Open flight support","Abrir soporte de vuelo")}</button></div></aside></div></section></main>`;
}

function legacy_visaBC() {
  return `<main>${bcServiceHero(BC_IMG.passport,"VISAS & DOCUMENTS",L("先判斷適用規則，再收必要文件。","Check the rule before collecting documents.","Verifique la regla antes de pedir documentos."),L("護照國籍、居留地、目的地與出發日期決定應查哪一套規則。第一步不需要上傳護照。","Passport nationality, residence, destination and date determine which rules apply. No passport upload is needed first.","Nacionalidad, residencia, destino y fecha determinan las reglas. No suba el pasaporte al inicio."),L("先做免費判斷","Start with a free check","Empiece con una comprobación"),L("正式服務必須連到可追溯的領館或政府來源；不保證核准，也不提供法律意見。","Production must link to traceable official sources. Approval is not guaranteed and this is not legal advice.","La versión final debe enlazar fuentes oficiales. No garantiza aprobación ni ofrece asesoría legal."),"center 46%")}
  <section class="bc-shell section"><div class="bc-service-layout"><div><section class="bc-form-section"><p class="eyebrow">QUICK CHECK · DESIGN DEMO</p><h2>${L("四個條件先決定下一步","Four facts determine the next step","Cuatro datos determinan el siguiente paso")}</h2><div class="bc-field-grid"><div class="bc-field"><label>${L("護照國籍","PASSPORT NATIONALITY","NACIONALIDAD")}</label><select><option>${L("請選擇","Choose","Elegir")}</option><option>${L("美國","United States","Estados Unidos")}</option><option>${L("台灣","Taiwan","Taiwán")}</option></select></div><div class="bc-field"><label>${L("目前居留地","RESIDENCE","RESIDENCIA")}</label><select><option>${L("美國","United States","Estados Unidos")}</option><option>${L("台灣","Taiwan","Taiwán")}</option></select></div><div class="bc-field"><label>${L("目的地","DESTINATION","DESTINO")}</label><input value="China"/></div><div class="bc-field"><label>${L("預計出發日","DEPARTURE","SALIDA")}</label><input type="date" value="2026-11-15"/></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("建立文件清單示意","Build sample checklist","Crear lista de ejemplo")}</button><span class="bc-demo-stamp">${L("不會上傳或送件","NO UPLOAD OR SUBMISSION","SIN CARGA NI ENVÍO")}</span></div></section>
    <section class="bc-editorial-section"><p class="eyebrow">AVAILABLE SERVICES</p><h2>${L("先選辦理項目，不從泛用表單開始","Choose the service before the form","Elija el servicio antes del formulario")}</h2><div class="bc-data-table"><div class="bc-data-row"><div><b>${L("中國簽證文件協助","China visa document service","Servicio de visado chino")}</b><small>${L("灣區送件流程・資格與文件預檢","Bay Area process · eligibility and document pre-check","Proceso Bay Area · preselección")}</small></div><div>${money(290)} ${L("起","from","desde")}</div><div>10–15 ${L("工作天示意","sample business days","días hábiles")}</div><button class="btn small" data-view="china-visa">${L("查看詳情","Details","Detalles")}</button></div><div class="bc-data-row"><div><b>${L("其他國家旅行文件","Other travel documents","Otros documentos")}</b><small>${L("依目的地官方規則判斷","Based on official destination rules","Según reglas oficiales")}</small></div><div>—</div><div>${L("規劃中","Planned","Planificado")}</div><button class="btn ghost small" disabled>${L("尚未開放","Unavailable","No disponible")}</button></div></div></section></div>
    <aside class="bc-service-aside"><div class="bc-aside-panel"><p class="eyebrow">DOCUMENT MINIMIZATION</p><h3>${L("先不要上傳護照","Do not upload a passport yet","No suba el pasaporte todavía")}</h3><p>${L("只有確認服務適用、建立安全案件後，才收完成案件所需資料。","Necessary documents are collected only after eligibility and a secure case are established.","Los documentos se recogen solo tras confirmar elegibilidad y crear un caso seguro.")}</p></div><div class="bc-aside-panel light"><h3>${L("責任邊界","Responsibility","Responsabilidad")}</h3><p>${L("PACK&GO 協助文件與流程，不代表領館、不保證核准，也不是移民法律意見。","PACK&GO assists with documents and process; it is not a consulate, does not guarantee approval and gives no immigration legal advice.","PACK&GO ayuda con documentos; no es consulado, no garantiza aprobación ni da asesoría legal.")}</p></div></aside></div></section></main>`;
}

function legacy_chinaVisaBC() {
  return `<main>${bcServiceHero(BC_IMG.passport,"CHINA VISA · BAY AREA",L("中國簽證，先預檢再付款。","China visa: pre-check before payment.","Visado chino: revisión antes del pago."),L("先確認護照、過往身分、旅行目的與出發日，再顯示適用清單、費用與預估工作天。","Confirm passport, prior status, purpose and date before showing the checklist, fees and timing.","Confirme pasaporte, estatus previo, motivo y fecha antes de ver documentos, costos y plazos."),L("個人服務費示意 ${money(290)}",`Individual service demo ${money(290)}`,`Servicio individual ${money(290)}`),L("領館費、快遞與其他第三方費用另列；正式發布前須重新核對官方要求。","Consular, courier and third-party fees are separate. Official requirements must be rechecked before production.","Tasas consulares, mensajería y terceros se separan. Revalidar requisitos oficiales antes de publicar."),"center 44%")}
  <section class="bc-shell section"><div class="bc-service-layout"><div><section class="bc-form-section"><p class="eyebrow">ELIGIBILITY PRE-CHECK · DEMO</p><h2>${L("四件事決定適用清單","Four facts determine the checklist","Cuatro datos determinan la lista")}</h2><div class="bc-field-grid"><div class="bc-field"><label>${L("護照國籍","PASSPORT","PASAPORTE")}</label><select><option>${L("美國","United States","Estados Unidos")}</option><option>${L("其他","Other","Otro")}</option></select></div><div class="bc-field"><label>${L("曾持有中國護照或身分","PRIOR CHINESE STATUS","ESTATUS CHINO PREVIO")}</label><select><option>${L("請選擇","Choose","Elegir")}</option><option>${L("是","Yes","Sí")}</option><option>${L("否","No","No")}</option></select></div><div class="bc-field"><label>${L("旅行目的","PURPOSE","MOTIVO")}</label><select><option>${L("觀光","Tourism","Turismo")}</option><option>${L("探親","Family visit","Visita familiar")}</option><option>${L("商務","Business","Negocios")}</option></select></div><div class="bc-field"><label>${L("預計出發日","DEPARTURE","SALIDA")}</label><input type="date" value="2026-11-15"/></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("建立適用清單示意","Build sample checklist","Crear lista de ejemplo")}</button><span class="bc-demo-stamp">${L("資格預檢・不送件","PRE-CHECK · NO SUBMISSION","REVISIÓN · SIN ENVÍO")}</span></div></section>
    <section class="bc-editorial-section"><p class="eyebrow">PROCESS</p><h2>${L("每一步都知道狀態與下一個動作","Every step has a state and next action","Cada paso tiene estado y siguiente acción")}</h2><div class="bc-step-list"><div class="bc-step-row"><h3>${L("資格預檢","Eligibility","Elegibilidad")}</h3><p>${L("確認申請類型、重大缺件與是否需要專業法律協助。","Confirm application type, major gaps and whether legal help is needed.","Confirme tipo, faltantes y si se necesita ayuda legal.")}</p></div><div class="bc-step-row"><h3>${L("報價與同意","Quote & consent","Cotización y consentimiento")}</h3><p>${L("服務費、領館費、快遞費與不可退項目分開列。","Separate service, consular, courier and non-refundable items.","Separe servicio, consulado, mensajería y no reembolsables.")}</p></div><div class="bc-step-row"><h3>${L("安全收件","Secure documents","Documentos seguros")}</h3><p>${L("只在建立案件後收必要文件；不以一般 Email 索取敏感資料。","Collect necessary documents only after a case exists; avoid ordinary email for sensitive files.","Recoja documentos solo tras crear el caso; no use correo común para datos sensibles.")}</p></div><div class="bc-step-row"><h3>${L("送件與追蹤","Submission & tracking","Envío y seguimiento")}</h3><p>${L("正式版顯示已收件、待補件、已送領館、領回與完成。","Production shows received, missing, submitted, collected and complete states.","La versión final muestra recibido, faltante, enviado, recogido y completo.")}</p></div></div></section>
    <section class="bc-editorial-section"><p class="eyebrow">SAMPLE CHECKLIST</p><h2>${L("常見文件，不等於每個人都適用","Common documents are not universal","Los documentos comunes no aplican a todos")}</h2><div class="bc-data-table"><div class="bc-data-row"><div><b>${L("有效護照與簽名頁","Valid passport and signature page","Pasaporte válido y firma")}</b><small>${L("建立案件後才安全收取","Collected securely after case creation","Recogido tras crear el caso")}</small></div><div>${L("必要","Required","Obligatorio")}</div><div>${L("待預檢","Pending pre-check","Pendiente")}</div><button class="btn ghost small" disabled>${L("尚未開放","Unavailable","No disponible")}</button></div><div class="bc-data-row"><div><b>${L("照片與申請表","Photo and application form","Foto y formulario")}</b><small>${L("規格依官方最新要求","Based on current official specification","Según requisito oficial vigente")}</small></div><div>${L("必要","Required","Obligatorio")}</div><div>${L("待預檢","Pending pre-check","Pendiente")}</div><button class="btn ghost small" disabled>${L("尚未開放","Unavailable","No disponible")}</button></div></div></section></div>
    <aside class="bc-service-aside"><div class="bc-aside-panel"><p class="eyebrow">COST · DESIGN SAMPLE</p><h3>${L("費用分開列","Costs stay separate","Costos separados")}</h3><div class="bc-aside-list"><div><span>${L("個人服務費","Individual service","Servicio individual")}</span><b>${money(290)}</b></div><div><span>${L("團體服務費","Group service","Servicio grupal")}</span><b>${money(275)}</b></div><div><span>${L("預估工作天","Estimated business days","Días hábiles")}</span><b>10–15</b></div><div><span>${L("領館與第三方費用","Consular & third party","Consulado y terceros")}</span><b>${L("另列","Separate","Aparte")}</b></div></div></div><div class="bc-aside-panel light"><h3>${L("不是核准保證","No approval guarantee","Sin garantía de aprobación")}</h3><p>${L("本服務是文件與流程協助，不代表中國領館，也不提供移民法律意見。","This is document and process assistance, not a consulate or immigration legal advice.","Es asistencia documental, no representa al consulado ni ofrece asesoría legal.")}</p><button class="btn wide" style="margin-top:16px" data-demo-action>${L("開始資格預檢示意","Start pre-check demo","Iniciar revisión de ejemplo")}</button></div></aside></div></section></main>`;
}

function legacy_customBC() {
  return `<main>${bcServiceHero(BC_IMG.custom,"CUSTOM TRAVEL",L("把真正重要的條件，一次說清楚。","State what truly matters, once.","Explique lo que importa, una sola vez."),L("日期、價位、節奏、同行者與不可妥協條件先整理成完整 brief，再由顧問處理真正需要判斷的部分。","Turn dates, price range, pace, travelers and must-haves into one complete brief before an advisor handles the judgment.","Convierta fechas, precio, ritmo, viajeros e imprescindibles en un brief completo."),L("先建立需求草稿","Start with a travel brief","Empiece con un brief"),L("這裡不需要從『想去哪裡』的空白訊息開始，也不會在原型中送出任何資料。","No blank “where do you want to go?” message, and this prototype sends nothing.","No empiece con un mensaje vacío y este prototipo no envía datos."),"center 54%")}
  <section class="bc-shell section"><div class="bc-service-layout"><section class="bc-form-section"><p class="eyebrow">TRAVEL BRIEF · DESIGN DEMO</p><h2>${L("建立可判斷的旅行需求","Create a brief an advisor can act on","Cree un brief que se pueda evaluar")}</h2><div class="bc-field-grid"><div class="bc-field"><label>${L("想去的地區","DESTINATION","DESTINO")}</label><input placeholder="Japan / Spain / Not sure"/></div><div class="bc-field"><label>${L("同行人數","TRAVELERS","VIAJEROS")}</label><select><option>4 ${L("位","travelers","viajeros")}</option></select></div><div class="bc-field"><label>${L("最早出發日","EARLIEST DEPARTURE","SALIDA MÁS TEMPRANA")}</label><input type="date" value="2026-12-05"/></div><div class="bc-field"><label>${L("旅行天數","DURATION","DURACIÓN")}</label><select><option>8–10 ${L("天","days","días")}</option></select></div><div class="bc-field"><label>${L("每人價位","PRICE RANGE PER PERSON","RANGO DE PRECIO POR PERSONA")}</label><select><option>${money(3000)}–${money(4500)}</option></select></div><div class="bc-field"><label>${L("旅行節奏","PACE","RITMO")}</label><select><option>${L("舒適慢行","Comfortable and slow","Cómodo y pausado")}</option></select></div><div class="bc-field full"><label>${L("不可妥協條件與特殊需求","MUST-HAVES & SPECIAL NEEDS","IMPRESCINDIBLES Y NECESIDADES")}</label><textarea placeholder="${L("例如：長者同行、無障礙、連通房、飲食限制","For example: seniors, accessibility, connected rooms, dietary needs","Por ejemplo: mayores, accesibilidad, habitaciones conectadas, dieta")}"></textarea></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("建立需求草稿・設計示意","Create brief · design demo","Crear brief · demo")}</button><span class="bc-demo-stamp">${L("不會送出資料","NO DATA IS SENT","NO SE ENVÍAN DATOS")}</span></div></section>
    <aside class="bc-service-aside"><div class="bc-aside-panel"><p class="eyebrow">WHAT HAPPENS NEXT</p><h3>${L("先分流，再由人判斷","Route first, then human judgment","Primero clasificar, luego evaluar")}</h3><div class="bc-aside-list"><div><span>${L("接近現有團","Near a current tour","Similar a un circuito")}</span><b>${L("比較標準團","Compare","Comparar")}</b></div><div><span>${L("條件可客製","Customizable","Personalizable")}</span><b>${L("建立提案","Proposal","Propuesta")}</b></div><div><span>${L("高風險或不可行","High risk / infeasible","Alto riesgo")}</span><b>${L("真人說明","Human review","Revisión humana")}</b></div></div></div><div class="bc-aside-panel light"><h3>${L("預期回覆","Expected response","Respuesta esperada")}</h3><p>${L("正式版本應顯示案件已建立、預計回覆時間、需要補充的資訊與下一步，不只寄一封表單 Email。","Production should show case creation, expected response, missing facts and next step—not only send a form email.","La versión final debe mostrar caso, plazo, datos faltantes y siguiente paso; no solo enviar un correo.")}</p></div></aside></div></section></main>`;
}

function legacy_groupBC() {
  const paths = [
    {
      no: "01", type: "STANDARD", title: L("現有團包位","Block seats on a current tour","Bloquear plazas en un circuito"),
      copy: L("沿用已公布的日期、路線與團體條件，先確認同一班期是否有足夠席位。","Keep the published date, route and tour terms, then confirm enough seats on one departure.","Mantenga fecha, ruta y condiciones publicadas y confirme plazas en una salida."),
      size: "6–12", change: L("不調整路線","Fixed route","Ruta fija"), lead: L("最快 2–3 個工作天","2–3 business days","2–3 días hábiles"), action: `data-view="tours"`, cta: L("比較現有團","Compare tours","Comparar circuitos")
    },
    {
      no: "02", type: "ADAPTED", title: L("微調現有路線","Adapt a proven route","Adaptar una ruta existente"),
      copy: L("保留成熟行程骨架，調整節奏、房型、餐食或加入一次團體活動；需重新確認供應商。","Keep a proven itinerary, then adjust pace, rooms, meals or one group activity; suppliers must reconfirm.","Conserve una ruta probada y ajuste ritmo, habitaciones, comidas o una actividad; requiere reconfirmación."),
      size: "10–24", change: L("有限度調整","Selected changes","Cambios puntuales"), lead: L("約 5–7 個工作天","5–7 business days","5–7 días hábiles"), action: "data-demo-action", cta: L("評估微調方案","Assess adaptation","Evaluar adaptación")
    },
    {
      no: "03", type: "CUSTOM", title: L("從零設計包團","Build a fully custom group","Crear un grupo a medida"),
      copy: L("依共同目標、價位與特殊需求重新規劃交通、住宿與活動，價格要等完整詢價後才能確認。","Design transport, stays and activities around the group goal, price range and special needs; price follows a full supplier quote.","Diseñe transporte, estancias y actividades según objetivos y precio; el precio requiere cotización completa."),
      size: "12+", change: L("完整客製","Full custom","Totalmente a medida"), lead: L("約 10–15 個工作天","10–15 business days","10–15 días hábiles"), action: `data-view="custom"`, cta: L("建立客製需求","Build custom brief","Crear brief a medida")
    }
  ];
  return `<main class="bc-group-page">${bcServiceHero(BC_IMG.group,"PRIVATE GROUPS",L("同一群人，也不必塞進同一種團。","One group does not mean one rigid format.","Un grupo no necesita un formato rígido."),L("親友、社團、學校與企業先確認人數、日期、共同目標與特殊條件，再決定包現有團、調整路線或重新設計。","Families, clubs, schools and companies first confirm size, date, purpose and special needs, then choose a standard, adjusted or custom route.","Familias, clubes, escuelas y empresas definen tamaño, fecha, objetivo y necesidades antes de elegir ruta."),L("先比較三種包團方式","Compare three group paths","Compare tres opciones"),L("標準團包位、微調現有路線與全客製的成本與作業時間不同，應先分流。","Blocking seats, adapting a route and full custom work have different cost and lead time.","Bloquear plazas, adaptar una ruta y crear una nueva tienen costos y plazos distintos."),"center 58%")}
  <section class="bc-shell section bc-group-path-section"><header class="bc-group-section-head"><div><p class="eyebrow">CHOOSE THE RIGHT FORMAT</p><h2>${L("不是人越多，就越需要全客製。","A larger group does not always need full custom.","Un grupo grande no siempre necesita un viaje totalmente a medida.")}</h2></div><p>${L("先用人數、可調整程度與作業時間排除不合適的方式，再進入需求整理。","Use group size, flexibility and lead time to rule out the wrong format before building a brief.","Use tamaño, flexibilidad y plazo para descartar la opción incorrecta antes de crear el brief.")}</p></header>
    <div class="bc-group-paths">${paths.map(path=>`<article class="bc-group-path"><span class="bc-group-path-number">${path.no}</span><div class="bc-group-path-title"><p class="eyebrow">${path.type}</p><h3>${path.title}</h3></div><p class="bc-group-path-copy">${path.copy}</p><div class="bc-group-path-facts"><span><small>${L("適合人數","GROUP SIZE","TAMAÑO")}</small><b>${path.size}</b></span><span><small>${L("可調整程度","FLEXIBILITY","FLEXIBILIDAD")}</small><b>${path.change}</b></span><span><small>${L("初步回覆","FIRST RESPONSE","PRIMERA RESPUESTA")}</small><b>${path.lead}</b></span></div><button class="bc-group-path-action" ${path.action}>${path.cta}<span aria-hidden="true">→</span></button></article>`).join("")}</div>
    <div class="bc-group-workspace"><section class="bc-group-form" aria-labelledby="bc-group-brief-title"><p class="eyebrow">GROUP BRIEF · DESIGN DEMO</p><h2 id="bc-group-brief-title">${L("先把共同條件收齊","Collect the shared facts once","Reúna los datos comunes")}</h2><p>${L("五項資料足以先判斷適合哪條路徑；正式版送出前才會再次確認聯絡資訊與資料使用方式。","Five facts are enough to recommend a path; production would confirm contact details and data use before submission.","Cinco datos bastan para recomendar una ruta; la versión final confirmará contacto y uso de datos antes del envío.")}</p><div class="bc-field-grid bc-group-field-grid"><div class="bc-field"><label for="bc-group-type">${L("團體類型","GROUP TYPE","TIPO DE GRUPO")}</label><select id="bc-group-type" name="group-type"><option>${L("親友家庭","Family & friends","Familia y amigos")}</option><option>${L("企業","Corporate","Empresa")}</option><option>${L("社團學校","Club or school","Club o escuela")}</option></select></div><div class="bc-field"><label for="bc-group-size">${L("預估人數","GROUP SIZE","TAMAÑO")}</label><select id="bc-group-size" name="group-size"><option>12–18</option><option>6–11</option><option>19–30</option><option>31+</option></select></div><div class="bc-field"><label for="bc-group-departure">${L("希望出發日","DEPARTURE","SALIDA")}</label><input id="bc-group-departure" name="departure" type="date" value="2027-01-16"/></div><div class="bc-field"><label for="bc-group-destination">${L("目的地","DESTINATION","DESTINO")}</label><input id="bc-group-destination" name="destination" value="Spain"/></div><div class="bc-field full"><label for="bc-group-must-haves">${L("共同目標與必要條件","PURPOSE & MUST-HAVES","OBJETIVO E IMPRESCINDIBLES")}</label><textarea id="bc-group-must-haves" name="must-haves" placeholder="${L("慶祝、團建、長者同行、特殊飲食、會議時段…","Celebration, offsite, seniors, dietary needs, meeting time…","Celebración, empresa, mayores, dieta, reuniones…")}"></textarea></div></div><div class="bc-group-form-actions"><button class="btn" data-demo-action>${L("查看建議包團方式","See recommended group path","Ver opción recomendada")}</button><p>${L("設計示意，不會建立報價案件或送出資料。","Design demo; no quote case or data submission is created.","Demo de diseño; no crea cotización ni envía datos.")}</p></div></section>
    <aside class="bc-group-summary"><p class="eyebrow">WHAT YOU RECEIVE</p><h3>${L("下一步要具體，不是『我們會聯絡你』。","The next step should be specific—not “we’ll contact you.”","El siguiente paso debe ser concreto, no “le contactaremos”.")}</h3><p>${L("正式流程會先回傳適合路徑、估計作業時間與缺少條件，再決定是否需要顧問介入。","Production would first return a recommended path, expected timing and missing facts before advisor review.","La versión final devolverá ruta recomendada, plazo y datos faltantes antes de la revisión humana.")}</p><div class="bc-group-summary-list"><div><span>01</span><b>${L("建議包團方式","Recommended format","Formato recomendado")}</b></div><div><span>02</span><b>${L("可行性與待確認項目","Feasibility and open facts","Viabilidad y datos pendientes")}</b></div><div><span>03</span><b>${L("初步時間表與下一動作","Initial timing and next action","Plazo inicial y siguiente acción")}</b></div></div><small>${L("設計示意・未接供應商詢價或案件系統","DESIGN DEMO · NO SUPPLIER OR CASE SYSTEM","DEMO · SIN PROVEEDOR NI SISTEMA DE CASOS")}</small></aside></div></section></main>`;
}

function legacy_transferBC() {
  return `<main>${bcServiceHero(BC_IMG.transfer,"AIRPORT TRANSFER",L("航班、地址、人數與行李，一次確認。","Flight, address, guests and baggage—confirmed once.","Vuelo, dirección, viajeros y equipaje, confirmados una vez."),L("標準機場接送先顯示車型、可載人數、行李限制、等待時間與取消規則；特殊情況才交給真人。","Standard transfers show vehicle, capacity, baggage, waiting and cancellation before exceptions reach a person.","Los traslados estándar muestran vehículo, capacidad, equipaje, espera y cancelación antes de escalar excepciones."),L("價格前先確認四項資料","Four facts before price","Cuatro datos antes del precio"),L("此原型不派車、不向供應商送單，也不會扣款。","This prototype dispatches no vehicle, sends no supplier order and charges nothing.","Este prototipo no despacha vehículos, envía pedidos ni cobra."),"center 58%")}
  <section class="bc-shell section"><div class="bc-service-layout"><section class="bc-form-section"><p class="eyebrow">TRANSFER QUOTE · DESIGN DEMO</p><h2>${L("建立接送需求","Build a transfer request","Crear solicitud de traslado")}</h2><div class="bc-field-grid"><div class="bc-field"><label>${L("機場","AIRPORT","AEROPUERTO")}</label><select><option>SFO</option><option>OAK</option><option>SJC</option></select></div><div class="bc-field"><label>${L("航班號","FLIGHT","VUELO")}</label><input value="UA 194"/></div><div class="bc-field full"><label>${L("接送地址","ADDRESS","DIRECCIÓN")}</label><input value="Newark, CA"/></div><div class="bc-field"><label>${L("抵達日期","ARRIVAL DATE","FECHA DE LLEGADA")}</label><input type="date" value="2026-10-09"/></div><div class="bc-field"><label>${L("抵達時間","ARRIVAL TIME","HORA")}</label><input type="time" value="14:35"/></div><div class="bc-field"><label>${L("人數","GUESTS","VIAJEROS")}</label><select><option>4</option></select></div><div class="bc-field"><label>${L("大型行李","LARGE BAGS","MALETAS GRANDES")}</label><select><option>4</option></select></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("查看示意車型與估價","View sample vehicle & quote","Ver vehículo y precio de ejemplo")}</button><span class="bc-demo-stamp">${L("不派車・不送單","NO DISPATCH","SIN DESPACHO")}</span></div></section><aside class="bc-service-aside"><div class="bc-aside-panel"><p class="eyebrow">SAMPLE RESPONSIBILITY</p><h3>${L("付款前必須看見","Must appear before payment","Debe verse antes del pago")}</h3><div class="bc-aside-list"><div><span>${L("車型與容量","Vehicle & capacity","Vehículo y capacidad")}</span><b>${L("明示","Shown","Visible")}</b></div><div><span>${L("免費等待","Included wait","Espera incluida")}</span><b>60 min</b></div><div><span>${L("超時費","Overtime","Tiempo extra")}</span><b>${L("另列","Separate","Aparte")}</b></div><div><span>${L("取消期限","Cancellation","Cancelación")}</span><b>24 h</b></div></div></div><div class="bc-aside-panel light"><h3>${L("例外交給真人","Human exceptions","Excepciones humanas")}</h3><p>${L("輪椅、兒童座椅、超大行李、多站接送、航班取消或最後一刻改址。","Wheelchairs, child seats, oversized baggage, multiple stops, canceled flights or last-minute address changes.","Silla de ruedas, asiento infantil, equipaje grande, paradas múltiples o cambios de vuelo.")}</p></div></aside></div></section></main>`;
}

function legacy_hotelBC() {
  return `<main>${bcServiceHero(BC_IMG.hotel,"HOTELS",L("標準訂房自己完成，特殊房型有人接手。","Self-serve standard stays; people handle special rooms.","Reserve estancias estándar; las habitaciones especiales pasan a una persona."),L("先把一般訂房、行程住宿與特殊房型分開，價格、付款對象、取消期限與飯店責任都更清楚。","Separate standard stays, tour hotels and special rooms so price, payee, cancellation and responsibility stay clear.","Separe estancias estándar, hoteles de circuito y habitaciones especiales para aclarar precio y responsabilidad."),L("三條訂房路徑","Three hotel paths","Tres rutas de hotel"),L("若導向合作平台，付款與售後責任要在離站前明示；行程住宿則回到訂單查看。","Before leaving for a partner, disclose payment and support responsibility. Tour hotels belong in the order.","Antes de ir a un socio, revele quién cobra y atiende. Los hoteles del circuito aparecen en el pedido."),"center 55%")}
  <section class="bc-shell section"><div class="bc-support-grid"><button class="bc-support-card" data-demo-action><span><p class="eyebrow">01 · STANDARD STAY</p><h3>${L("一般訂房比價","Standard hotel search","Búsqueda estándar")}</h3><p>${L("日期、房型、稅費、取消期限與付款平台一起比較。","Compare dates, room, taxes, cancellation and payee together.","Compare fechas, habitación, impuestos, cancelación y quién cobra.")}</p></span><b>${L("查看合作平台示意 →","Partner search demo →","Búsqueda de socio →")}</b></button><button class="bc-support-card" data-view="orders"><span><p class="eyebrow">02 · TOUR HOTEL</p><h3>${L("查看行程住宿","Tour accommodation","Alojamiento del circuito")}</h3><p>${L("最終飯店、房型與入住資訊跟著訂單進度更新。","Final hotel, room and check-in information follow the order status.","Hotel, habitación y check-in siguen el estado del pedido.")}</p></span><b>${L("前往我的訂單 →","Open my orders →","Abrir mis pedidos →")}</b></button><button class="bc-support-card" data-demo-action><span><p class="eyebrow">03 · SPECIAL ROOM</p><h3>${L("特殊房型需求","Special room request","Habitación especial")}</h3><p>${L("連通房、無障礙、長住與團體房先建立完整需求。","Connected, accessible, long-stay and group rooms begin with a complete brief.","Habitaciones conectadas, accesibles, largas y grupales empiezan con un brief.")}</p></span><b>${L("建立需求示意 →","Create request demo →","Crear solicitud →")}</b></button></div>
  <div class="bc-service-layout" style="margin-top:14px"><section class="bc-form-section"><p class="eyebrow">STANDARD SEARCH · DESIGN DEMO</p><h2>${L("先看完整住房成本","See the complete stay cost","Vea el costo total de la estancia")}</h2><div class="bc-field-grid"><div class="bc-field full"><label>${L("目的地或飯店","DESTINATION OR HOTEL","DESTINO U HOTEL")}</label><input value="Madrid"/></div><div class="bc-field"><label>${L("入住","CHECK-IN","ENTRADA")}</label><input type="date" value="2026-10-03"/></div><div class="bc-field"><label>${L("退房","CHECK-OUT","SALIDA")}</label><input type="date" value="2026-10-09"/></div><div class="bc-field"><label>${L("房間","ROOMS","HABITACIONES")}</label><select><option>1 ${L("間","room","habitación")}</option></select></div><div class="bc-field"><label>${L("旅客","GUESTS","VIAJEROS")}</label><select><option>2 ${L("位成人","adults","adultos")}</option></select></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("查看示意房價","View sample rates","Ver tarifas de ejemplo")}</button><span class="bc-demo-stamp">${L("不導向外站・不訂房","NO REDIRECT OR BOOKING","SIN REDIRECCIÓN NI RESERVA")}</span></div></section><aside class="bc-service-aside"><div class="bc-aside-panel"><h3>${L("比價固定欄位","Fixed comparison fields","Datos fijos de comparación")}</h3><div class="bc-aside-list"><div><span>${L("含稅總價","Total with taxes","Total con impuestos")}</span><b>✓</b></div><div><span>${L("可取消期限","Cancellation deadline","Fecha de cancelación")}</span><b>✓</b></div><div><span>${L("房型與床型","Room & bed","Habitación y cama")}</span><b>✓</b></div><div><span>${L("付款對象","Payee","Quién cobra")}</span><b>✓</b></div></div></div></aside></div></section></main>`;
}

const BC_DEMO_ORDERS = [
  { id: "DEMO-PG-1042", tourId: 2, status: bcI18n("訂位確認・待旅客資料", "Confirmed · traveler details due", "Confirmado · faltan datos"), next: bcI18n("2026.09.05 前確認旅客資料", "Confirm travelers by 2026.09.05", "Confirme viajeros antes de 2026.09.05"), total: 3100, paid: 620, balance: 2480 },
  { id: "DEMO-PG-1078", tourId: 21, status: bcI18n("收客中・已提交訂位", "Collecting · request submitted", "Formando grupo · solicitud enviada"), next: bcI18n("2026.08.24 查看成團更新", "Check departure update on 2026.08.24", "Revise el estado el 2026.08.24"), total: 5780, paid: 0, balance: 5780 }
];

function legacy_bcMemberNav() {
  const links = [
    ["member",L("總覽","Overview","Resumen"),"01"],
    ["orders",L("我的訂單","My orders","Mis pedidos"),"02"],
    ["travelers",L("旅客與文件","Travelers & documents","Viajeros y documentos"),"03"],
    ["payments",L("付款與收據","Payments & receipts","Pagos y recibos"),"04"],
    ["favorites",L("收藏行程","Saved journeys","Favoritos"),"05"],
    ["contact",L("支援案件","Support cases","Soporte"),"06"]
  ];
  const active = state.view === "order-detail" ? "orders" : state.view;
  return `<aside class="bc-member-rail"><div class="bc-member-profile"><p class="eyebrow">DEMO MEMBER</p><h2>DEMO MEMBER</h2><p>${L("示意會員・不是真實帳戶或個資","Sample member · no real account or personal data","Miembro de ejemplo · sin datos reales")}</p></div><nav class="bc-member-links" aria-label="${L("會員中心導覽","Member-center navigation","Navegación del área personal")}">${links.map(([view,label,num])=>`<button class="bc-member-link ${active===view?"active":""}" data-view="${view}" ${active===view?'aria-current="page"':""}><span>${label}</span><span>${num}</span></button>`).join("")}</nav></aside>`;
}

function legacy_bcMemberPage(title, eyebrow, body) {
  return `<main class="bc-shell bc-member-shell">${bcMemberNav()}<section class="bc-member-main">${bcDemoNotice(L("會員、訂單、付款、文件與支援狀態","member, order, payment, document and support states","estados de miembro, pedido, pago, documentos y soporte"))}<header class="bc-member-header"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div><span class="bc-demo-stamp">DEMO MEMBER</span></header>${body}</section></main>`;
}

function legacy_memberBC() {
  const order = BC_DEMO_ORDERS[0];
  const t = BC_TOURS.find(x=>x.id===order.tourId);
  return bcMemberPage(L("下一次旅行，一眼看懂。","Your next journey, at a glance.","Su próximo viaje, de un vistazo."),"MEMBER CENTER · DESIGN DEMO",`<section class="bc-next-trip"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div class="bc-next-trip-copy"><p class="eyebrow">${order.id} · ${bcTxt(order.status)}</p><h2>${bcTxt(t.title)}</h2><p>${t.nextDate} → ${t.returnDate} · 2 ${L("位示意旅客","sample travelers","viajeros de ejemplo")}</p><div class="bc-progress"><span class="bc-progress-step done">01<br>${L("訂位確認","Booking","Reserva")}</span><span class="bc-progress-step done">02<br>${L("訂金示意","Deposit","Depósito")}</span><span class="bc-progress-step current">03<br>${L("旅客資料","Travelers","Viajeros")}</span><span class="bc-progress-step">04<br>${L("尾款","Balance","Saldo")}</span><span class="bc-progress-step">05<br>${L("行前文件","Documents","Documentos")}</span></div><p><b>${L("下一步：","Next: ","Siguiente: ")}</b>${bcTxt(order.next)}</p><div class="bc-form-actions"><button class="btn" data-view="travelers">${L("完成旅客資料","Complete traveler details","Completar viajeros")}</button><button class="btn ghost" data-view="order-detail">${L("查看訂單進度","View order progress","Ver progreso")}</button></div></div></section>
  <div class="bc-dashboard-grid"><section class="bc-dashboard-panel"><h3>${L("現在要做什麼","What to do now","Qué hacer ahora")}</h3><div class="bc-list-row"><div><b>${L("確認 DEMO MEMBER A 護照英文資料","Confirm DEMO MEMBER A passport fields","Confirmar pasaporte de DEMO MEMBER A")}</b><br><small>${L("示意截止 2026.09.05","Sample due 2026.09.05","Fecha de ejemplo 2026.09.05")}</small></div><button class="btn ghost small" data-view="travelers">${L("處理","Open","Abrir")}</button></div><div class="bc-list-row"><div><b>${L("查看尾款時程","Review balance schedule","Revisar saldo")}</b><br><small>${L("示意付款日 2026.09.12","Sample payment date 2026.09.12","Pago de ejemplo 2026.09.12")}</small></div><button class="btn ghost small" data-view="payments">${L("查看","View","Ver")}</button></div></section><section class="bc-dashboard-panel"><h3>${L("快速入口","Quick paths","Accesos rápidos")}</h3><div class="bc-list-row"><div><b>${L("我的 2 筆示意訂單","My 2 sample orders","Mis 2 pedidos de ejemplo")}</b><br><small>${L("一筆已確認、一筆收客中","One confirmed, one collecting","Uno confirmado, uno formando")}</small></div><button class="btn ghost small" data-view="orders">${L("訂單","Orders","Pedidos")}</button></div><div class="bc-list-row"><div><b>${L(`我的 ${state.savedTours.size} 個收藏行程`,`${state.savedTours.size} saved journeys`,`${state.savedTours.size} viajes guardados`)}</b><br><small>${L("裝置內原型狀態","Device-only prototype state","Estado local del prototipo")}</small></div><button class="btn ghost small" data-view="favorites">${L("收藏","Saved","Favoritos")}</button></div></section></div>`);
}

function legacy_ordersBC() {
  const cards = BC_DEMO_ORDERS.map((o,i)=>{ const t=BC_TOURS.find(x=>x.id===o.tourId); return `<article class="bc-order-card"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p class="eyebrow">${o.id} · ${L("設計示意","DESIGN DEMO","DEMO")}</p><h2>${bcTxt(t.title)}</h2><div class="bc-order-meta"><span>${t.nextDate} → ${t.returnDate}</span><span>${bcTxt(o.status)}</span><span>${L("2 位示意旅客","2 sample travelers","2 viajeros de ejemplo")}</span></div><p><b>${L("下一步：","Next: ","Siguiente: ")}</b>${bcTxt(o.next)}</p></div><div class="bc-order-action"><b>${money(o.total)}</b><br><small>${L("示意訂單總額","sample order total","total de ejemplo")}</small><br><button class="btn small" style="margin-top:12px" ${i===0?`data-view="order-detail"`:`data-tour="${t.id}"`}>${i===0?L("查看進度","View progress","Ver progreso"):L("查看行程","View journey","Ver viaje")}</button></div></article>`; }).join("");
  return bcMemberPage(L("我的訂單","My orders","Mis pedidos"),"ORDERS · DESIGN DEMO",`<div class="bc-order-list">${cards}</div>`);
}

function legacy_orderDetailBC() {
  const o = BC_DEMO_ORDERS[0], t = BC_TOURS.find(x=>x.id===o.tourId);
  return bcMemberPage(L("訂單詳情與進度","Order details and progress","Detalle y progreso"),`${o.id} · DESIGN DEMO`,`<section class="bc-order-hero"><div><p class="eyebrow">${bcTxt(o.status)}</p><h2>${bcTxt(t.title)}</h2><p>${t.nextDate} → ${t.returnDate} · 2 ${L("位示意旅客","sample travelers","viajeros de ejemplo")}</p><div class="bc-timeline"><div class="bc-timeline-step done"><b>01 ${L("訂位提交","Submitted","Enviado")}</b><small>2026.08.20</small></div><div class="bc-timeline-step done"><b>02 ${L("供應商確認","Confirmed","Confirmado")}</b><small>2026.08.22</small></div><div class="bc-timeline-step current"><b>03 ${L("旅客資料","Travelers","Viajeros")}</b><small>2026.09.05 ${L("前","due","límite")}</small></div><div class="bc-timeline-step"><b>04 ${L("尾款","Balance","Saldo")}</b><small>2026.09.12</small></div><div class="bc-timeline-step"><b>05 ${L("行前文件","Documents","Documentos")}</b><small>2026.09.20</small></div></div></div><aside><p class="eyebrow">NEXT ACTION</p><h2>${L("完成旅客資料","Complete traveler details","Completar viajeros")}</h2><p>${L("示意截止 2026.09.05；約 4 分鐘。","Sample due 2026.09.05; about 4 minutes.","Fecha de ejemplo 2026.09.05; unos 4 minutos.")}</p><button class="btn wide" data-view="travelers">${L("現在處理","Do it now","Completar ahora")}</button></aside></section>
  <div class="bc-dashboard-grid"><section class="bc-dashboard-panel"><h3>${L("費用摘要","Cost summary","Resumen de costo")}</h3><div class="bc-list-row"><span>${L("示意訂單總額","Sample order total","Total de ejemplo")}</span><b>${money(o.total)}</b></div><div class="bc-list-row"><span>${L("示意已授權訂金","Sample authorized deposit","Depósito autorizado")}</span><b>${money(o.paid)}</b></div><div class="bc-list-row"><span>${L("示意待付尾款","Sample balance due","Saldo pendiente")}</span><b>${money(o.balance)}</b></div><button class="btn ghost wide" style="margin-top:14px" data-view="payments">${L("付款與收據","Payments & receipts","Pagos y recibos")}</button></section><section class="bc-dashboard-panel"><h3>${L("行程與支援","Journey & support","Viaje y soporte")}</h3><div class="bc-list-row"><div><b>${L("完整商品詳情","Full journey detail","Detalle completo")}</b><br><small>${t.code}</small></div><button class="btn ghost small" data-tour="${t.id}">${L("查看","View","Ver")}</button></div><div class="bc-list-row"><div><b>${L("建立帶訂單資訊的支援案件","Open support with order context","Abrir soporte con pedido")}</b><br><small>${o.id}</small></div><button class="btn ghost small" data-view="contact">${L("支援","Support","Soporte")}</button></div></section></div>`);
}

function legacy_travelersBC() {
  return bcMemberPage(L("旅客資料與文件","Travelers and documents","Viajeros y documentos"),"TRAVELER WALLET · DESIGN DEMO",`<section class="bc-form-section"><p class="eyebrow">${L("示意旅客 1","SAMPLE TRAVELER 1","VIAJERO DE EJEMPLO 1")}</p><h2>DEMO MEMBER A</h2><div class="bc-field-grid"><div class="bc-field"><label>${L("護照英文名","GIVEN NAME","NOMBRE")}</label><input value="DEMO" readonly/></div><div class="bc-field"><label>${L("護照英文姓","SURNAME","APELLIDO")}</label><input value="MEMBER A" readonly/></div><div class="bc-field"><label>${L("護照效期示意","PASSPORT EXPIRY SAMPLE","VENCIMIENTO DE EJEMPLO")}</label><input value="2028.10.01" readonly/></div><div class="bc-field"><label>${L("資料狀態","STATUS","ESTADO")}</label><input value="${L("待確認・設計示意","Pending confirmation · demo","Pendiente · demo")}" readonly/></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("確認示意資料","Confirm sample data","Confirmar datos de ejemplo")}</button><button class="btn ghost" data-demo-action>${L("上傳文件示意","Upload document demo","Carga de documento")}</button></div></section>
  <section class="bc-editorial-section"><p class="eyebrow">DOCUMENT STATUS</p><h2>${L("只顯示案件真正需要的文件","Show only documents the case needs","Muestre solo documentos necesarios")}</h2><div class="bc-data-table"><div class="bc-data-row"><div><b>${L("護照資料頁","Passport bio page","Página de datos")}</b><small>${L("DEMO MEMBER A・不含真實文件","No real document attached","Sin documento real")}</small></div><div>${L("待安全上傳","Secure upload pending","Carga segura pendiente")}</div><div>2026.09.05 ${L("前","due","límite")}</div><button class="btn ghost small" data-demo-action>${L("上傳示意","Upload demo","Carga demo")}</button></div><div class="bc-data-row"><div><b>${L("緊急聯絡資訊","Emergency contact","Contacto de emergencia")}</b><small>${L("只在正式安全流程收取","Collected only in a secure production flow","Solo en flujo seguro")}</small></div><div>${L("尚未收取","Not collected","No recogido")}</div><div>2026.09.05 ${L("前","due","límite")}</div><button class="btn ghost small" data-demo-action>${L("填寫示意","Open demo","Abrir demo")}</button></div><div class="bc-data-row"><div><b>${L("行程確認書","Journey confirmation","Confirmación del viaje")}</b><small>${L("正式版於訂位確認後提供","Production provides after booking confirmation","Disponible tras confirmar la reserva")}</small></div><div>${L("示意可查看","Sample available","Disponible de ejemplo")}</div><div>2026.09.20</div><button class="btn ghost small" data-demo-action>${L("查看示意","View demo","Ver demo")}</button></div></div></section>`);
}

function legacy_paymentsBC() {
  return bcMemberPage(L("付款與收據","Payments and receipts","Pagos y recibos"),"PAYMENT CENTER · DESIGN DEMO",`<section class="bc-order-hero"><div><p class="eyebrow">DEMO-PG-1042</p><h2>${L("付款時程示意","Sample payment schedule","Calendario de pagos de ejemplo")}</h2><p>${L("所有金額與狀態均為設計示意；本頁不會建立付款方式、授權或扣款。","All amounts and states are design samples. This page creates no payment method, authorization or charge.","Todos los importes y estados son ejemplos. Esta página no crea método de pago, autorización ni cargo.")}</p></div><aside><p class="eyebrow">${L("示意待付","SAMPLE DUE","PENDIENTE")}</p><h2>${money(2480)}</h2><p>2026.09.12 ${L("到期示意","sample due date","fecha de ejemplo")}</p><button class="btn wide" data-demo-action>${L("付款流程示意","Payment flow demo","Flujo de pago demo")}</button></aside></section>
  <section class="bc-editorial-section"><p class="eyebrow">TRANSACTIONS & RECEIPTS</p><h2>${L("每一筆付款都看得懂對象、狀態與收據","Every payment shows payee, state and receipt","Cada pago muestra receptor, estado y recibo")}</h2><div class="bc-data-table"><div class="bc-data-row"><div><b>${L("訂金授權示意","Deposit authorization sample","Autorización de depósito")}</b><small>DEMO-PG-1042 · PACK&GO</small></div><div>${money(620)}</div><div>2026.08.22 · ${L("示意已授權","Sample authorized","Autorizado de ejemplo")}</div><button class="btn ghost small" data-demo-action>${L("收據示意","Receipt demo","Recibo demo")}</button></div><div class="bc-data-row"><div><b>${L("尾款示意","Balance sample","Saldo de ejemplo")}</b><small>DEMO-PG-1042 · PACK&GO</small></div><div>${money(2480)}</div><div>2026.09.12 · ${L("尚未到期","Not yet due","Aún no vence")}</div><button class="btn ghost small" data-demo-action>${L("查看揭露","Review demo","Ver detalle")}</button></div></div></section>`);
}

function favoritesBC() {
  const saved = BC_TOURS.filter(t=>state.savedTours.has(t.id));
  return bcMemberPage(L("收藏行程","Saved journeys","Viajes guardados"),"SAVED · DEVICE-ONLY PROTOTYPE",saved.length?`<div class="bc-tour-grid">${saved.map(bcTourCard).join("")}</div>`:`<section class="bc-form-section"><h2>${L("目前沒有收藏","No saved journeys","No hay favoritos")}</h2><p>${L("收藏只保留在這個原型的記憶體中。","Saves live only in this prototype session.","Los favoritos viven solo en esta sesión.")}</p><button class="btn" data-view="tours">${L("探索行程","Explore journeys","Explorar viajes")}</button></section>`);
}

function legacy_contactBC() {
  return `<main>${bcServiceHero(BC_IMG.support,"CONTACT & SUPPORT",L("先帶上問題背景，支援不用從頭問。","Bring the context so support does not start over.","Incluya el contexto para que soporte no empiece de cero."),L("訂單、機票、簽證、客製需求與旅途中事件各有不同入口。標準購買不靠聯絡表單，只有例外與支援案件來這裡。","Orders, flights, visas, custom requests and in-trip events use distinct paths. Standard purchases do not depend on a contact form.","Pedidos, vuelos, visados, viajes a medida e incidentes usan rutas distintas. Las compras estándar no dependen del contacto."),L("建立有上下文的支援案件","Open a contextual support case","Abra un caso con contexto"),L("正式版應自動帶入已登入會員的示意訂單上下文，只要求補充必要資訊。","Production should carry signed-in order context and ask only for necessary missing facts.","La versión final debe incluir el contexto del pedido y pedir solo lo necesario."),"center 48%")}
  <section class="bc-shell section"><div class="bc-support-grid"><button class="bc-support-card" data-view="order-detail"><span><p class="eyebrow">ORDER SUPPORT</p><h3>${L("訂單與行程","Orders and journeys","Pedidos y viajes")}</h3><p>${L("改期、旅客資料、付款、集合資訊與供應商異常。","Changes, traveler details, payment, meeting information and supplier issues.","Cambios, datos, pagos, encuentro e incidencias de proveedor.")}</p></span><b>${L("先開啟示意訂單 →","Open sample order →","Abrir pedido →")}</b></button><button class="bc-support-card" data-view="flights"><span><p class="eyebrow">FLIGHT SUPPORT</p><h3>${L("機票與退改","Flights and changes","Vuelos y cambios")}</h3><p>${L("先確認出票方；複雜改票、特殊行李與航班異常再建立案件。","Confirm the ticketing party; open a case for complex changes, baggage or disruption.","Confirme el emisor; abra un caso para cambios, equipaje o incidencias.")}</p></span><b>${L("查看機票責任 →","Flight responsibility →","Responsabilidad →")}</b></button><button class="bc-support-card" data-view="visa"><span><p class="eyebrow">DOCUMENT SUPPORT</p><h3>${L("簽證與文件","Visas and documents","Visados y documentos")}</h3><p>${L("先做規則判斷，不在普通表單上傳護照或敏感文件。","Check the rule first; do not upload passports or sensitive files in a basic form.","Primero verifique reglas; no suba pasaportes en un formulario básico.")}</p></span><b>${L("先做資格判斷 →","Start eligibility check →","Comprobar elegibilidad →")}</b></button></div>
  <div class="bc-service-layout" style="margin-top:14px"><section class="bc-form-section"><p class="eyebrow">SUPPORT CASE · DESIGN DEMO</p><h2>${L("建立支援案件示意","Open a support-case demo","Abrir caso de soporte demo")}</h2><div class="bc-field-grid"><div class="bc-field"><label>${L("問題類型","ISSUE TYPE","TIPO")}</label><select><option>${L("訂單與行程","Order and journey","Pedido y viaje")}</option><option>${L("機票","Flight","Vuelo")}</option><option>${L("簽證文件","Visa document","Visado")}</option><option>${L("旅途中緊急事件","In-trip emergency","Emergencia en viaje")}</option></select></div><div class="bc-field"><label>${L("示意訂單編號・選填","SAMPLE ORDER · OPTIONAL","PEDIDO DE EJEMPLO · OPCIONAL")}</label><input value="DEMO-PG-1042"/></div><div class="bc-field full"><label>${L("請描述需要解決的事情","WHAT NEEDS TO BE RESOLVED","QUÉ HAY QUE RESOLVER")}</label><textarea placeholder="${L("不要在此貼護照號碼、信用卡或密碼。","Do not paste passport numbers, cards or passwords here.","No pegue números de pasaporte, tarjetas ni contraseñas.")}"></textarea></div></div><div class="bc-form-actions"><button class="btn" data-demo-action>${L("建立案件・設計示意","Open case · design demo","Abrir caso · demo")}</button><span class="bc-demo-stamp">${L("不會寄信或建立真實案件","NO EMAIL OR REAL CASE","SIN CORREO NI CASO REAL")}</span></div></section><aside class="bc-service-aside"><div class="bc-aside-panel"><h3>${L("旅途中高風險事件","High-risk events in travel","Incidentes de alto riesgo")}</h3><p>${L("人身安全、重大醫療、護照遺失、航班大規模取消等正式案件應顯示 24 小時緊急處理入口；本原型只呈現版面。","Production should show a 24-hour emergency path for safety, major medical, lost passport or large disruption. This prototype only shows the interface.","La versión final debe ofrecer una ruta 24 horas para seguridad, salud, pasaporte perdido o interrupción grave. Aquí solo se muestra la interfaz.")}</p></div><div class="bc-aside-panel light"><h3>${L("一般聯絡","General contact","Contacto general")}</h3><p>+1 (510) 634-2307<br>support@packgoplay.com<br>39055 Cedar Blvd #126, Newark, CA</p></div></aside></div></section></main>`;
}

function aboutBC() {
  return `<main>${bcServiceHero(BC_IMG.about,"ABOUT PACK&GO",L("把旅行的複雜，整理成客人看得懂的選擇。","Turn travel complexity into choices people can understand.","Convierta la complejidad del viaje en decisiones claras."),L("PACK&GO 服務灣區華人家庭與重視中文溝通的旅客。彩色旅圖負責想像，清楚的價格、日期、責任與流程負責信任。","PACK&GO serves Bay Area Chinese-speaking families and travelers who value clear communication. Images inspire; price, dates, responsibility and process build trust.","PACK&GO atiende a familias del Área de la Bahía que valoran comunicación clara. Las imágenes inspiran y los datos generan confianza."),L("小旅行社的人情，成熟電商的清楚","Human care, commerce clarity","Atención humana y claridad comercial"),L("Jeff 處理例外、客製、供應商異常與高風險案件；標準流程應讓客人自己完成。","Jeff handles exceptions, custom work, supplier anomalies and high-risk cases; standard flows should be self-service.","Jeff gestiona excepciones, viajes a medida, proveedores y alto riesgo; lo estándar debe ser autoservicio."),"center 48%")}
  <section class="bc-shell section"><div class="bc-section-head"><div><p class="eyebrow">WHAT STAYS HUMAN</p><h2>${L("系統處理重複，人處理判斷。","Systems handle repetition. People handle judgment.","Los sistemas repiten. Las personas deciden.")}</h2></div><p>${L("網站不是把每個客人導向『聯絡我們』，而是讓目的地比較、訂位、旅客資料、付款與追蹤有清楚自助路徑。","The site does not send every customer to contact. Comparison, booking, traveler details, payment and tracking have clear self-service paths.","El sitio no envía a todos a contacto. Comparación, reserva, datos, pago y seguimiento tienen rutas claras.")}</p></div><div class="bc-step-list"><div class="bc-step-row"><h3>${L("標準旅程","Standard journey","Viaje estándar")}</h3><p>${L("選目的地、比較團、選日期人數、看總價、填資料、付款或提交、會員中心追蹤。","Choose, compare, select date and guests, see total, enter details, pay or submit, then track in member center.","Elegir, comparar, seleccionar fecha y viajeros, ver total, completar, pagar o enviar y seguir.")}</p></div><div class="bc-step-row"><h3>${L("需要真人","Human judgment","Juicio humano")}</h3><p>${L("客製條件、特殊身分、無障礙、高風險事件、供應商異常與複雜退改。","Custom constraints, special status, accessibility, high-risk events, supplier anomalies and complex changes.","Condiciones especiales, accesibilidad, alto riesgo, proveedores y cambios complejos.")}</p></div><div class="bc-step-row"><h3>${L("責任先說清楚","Responsibility first","Responsabilidad clara")}</h3><p>${L("付款對象、出票方、不可退第三方成本、取消條款與保障在行動前揭露。","Payee, ticketing party, non-refundable third-party costs, cancellation and protections appear before action.","Quién cobra, emite, costos no reembolsables, cancelación y protección aparecen antes de actuar.")}</p></div></div></section>
  <section class="bc-shell section-tight"><div class="bc-trust-band"><div><p class="eyebrow">TRUST, NOT BADGES</p><h2>${L("用可核對的資料建立信任。","Build trust with facts people can verify.","Genere confianza con datos verificables.")}</h2><p>${L("正式上線前仍須再次核對所有登記、地址、保障與緊急支援敘述。","All registrations, address, protections and emergency-support claims must be reverified before production.","Registros, dirección, protecciones y soporte deben verificarse antes de producción.")}</p></div><div><h3>CST #2166984</h3><p>California Seller of Travel</p></div><div><h3>#115594</h3><p>Newark Business License</p></div><div><h3>Newark, CA</h3><p>${L("灣區實體聯絡","Bay Area contact","Contacto en Bay Area")}</p></div></div></section></main>`;
}

function helpBC() {
  return `<main>${bcPageIntro("HELP & POLICIES",L("先找到答案，再決定是否需要真人。","Find the answer before you need a person.","Encuentre la respuesta antes de necesitar ayuda."),L("訂位、付款、旅客資料、機票、中國簽證與取消都有清楚入口；高風險例外再建立支援案件。","Booking, payment, travelers, flights, China visas and cancellation each have a clear path; high-risk exceptions open a support case.","Reserva, pago, viajeros, vuelos, visado chino y cancelación tienen rutas claras; las excepciones abren soporte."),BC_IMG.support)}<section class="bc-shell section-tight"><div class="bc-support-grid"><button class="bc-support-card" data-view="orders"><span><p class="eyebrow">BOOKING</p><h3>${L("訂位與訂單進度","Booking and order progress","Reserva y progreso")}</h3><p>${L("從我的訂單查看狀態、下一步與費用。","See state, next action and cost in My Orders.","Vea estado, siguiente paso y costo en Mis pedidos.")}</p></span><b>${L("我的訂單 →","My orders →","Mis pedidos →")}</b></button><button class="bc-support-card" data-view="payments"><span><p class="eyebrow">PAYMENT</p><h3>${L("付款與收據","Payments and receipts","Pagos y recibos")}</h3><p>${L("確認付款對象、狀態、到期日與收據。","Confirm payee, state, due date and receipt.","Confirme quién cobra, estado, vencimiento y recibo.")}</p></span><b>${L("付款中心 →","Payment center →","Centro de pagos →")}</b></button><button class="bc-support-card" data-view="contact"><span><p class="eyebrow">EXCEPTIONS</p><h3>${L("建立支援案件","Open a support case","Abrir soporte")}</h3><p>${L("只有需要真人判斷的例外才進入支援。","Only exceptions needing judgment enter support.","Solo las excepciones que requieren juicio entran en soporte.")}</p></span><b>${L("聯絡與支援 →","Contact & support →","Contacto →")}</b></button></div></section></main>`;
}

function legacy_bcMembershipVariantC() {
  const tier = (name, label, title, items, action, attributes, current = false) => `<article class="bc-tier-column ${current ? "current" : ""}">
    <header><p>${name}</p><span>${label}</span><h2>${title}</h2></header>
    <ul>${items.map(item=>`<li>${item}</li>`).join("")}</ul>
    <button class="${current ? "btn" : "btn ghost"}" ${attributes}>${action}</button>
    ${current ? `<small>${L("DEMO MEMBER 目前示意等級","DEMO MEMBER sample level","Nivel de ejemplo de DEMO MEMBER")}</small>` : ""}
  </article>`;
  const guest = tier("GUEST",L("未登入顧客","Signed-out customer","Cliente sin sesión"),L("先看看，再決定。","Explore first, decide later.","Explore primero y decida después."),[
    L("瀏覽行程、比較班期與完整價格","Browse trips, dates and complete prices","Ver viajes, fechas y precios completos"),
    L("完成購買後，仍享有該訂單承諾的完整服務","Every purchase receives the full service promised by that order","Cada compra recibe el servicio completo prometido"),
    L("使用安全連結查看單筆訂單；不長期保存旅行偏好","Use a secure link for one order; preferences are not stored long term","Enlace seguro para un pedido; sin guardar preferencias")
  ],L("開始找行程","Find a journey","Buscar viaje"),'data-view="tours"');
  const member = tier("MEMBER",L("免費會員・設計提案","Free member · proposal","Miembro gratis · propuesta"),L("網站記得你，也開始回饋你。","The site remembers—and starts rewarding—you.","El sitio le recuerda y empieza a recompensarle."),[
    L("集中查看訂單、付款、文件與下一步","Orders, payments, documents and next steps together","Pedidos, pagos, documentos y siguientes pasos"),
    L("重用常用旅客資料與旅行偏好","Reuse frequent travelers and trip preferences","Reutilizar viajeros y preferencias"),
    L("完成合格旅行後累積標準 PACK&GO 旅行金・倍率待定","Earn standard PACK&GO travel credit after eligible completed travel · rate pending","Acumular crédito PACK&GO estándar tras viajes completados · tasa pendiente")
  ],L("回到 DEMO MEMBER","Return to DEMO MEMBER","Volver a DEMO MEMBER"),'data-view="member"',true);
  const vip = tier("VIP",L("加值等級・尚未開放","Added-value tier · not open","Nivel adicional · no disponible"),L("網站更懂你，旅行金也累積更多。","The site knows you better—and you earn more travel credit.","El sitio le conoce mejor y acumula más crédito."),[
    L("完成相同合格旅行，以較高倍率累積 PACK&GO 旅行金・倍率待定","Earn PACK&GO travel credit at a higher rate on the same eligible completed travel · rate pending","Acumular crédito PACK&GO a una tasa mayor en el mismo viaje elegible · tasa pendiente"),
    L("家庭旅行工作區與跨旅程共同偏好","Household travel workspace and shared preferences across trips","Espacio familiar y preferencias compartidas entre viajes"),
    L("指定新行程提前預覽與適用的合作夥伴禮遇・不保留席位","Early previews of selected journeys and applicable partner perks · no seat hold","Vista previa de viajes y beneficios de socios · sin reservar plazas")
  ],L("看看 VIP 是否適合我・設計示意","See if VIP may fit · demo","Ver si VIP encaja · demo"),'data-vip-fit');
  const rewards = `<section class="bc-reward-model"><header><div><p class="eyebrow">PACK&GO TRAVEL CREDIT · DESIGN PROPOSAL</p><h2>${L("旅行完成，旅行金才開始累積。","Travel credit begins only after travel is completed.","El crédito empieza solo después de completar el viaje.")}</h2></div><p>${L("只以合格的 PACK&GO 金額計算；精確倍率、上限與效期仍是商業規則待定。","Only eligible PACK&GO amounts count; exact rates, caps and expiry remain pending business rules.","Solo cuenta el importe PACK&GO elegible; tasas, límites y vencimiento siguen pendientes.")}</p></header><div class="bc-reward-equation"><span>${L("已完成旅行的合格金額","ELIGIBLE COMPLETED AMOUNT","IMPORTE ELEGIBLE COMPLETADO")}</span><b>×</b><span>${L("會員等級倍率","TIER EARNING RATE","TASA DEL NIVEL")}</span><b>=</b><span>${L("下次可用旅行金","TRAVEL CREDIT FOR NEXT TIME","CRÉDITO PARA EL PRÓXIMO VIAJE")}</span></div><div class="bc-reward-compare"><article><small>MEMBER</small><strong>${L("標準累積","STANDARD EARNING","ACUMULACIÓN ESTÁNDAR")}</strong><p>${L("完成合格旅行後入帳；倍率待定。","Posted after eligible travel is completed; rate pending.","Se acredita tras completar el viaje; tasa pendiente.")}</p></article><article><small>VIP</small><strong>${L("較高累積倍率","HIGHER EARNING RATE","TASA MAYOR")}</strong><p>${L("相同合格金額累積更多旅行金；倍率待定。","The same eligible amount earns more travel credit; rate pending.","El mismo importe acumula más crédito; tasa pendiente.")}</p></article></div><footer><b>${L("不列入計算","EXCLUDED","EXCLUIDO")}</b><span>${L("機票票價、稅費、政府費、供應商代收、保險、價差、取消與退改費。","Airfare, taxes, government fees, supplier pass-through, insurance, fare differences, cancellation and change fees.","Tarifa aérea, impuestos, tasas oficiales, cobros de proveedores, seguro, diferencias, cancelación y cambios.")}</span><small>${L("設計示意｜沒有發放、扣除或套用任何旅行金。","DESIGN DEMO · No travel credit is issued, deducted or applied.","DEMO · No se emite, descuenta ni aplica crédito.")}</small></footer></section>`;
  return bcMemberPage(L("每位客人服務完整；VIP 額外賺得更多。","Full service for every customer; VIP earns more on top.","Servicio completo para todos; VIP acumula más."),"MEMBERSHIP · DESIGN PROPOSAL",`<div id="bc-membership-design" tabindex="-1"><section class="bc-membership-lead"><div><p>${L("所有已購客人都得到訂單承諾的完整服務。MEMBER 讓網站記得旅程並開始累積旅行金；VIP 用較高倍率累積，並增加家庭旅行與提前預覽禮遇。","Every purchased order receives its full promised service. MEMBER remembers the journey and starts earning travel credit; VIP earns at a higher rate and adds household and early-preview perks.","Cada pedido recibe el servicio completo. MEMBER recuerda el viaje y acumula crédito; VIP acumula más y añade beneficios familiares y anticipados.")}</p><small>${L("設計示意｜目前未發放旅行金，也未開放加入、升級或收費。","DESIGN DEMO · No travel credit, enrollment, upgrade or charge is active.","DEMO · No hay crédito, alta, mejora ni cobro activos.")}</small></div><div><span>${L("目前示意等級","SAMPLE LEVEL","NIVEL DE EJEMPLO")}</span><strong>MEMBER</strong></div></section>
  <section class="bc-tier-editorial" aria-label="${L("會員等級比較","Membership comparison","Comparación de membresía")}">${guest}${member}${vip}</section>
  ${rewards}
  <section class="bc-membership-baseline"><p class="eyebrow">${L("每筆已購訂單都包含","INCLUDED WITH EVERY PURCHASE","INCLUIDO EN CADA COMPRA")}</p><h2>${L("會員等級不改變 PACK&GO 應盡的服務。","Membership never changes PACK&GO’s service obligation.","La membresía nunca cambia la obligación de servicio de PACK&GO.")}</h2><div><span>${L("訂位履約、必要文件、付款與退款資訊","Order fulfillment, required documents, payment and refund information","Cumplimiento, documentos, pagos y reembolsos")}</span><span>${L("退改協助、供應商異常與問題解決","Change assistance, supplier exceptions and issue resolution","Cambios, incidencias de proveedores y resolución")}</span><span>${L("無障礙、申訴、高風險與人身安全分流","Accessibility, complaints, high-risk and personal-safety escalation","Accesibilidad, reclamos y escalación de seguridad")}</span></div></section>
  <section class="bc-membership-rules"><div><p class="eyebrow">${L("上線前必須決定","BUSINESS RULES PENDING","REGLAS PENDIENTES")}</p><h2>${L("先算清旅行金，再開放升級。","Define travel-credit economics before upgrades open.","Defina la economía del crédito antes de abrir mejoras.")}</h2></div><ol><li><b>01</b><span>${L("VIP 依已完成旅行取得或付費；資格期間與有效期","Whether VIP is earned after completed travel or paid; qualification and validity","Si VIP se obtiene por viajes completados o pago; período y vigencia")}</span></li><li><b>02</b><span>${L("MEMBER 與 VIP 累積倍率、年度上限、效期與不可轉現規則","MEMBER and VIP rates, annual cap, expiry and no-cash rule","Tasas MEMBER/VIP, límite anual, vencimiento y no efectivo")}</span></li><li><b>03</b><span>${L("合格品項、退款扣回、與其他優惠是否能併用","Eligible items, reversal after refund and whether benefits stack","Artículos elegibles, reversión por reembolso y combinación")}</span></li></ol></section>
  <div id="bc-vip-fit" class="bc-vip-fit">${bcGuidedFlow("vip")}</div></div>`);
}

function bcMembershipDisclosure(label, hint, body, attributes = "") {
  return `<details class="bc-membership-disclosure" ${attributes}><summary><span><b>${label}</b><small>${hint}</small></span><i aria-hidden="true">＋</i></summary><div class="bc-membership-disclosure-body">${body}</div></details>`;
}

function legacy_bcMembershipCompactDetails(includeFlow = true) {
  const credit = bcMembershipDisclosure(
    L("旅行金怎麼算？","How does travel credit work?","¿Cómo funciona el crédito?"),
    L("完成合格旅行後入帳；稅費與代收不計。","Posted after eligible travel is completed; taxes and pass-through charges do not count.","Se acredita tras completar un viaje elegible; impuestos y cobros de terceros no cuentan."),
    `<div class="bc-membership-credit-rule"><p><span>${L("已完成旅行的合格金額","ELIGIBLE COMPLETED AMOUNT","IMPORTE ELEGIBLE COMPLETADO")}</span><b>×</b><span>${L("等級倍率","TIER RATE","TASA DEL NIVEL")}</span><b>=</b><span>${L("下次旅行金","NEXT-TRIP CREDIT","CRÉDITO FUTURO")}</span></p><dl><div><dt>${L("不列入","EXCLUDED","EXCLUIDO")}</dt><dd>${L("機票票價、稅費、政府費、供應商代收、保險、價差、取消與退改費。","Airfare, taxes, government fees, supplier pass-through, insurance, fare differences, cancellation and change fees.","Tarifa aérea, impuestos, tasas oficiales, cobros de proveedores, seguro, diferencias, cancelación y cambios.")}</dd></div><div><dt>${L("尚待決定","PENDING","PENDIENTE")}</dt><dd>${L("倍率、上限、效期、合格品項、退款扣回與優惠併用。","Rates, caps, expiry, eligible items, refund reversal and stacking.","Tasas, límites, vencimiento, elegibilidad, reversión y combinación.")}</dd></div></dl></div>`
  );
  const service = bcMembershipDisclosure(
    L("完整服務說明","Full-service promise","Promesa de servicio completo"),
    L("每筆已購訂單皆相同，不因會員等級減少。","Every purchased order receives the same promised service, regardless of tier.","Cada pedido recibe el mismo servicio, sin importar el nivel."),
    `<ul class="bc-membership-service-list"><li>${L("訂位履約、必要文件、付款與退款資訊","Order fulfillment, required documents, payment and refund information","Cumplimiento, documentos, pagos y reembolsos")}</li><li>${L("退改協助、供應商異常與問題解決","Change assistance, supplier exceptions and issue resolution","Cambios, incidencias de proveedores y resolución")}</li><li>${L("無障礙、申訴、高風險與人身安全分流","Accessibility, complaints, high-risk and personal-safety escalation","Accesibilidad, reclamos y escalación de seguridad")}</li></ul>`
  );
  const flow = includeFlow ? bcMembershipDisclosure(
    L("用 4 題了解 VIP","Understand VIP in four questions","Entienda VIP en cuatro preguntas"),
    L("逐題回答，不用一次看完整份說明。","Answer one question at a time instead of reading the whole page.","Responda una pregunta a la vez."),
    bcGuidedFlow("vip"),
    `id="bc-vip-fit" ${bcFlowState("vip").open || bcFlowState("vip").step ? "open" : ""}`
  ) : "";
  return `<div class="bc-membership-disclosures">${credit}${service}${flow}</div>`;
}

function legacy_bcMembershipVariantA() {
  const cell = (type, title, text) => `<div class="bc-membership-compare-cell ${type}"><b>${title}</b>${text ? `<span>${text}</span>` : ""}</div>`;
  const comparison = `<section id="bc-membership-design" tabindex="-1" class="bc-membership-compact">
    <header class="bc-membership-focus"><div><p class="eyebrow">CURRENT LEVEL · MEMBER</p><h2>${L("VIP，讓每次完成的旅行累積更多。","VIP makes every completed journey earn more.","VIP hace que cada viaje completado acumule más.")}</h2></div><p>${L("你現在已享有完整服務與標準旅行金；VIP 只增加回饋與便利。","You already receive full service and standard travel credit; VIP only adds rewards and convenience.","Ya recibe servicio completo y crédito estándar; VIP solo añade recompensas y comodidad.")}</p></header>
    <div class="bc-membership-compare-grid" role="group" aria-label="${L("MEMBER 與 VIP 比較","MEMBER and VIP comparison","Comparación MEMBER y VIP")}">
      <div class="bc-membership-compare-corner" aria-hidden="true"></div>
      <div class="bc-membership-compare-head member"><small>${L("目前等級","CURRENT","ACTUAL")}</small><strong>MEMBER</strong><span>${L("免費會員・設計提案","Free member · proposal","Miembro gratis · propuesta")}</span></div>
      <div class="bc-membership-compare-head vip"><small>${L("尚未開放","NOT OPEN","NO DISPONIBLE")}</small><strong>VIP</strong><span>${L("加值等級・規則待定","Added-value tier · rules pending","Nivel adicional · reglas pendientes")}</span></div>
      ${cell("label",L("旅行金","TRAVEL CREDIT","CRÉDITO"),"")}${cell("member",L("標準累積","Standard earning","Acumulación estándar"),L("完成合格旅行後入帳","After eligible travel is completed","Tras completar el viaje"))}${cell("vip",L("較高倍率","Higher earning rate","Tasa mayor"),L("相同合格金額累積更多","More from the same eligible amount","Más por el mismo importe"))}
      ${cell("label",L("旅行管理","TRIP SPACE","ESPACIO"),"")}${cell("member",L("私人旅程空間","Personal journey space","Espacio personal"),L("訂單、付款、文件與偏好","Orders, payments, documents and preferences","Pedidos, pagos, documentos y preferencias"))}${cell("vip",L("家庭旅行空間","Household journey space","Espacio familiar"),L("同行者與共同偏好跨旅程重用","Reuse travelers and shared preferences","Reutilizar viajeros y preferencias"))}
      ${cell("label",L("新行程","NEW JOURNEYS","NUEVOS VIAJES"),"")}${cell("member",L("正式公開後查看","View after public release","Ver tras publicación"),"")}${cell("vip",L("指定行程提前預覽","Early preview of selected journeys","Vista previa seleccionada"),L("不保留席位或價格","No seat or price hold","Sin reservar plaza ni precio"))}
      <div class="bc-membership-compare-action label"></div><div class="bc-membership-compare-action member"><span>${L("你目前正在使用","YOUR CURRENT LEVEL","SU NIVEL ACTUAL")}</span></div><div class="bc-membership-compare-action vip"><button class="btn light wide" data-vip-fit>${L("看看 VIP 是否適合我・設計示意","See if VIP may fit · demo","Ver si VIP encaja · demo")}</button></div>
    </div>
    <div class="bc-membership-promise"><b>${L("服務不分等級","SERVICE DOES NOT CHANGE BY TIER","EL SERVICIO NO CAMBIA")}</b><span>${L("不論 MEMBER 或 VIP，每筆已購訂單都享有 PACK&GO 承諾的完整服務。","Whether MEMBER or VIP, every purchased order receives PACK&GO’s full promised service.","Sea MEMBER o VIP, cada pedido recibe el servicio completo prometido por PACK&GO.")}</span></div>
    ${bcMembershipCompactDetails(true)}
  </section>`;
  return bcMemberPage(L("會員權益","Membership","Membresía"),"MEMBERSHIP",comparison);
}

function legacy_bcMembershipVariantB() {
  const body = `<section id="bc-membership-design" tabindex="-1" class="bc-membership-reward-first"><div class="bc-membership-reward-stage"><div><p class="eyebrow">DEMO MEMBER · CURRENT</p><span>MEMBER</span><strong>${L("標準累積","Standard earning","Acumulación estándar")}</strong></div><i aria-hidden="true">→</i><div><p class="eyebrow">VIP · NOT OPEN</p><span>VIP</span><strong>${L("較高倍率","Higher earning rate","Tasa mayor")}</strong></div></div><header><h2>${L("同一趟合格旅行，VIP 累積更多。","The same eligible journey earns more with VIP.","El mismo viaje elegible acumula más con VIP.")}</h2><p>${L("服務內容不變；VIP 只增加旅行金、家庭旅行管理與提前預覽。","Service stays the same; VIP only adds travel credit, household tools and early previews.","El servicio no cambia; VIP añade crédito, herramientas familiares y vistas previas.")}</p><button class="btn" data-vip-fit>${L("用 4 題了解 VIP・設計示意","Understand VIP in four questions · demo","Entender VIP en cuatro preguntas · demo")}</button></header><div class="bc-membership-reward-rows"><div><small>01</small><b>${L("旅行金","TRAVEL CREDIT","CRÉDITO")}</b><span>${L("MEMBER 標準累積 → VIP 較高倍率","MEMBER standard → VIP higher rate","MEMBER estándar → VIP tasa mayor")}</span></div><div><small>02</small><b>${L("家庭旅行","HOUSEHOLD","FAMILIA")}</b><span>${L("VIP 增加同行者與共同偏好工作區","VIP adds a shared household workspace","VIP añade un espacio familiar compartido")}</span></div><div><small>03</small><b>${L("提前預覽","EARLY PREVIEW","VISTA PREVIA")}</b><span>${L("指定新行程先看；不保留席位與價格","See selected journeys first; no seat or price hold","Ver viajes seleccionados; sin reservar plaza ni precio")}</span></div></div><div class="bc-membership-promise"><b>${L("每位已購客人服務完整","FULL SERVICE FOR EVERY PURCHASE","SERVICIO COMPLETO EN CADA COMPRA")}</b><span>${L("會員等級不改變履約、文件、付款、退改或安全分流。","Tier never changes fulfillment, documents, payment, changes or safety escalation.","El nivel no cambia cumplimiento, documentos, pagos, cambios o seguridad.")}</span></div>${bcMembershipCompactDetails(true)}</section>`;
  return bcMemberPage(L("VIP，多賺一點；服務一樣完整。","VIP earns more; service stays complete.","VIP acumula más; el servicio sigue completo."),"MEMBERSHIP · REWARD FIRST",body);
}

/* Membership value lab · paid VIP hypotheses.
   These later declarations intentionally replace the earlier density studies. */
function bcMembershipCompactDetails(includeFlow = true) {
  const flow = includeFlow ? bcMembershipDisclosure(
    L("先用 4 題算值不值得訂","First, see if VIP is worth it in four questions","Primero, calcule si VIP vale la pena"),
    L("不常旅行時，結果會直接建議保留免費 MEMBER。","If you rarely travel, the result will recommend keeping free MEMBER.","Si viaja poco, el resultado recomendará mantener MEMBER gratis."),
    bcGuidedFlow("vip"),
    `id="bc-vip-fit" ${bcFlowState("vip").open || bcFlowState("vip").step ? "open" : ""}`
  ) : "";
  const credit = bcMembershipDisclosure(
    L("旅行金與年度淨價值怎麼算？","How are travel credit and annual net value calculated?","¿Cómo se calculan el crédito y el valor anual?"),
    L("商品基礎累積 × 等級倍率；只比較 VIP 比 MEMBER 多得到的部分。","Product base earn × tier multiplier; compare only the value VIP adds over MEMBER.","Acumulación base × multiplicador; compare solo el valor adicional de VIP."),
    `<div class="bc-membership-credit-policy">
      <div class="bc-membership-credit-unit"><small>${L("折抵單位・設計提案","REDEMPTION UNIT · PROPOSAL","UNIDAD DE CANJE · PROPUESTA")}</small><strong>1 PACK&GO CREDIT = ${money(1)}</strong><span>${L("正式匯率、可用商品與效期仍待商業及會計確認。","Final conversion, eligible products and expiry still require business and accounting approval.","La conversión, productos y vencimiento requieren aprobación.")}</span></div>
      <div class="bc-membership-credit-bases">
        <div><b>${L("團體／客製旅行","GROUP / CUSTOM","GRUPO / A MEDIDA")}</b><span>${L(`每 ${money(200)} 合格金額 = 1 基礎旅行金`,`Every ${money(200)} eligible = 1 base credit`,`Cada ${money(200)} elegibles = 1 crédito base`)}</span></div>
        <div><b>${L("飯店／接送／機票服務額","HOTEL / TRANSFER / FLIGHT SERVICE","HOTEL / TRASLADO / SERVICIO AÉREO")}</b><span>${L(`每 ${money(400)} 合格服務額 = 1 基礎旅行金`,`Every ${money(400)} eligible service amount = 1 base credit`,`Cada ${money(400)} de servicio elegible = 1 crédito base`)}</span></div>
        <div><b>${L("政府費、稅費與代收","GOVERNMENT, TAX & PASS-THROUGH","GOBIERNO, IMPUESTOS Y TERCEROS")}</b><span>${L("不累積；退款、取消或未完成旅行不入帳或正式版扣回。","No earn; refunded, canceled or incomplete travel is excluded or reversed in production.","No acumula; reembolsos, cancelaciones o viajes incompletos se excluyen o revierten.")}</span></div>
      </div>
      <div class="bc-membership-multipliers"><span><small>MEMBER</small><b>1×</b></span><i aria-hidden="true">→</i><span><small>VIP · ${L("設計測試","DESIGN TEST","PRUEBA")}</small><b>2×</b></span></div>
      <div class="bc-vip-value-equation" data-vip-value-equation><b>${L("VIP 淨年度價值","VIP NET ANNUAL VALUE","VALOR ANUAL NETO VIP")}</b><span>${L("年度旅行金 + 比 MEMBER 多賺的旅行金 + 實際使用的禮遇 − VIP 年費","annual trip credit + incremental credit over MEMBER + perks actually used − VIP fee","crédito anual + crédito adicional sobre MEMBER + beneficios usados − cuota VIP")}</span></div>
    </div>`
  );
  const service = bcMembershipDisclosure(
    L("每位已購客人的完整服務","Full service for every customer who purchases","Servicio completo para cada cliente"),
    L("履約、文件、退改、異常與安全分流不因等級減少。","Fulfillment, documents, changes, exceptions and safety support never shrink by tier.","Cumplimiento, documentos, cambios y seguridad no disminuyen por nivel."),
    `<ul class="bc-membership-service-list"><li>${L("訂位履約、必要文件、付款與退款資訊","Order fulfillment, required documents, payment and refund information","Cumplimiento, documentos, pagos y reembolsos")}</li><li>${L("退改協助、供應商異常與問題解決","Change assistance, supplier exceptions and issue resolution","Cambios, incidencias de proveedores y resolución")}</li><li>${L("無障礙、申訴、高風險與人身安全分流","Accessibility, complaints, high-risk and personal-safety escalation","Accesibilidad, reclamos y escalación de seguridad")}</li></ul>`
  );
  return `<div class="bc-membership-disclosures">${flow}${credit}${service}</div>`;
}

function bcMembershipVariantA() {
  const body = `<section id="bc-membership-design" tabindex="-1" class="bc-vip-value-study">
    <header class="bc-vip-offer-hero">
      <div><p class="eyebrow">PAID VIP · DESIGN HYPOTHESIS</p><h2>${L("一趟家庭旅行，回本要看得見。","One household trip should show the payback.","Un viaje familiar debe mostrar el retorno.")}</h2><p>${L("VIP 不是付費買客服。這個測試方案把價值放在加入當下、每次完成旅行，以及一家人共同使用。","VIP is not paid customer service. This test puts value at enrollment, after each completed journey and across the household.","VIP no es pagar por atención. Esta prueba aporta valor al unirse, al completar viajes y para el hogar.")}</p><button class="btn light" data-vip-fit>${L("用 4 題算我的年度價值・設計示意","Estimate my annual value in four questions · demo","Calcular mi valor anual en cuatro preguntas · demo")}</button></div>
      <div class="bc-vip-price-block"><small>${L("測試年費・尚未開放","TEST ANNUAL FEE · NOT OPEN","CUOTA DE PRUEBA · NO DISPONIBLE")}</small><strong data-vip-price>${money(99)}</strong><span>/ 12 ${L("個月","MONTHS","MESES")}</span><i>${L("不會加入、續訂或扣款","NO ENROLLMENT, RENEWAL OR CHARGE","SIN ALTA, RENOVACIÓN NI COBRO")}</i></div>
    </header>
    <div class="bc-vip-value-ledger">
      <article data-vip-benefit="credit"><small>01 · ${L("加入當下","ON ENROLLMENT","AL UNIRSE")}</small><strong>${money(75)}</strong><h3>${L("年度合格旅行金","Annual eligible trip credit","Crédito anual elegible")}</h3><p>${L("加入或續期後每年一次；最低消費、不可用項目與未用完規則待定。","Once per join or renewal year; minimum spend, exclusions and unused-credit rules are pending.","Una vez por año; gasto mínimo, exclusiones y crédito no usado pendientes.")}</p></article>
      <article data-vip-benefit="credit"><small>02 · ${L("完成旅行後","AFTER TRAVEL","TRAS EL VIAJE")}</small><strong>2×</strong><h3>${L("旅行金累積倍率","Travel-credit multiplier","Multiplicador de crédito")}</h3><p>${L("同一合格商品 MEMBER 1×、VIP 2×；旅行完成後入帳，退款正式版扣回。","The same eligible product earns 1× for MEMBER and 2× for VIP; posted after travel and reversed after refunds.","El mismo producto acumula 1× con MEMBER y 2× con VIP; se acredita tras viajar y se revierte al reembolsar.")}</p></article>
      <article data-vip-benefit="household"><small>03 · ${L("一家人","HOUSEHOLD","HOGAR")}</small><strong>1</strong><h3>${L("一份訂閱，共用旅行價值","One subscription, shared trip value","Una suscripción, valor compartido")}</h3><p>${L("訂閱者同行時，共用合格禮遇、旅客清單與共同偏好；文件、付款與同意仍各自控管。","When the subscriber travels, the household shares eligible perks, travelers and preferences; documents, payments and consent stay individual.","Cuando viaja el suscriptor, el hogar comparte beneficios y preferencias; documentos, pagos y consentimiento siguen individuales.")}</p></article>
      <article data-vip-benefit="access"><small>04 · VIP ACCESS</small><strong>REAL</strong><h3>${L("有價格或內容，才顯示禮遇","Show access only when value is concrete","Mostrar acceso solo con valor concreto")}</h3><p>${L("只顯示可核對的 VIP 價、額外旅行金、席位或已確認合作禮遇；單純提早看不算價值。","Show only a verifiable VIP price, extra credit, seat or confirmed partner perk; an early look alone is not value.","Solo precio VIP verificable, crédito extra, plaza o beneficio confirmado; mirar antes no basta.")}</p></article>
    </div>
    <section class="bc-vip-net-strip" data-vip-net-value><div><p class="eyebrow">HONEST VALUE TEST</p><h3>${L("算的是 VIP 比免費會員多得到多少。","Count only what VIP adds over free membership.","Cuente solo lo que VIP añade sobre la membresía gratis.")}</h3></div><p>${L(`先以 ${money(75)} 年度旅行金 + 額外倍率 + 實際用到的禮遇，再減 ${money(99)} 年費；若沒有正值，就留在免費 MEMBER。`,`Start with ${money(75)} annual credit + incremental earn + perks actually used, then subtract the ${money(99)} fee. If it is not positive, keep free MEMBER.`,`Sume ${money(75)} de crédito + acumulación adicional + beneficios usados y reste ${money(99)}. Si no es positivo, mantenga MEMBER gratis.`)}</p></section>
    <div class="bc-membership-promise"><b>${L("服務不分等級","SERVICE DOES NOT CHANGE BY TIER","EL SERVICIO NO CAMBIA")}</b><span>${L("VIP 買的是額外旅行價值，不是優先處理、必要文件檢查或 Jeff 的服務額度。","VIP buys additional travel value—not priority handling, required document review or a quota of Jeff's time.","VIP compra valor de viaje adicional, no prioridad, revisión obligatoria ni cuotas de tiempo de Jeff.")}</span></div>
    ${bcMembershipCompactDetails(true)}
  </section>`;
  return bcMemberPage(L("VIP 是否值得訂？","Is VIP worth subscribing to?","¿Vale la pena suscribirse a VIP?"),"MEMBERSHIP · ANNUAL VALUE",body);
}

function bcMembershipVariantB() {
  const body = `<section id="bc-membership-design" tabindex="-1" class="bc-vip-household-study">
    <div class="bc-vip-household-hero"><figure><img src="${BC_IMG.london}" alt="${L("家庭旅客在倫敦旅行的彩色示意照片","Color travel scene for a household journey in London","Escena de viaje familiar en Londres")}"/><figcaption><p class="eyebrow">HOUSEHOLD VALUE · DESIGN HYPOTHESIS</p><h2>${L("一家人的旅程，不必每次從零開始。","A household journey should not restart from zero.","Un viaje familiar no debería empezar siempre de cero.")}</h2></figcaption></figure><aside><small>${L("測試方案・尚未開放","TEST OFFER · NOT OPEN","OFERTA DE PRUEBA · NO DISPONIBLE")}</small><strong>${money(99)}</strong><span>/ 12 ${L("個月","months","meses")}</span><p>${L(`${money(75)} 年度旅行金、VIP 2× 累積，以及訂閱者同行時的家庭共用價值。`,`${money(75)} annual trip credit, 2× VIP earn and shared household value when the subscriber travels.`,`${money(75)} de crédito anual, 2× acumulación y valor familiar cuando viaja el suscriptor.`)}</p><button class="btn light" data-vip-fit>${L("看看我家是否適合・設計示意","See if it fits my household · demo","Ver si encaja con mi hogar · demo")}</button></aside></div>
    <section class="bc-vip-household-room" data-vip-benefit="household"><header><p class="eyebrow">DEMO HOUSEHOLD · PRIVATE BY DESIGN</p><h3>${L("共同準備，個別掌控。","Prepare together. Keep individual control.","Preparar juntos. Control individual.")}</h3></header><div><small>TRAVELER 01</small><b>DEMO MEMBER</b><span>${L("訂閱者・同行時啟用合格家庭禮遇","Subscriber · eligible household perks apply when traveling","Suscriptor · beneficios familiares al viajar")}</span></div><div><small>TRAVELER 02</small><b>DEMO ADULT</b><span>${L("可重用偏好；不公開文件或付款","Reusable preferences; documents and payment stay private","Preferencias reutilizables; documentos y pago privados")}</span></div><div><small>TRAVELER 03</small><b>DEMO CHILD</b><span>${L("餐食、床型與座位偏好示意","Sample meal, bed and seating preferences","Preferencias de comida, cama y asiento")}</span></div><footer>${L("示意資料｜家庭人數上限、受益資格與共享權限仍待商業、隱私與法務確認。","DEMO DATA · Household limit, eligibility and permissions still need business, privacy and legal review.","DATOS DEMO · Límites, elegibilidad y permisos requieren revisión.")}</footer></section>
    <div class="bc-vip-household-principles"><article><small>01</small><h3>${L("福利跟著合格訂單","Benefit follows the eligible booking","El beneficio sigue la reserva elegible")}</h3><p>${L("訂閱者必須同行；不把 VIP 變成可無限轉借的折扣碼。","The subscriber must travel; VIP is not an unlimited transferable discount code.","El suscriptor debe viajar; VIP no es un descuento transferible ilimitado.")}</p></article><article><small>02</small><h3>${L("只共享必要偏好","Share only useful preferences","Compartir solo preferencias útiles")}</h3><p>${L("同行者、房型、餐食與行動需求可重用；敏感文件仍逐人授權。","Travelers, room, meals and mobility needs can be reused; sensitive documents require individual authorization.","Viajeros, habitación, comidas y movilidad se reutilizan; documentos requieren autorización individual.")}</p></article><article><small>03</small><h3>${L("家庭價值之外仍要回本","Household convenience is not the whole return","La comodidad familiar no es todo el retorno")}</h3><p>${L("年費仍由年度旅行金、額外累積與實際禮遇證明，不把便利硬算成現金。","Annual credit, incremental earn and actual perks must still justify the fee; convenience is not assigned fake cash value.","Crédito anual, acumulación y beneficios deben justificar la cuota; no se inventa valor en efectivo.")}</p></article></div>
    <div class="bc-membership-promise"><b>${L("完整服務仍相同","FULL SERVICE REMAINS THE SAME","EL SERVICIO SIGUE IGUAL")}</b><span>${L("免費 MEMBER 與 VIP 的已購訂單，都得到相同履約、文件、退改、異常與安全支援。","Purchased orders receive the same fulfillment, documents, changes, exception and safety support for MEMBER and VIP.","Los pedidos reciben el mismo cumplimiento, documentos, cambios y soporte con MEMBER o VIP.")}</span></div>
    ${bcMembershipCompactDetails(true)}
  </section>`;
  return bcMemberPage(L("VIP，為一家人省下重複。","VIP removes repetition for the household.","VIP elimina repeticiones para el hogar."),"MEMBERSHIP · HOUSEHOLD",body);
}

function bcMembershipVariantC() {
  const examples = [
    {tour:BC_TOURS[0],eyebrow:L("年度旅行金可用・設計示意","ANNUAL CREDIT ELIGIBLE · DEMO","CRÉDITO ANUAL APLICABLE · DEMO"),value:L(`${money(75)} 可用於合格團費`,`${money(75)} toward eligible tour value`,`${money(75)} para circuito elegible`)},
    {tour:BC_TOURS[1],eyebrow:L("額外累積・設計示意","INCREMENTAL EARN · DEMO","ACUMULACIÓN ADICIONAL · DEMO"),value:L("同一合格金額 VIP 2×","VIP earns 2× on the same eligible amount","VIP acumula 2× sobre el mismo importe")},
    {tour:BC_TOURS[2],eyebrow:L("合作禮遇・設計示意","PARTNER PERK · DEMO","BENEFICIO DE SOCIO · DEMO"),value:L("確認後才顯示 eSIM／接送／飯店禮遇","eSIM, transfer or hotel perk shown only after confirmation","eSIM, traslado u hotel solo tras confirmación")}
  ];
  const cards = examples.map(({tour,eyebrow,value})=>`<article class="bc-vip-access-card" data-vip-benefit="access"><img src="${tour.image}" alt="${bcEscape(bcTxt(tour.title))}"/><div><small>${eyebrow}</small><h3>${bcTxt(tour.title)}</h3><p>${bcTxt(tour.destination)} · ${tour.days} ${L("天","days","días")} · ${money(tour.price)} ${L("起","from","desde")}</p><strong>${value}</strong><button data-tour="${tour.id}">${L("查看對應行程","View this journey","Ver este viaje")} →</button></div></article>`).join("");
  const body = `<section id="bc-membership-design" tabindex="-1" class="bc-vip-access-study"><header class="bc-vip-access-head"><div><p class="eyebrow">VIP ACCESS · DESIGN HYPOTHESIS</p><h2>${L("有價格、有席位、有內容，才叫 VIP 禮遇。","A price, a seat or real content makes VIP access.","Precio, plaza o contenido real hacen el acceso VIP.")}</h2></div><div><p>${L("不再把「提早看」當主要價值。每個 VIP 標記旁，必須同時說清客人實際多得到什麼。","An early look is no longer the main value. Every VIP marker must state what the customer actually receives.","Mirar antes ya no es el valor principal. Cada marca VIP debe decir qué recibe realmente el cliente.")}</p><button class="btn" data-vip-fit>${L("算算是否值得訂・設計示意","See if it is worth subscribing · demo","Calcular si vale la pena · demo")}</button></div></header><div class="bc-vip-access-grid">${cards}</div><div class="bc-vip-access-rule"><b>${L("只在確認後顯示","SHOW ONLY AFTER CONFIRMATION","MOSTRAR SOLO TRAS CONFIRMACIÓN")}</b><span>${L("VIP 價需有利潤空間；席位需供應商確認；合作禮遇需列明適用日期、對象與限制。上方皆為設計示意。","VIP price needs sufficient margin; seats require supplier confirmation; partner perks need dates, eligibility and limits. All examples above are design demos.","El precio VIP requiere margen; las plazas confirmación; los beneficios fechas, elegibilidad y límites. Todo es demo.")}</span></div><div class="bc-membership-promise"><b>${L("不是付費買優先服務","NOT PAID PRIORITY SERVICE","NO ES PRIORIDAD PAGADA")}</b><span>${L("每筆已購訂單的履約與必要支援仍相同；VIP 只增加可核對的旅行價值。","Fulfillment and required support remain the same for every purchased order; VIP adds only verifiable travel value.","Cumplimiento y soporte siguen iguales; VIP solo añade valor verificable.")}</span></div>${bcMembershipCompactDetails(true)}</section>`;
  return bcMemberPage(L("VIP Access，必須看得見價值。","VIP Access must show real value.","VIP Access debe mostrar valor real."),"MEMBERSHIP · VIP ACCESS",body);
}

function bcMembershipLabSwitcher() {
  if (!state.membershipLab) return "";
  const names={A:L("年度價值","Annual value","Valor anual"),B:L("家庭共享","Household","Hogar"),C:"VIP Access"};
  return `<div class="bc-member-design-switcher" aria-label="${L("會員權益設計切換器","Membership design switcher","Selector de diseño de membresía")}"><button data-membership-design-step="-1" aria-label="${L("上一個會員權益設計","Previous membership design","Diseño anterior")}">←</button><div><b>${state.membershipDesign} · ${names[state.membershipDesign]}</b><small>MEMBERSHIP LAB · DESIGN DEMO</small></div><button data-membership-design-step="1" aria-label="${L("下一個會員權益設計","Next membership design","Diseño siguiente")}">→</button></div>`;
}

function membershipBC() {
  const design = state.membershipLab ? state.membershipDesign : "A";
  const page = design === "B" ? bcMembershipVariantB() : design === "C" ? bcMembershipVariantC() : bcMembershipVariantA();
  return `${page}${bcMembershipLabSwitcher()}`;
}

function legacy_bookingDrawerBC() {
  if (!state.bookingOpen) return "";
  const t = bcCurrentTour();
  const departure = t.departures.find(d => d.start === state.bookingDate) || t.departures[0];
  const perPerson = departure.price;
  const knownPerPerson = t.estimate + (perPerson - t.price);
  const total = perPerson * state.bookingGuests;
  const known = knownPerPerson * state.bookingGuests;
  const steps = Array.from({length:4},(_,i)=>`<span class="step-dot ${i < state.bookingStep ? "active" : ""}"></span>`).join("");
  const product = `<div class="bc-booking-product"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p class="eyebrow">${t.code} · ${L("設計示意","DESIGN DEMO","DEMO")}</p><h2>${bcTxt(t.title)}</h2><p>${departure.start} → ${departure.end} · ${state.bookingGuests} ${L("位旅客","travelers","viajeros")}</p></div></div>`;
  let body = "";
  if (state.bookingStep === 1) body = `${product}<h2 class="serif">${L("選日期與人數","Choose date and guests","Elegir fecha y viajeros")}</h2><div class="quick-form">${t.departures.map(d=>`<label class="check-row"><input type="radio" name="bc-departure" data-book-date="${d.start}" ${departure.start===d.start?"checked":""}/> <span><b>${d.start} → ${d.end}</b><br><small>${bcTxt(d.status)} · ${d.seats} ${L("位示意餘位","sample seats","plazas de ejemplo")} · ${money(d.price)}</small></span></label>`).join("")}<div class="bc-guest-stepper"><div><b>${L("旅客人數","Travelers","Viajeros")}</b><br><small>${L("成人示意價格","Sample adult price","Precio adulto de ejemplo")}</small></div><div class="bc-guest-controls"><button data-guests="-1" aria-label="${L("減少旅客","Decrease travelers","Reducir viajeros")}"><span class="bc-stepper-icon" aria-hidden="true"></span></button><b>${state.bookingGuests}</b><button data-guests="1" aria-label="${L("增加旅客","Increase travelers","Aumentar viajeros")}"><span class="bc-stepper-icon" aria-hidden="true"></span></button></div></div></div><div class="bc-booking-total"><div class="cost-row"><span>${L("示意團費小計","Sample tour subtotal","Subtotal de ejemplo")}</span><b>${money(total)}</b></div><div class="cost-row"><span>${L("每人預估已知總花費","Known total per person","Total conocido por persona")}</span><b>${money(knownPerPerson)}</b></div><div class="cost-row"><span>${L("全體預估已知總花費","Known trip total","Total conocido del viaje")}</span><strong>${money(known)}</strong></div></div><button class="btn wide" data-book-next>${L("繼續填旅客資料","Continue to travelers","Continuar a viajeros")}</button>`;
  if (state.bookingStep === 2) body = `${product}<h2 class="serif">${L("旅客資料","Traveler details","Datos de viajeros")}</h2><p class="muted">${L("只用 DEMO MEMBER 示意，不會送出資料或建立真實旅客。","DEMO MEMBER data only. Nothing is sent and no traveler is created.","Solo datos DEMO MEMBER. No se envía ni crea ningún viajero.")}</p><div class="field-grid"><div class="field"><label>${L("護照英文名","Given name","Nombre")}</label><input value="DEMO"/></div><div class="field"><label>${L("護照英文姓","Surname","Apellido")}</label><input value="MEMBER A"/></div><div class="field full"><label>Email</label><input value="demo.member@example.invalid"/></div><div class="field"><label>${L("旅客人數","Travelers","Viajeros")}</label><input value="${state.bookingGuests}" readonly/></div><div class="field"><label>${L("房型","Room","Habitación")}</label><input value="${L("示意雙人房","Sample double room","Doble de ejemplo")}"/></div></div><div class="bc-booking-total"><div class="cost-row"><span>${L("示意團費總額","Sample tour total","Total de ejemplo")}</span><strong>${money(total)}</strong></div><div class="cost-row"><span>${L("尚須另付或估算","Additional known costs","Costos conocidos adicionales")}</span><b>${money(known-total)}</b></div></div><div class="bc-form-actions"><button class="btn ghost" data-book-prev>${L("上一步","Back","Atrás")}</button><button class="btn" data-book-next>${L("付款前確認","Review before payment","Revisar antes de pagar")}</button></div>`;
  if (state.bookingStep === 3) body = `${product}<h2 class="serif">${L("本次總價與付款前揭露","Trip total and pre-payment review","Total y revisión previa")}</h2><div class="bc-booking-total"><div class="cost-row"><span>${L("示意團費授權","Sample tour authorization","Autorización de ejemplo")}</span><strong>${money(total)}</strong></div><div class="cost-row"><span>${L("另付與預估支出","Separate estimated costs","Costos estimados aparte")}</span><b>${money(known-total)}</b></div><div class="cost-row"><span>${L("預估已知總花費","Estimated known total","Total conocido estimado")}</span><strong>${money(known)}</strong></div></div><div class="disclosure"><h3>${L("正式流程必須保存的同意","Consent production must preserve","Consentimiento que debe conservarse")}</h3><p>${L("團費包含、必付與自費、取消條款、付款對象、供應商確認條件、CST 與 TCRF 揭露。","Included, required and optional costs; cancellation, payee, supplier confirmation, CST and TCRF disclosure.","Incluido, obligatorio y opcional; cancelación, quién cobra, confirmación, CST y TCRF.")}</p><label class="check-row"><input type="checkbox" data-book-consent ${state.bookingConsent?"checked":""}/><span>${L("我已閱讀以上設計示意揭露。","I reviewed this design-demo disclosure.","He revisado esta divulgación de ejemplo.")}</span></label></div><div class="bc-form-actions"><button class="btn ghost" data-book-prev>${L("上一步","Back","Atrás")}</button><button class="btn" data-book-next data-book-mode="payment" ${state.bookingConsent?"":"disabled"}>${L("模擬付款授權","Simulate authorization","Simular autorización")}</button></div><button class="btn ghost wide" style="margin-top:8px" data-book-next data-book-mode="request" ${state.bookingConsent?"":"disabled"}>${L("改為模擬提交訂位","Simulate booking request instead","Simular solicitud de reserva")}</button>`;
  if (state.bookingStep === 4) body = `<div class="success-hero"><div class="success-mark">✓</div><h2>${state.bookingMode==="payment"?L("設計示意：付款授權流程完成","Design demo: authorization flow complete","Demo: autorización completada"):L("設計示意：訂位提交流程完成","Design demo: booking-request flow complete","Demo: solicitud de reserva completada")}</h2><p class="muted">${L("沒有扣款、沒有建立訂位、沒有寄信，也沒有送出 DEMO MEMBER 資料。","No charge, booking, email or DEMO MEMBER data transmission occurred.","No hubo cargo, reserva, correo ni envío de datos DEMO MEMBER.")}</p></div><div class="disclosure"><div class="cost-row"><span>${L("示意訂單編號","Sample order","Pedido de ejemplo")}</span><b>DEMO-PG-1042</b></div><div class="cost-row"><span>${L("介面狀態","Interface state","Estado de interfaz")}</span><b>${L("待會員中心追蹤","Ready for member tracking","Listo para seguimiento")}</b></div><div class="cost-row"><span>${L("真實交易","Real transaction","Transacción real")}</span><b>${L("未發生","None","Ninguna")}</b></div></div><button class="btn wide" data-book-finish>${L("前往訂單進度示意","Open sample order progress","Abrir progreso de ejemplo")}</button>`;
  return `<div class="booking-backdrop" data-book-close></div><aside class="booking-drawer bc-booking-drawer" role="dialog" aria-modal="true" aria-labelledby="bc-booking-title"><div class="drawer-head"><b id="bc-booking-title" tabindex="-1">${L("自助訂購・設計示意","Self-service booking · design demo","Reserva autoservicio · demo")}</b><button class="drawer-close" data-book-close aria-label="${L("關閉","Close","Cerrar")}">×</button></div><div class="drawer-body"><div class="demo-note">${L("不會扣款、送出資料、訂位或寄信。","No charge, data transmission, booking or email.","Sin cargo, envío de datos, reserva ni correo.")}</div><div class="stepper">${steps}</div>${body}</div></aside>`;
}

/* --------------------------------------------------------------------------
   BC refinement layer · 2026-07-14
   The prototype remains throwaway. These later declarations intentionally
   replace the first-pass screens with a quieter header, guided briefs,
   a private journey center, explicit login, and a real payment-demo route.
   -------------------------------------------------------------------------- */

const BC_DEMO_MEMBER = {
  label: "DEMO MEMBER",
  tier: "MEMBER",
  traveler: "DEMO MEMBER A",
  email: "demo.member@example.invalid",
  preferences: [bcI18n("繁體中文服務","Traditional Chinese service","Servicio en chino tradicional"), bcI18n("舊金山出發","San Francisco departure","Salida desde San Francisco"), bcI18n("小團慢旅","Slow small groups","Grupos pequeños y pausados")]
};

function bcHeader() {
  const primaryLinks = [
    ["tours", L("團體行程", "Group journeys", "Circuitos"), L("路線與班期", "Routes & dates", "Rutas y fechas")],
    ["flights", L("機票服務", "Flight service", "Servicio de vuelos"), L("航班與行李", "Flights & baggage", "Vuelos y equipaje")],
    ["china-visa", L("中國簽證", "China visa", "Visado chino"), L("資格與文件", "Eligibility & documents", "Requisitos y documentos")]
  ];
  const serviceLinks = [
    ["custom", L("客製旅行", "Custom travel", "Viaje a medida"), L("從兩人旅行到多人包團", "From two travelers to private groups", "De dos viajeros a grupos privados")],
    ["transfer", L("機場接送", "Airport transfer", "Traslado al aeropuerto"), L("依航班 人數與行李安排合適車型", "A vehicle matched to flight travelers and luggage", "Vehículo según vuelo viajeros y equipaje")],
    ["hotel", L("飯店服務", "Hotels", "Hoteles"), L("獨立訂房 行程住宿與特殊房型", "Independent stays tour hotels and special rooms", "Hotel independiente de circuito o especial")]
  ];
  const siteLinks = [
    ["membership", L("會員方案", "Membership plans", "Planes de membresía")],
    ["contact", L("聯絡與支援", "Support", "Soporte")],
    ["about", L("關於 PACK&GO", "About", "Acerca de PACK&GO")]
  ];
  const privateMemberViews = ["member","orders","order-detail","travelers","payments","checkout","favorites"];
  const activeRoot = privateMemberViews.includes(state.view) ? "member" : ["visa","china-visa-check"].includes(state.view) ? "china-visa" : state.view;
  const serviceRoot = state.view === "group" ? "custom" : state.view === "china-visa-check" ? "china-visa" : state.view;
  const moreActive = state.view === "services" || [...serviceLinks, ...siteLinks].some(([view]) => view === state.view);
  const inMemberSpace = privateMemberViews.includes(state.view);
  const memberView = state.demoAuthenticated || inMemberSpace ? "member" : "login";
  const memberLabel = state.demoAuthenticated || inMemberSpace ? L("我的旅程", "My journey", "Mi viaje") : L("登入", "Sign in", "Ingresar");
  const localeLabel = `${state.language === "zh" ? "繁中" : state.language.toUpperCase()} · ${state.currency}`;
  const primaryPanel = primaryLinks.map(([view,label,description]) => `<button class="bc-nav-priority-link ${activeRoot===view?"active":""}" data-view="${view}" ${activeRoot===view?'aria-current="page"':""}><span><strong>${label}</strong><small>${description}</small></span>${icon("arrow")}</button>`).join("");
  const servicePanel = serviceLinks.map(([view,label,description]) => `<button class="bc-nav-service-link ${serviceRoot===view?"active":""}" data-view="${view}" ${serviceRoot===view?'aria-current="page"':""}><span><strong>${label}</strong><small>${description}</small></span>${icon("arrow")}</button>`).join("");
  const sitePanel = siteLinks.map(([view,label]) => `<button class="bc-nav-site-link ${state.view===view?"active":""}" data-view="${view}" ${state.view===view?'aria-current="page"':""}>${label}</button>`).join("");
  const overviewPanel = `<button class="bc-nav-overview-link ${state.view==="services"?"active":""}" data-view="services" ${state.view==="services"?'aria-current="page"':""}><span><small>${L("完整服務目錄","COMPLETE SERVICE INDEX")}</small><strong>${L("旅行服務總覽","Travel services overview")}</strong></span><span class="bc-nav-overview-action">${L("查看全部","View all")}${icon("arrow")}</span></button>`;
  const menuLabel = state.mobileOpen ? L("關閉", "Close", "Cerrar") : L("所有服務", "All services", "Servicios");
  return `<header class="bc-nav bc-header-editorial"><div class="bc-nav-inner">
      <button class="bc-brand" data-view="home" aria-label="PACK&GO ${L("旅行社首頁","travel agency home","agencia de viajes")}"><img class="bc-brand-mark" src="${BC_BRAND.mark}" alt=""/><picture class="bc-brand-wordmark"><source media="(max-width: 760px)" srcset="${BC_BRAND.wordmarkMobile}"/><img src="${BC_BRAND.wordmark}" alt=""/></picture></button>
      <nav class="bc-nav-links" aria-label="${L("主要導覽","Primary navigation","Navegación principal")}">${primaryLinks.map(([view,label,description])=>`<button class="bc-nav-link ${activeRoot===view?"active":""}" data-view="${view}" ${activeRoot===view?'aria-current="page"':""}><span>${label}</span><small>${description}</small></button>`).join("")}</nav>
      <div class="bc-nav-tools"><button id="bc-locale-menu" class="bc-locale-button" data-nav-toggle aria-label="${L("開啟語言與幣別選單","Open language and currency menu","Abrir idioma y moneda")}">${localeLabel}</button><button class="bc-member-button" data-view="${memberView}" ${activeRoot==="member"?'aria-current="page"':""}>${memberLabel}</button><button id="bc-more-menu" class="bc-menu-toggle bc-menu-toggle-visible ${state.mobileOpen||moreActive?"active":""}" data-nav-toggle aria-label="${state.mobileOpen?L("關閉所有服務選單","Close all services menu","Cerrar menú de servicios"):L("查看所有旅行服務","View all travel services","Ver todos los servicios")}" aria-expanded="${state.mobileOpen}" aria-controls="bc-site-menu"><span class="bc-menu-label">${menuLabel}</span></button></div>
    </div>${state.mobileOpen?`<div class="bc-nav-scrim" data-nav-close aria-hidden="true"></div><nav id="bc-site-menu" class="bc-nav-panel" aria-label="${L("所有旅行服務","All travel services","Todos los servicios")}"><div class="bc-nav-panel-top"><div><p class="eyebrow">${L("服務選單","SERVICES","SERVICIOS")}</p><h2>${L("先選今天要完成的事","Choose what to arrange today","Elija qué desea organizar")}</h2></div><button class="bc-nav-close" data-nav-close aria-label="${L("關閉選單","Close menu","Cerrar menú")}">×</button></div><p class="bc-nav-panel-intro">${L("選一項即可　我們只詢問完成這件事真正需要的資料","Choose one service and we will ask only for the details it needs","Elija un servicio y solo pediremos los datos necesarios")}</p>${overviewPanel}<section class="bc-nav-priority" aria-label="${L("主要服務","Primary services","Servicios principales")}"><p class="bc-nav-section-label">${L("主要服務","PRIMARY SERVICES","SERVICIOS PRINCIPALES")}</p>${primaryPanel}</section><p class="bc-nav-section-label bc-nav-other-label">${L("其他旅行安排","OTHER ARRANGEMENTS","OTROS SERVICIOS")}</p><div class="bc-nav-service-links">${servicePanel}</div><div class="bc-nav-site-links">${sitePanel}</div>${state.demoAuthenticated?`<button class="bc-nav-member-context" data-view="member"><span><small>DEMO MEMBER</small><b>${L("下一步　完成旅客資料","Next　complete traveler details","Siguiente　completar viajeros")}</b></span>${icon("arrow")}</button>`:""}<div class="bc-nav-panel-tools"><label><span>${L("語言","Language","Idioma")}</span><select id="mobile-language-select" class="bc-select" aria-label="${L("語言","Language","Idioma")}"><option value="zh" ${state.language==="zh"?"selected":""}>繁體中文</option><option value="en" ${state.language==="en"?"selected":""}>English</option><option value="es" ${state.language==="es"?"selected":""}>Español</option></select></label><label><span>${L("幣別","Currency","Moneda")}</span><select id="mobile-currency-select" class="bc-select" aria-label="${L("幣別","Currency","Moneda")}"><option ${state.currency==="USD"?"selected":""}>USD</option><option ${state.currency==="TWD"?"selected":""}>TWD</option><option ${state.currency==="CNY"?"selected":""}>CNY</option><option ${state.currency==="CAD"?"selected":""}>CAD</option></select></label></div></nav>`:""}</header>`;
}

function bcFlowDefinitions() {
  const option = (value, label, note = "") => ({value,label,note});
  const chinaAnswers = state.guidedFlows.china?.answers || {};
  const chinaSteps = [
    {key:"serviceArea",question:L("申請人目前在舊金山灣區嗎","Is the applicant currently in the San Francisco Bay Area"),help:L("本服務目前只受理可在灣區寄送或親送護照的美國護照申請人","This service currently accepts U S passport applicants who can mail or deliver the passport within the Bay Area"),options:[option("bay",L("是　可以寄送或親送","Yes　mail or delivery is possible")),option("outside",L("不在目前服務地區","Outside the current service area"))]}
  ];
  if (chinaAnswers.serviceArea === "bay") {
    chinaSteps.push({key:"age",question:L("申請人已滿十八歲嗎","Is the applicant 18 or older"),help:L("未成年申請會改走父母文件路徑","Minors follow a separate parent document path"),options:[option("adult",L("已滿十八歲","18 or older")),option("minor",L("未滿十八歲","Under 18"))]});
  }
  if (chinaAnswers.serviceArea === "bay" && chinaAnswers.age) {
    chinaSteps.push({key:"applicants",question:L("這次共有幾位一起辦理","How many people are applying together"),help:L("兩位以上適用同行費率","Two or more applicants use the group rate"),options:[option("one",L("一位","One applicant")),option("group",L("兩位以上","Two or more"))]});
  }
  if (chinaAnswers.applicants && chinaAnswers.age === "adult") {
    chinaSteps.push({key:"application",question:L("這次屬於哪一種申請","Which application type is this"),options:[option("renewal",L("曾有中國簽證","I have held a China visa"),L("更新或重新申請","Renewal or new application")),option("first",L("第一次申請","First application"))]});
    if (chinaAnswers.application === "first") {
      chinaSteps.push({key:"formerStatus",question:L("申請人過去屬於哪一種身分","Which prior status applies"),help:L("這一題會直接改變舊證件清單","This answer changes the prior document checklist"),options:[option("china",L("曾持中國護照","Former Chinese passport holder")),option("hongkong",L("曾持香港證件","Former Hong Kong document holder")),option("other",L("曾持其他國籍護照","Former passport from another country")),option("usborn",L("美國出生","Born in the United States"))]});
    }
  }
  if (chinaAnswers.applicants && chinaAnswers.age === "minor") {
    chinaSteps.push({key:"parentStatus",question:L("父母在孩子出生時的身分為何","What was the parents status when the child was born"),help:L("父母護照與合法居留文件是未成年案件最常缺少的資料","Parent passports and legal status documents are the most common missing items for minors"),options:[option("us",L("父母皆為美國公民","Both parents were U S citizens")),option("nonus",L("一方或雙方非美國公民","One or both were not U S citizens")),option("unsure",L("不確定","Not sure"))]});
  }
  const chinaIdentityReady = chinaAnswers.age === "minor"
    ? Boolean(chinaAnswers.parentStatus)
    : chinaAnswers.application === "renewal" || Boolean(chinaAnswers.formerStatus);
  if (chinaIdentityReady) {
    chinaSteps.push(
      {key:"validity",question:L("美國護照還有多久有效期","How long is the U S passport valid"),help:L("重要提醒　PACK&GO 建議至少保留十八個月效期　少於十八個月可能只核發一年簽證　建議先更新護照","Important　PACK&GO recommends at least 18 months of passport validity　With less than 18 months the visa may be limited to one year　Renewing the passport first is recommended"),alert:true,options:[option("eighteenPlus",L("十八個月以上","18 months or more"),L("可以繼續資格預檢","Continue the pre check")),option("underEighteen",L("少於十八個月","Less than 18 months"),L("建議先更新美國護照再申請","Renew the U S passport before applying")),option("unsure",L("不確定","Not sure"),L("請先查看護照到期日","Check the passport expiration date first"))]},
      {key:"date",question:L("預計何時出發","When do you expect to depart"),type:"date",default:"2026-12-15",label:L("預計出發日","Expected departure")},
      {key:"rush",question:L("是否有可證明的人道緊急原因","Is there a documented humanitarian emergency"),help:L("一般觀光急件不適用加急","Ordinary tourism urgency does not qualify for rush handling"),options:[option("standard",L("沒有 走一般流程","No use standard processing")),option("humanitarian",L("有 並可提供證明","Yes and proof is available"))]}
    );
  }
  const chinaTotalSteps = chinaAnswers.serviceArea === "outside" ? 1 : chinaAnswers.age === "minor" || chinaAnswers.application === "renewal" ? 7 : 8;
  const customSize = state.guidedFlows.custom?.answers?.size || "";
  const customIsGroup = ["6-11","12+"].includes(customSize);
  const customSizeStep = {key:"size",question:L("這次共有幾位旅行？","How many people are traveling?","¿Cuántas personas viajan?"),help:L("只先回答人數；6 位以上會在同一個客製入口改問包團需要的資料。","Start with party size. Six or more switches to group-specific questions in this same service.","Empiece por el tamaño. Seis o más activa preguntas para grupos en este mismo servicio."),options:[option("solo",L("1 位","1 traveler","1 viajero"),L("一般客製旅行","Standard custom path","Ruta personalizada")),option("2-5",L("2–5 位","2–5 travelers","2–5 viajeros"),L("伴侶、家庭或親友","Couple, family or friends","Pareja, familia o amigos")),option("6-11",L("6–11 位","6–11 travelers","6–11 viajeros"),L("自動進入多人包團問題","Continue with group questions","Continuar con preguntas de grupo")),option("12+",L("12 位以上","12 or more","12 o más"),L("自動進入多人包團問題","Continue with group questions","Continuar con preguntas de grupo"))]};
  const customSteps = customIsGroup ? [
    customSizeStep,
    {key:"purpose",question:L("這群人為了什麼一起出發？","What brings this group together?","¿Qué reúne al grupo?"),options:[option("family",L("親友旅行・慶祝","Family or celebration","Familia o celebración")),option("club",L("社團・學校","Club or school","Club o escuela")),option("company",L("企業活動","Company trip","Viaje de empresa"))]},
    {key:"format",question:L("可以沿用現有團體行程嗎？","Could a current tour work?","¿Puede servir un circuito actual?"),options:[option("same",L("可以，日期路線照走","Yes, keep it as published","Sí, tal como está")),option("adapt",L("大致可以，想微調","Yes, with selected changes","Sí, con cambios")),option("custom",L("不行，需要重新設計","No, build from scratch","No, desde cero"))]},
    {key:"date",question:L("希望哪時出發？","When should the group depart?","¿Cuándo debe salir?"),type:"date",default:"2027-01-16",label:L("希望出發日","TARGET DEPARTURE","SALIDA DESEADA")},
    {key:"budget",question:L("希望每人落在哪個價位","What price range feels right per person","Qué precio por persona prefiere"),options:[option("2-3k",`${money(2000)}–${money(3000)}`),option("3-5k",`${money(3000)}–${money(5000)}`),option("5k+",`${money(5000)}+`),option("unknown",L("還不確定","Not sure yet","Aún no sé"))]},
    {key:"needs",question:L("有哪一項共同條件最重要？","Which shared need matters most?","¿Qué necesidad común importa más?"),options:[option("none",L("沒有特殊條件","No special need","Sin necesidad especial")),option("mobility",L("長者・無障礙","Seniors or accessibility","Mayores o accesibilidad")),option("rooms",L("特殊或團體房型","Special or group rooms","Habitaciones especiales")),option("schedule",L("活動或會議時段","Event or meeting schedule","Horario de evento"))]}
  ] : [
    customSizeStep,
    {key:"destination",question:L("目的地想好了嗎？","How certain is the destination?","¿Ya tiene destino?"),options:[option("fixed",L("已經確定","I know where","Ya está decidido")),option("shortlist",L("有兩三個選項","I have a shortlist","Tengo varias opciones")),option("open",L("還沒有，想被推薦","I’m open to ideas","Quiero recomendaciones"))]},
    {key:"date",question:L("日期有多少彈性？","How flexible are the dates?","¿Qué tan flexibles son las fechas?"),options:[option("fixed",L("固定日期","Fixed dates","Fechas fijas")),option("week",L("前後一週","About one week","Una semana")),option("month",L("只確定月份","Only the month","Solo el mes"))]},
    {key:"party",question:L("同行者組成是？","Who is traveling together?","¿Quién viaja?"),options:[option("solo",L("一人旅行","Solo traveler","Una persona")),option("couple",L("伴侶或兩位成人","Couple or two adults","Pareja o dos adultos")),option("family",L("家庭・含孩童","Family with children","Familia con niños")),option("seniors",L("有長者同行","Traveling with seniors","Viajan mayores")),option("friends",L("親友小旅行","Friends","Amigos"))]},
    {key:"budget",question:L("希望每人落在哪個價位","What price range feels right per person","Qué precio por persona prefiere"),options:[option("2-3k",`${money(2000)}–${money(3000)}`),option("3-5k",`${money(3000)}–${money(5000)}`),option("5k+",`${money(5000)}+`),option("unknown",L("還不確定","Not sure yet","Aún no sé"))]},
    {key:"pace",question:L("希望旅行節奏如何？","What pace feels right?","¿Qué ritmo prefiere?"),options:[option("slow",L("舒適慢行","Comfortable and slow","Cómodo y pausado")),option("balanced",L("景點與休息平衡","Balanced","Equilibrado")),option("full",L("盡量多看","See as much as possible","Ver lo máximo posible"))]},
    {key:"must",question:L("最後，有沒有不能妥協的條件？","Any non-negotiable needs?","¿Hay algo imprescindible?"),type:"text",default:L("例如：無障礙、連通房或飲食限制","For example: accessibility, connected rooms or diet","Por ejemplo: accesibilidad, habitaciones conectadas o dieta"),label:L("必要條件・設計示意","MUST-HAVES · DEMO","IMPRESCINDIBLES · DEMO")}
  ];
  return {
    flights: {
      eyebrow: "FLIGHT BRIEF · DESIGN DEMO",
      title: L("一起找出合適的航班。","Let’s find the right flight.","Busquemos el vuelo adecuado."),
      result: L("需求已整理，可以比較完整旅程成本。","Your brief is ready for a full-trip comparison.","Su solicitud está lista para comparar el costo total."),
      steps: [
        {key:"trip", question:L("這次怎麼飛？","What kind of trip is this?","¿Qué tipo de viaje es?"), help:L("先決定基本路線，複雜行程才交給真人。","Start with the route; only complex trips need a person.","Empiece por la ruta; solo lo complejo necesita una persona."), options:[option("round",L("來回","Round trip","Ida y vuelta"),L("同一出發地與目的地","Same origin and destination","Mismo origen y destino")),option("oneway",L("單程","One way","Solo ida")),option("multi",L("多城市","Multi-city","Multiciudad"),L("正式版轉人工協助","Production routes to a person","La versión final pasa a una persona"))]},
        {key:"route", question:L("從哪裡飛到哪裡？","Where are you flying?","¿De dónde a dónde vuela?"), type:"text", default:"SFO → MAD", label:L("機場或城市","AIRPORTS OR CITIES","AEROPUERTOS O CIUDADES")},
        {key:"date", question:L("希望哪天出發？","When would you like to depart?","¿Cuándo quiere salir?"), type:"date", default:"2026-10-03", label:L("出發日","DEPARTURE","SALIDA")},
        {key:"travelers", question:L("共有幾位旅客？","How many travelers?","¿Cuántos viajeros?"), options:[option("1",L("1 位","1 traveler","1 viajero")),option("2",L("2 位","2 travelers","2 viajeros")),option("3-5",L("3–5 位","3–5 travelers","3–5 viajeros")),option("6+",L("6 位以上","6 or more","6 o más"))]},
        {key:"baggage", question:L("每人預計帶多少行李？","How much baggage per traveler?","¿Cuánto equipaje por viajero?"), help:L("行李費會直接改變完整總價；特殊器材會在正式版分流給真人。","Baggage changes the complete price; special equipment would route to a person in production.","El equipaje cambia el precio total; el equipo especial pasa a una persona."), options:[option("carry",L("只有隨身行李","Carry-on only","Solo equipaje de mano")),option("one",L("1 件托運行李","One checked bag","Una maleta facturada")),option("two",L("2 件托運行李","Two checked bags","Dos maletas facturadas")),option("special",L("有嬰兒車、輪椅或特殊器材","Stroller, wheelchair or special equipment","Cochecito, silla de ruedas o equipo especial"))]},
        {key:"priority", question:L("最重要的是什麼？","What matters most?","¿Qué importa más?"), options:[option("price",L("完整總價","Complete price","Precio total"),L("含行李與必要費用","Including bags and required fees","Incluye equipaje y tasas")),option("time",L("更短飛行時間","Shorter journey","Viaje más corto")),option("change",L("退改彈性","Change flexibility","Flexibilidad"))]}
      ]
    },
    visa: {
      eyebrow: "VISA CHECK · DESIGN DEMO", title:L("先判斷適用路徑。","First, determine the right path.","Primero, determine la ruta correcta."), result:L("已建立文件路徑示意；正式版仍須核對最新官方規則。","A sample document path is ready; production must verify current official rules.","La ruta de documentos está lista; la versión final debe verificar las reglas oficiales."), nextView:"china-visa", nextLabel:L("查看中國簽證示意","View China visa demo","Ver demo de visado chino"),
      steps:[
        {key:"passport",question:L("使用哪一本護照？","Which passport will you use?","¿Qué pasaporte usará?"),options:[option("us",L("美國護照","U.S. passport","Pasaporte estadounidense")),option("tw",L("台灣護照","Taiwan passport","Pasaporte de Taiwán")),option("other",L("其他護照","Another passport","Otro pasaporte"))]},
        {key:"destination",question:L("這次要去哪裡？","Where are you going?","¿A dónde viaja?"),options:[option("china",L("中國大陸","Mainland China","China continental")),option("uk",L("英國","United Kingdom","Reino Unido")),option("other",L("其他目的地","Another destination","Otro destino"))]},
        {key:"purpose",question:L("主要旅行目的？","What is the main purpose?","¿Cuál es el motivo principal?"),options:[option("tourism",L("觀光","Tourism","Turismo")),option("family",L("探親","Family visit","Visita familiar")),option("business",L("商務","Business","Negocios"))]},
        {key:"date",question:L("預計何時出發？","When do you expect to depart?","¿Cuándo espera salir?"),type:"date",default:"2026-11-15",label:L("出發日","DEPARTURE","SALIDA")}
      ]
    },
    china: {
      eyebrow:L("中國簽證資格預檢","China visa pre check"), title:L("只回答會改變文件清單的問題","Answer only what changes the document list"), result:L("資格預檢完成","Pre check complete"),
      totalSteps:chinaTotalSteps,
      steps:chinaSteps
    },
    custom: {
      eyebrow:customIsGroup?"PRIVATE GROUP BRIEF · DESIGN DEMO":"TRAVEL BRIEF · DESIGN DEMO", title:L("我們從最重要的選擇開始。","We’ll start with the choices that matter.","Empezamos con lo que importa."), result:customIsGroup?L("多人包團輪廓已整理；沒有建立報價案件。","Your private-group outline is ready; no quote case was created.","El perfil del grupo está listo; no se creó cotización."):L("旅行輪廓已整理；正式版會先回傳可行路徑與缺少條件。","Your travel outline is ready; production would return a feasible path and missing facts.","El perfil está listo; la versión final devolvería una ruta viable y datos faltantes."),
      steps:customSteps
    },
    group: {
      eyebrow:"PRIVATE GROUP BRIEF · DEMO", title:L("先判斷適合哪一種包團。","First, find the right group format.","Primero, elija el formato de grupo."), result:L("已得到示意包團路徑；沒有建立報價案件。","A sample group path is ready; no quote case was created.","La ruta de grupo está lista; no se creó cotización."),
      steps:[
        {key:"purpose",question:L("這個團為了什麼出發？","What brings the group together?","¿Qué reúne al grupo?"),options:[option("family",L("親友旅行・慶祝","Family or celebration","Familia o celebración")),option("club",L("社團・學校","Club or school","Club o escuela")),option("company",L("企業活動","Company trip","Viaje de empresa"))]},
        {key:"size",question:L("預估多少人？","How large is the group?","¿Cuántas personas?"),options:[option("6-11","6–11"),option("12-18","12–18"),option("19-30","19–30"),option("31+","31+")]},
        {key:"format",question:L("可以沿用現有路線嗎？","Could an existing route work?","¿Puede servir una ruta existente?"),options:[option("same",L("可以，日期路線照走","Yes, keep it as published","Sí, tal como está")),option("adapt",L("大致可以，想微調","Yes, with some changes","Sí, con cambios")),option("custom",L("不行，需要重新設計","No, build from scratch","No, desde cero"))]},
        {key:"date",question:L("希望哪時出發？","When should the group depart?","¿Cuándo debe salir?"),type:"date",default:"2027-01-16",label:L("希望出發日","TARGET DEPARTURE","SALIDA DESEADA")},
        {key:"needs",question:L("有哪一項特殊條件最重要？","Which special need matters most?","¿Qué necesidad importa más?"),options:[option("none",L("沒有特殊條件","No special need","Sin necesidad especial")),option("mobility",L("長者・無障礙","Seniors or accessibility","Mayores o accesibilidad")),option("rooms",L("特殊房型","Special rooms","Habitaciones especiales")),option("schedule",L("活動或會議時段","Event or meeting schedule","Horario de evento"))]}
      ]
    },
    transfer: {
      eyebrow:"TRANSFER BRIEF · DESIGN DEMO", title:L("接送只問車型需要的資訊。","Only the facts needed for the right vehicle.","Solo los datos necesarios para el vehículo."), result:L("已建立示意車型需求；不派車、不送單、不扣款。","A sample vehicle brief is ready; no dispatch, order or charge.","La solicitud está lista; sin despacho, pedido ni cobro."),
      steps:[
        {key:"direction",question:L("需要接機還是送機？","Pickup or drop-off?","¿Recogida o traslado al aeropuerto?"),options:[option("pickup",L("機場接機","Airport pickup","Recogida en aeropuerto")),option("dropoff",L("送到機場","Airport drop-off","Traslado al aeropuerto")),option("round",L("來回都需要","Both ways","Ambos trayectos"))]},
        {key:"flight",question:L("航班號是多少？","What is the flight number?","¿Cuál es el número de vuelo?"),type:"text",default:"UA 194",label:L("航班號・正式版自動帶出時間","FLIGHT · TIME AUTO-FILLED IN PRODUCTION","VUELO · HORA AUTOMÁTICA")},
        {key:"address",question:L("另一端的地址在哪裡？","What is the other address?","¿Cuál es la otra dirección?"),type:"text",default:"Newark, CA",label:L("接送地址","ADDRESS","DIRECCIÓN")},
        {key:"party",question:L("幾位旅客、幾件大行李？","How many guests and large bags?","¿Cuántos viajeros y maletas grandes?"),options:[option("2-2",L("2 人・2 件","2 guests · 2 bags","2 viajeros · 2 maletas")),option("4-4",L("4 人・4 件","4 guests · 4 bags","4 viajeros · 4 maletas")),option("6-6",L("6 人・6 件","6 guests · 6 bags","6 viajeros · 6 maletas")),option("other",L("其他組合","Another combination","Otra combinación"))]},
        {key:"special",question:L("需要特殊安排嗎？","Any special setup?","¿Necesita algo especial?"),options:[option("none",L("不需要","No","No")),option("child",L("兒童安全座椅","Child seat","Asiento infantil")),option("mobility",L("輪椅或無障礙","Wheelchair or accessibility","Silla de ruedas o accesibilidad")),option("stops",L("多站接送","Multiple stops","Varias paradas"))]}
      ]
    },
    hotel: {
      eyebrow:"HOTEL PATH · DESIGN DEMO", title:L("先選對訂房路徑。","First, choose the right hotel path.","Primero, elija la ruta correcta."), result:L("住宿需求示意已整理；不會導向外站或建立訂房。","The sample stay brief is ready; no redirect or booking.","La solicitud está lista; sin redirección ni reserva."),
      steps:[
        {key:"path",question:L("這次需要哪一種住宿？","What kind of stay is this?","¿Qué tipo de estancia necesita?"),options:[option("standard",L("一般訂房比價","Standard hotel search","Búsqueda estándar")),option("tour",L("查看行程住宿","Hotel in my tour","Hotel de mi circuito")),option("special",L("特殊房型需求","Special room request","Habitación especial"))]},
        {key:"destination",question:L("想住在哪裡？","Where would you like to stay?","¿Dónde quiere alojarse?"),type:"text",default:"Madrid",label:L("目的地或飯店","DESTINATION OR HOTEL","DESTINO U HOTEL")},
        {key:"date",question:L("預計哪天入住？","When do you check in?","¿Cuándo entra?"),type:"date",default:"2026-10-03",label:L("入住日","CHECK-IN","ENTRADA")},
        {key:"needs",question:L("房間最重要的條件？","What matters most in the room?","¿Qué importa más en la habitación?"),options:[option("price",L("含稅總價清楚","Clear total with taxes","Total claro con impuestos")),option("cancel",L("可取消彈性","Cancellation flexibility","Cancelación flexible")),option("beds",L("床型與連通房","Beds or connected rooms","Camas o habitaciones conectadas")),option("accessible",L("無障礙房型","Accessible room","Habitación accesible"))]}
      ]
    },
    vip: {
      eyebrow:"VIP VALUE CHECK · DESIGN DEMO",
      title:L("先算一年值不值得，再決定要不要訂。","Estimate one year of value before subscribing.","Calcule un año de valor antes de suscribirse."),
      result:L("VIP 年度價值示意已整理；不會建立訂閱、資格或旅行金。","The annual VIP value demo is ready; no subscription, status or credit was created.","La demo de valor VIP está lista; no se creó suscripción, nivel ni crédito."),
      steps:[
        {key:"frequency",question:L("未來 12 個月，大概會跟 PACK&GO 旅行幾次？","How often might you travel with PACK&GO in the next 12 months?","¿Cuántas veces podría viajar con PACK&GO en 12 meses?"),help:L("如果沒有明確旅程，免費 MEMBER 通常更合理。","Without a likely journey, free MEMBER is usually the better choice.","Sin un viaje probable, MEMBER gratis suele ser mejor."),options:[option("none",L("目前沒有計畫","No current plan","Sin plan actual")),option("one",L("大約 1 次","About once","Aproximadamente 1 vez")),option("two",L("大約 2 次","About twice","Aproximadamente 2 veces")),option("three",L("3 次以上","Three or more","Tres o más"))]},
        {key:"spend",question:L("這一年，合格的 PACK&GO 消費大約多少？","About how much eligible PACK&GO spend might you have this year?","¿Cuánto gasto PACK&GO elegible podría tener este año?"),help:L("只估 PACK&GO 可累積部分；稅費、政府費、票面價與供應商代收不算。","Estimate only the PACK&GO-eligible portion; taxes, government fees, face-value airfare and supplier pass-through do not count.","Estime solo la parte elegible; impuestos, tasas, tarifa aérea y cobros de terceros no cuentan."),options:[option("under3",L(`${money(3000)} 以下`,`Under ${money(3000)}`,`Menos de ${money(3000)}`)),option("3to6",`${money(3000)}–${money(6000)}`),option("6to10",`${money(6000)}–${money(10000)}`),option("over10",`${money(10000)}+`)]},
        {key:"household",question:L("通常是誰一起旅行？","Who usually travels together?","¿Quién suele viajar junto?"),help:L("家庭便利不硬換算成現金；只用來判斷共享功能是否真的有用。","Household convenience is not assigned fake cash value; this only checks whether sharing is useful.","La comodidad familiar no recibe un valor en efectivo inventado; solo verifica si compartir sirve."),options:[option("solo",L("主要自己旅行","Mostly solo","Principalmente solo")),option("pair",L("通常 2 人","Usually two","Normalmente dos")),option("family",L("家庭 3–5 人","Household of 3–5","Familia de 3–5")),option("varies",L("每次同行者不同","Different travelers each time","Viajeros distintos cada vez"))]},
        {key:"value",question:L("哪一種額外價值最可能真的用到？","Which added value would you actually use?","¿Qué valor adicional usaría de verdad?"),help:L("沒有實際使用就不列入回本；單純提早看也不算。","Unused perks do not count toward payback; an early look alone does not count either.","Los beneficios no usados no cuentan; mirar antes tampoco."),options:[option("credit",L("年度旅行金","Annual trip credit","Crédito anual")),option("household",L("家庭旅行工作區","Household trip workspace","Espacio familiar")),option("price",L("明確 VIP 價或額外旅行金","A clear VIP price or extra credit","Precio VIP o crédito adicional")),option("partner",L("已確認的 eSIM／接送／飯店禮遇","Confirmed eSIM, transfer or hotel perk","eSIM, traslado u hotel confirmado"))]}
      ]
    },
    support: {
      eyebrow:"SUPPORT TRIAGE · DESIGN DEMO", title:L("先把問題送到對的人。","Route the issue to the right place.","Dirija el problema al lugar correcto."), result:L("支援路徑示意完成；沒有寄信或建立真實案件。","Sample support path complete; no email or case was created.","Ruta de soporte lista; no se envió correo ni se creó un caso."),
      steps:[
        {key:"issue",question:L("需要處理哪一件事？","What needs attention?","¿Qué necesita atención?"),options:[option("order",L("訂單與行程","Order and journey","Pedido y viaje")),option("flight",L("機票與退改","Flight or changes","Vuelo o cambios")),option("visa",L("中國簽證案件","China visa case","Caso de visado chino")),option("other",L("其他例外","Another exception","Otra excepción"))]},
        {key:"order",question:L("要帶入哪一筆訂單？","Which order should we include?","¿Qué pedido incluimos?"),options:[option("1042","DEMO-PG-1042"),option("1078","DEMO-PG-1078"),option("none",L("與訂單無關","Not order-related","No está relacionado"))]},
        {key:"risk",question:L("旅客目前安全嗎？","Is everyone safe right now?","¿Todos están seguros ahora?"),options:[option("safe",L("安全，可一般處理","Safe · standard support","Seguro · soporte normal")),option("urgent",L("涉及安全、重大醫療或護照遺失","Safety, major medical or lost passport","Seguridad, salud grave o pasaporte perdido"))]},
        {key:"need",question:L("希望解決什麼？","What outcome do you need?","¿Qué necesita resolver?"),type:"text",default:L("例如：確認改期選項與費用","For example: confirm change options and cost","Por ejemplo: confirmar opciones y costo"),label:L("請勿填護照號碼、卡號或密碼","NO PASSPORT, CARD OR PASSWORD","SIN PASAPORTE, TARJETA NI CONTRASEÑA")}
      ]
    },
    traveler: {
      eyebrow:"TRAVELER DETAILS · DESIGN DEMO", title:L("一次確認一項旅客資料。","Confirm one traveler detail at a time.","Confirme un dato a la vez."), result:L("旅客資料確認示意完成；沒有上傳文件或儲存個資。","Sample traveler review complete; no document or personal data was stored.","Revisión completa; no se guardó documento ni dato personal."),
      steps:[
        {key:"profile",question:L("這次要使用哪位示意旅客？","Which sample traveler is going?","¿Qué viajero de ejemplo viaja?"),options:[option("a",BC_DEMO_MEMBER.traveler),option("later",L("稍後新增旅客・設計示意","Add a traveler later · demo","Añadir después · demo"))]},
        {key:"name",question:L("護照英文姓名顯示正確嗎？","Does the passport name look correct?","¿El nombre del pasaporte es correcto?"),options:[option("yes",L("DEMO / MEMBER A・正確","DEMO / MEMBER A · correct","DEMO / MEMBER A · correcto")),option("edit",L("需要修改・設計示意","Needs editing · demo","Necesita cambio · demo"))]},
        {key:"expiry",question:L("護照效期符合這次旅行嗎？","Is the sample passport valid for this trip?","¿El pasaporte sirve para este viaje?"),options:[option("yes",L("示意效期 2028.10.01・符合","Sample expiry 2028.10.01 · valid","Vence 2028.10.01 · válido")),option("review",L("需要人工確認","Needs review","Necesita revisión"))]},
        {key:"document",question:L("護照資料頁何時提供？","When will the passport page be provided?","¿Cuándo se proporcionará el pasaporte?"),options:[option("now",L("使用正式安全上傳・設計示意","Secure upload · demo","Carga segura · demo")),option("later",L("稍後再提供","Provide later","Proporcionar después"))]}
      ]
    }
  };
}

function bcFlowState(id) {
  return state.guidedFlows[id] || {step:0,answers:{},open:false};
}

function bcEscape(value) {
  return String(value ?? "").replace(/[&<>\"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[char]);
}

function bcFlowAnswerLabel(step, value) {
  return step.options?.find(option => option.value === value)?.label || value || "—";
}

function bcVipSubscriptionResult(answers) {
  const bands = {
    under3:[0,3000],
    "3to6":[3000,6000],
    "6to10":[6000,10000],
    over10:[10000,15000]
  };
  const noTrip = answers.frequency === "none";
  const [spendLow,spendHigh] = noTrip ? [0,0] : (bands[answers.spend] || [0,3000]);
  const fee = 99;
  const annualCredit = noTrip ? 0 : 75;
  const extraLow = Math.round(spendLow * .0025);
  const extraHigh = Math.round(spendHigh * .005);
  const valueLow = annualCredit + extraLow;
  const valueHigh = annualCredit + extraHigh;
  const netLow = valueLow - fee;
  const netHigh = valueHigh - fee;
  const cash = value => value < 0 ? `−${money(Math.abs(value))}` : money(value);
  const range = (low,high) => low === high ? cash(low) : `${cash(low)}–${cash(high)}`;
  let title;
  let copy;
  if (noTrip) {
    title = L("目前先保留免費 MEMBER 比較划算。","For now, keeping free MEMBER is the better value.","Por ahora, conviene mantener MEMBER gratis.");
    copy = L("沒有明確旅程時，年度旅行金用不到；付年費不會因為等級名稱而變划算。","Without a likely journey, the annual credit goes unused; a tier name alone does not make the fee worthwhile.","Sin un viaje probable, el crédito no se usa; el nombre del nivel no justifica la cuota.");
  } else if (netHigh < 0) {
    title = L("以目前輪廓，免費 MEMBER 仍比較合理。","With this profile, free MEMBER still looks more sensible.","Con este perfil, MEMBER gratis sigue siendo más razonable.");
    copy = L("先等到結帳能顯示一項確定的 VIP 價格或禮遇，再重新比較；不要為可能用不到的福利先付費。","Recheck only when checkout can show a confirmed VIP price or perk; do not prepay for benefits you may not use.","Vuelva a comparar cuando el pago muestre un precio o beneficio VIP confirmado; no pague por algo que quizá no use.");
  } else if (netLow >= 0) {
    title = L("若合格金額確認，VIP 很可能值得訂。","If the eligible amount is confirmed, VIP is likely worth subscribing to.","Si se confirma el importe elegible, VIP probablemente vale la pena.");
    copy = L("仍要在加入前顯示本次可用的年度旅行金、預估額外累積與續訂日，讓客人最後確認。","Before joining, show the annual credit usable now, estimated incremental earn and renewal date for final confirmation.","Antes de unirse, muestre crédito utilizable, acumulación adicional y fecha de renovación.");
  } else {
    title = L("VIP 可能回本，但要看這次實際可用價值。","VIP may pay back, but the actual booking value decides.","VIP puede compensar la cuota, pero depende del valor real de la reserva.");
    copy = L("只有結帳清楚顯示的 VIP 價、額外旅行金或已確認禮遇才加進來；若加總仍未超過年費，就留在 MEMBER。","Add only the VIP price, extra credit or confirmed perk shown at checkout. If the total still does not exceed the fee, keep MEMBER.","Sume solo precio VIP, crédito extra o beneficio confirmado en el pago. Si no supera la cuota, mantenga MEMBER.");
  }
  const household = ["family","varies"].includes(answers.household)
    ? L("家庭工作區可能很有用，但這裡沒有把便利硬算成現金。","The household workspace may be useful, but no fake cash value is assigned to convenience.","El espacio familiar puede ser útil, pero no se le asigna un valor en efectivo inventado.")
    : L("家庭共享在這個輪廓不是主要回本來源。","Household sharing is not the main payback source for this profile.","Compartir en familia no es la fuente principal de retorno en este perfil.");
  const unpriced = ["price","partner"].includes(answers.value)
    ? L("你選的價格／合作禮遇尚未計入，必須先由商品或供應商確認。","Your selected price or partner perk is not included yet; the product or supplier must confirm it first.","El precio o beneficio elegido aún no se incluye; debe confirmarlo el producto o proveedor.")
    : L("試算只納入年度旅行金與比 MEMBER 多賺的旅行金。","The estimate includes only annual credit and incremental earn over MEMBER.","La estimación incluye solo crédito anual y acumulación adicional sobre MEMBER.");
  return `<div class="bc-vip-fit-result"><h2>${title}</h2><p>${copy}</p><div class="bc-vip-result-math" data-vip-value-equation><span><small>${L("可計價年度價值","PRICED ANNUAL VALUE","VALOR ANUAL CALCULADO")}</small><b>${range(valueLow,valueHigh)}</b></span><i aria-hidden="true">−</i><span><small>${L("測試年費","TEST FEE","CUOTA DE PRUEBA")}</small><b data-vip-price>${money(fee)}</b></span><i aria-hidden="true">=</i><span data-vip-net-value><small>${L("淨年度價值範圍","NET ANNUAL RANGE","RANGO ANUAL NETO")}</small><b>${range(netLow,netHigh)}</b></span></div><small>${household} ${unpriced}</small></div>`;
}

function bcVipFitAction(answers) {
  const keepMember = answers.frequency === "none" || answers.spend === "under3";
  return keepMember
    ? `<button class="btn" data-view="member">${L("繼續使用免費 MEMBER","Keep using free MEMBER","Seguir con MEMBER gratis")}</button>`
    : `<button class="btn" data-demo-action>${L("查看 VIP 加入條款・設計示意","Review VIP enrollment terms · demo","Revisar condiciones VIP · demo")}</button>`;
}

function bcChinaVisaProfile(answers = {}) {
  const adult = answers.age === "adult";
  const minor = answers.age === "minor";
  const groupRate = answers.applicants === "group";
  const fee = groupRate ? 275 : 290;
  const commonAdult = [
    L("美國護照正本","Original U S passport"),
    L("駕照清晰照片或掃描檔","Clear photo or scan of the driver license"),
    L("中國簽證申請資料","China visa application information"),
    L("上傳合格證件照或預約到店拍攝","Upload a compliant photo or schedule an in store photo")
  ];
  let title = L("需要進一步確認申請路徑","The application path needs review");
  let checklist = [];
  if (minor) {
    title = L("未成年申請","Minor application");
    checklist = [
      L("孩子的美國護照正本","Original U S passport for the child"),
      L("孩子的出生證明","Child birth certificate"),
      L("孩子出生時父母雙方的護照資料","Both parents passport records at the time of birth"),
      ...(answers.parentStatus === "nonus" ? [L("非美國公民父母的綠卡或綠卡申請證明","Green card or pending green card proof for any non U S citizen parent")] : []),
      L("中國簽證申請資料","China visa application information"),
      L("上傳合格證件照或預約到店拍攝","Upload a compliant photo or schedule an in store photo")
    ];
  } else if (adult && answers.application === "renewal") {
    title = L("曾有中國簽證重新申請","Previous China visa application");
    checklist = [commonAdult[0],L("含舊中國簽證的舊護照正本","Original previous passport containing the China visa"),...commonAdult.slice(1)];
  } else if (answers.formerStatus === "china") {
    title = L("曾持中國護照首次申請","First application for a former Chinese passport holder");
    checklist = [commonAdult[0],L("舊中國護照清晰照片或掃描檔","Clear photo or scan of the previous Chinese passport"),L("入籍證明清晰照片或掃描檔","Clear photo or scan of the naturalization certificate"),L("中國身分證號碼","Chinese identity number"),...commonAdult.slice(1)];
  } else if (answers.formerStatus === "hongkong") {
    title = L("曾持香港證件首次申請","First application for a former Hong Kong document holder");
    checklist = [commonAdult[0],L("所有香港相關證件清晰照片或掃描檔","Clear photos or scans of all Hong Kong related documents"),L("包含舊香港護照與回鄉證等資料","Including previous Hong Kong passport and Home Return Permit"),L("入籍證明清晰照片或掃描檔","Clear photo or scan of the naturalization certificate"),...commonAdult.slice(1)];
  } else if (answers.formerStatus === "other") {
    title = L("曾持其他國籍護照首次申請","First application for a former passport holder of another nationality");
    checklist = [commonAdult[0],L("原國籍護照清晰照片或掃描檔","Clear photo or scan of the former nationality passport"),L("入籍證明清晰照片或掃描檔","Clear photo or scan of the naturalization certificate"),...commonAdult.slice(1)];
  } else if (answers.formerStatus === "usborn") {
    title = L("美國出生首次申請","First application for a U S born applicant");
    checklist = [commonAdult[0],L("美國出生證明","U S birth certificate"),...commonAdult.slice(1)];
  }
  return {title,checklist,fee,groupRate};
}

function bcChinaVisaResult(answers = {}) {
  if (answers.serviceArea === "outside") {
    return `<div class="bc-china-result bc-china-unavailable"><header><p class="eyebrow">${L("目前服務範圍","CURRENT SERVICE AREA")}</p><h2>${L("這次暫時無法受理","This application is outside the current service area")}</h2><p>${L("中國簽證服務目前只提供給舊金山灣區客人　不需要繼續填寫個人資料或上傳護照","China visa service is currently limited to San Francisco Bay Area customers　No personal information or passport upload is needed")}</p></header><div class="bc-china-note"><b>${L("沒有建立案件","NO CASE CREATED")}</b><span>${L("服務範圍擴大後再回來查看　目前不以一般電子郵件收取護照或敏感文件","Return when the service area expands　Passport and sensitive documents are not accepted through ordinary email")}</span></div></div>`;
  }
  const profile = bcChinaVisaProfile(answers);
  const departure = answers.date ? bcEscape(answers.date) : L("尚未填寫","Not entered");
  const rush = answers.rush === "humanitarian";
  return `<div class="bc-china-result"><header><p class="eyebrow">${L("你的辦理路徑","YOUR APPLICATION PATH")}</p><h2>${profile.title}</h2><p>${L("以下只顯示這一種身分需要準備的內容　不再讓客人自行閱讀整份通用表格","Only the documents for this applicant type are shown　There is no full generic form to decipher")}</p></header><div class="bc-china-result-grid"><section><p class="eyebrow">${L("準備文件","DOCUMENTS TO PREPARE")}</p><ol>${profile.checklist.map((item,index)=>`<li><span>${String(index+1).padStart(2,"0")}</span><b>${item}</b></li>`).join("")}</ol></section><aside><dl><div><dt>${L("服務費用","SERVICE FEE")}</dt><dd>${money(profile.fee)} <small>${L("每人","per person")}</small></dd></div><div><dt>${L("一般作業時間","STANDARD TIMING")}</dt><dd>${L("二十一個工作天","21 business days")}</dd></div><div><dt>${L("預計出發日","EXPECTED DEPARTURE")}</dt><dd>${departure}</dd></div></dl><p>${profile.groupRate?L("兩位以上同行費率已套用　費用包含照片　代辦服務與領事官方費用","The rate for two or more applicants is applied　It includes photo service handling and consular fees"):L("單人費率　費用包含照片　代辦服務與領事官方費用","Single applicant rate　It includes photo service handling and consular fees")}</p></aside></div>${answers.validity === "underEighteen" ? `<div class="bc-china-alert bc-china-passport-alert"><b>${L("建議先更新護照","RENEW THE PASSPORT FIRST")}</b><span>${L("護照剩餘效期少於十八個月　依 PACK&GO 目前收件標準　直接送件可能只核發一年簽證　若希望申請較長效期　建議先完成美國護照更新再辦理　實際核發效期仍由領事單位決定","The passport has less than 18 months of validity　Under the current PACK&GO intake standard a direct application may receive only a one year visa　Renew the U S passport first if a longer visa is desired　The final visa validity is determined by the consular authority")}</span></div>`:""}${rush?`<div class="bc-china-alert"><b>${L("人道加急待審核","HUMANITARIAN RUSH REVIEW")}</b><span>${L("需提供醫院等證明並另加","Hospital or equivalent proof is required with an additional")} ${money(100)}　${L("是否受理仍由領事單位決定","Acceptance remains subject to the consular authority")}</span></div>`:`<div class="bc-china-note"><b>${L("一般觀光不提供加急","No rush service for ordinary tourism")}</b><span>${L("作業時間不含週末與公共假日　簽證核發前不要先購買機票","Timing excludes weekends and public holidays　Do not purchase flights before visa issuance")}</span></div>`}<div class="bc-china-photo"><b>${L("照片規格","PHOTO REQUIREMENTS")}</b><span>${L("深色上衣　額頭與雙耳完整露出　半身白底　取下帽子耳環與大型飾品","Dark top　full forehead and ears visible　white background half body photo　remove hats earrings and large jewelry")}</span></div></div>`;
}

function bcChinaVisaAction(answers = {}) {
  if (answers.serviceArea === "outside") return `<button class="btn" data-view="home">${L("返回首頁","Return home")}</button>`;
  if (answers.validity === "underEighteen") return `<a class="btn" href="https://travel.state.gov/en/passports/renew-replace.html" target="_blank" rel="noopener">${L("查看官方護照更新方式","View official passport renewal options")}</a>`;
  return `<button class="btn" data-china-apply-open>${L("開始填表與上傳","Start application and uploads")}</button>`;
}

function bcChinaApplyValue(key) {
  const value = state.chinaApplyFields[key] || "";
  const localizedDemoValues = {
    __DEMO_APPLICANT__: L("示意申請人","DEMO APPLICANT"),
    __DEMO_CN_NAME__: L("示意中文姓名","SAMPLE CHINESE NAME"),
    __DEMO_BIRTHPLACE__: L("美國加州示意城市","SAMPLE CITY CALIFORNIA UNITED STATES"),
    __NA__: L("不適用","NOT APPLICABLE"),
    __US__: L("美國","UNITED STATES"),
    __DEMO_OCCUPATION__: L("示意職業","DEMO OCCUPATION"),
    __DEMO_DUTIES__: L("示意工作職責","SAMPLE JOB DUTIES"),
    __DEMO_COMPANY__: L("示意公司","DEMO COMPANY"),
    __DEMO_BUSINESS_ADDRESS__: L("示意公司地址","DEMO BUSINESS ADDRESS"),
    __DEMO_SUPERVISOR__: L("示意主管　000 000 0000","DEMO SUPERVISOR　000 000 0000"),
    __DEMO_EDUCATION__: L("示意大學學歷","SAMPLE BACHELOR DEGREE"),
    __DEMO_HOME__: L("示意美國地址","DEMO U S ADDRESS"),
    __DEMO_PHONE__: "000 000 0000",
    __DEMO_FAMILY__: L("示意家庭成員資料","DEMO FAMILY INFORMATION"),
    __DEMO_EMERGENCY__: L("示意緊急聯絡人　000 000 0000","DEMO EMERGENCY CONTACT　000 000 0000")
  };
  return localizedDemoValues[value] || value;
}

function bcChinaApplyField(key,label,{type="text",wide=false,textarea=false,hint="",placeholder="",required=false,autocomplete="off"}={}) {
  const value = bcChinaApplyValue(key);
  const labelText = `<span><b>${label}</b>${hint?`<small>${hint}</small>`:""}${required?`<em>${L("必填","Required")}</em>`:""}</span>`;
  return `<label class="bc-china-form-field ${wide?"wide":""}">${labelText}${textarea?`<textarea data-china-apply-field="${key}" rows="3" placeholder="${bcEscape(placeholder)}" ${required?"required":""}>${bcEscape(value)}</textarea>`:`<input type="${type}" value="${bcEscape(value)}" data-china-apply-field="${key}" placeholder="${bcEscape(placeholder)}" autocomplete="${autocomplete}" ${required?"required":""}/>`}</label>`;
}

function bcChinaIdentityChoices(key,label,options,{requireChoice=false}={}) {
  const value = state.chinaApplyFields[key] || (requireChoice ? "" : options[0]?.[0]) || "";
  return `<fieldset class="bc-china-choice-group"><legend>${label}</legend><div class="bc-china-choice-grid">${options.map(([optionValue,optionLabel,optionNote=""])=>`<label class="bc-china-choice"><input type="radio" name="china-${key}" value="${optionValue}" data-china-identity-choice="${key}" ${value===optionValue?"checked":""} required/><span><b>${optionLabel}</b>${optionNote?`<small>${optionNote}</small>`:""}</span></label>`).join("")}</div></fieldset>`;
}

function bcChinaApplicantName() {
  const splitName = [bcChinaApplyValue("surname"),bcChinaApplyValue("givenNames")].filter(Boolean).join(" ").trim();
  return splitName || bcChinaApplyValue("passportName");
}

function bcChinaApplication() {
  if (!state.chinaApplyOpen) return "";
  const answers = state.guidedFlows.china?.answers || {};
  const profile = bcChinaVisaProfile(answers);
  const step = Math.max(1,Math.min(6,state.chinaApplyStep));
  const stepLabels = [L("身分","Identity"),L("工作學歷","Work and education"),L("家庭聯絡","Family and contacts"),L("照片文件","Photo and documents"),L("全案核對","Application review"),L("最後付款","Final payment")];
  const documentsReady = ["photo","passport","supporting"].every(key => Boolean(state.chinaApplyUploads[key]));
  const nav = `<ol class="bc-china-apply-nav">${stepLabels.map((label,index)=>`<li class="${index+1===step?"active":""} ${index+1<step?"done":""}"><span>${String(index+1).padStart(2,"0")}</span><b>${label}</b></li>`).join("")}</ol>`;
  const actions = (nextLabel=L("繼續","Continue"),disabled=false) => `<div class="bc-china-apply-actions">${step>1?`<button class="btn ghost" data-china-apply-prev>${L("上一步","Back")}</button>`:"<span></span>"}<button class="btn" data-china-apply-next ${disabled?"disabled":""}>${nextLabel} →</button></div>`;
  let content = "";
  if (state.chinaApplyComplete) {
    content = `<section class="bc-china-packet-complete"><p class="eyebrow">${L("完成狀態預覽　尚未傳送","COMPLETION PREVIEW　NOT TRANSMITTED")}</p><span class="bc-china-packet-mark">✓</span><h2 id="bc-china-apply-title" tabindex="-1">${L("一個案件　所有資料一起交付","One case　all information delivered together")}</h2><p>${L("正式版會在最後付款完成後　把申請表　照片　條件文件與付款紀錄綁定為一個案件　並產生案件編號與寄件封面　目前沒有扣款　上傳　寄信或送件","After final payment　production would bind the application data　photo　conditional documents and payment record into one case　then create a case number and mailing cover　Nothing has been charged uploaded emailed or submitted")}</p><div class="bc-china-case-number"><small>${L("案件編號預覽","CASE NUMBER PREVIEW")}</small><strong data-keep-punctuation>DEMO CNV 20260718 01</strong><span>${L("此編號不可用於寄件或查詢","This number cannot be used for mailing or tracking")}</span></div><div class="bc-china-packet-grid"><article><span>01</span><h3>${L("申請路徑","Application path")}</h3><b>${profile.title}</b></article><article><span>02</span><h3>${L("完整申請資料","Complete application")}</h3><b>${L("身分　工作　學歷　家庭與緊急聯絡","Identity　work　education　family and emergency contact")}</b></article><article><span>03</span><h3>${L("文件索引","Document index")}</h3><b>${L("證件照　美國護照與條件文件","Photo　U S passport and conditional documents")}</b></article><article><span>04</span><h3>${L("最後付款紀錄","Final payment record")}</h3><b>${money(profile.fee)} ${L("每人　尚未扣款","per person　not charged")}</b></article></div><div class="bc-china-mailing-review"><div><p class="eyebrow">${L("取得正式案件編號之後","AFTER A REAL CASE NUMBER")}</p><h3>${L("再郵寄或親送護照","Mail or deliver the passport")}</h3><p>${L("寄件封面必須帶案件編號　沒有案件編號的護照不應寄出","The mailing cover must carry the case number　Do not send a passport without it")}</p></div><address data-keep-punctuation>PACK&GO<br>39055 Cedar Blvd #126<br>Newark CA 94560</address></div><div class="bc-china-packet-actions"><button class="btn" data-china-apply-restart>${L("重新檢查案件","Review the case again")}</button><button class="btn ghost" disabled>${L("下載案件 PDF　尚未接線","Case PDF　not connected")}</button><button class="btn ghost" disabled>${L("列印寄件封面　尚未接線","Mailing cover　not connected")}</button></div></section>`;
  } else if (step === 1) {
    const identitySection = Math.max(1,Math.min(3,state.chinaIdentitySection || 1));
    const identityChapters = [[L("護照姓名","Passport name"),L("依證件填寫","Match the document")],[L("出生國籍","Birth and citizenship"),L("只問適用資料","Only applicable details")],[L("護照狀態","Passport status"),L("最後核對證件","Final document check")]];
    const identityNav = `<ol class="bc-china-identity-nav">${identityChapters.map((chapter,index)=>`<li class="${identitySection===index+1?"active":""} ${identitySection>index+1?"done":""}"><button type="button" data-china-identity-chapter="${index+1}" ${identitySection<index+1?"disabled":""}><span>0${index+1}</span><b>${chapter[0]}</b><small>${chapter[1]}</small></button></li>`).join("")}</ol>`;
    const localActions = identitySection < 3 ? `<div class="bc-china-apply-actions">${identitySection>1?`<button type="button" class="btn ghost" data-china-identity-prev>${L("上一組","Previous group")}</button>`:"<span></span>"}<button type="button" class="btn" data-china-identity-next>${L("完成這一組","Complete this group")} →</button></div>` : `<div class="bc-china-apply-actions"><button type="button" class="btn ghost" data-china-identity-prev>${L("上一組","Previous group")}</button><button type="button" class="btn" data-china-identity-finish>${L("完成身分資料","Complete identity")} →</button></div>`;
    let identityContent = "";
    if (identitySection === 1) {
      const passportUpload = state.chinaApplyUploads.passport;
      const hasChineseName = state.chinaApplyFields.hasChineseName === "yes";
      const hasFormerNames = state.chinaApplyFields.hasFormerNames === "yes";
      identityContent = `<div class="bc-china-passport-first ${passportUpload?"ready":""}"><div><p class="eyebrow">${L("建議先做","RECOMMENDED FIRST")}</p><h3>${L("先上傳護照資料頁","Start with the passport information page")}</h3><p>${L("正式版會先辨識姓名與護照欄位　客人只需要核對與補充　也可以直接手動填寫","Production will read the name and passport fields first　Customers only review and complete them　Manual entry remains available")}</p></div><label><input type="file" accept="image/*,.pdf" capture="environment" data-china-upload="passport"/><span><b>${passportUpload?L("已選擇護照資料頁","Passport page selected"):L("拍攝或選擇護照","Capture or choose passport")}</b><small>${passportUpload||L("目前只記住檔名　不會上傳","Only the filename is retained here　Nothing is uploaded")}</small></span><i>${passportUpload?"✓":"＋"}</i></label></div><div class="bc-china-form-grid">${bcChinaApplyField("surname",L("護照姓氏","Passport surname"),{hint:L("完全依照護照英文","Exactly as shown on the passport"),required:true,autocomplete:"family-name"})}${bcChinaApplyField("givenNames",L("護照名字","Passport given names"),{hint:L("包含所有中間名","Include every middle name"),required:true,autocomplete:"given-name"})}</div>${bcChinaIdentityChoices("hasChineseName",L("是否有中文姓名","Do you have a Chinese name"),[["no",L("沒有中文姓名","No Chinese name")],["yes",L("有中文姓名","Has a Chinese name")]])}${hasChineseName?`<div class="bc-china-conditional-fields"><div class="bc-china-form-grid">${bcChinaApplyField("chineseName",L("中文姓名","Chinese name"),{hint:L("依護照或舊中國證件填寫","Enter it exactly as shown on the passport or prior Chinese document"),wide:true,required:true})}</div></div>`:""}${bcChinaIdentityChoices("hasFormerNames",L("是否使用過其他姓名","Have you used another name"),[["no",L("沒有曾用姓名","No former name")],["yes",L("使用過其他姓名","Has a former name")]])}${hasFormerNames?`<div class="bc-china-conditional-fields"><div class="bc-china-form-grid">${bcChinaApplyField("formerNames",L("所有曾用姓名","All former names"),{hint:L("依序填寫完整英文姓名","Enter each complete English name"),wide:true,required:true})}</div></div>`:""}`;
    } else if (identitySection === 2) {
      const citizenshipBasis = state.chinaApplyFields.citizenshipBasis || "birth";
      identityContent = `<div class="bc-china-form-grid">${bcChinaApplyField("birthCountry",L("出生國家","Country of birth"),{required:true})}${bcChinaApplyField("birthRegion",L("出生省州","Province or state of birth"),{required:true})}${bcChinaApplyField("birthCity",L("出生城市","City of birth"),{wide:true,required:true})}</div>${bcChinaIdentityChoices("citizenshipBasis",L("如何取得美國公民身分","How U S citizenship was acquired"),[["birth",L("出生即為美國公民","U S citizen at birth")],["naturalized",L("後來歸化入籍","Naturalized later")],["descent",L("海外出生取得公民身分","Citizenship through a U S parent")]])}${citizenshipBasis==="naturalized"?`<div class="bc-china-conditional-fields"><p>${L("只有歸化入籍者需要這兩項","These two details are required only for naturalized citizens")}</p><div class="bc-china-form-grid">${bcChinaApplyField("naturalization",L("美國入籍日期","Naturalization date"),{type:"date",required:true})}${bcChinaApplyField("formerNationality",L("入籍前國籍","Nationality before naturalization"),{required:true})}</div></div>`:""}`;
    } else {
      identityContent = `<div class="bc-china-passport-status"><div><span>${L("證件類型","DOCUMENT TYPE")}</span><h3>${L("美國普通護照","U S ordinary passport")}</h3></div><p>${L("護照效期已在資格預檢確認　若資料頁與剛才回答不一致　請先返回資格預檢重新確認","Passport validity was checked during eligibility　If the passport page differs from your answer　return to the eligibility check first")}</p></div><div class="bc-china-form-grid">${bcChinaApplyField("passportNumber",L("護照號碼","Passport number"),{hint:L("只輸入英文字母與數字","Letters and numbers only"),required:true})}${bcChinaApplyField("passportIssueDate",L("簽發日期","Date of issue"),{type:"date",required:true})}${bcChinaApplyField("passportExpiryDate",L("有效期限","Expiration date"),{type:"date",required:true})}</div>${bcChinaIdentityChoices("marital",L("婚姻狀態","Marital status"),[["single",L("未婚","Single")],["married",L("已婚","Married")],["divorced",L("離婚","Divorced")],["widowed",L("喪偶","Widowed")]])}`;
    }
    content = `<section class="bc-china-apply-step bc-china-identity-step"><p class="eyebrow">01　${L("身分資料","IDENTITY")}</p><h2 id="bc-china-apply-title" tabindex="-1">${L("照著護照　一次完成一組","Follow the passport　one group at a time")}</h2><p class="bc-china-step-intro">${L("不必先面對整張表格　完成目前這一組才進到下一組　不適用的問題不會出現","There is no full form to face　Complete the current group before moving on　Questions that do not apply remain hidden")}</p>${identityNav}<div class="bc-china-identity-chapter" aria-live="polite"><header><span>${String(identitySection).padStart(2,"0")}</span><div><p>${L("目前填寫","CURRENT GROUP")}</p><h3 id="bc-china-identity-chapter-title" tabindex="-1">${identityChapters[identitySection-1][0]}</h3></div></header>${identityContent}${localActions}</div></section>`;
  } else if (step === 2) {
    const retired = state.chinaApplyFields.employmentStatus === "retired";
    content = `<section class="bc-china-apply-step"><p class="eyebrow">02　${L("工作與學歷","WORK AND EDUCATION")}</p><h2 id="bc-china-apply-title" tabindex="-1">${L("先選目前狀態　只填適用資料","Choose the current status　then complete only what applies")}</h2><p class="bc-china-step-intro">${L("目前顯示的欄位全部必填　選擇退休後不再要求公司　主管或公司地址","Every visible field is required　Retired applicants are not asked for an employer　supervisor or company address")}</p>${bcChinaIdentityChoices("employmentStatus",L("目前工作狀態","Current employment status"),[["employed",L("目前在職","Currently employed")],["retired",L("已退休","Retired")]])}${retired?`<div class="bc-china-conditional-fields"><p>${L("退休申請人不需要填公司資料","Retired applicants do not need employer details")}</p><div class="bc-china-form-grid">${bcChinaApplyField("previousOccupation",L("退休前職業","Occupation before retirement"),{required:true})}${bcChinaApplyField("retirementYear",L("退休年份","Year of retirement"),{type:"number",required:true})}${bcChinaApplyField("education",L("最高學歷　學校與主修","Highest education　school and major"),{wide:true,required:true})}</div></div>`:`<div class="bc-china-form-grid">${bcChinaApplyField("occupation",L("目前職稱","Current position"),{required:true})}${bcChinaApplyField("duties",L("主要工作內容","Main responsibilities"),{required:true})}${bcChinaApplyField("employer",L("公司或機構名稱","Employer or organization"),{required:true})}${bcChinaApplyField("employerPhone",L("公司電話","Employer phone"),{required:true,autocomplete:"tel"})}${bcChinaApplyField("employerAddress",L("公司完整地址","Complete employer address"),{wide:true,required:true})}${bcChinaApplyField("supervisor",L("主管姓名","Supervisor name"),{required:true})}${bcChinaApplyField("education",L("最高學歷　學校與主修","Highest education　school and major"),{required:true})}</div>`}${actions(L("完成工作與學歷","Complete work and education"))}</section>`;
  } else if (step === 3) {
    const relativeChoice = state.chinaApplyFields.relativeChoice || "";
    const relativeSkipped = relativeChoice === "parentsDeceased";
    content = `<section class="bc-china-apply-step"><p class="eyebrow">03　${L("家庭與聯絡","FAMILY AND CONTACTS")}</p><h2 id="bc-china-apply-title" tabindex="-1">${L("聯絡資料填完整　親屬只選一位","Complete contact details　choose one relative")}</h2><p class="bc-china-step-intro">${L("目前顯示的欄位全部必填　親屬只需要選父親　母親　配偶或子女其中一位　選定後該親屬的所有資料都必須完成　父母均已故才可以略過","Every visible field is required　Choose one parent　spouse or child　then complete every detail for that person　Only applicants whose parents are both deceased may skip")}</p><div class="bc-china-form-section"><header><span>01</span><div><h3>${L("申請人聯絡方式","Applicant contact")}</h3><p>${L("用於案件核對與需要補件時聯絡","Used for case review and additional document requests")}</p></div></header><div class="bc-china-form-grid">${bcChinaApplyField("homeAddress",L("目前美國完整地址","Current complete U S address"),{wide:true,required:true,autocomplete:"street-address"})}${bcChinaApplyField("phone",L("申請人電話","Applicant phone"),{required:true,autocomplete:"tel"})}${bcChinaApplyField("email",L("申請人電子郵件","Applicant email"),{type:"email",required:true,autocomplete:"email"})}</div></div><div class="bc-china-form-section"><header><span>02</span><div><h3>${L("緊急聯絡人","Emergency contact")}</h3><p>${L("可以不是親屬　但必須能夠聯絡","May be someone other than a relative　but must be reachable")}</p></div></header><div class="bc-china-form-grid">${bcChinaApplyField("emergencyName",L("聯絡人英文姓名","Contact name"),{required:true})}${bcChinaApplyField("emergencyRelation",L("與申請人關係","Relationship to applicant"),{required:true})}${bcChinaApplyField("emergencyPhone",L("聯絡人電話","Contact phone"),{wide:true,required:true,autocomplete:"tel"})}</div></div><div class="bc-china-form-section"><header><span>03</span><div><h3>${L("選一位親屬","Choose one relative")}</h3><p>${L("只需要挑一位　選定後姓名　電話　出生日期　出生地與國籍全部必填","Choose one person　then complete the name　phone　date of birth　place of birth and nationality")}</p></div></header>${bcChinaIdentityChoices("relativeChoice",L("要提供哪一位親屬","Which relative will be provided"),[["father",L("父親","Father")],["mother",L("母親","Mother")],["spouse",L("配偶","Spouse")],["child",L("子女","Child")],["parentsDeceased",L("父母均已故","Both parents deceased"),L("略過親屬資料","Skip relative details")]],{requireChoice:true})}${relativeSkipped?`<div class="bc-china-relative-skip"><span>✓</span><div><h4>${L("親屬資料已略過","Relative details skipped")}</h4><p>${L("已標記父母均已故　不再要求姓名　電話　出生日期　出生地或國籍","Both parents are marked deceased　No name　phone　date of birth　place of birth or nationality is required")}</p></div></div>`:relativeChoice?`<div class="bc-china-conditional-fields"><p>${L("以下五項全部必填","All five details below are required")}</p><div class="bc-china-form-grid">${bcChinaApplyField("relativeName",L("親屬英文姓名","Relative name"),{required:true})}${bcChinaApplyField("relativePhone",L("親屬電話","Relative phone"),{required:true,autocomplete:"tel"})}${bcChinaApplyField("relativeBirthDate",L("親屬出生日期","Relative date of birth"),{type:"date",required:true})}${bcChinaApplyField("relativeBirthPlace",L("親屬出生地","Relative place of birth"),{required:true})}${bcChinaApplyField("relativeNationality",L("親屬目前國籍","Relative current nationality"),{wide:true,required:true})}</div></div>`:`<p class="bc-china-required-note">${L("請先從上方選擇一位親屬　選定後才會顯示需要完成的五項資料","Choose one relative above　The five required details will appear after selection")}</p>`}</div>${actions(L("完成聯絡與親屬","Complete contacts and relative"))}</section>`;
  } else if (step === 4) {
    const upload = (key,label,accept,note,capture="",multiple=false) => `<label class="bc-china-upload ${state.chinaApplyUploads[key]?"ready":""}"><input type="file" accept="${accept}" ${capture} ${multiple?"multiple":""} data-china-upload="${key}"/><span><b>${label}</b><small>${state.chinaApplyUploads[key]||note}</small></span><i>${state.chinaApplyUploads[key]?"✓":"＋"}</i></label>`;
    const photoRequirements = [
      [L("完整上半身","Complete upper body"),L("頭部到上半身完整入鏡　肩膀不可裁切","Keep the head and complete upper body in frame　Do not crop the shoulders")],
      [L("露出額頭與雙耳","Forehead and ears visible"),L("頭髮不得遮住額頭或任何一側耳朵","Hair must not cover the forehead or either ear")],
      [L("深色上衣","Dark clothing"),L("穿深色無裝飾上衣","Wear a dark top without decoration")],
      [L("中性表情","Neutral expression"),L("正面直視鏡頭　不能微笑","Face the camera directly　Do not smile")]
    ];
    const photoRules = photoRequirements.map((rule,index)=>`<div class="bc-china-photo-rule"><span>${String(index+1).padStart(2,"0")}</span><div><b>${rule[0]}</b><small>${rule[1]}</small></div></div>`).join("");
    content = `<section class="bc-china-apply-step"><p class="eyebrow">04　${L("照片與文件","PHOTO AND DOCUMENTS")}</p><h2 id="bc-china-apply-title" tabindex="-1">${L("一次選齊檔案　不再用電子郵件來回傳送","Choose every file together　No ordinary email attachments")}</h2><p class="bc-china-step-intro">${L("證件照與護照分開核對　依身分需要的舊護照　出生證明　入籍證明或香港證件可以一次多選","Photo and passport are reviewed separately　Prior passports　birth records　naturalization proof or Hong Kong documents can be selected together when required")}</p><section class="bc-china-photo-guide" aria-labelledby="bc-china-photo-guide-title"><div class="bc-china-photo-frame" aria-hidden="true"><div class="bc-china-photo-person"><span></span></div><small>${L("完整上半身入鏡","COMPLETE UPPER BODY")}</small></div><div class="bc-china-photo-copy"><p class="eyebrow">${L("拍攝標準","PHOTO STANDARD")}</p><h3 id="bc-china-photo-guide-title">${L("拍照前先確認","Check before taking the photo")}</h3><div class="bc-china-photo-rules">${photoRules}</div><div class="bc-china-photo-prohibited"><b>${L("拍攝前全部取下","Remove everything before the photo")}</b><p>${L("眼鏡　耳環　項鍊　帽子　髮飾　以及任何裝飾品","Glasses　earrings　necklaces　hats　hair accessories　and all other accessories")}</p></div></div></section><div class="bc-china-upload-grid">${upload("photo",L("中國簽證證件照","China visa application photo"),"image/*",L("完整上半身入鏡　露出額頭與雙耳　深色上衣　不佩戴裝飾品　中性表情不能笑","Complete upper body in frame　forehead and ears visible　dark clothing　no accessories　neutral expression with no smile"),'capture="user"')}${upload("passport",L("美國護照資料頁","U S passport information page"),"image/*,.pdf",L("清楚拍攝完整四角　不可反光或裁切","Capture all four corners clearly　no glare or cropping"))}${upload("supporting",L("依身分需要的所有證明文件","All supporting documents for this path"),"image/*,.pdf",L("可一次選擇多個檔案　依上方個人清單準備","Select multiple files together　Follow the personal checklist shown above"),"",true)}</div>${documentsReady?`<p class="bc-china-files-ready">${L("三類文件已完成　可以進入全案核對","All three document groups are ready　Continue to application review")}</p>`:`<p class="bc-china-required-note">${L("證件照　美國護照資料頁與條件文件全部選齊後才能進入全案核對","Select the photo　U S passport page and supporting documents before continuing to application review")}</p>`}<div class="bc-china-upload-privacy"><b>${L("安全界線","SECURITY BOUNDARY")}</b><p>${L("目前只在瀏覽器記住檔名　不會讀取　上傳或寄送檔案　正式版必須使用加密上傳　權限控管與保留期限","This prototype remembers filenames only　It does not read upload or send files　Production requires encrypted upload　access control and a retention policy")}</p></div>${actions(L("核對完整案件","Review complete case"),!documentsReady)}</section>`;
  } else if (step === 5) {
    const uploadStatus = key => state.chinaApplyUploads[key] || L("尚未選擇　正式送件前必須完成","Not selected　required before real submission");
    content = `<section class="bc-china-apply-step"><p class="eyebrow">05　${L("全案核對","APPLICATION REVIEW")}</p><h2 id="bc-china-apply-title" tabindex="-1">${L("資料文件確認完整　最後才付款","Confirm the complete application before payment")}</h2><div class="bc-china-review-grid"><article><p class="eyebrow">${L("最後付款金額","FINAL PAYMENT AMOUNT")}</p><h3>${money(profile.fee)} ${L("每人","per person")}</h3><span>${L("下一步才選付款方式　目前尚未扣款","Choose a payment method in the next step　Nothing has been charged")}</span></article><article><p class="eyebrow">${L("申請人","APPLICANT")}</p><h3>${bcEscape(bcChinaApplicantName())}</h3><span>${profile.title}</span></article><article class="wide"><p class="eyebrow">${L("文件","DOCUMENTS")}</p><dl><div><dt>${L("證件照","Photo")}</dt><dd>${bcEscape(uploadStatus("photo"))}</dd></div><div><dt>${L("美國護照","U S passport")}</dt><dd>${bcEscape(uploadStatus("passport"))}</dd></div><div><dt>${L("條件文件","Conditional documents")}</dt><dd>${bcEscape(uploadStatus("supporting"))}</dd></div></dl></article></div>${documentsReady?"":`<p class="bc-china-step-intro">${L("三項文件齊全後才能進入付款　請返回上一步補齊","Complete all three document items before continuing to payment　Return to the previous step to add them")}</p>`}<section class="bc-china-review-confirmation" aria-labelledby="bc-china-review-confirmation-title"><div><p class="eyebrow">${L("送出前確認","BEFORE CONTINUING")}</p><h3 id="bc-china-review-confirmation-title">${L("最後勾選才能付款","Confirm before payment")}</h3><p>${L("這個勾選代表客人已經逐項檢查送出的內容　不代表簽證一定核准","This confirmation means the customer has reviewed every submitted item　It does not guarantee visa approval")}</p></div><label class="bc-china-check bc-china-review-check"><input type="checkbox" data-china-submit-consent ${state.chinaApplySubmitConsent?"checked":""} required/><span><b>${L("我已逐項核對以上資料與全部文件","I reviewed all information and every document above")}</b><small>${L("確認資料完整正確　照片與文件清楚可讀　並了解缺件或資料不一致可能延誤受理","I confirm the information is complete and correct　the photo and documents are clear and readable　and missing or inconsistent information may delay the case")}</small></span></label></section>${actions(L("前往最後付款","Continue to final payment"),!state.chinaApplySubmitConsent||!documentsReady)}</section>`;
  } else {
    const paymentMethods = [["card",L("信用卡或簽帳卡","Credit or debit card"),L("即時確認付款結果","Immediate payment confirmation")],["ach",L("銀行轉帳","Bank transfer"),L("正式版需等待銀行確認","Production waits for bank confirmation")]];
    content = `<section class="bc-china-apply-step"><p class="eyebrow">06　${L("最後付款","FINAL PAYMENT")}</p><h2 id="bc-china-apply-title" tabindex="-1">${L("資料與文件完成核對後才付款","Payment comes only after the application is reviewed")}</h2><div class="bc-china-payment-layout"><div><div class="bc-china-payment-total"><small>${profile.groupRate?L("兩位以上同行費率","Rate for two or more applicants"):L("單人申請費率","Single applicant rate")}</small><strong>${money(profile.fee)}</strong><span>${L("每人","per person")}</span></div><ul><li>${L("合格證件照","Compliant application photo")}</li><li>${L("申請資料整理與送件服務","Application preparation and submission service")}</li><li>${L("領事官方費用","Consular fee")}</li></ul></div><fieldset class="bc-china-payment-methods"><legend>${L("付款方式","Payment method")}</legend>${paymentMethods.map(method=>`<button type="button" class="${state.chinaApplyPayment===method[0]?"selected":""}" data-china-payment="${method[0]}" aria-pressed="${state.chinaApplyPayment===method[0]}"><span><b>${method[1]}</b><small>${method[2]}</small></span><i>${state.chinaApplyPayment===method[0]?"●":"○"}</i></button>`).join("")}</fieldset></div><div class="bc-china-payment-disclosure"><b>${L("付款前最後確認","FINAL CHECK BEFORE PAYMENT")}</b><p>${L("簽證核准由領事單位決定　付款不代表保證核准　退費與已發生的官方成本必須在正式付款頁逐項揭露","Visa approval is decided by the consular authority　Payment does not guarantee approval　Refund terms and incurred official costs must be disclosed before a real charge")}</p></div><label class="bc-china-check"><input type="checkbox" data-china-pay-consent ${state.chinaApplyConsent?"checked":""}/><span>${L("我已確認完整申請　文件　費用與服務範圍　並了解目前不會實際扣款","I reviewed the complete application　documents　fee and service scope and understand no charge will occur here")}</span></label><div class="bc-china-apply-actions"><button class="btn ghost" data-china-apply-prev>${L("上一步","Back")}</button><button class="btn" data-china-apply-submit ${state.chinaApplyConsent&&state.chinaApplySubmitConsent&&documentsReady?"":"disabled"}>${L("完成最後付款並建立案件　尚未扣款","Complete final payment and create case　not charged")} →</button></div></section>`;
  }
  return `<section id="bc-china-application" class="bc-shell section bc-china-application"><header class="bc-china-application-head"><div><p class="eyebrow">${L("中國簽證申請工作區","CHINA VISA APPLICATION WORKSPACE")}</p><h2>${L("填表上傳　最後付款","Apply and upload　pay at the end")}</h2></div><p>${L("先完成身分　工作　家庭與文件核對　最後一步才選付款方式　所有資料目前只保留在頁面記憶體　正式版才會接入付款　加密檔案儲存與供應商交付","Complete identity　work　family and document review first　Choose payment only in the final step　All data currently remains in page memory　Production will connect payment　encrypted file storage and supplier delivery")}</p></header>${state.chinaApplyComplete?"":nav}<div class="bc-china-apply-body">${content}</div></section>`;
}

function bcChinaVisaPreparation() {
  const stages = [
    [L("身分資料","Identity"),L("護照英文姓名　適用時補中文姓名　出生地　入籍日期與原國籍","Passport name　Chinese name when applicable　birthplace　naturalization date and former nationality")],
    [L("工作學歷","Work and education"),L("目前職業與職責　近五年任職資料　主管聯絡方式與最高學歷","Current role and duties　five year work history　supervisor contact and highest education")],
    [L("家庭聯絡","Family and contacts"),L("美國地址與電話　配偶父母子女資料　緊急聯絡人","U S address and phone　spouse parents and children　emergency contact")],
    [L("核對簽名","Review and signature"),L("所有資料完成後一次核對　正式版使用安全管道　不以一般電子郵件收護照資料","Review once all details are complete　Production uses a secure channel and never ordinary email for passport data")]
  ];
  const statuses = [L("資格預檢","Pre check"),L("到店核對與拍照","In store review and photo"),L("需要時補件","Additional documents if needed"),L("領事處理","Consular processing"),L("返還與領取","Return and pickup")];
  return `<section class="bc-shell section bc-china-preparation"><header><p class="eyebrow">${L("建立案件之後","AFTER THE PRE CHECK")}</p><h2>${L("一次只完成一組資料","Complete one group of details at a time")}</h2><p>${L("原始表格的內容保留　但拆成四段引導　客人不必面對一整張二十五頁文件","The original information is retained but split into four guided stages　Customers never face a twenty five page document")}</p></header><div class="bc-china-stages">${stages.map((stage,index)=>`<article><span>${String(index+1).padStart(2,"0")}</span><h3>${stage[0]}</h3><p>${stage[1]}</p></article>`).join("")}</div><div class="bc-china-status"><p class="eyebrow">${L("申請進度如何呈現","APPLICATION STATUS")}</p><ol>${statuses.map((status,index)=>`<li><span>${String(index+1).padStart(2,"0")}</span><b>${status}</b></li>`).join("")}</ol><small>${L("一般處理期間不主動打擾　若領事單位要求補件才通知　客人可用收據編號自行查詢","No routine messages during processing　Customers are contacted only for additional documents and may check status with the receipt number")}</small></div></section>`;
}

function bcChinaVisaJourney() {
  const steps = [
    [L("確認能否受理","Confirm service fit"),L("先確認灣區服務範圍　年齡　舊證件與護照效期","Check Bay Area coverage　age　prior documents and passport validity")],
    [L("看清費用文件","See cost and documents"),L("只顯示這一種身分的費用　工作天與文件清單","Show only the cost　timing and checklist for this applicant")],
    [L("填表上傳核對","Apply upload and review"),L("先完成申請資料　證件照與證明文件　核對完整才進入付款","Complete application details　photo and supporting files before payment")],
    [L("最後付款再寄件","Pay last then hand off"),L("完成最後付款並取得案件編號後　才依指示郵寄或親送護照","Pay at the end　then mail or deliver the passport after receiving a case number")]
  ];
  return `<section class="bc-shell section-tight bc-china-journey" aria-labelledby="bc-china-journey-title"><header><p class="eyebrow">${L("辦理方式","HOW IT WORKS")}</p><h2 id="bc-china-journey-title">${L("從預檢到寄件　四步完成","From pre check to passport handoff in four steps")}</h2><p>${L("前一個答案會決定下一題　不必先讀完整表格　也不會在建立安全案件前要求寄出護照","Each answer determines the next question　There is no full form to decipher and no passport is mailed before a secure case exists")}</p></header><ol>${steps.map((step,index)=>`<li><span>${String(index+1).padStart(2,"0")}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div></li>`).join("")}</ol></section>`;
}

function bcGuidedFlow(id) {
  const flow = bcFlowDefinitions()[id];
  const flowState = bcFlowState(id);
  const stepIndex = Math.min(flowState.step, flow.steps.length);
  const answered = flow.steps.slice(0, stepIndex).filter(step => flowState.answers[step.key]);
  const summary = answered.length ? answered.map(step => `<div><small>${step.question}</small><b>${bcEscape(bcFlowAnswerLabel(step,flowState.answers[step.key]))}</b></div>`).join("") : `<p>${L("先回答現在這一題；其他問題稍後才出現。","Answer only this question; the rest comes later.","Responda solo esta pregunta; lo demás vendrá después.")}</p>`;
  if (stepIndex >= flow.steps.length) {
    const result = id === "vip" ? bcVipSubscriptionResult(flowState.answers) : id === "china" ? bcChinaVisaResult(flowState.answers) : `<h2>${flow.result}</h2>`;
    const primaryAction = id === "vip" ? bcVipFitAction(flowState.answers) : id === "china" ? bcChinaVisaAction(flowState.answers) : flow.nextView ? `<button class="btn" data-view="${flow.nextView}">${flow.nextLabel}</button>` : `<button class="btn" data-demo-action>${L("保存示意摘要","Save sample summary","Guardar resumen de ejemplo")}</button>`;
    const completionNote = id === "china" ? L("目前只完成前台資格預檢　資料只存在這個頁面　尚未傳輸　建立案件　付款或送件","Only the front end pre check is complete　Answers remain on this page　No data was transmitted and no case payment or submission was created") : L("這是設計示意。資料只存在目前頁面記憶體，不會傳輸、寄信、建立案件、訂位或扣款。","Design demo only. Answers remain in this page session; nothing is transmitted, emailed, booked or charged.","Solo es una demo. Las respuestas quedan en esta sesión; no se envía, reserva ni cobra nada.");
    return `<section class="bc-guided-flow complete"><div class="bc-guided-main"><p class="eyebrow">${flow.eyebrow}</p><div id="bc-flow-result" tabindex="-1" class="bc-guide-result-mark">✓</div>${result}<p>${completionNote}</p><div class="bc-guide-result-actions">${primaryAction}<button class="btn ghost" data-flow-reset data-flow="${id}">${L("重新回答","Start again","Empezar de nuevo")}</button></div></div><aside class="bc-guided-summary"><p class="eyebrow">${L("你的示意摘要","YOUR SAMPLE BRIEF","SU RESUMEN")}</p>${summary}</aside></section>`;
  }
  const step = flow.steps[stepIndex];
  const totalSteps = flow.totalSteps || flow.steps.length;
  const progress = Math.round(((stepIndex + 1) / totalSteps) * 100);
  const answer = flowState.answers[step.key] || step.default || "";
  const choices = step.options ? `<div class="bc-guide-options">${step.options.map(option => `<button type="button" class="bc-guide-option ${answer===option.value?"selected":""}" data-flow-answer="${option.value}" data-flow="${id}" data-flow-key="${step.key}" data-flow-length="${flow.steps.length}" aria-pressed="${answer===option.value}"><span><b>${option.label}</b>${option.note?`<small>${option.note}</small>`:""}</span><span aria-hidden="true">→</span></button>`).join("")}</div>` : `<div class="bc-guide-input"><label for="bc-flow-input">${step.label}</label><input id="bc-flow-input" type="${step.type === "date" ? "date" : "text"}" value="${bcEscape(answer)}" data-flow-input data-flow="${id}" data-flow-key="${step.key}"/></div><button class="btn bc-guide-continue" data-flow-next data-flow="${id}" data-flow-key="${step.key}" data-flow-default="${bcEscape(step.default || "—")}" data-flow-length="${flow.steps.length}">${L("繼續","Continue","Continuar")} →</button>`;
  return `<section class="bc-guided-flow" aria-live="polite"><div class="bc-guided-main"><div class="bc-guide-progress"><span>${L(`步驟 ${stepIndex+1}　共 ${totalSteps} 步`,`STEP ${stepIndex+1} OF ${totalSteps}`,`PASO ${stepIndex+1} DE ${totalSteps}`)}</span><i style="--bc-guide-progress:${progress}%"></i></div><p class="eyebrow">${flow.eyebrow}</p><h2 id="bc-flow-question" tabindex="-1">${step.question}</h2>${step.help?`<p class="bc-guide-help ${step.alert?"bc-guide-alert":""}">${step.help}</p>`:""}${choices}<div class="bc-guide-nav">${stepIndex?`<button data-flow-back data-flow="${id}">← ${L("上一題","Back","Atrás")}</button>`:"<span></span>"}<small>${L("答案不會送出","ANSWERS ARE NOT SENT","NO SE ENVÍAN RESPUESTAS")}</small></div></div><aside class="bc-guided-summary"><p class="eyebrow">${L("目前輪廓","YOUR BRIEF SO FAR","RESUMEN ACTUAL")}</p>${summary}</aside></section>`;
}

function bcGuidedServicePage({flow,image,eyebrow,title,copy,briefTitle,briefCopy,position="center",facts=[],before="",after="",factsBefore=false,startLabel="",startView="",showFlow=true}) {
  const factStrip = facts.length ? `<section class="bc-shell section-tight"><div class="bc-guided-facts">${facts.map((fact,index)=>`<article><span>0${index+1}</span><h3>${fact[0]}</h3><p>${fact[1]}</p></article>`).join("")}</div></section>` : "";
  const guidedFlow = showFlow ? `<section id="bc-service-flow" class="bc-shell section bc-guided-section">${bcGuidedFlow(flow)}</section>` : "";
  return `<main class="bc-guided-service-page">${bcServiceHero(image,eyebrow,title,copy,briefTitle,briefCopy,position,true,startLabel,startView)}${before}${factsBefore?factStrip:""}${guidedFlow}${factsBefore?"":factStrip}${after}</main>`;
}

function flightsBC() {
  return bcGuidedServicePage({
    flow:"flights", image:BC_IMG.plane, eyebrow:"FLIGHTS",
    title:L("先說旅程，再看票價。","Start with the trip, then the fare.","Primero el viaje, luego la tarifa."),
    copy:L("一次只回答一個問題；最後才比較含行李、轉機、退改與付款對象的完整成本。","Answer one question at a time, then compare baggage, connections, changes and payee as one complete cost.","Responda una pregunta a la vez y compare equipaje, escalas, cambios y quién cobra."),
    briefTitle:L("一題一頁，約 90 秒","One question at a time · about 90 seconds","Una pregunta a la vez · 90 segundos"),
    briefCopy:L("標準航程自助整理；多城市、特殊行李與複雜改票才交給真人。","Standard trips stay self-serve; complex routes, baggage or changes reach a person.","Los viajes estándar son autoservicio; lo complejo pasa a una persona."),
    position:"center 58%",
    facts:[[L("完整總價","Complete total","Total completo"),L("票價、行李與必要費用放在一起。","Fare, baggage and required fees together.","Tarifa, equipaje y tasas juntos.")],[L("轉機風險","Connection clarity","Escalas claras"),L("機場、停留、過夜與重新托運清楚顯示。","Airport, layover, overnight and re-check shown.","Aeropuerto, escala, noche y nueva facturación.")],[L("誰負責出票","Ticketing party","Quién emite"),L("離站前說清楚誰收款、出票與退款。","Disclose who charges, tickets and refunds.","Indique quién cobra, emite y reembolsa.")]]
  });
}

function bcCurrentOrder() {
  return BC_DEMO_ORDERS.find(order => order.id === state.orderId) || BC_DEMO_ORDERS[0];
}

function bcMemberNav() {
  const links = [
    ["member",L("旅程總覽","Journey","Viaje")],
    ["orders",L("我的訂單","Orders","Pedidos")],
    ["travelers",L("旅客與文件","Travelers & documents","Viajeros y documentos")],
    ["payments",L("付款與收據","Payments & receipts","Pagos y recibos")],
    ["favorites",L("收藏行程","Saved journeys","Favoritos")],
    ["membership",L("會員權益","Membership","Membresía")],
    ["contact",L("支援案件","Support cases","Casos de soporte")]
  ];
  const active = state.view === "order-detail" || state.view === "checkout" ? (state.view === "checkout" ? "payments" : "orders") : state.view;
  return `<aside class="bc-member-rail"><div class="bc-member-profile"><p class="eyebrow">DEMO MEMBER</p><h2>${BC_DEMO_MEMBER.label}</h2><p>${L("目前示意等級：MEMBER","Sample level: MEMBER","Nivel de ejemplo: MEMBER")}</p>${state.view === "membership" ? "" : `<button class="bc-member-profile-tier" data-view="membership">${L("查看會員權益","View membership","Ver membresía")} →</button>`}<div class="bc-member-mini-preferences">${BC_DEMO_MEMBER.preferences.map(item=>`<span>${bcTxt(item)}</span>`).join("")}</div></div><nav class="bc-member-links" aria-label="${L("會員中心導覽","Member-center navigation","Navegación del área personal")}">${links.map(([view,label])=>`<button class="bc-member-link ${active===view?"active":""}" data-view="${view}" ${active===view?'aria-current="page"':""}><span>${label}</span><span aria-hidden="true">→</span></button>`).join("")}</nav><button class="bc-member-signout" data-demo-logout>${L("離開 DEMO MEMBER","Leave DEMO MEMBER","Salir de DEMO MEMBER")}</button></aside>`;
}

function bcMemberPage(title, eyebrow, body) {
  return `<main class="bc-shell bc-member-shell">${bcMemberNav()}<section class="bc-member-main"><div class="bc-member-demo-line"><b>${L("設計示意","DESIGN DEMO","DEMO")}</b><span>${L("所有會員、訂單、文件與付款資料均為虛構示意。","All member, order, document and payment data is fictional.","Todos los datos de miembro, pedido, documento y pago son ficticios.")}</span></div><header class="bc-member-header"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></header>${body}</section></main>`;
}

function loginBC() {
  const stepOne = `<div class="bc-auth-step"><p class="eyebrow">01 · ${L("辨識帳戶","IDENTIFY ACCOUNT","IDENTIFICAR CUENTA")}</p><h1 id="bc-auth-title" tabindex="-1">${L("歡迎回來。","Welcome back.","Bienvenido de nuevo.")}</h1><p>${L("先確認 Email，再進入私人旅程空間。此原型只使用虛構 DEMO MEMBER。","Confirm the email, then enter the private journey space. This prototype uses only a fictional DEMO MEMBER.","Confirme el correo y entre al espacio privado. Este prototipo usa solo DEMO MEMBER ficticio.")}</p><label for="bc-demo-email">Email</label><input id="bc-demo-email" value="${BC_DEMO_MEMBER.email}" readonly/><button class="btn wide" data-auth-next>${L("繼續・設計示意","Continue · design demo","Continuar · demo")}</button><small>${L("不會寄信、不會建立帳戶，也不會儲存 Email。","No email, account creation or storage.","Sin correo, cuenta ni almacenamiento.")}</small></div>`;
  const stepTwo = `<div class="bc-auth-step"><p class="eyebrow">02 · ${L("示意驗證","SAMPLE VERIFICATION","VERIFICACIÓN DE EJEMPLO")}</p><h1 id="bc-auth-title" tabindex="-1">${L("確認是你的旅程空間。","Confirm your journey space.","Confirme su espacio de viaje.")}</h1><p>${L("正式版本會使用安全登入方式。這裡只展示驗證後的狀態，不會真的寄出驗證碼。","Production would use secure authentication. This only previews the verified state and sends no code.","La versión final usará acceso seguro. Aquí solo se muestra el estado verificado y no se envía código.")}</p><div class="bc-auth-code" aria-label="${L("示意驗證碼","Sample code","Código de ejemplo")}"><span>P</span><span>G</span><span>2</span><span>0</span><span>2</span><span>6</span></div><button class="btn wide" data-demo-login>${L("進入 DEMO MEMBER","Enter DEMO MEMBER","Entrar a DEMO MEMBER")}</button><button class="bc-text-button" data-auth-back>← ${L("返回 Email","Back to email","Volver al correo")}</button><small>${L("設計示意：沒有驗證、登入或個資傳輸。","Design demo: no verification, login or personal-data transmission.","Demo: sin verificación, acceso ni envío de datos personales.")}</small></div>`;
  return `<main class="bc-auth-shell"><section class="bc-auth-media"><img src="${BC_IMG.madrid}" alt=""/><div><p class="eyebrow">PACK&GO · PRIVATE JOURNEY</p><h2>${L("所有旅行細節，回到同一個安靜的地方。","Every travel detail returns to one quiet place.","Todos los detalles vuelven a un solo lugar tranquilo.")}</h2><p>${L("訂單、下一步、旅客文件、付款與支援，依你的旅程排列。","Orders, next actions, documents, payments and support—arranged around your journey.","Pedidos, siguientes pasos, documentos, pagos y soporte, organizados según su viaje.")}</p></div></section><section class="bc-auth-panel"><div class="bc-auth-brand"><img src="${BC_BRAND.wordmark}" alt="PACK&GO"/></div><div class="bc-auth-progress"><i class="${state.authStep>=1?"active":""}"></i><i class="${state.authStep>=2?"active":""}"></i></div>${state.authStep===1?stepOne:stepTwo}</section></main>`;
}

function bcMemberLabSwitcher() {
  if (!state.memberLab) return "";
  const names={A:L("旅程房間","Journey room","Sala de viaje"),B:L("離境倒數","Departure path","Ruta de salida"),C:L("旅行檔案冊","Travel folio","Folio de viaje")};
  return `<div class="bc-member-design-switcher" aria-label="${L("會員首頁設計切換器","Member-home design switcher","Selector de inicio de miembro")}"><button data-member-design-step="-1" aria-label="${L("上一個會員設計","Previous member design","Diseño anterior")}">←</button><div><b>${state.memberDesign} · ${names[state.memberDesign]}</b><small>MEMBER HOME LAB · DESIGN DEMO</small></div><button data-member-design-step="1" aria-label="${L("下一個會員設計","Next member design","Diseño siguiente")}">→</button></div>`;
}

function bcMemberAccountLine() {
  return `<div class="bc-journey-account"><div class="bc-journey-account-copy"><span>${L("歡迎回來","Welcome back","Bienvenido de nuevo")}</span><b>DEMO MEMBER</b><small>${L("一般會員  一個進行中的旅程","Member  One active journey","Miembro  Un viaje activo")}</small></div><nav aria-label="${L("會員快速入口","Member quick links","Enlaces de miembro")}"><button data-view="orders">${L("我的旅程","My journeys","Mis viajes")}</button><button data-view="travelers">${L("旅客與文件","Travelers and documents","Viajeros y documentos")}</button><button data-view="payments">${L("付款與收據","Payments and receipts","Pagos y recibos")}</button><button data-view="membership">${L("會員權益","Membership","Membresía")}</button><button data-demo-logout>${L("登出","Sign out","Salir")}</button></nav></div>`;
}

function bcMemberPreferenceLedger() {
  const rows=[
    [L("語言","LANGUAGE","IDIOMA"),L("繁體中文服務","Traditional Chinese service","Servicio en chino tradicional"),L("提醒與文件先以繁中整理","Reminders and documents start in Traditional Chinese","Avisos y documentos primero en chino tradicional")],
    [L("出發地","DEPARTURE","SALIDA"),L("舊金山出發","San Francisco departure","Salida desde San Francisco"),L("機票與集合資訊先顯示 SFO","Flights and meeting details prioritize SFO","Vuelos y reunión priorizan SFO")],
    [L("旅行節奏","PACE","RITMO"),L("小團慢旅","Slow small groups","Grupos pequeños y pausados"),L("優先標出步行強度與連續移動日","Walking intensity and consecutive travel days are surfaced first","Se priorizan caminatas y días de traslado")]
  ];
  return `<section class="bc-member-memory"><header><p class="eyebrow">${L("已為你記住","REMEMBERED FOR YOU","RECORDADO PARA USTED")}</p><h2>${L("下一趟不必重新說明","Your next journey starts with what we know","Su próximo viaje comienza con lo que sabemos")}</h2></header>${rows.map(row=>`<div><small>${row[0]}</small><b>${row[1]}</b><span>${row[2]}</span></div>`).join("")}<p>${L("以下為虛構會員偏好  尚未連接正式帳戶","Fictional member preferences  Not connected to a live account","Preferencias ficticias  Sin conexión a una cuenta real")}</p></section>`;
}

function bcMemberJourneyLedger(order) {
  return `<section class="bc-journey-ledger"><header><p class="eyebrow">${L("出發前安排","BEFORE DEPARTURE","ANTES DE SALIR")}</p><h2>${L("下一步已經排好","Every next step is in order","Cada paso está en orden")}</h2></header><div class="bc-journey-ledger-row current"><time>2026.09.05</time><div><b>${L("確認旅客資料","Confirm traveler details","Confirmar datos del viajero")}</b><small>${L("護照英文姓名與效期  約三分鐘","Passport name and expiry  About three minutes","Nombre y vencimiento  Unos tres minutos")}</small></div><button data-view="travelers">${L("現在完成","Complete now","Completar ahora")}</button></div><div class="bc-journey-ledger-row"><time>2026.09.12</time><div><b>${L("查看尾款與收款對象","Review balance and payee","Revisar saldo y cobro")}</b><small>${money(order.balance)}  PACK&GO</small></div><button data-checkout="${order.id}">${L("查看付款","View payment","Ver pago")}</button></div><div class="bc-journey-ledger-row"><time>2026.09.20</time><div><b>${L("取得行前文件","Receive pre-trip documents","Recibir documentos previos")}</b><small>${L("文件完成後會集中在旅程內","Documents will be kept with this journey","Los documentos quedarán en este viaje")}</small></div><button data-order="${order.id}">${L("查看進度","View progress","Ver progreso")}</button></div></section>`;
}

function bcMemberVariantA(order,t) {
  return `<section id="bc-member-design" tabindex="-1" class="bc-member-cover"><div class="bc-member-cover-media"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div class="bc-member-cover-shade"></div><header class="bc-member-cover-trip"><p>${L("進行中的旅程","ACTIVE JOURNEY","VIAJE ACTIVO")}</p><h1>${bcTxt(t.title)}</h1><span>${t.nextDate} → ${t.returnDate}  ${bcTxt(order.status)}  2 ${L("位旅客","travelers","viajeros")}</span></header><aside class="bc-member-cover-action"><p class="eyebrow">${L("現在只需要完成","ONE THING TO COMPLETE","UNA TAREA PARA COMPLETAR")}</p><h2>${L("確認旅客資料","Confirm traveler details","Confirmar datos del viajero")}</h2><p>${L("核對護照英文姓名與效期  截止 2026.09.05  約三分鐘","Review passport name and expiry  Due 2026.09.05  About three minutes","Revise nombre y vencimiento  Fecha 2026.09.05  Unos tres minutos")}</p><button class="btn wide" data-view="travelers">${L("現在完成","Complete now","Completar ahora")}</button><button class="bc-room-detail" data-order="${order.id}">${L("查看完整旅程","View full journey","Ver viaje completo")}</button></aside></div></section>${bcMemberJourneyLedger(order)}${bcMemberPreferenceLedger()}`;
}

function bcMemberVariantB(order,t) {
  return `<section id="bc-member-design" tabindex="-1" class="bc-departure-path"><header><div><p class="eyebrow">B · DEPARTURE PATH · DESIGN DEMO</p><h1>${L("從今天，到出發。","From today to departure.","Desde hoy hasta la salida.")}</h1><p>${bcTxt(t.title)} · ${t.nextDate} → ${t.returnDate}</p></div><img src="${t.image}" alt="${bcTxt(t.title)}"/></header><div class="bc-departure-current"><time>${L("現在","NOW","AHORA")}</time><div><small>${L("唯一待辦・2026.09.05 前","ONE TASK · BY 2026.09.05","UNA TAREA · ANTES DEL 2026.09.05")}</small><h2>${L("確認旅客資料。","Confirm traveler details.","Confirme los datos del viajero.")}</h2><p>${L("只核對 DEMO MEMBER A 的護照英文名與效期。","Only review the sample passport name and expiry.","Solo revise el nombre y vencimiento de ejemplo.")}</p></div><button class="btn" data-view="travelers">${L("開始","Begin","Empezar")} →</button></div><ol class="bc-departure-timeline"><li><time>09.12</time><span><b>${L("尾款","Balance","Saldo")}</b><small>${money(order.balance)} · PACK&GO</small></span><button data-checkout="${order.id}">${L("查看","View","Ver")} →</button></li><li><time>09.20</time><span><b>${L("行前文件","Documents","Documentos")}</b><small>${L("示意提供日","Sample release","Fecha de ejemplo")}</small></span><button data-order="${order.id}">${L("進度","Progress","Progreso")} →</button></li><li><time>10.04</time><span><b>${L("示意出發","Sample departure","Salida de ejemplo")}</b><small>${bcTxt(t.destination)}</small></span><button data-tour="${t.id}">${L("行程","Journey","Viaje")} →</button></li></ol></section>${bcMemberPreferenceLedger()}`;
}

function bcMemberVariantC(order,t) {
  return `<section id="bc-member-design" tabindex="-1" class="bc-travel-folio"><div class="bc-folio-cover"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p>C · TRAVEL FOLIO · DESIGN DEMO</p><h1>${bcTxt(t.destination)}</h1><span>${t.nextDate} → ${t.returnDate}</span></div></div><div class="bc-folio-page"><p class="eyebrow">${L("進行中的章節","CURRENT CHAPTER","CAPÍTULO ACTUAL")}</p><h2>${bcTxt(t.title)}</h2><dl><div><dt>${L("狀態","STATUS","ESTADO")}</dt><dd>${bcTxt(order.status)}</dd></div><div><dt>${L("同行","TRAVELERS","VIAJEROS")}</dt><dd>2 ${L("位示意旅客","sample travelers","viajeros de ejemplo")}</dd></div><div><dt>${L("下一步","NEXT","SIGUIENTE")}</dt><dd>${L("2026.09.05 確認旅客資料","Confirm traveler details by 2026.09.05","Confirmar viajeros antes del 2026.09.05")}</dd></div></dl><button class="btn wide" data-view="travelers">${L("翻到下一步","Open next step","Abrir siguiente paso")} →</button><nav><button data-order="${order.id}">${L("旅程詳情","Journey detail","Detalle")}</button><button data-view="payments">${L("付款與收據","Payments","Pagos")}</button><button data-view="favorites">${L("收藏","Saved","Favoritos")}</button></nav></div></section><section class="bc-folio-notes"><article><span>01</span><h3>${L("出發前","Before departure","Antes de salir")}</h3><p>${L("旅客資料、尾款與文件依截止日整理。","Travelers, balance and documents follow their due dates.","Viajeros, saldo y documentos siguen sus fechas.")}</p></article><article><span>02</span><h3>${L("旅途中","During travel","Durante el viaje")}</h3><p>${L("正式版集中放行程文件與高風險分流；目前僅為設計示意。","Production would hold trip documents and high-risk escalation; design demo only.","La versión final reunirá documentos y escalación; solo demo.")}</p></article><article><span>03</span><h3>${L("回來後","After return","Al volver")}</h3><p>${L("收藏下一趟並自行決定是否分享公開旅圖。","Save the next trip and decide whether to share a public travel card.","Guarde el próximo viaje y decida si comparte una tarjeta pública.")}</p></article></section>${bcMemberPreferenceLedger()}`;
}

function memberBC() {
  const order=BC_DEMO_ORDERS[0], t=BC_TOURS.find(tour=>tour.id===order.tourId);
  const body=state.memberDesign==="B"?bcMemberVariantB(order,t):state.memberDesign==="C"?bcMemberVariantC(order,t):bcMemberVariantA(order,t);
  return `<main class="bc-shell bc-journey-home">${bcMemberAccountLine()}<div class="bc-member-privacy-note">${L("以下會員 旅客 訂單 文件與付款資料均為虛構資料","All member traveler order document and payment data below is fictional","Todos los datos de miembro viajero pedido documento y pago son ficticios")}</div>${body}${bcMemberLabSwitcher()}</main>`;
}

function ordersBC() {
  const cards = BC_DEMO_ORDERS.map(order=>{ const t=BC_TOURS.find(tour=>tour.id===order.tourId); return `<article class="bc-order-card"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p class="eyebrow">${order.id} · ${L("設計示意","DESIGN DEMO","DEMO")}</p><h2>${bcTxt(t.title)}</h2><div class="bc-order-meta"><span>${t.nextDate} → ${t.returnDate}</span><span>${bcTxt(order.status)}</span><span>2 ${L("位示意旅客","sample travelers","viajeros de ejemplo")}</span></div><p><b>${L("下一步：","Next: ","Siguiente: ")}</b>${bcTxt(order.next)}</p></div><div class="bc-order-action"><b>${money(order.total)}</b><br><small>${L("示意訂單總額","sample order total","total de ejemplo")}</small><br><button class="btn small" style="margin-top:12px" data-order="${order.id}">${L("查看進度","View progress","Ver progreso")}</button></div></article>`; }).join("");
  return bcMemberPage(L("我的旅程與訂單","My journeys and orders","Mis viajes y pedidos"),"ORDERS · DESIGN DEMO",`<div class="bc-order-list">${cards}</div>`);
}

function orderDetailBC() {
  const order=bcCurrentOrder(), t=BC_TOURS.find(tour=>tour.id===order.tourId);
  const confirmed=order.id==="DEMO-PG-1042";
  return bcMemberPage(L("旅程詳情與進度","Journey detail and progress","Detalle y progreso"),`${order.id} · DESIGN DEMO`,`<section class="bc-order-hero"><div><p class="eyebrow">${bcTxt(order.status)}</p><h2>${bcTxt(t.title)}</h2><p>${t.nextDate} → ${t.returnDate} · 2 ${L("位示意旅客","sample travelers","viajeros de ejemplo")}</p><div class="bc-timeline"><div class="bc-timeline-step done"><b>01 ${L("訂位提交","Submitted","Enviado")}</b><small>2026.08.20</small></div><div class="bc-timeline-step ${confirmed?"done":"current"}"><b>02 ${L("供應商確認","Confirmed","Confirmado")}</b><small>${confirmed?"2026.08.22":L("等待示意","Sample pending","Pendiente")}</small></div><div class="bc-timeline-step ${confirmed?"current":""}"><b>03 ${L("旅客資料","Travelers","Viajeros")}</b><small>2026.09.05</small></div><div class="bc-timeline-step"><b>04 ${L("付款","Payment","Pago")}</b><small>2026.09.12</small></div><div class="bc-timeline-step"><b>05 ${L("行前文件","Documents","Documentos")}</b><small>2026.09.20</small></div></div></div><aside><p class="eyebrow">NEXT ACTION</p><h2>${confirmed?L("完成旅客資料","Complete traveler details","Completar viajeros"):L("等待成團更新","Wait for departure update","Esperar actualización")}</h2><p>${bcTxt(order.next)}</p><button class="btn wide" ${confirmed?'data-view="travelers"':`data-tour="${t.id}"`}>${confirmed?L("現在處理","Do it now","Completar ahora"):L("查看行程","View journey","Ver viaje")}</button></aside></section>
  <section class="bc-order-finance"><div><p class="eyebrow">${L("費用一眼看懂","COST AT A GLANCE","COSTO CLARO")}</p><h2>${money(order.total)}</h2><small>${L("示意訂單總額","SAMPLE ORDER TOTAL","TOTAL DE EJEMPLO")}</small></div><div><span>${L("已付示意","Sample paid","Pagado de ejemplo")}</span><b>${money(order.paid)}</b></div><div><span>${L("待付示意","Sample balance","Saldo de ejemplo")}</span><b>${money(order.balance)}</b></div><button class="btn" data-checkout="${order.id}" ${order.balance?"":"disabled"}>${L("前往付款示意","Open payment demo","Abrir demo de pago")} →</button></section>
  <section class="bc-trip-dossier compact"><div class="bc-dossier-row"><span>01</span><div><b>${L("完整商品詳情","Full journey detail","Detalle completo")}</b><small>${t.code}</small></div><button data-tour="${t.id}">${L("查看","View","Ver")} →</button></div><div class="bc-dossier-row"><span>02</span><div><b>${L("帶入訂單的私人支援","Private support with order context","Soporte con contexto")}</b><small>${order.id}</small></div><button data-view="contact">${L("開啟支援","Open support","Abrir soporte")} →</button></div></section>${confirmed?bcAdvocacyBlock(t):""}`);
}

function travelersBC() {
  return bcMemberPage(L("旅客資料與文件","Travelers and documents","Viajeros y documentos"),"TRAVELER WALLET · DESIGN DEMO",`${bcGuidedFlow("traveler")}<section class="bc-document-quiet-list"><header><p class="eyebrow">DOCUMENT STATUS</p><h2>${L("只看這趟旅程真正需要的文件。","Only documents this journey needs.","Solo los documentos que este viaje necesita.")}</h2></header><div><b>${L("護照資料頁","Passport bio page","Página de pasaporte")}</b><span>${L("待正式安全上傳・設計示意","Secure upload pending · demo","Carga segura pendiente · demo")}</span><time>2026.09.05</time></div><div><b>${L("緊急聯絡資訊","Emergency contact","Contacto de emergencia")}</b><span>${L("尚未收取・設計示意","Not collected · demo","No recogido · demo")}</span><time>2026.09.05</time></div><div><b>${L("行程確認書","Journey confirmation","Confirmación del viaje")}</b><span>${L("示意可查看","Sample available","Disponible de ejemplo")}</span><time>2026.09.20</time></div></section>`);
}

function paymentsBC() {
  const order=bcCurrentOrder(), t=BC_TOURS.find(tour=>tour.id===order.tourId);
  return bcMemberPage(L("付款與收據","Payments and receipts","Pagos y recibos"),"PAYMENT CENTER · DESIGN DEMO",`<section class="bc-payment-focus"><div><p class="eyebrow">${order.id} · ${bcTxt(t.title)}</p><h2>${L("下一筆示意付款","Next sample payment","Próximo pago de ejemplo")}</h2><p>${L("收款人、金額、到期日與退款條件會在真正付款頁再次確認。","Payee, amount, due date and refund terms appear again on the payment page.","Quién cobra, importe, fecha y reembolso se confirman en la página de pago.")}</p></div><div><small>${L("待付尾款・設計示意","BALANCE DUE · DESIGN DEMO","SALDO · DEMO")}</small><strong>${money(order.balance)}</strong><span>2026.09.12</span><button class="btn light" data-checkout="${order.id}">${L("支付尾款・設計示意","Pay balance · design demo","Pagar saldo · demo")} →</button></div></section>
  <section class="bc-document-quiet-list"><header><p class="eyebrow">TRANSACTIONS & RECEIPTS</p><h2>${L("每一筆都說清楚誰收款、什麼狀態。","Every line explains payee and state.","Cada línea muestra quién cobra y el estado.")}</h2></header><div><b>${L("訂金授權示意","Deposit authorization sample","Autorización de depósito")}</b><span>PACK&GO · ${L("示意已授權","sample authorized","autorizado de ejemplo")}</span><time>${money(order.paid)}</time></div><div><b>${L("尾款示意","Balance sample","Saldo de ejemplo")}</b><span>PACK&GO · ${L("尚未扣款","not charged","no cobrado")}</span><time>${money(order.balance)}</time></div><button class="bc-text-button" data-demo-action>${L("查看收據版面示意","View receipt layout demo","Ver diseño de recibo")} →</button></section>`);
}

function checkoutBC() {
  const order=bcCurrentOrder(), t=BC_TOURS.find(tour=>tour.id===order.tourId);
  const context=state.checkoutContext || {orderId:order.id,title:bcTxt(t.title),image:t.image,dates:`${t.nextDate} → ${t.returnDate}`,amount:order.balance,guests:2};
  const amount=context.amount;
  const paymentTour=BC_TOURS.find(tour=>tour.id===(context.tourId || order.tourId)) || t;
  const paymentDeparture=paymentTour.departures.find(item=>item.start===context.departureStart) || paymentTour.departures[0];
  const paymentFees=bcBookingFeeModel(paymentTour,paymentDeparture,context.guests,amount);
  const selectedOptions=bcSelectedOptionalFees(paymentTour,paymentDeparture,context.guests,context.selectedOptionIds || []);
  const laterRequired=paymentFees.knownTotal-paymentFees.tripTotal;
  const knownWithOptions=paymentFees.knownTotal+selectedOptions.total;
  const feeDisclosure=bcBookingFeeDisclosure(paymentTour,paymentDeparture,context.guests,amount);
  const selectedMethod=state.checkoutMethod || "card";
  const methods=[
    ["card",L("信用卡","Credit card"),L("安全加密輸入","Secure encrypted entry")],
    ["wallet",L("電子錢包","Digital wallet"),L("快速確認","Express confirmation")],
    ["bank",L("銀行轉帳","Bank transfer"),L("轉帳資訊","Transfer instructions")]
  ];
  const methodDetail=methods.find(item=>item[0]===selectedMethod) || methods[0];
  const optionLines=selectedOptions.items.length ? `<div class="bc-pay-extras"><p class="eyebrow">${L("你自己勾選的服務","SELECTED BY YOU")}</p>${selectedOptions.items.map(item=>`<div><span><b>${bcTxt(item.label)}</b><small>${bcFeeTimingText(item.paymentTiming)}</small></span><strong>+ ${money(bcFeeTotal(item,context.guests))}</strong></div>`).join("")}<small>${L("待供應商確認，今天不收取。","Pending supplier confirmation; not charged today.")}</small></div>` : `<div class="bc-pay-extras empty"><b>${L("沒有加入自費服務","NO EXTRAS ADDED")}</b><span>${L("付款金額沒有預設加購。","No add-on was preselected.")}</span></div>`;
  let content="";
  if (state.checkoutStep===1) content=`<header class="bc-pay-intro"><p class="eyebrow">${L("付款確認","CHECKOUT REVIEW")}</p><h1 id="bc-checkout-title" tabindex="-1">${L("從容確認","One calm final check")}</h1><p>${L("先看今天付多少 誰收款 再選付款方式 其餘費用留在同一頁 不必來回切換","See today’s amount and payee first then choose a method Every other cost stays on this page")}</p></header><section class="bc-pay-sheet" aria-labelledby="bc-pay-sheet-title"><header><div><small>${L("今天由 PACK&GO 收取","CHARGED TODAY BY PACK&GO")}</small><h2 id="bc-pay-sheet-title">${money(amount)}</h2></div><span>${L("不會扣款","NO CHARGE")}</span></header><div class="bc-pay-value-line"><span><b>${paymentTour.days} ${L("天","days")}</b><small>${bcTxt(paymentTour.features[0])}</small></span><span><b>${context.guests} ${L("位旅客","travelers")}</b><small>${context.dates}</small></span></div><fieldset class="bc-pay-methods"><legend>${L("付款方式","PAYMENT METHOD")}</legend>${methods.map(item=>`<button type="button" class="${selectedMethod===item[0]?"is-selected":""}" data-checkout-method="${item[0]}" data-method-label="${bcEscape(item[1])}" data-method-note="${bcEscape(item[2])}" aria-pressed="${selectedMethod===item[0]}"><span><b>${item[1]}</b><small>${item[2]}</small></span><i aria-hidden="true">${selectedMethod===item[0]?"●":"○"}</i></button>`).join("")}</fieldset><div class="bc-pay-method-detail" aria-live="polite"><span aria-hidden="true">●</span><div><b data-payment-method-name>${methodDetail[1]}</b><small data-payment-method-note>${methodDetail[2]}</small></div><em>${L("已選擇","SELECTED")}</em></div><div class="bc-pay-breakdown"><div><span>${L("今天收取","TODAY")}</span><strong>${money(amount)}</strong></div><div><span>${L("旅途中已知另付","PAID LATER")}</span><b>${money(laterRequired)}</b></div><div><span>${L("自選服務 待確認","EXTRAS PENDING")}</span><b>${money(selectedOptions.total)}</b></div><div class="total"><span>${L("預估已知完整旅費","KNOWN TRIP TOTAL")}</span><strong>${money(knownWithOptions)}</strong></div></div>${optionLines}<details class="bc-checkout-terms"><summary>${L("費用 收款對象與退改摘要","Costs payees and cancellation summary")}</summary>${feeDisclosure}<p>${L("正式付款流程必須顯示取消階梯 不可退第三方成本 供應商確認條件 CST 與 TCRF 揭露","Production checkout must show cancellation tiers non-refundable costs supplier confirmation CST and TCRF disclosures")}</p></details><label class="bc-checkout-consent"><input type="checkbox" data-checkout-consent ${state.checkoutConsent?"checked":""}/><span>${L("我已確認今天收款 之後另付與自選服務 並了解本頁不會扣款","I confirmed today’s amount later costs and extras and understand this page will not charge me")}</span></label><button class="btn wide bc-checkout-primary" data-checkout-finish ${state.checkoutConsent?"":"disabled"}>${L("確認金額","CONFIRM AMOUNT")} · ${money(amount)} →</button></section>`;
  if (state.checkoutStep===2) content=`<div class="bc-checkout-complete"><figure><img src="${context.image}" alt="${bcEscape(context.title)}"/><figcaption><span>✓</span></figcaption></figure><p class="eyebrow">JOURNEY MOMENT · DESIGN DEMO</p><h1 id="bc-checkout-title" tabindex="-1">${L("確認完成，旅程從這裡開始。","Confirmed—the journey begins here.")}</h1><p>${L("這只是完成狀態的設計示意；沒有授權、扣款、訂位、收據或寄信。","This is only a completion-state demo. No authorization, charge, booking, receipt or email occurred.")}</p><div class="bc-checkout-next-moments"><div><b>01</b><span>${L("供應商確認班期與自選服務","Supplier confirms the departure and extras")}</span></div><div><b>02</b><span>${L("安全核對旅客資料","Traveler details are reviewed securely")}</span></div><div><b>03</b><span>${L("會員中心追蹤出發前每一步","Track every step in the member center")}</span></div></div><button class="btn wide" data-view="payments">${L("回到付款與收據示意","Back to payments & receipts")} →</button></div>`;
  return `<main class="bc-checkout-shell bc-checkout-smooth"><section class="bc-checkout-flow">${content}</section><aside class="bc-checkout-summary"><img src="${context.image}" alt="${bcEscape(context.title)}"/><div><p class="eyebrow">${context.orderId}</p><h2>${context.title}</h2><p>${context.dates} · ${context.guests} ${L("位旅客","travelers")}</p></div><dl><div><dt>${L("今天確認","TODAY")}</dt><dd>${money(amount)}</dd></div><div><dt>${L("收款人","PAYEE")}</dt><dd>PACK&GO</dd></div><div><dt>${L("自選服務","EXTRAS")}</dt><dd>${selectedOptions.items.length} ${L("項","selected")}</dd></div><div><dt>${L("預估已知完整旅費","KNOWN TOTAL")}</dt><dd>${money(knownWithOptions)}</dd></div><div><dt>${L("付款狀態","PAYMENT STATUS")}</dt><dd>${L("未扣款","Not charged")}</dd></div></dl><small>${L("今天收款與完整旅費分開 自選服務只在主動勾選後加入","Today’s charge is separate from the full cost Extras appear only when selected")}</small></aside><div class="bc-checkout-mobile-total"><span>${L("今天確認金額","AMOUNT TODAY")}</span><strong>${money(amount)}</strong></div></main>`;
}

function bcTaiwanBookingDrawer(t) {
  return `<div class="booking-backdrop" data-book-close></div><aside class="booking-drawer bc-booking-drawer bc-taiwan-booking-drawer" role="dialog" aria-modal="true" aria-labelledby="bc-booking-title"><div class="drawer-head"><b id="bc-booking-title" tabindex="-1">${L("查看可訂狀態・設計示意","Check booking status · design demo","Ver disponibilidad · demo")}</b><button class="drawer-close" data-book-close aria-label="${L("關閉","Close","Cerrar")}">×</button></div><div class="drawer-body"><div class="demo-note">${L("不會扣款、送出資料、建立訂位或寄信。","No charge, data transmission, booking or email.","Sin cobro, envío de datos, reserva ni correo.")}</div><div class="bc-booking-product"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p class="eyebrow">${t.code} · ${L("設計示意","DESIGN DEMO","DEMO")}</p><h2>${bcTxt(t.title)}</h2><p>${t.days} ${L("天","days","días")}・${t.nights} ${L("晚","nights","noches")}</p></div></div><p class="eyebrow">${L("目前可訂狀態","CURRENT BOOKING STATUS","DISPONIBILIDAD ACTUAL")}</p><h2 class="serif">${L("尚未開放訂購；正式資料到位後再進入日期與人數。","Booking is not open yet; dates and guests follow once official data is available.","La reserva aún no está abierta; las fechas y viajeros seguirán cuando haya datos oficiales.")}</h2><p class="muted">${L("目前來源尚未提供正式日期、每人價格與餘位；原型在這裡誠實停下，不編造可購買資料。","The source has no confirmed dates, per-person price or seats. The prototype stops here rather than inventing bookable data.","La fuente no incluye fechas, precio por persona ni plazas confirmadas. La demo se detiene aquí sin inventar datos reservables.")}</p><div class="bc-preview-booking-state"><dl><div><dt>${L("班期","DEPARTURE","SALIDA")}</dt><dd>${L("待正式資料","Pending official data","Pendiente de datos")}</dd></div><div><dt>${L("每人價格","PRICE PER PERSON","PRECIO POR PERSONA")}</dt><dd>${L("待正式資料","Pending official data","Pendiente de datos")}</dd></div><div><dt>${L("訂購狀態","BOOKING STATUS","ESTADO")}</dt><dd>${L("尚未開放・設計示意","Not open · design demo","No disponible · demo")}</dd></div></dl><button class="btn wide" disabled>${L("班期未開放・待正式資料","Not open · data pending","No disponible · datos pendientes")}</button><small>${L("正式資料接線後，這裡會直接進入人數、旅客資料與總價確認。","Once connected, this continues directly to guests, traveler details and total review.","Al conectarse, seguirá a viajeros, datos personales y revisión del total.")}</small></div><button class="bc-text-button wide" data-book-close>← ${L("返回行程","Back to journey","Volver al viaje")}</button></div></aside>`;
}

function bookingDrawerBC() {
  if (!state.bookingOpen) return "";
  const t=bcCurrentTour();
  if (t.previewOnly) return bcTaiwanBookingDrawer(t);
  const departure=t.departures.find(item=>item.start===state.bookingDate) || t.departures[0];
  const total=departure.price*state.bookingGuests;
  const fees=bcBookingFeeModel(t,departure,state.bookingGuests,total);
  const selected=bcSelectedOptionalFees(t,departure,state.bookingGuests);
  const laterRequired=fees.knownTotal-fees.tripTotal;
  const knownWithOptions=fees.knownTotal+selected.total;
  const steps=Array.from({length:3},(_,index)=>`<span class="step-dot ${index<state.bookingStep?"active":""}"></span>`).join("");
  const product=`<div class="bc-booking-product"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p class="eyebrow">${t.code} · ${L("設計示意","DESIGN DEMO","DEMO")}</p><h2>${bcTxt(t.title)}</h2><p>${departure.start} → ${departure.end} · ${state.bookingGuests} ${L("位旅客","travelers")}</p></div></div>`;
  let body="";
  if (state.bookingStep===1) body=`${product}<p class="eyebrow">01 / 03 · ${L("基本選擇","THE ESSENTIALS")}</p><h2 class="serif">${L("哪天出發，幾位同行？","When are you leaving, and who is coming?")}</h2><p class="muted">${L("最重要的兩件事放同一頁，總價即時更新。","The two essentials stay together, with the total updating instantly.")}</p><div class="bc-booking-choices">${t.departures.map(item=>`<label><input type="radio" name="bc-departure" data-book-date="${item.start}" ${departure.start===item.start?"checked":""}/><span><b>${item.start} → ${item.end}</b><small>${bcTxt(item.status)} · ${item.seats} ${L("位示意餘位","sample seats")}</small></span><strong>${money(item.price)}</strong></label>`).join("")}</div><div class="bc-booking-one-question compact"><div class="bc-guest-controls"><button data-guests="-1" aria-label="${L("減少旅客","Decrease travelers")}"><span class="bc-stepper-icon" aria-hidden="true"></span></button><b>${state.bookingGuests}</b><button data-guests="1" aria-label="${L("增加旅客","Increase travelers")}"><span class="bc-stepper-icon" aria-hidden="true"></span></button></div><span>${L("位成人・設計示意","adult travelers · demo")}</span><strong>${money(total)}</strong></div><button class="btn wide" data-book-next>${L("下一步・自己選加購","Next · choose extras yourself")} →</button>`;
  if (state.bookingStep===2) body=`${product}<p class="eyebrow">02 / 03 · ${L("旅客與自選服務","TRAVELERS & EXTRAS")}</p><h2 class="serif">${L("把旅程調成你的樣子。","Make this journey yours.")}</h2><p class="muted">${L("所有自費預設不加入；只有你親自勾選才會出現在確認頁。","Every extra starts off. It appears in review only when you check it yourself.")}</p><div class="bc-booking-traveler-choice"><label><input type="radio" name="bc-traveler" value="member" data-book-traveler-radio="member" ${state.bookingTraveler==="member"?"checked":""}/><span><b>${BC_DEMO_MEMBER.traveler}</b><small>${L("使用已登入的示意旅客資料；出發前再安全核對。","Use the signed-in sample profile; review securely before departure.")}</small></span></label><label><input type="radio" name="bc-traveler" value="later" data-book-traveler-radio="later" ${state.bookingTraveler==="later"?"checked":""}/><span><b>${L("稍後新增旅客","Add traveler later")}</b><small>${L("先保留需求，正式版再安全收取資料。","Hold the request and collect details securely in production.")}</small></span></label></div><section class="bc-booking-options"><header><div><p class="eyebrow">OPTIONAL SERVICES</p><h3>${L("想要才勾；預設不加入。","Check only what you want. Nothing is preselected.")}</h3></div><b>${selected.items.length} ${L("項已選","SELECTED")}</b></header>${fees.categories.optional.map(item=>`<label><input type="checkbox" data-book-option="${item.id}" ${state.bookingOptions.has(item.id)?"checked":""}/><span><b>${bcTxt(item.label)}</b><small>${bcFeeUnitText(item)} · ${bcFeeTimingText(item.paymentTiming)} · ${bcFeePayeeText(item.payeeType)}</small></span><strong>+ ${money(bcFeeTotal(item,state.bookingGuests))}</strong></label>`).join("")}<footer><span>${selected.items.length?L("已選服務預估・待確認","SELECTED EXTRAS · PENDING"):L("沒有加入任何自費服務","NO EXTRAS ADDED")}</span><strong>${money(selected.total)}</strong></footer></section><div class="bc-form-actions"><button class="btn ghost" data-book-prev>${L("上一步","Back")}</button><button class="btn" data-book-next>${L("查看完整價值與總價","Review value & total")} →</button></div>`;
  if (state.bookingStep===3) body=`<section class="bc-booking-ritual"><img src="${t.image}" alt="${bcTxt(t.title)}"/><div><p class="eyebrow">03 / 03 · ${L("你的旅程","YOUR JOURNEY")}</p><h2>${L(`你買的不只是 ${t.days} 天，是一段被安排清楚的時間。`,`This is more than ${t.days} days—it is time thoughtfully put together.`)}</h2><p>${bcTxt(t.features[0])} · ${bcTxt(t.features[1])}</p></div></section><div class="bc-booking-value-grid"><div><b>${t.days}</b><span>${L("天完整旅程","days")}</span></div><div><b>${bcTxt(t.group)}</b><span>${L("小團尺度","group size")}</span></div><div><b>${t.air?L("含機票","AIR INCLUDED"):L("不含機票","LAND ONLY")}</b><span>${L("商品方式","format")}</span></div></div><div class="bc-booking-final-cost"><div><span>${L("今天由 PACK&GO 收取","CHARGED TODAY")}</span><strong>${money(total)}</strong></div><div><span>${L("旅途中已知另付","KNOWN COSTS PAID LATER")}</span><b>${money(laterRequired)}</b></div><div><span>${L("你勾選的自費・待確認","SELECTED EXTRAS · PENDING")}</span><b>${money(selected.total)}</b></div><div class="total"><span>${L("預估已知完整旅費","ESTIMATED KNOWN TRIP TOTAL")}</span><strong>${money(knownWithOptions)}</strong></div></div>${selected.items.length?`<div class="bc-booking-selected-summary"><p class="eyebrow">${L("你自己選的","SELECTED BY YOU")}</p>${selected.items.map(item=>`<div><span>${bcTxt(item.label)}</span><b>+ ${money(bcFeeTotal(item,state.bookingGuests))}</b></div>`).join("")}<small>${L("待供應商確認；今天不收取。","Pending supplier confirmation; not charged today.")}</small></div>`:`<div class="bc-booking-selected-summary empty"><b>${L("沒有勾選自費服務。","No optional services selected.")}</b><span>${L("總價沒有偷偷加入任何加購。","No extra has been silently added.")}</span></div>`}<details class="bc-booking-full-disclosure"><summary>${L("查看完整費用、收款對象與支付時間","View every cost, payee and payment timing")}</summary>${bcBookingFeeDisclosure(t,departure,state.bookingGuests,total)}</details><label class="bc-checkout-consent"><input type="checkbox" data-book-consent ${state.bookingConsent?"checked":""}/><span>${L("我已看過今天收款、之後另付與自己勾選的服務；我了解這只是設計示意。","I reviewed today’s charge, later costs and my selected extras; I understand this is a design demo.")}</span></label><div class="bc-form-actions"><button class="btn ghost" data-book-prev>${L("上一步","Back")}</button><button class="btn" data-book-payment ${state.bookingConsent?"":"disabled"}>${L("帶著這趟旅程去付款示意","Continue to payment demo")} →</button></div><button class="bc-text-button wide" data-book-request ${state.bookingConsent?"":"disabled"}>${L("先提交訂位需求・設計示意","Submit booking request instead · demo")}</button>`;
  return `<div class="booking-backdrop" data-book-close></div><aside class="booking-drawer bc-booking-drawer" role="dialog" aria-modal="true" aria-labelledby="bc-booking-title"><div class="drawer-head"><b id="bc-booking-title" tabindex="-1">${L("完成這趟旅程・3 步驟","Complete this journey · 3 steps")}</b><button class="drawer-close" data-book-close aria-label="${L("關閉","Close")}">×</button></div><div class="drawer-body"><div class="demo-note">${L("設計示意：不會扣款、送出資料、訂位或寄信。","Design demo: no charge, data, booking or email.")}</div><div class="stepper">${steps}</div>${body}</div></aside>`;
}

function visaBC() {
  return chinaVisaBC();
}

function chinaVisaBC() {
  return bcGuidedServicePage({
    flow:"china", image:BC_IMG.passport, eyebrow:L("中國簽證","CHINA VISA"),
    title:L("中國簽證　一次完成","China visa　one complete flow"),
    copy:L("美國護照申請專用　先確認身分　填表　上傳與核對　付款永遠放在最後一步","For U S passport applicants　Confirm eligibility　apply　upload and review first　Payment is always the final step"),
    briefTitle:L("<span>只服務</span><span>舊金山灣區</span>","<span>San Francisco Bay Area</span><span>customers only</span>"),
    briefCopy:L("完成預檢　申請資料　文件核對與最後付款並取得案件編號後　才可郵寄或親送護照<br><strong data-keep-punctuation>PACK&GO<br>39055 Cedar Blvd #126<br>Newark CA 94560</strong><br>未建立案件前請勿寄出護照","Mail or deliver the passport only after the pre check　application　document review　final payment and case number<br><strong data-keep-punctuation>PACK&GO<br>39055 Cedar Blvd #126<br>Newark CA 94560</strong><br>Do not send a passport before a case is created"),
    position:"center 48%",
    startLabel:L("開始資格預檢","Start eligibility check"),
    startView:"china-visa-check",
    showFlow:false,
    before:bcChinaVisaJourney(),
    factsBefore:true,
    facts:[[L("單人辦理","One applicant"),`${money(290)} ${L("每人　含照片　代辦與官方費用","per person　including photo　service and consular fee")}`],[L("兩位以上","Two or more"),`${money(275)} ${L("每人　同次完成預檢與送件","per person　when pre checked and submitted together")}`],[L("一般作業","Standard timing"),L("二十一個工作天　不含週末與公共假日","Twenty one business days　excluding weekends and public holidays")]]
  });
}

function chinaVisaCheckBC() {
  return `<main class="bc-china-check-page"><section class="bc-shell bc-china-check-head"><button class="bc-china-check-back" data-view="china-visa">← ${L("返回中國簽證","Back to China visa")}</button><div><p class="eyebrow">${L("中國簽證資格預檢","CHINA VISA ELIGIBILITY CHECK")}</p><h1>${L("先確認我們能不能受理","First confirm that this service fits")}</h1><p>${L("一次只回答一題　完成後才顯示適用文件　費用與下一步","Answer one question at a time　Your checklist　fee and next step appear only when the path is clear")}</p></div><aside><span>${L("美國護照","U S passport")}</span><span>${L("舊金山灣區","San Francisco Bay Area")}</span><span>${L("答案目前不會送出","Answers are not sent")}</span></aside></section><section id="bc-service-flow" class="bc-shell section-tight bc-guided-section">${bcGuidedFlow("china")}</section>${bcChinaApplication()}</main>`;
}

function customBC() {
  return bcGuidedServicePage({
    flow:"custom", image:BC_IMG.custom, eyebrow:"CUSTOM TRAVEL",
    title:L("一個客製入口，依人數走對問題。","One custom-travel entry, routed by party size.","Una entrada a medida, según el tamaño del grupo."),
    copy:L("個人、家庭與多人包團都從這裡開始。先回答人數；6 位以上會自動改問團體目的、路線、日期、價位與共同條件。","Solo travelers, families and private groups all start here. Six or more automatically switches to group purpose, route, date, price range and shared needs.","Viajeros, familias y grupos empiezan aquí. Con seis o más se preguntan objetivo, ruta, fecha, precio y necesidades."),
    briefTitle:L("私人包團不是另一項服務","Private groups are not a separate service","Los grupos no son otro servicio"),
    briefCopy:L("它只是客製旅行在人數較多時的內部分支；客人不需要先理解兩個相似名詞。","It is simply the larger-party branch of custom travel; customers do not need to decode two similar labels.","Es la ruta para grupos dentro del viaje a medida; el cliente no debe descifrar dos nombres."),
    position:"center 54%",
    facts:[[L("接近現有團","Near a current tour","Similar a un circuito"),L("先比較成熟商品與總價。","Compare proven products and totals first.","Compare productos y totales.")],[L("可有限度調整","Adaptable","Adaptable"),L("保留路線骨架，只調整真正重要的條件。","Keep the route and change only what matters.","Mantenga la ruta y cambie lo importante.")],[L("需要重新設計","Fully custom","Totalmente a medida"),L("再由真人處理供應商、風險與可行性。","A person handles suppliers, risk and feasibility.","Una persona gestiona proveedores y viabilidad.")]]
  });
}

function groupBC() {
  return customBC();
}

function transferBC() {
  return bcGuidedServicePage({
    flow:"transfer", image:BC_IMG.transfer, eyebrow:"AIRPORT TRANSFER",
    title:L("一個航班號，少問兩個問題。","One flight number. Two fewer questions.","Un número de vuelo, dos preguntas menos."),
    copy:L("正式版應由航班號帶出日期與時間；客人只補方向、地址、人數、行李與特殊需求。","Production should derive date and time from the flight number; customers add direction, address, party, bags and special needs.","La versión final obtiene fecha y hora del vuelo; el cliente añade dirección, viajeros y equipaje."),
    briefTitle:L("先確認容量，再談價格","Confirm capacity before price","Confirme capacidad antes del precio"),
    briefCopy:L("付款前顯示車型、等待時間、超時費與取消期限。原型不派車。","Show vehicle, wait time, overtime and cancellation before payment. No vehicle is dispatched.","Muestre vehículo, espera, tiempo extra y cancelación. No se despacha vehículo."),
    position:"center 58%",
    facts:[[L("車型與容量","Vehicle and capacity","Vehículo y capacidad"),L("人數、行李與特殊設備一起計算。","Guests, bags and equipment together.","Viajeros, maletas y equipo juntos.")],[L("免費等待","Included wait","Espera incluida"),L("示意 60 分鐘；正式版依供應商確認。","Sample 60 minutes; supplier confirms production.","Ejemplo 60 minutos; proveedor confirma.")],[L("例外由人處理","Human exceptions","Excepciones humanas"),L("輪椅、多站、航班取消與臨時改址。","Wheelchair, multiple stops, cancellation or late address change.","Silla, paradas, cancelación o cambio de dirección.")]]
  });
}

function hotelBC() {
  return bcGuidedServicePage({
    flow:"hotel", image:BC_IMG.hotel, eyebrow:"HOTELS",
    title:L("先選路徑，不先填五個欄位。","Choose the path before filling five fields.","Elija la ruta antes de llenar cinco campos."),
    copy:L("一般比價、行程住宿與特殊房型不是同一件事；先分流，再只問該路徑需要的資料。","Standard search, tour hotels and special rooms are different tasks. Route first, then ask only what is needed.","Búsqueda estándar, hotel de circuito y habitación especial son tareas distintas; primero se separan."),
    briefTitle:L("總價、取消、床型、付款對象","Total, cancellation, bed and payee","Total, cancelación, cama y cobro"),
    briefCopy:L("這四項固定一起比較；原型不導向外站、不訂房。","Compare these four together. This prototype does not redirect or book.","Compare estos cuatro juntos. El prototipo no redirige ni reserva."),
    position:"center 55%",
    facts:[[L("一般訂房","Standard stay","Estancia estándar"),L("完整含稅價與取消期限。","Full price with taxes and cancellation deadline.","Precio con impuestos y fecha de cancelación.")],[L("行程住宿","Tour hotel","Hotel del circuito"),L("跟著訂單與供應商確認更新。","Updates with the order and supplier confirmation.","Se actualiza con el pedido y proveedor.")],[L("特殊房型","Special rooms","Habitaciones especiales"),L("連通、無障礙、長住與團體房轉人工確認。","Connected, accessible, long stay or group rooms need review.","Conectadas, accesibles, largas o grupales pasan a revisión.")]]
  });
}

function contactBC() {
  return bcGuidedServicePage({
    flow:"support", image:BC_IMG.support, eyebrow:"CONTACT & SUPPORT",
    title:L("支援不該從頭問。","Support should not start over.","Soporte no debe empezar de cero."),
    copy:L("登入後先帶入示意訂單，只補問題類型、風險與希望解決的事情；標準購買流程不靠聯絡表單。","Signed-in support carries the sample order and asks only for issue, risk and desired outcome. Standard purchases do not depend on contact forms.","Soporte lleva el pedido y solo pregunta problema, riesgo y resultado. Las compras estándar no dependen de contacto."),
    briefTitle:L("先分流，高風險立即升級","Triage first; escalate risk immediately","Primero clasificar; el riesgo se escala"),
    briefCopy:L("人身安全、重大醫療、護照遺失與大型中斷在正式版需有 24 小時入口；此處僅設計示意。","Production needs a 24-hour path for safety, major medical, lost passport and disruption; this is interface-only.","La versión final necesita ruta 24 horas para seguridad, salud, pasaporte e interrupciones; aquí solo diseño."),
    position:"center 48%",
    facts:[[L("訂單已帶入","Order context","Contexto del pedido"),L("不用重填日期、旅客與已知狀態。","Do not repeat dates, travelers or known status.","No repita fechas, viajeros ni estado.")],[L("敏感資料不在這裡","No sensitive data","Sin datos sensibles"),L("不填護照號碼、卡號或密碼。","No passport number, card or password.","Sin pasaporte, tarjeta ni contraseña.")],[L("一般聯絡","General contact","Contacto general"),"+1 (510) 634-2307 · support@packgoplay.com"]]
  });
}

// Temporary audit switch. Default behavior remains the later implementations.
// Remove this block and the legacy_ prefixes after Jeff chooses which versions
// to keep. `legacy=1` restores the formerly shadowed implementations together.
const bcInitialNavigationUrl = window.performance?.getEntriesByType("navigation")?.[0]?.name || window.location.href;
const bcLegacyAuditMode =
  (typeof params !== "undefined" && params.get("legacy") === "1") ||
  new URLSearchParams(window.location.search).get("legacy") === "1" ||
  new URL(bcInitialNavigationUrl).searchParams.get("legacy") === "1";
if (bcLegacyAuditMode) {
  bcHeader = legacy_bcHeader;
  flightsBC = legacy_flightsBC;
  visaBC = legacy_visaBC;
  chinaVisaBC = (...args) => state.view === "visa" ? legacy_visaBC(...args) : legacy_chinaVisaBC(...args);
  customBC = (...args) => state.view === "group" ? legacy_groupBC(...args) : legacy_customBC(...args);
  groupBC = legacy_groupBC;
  transferBC = legacy_transferBC;
  hotelBC = legacy_hotelBC;
  bcMemberNav = legacy_bcMemberNav;
  bcMemberPage = legacy_bcMemberPage;
  memberBC = legacy_memberBC;
  ordersBC = legacy_ordersBC;
  orderDetailBC = legacy_orderDetailBC;
  travelersBC = legacy_travelersBC;
  paymentsBC = legacy_paymentsBC;
  contactBC = legacy_contactBC;
  bcMembershipVariantC = legacy_bcMembershipVariantC;
  bcMembershipCompactDetails = legacy_bcMembershipCompactDetails;
  bcMembershipVariantA = legacy_bcMembershipVariantA;
  bcMembershipVariantB = legacy_bcMembershipVariantB;
  bookingDrawerBC = legacy_bookingDrawerBC;
}
