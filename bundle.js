// SPDX-License-Identifier: GPL-3.0-only
// Modified/adapted 2026-11-16; see THIRD_PARTY_NOTICES.txt.
// A deliberately bounded INI reader for the versioned Dijkstra replay model.
// Unsupported runtime expressions fail instead of silently using another run's settings.
const REPLAY_MODEL = {"profile": "leo-dijkstra-delta-v1", "modelHash": "fe5550651103f796a211ab098754049544714ecf96bb69ace6d1823675b0f179"};
function bundlePath(base, relative) {
  if (/^(?:[a-z]+:|[/\\])/i.test(relative)) throw new Error("Absolute bundle path rejected");
  const parts = base.split("/").slice(0,-1);
  for (const part of relative.replaceAll("\\","/").split("/")) {
    if (part === "..") { if (!parts.length) throw new Error("Bundle path escapes result folder"); parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
function readReplayIni(files, entry, selected) {
  const rootNames = new Set();
  const sections = new Map([["General",[]]]), parents = new Map(), active = new Set();
  const unquote = x => x.startsWith('"') && x.endsWith('"') ? JSON.parse(x) : x;
  function walk(name, section) {
    if (!files.has(name)) throw new Error(`Missing INI: ${name}`);
    if (active.has(name)) throw new Error(`Cyclic INI include: ${name}`);
    active.add(name);
    for (let raw of files.get(name).replace(/^\uFEFF/,"").split(/\r?\n/)) {
      let quoted=false,escaped=false,line="";
      for(const ch of raw){if(ch==="#"&&!quoted)break;line+=ch;if(ch==='"'&&!escaped)quoted=!quoted;escaped=ch==="\\"&&!escaped;}
      line=line.trim();if(!line)continue;
      let m=line.match(/^\[(?:Config\s+)?([^\]]+)\]$/);
      if(m){section=m[1].trim();if(name===entry && section!=="General")rootNames.add(section);if(!sections.has(section))sections.set(section,[]);continue;}
      m=line.match(/^include\s+(.+)$/);
      if(m){section=walk(bundlePath(name,unquote(m[1].trim())),section);continue;}
      const eq=line.indexOf("=");if(eq<0)throw new Error(`Unsupported INI syntax in ${name}`);
      const k=line.slice(0,eq).trim(),v=line.slice(eq+1).trim();
      if(k==="extends")parents.set(section,v.split(",").map(s=>s.trim()));
      else sections.get(section).push({k,v,sec:section});
    }
    active.delete(name);return section;
  }
  walk(entry,"General");
  function linearize(name, visiting=new Set()) {
    if(!sections.has(name))throw new Error(`Unknown INI section: ${name}`);
    if(visiting.has(name))throw new Error("Cyclic INI inheritance");
    visiting=new Set(visiting).add(name);const ps=parents.get(name)||[];
    const queues=ps.map(p=>linearize(p,visiting)).concat([ps.slice()]);const out=[name];
    while(queues.some(q=>q.length)){
      const head=queues.filter(q=>q.length).map(q=>q[0]).find(h=>!queues.some(q=>q.slice(1).includes(h)));
      if(head===undefined)throw new Error("Inconsistent INI inheritance");
      out.push(head);for(const q of queues)if(q[0]===head)q.shift();
    }
    return out;
  }
  const chain=linearize(selected).filter(s=>s!=="General").concat("General");
  const entries=chain.flatMap(s=>sections.get(s));
  function pattern(key) {
    let out="";
    for(let i=0;i<key.length;){
      if(key.startsWith("**.",i)){out+="(?:.*\\.)?";i+=3;}
      else if(key.startsWith("**",i)){out+=".*";i+=2;}
      else if(key[i]==="*"){out+="[^.]*";i++;}
      else if(key[i]==="["){
        const end=key.indexOf("]",i),range=key.slice(i+1,end);
        if(end<0)throw new Error("Invalid INI pattern");
        if(range==="*")out+="\\[\\d+\\]";
        else if(/^\d+\.\.\d+$/.test(range)){
          const [lo,hi]=range.split("..").map(Number);if(hi-lo>10000||hi<lo)throw new Error("Unsupported index range");
          out+="\\[(?:"+Array.from({length:hi-lo+1},(_,j)=>lo+j).join("|")+")\\]";
        }else out+="\\["+range+"\\]";
        i=end+1;
      }else{out+=key[i].replace(/[.*+?^${}()|[\]\\]/g,"\\$&");i++;}
    }
    return new RegExp("^"+out+"$");
  }
  const compiled=entries.map(e=>({...e,re:pattern(e.k)}));
  const get=(path,fallback)=>{const e=compiled.find(e=>e.re.test(path));return e?unquote(e.v):fallback;};
  function number(path,fallback,unit=""){
    const v=get(path,fallback);if(v===undefined)throw new Error(`Missing replay setting: ${path}`);
    const m=String(v).match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)\s*([A-Za-z]*)$/i);
    if(!m)throw new Error(`Unsupported expression: ${path} = ${v}`);
    const scales={s:{"":1,s:1,ms:.001,min:60,h:3600,d:86400},mps:{"":1,mps:1},km:{"":1,km:1},"":{"":1}};
    const factor=scales[unit][m[2]];if(factor===undefined)throw new Error(`Unsupported unit: ${path}`);
    const n=Number(m[1])*factor;if(!Number.isFinite(n))throw new Error(`Invalid number: ${path}`);return n;
  }
  const bool=(p,d)=>{const v=String(get(p,String(d)));if(v!=="true"&&v!=="false")throw new Error(`Unsupported boolean: ${p}`);return v==="true";};
  const c="LeoDijkstra.constellationCreator.",tc="LeoDijkstra.topologyControl.";
  if(get("network","")!=="Florasat.Dijkstra132.LeoDijkstra" || !bool(c+"enabled",false) || get(tc+"walkerType","DELTA")!=="DELTA")throw new Error("Unsupported replay network/constellation");
  const cfg={activeConfig:selected,description:get("description",""),chain,extends:parents.get(selected)||[],
    configs:[...rootNames].filter(k=>k!=="Dijkstra132Terminals").map(name=>({name})),ownEntries:sections.get(selected),effectiveEntries:entries,
    iniPath:entry,leoFound:false,numSatellites:number("LeoDijkstra.numSatellites"),planes:number(c+"planeCount"),
    phasing:number(c+"interPlaneSpacing"),altitude:number(c+"altitude"),inclination:number(c+"inclination"),
    raanSpread:number(c+"raanSpread",360),baseYear:number(c+"baseYear",20),baseDay:number(c+"baseDay",.8292315),
    epochYear:number(c+"epochYear",20),epochDay:number(c+"epochDay",.8194444),eccentricity:number(c+"eccentricity",.000001),
    bstar:number("LeoDijkstra.satellite[0].NoradModule.bstar",.00042243),
    minimumElevation:number(tc+"minimumElevation",5),updateInterval:number(tc+"updateInterval",1,"s"),
    intraDisabled:bool("LeoDijkstra.intraPlaneIslDisabled",false),interDisabled:bool("LeoDijkstra.interPlaneIslDisabled",false),
    simTimeLimit:number("sim-time-limit",undefined,"s"),numTerminals:number("LeoDijkstra.numTerminals",30),
    metric:get("LeoDijkstra.satellite[0].net.routing.metric","delay"),routingType:get("LeoDijkstra.satellite[0].net.routingType",""),
    maxRoutes:number("LeoDijkstra.mapDataSource.maxRoutes",8),routeLifetime:number("LeoDijkstra.mapDataSource.routeLifetime",30,"s"),stations:[],terminals:[]};
  if(!Number.isInteger(cfg.phasing)||cfg.phasing<0||cfg.phasing>=cfg.planes||!Number.isInteger(cfg.maxRoutes)||cfg.maxRoutes<0||cfg.inclination<0||cfg.inclination>=180||cfg.baseDay<1||cfg.baseDay>=367||cfg.epochDay<1||cfg.epochDay>=367)throw new Error("Invalid orbital parameters");
  if(cfg.numTerminals!==0 || bool("LeoDijkstra.allowUnevenPlanes",false)||cfg.raanSpread!==360||cfg.eccentricity!==.000001||cfg.altitude<220||cfg.altitude>2000)throw new Error("Unsupported replay model parameters");
  if(!Number.isInteger(cfg.numSatellites)||!Number.isInteger(cfg.planes)||cfg.planes<2||cfg.numSatellites%cfg.planes||cfg.numSatellites/cfg.planes<3||cfg.numSatellites>5000||cfg.updateInterval<=0||cfg.simTimeLimit<=0||cfg.routeLifetime<=0)throw new Error("Invalid constellation/time settings");
  for(const v of [cfg.baseYear,cfg.epochYear])if(!Number.isInteger(v)||v<0||v>99)throw new Error("Unsupported epoch year");
  for(let id=0;id<cfg.numSatellites;id++){
    const p=`LeoDijkstra.satellite[${id}].`;
    if(get(p+"noradModuleType","Sat_Mob_NoradA")!=="Sat_Mob_NoradA" || number(p+"NoradModule.argPerigee",0)!==0 || number(p+"NoradModule.bstar",.00042243)!==cfg.bstar)throw new Error("Unsupported individual satellite orbit");
  }
  cfg.maxGroundLinks=number(tc+"numGroundLinks",60);
  if(!Number.isInteger(cfg.maxGroundLinks)||cfg.maxGroundLinks<1)throw new Error("Invalid ground link capacity");
  const count=number("LeoDijkstra.nrOfGS");if(!Number.isInteger(count)||count<1||count>5000)throw new Error("Invalid station count");
  for(let id=0;id<count;id++){
    const p=`LeoDijkstra.station[${id}].`,m=p+"mobility.";
    const type=get(p+"nodeType","station");if(!["station","mobile"].includes(type))throw new Error("Unsupported node type");
    const st={id,name:get(p+"label",`GS${id}`),mobile:type==="mobile",lat:number(m+"latitude",0),lon:number(m+"longitude",0),alt:number(m+"altitudeKm",0,"km"),speed:number(m+"speed",0,"mps"),start:number(m+"routeStart",0)};
    const route=get(m+"route","");if(route){st.route=route.split(/\s+/).map(pair=>pair.split(",").map(Number));if(st.route.length<2||st.route.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw new Error("Invalid station route");}
    if(st.speed<0||st.start<0||st.start>1||Math.abs(st.lat)>90||Math.abs(st.lon)>180)throw new Error("Invalid station coordinates/speed");
    if(st.route && (!st.mobile || st.route.every(p=>p[0]===st.route[0][0] && p[1]===st.route[0][1])))throw new Error("Unsupported/zero-length station route");
    cfg.stations.push(st);
  }
  return cfg;
}
async function prepareBundleFiles(bundle, progress=()=>{}, existing=null) {
  const m=bundle.manifest;
  if(!m || (!["leo-native-replay-v2","leo-native-replay-v3","leo-native-replay-v4"].includes(m.format) && (m.format!=="florasat-csv-ini-v1"||m.profile!==REPLAY_MODEL.profile||m.modelHash!==REPLAY_MODEL.modelHash)) || (["leo-native-replay-v2","leo-native-replay-v3","leo-native-replay-v4"].includes(m.format) && (m.profile!== ("leo-native-delta-v"+m.format.slice(-1))||m.orbitModelHash!==REPLAY_MODEL.modelHash)))throw new Error("지원하지 않는 실행 결과 또는 원본 모델 버전입니다.");
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(m.runId)||!m.files||!m.configName||Object.keys(m.overrides||{}).length)throw new Error("Invalid result metadata/overrides");
  const files=new Map(Object.entries(bundle.files||{}));
  for(const [name,expected] of Object.entries(m.files)){
    if(bundlePath("manifest.json",name)!==name)throw new Error(`Invalid result path: ${name}`);
    if(!files.has(name)&&bundle.fileUrls?.[name]){const response=await fetch(bundle.fileUrls[name],{cache:"no-store"});if(!response.ok)throw Error(`Missing result file: ${name}`);files.set(name,name===m.csvPath?await response.blob():await response.text());}
    const value=files.get(name);if(typeof value!=="string"&&!(value instanceof Blob))throw new Error(`Missing/invalid result file: ${name}`);
    progress(`파일 확인: ${name}`);
    const bytes=value instanceof Blob?await value.arrayBuffer():new TextEncoder().encode(value);
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
    if(hash!==expected)throw new Error(`파일이 변경되었습니다: ${name}`);
    if(value instanceof Blob&&name!==m.csvPath)files.set(name,await value.text());
  }
  if(!Object.hasOwn(m.files,m.entryIni)||!Object.hasOwn(m.files,m.csvPath))throw new Error("Missing required result files");
  const checked=new Map([...files].filter(([name])=>Object.hasOwn(m.files,name)));
  const native=["leo-native-replay-v2","leo-native-replay-v3","leo-native-replay-v4"].includes(m.format);
  if(native && (!m.normalizedPath||!Object.hasOwn(m.files,m.normalizedPath)||!Object.hasOwn(m.files,"summary.json")||!Object.hasOwn(m.files,"network-events.jsonl")||!Object.hasOwn(m.files,"timeseries.csv")))throw new Error("계측 결과 파일이 누락되었습니다.");
  const cfg=native?JSON.parse(checked.get(m.normalizedPath)):readReplayIni(checked,m.entryIni,m.configName);
  if(native && (![2,3,4].includes(cfg.normalizedVersion)||!Array.isArray(cfg.stations)||cfg.numTerminals!==0||!Number.isInteger(cfg.numSatellites)||cfg.numSatellites<6||cfg.numSatellites>20000||cfg.planes<2||cfg.numSatellites%cfg.planes||cfg.altitude<220||cfg.altitude>2000||!Number.isFinite(cfg.simTimeLimit)||cfg.simTimeLimit<=0))throw new Error("지원하지 않는 정규화 설정입니다.");
  const summary=native?JSON.parse(checked.get("summary.json")):null;
  const networkEvents=native?checked.get("network-events.jsonl").split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)):[];
  let last=-1;for(const e of networkEvents){if(!Number.isFinite(e.time)||e.time<last||e.time<0||e.time>cfg.simTimeLimit)throw new Error("Invalid network timeline");last=e.time;}
  const series=native?checked.get("timeseries.csv").trim().split(/\r?\n/).slice(1).map(s=>s.split(",").map(Number)):[];
  if(series.some(r=>r.length!==9||r.some(v=>!Number.isFinite(v))))throw new Error("Invalid metric series");
  const controlSeries=native&&checked.has("control-series.csv")?checked.get("control-series.csv").trim().split(/\r?\n/).slice(1).map(s=>s.split(",").map(Number)):[];
  if(controlSeries.some(r=>r.length!==8||r.some(v=>!Number.isFinite(v))))throw new Error("Invalid control series");
  const validate=r=>{if(r[7]||r[2]>=cfg.stations.length||r[3]>=cfg.stations.length||r[6].some(id=>id>=cfg.numSatellites)||r[0]>cfg.simTimeLimit)throw new Error("CSV does not match supported scenario settings");};
  const csv=checked.get(m.csvPath);let rows;
  if(existing?.manifest&&m.files[m.csvPath]===existing.csvHash&&JSON.stringify(cfg)===JSON.stringify(existing.config)&&Object.keys(m.files).length===Object.keys(existing.manifest.files).length&&Object.entries(m.files).every(([name,hash])=>existing.manifest.files[name]===hash))rows=existing.routes;
  else if(csv instanceof Blob)rows=await parseRoutesBlob(csv,validate,p=>progress(`경로 읽는 중 ${Math.round(p*100)}%`));
  else {rows=parseRoutesCsv(csv);for(const row of rows)validate(row);}

  return {notice:bundle.notice,ok:true,routes:rows,states:[],config:cfg,manifest:m,replay:true,summary,networkEvents,series,controlSeries,bundle,runId:m.runId,inputHash:m.inputHash||m.modelHash,csvHash:m.files[m.csvPath],createdAt:m.createdAt};
}
async function storedFolderBundle(identifier){
  if(!location.protocol.startsWith("http")||!/^[a-zA-Z0-9-]{8,80}$/.test(identifier))throw Error("선택한 폴더를 읽지 못했습니다. 실행 결과 폴더 접근 상태를 확인하세요.");
  const response=await fetch(`/api/result?runId=${encodeURIComponent(identifier)}&metadata=1`,{cache:"no-store"});
  if(!response.ok)throw Error("선택한 폴더를 읽지 못했고, 프로그램에도 해당 ID의 결과가 없습니다.");
  const result=await response.json();if(!result?.bundle)throw Error("보관된 실행 결과를 찾지 못했습니다.");
  result.bundle.notice="프로그램에 보관된 동일 ID의 실행 결과를 불러왔습니다.";return result.bundle;
}
async function prepareBundle(bundle,progress=()=>{},existing=null){
  try{return await prepareBundleFiles(bundle,progress,existing);}
  catch(error){if(error.name!=="NotReadableError"||!bundle.sourceFolderId)throw error;return prepareBundleFiles(await storedFolderBundle(bundle.sourceFolderId),progress,existing);}
}
async function bundleFromFiles(selection){
  const manifests=selection.filter(file=>file.name==="manifest.json");
  if(manifests.length!==1)throw Error(manifests.length?"실행 결과 하위 폴더 하나를 선택하세요.":"manifest.json이 있는 실행 결과 폴더를 선택하세요.");
  const manifestFile=manifests[0],identifier=manifestFile.webkitRelativePath.split("/").at(-2);let text;
  try{text=await manifestFile.text();}catch(error){if(error.name!=="NotReadableError")throw error;return storedFolderBundle(identifier);}
  const manifest=JSON.parse(text.replace(/^\uFEFF/,"")),prefix=manifestFile.webkitRelativePath.slice(0,-manifestFile.name.length),available=new Map(selection.map(file=>[file.webkitRelativePath,file])),files={};
  if(manifest.completionRequired){
    const markerFile=available.get(prefix+"completed.json");
    if(!markerFile)throw Error("완료된 실행 결과 폴더를 선택하세요.");
    try {
      const marker=JSON.parse(await markerFile.text());
      const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",await manifestFile.arrayBuffer()))]
        .map(n=>n.toString(16).padStart(2,"0")).join("");
      if(marker.runId!==manifest.runId||marker.manifestSHA256!==hash)throw Error("완료 기록과 결과가 일치하지 않습니다.");
    } catch(error){
      if(error.name!=="NotReadableError")throw error;
      return storedFolderBundle(identifier);
    }
  }
  for(const name of Object.keys(manifest.files||{})){if(bundlePath("manifest.json",name)!==name)throw Error(`Invalid result path: ${name}`);const file=available.get(prefix+name);if(!file)throw Error(`Missing/invalid result file: ${name}`);files[name]=file;}
  return {manifest,files,sourceFolderId:identifier};
}
if(typeof module!=="undefined")module.exports={readReplayIni,prepareBundle,bundlePath,REPLAY_MODEL,bundleFromFiles};

let networkReplayCache=null;
function applyNetworkTimeline(snapshot,events,runId,time) {
  if(!networkReplayCache||networkReplayCache.id!==runId||time<networkReplayCache.time)networkReplayCache={id:runId,time:-1,index:0,down:new Set(),effects:new Map(),knowledge:new Map()};
  const c=networkReplayCache;
  while(c.index<events.length&&events[c.index].time<=time){
    const e=events[c.index++];const key=[Math.min(e.a,e.b),Math.max(e.a,e.b)].join(":");
    if(e.event==="failure")c.down.add(key);
    if(e.event==="restore")c.down.delete(key);
    if(e.event==="congestion")c.effects.set(`${e.a}:${e.b}`,e);
    if(e.event==="csib-applied")c.knowledge.set(e.node,e);
  }
  c.time=time;snapshot.links=snapshot.links.filter(([a,b,kind])=>kind>=2||!c.down.has([Math.min(a,b),Math.max(a,b)].join(":")));
  snapshot.downLinks=c.down;snapshot.linkEffects=c.effects;snapshot.knowledge=c.knowledge;return snapshot;
}
