// SPDX-License-Identifier: GPL-3.0-only
// Modified/adapted 2026-11-16; see THIRD_PARTY_NOTICES.txt.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const delay = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn,attempts=300) { for (let i=0;i<attempts;i++) { try { return await fn(); } catch { await delay(250); } } throw new Error("Startup timeout"); }
(async () => {
  const stored=process.argv.find(a=>a.startsWith("--stored-result"));
  const port=20000+Math.floor(Math.random()*10000)*2;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "florasat-browser-"));
  const httpRoot=path.join(profile,"http");fs.mkdirSync(path.join(httpRoot,"data"),{recursive:true});
  const brandAsset="manual/assets/Kari_logo.png";
  fs.mkdirSync(path.join(httpRoot,"manual/assets"),{recursive:true});
  for(const file of ["index.html","app.js","editor.js","orbit.js","csv.js","bundle.js","style.css","sim-ui.ico","data/earth.png",brandAsset])fs.copyFileSync(path.join(__dirname,file),path.join(httpRoot,file));
  fs.cpSync(path.join(__dirname,"settings"),path.join(httpRoot,"settings"),{recursive:true});
  if(!stored){
    fs.appendFileSync(path.join(httpRoot,"settings/simulations/Network/scenarios.ini"),
      "\n[Config LabelFixture]\nextends = Dijkstra132\ndisplayName = \"내 설정 시험\"\nadditional = true\n[Config 까를로잇테스트]\nextends = LabelFixture\n");
  }
  const referenceManifest=JSON.parse(fs.readFileSync(path.join(__dirname,"testdata/bundle/manifest.json"),"utf8")),referenceFiles={};
  for(const file of Object.keys(referenceManifest.files))referenceFiles[file]=fs.readFileSync(path.join(__dirname,"testdata/bundle",file),"utf8");
  const referenceResult={ok:true,runId:referenceManifest.runId,bundle:{manifest:referenceManifest,files:referenceFiles}};
  const referenceFolder=path.join(httpRoot,"data/runs",referenceManifest.runId);fs.mkdirSync(referenceFolder,{recursive:true});
  for (const [name,text] of Object.entries(referenceFiles)) {
    const file=path.join(referenceFolder,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
  }
  fs.writeFileSync(path.join(referenceFolder,"manifest.json"),JSON.stringify(referenceManifest));
  fs.writeFileSync(path.join(referenceFolder,"result.json"),JSON.stringify(referenceResult));fs.writeFileSync(path.join(httpRoot,"data/latest.json"),JSON.stringify({runId:referenceManifest.runId}));fs.writeFileSync(path.join(httpRoot,"data/latest_result.js"),"window.SIM_RESULT="+JSON.stringify(referenceResult)+";");
  const server = spawn("python", ["-c", `import server,http.server,sys,os;server.BASE_DIR=sys.argv[1];server.LEO_DIR=os.path.join(server.BASE_DIR,'settings');server.INI_PATH=os.path.join(server.LEO_DIR,'simulations/Network/scenarios.ini');http.server.ThreadingHTTPServer(('127.0.0.1',${port}),server.SimHandler).serve_forever()`,stored?__dirname:httpRoot], {cwd: __dirname, windowsHide:true, stdio:"ignore"});
  const appUrl = "http://127.0.0.1:"+port+"/";
  const browser = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-extensions", "--disable-background-networking", "--no-first-run", `--remote-debugging-port=${port+1}`, `--user-data-dir=${profile}`, appUrl], {windowsHide:true, stdio:"ignore"});
  let ws;
  try {
    await retry(async () => { const r=await fetch(`http://127.0.0.1:${port}/api/config`); assert(r.ok); });
    const page = await retry(async () => {
      const list = await (await fetch("http://127.0.0.1:"+(port+1)+"/json")).json();
      const page = list.find(p=>p.type==="page"&&p.url===appUrl);
      assert(page);return page;
    });
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=> {ws.onopen=resolve;ws.onerror=reject;});
    let id=0; const pending=new Map(), errors=[],loadFailures=[];
    ws.onmessage = e => {const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id); m.error?p.reject(m.error):p.resolve(m.result);} else if(m.method==="Network.loadingFailed") loadFailures.push(m.params); else if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error(`CDP timeout: ${method}`));},40000);pending.set(key,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:key,method,params}));});
    const evaluate=async expression=> {const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await send("Runtime.enable");await send("Page.enable");await send("Network.enable");
    if(stored)await send("Emulation.setDeviceMetricsOverride",{width:1520,height:900,deviceScaleFactor:1,mobile:false});
    if(stored){
      await retry(async()=>assert(await evaluate("typeof lastSatStates!=='undefined' && lastSatStates.length>0")));
      console.log("Actual stored result: initial map visible before CSV finishes");
      await retry(async()=>assert(await evaluate("typeof resultMeta!=='undefined' && !!resultMeta?.replay")),720);
      const count=await evaluate("routes.length"),expected=Number(stored.split('=')[1]);if(expected)assert.equal(count,expected);
      assert(await evaluate("!performance.getEntriesByType('resource').some(r=>r.name.includes('latest_result.js'))"));
      console.log("Actual stored result loaded:",count,"routes;",await evaluate("[lastSatStates.length,routes.sumsAt?.(routes.length),runStatus.textContent]"));
      const identifier=await evaluate("resultMeta.runId");await evaluate("window.beforeFolderReload=resultMeta");
      const {root}=await send("DOM.getDocument"),{nodeId}=await send("DOM.querySelector",{nodeId:root.nodeId,selector:"#resultFolder"});
      await send("DOM.setFileInputFiles",{nodeId,files:[path.join(__dirname,'data/runs',identifier)]});
      await retry(async()=>assert(await evaluate("resultMeta!==window.beforeFolderReload")),720).catch(async error=>{console.error("Stored folder failure:",await evaluate("({status:runStatus.textContent,request:resultLoadRequest,rows:routes.length})"),errors);throw error;});
      assert.equal(await evaluate("routes.length"),count);assert(await evaluate("lastSatStates.length>0 && stateAt(simTime).links.length>0"));
      assert.equal(errors.length,0,JSON.stringify(errors));
      const screenshot=await send("Page.captureScreenshot",{format:"png"});fs.mkdirSync(path.join(__dirname,'build'),{recursive:true});fs.writeFileSync(path.join(__dirname,'build/map-check.png'),Buffer.from(screenshot.data,'base64'));
      console.log("Actual folder reupload passed without reading duplicate result.json; map screenshot: build/map-check.png");
      await send("Browser.close");return;
    }
    await retry(async()=> assert(await evaluate("typeof resultMeta !== 'undefined' && resultMeta?.replay === true"))).catch(async err=>{console.error('Startup state:',await evaluate("({status:document.getElementById('runStatus')?.textContent,meta:typeof resultMeta,loaded:!!window.SIM_RESULT})"),errors);throw err;});
    await retry(async()=>assert(await evaluate("document.readyState==='complete' && typeof openSettings==='function'"))).catch(async error=>{console.error("Script loading:",await evaluate("({url:location.href,ready:document.readyState,scripts:[...document.scripts].map(s=>s.src),resources:performance.getEntriesByType('resource').map(r=>({url:r.name,bytes:r.transferSize}))})"),errors,loadFailures);throw error;});
    assert.equal(await evaluate("document.getElementById('scenarioDetails').open"),false);
    assert(await evaluate("!byId('iniTable') && !byId('cfgOwnIni')"));
    assert.equal(await evaluate("document.getElementById('scenarioConstellation').textContent"),"132기 · 12개 궤도면");
    assert.equal(await evaluate("document.getElementById('scenarioDuration').textContent"),"600초");
    assert.equal(await evaluate("document.getElementById('scenarioRouting').textContent"),"지연 최소");
    assert.equal(await evaluate("document.getElementById('scenarioTraffic').textContent"),"2s · 1000B");
    await evaluate("document.querySelector('#scenarioDetails summary').click()");
    assert.equal(await evaluate("document.getElementById('scenarioDetails').open"),true);
    assert(await evaluate("byId('btnOpenIni').checkVisibility() && byId('btnRefreshIni').checkVisibility()"));
    assert(await evaluate("byId('srcFilter').getBoundingClientRect().top===byId('dstFilter').getBoundingClientRect().top"));
    await evaluate("document.querySelector('#scenarioDetails summary').click()");
    assert(await evaluate("document.querySelector('.brand-logo').naturalWidth>0 && getComputedStyle(document.querySelector('.brand-logo')).filter==='brightness(0) invert(1)'"));
    console.log("Scenario UI passed: concise conditions, details collapsed by default, file actions available");
    assert.equal(await evaluate("document.getElementById('cfgName').disabled"),false);
    assert(await evaluate("document.getElementById('runnerActions').checkVisibility() && !document.getElementById('btnOpenIni').checkVisibility()"));
    assert.equal(await evaluate("cfgNameSel.selectedOptions[0].textContent"),"기본 통신 · 이동 노드 대상");
    assert.equal(await evaluate("scenarioName('PaperS1MyCustom')"),"PaperS1MyCustom");
    assert.equal(await evaluate("byId('algorithmChoice').value"),"dijkstra-delay");
    assert(await evaluate("cfgNameSel.options.length<12"));
    assert(await evaluate("cfgNameSel.querySelector('option[value=까를로잇테스트]').textContent === '까를로잇테스트'"));
    assert.equal(await evaluate("!!cfgNameSel.querySelector('option[value=LabelFixture]')"),false);
    await evaluate("byId('showAllConfigs').checked=true;byId('showAllConfigs').onchange()");
    assert.equal(await evaluate("cfgNameSel.querySelector('option[value=LabelFixture]').textContent"),"내 설정 시험");
    assert.equal(await evaluate("simTime"),0);
    for(const limit of [0,3,600,1800]) {
      assert.equal(await evaluate(`syncTimeBounds(${limit});Number(byId('timeSlider').max)`),limit);
    }
    assert(await evaluate("syncTimeBounds(600);simTime=600;byId('btnPlay').click();simTime===0 && playing"));
    await evaluate("byId('btnPlay').click()");
    await evaluate("simTime=300.5;render()");
    assert.equal(await evaluate("stateAt(simTime).t"),300.5);
    assert.equal(await evaluate("byId('mapSatellites').textContent"),"132기");
    assert.equal(await evaluate("routes.length"),2671);
    assert(await evaluate("document.querySelector('#routeTable tbody').children.length > 0"));
    await evaluate("byId('showAllConfigs').checked=true;byId('showAllConfigs').onchange();cfgNameSel.value='Dijkstra132Hop';cfgNameSel.onchange()");
    assert.equal(await evaluate("document.getElementById('scenarioRouting').textContent"),"홉 수 최소");
    assert.equal(await evaluate("routes.length"),2671);
    assert.equal(await evaluate("resultMeta.replay"),true);
    assert(await evaluate("parseInt(byId('mapGroundLinks').textContent,10) > 0"));
    assert.equal(await evaluate("resultMeta.config.activeConfig"),"Dijkstra132");
    assert.equal(await evaluate("ORBIT_CFG.metric"),"delay");
    assert(await evaluate("document.getElementById('runStatus').textContent.includes('홉 최소')"));
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await new Promise(r=>setTimeout(r,300));
    assert.equal(await evaluate("lastSatStates.length"),132);
    await evaluate("(async()=>{await openResultBundle((await fetch('/api/result').then(r=>r.json())).bundle);simTime=599.5;render()})()");
    assert.equal(await evaluate("stateAt(simTime).t"),599.5);
    await evaluate("clearResult();routes=parseRoutesCsv("+JSON.stringify(fs.readFileSync(path.join(__dirname,"testdata/bundle/routes.csv"),"utf8"))+");simTime=30;render()");
    assert.equal(await evaluate("states.length"),0);
    assert.equal(await evaluate("routes.length"),2671);
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log("Chrome passed: engine replay, fractional-time sampling, table rendering, scenario selection preserves recorded map, result reload, external CSV without invented geometry");

    await evaluate("(async()=>{applyLoadedConfig(await fetch('/api/config?config=Dijkstra132').then(r=>r.json()));window.beforeAlgorithmResult=resultMeta;window.beforeAlgorithmConfig=structuredClone(selectedConfig);byId('algorithmChoice').value='mcsr-ts';await byId('algorithmChoice').onchange({target:byId('algorithmChoice')});})()");
    assert.equal(await evaluate("selectedConfig.algorithm"),"mcsr-ts");
    assert(await evaluate("resultMeta===beforeAlgorithmResult && selectedConfig.seed===beforeAlgorithmConfig.seed && JSON.stringify(selectedConfig.stations)===JSON.stringify(beforeAlgorithmConfig.stations)"));
    assert.equal(await evaluate("fetch('/api/config?config=Dijkstra132').then(r=>r.json()).then(c=>c.algorithm)"),"mcsr-ts");
    await evaluate("(async()=>{window.algorithmFetch=window.fetch;window.fetch=async()=>new Response(JSON.stringify({error:'save rejected'}),{status:400});byId('algorithmChoice').value='mcsr-hr';await byId('algorithmChoice').onchange({target:byId('algorithmChoice')});window.fetch=window.algorithmFetch;})()");
    assert(await evaluate("byId('algorithmChoice').value==='mcsr-ts' && !byId('algorithmChoice').disabled && runStatus.textContent==='save rejected'"));
    await evaluate("(async()=>{byId('algorithmChoice').value='dijkstra-delay';await byId('algorithmChoice').onchange({target:byId('algorithmChoice')});})()");
    console.log('Simple workflow passed: curated conditions, additional configurations, separate algorithm selection, persisted INI, unchanged traffic/result, save-error rollback');
    await evaluate("cfgNameSel.value='Dijkstra132PairFail';cfgNameSel.dispatchEvent(new Event('change'));void 0");
    await retry(async()=>assert(await evaluate("byId('scenarioMeaning').textContent.includes('60·120·180초') && byId('scenarioMeaning').textContent.includes('30초간')")));
    await evaluate("cfgNameSel.value='Dijkstra132RandomFail';cfgNameSel.dispatchEvent(new Event('change'));void 0");
    await retry(async()=>assert(await evaluate("byId('scenarioMeaning').textContent.includes('장애 20건') && byId('scenarioMeaning').textContent.includes('장애 시드')")));
    await evaluate(`(async()=>{
      await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({configName:'Dijkstra132PairFail',changes:{sendInterval:.08}})});
      openSettings(await fetch('/api/config?config=Dijkstra132PairFail').then(r=>r.json()));
      await byId('settingsDefaults').onclick();
    })()`);
    assert(await evaluate("Number(byId('edit-sendInterval').value)===.02 && byId('settingsDefaultsStatus').textContent.includes('저장해야')"));
    assert.equal(await evaluate("fetch('/api/config?config=Dijkstra132PairFail').then(r=>r.json()).then(c=>c.stations[0].sendInterval)"),.08);
    await evaluate("byId('settingsDialog').close()");
    await evaluate("(async()=>{openSettings(await fetch('/api/config?config=Dijkstra132PairFail').then(r=>r.json()));await byId('settingsDefaults').onclick();byId('settingsForm').requestSubmit(byId('settingsForm').querySelector('[type=submit]'));})()");
    await retry(async()=>assert(await evaluate("!byId('settingsDialog').open")));
    assert.equal(await evaluate("fetch('/api/config?config=Dijkstra132PairFail').then(r=>r.json()).then(c=>c.stations[0].sendInterval)"),.02);
    await evaluate("(async()=>{openSettings(await fetch('/api/config?config=PaperS1Mcsr').then(r=>r.json()))})()");
    assert.equal(await evaluate("document.querySelectorAll('.sender-check').length"),100);
    assert(await evaluate("!byId('settingsSavedSchedules') && !byId('edit-islMode') && !byId('edit-islScheduleFile') && !byId('edit-failureReplay') && !byId('settingsFields').querySelector('input[accept=\".csv\"]')"));
    await evaluate("window.normalSettings=nativeUI.config;openSettings({...normalSettings,islMode:'scheduled',failureReplayEvents:[{}]})");
    assert(await evaluate("byId('settingsSavedSchedules').textContent.includes('개폐 일정') && byId('settingsSavedSchedules').textContent.includes('장애 기록')"));
    await evaluate("openSettings(normalSettings)");
    assert.equal(await evaluate("value('edit-algorithm')"),"mcsr-ls");
    await evaluate("byId('edit-numSatellites').closest('.field-with-help').querySelector('button').click()");
    assert(await evaluate("document.querySelector('.help-popover:popover-open').textContent.includes('전달률')"));
    await evaluate("document.querySelector('.help-popover:popover-open').hidePopover()");

    assert.equal(await evaluate("byId('settingsAdvanced').open"),false);
    assert(await evaluate("byId('settingsAdvanced').contains(byId('edit-controlMtu')) && byId('settingsAdvanced').contains(byId('edit-queueCapacity'))"));
    assert(await evaluate("byId('edit-randomFailures').value=0;updateMcsrControls();byId('edit-randomStart').disabled"));
    assert(await evaluate("byId('edit-hrJitterMs').disabled && byId('edit-tsDelayBoundMs').disabled"));
    await evaluate("byId('edit-algorithm').value='mcsr-hr';updateMcsrControls()");
    assert(await evaluate("!byId('edit-hrJitterMs').disabled && byId('edit-tsDelayBoundMs').disabled"));
    await evaluate("byId('edit-algorithm').value='mcsr-ts';updateMcsrControls()");
    assert(await evaluate("byId('edit-hrJitterMs').disabled && !byId('edit-tsDelayBoundMs').disabled"));
    await evaluate("byId('edit-csibEnabled').checked=false;updateMcsrControls()");
    assert(await evaluate("byId('edit-csibPeriod').disabled && !byId('edit-csibEnabled').disabled"));
    await evaluate("byId('edit-csibEnabled').checked=true;byId('edit-processingMode').value='assumed';updateMcsrControls()");
    assert(await evaluate("!byId('edit-csibPeriod').disabled && !byId('edit-csibComputeDelay').disabled && !byId('settingsModelStatus').hidden"));
    await evaluate("byId('edit-processingMode').value='neutral';updateMcsrControls();byId('edit-processingMode').value='assumed';updateMcsrControls()");
    assert(await evaluate("!byId('edit-csibComputeDelay').disabled"));
    await evaluate("byId('edit-controlMode').value='time';updateMcsrControls()");
    assert(await evaluate("byId('settingsCsib').hidden && byId('edit-csibEnabled').disabled && byId('edit-csibPeriod').disabled && byId('edit-csibComputeDelay').disabled && !byId('edit-csibDetectDelay')"));
    await evaluate("byId('edit-algorithm').value='dijkstra-delay';byId('edit-failureKnowledge').value='propagate';updateMcsrControls()");
    assert(await evaluate("!byId('edit-failureScopeHops').disabled && !byId('edit-srdK').disabled && byId('edit-floodModel').disabled && !byId('edit-spfDelay').disabled"));
    await evaluate("byId('edit-controlMode').value='packet';byId('edit-processingMode').value='neutral';byId('edit-algorithm').value='mcsr-ls';updateMcsrControls()");
    assert(await evaluate("byId('edit-failureScopeHops').disabled && byId('edit-spfDelay').disabled && byId('settingsModelStatus').hidden"));
    await evaluate("byId('edit-bitrate').value=60;byId('edit-bitrate').oninput()");
    assert(Math.abs(await evaluate("Number(value('edit-sendInterval'))")-.000184)<1e-12);
    await evaluate("byId('entry-kind').value='circle';byId('entry-kind').onchange();byId('entry-city').value='서울';byId('entry-city').onchange()");
    assert.equal(await evaluate("Number(value('target-center_lat'))"),37.5665);
    for(const width of [1100,700]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert(await evaluate("byId('settingsDialog').scrollWidth<=byId('settingsDialog').clientWidth"));}
    await evaluate("byId('edit-algorithm').value='dijkstra-delay';updateMcsrControls()");
    assert(await evaluate("byId('edit-csibPeriod').disabled"));
    await evaluate("byId('settingsDialog').close()");

    await evaluate("(async()=>{const cfg=await fetch('/api/config?config=PaperS1Load').then(r=>r.json());openSettings(cfg);byId('edit-hrJitterMs').value='';byId('edit-csibComputeDelay').value='';window.savedRequest=null;window.realFetch=window.fetch;window.fetch=async(url,options)=>{if(url==='/api/config'&&options?.method==='POST'){window.savedRequest=JSON.parse(options.body);return new Response(JSON.stringify(cfg),{status:200});}return realFetch(url,options);};byId('settingsForm').requestSubmit(byId('settingsForm').querySelector('[type=submit]'));})()");
    await retry(async()=>assert(await evaluate("window.savedRequest!==null && !byId('settingsDialog').open")));
    assert(await evaluate("!Object.hasOwn(savedRequest.changes,'destination') && !Object.hasOwn(savedRequest.changes,'sendInterval')"));
    assert(await evaluate("!Object.hasOwn(savedRequest.changes,'hrJitterMs') && !Object.hasOwn(savedRequest.changes,'csibComputeDelay') && !Object.hasOwn(savedRequest.changes,'controlMode')"));
    console.log("Settings passed: algorithm-specific visibility, common SRD, model status, reversible mode changes, hidden and unchanged INI values preserved");
    await evaluate("window.fetch=window.realFetch");

    await evaluate("(async()=>{openSettings(await fetch('/api/config?config=PaperS1McsrCsib').then(r=>r.json()));byId('edit-controlMode').value='time';updateMcsrControls();byId('settingsForm').requestSubmit(byId('settingsForm').querySelector('[type=submit]'));})()");
    await retry(async()=>assert(await evaluate("!byId('settingsDialog').open")));
    assert(await evaluate("fetch('/api/config?config=PaperS1McsrCsib').then(r=>r.json()).then(c=>c.controlMode==='time' && !c.csibEnabled)"));

    const nativeFolder=path.join(profile,'native');fs.mkdirSync(nativeFolder);
    const script="import sys,pathlib,shutil,json; import server,run_manager; b=pathlib.Path(sys.argv[1]); (b/'engine').mkdir();shutil.copy2(pathlib.Path(server.BASE_DIR)/'engine/engine.exe',b/'engine/engine.exe');shutil.copy2(pathlib.Path(server.BASE_DIR)/'replay-model.json',b/'replay-model.json');c=server.read_ini_config('Mcsr132');c['simTimeLimit']=2;[s.update(startTime=0) for s in c['stations']];inputs={p.relative_to(server.LEO_DIR).as_posix():p.read_bytes() for p in pathlib.Path(server.LEO_DIR).rglob('*.ini')};r=run_manager.execute(b,server.LEO_DIR,server.INI_PATH,'Mcsr132',server.read_ini_config,frozen=(c,inputs));(b/'browser-result.json').write_text(json.dumps(r),encoding='utf-8')";
    const run=require('node:child_process').spawnSync('python',['-c',script,nativeFolder],{cwd:__dirname,windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);
    const nativeResult=JSON.parse(fs.readFileSync(path.join(nativeFolder,'browser-result.json'),'utf8'));
    assert.equal(nativeResult.bundle.manifest.displayName, "고부하 통신 · 12번 노드 고정");
    await evaluate(`openResultBundle(${JSON.stringify(nativeResult.bundle)})`);
    assert(await evaluate("!byId('nativeMetrics').hidden && byId('metricValues').children.length===8 && resultMeta.summary.received>0"));
    assert(await evaluate(`(()=>{
      const panel=byId('nativeMetrics'),grid=byId('metricValues');
      const check=(width,columns)=>{
        panel.style.width=width+'px';
        return getComputedStyle(grid).gridTemplateColumns.split(' ').length===columns && grid.scrollWidth===grid.clientWidth;
      };
      const fits=check(410,4)&&check(300,2);
      panel.style.width='';
      return fits;
    })()`));

    assert(await evaluate("!byId('metricDetails').open && byId('btnMetricDetails').checkVisibility()"));
    await evaluate("byId('btnMetricDetails').click()");
    assert(await evaluate("byId('metricDetails').open && byId('metricDetailContent').contains(byId('researchMetrics'))"));
    await evaluate("byId('metricDetails').close()");
    assert(await evaluate("resultMeta.summary.metricVersion===4 && !!byId('researchMetrics')"));
    await evaluate("byId('metricSeries').value='controlBytes';drawMetrics()");
    const nativeJson=JSON.stringify(nativeResult);
    await evaluate(`window.batchResult=${nativeJson};window.batchFetch=window.fetch;window.batchBody=null;window.fetch=async(url,options)=>{if(url==='/api/experiments'){window.batchBody=JSON.parse(options.body);return new Response(JSON.stringify({runId:'browser-experiment'}),{status:202});}if(url==='/api/run/browser-experiment')return new Response(JSON.stringify({status:'completed',completedRuns:[{runId:batchResult.runId},{runId:batchResult.runId}],result:{runs:[]}}));if(String(url).startsWith('/api/result?runId='))return new Response(JSON.stringify(batchResult));return batchFetch(url,options);};byId('btnExperiment').click();`);
    await retry(async()=>assert(await evaluate("byId('experimentDialog').open")));
    assert.equal(await evaluate("document.querySelectorAll('.experiment-algorithm').length"),5);
    await evaluate("[...document.querySelectorAll('.experiment-algorithm')].forEach((e,i)=>e.checked=i<2);byId('experimentRepetitions').value='10';byId('experimentSeed').value=7;byId('experimentWarmup').value=.1;byId('experimentDrain').value=.2;byId('experimentForm').requestSubmit(byId('experimentForm').querySelector('[type=submit]'))");
    await retry(async()=>assert(await evaluate("window.batchBody?.algorithms.length===2 && byId('compareDialog').open")));
    await evaluate("byId('compareDialog').close();window.fetch=window.batchFetch");
    assert(await evaluate("batchBody.research.repetitions===10 && batchBody.research.seedStart===7 && batchBody.research.warmupSeconds===.1"));
    await evaluate("showExperimentStatistics({schema:2,stage:'pilot',seeds:[1,2],completedRuns:4,inputVariability:{trafficProfiles:2,physicalEventProfiles:1},comparisons:[{inputClassification:'distinct-inputs',intervalAvailable:true,uniqueInputs:2,seedsUsingLinkRandomness:0,baseline:'dijkstra-delay',algorithm:'mcsr-ls',metrics:[{name:'deliveryRate',statistics:{meanDifference:2,ci95:[1,3]},observedPairs:2},{name:'meanDelayMs',statistics:null,observedPairs:1}]}]})");
    assert(await evaluate("byId('singleComparisonControls').hidden && byId('comparisonStatus').textContent.includes('예비 시험') && byId('comparisonContent').textContent.includes('1 ~ 3') && byId('comparisonContent').textContent.includes('관측 부족')"));
    await evaluate("showExperimentStatistics({schema:2,stage:'pilot',seeds:[1,2],completedRuns:4,comparisons:[{inputClassification:'fixed-input',intervalAvailable:false,uniqueInputs:1,seedsUsingLinkRandomness:0,baseline:'dijkstra-delay',algorithm:'mcsr-ls',metrics:[{name:'deliveryRate',observedPairs:2,statistics:{meanDifference:0,ci95:[0,0]}}]}]})");
    assert(await evaluate("byId('comparisonContent').textContent.includes('고정 입력 반복') && !byId('comparisonContent').textContent.includes('신뢰구간')"));
    assert(await evaluate("validationLabels({scope:['fixed-graph-core','reference-core','analytic-packet-kernel','integration'],workloads:[{scope:'long-packet-control',satellites:132,simSeconds:600}]}).join(' ').includes('대규모 부하 기록 없음 장시간 제어 통과 (132위성 · 600초)')"));
    for(const width of [1520,1100,700]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert(await evaluate("byId('compareDialog').scrollWidth<=byId('compareDialog').clientWidth"));}
    await evaluate("byId('compareDialog').close()");


    await evaluate("showComparison(resultMeta,resultMeta)");
    assert(await evaluate("!byId('singleComparisonControls').hidden"));
    assert(await evaluate("byId('comparisonStatus').textContent.includes('동일한 환경')"));
    assert.equal(await evaluate("lastSatStates.length"),132);
    await evaluate("(async()=>{await openResultBundle((await fetch('/api/result').then(r=>r.json())).bundle)})()");
    assert(await evaluate("byId('nativeMetrics').hidden === !resultMeta.summary"));
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log('Native UI passed: 100-node settings, rate/interval coupling, region editor, responsive dialog, MCSR controls, v4 replay, offered-load metrics, control chart, experiment runner and comparison');

    await send("Emulation.setDeviceMetricsOverride",{width:1520,height:900,deviceScaleFactor:1,mobile:false});
    const divider=await evaluate("(()=>{const r=byId('panelDivider').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+30,width:byId('sidePanel').offsetWidth};})()");
    await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",buttons:1,clickCount:1,x:divider.x,y:divider.y});
    await send("Input.dispatchMouseEvent",{type:"mouseMoved",button:"left",buttons:1,x:divider.x-120,y:divider.y});
    await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",buttons:0,clickCount:1,x:divider.x-120,y:divider.y});
    assert((await evaluate("byId('sidePanel').offsetWidth"))>divider.width+100);
    const mainWidth=await evaluate("canvas.getBoundingClientRect().width");
    await evaluate("simTime=25;selectedRouteId=7;byId('btnMapFocus').click()");
    assert(await evaluate("byId('sidePanel').hidden && !byId('mapTime').checkVisibility() && simTime===25 && selectedRouteId===7 && byId('btnMapFocus').getAttribute('aria-expanded')==='false'"));
    assert((await evaluate("canvas.getBoundingClientRect().width"))>mainWidth);
    await evaluate("byId('btnMapFocus').click();byId('speedSel').value='custom';byId('speedSel').onchange();byId('speedInput').value='0.00001';byId('speedInput').onchange();playing=true;lastFrame=1000;const savedFrame=requestAnimationFrame;window.requestAnimationFrame=()=>{};loop(2000);window.requestAnimationFrame=savedFrame;playing=false");
    assert(await evaluate("!byId('sidePanel').hidden && byId('sidePanel').offsetWidth>570 && Math.abs(simTime-25.00001)<1e-8 && byId('timeLabel').textContent.includes('25.00001')"));
    await evaluate("byId('speedInput').value='0';byId('speedInput').onchange()");
    assert(await evaluate("speed===0.00001 && !byId('speedError').hidden"));
    await evaluate("byId('speedSel').value='10';byId('speedSel').onchange()");
    fs.cpSync(path.join(__dirname,"testdata/bundle"),referenceFolder,{recursive:true});
    await evaluate("byId('btnOpenResult').click()");
    await retry(async()=>assert(await evaluate("byId('resultDialog').open && byId('savedRuns').options[0]?.textContent.includes('기본 통신')")));
    await evaluate("byId('resultSearch').value='missing-result-xyz';byId('resultSearch').oninput()");
    assert(await evaluate("byId('btnReplayResult').disabled && byId('savedRuns').length===0"));
    await evaluate("byId('resultSearch').value='기본 통신';byId('resultSearch').oninput();byId('btnReplayResult').click()");
    await retry(async()=>assert(await evaluate("!byId('resultDialog').open && resultMeta.replay && runStatus.textContent.includes('실행 결과를 불러왔습니다')")));
    await evaluate("window.runFetch=window.fetch;window.stopRequested=false;window.fetch=async(url,options)=>{if(url==='/api/run')return Response.json({runId:'ui-test'},{status:202});if(url==='/api/run/ui-test/cancel'){window.stopRequested=true;return Response.json({status:'stopping'});}if(url==='/api/run/ui-test' && (window.pollMisses=(window.pollMisses||0)+1)<=3)throw Error('offline');if(url==='/api/run/ui-test')return Response.json(stopRequested?{status:'cancelled'}:{status:'running',progress:{progress:.25,time:15,limit:60,received:7},totalRuns:1});return runFetch(url,options);};byId('btnRunSim').click();byId('btnMapFocus').click()");
    assert(await evaluate("byId('runActivity').checkVisibility() && byId('runActivity').classList.contains('running') && byId('runActivityText').textContent.includes('준비')"));
    await retry(async()=>assert(await evaluate("!byId('btnRetryStatus').hidden && activeJob==='ui-test'")));
    await evaluate("byId('btnRetryStatus').click()");
    await retry(async()=>assert(await evaluate("byId('runProgress').value===.25 && byId('runActivityDetail').textContent.includes('25%')")));
    await evaluate("byId('btnStopSim').click()");
    await retry(async()=>assert(await evaluate("!byId('runActivity').classList.contains('running') && byId('runActivityText').textContent.includes('중지했습니다')")));
    await evaluate("byId('btnMapFocus').click();window.fetch=window.runFetch");
    await evaluate(`window.submits=0;window.loads=0;window.fetch=async(url,opts)=>{
      if(url==='/api/run'){submits++;return Response.json({runId:'retry-result'});}
      if(url==='/api/run/retry-result')return Response.json({status:'completed',runId:'retry-result'});
      if(String(url).includes('runId=retry-result'))return loads++===0?new Response(null,{status:503}):runFetch('/api/result?metadata=1');
      return runFetch(url,opts);
    };byId('btnRunSim').click()`);
    await retry(async()=>assert(await evaluate("!byId('btnRetryResult').hidden && runStatus.textContent.includes('계산 완료')")));
    await evaluate("byId('btnRetryResult').click()");
    await retry(async()=>assert(await evaluate("submits===1 && loads===2 && runStatus.textContent==='계산 완료'")));
    await evaluate("window.fetch=runFetch");
    console.log("Map focus, 0.00001x playback, result catalog and visible progress/cancel passed");

    const offline = path.join(profile, "offline");
    fs.mkdirSync(path.join(offline, "data"), {recursive:true});
    fs.mkdirSync(path.join(offline,"manual/assets"),{recursive:true});
    for (const file of ["index.html", "app.js","editor.js", "orbit.js", "csv.js", "bundle.js", "style.css", "sim-ui.ico", "data/latest_result.js", "data/earth.png",brandAsset])
      fs.copyFileSync(path.join(httpRoot,file),path.join(offline,file));
    await send("Page.navigate", {url: require("node:url").pathToFileURL(path.join(offline, "index.html")).href});
    await retry(async()=> assert(await evaluate("location.protocol === 'file:' && typeof resultMeta !== 'undefined' && resultMeta?.replay === true")));
    assert(await evaluate("document.querySelector('.brand-logo').naturalWidth>0 && getComputedStyle(document.querySelector('.brand-logo')).filter==='brightness(0) invert(1)'"));
    assert.equal(await evaluate("document.getElementById('cfgName').checkVisibility()"),false);
    assert.equal(await evaluate("document.getElementById('runnerActions').checkVisibility()"),false);
    assert(await evaluate("(()=>{let picked=false;byId('resultFolder').click=()=>{picked=true;};byId('btnOpenResult').click();delete byId('resultFolder').click;return picked&&!byId('resultDialog').open;})()"));
    assert.equal(await evaluate("document.getElementById('savedConfigName').textContent"),referenceManifest.configName);
    assert.equal(await evaluate("document.getElementById('btnOpenIni').checkVisibility()"),false);
    await evaluate("document.getElementById('btnOpenIni').click()");
    assert(await evaluate("document.getElementById('runStatus').textContent.includes('start_ui.bat')"));
    assert.equal(await evaluate("lastSatStates.length"), 132);
    assert(await evaluate("document.querySelector('#routeTable tbody').children.length > 0"));
    assert(await evaluate("stateAt(simTime).links.length > 0"));
    const validBundle = path.join(profile,"result-package");
    fs.cpSync(path.join(__dirname,"testdata/bundle"),validBundle,{recursive:true});
    const selectFolder = async folder => {
      const {root}=await send("DOM.getDocument");
      const {nodeId}=await send("DOM.querySelector",{nodeId:root.nodeId,selector:"#resultFolder"});
      await send("DOM.setFileInputFiles",{nodeId,files:[folder]});
    };
    await selectFolder(validBundle);
    await retry(async()=>assert(await evaluate("resultMeta?.runId==='reference-dijkstra'")));
    assert.equal(await evaluate("lastSatStates.length"),132);
    assert.equal(await evaluate("document.getElementById('mapTraffic') || document.getElementById('mapMeasured')"),null);
    assert.equal(await evaluate("document.getElementById('mapSatellites').textContent"),"132기");
    assert.equal(await evaluate("document.getElementById('mapIsl').textContent"),"264개");
    assert(await evaluate("document.getElementById('mapGroundLinks').textContent.endsWith('개')"));
    const broken=path.join(profile,"broken-package");fs.cpSync(validBundle,broken,{recursive:true});
    fs.appendFileSync(path.join(broken,"routes.csv"),"modified");
    await selectFolder(broken);
    await retry(async()=>assert(await evaluate("document.getElementById('runStatus').textContent.includes('기존 화면을 유지')")));
    assert.equal(await evaluate("resultMeta.runId"),"reference-dijkstra");
    assert.equal(await evaluate("lastSatStates.length"),132);
    fs.copyFileSync(path.join(validBundle,"routes.csv"),path.join(broken,"routes.csv"));
    fs.unlinkSync(path.join(broken,"config/simulations/Dijkstra132/stations/EsaDsn-Mobiles.ini"));
    await selectFolder(broken);
    await retry(async()=>assert(await evaluate("document.getElementById('runStatus').textContent.includes('Missing/invalid result file')")));
    assert.equal(await evaluate("resultMeta.runId"),"reference-dijkstra");
    console.log("Result folder passed: real directory input, CSV/INI replay, checksums and missing-file rejection retain previous map");
    assert(await evaluate("!byId('csvInput') && routes.length===2671 && lastSatStates.length===132"));
    const point = await evaluate("(()=>{const st=lastStationStates[0],r=canvas.getBoundingClientRect(),scale=Math.min(r.width/W,r.height/H);return {x:r.left+(r.width-W*scale)/2+lonToX(st.lon)*scale,y:r.top+(r.height-H*scale)/2+latToY(st.lat)*scale};})()");
    await send("Input.dispatchMouseEvent", {type:"mouseMoved", x:point.x, y:point.y});
    assert(await evaluate("!document.getElementById('tooltip').hidden && document.getElementById('tooltip').textContent.includes(lastStationStates[0].name)"));
    for (const width of [1520, 1100, 700]) {
      await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
      assert(await evaluate("(()=>{const a=document.querySelector('.map-summary').getBoundingClientRect(),b=canvas.getBoundingClientRect();return a.bottom<=b.top+1 && document.documentElement.scrollWidth<=innerWidth;})()"));
    }
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log("Layout passed: status outside map, no horizontal overflow at 1520, 1100 and 700px");
    console.log("Offline Chrome passed: direct HTML loads actual satellites, links, recent routes and mouse hover details");
    await send("Browser.close").catch(()=>{});
  } finally {
    if(ws){try{ws.send(JSON.stringify({id:999999,method:"Browser.close"}));}catch{}ws.close();}server.kill();browser.kill();
    // shortcut: Chrome may retain profile files briefly; keep temporary profile if Windows holds a lock.
    try {fs.rmSync(profile,{recursive:true,force:true});} catch {}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
