// SPDX-License-Identifier: GPL-3.0-only
// Native controls use the server's applied-setting contract; INI remains the source.
const nativeUI={config:null,scenario:{schema:1,method:"environment",entries:[]},entryIndex:-1,drawing:null,baseline:null};
const byId=id=>document.getElementById(id);
function node(tag,attrs={},text){const e=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k in e)e[k]=v;else e.setAttribute(k,v);}if(text!==undefined)e.textContent=text;return e;}
const settingHelp={
  experimentRepetitions:"같은 조건에서 알고리즘별 실행을 시드 수만큼 반복합니다. 선택한 알고리즘 수와 곱하면 전체 실행 횟수입니다.",
  experimentSeed:"첫 반복에 사용할 시드입니다. 다음 반복은 시드를 하나씩 증가시킵니다.",
  experimentWarmup:"초기 상태가 자리 잡도록 기다리는 시간입니다. 이 구간에서 생성된 패킷은 측정 집계에서 제외합니다.",
  experimentDrain:"새 송신을 멈춘 뒤 이미 발생한 패킷이 도착할 시간을 확보합니다.",
  numSatellites:"위성이 많아지면 접속 가능한 위성과 우회 후보가 달라집니다. 전달률과 계산 시간의 변화를 확인하세요.",
  planes:"위성을 나누어 배치할 궤도면 수입니다. 위성 수는 궤도면 수로 나누어 떨어져야 합니다.",
  altitude:"궤도 높이입니다. 높이면 보이는 범위와 전파 이동 거리가 함께 달라집니다.",
  inclination:"궤도면과 적도 사이의 각도입니다. 지역별 위성 접속 기회가 달라집니다.",
  simTimeLimit:"시뮬레이션의 종료 시각입니다. 장애가 발생한 뒤 복구까지 관측할 시간을 확보하세요.",
  seed:"무작위 송신 시작, 목적지, 링크 손실·지터에 쓰이는 시드입니다. 같은 조건과 시드로 재현할 수 있습니다.",
  destination:"선택한 송신 노드에서 보낼 목적지입니다. 무작위를 선택하면 대상 유형에 맞는 노드 중에서 선택합니다.",
  packetSize:"한 번에 보내는 데이터 크기입니다. 크기가 커지면 전송 시간이 길어지며 현재 송신률을 기준으로 간격도 조정됩니다.",
  bitrate:"송신 노드 하나가 초당 발생시키는 데이터량입니다. 수신 화면의 실제 처리량과 비교하세요.",
  sendInterval:"연속 송신 사이의 시간입니다. 줄이면 초당 패킷 수와 큐 부하가 늘어납니다.",
  startTime:"송신을 시작할 시각입니다. 빈값은 INI에 정의된 기존 방식이나 범위를 유지합니다.",
  endTime:"새 패킷을 만들지 않는 시각입니다. 실행 시간보다 이르게 두면 남은 패킷이 도착하는 동안 관측할 수 있습니다.",
  islDatarate:"위성 간 링크의 전송 용량입니다. 줄이면 정체 시 대기·폐기가 늘어날 수 있습니다.",
  groundlinkDatarate:"지상과 위성 사이의 전송 용량입니다. 송신률을 높일 때 지상 링크가 병목이 되는지 확인하세요.",
  minimumElevation:"지상에서 위성이 이 각도 이상 보여야 연결됩니다. 값을 높이면 접속 기회가 줄어들 수 있습니다.",
  queueCapacity:"링크에서 대기할 수 있는 패킷 수입니다. 상한에 도달하면 새 패킷을 폐기하며, 0은 무제한입니다.",
  updateInterval:"위치와 연결을 다시 계산하는 간격입니다. 줄이면 연결 변화를 더 촘촘히 반영하고 계산량이 늘어날 수 있습니다.",
  failureSchedule:"예를 들어 route@60+30은 60초에 기준 경로의 링크를 30초간 끊습니다. 12-13@60+30처럼 링크를 직접 지정할 수도 있습니다.",
  failureKnowledge:"시간 모델에서 장애 정보를 즉시 반영하거나 감지·전파 시간이 흐른 뒤 반영합니다.",
  randomFailures:"지정 구간에서 생성할 무작위 링크 장애의 수입니다. 0이면 생성하지 않습니다.",
  randomStart:"무작위 장애가 처음 발생할 수 있는 시각입니다.",
  randomEnd:"무작위 장애를 발생시킬 구간의 마지막 시각입니다.",
  randomDuration:"각 무작위 장애의 지속 시간입니다. 0이면 자동으로 복구하지 않습니다.",
  failureSeed:"무작위 장애의 링크와 시각을 정하는 시드입니다. 알고리즘을 비교할 때 같은 시드를 사용하세요.",
  congestionMode:"실제 큐는 송신 트래픽으로 생긴 정체를 측정합니다. 환경 효과 주입은 지정한 구역과 링크에 추가 혼잡을 적용합니다.",
  congestionRefresh:"환경 효과의 적용 대상을 다시 확인하는 간격입니다. 이동하는 위성과 지리 구역을 비교할 때 사용합니다.",
  congestionBuffer:"환경 혼잡 계산에 쓰는 가정 큐 크기입니다. 실제 패킷 큐 용량은 링크 설정에서 바꿉니다.",
  congestionPacketBytes:"환경 혼잡 계산에서 가정하는 패킷 크기입니다.",
  congestionZones:"INI에 정의된 기존 혼잡 구역 표현입니다. 새 구역은 아래 조건 편집기에서 지정할 수 있습니다.",
  congestionAware:"Dijkstra가 환경에서 주입한 추가 지연을 비용에 포함할지 정합니다.",
  labelCap:"노드당 탐색 후보 수 상한입니다. 줄이면 계산 비용을 줄이는 대신 일부 경로 후보가 제외될 수 있습니다.",
  routingQueueCapacity:"시간 모델에서 가용 버퍼를 비용으로 환산할 때 쓰는 기준입니다.",
  hrJitterMs:"MCSR-HR의 지터 제약입니다. 낮추면 조건을 만족하는 후보가 줄어들 수 있습니다.",
  tsDelayBoundMs:"MCSR-TS의 지연 제한입니다. -1은 제한을 두지 않습니다.",
  jitterSource:"패킷 도착에서 측정한 변동과 궤도 변화로 인한 전파 지연 변동 중 하나를 비용에 사용합니다.",
  jitterWindow:"오래된 지터 관측값을 비용 계산에서 제외하기까지의 시간입니다.",
  refreshInterval:"MCSR 상태를 다시 계산하는 주기입니다. 0이면 별도의 시간 주기를 두지 않습니다.",
  reserveDelay:"가정 모델에서 예비 경로 전환에 부과하는 시간입니다.",
  repairDelay:"가정 모델에서 MCSR 경로 재계산에 부과하는 시간입니다.",
  failureScopeHops:"시간 모델에서 장애 정보가 전달될 최대 홉 수입니다. 0은 홉 수 제한이 없습니다.",
  flowTimeout:"패킷에 기록된 경로를 유지하는 시간입니다. 지나면 경로를 다시 확인합니다.",
  reservedPaths:"장애 시 보관된 예비 경로를 시도합니다. 새 경로 계산 횟수와 첫 수신 복구를 비교하세요.",
  snapshotOnDelayUpdate:"전파 지연이 바뀔 때 MCSR 상태를 다시 계산합니다. 경로 변화와 계산량에 영향을 줍니다.",
  csibEnabled:"MCSR에서 지역 대표가 링크 상태를 수집하고 배포하는 방식을 사용합니다. 제어 전송량과 정보 수렴을 비교하세요.",
  csibVote:"지역 대표를 정할 때 투표를 사용합니다.",
  csibPeriod:"지역 상태를 수집하고 배포하는 주기입니다. 줄이면 정보를 더 자주 갱신합니다.",
  csibMonitorInterval:"시간 모델에서 상태 변화를 추가로 확인하는 주기입니다. 0이면 추가 감시를 끕니다.",
  csibComputeDelay:"가정 모델에서 CSIB 계산에 걸리는 시간입니다.",
  csibReportProcDelay:"가정 모델에서 상태 보고를 처리하는 시간입니다.",
  csibHopProcDelay:"가정 모델에서 CSIB를 다음 홉으로 전달할 때 부과하는 처리 시간입니다.",
  csibMessageBytes:"CSIB 메시지에 가정하는 최소 크기입니다. 0이면 내용을 기준으로 자동 계산합니다.",
  slsInterval:"이웃 위성의 상태를 확인하는 간격입니다. 짧게 하면 감지가 빨라질 수 있고 제어 전송이 늘어납니다.",
  slsMissCount:"링크 장애로 판단하기까지 상태 메시지를 연속해서 놓친 횟수입니다.",
  floodHopDelay:"장애 정보가 한 홉을 지나갈 때 부과하는 가정 지연입니다.",
  spfDelay:"가정 모델에서 Dijkstra 경로 재계산에 부과하는 시간입니다.",
  srdK:"SRD를 나눌 때 궤도면 방향 크기입니다. 0이면 자동으로 정합니다.",
  srdL:"SRD를 나눌 때 같은 궤도면 안의 위성 방향 크기입니다. 0이면 자동으로 정합니다.",
  processingMode:"가정값 적용을 선택하면 지정한 경로 전환·제어 처리 지연이 반영됩니다.",
  controlMode:"실제 패킷은 제어 메시지의 전송·큐잉·손실을 계산합니다. 시간 가정은 설정된 지연으로 정보를 전달하고 CSIB를 사용하지 않습니다.",
  jitterModel:"실제 지연 변동은 패킷 도착에도 영향을 줍니다. 라우팅 비용 주입은 경로 평가에 반영합니다.",
  floodModel:"MCSR의 기준 경로 계산 방식을 선택합니다. 방식을 바꾸면 탐색 비용이나 경로 후보가 달라질 수 있습니다.",
  controlRefresh:"제어 상태를 다시 읽는 주기입니다. 짧게 하면 정보가 자주 갱신되고 전송이 늘 수 있습니다.",
  controlTimeout:"지역 대표가 상태 보고를 기다리는 시간입니다.",
  controlHeaderBytes:"제어 메시지 헤더에 가정하는 크기입니다. 제어 전송량에 반영합니다.",
  controlRecordBytes:"링크 상태 레코드 하나의 크기입니다. 제어 전송량과 분할 횟수에 영향을 줍니다.",
  controlMtu:"제어 프레임 하나의 최대 크기입니다. 작게 하면 같은 메시지가 더 많은 프레임으로 분할될 수 있습니다.",
  controlReassemblyTimeout:"분할된 제어 메시지의 나머지 프레임을 기다리는 시간입니다.",
  controlResyncInterval:"누락된 제어 상태를 다시 맞추는 주기입니다.",
  routeRecording:"변경된 경로만 저장하면 CSV 크기를 줄일 수 있습니다. 모든 경로 모드는 각 계획 결과를 기록합니다.",
  packetTrace:"개별 패킷의 상세 기록을 저장합니다. 장애 원인 추적에 쓸 수 있고 결과 크기가 커집니다.",
  "entry-kind":"혼잡이나 장애를 적용할 대상의 종류입니다. 링크, 위성, 경로 구간 또는 지리 범위를 지정할 수 있습니다.",
  "entry-start":"이 조건을 적용하기 시작하는 시각입니다.",
  "entry-end":"이 조건을 해제하는 시각입니다. 빈값은 실행이 끝날 때까지 적용합니다.",
  "entry-ramp":"설정한 혼잡 강도까지 효과를 점진적으로 높이는 시간입니다.",
  "entry-rho":"환경 혼잡 강도입니다. 선택한 용량·버퍼·큐 효과에 사용합니다.",
  "entry-fail":"선택한 연결을 조건 적용 구간 동안 끊습니다.",
  "entry-use_capacity":"혼잡 강도에 따라 링크에서 사용 가능한 전송 용량을 줄입니다.",
  "entry-use_buffer":"혼잡 강도에 따라 라우팅 비용에 들어가는 가용 버퍼를 줄입니다.",
  "entry-use_queue":"모형에서 계산한 큐잉 지연을 추가합니다.",
  "penalty-delay_ms":"지정한 링크에 추가할 지연입니다.",
  "penalty-jitter_ms":"지정한 링크에 추가할 지연 변동입니다.",
  "penalty-loss_pct":"지정한 링크에서 패킷이 손실될 확률입니다.",
  "target-direction":"효과를 양방향 또는 지정한 전달 방향에 적용합니다.",
  "target-link_rule":"링크 양 끝 중 몇 개가 대상에 포함돼야 효과를 적용할지 정합니다."
};
let helpSequence=0;
function helpWidget(label,description){
  const id=`help-${++helpSequence}`;
  const button=node("button",{type:"button",class:"help-icon",title:description,"aria-label":label+" 도움말","aria-controls":id,"aria-expanded":"false"},"ⓘ");
  const panel=node("div",{id,class:"help-popover",popover:"auto"},description);
  button.onclick=()=>{
    if(panel.matches(":popover-open")){panel.hidePopover();return;}
    panel.showPopover();
    const anchor=button.getBoundingClientRect(),size=panel.getBoundingClientRect();
    panel.style.left=Math.max(8,Math.min(anchor.left,innerWidth-size.width-8))+"px";
    panel.style.top=(anchor.bottom+size.height+12<=innerHeight?anchor.bottom+6:Math.max(8,anchor.top-size.height-6))+"px";
  };
  panel.addEventListener("toggle",e=>button.setAttribute("aria-expanded",String(e.newState==="open")));
  const widget=node("span",{class:"help-widget"});widget.append(button,panel);return widget;
}
function attachSettingHelp(container){
  for(const input of container.querySelectorAll("input[id],select[id]")){
    const label=input.closest("label");
    const description=settingHelp[input.id.replace(/^edit-/,"")]||(
      input.id.startsWith("target-")?"효과를 적용할 대상 범위의 값입니다. 범위를 좁히면 지정한 위성이나 링크만 변경됩니다.":"");
    if(!description||!label||label.parentElement.classList.contains("field-with-help"))continue;
    const wrap=node("div",{class:"field-with-help"});
    const title=(label.querySelector(":scope > span")?.textContent||label.textContent).trim();
    label.before(wrap);wrap.append(label,helpWidget(title,description));
  }
}
for(const [id,label,description] of [
  ["scenarioHeading","시험 조건","기본 통신·부하·장애 시나리오로 시험 환경을 고릅니다. 알고리즘은 별도 목록에서 선택합니다. 조건 수정의 기본값은 선택한 구성의 제공 설정을 불러옵니다."],
  ["mapSample","지도 재생","위성이나 연결에 마우스를 올리면 상세 정보를 볼 수 있습니다. 재생 막대로 시각을 이동하고, 참고 지도인지 실행 결과인지 상태 문구에서 확인하세요."],
  ["btnOpenResult","실행 결과 열기","보관 목록에서 결과를 찾거나 manifest.json이 들어 있는 외부 결과 폴더를 선택합니다."],
  ["btnCompare","실행 비교","완료된 두 실행이나 반복 실험 이력을 비교합니다. 같은 조건에서 새 알고리즘을 시험하려면 위쪽의 비교 실행을 사용하세요."],
  ["experimentConditions","반복 비교","선택한 알고리즘을 같은 시드와 순서별 공통 입력으로 실행합니다. 고정 입력의 반복은 환경 변화에 대한 신뢰구간을 표시하지 않습니다."]
]){
  byId(id).after(helpWidget(label,description));
}
attachSettingHelp(byId("experimentDialog"));
function control(label,id,value,type="number",options={}){
  const wrap=node("label",{class:"editor-field"});wrap.append(node("span",{},label));let e;
  if(type==="select"){e=node("select",{id});for(const [key,title]of Object.entries(options))e.add(new Option(title,key));e.value=String(value);}
  else e=node("input",{id,type,value:value??"",step:"any",...options});
  wrap.append(e);return wrap;
}
function group(title,open=false){const e=node("details",{class:"editor-group",open});e.append(node("summary",{},title));const content=node("div",{class:"editor-grid"});e.append(content);return [e,content];}
function value(id){return byId(id)?.value;}
function numeric(id){const v=Number(value(id));if(!Number.isFinite(v)||value(id)==="")throw Error("입력값을 확인하세요.");return v;}
function modeChanged(){const mode=value("edit-congestionMode");byId("scenarioModeText").textContent=mode==="actual"?"실제 송신과 큐의 대기·폐기를 기록합니다.":"외부 혼잡 효과를 링크 상태에 반영합니다.";}
function updateMcsrControls(){
  const algorithm=value("edit-algorithm"),mcsr=algorithm.startsWith("mcsr-"),packet=value("edit-controlMode")==="packet",assumed=value("edit-processingMode")==="assumed",csib=mcsr&&packet&&byId("edit-csibEnabled").checked,environment=value("edit-congestionMode")==="environment";
  for(const group of document.querySelectorAll("[data-mcsr]"))group.hidden=!mcsr;
  const checkbox=byId("edit-csibEnabled");
  byId("settingsCsib").hidden=!packet||(!mcsr&&!checkbox.checked);
  const conditions={
    hrJitterMs:algorithm==="mcsr-hr",tsDelayBoundMs:algorithm==="mcsr-ts",jitterWindow:mcsr,jitterSource:mcsr,
    csibVote:csib,csibPeriod:csib,csibMonitorInterval:csib,csibMessageBytes:csib,
    csibComputeDelay:csib&&assumed,csibReportProcDelay:csib&&assumed&&packet,csibHopProcDelay:csib&&assumed&&packet,
    reserveDelay:mcsr&&assumed,repairDelay:mcsr&&assumed,spfDelay:!mcsr&&assumed,floodHopDelay:assumed||!packet,
    failureKnowledge:!packet,failureScopeHops:!packet&&value("edit-failureKnowledge")==="propagate",
    routingQueueCapacity:mcsr&&!packet&&Number(value("edit-queueCapacity"))===0,
    randomStart:Number(value("edit-randomFailures"))>0,randomEnd:Number(value("edit-randomFailures"))>0,randomDuration:Number(value("edit-randomFailures"))>0,
    controlRefresh:packet,controlTimeout:csib,controlHeaderBytes:packet,controlRecordBytes:packet,controlMtu:packet,controlReassemblyTimeout:packet,controlResyncInterval:packet,
    congestionRefresh:environment,congestionBuffer:environment,congestionPacketBytes:environment,congestionZones:environment,congestionAware:environment&&!mcsr
  };
  for(const [key,enabled]of Object.entries(conditions)){const input=byId("edit-"+key);if(input)input.closest("label").hidden=!enabled;}
  for(const input of byId("settingsFields").querySelectorAll("[id^='edit-']"))input.disabled=!!input.closest("[hidden]");
  const alternatives=[value("edit-processingMode")==="assumed"&&"처리 지연 가정",!packet&&"시간 기반 제어",value("edit-jitterModel")==="cost"&&"비용 기반 지터"].filter(Boolean);
  byId("settingsModelStatus").textContent=alternatives.length?"모델 검증 · "+alternatives.join(" · "):"";
  byId("settingsModelStatus").hidden=!alternatives.length;
}
function openSettings(cfg,resetDefaults=false){
  nativeUI.resetDefaults=resetDefaults;
  byId("settingsDefaultsStatus").textContent=resetDefaults?"기본값 미리 보기 · 저장해야 적용됩니다.":"";

  nativeUI.config=cfg;nativeUI.scenario=structuredClone(cfg.scenario||{schema:1,method:"environment",entries:[]});nativeUI.entryIndex=-1;
  const container=byId("settingsFields");container.replaceChildren();byId("settingsError").textContent="";
  const savedSchedules=[
    cfg.islMode==="scheduled" && "저장된 위성 간 링크 개폐 일정 적용 중",
    cfg.failureReplayEvents?.length && "저장된 장애 기록 적용 중"
  ].filter(Boolean);
  if(savedSchedules.length)container.append(node("p",{id:"settingsSavedSchedules",class:"model-status"},savedSchedules.join(" · ")));
  const [basic,grid]=group("기본 설정",true);container.append(basic);
  grid.append(control("알고리즘","edit-algorithm",cfg.algorithm,"select",cfg.capabilities.algorithms));
  byId("edit-algorithm").closest("label").hidden=true;
  const basicKeys=["numSatellites","planes","altitude","inclination","simTimeLimit","seed"];
  const addField=(grid,f)=>grid.append(control(f.label,"edit-"+f.key,cfg[f.key],"number",{min:f.min,max:f.max,step:f.type==="int"?"1":"any"}));
  for(const f of cfg.capabilities.fields.filter(f=>basicKeys.includes(f.key)))addField(grid,f);
  const [models,mg]=group("모델 검증");container.append(models);
  for(const [key,label,choices]of [["processingMode","처리 지연",{neutral:"추가 지연 없음",assumed:"가정값 적용"}],["controlMode","제어 통신",{packet:"실제 패킷",time:"시간 가정"}],["jitterModel","지터",{packet:"실제 지연 변동",cost:"라우팅 비용 주입"}]])mg.append(control(label,"edit-"+key,cfg[key]||Object.keys(choices)[0],"select",choices));
  for(const [key,label]of [["controlRefresh","제어 갱신 (s)"],["controlTimeout","수집 제한 시간 (s)"],["controlHeaderBytes","제어 헤더 (B)"],["controlRecordBytes","상태 레코드 (B)"],["controlMtu","제어 MTU (B)"],["controlReassemblyTimeout","재조립 제한 (s)"],["controlResyncInterval","재동기화 주기 (s)"]])mg.append(control(label,"edit-"+key,cfg[key],"number",{min:key==="controlMtu"?64:key.endsWith("Bytes")?1:1e-11,step:key.endsWith("Bytes")||key==="controlMtu"?1:"any"}));
  const [traffic,tf]=group("송신 조건");container.append(traffic);
  const enabled=cfg.stations.filter(s=>s.enabled);const first=enabled[0]||cfg.stations[0];
  const senderWrap=node("details",{class:"sender-list"});senderWrap.append(node("summary",{},`송신 노드 (${enabled.length}개 선택)`));
  const search=node("input",{type:"search",placeholder:"노드 검색",'aria-label':"송신 노드 검색"});senderWrap.append(search);
  const list=node("div",{class:"sender-options"});
  for(const s of cfg.stations){const label=node("label");label.append(node("input",{type:"checkbox",value:s.id,checked:s.enabled,class:"sender-check"}),document.createTextNode(`${s.id} · ${s.name}`));list.append(label);}
  search.oninput=()=>{for(const label of list.children)label.hidden=!label.textContent.toLowerCase().includes(search.value.toLowerCase());};
  list.onchange=()=>senderWrap.querySelector("summary").textContent=`송신 노드 (${list.querySelectorAll("input:checked").length}개 선택)`;
  senderWrap.append(list);tf.append(senderWrap);
  tf.append(control("목적지","edit-destination",first.dstStation,"select",{"-1":"무작위",...Object.fromEntries(cfg.stations.map(s=>[s.id,`${s.id} · ${s.name}`]))}));
  tf.append(control("패킷 크기 (B)","edit-packetSize",first.packetSize,"number",{min:1,step:1}));
  tf.append(control("송신률 (Mbps)","edit-bitrate",first.packetSize*8/first.sendInterval/1e6,"number",{min:.000001}));
  tf.append(control("송신 간격 (s)","edit-sendInterval",first.sendInterval,"number",{min:1e-11}));
  tf.append(control("송신 시작 (s)","edit-startTime",first.startTime??"","number",{min:0,placeholder:"기존 시작 방식 유지"}));
  tf.append(control("송신 종료 (s)","edit-endTime",first.endTime,"number",{min:0}));
  byId("edit-bitrate").oninput=()=>{const r=Number(value("edit-bitrate")),b=Number(value("edit-packetSize"));if(r>0&&b>0)byId("edit-sendInterval").value=b*8/(r*1e6);};
  byId("edit-packetSize").oninput=()=>byId("edit-bitrate").oninput();
  byId("edit-sendInterval").oninput=()=>{const t=Number(value("edit-sendInterval"));if(t>0)byId("edit-bitrate").value=Number(value("edit-packetSize"))*8/t/1e6;};
  byId("edit-simTimeLimit").oninput=()=>{if(Number(value("edit-endTime"))===cfg.simTimeLimit)byId("edit-endTime").value=value("edit-simTimeLimit");};
  const common=["islDatarate","groundlinkDatarate","minimumElevation","queueCapacity","updateInterval"];
  const [links,lf]=group("링크·큐");container.append(links);for(const f of cfg.capabilities.fields.filter(f=>common.includes(f.key)))addField(lf,f);
  const [mcsr,mf]=group("MCSR");mcsr.dataset.mcsr="1";container.append(mcsr);
  const csibKeys=cfg.capabilities.fields.filter(f=>f.key.startsWith("csib")).map(f=>f.key);
  const experimental=["srdK","srdL"];
  for(const f of cfg.capabilities.fields.filter(f=>!basicKeys.includes(f.key)&&!common.includes(f.key)&&!csibKeys.includes(f.key)&&!experimental.includes(f.key)&&!["slsInterval","slsMissCount","floodHopDelay","spfDelay"].includes(f.key)))addField(mf,f);
  mf.append(control("지터 측정 방식","edit-jitterSource",cfg.jitterSource,"select",{arrival:"도착 지연 변동",delayChange:"전파 지연 변화"}));
  for(const key of ["reservedPaths","snapshotOnDelayUpdate"]){const label=node("label",{class:"check-field"});label.append(node("input",{id:"edit-"+key,type:"checkbox",checked:cfg[key]}),document.createTextNode(key==="reservedPaths"?"예비 경로 사용":"전파 지연 갱신 시 상태 재계산"));mf.append(label);}
  const [csib,cf]=group("DS·CSIB");csib.id="settingsCsib";container.append(csib);
  for(const key of ["csibEnabled","csibVote"]){const label=node("label",{class:"check-field"});label.append(node("input",{id:"edit-"+key,type:"checkbox",checked:cfg[key]}),document.createTextNode(key==="csibEnabled"?"DS·CSIB 사용":"DS 투표 사용"));cf.append(label);}
  for(const f of cfg.capabilities.fields.filter(f=>csibKeys.includes(f.key)&&f.key!=="csibDetectDelay"))addField(cf,f);
  const [srd,sg]=group("공통 SRD");
  for(const f of cfg.capabilities.fields.filter(f=>experimental.includes(f.key)))addField(sg,f);
  mg.append(control("MCSR 경로 계산 방식","edit-floodModel",cfg.floodModel,"select",{paper:"참조 방식",consistent:"축 일관 방식 (추가 실험)"}));
  const [fault,ff]=group("장애·복구");container.append(fault);
  ff.append(control("장애 일정","edit-failureSchedule",cfg.failureSchedule,"text",{placeholder:"12-13@60+30 또는 route@60+30"}));
  ff.append(control("장애 정보 전달","edit-failureKnowledge",cfg.failureKnowledge,"select",{instant:"즉시",propagate:"감지·전파 후"}));
  for(const f of cfg.capabilities.fields.filter(f=>["slsInterval","slsMissCount","floodHopDelay","spfDelay"].includes(f.key)))addField(ff,f);
  for(const [key,label]of Object.entries({randomFailures:"무작위 장애 수",randomStart:"시작 (s)",randomEnd:"종료 (s)",randomDuration:"복구까지 (s, 0=영구)",failureSeed:"장애 시드"}))ff.append(control(label,"edit-"+key,cfg[key]));
  const [congestion,cg]=group("혼잡·환경 효과");container.append(congestion);
  cg.classList.add("scenario-editor");cg.append(control("시험 방식","edit-congestionMode",cfg.congestionMode,"select",{actual:"실제 큐",environment:"환경 효과 주입"}));cg.append(node("p",{id:"scenarioModeText",class:"quiet"}));
  cg.append(control("지역 갱신 간격 (s)","edit-congestionRefresh",cfg.congestionRefresh,"number",{min:1e-11}));
  cg.append(control("모형 버퍼 B (패킷)","edit-congestionBuffer",cfg.congestionBuffer,"number",{min:1,step:1}));
  cg.append(control("모형 패킷 크기 (B)","edit-congestionPacketBytes",cfg.congestionPacketBytes,"number",{min:1,step:1}));
  cg.append(control("기존 zones 설정","edit-congestionZones",cfg.congestionZones,"text"));
  const aware=node("label",{class:"check-field"});aware.append(node("input",{type:"checkbox",id:"edit-congestionAware",checked:cfg.congestionAware}),document.createTextNode("Dijkstra 비용에 환경 지연 반영"));cg.append(aware);
  cg.append(node("div",{id:"scenarioEntries",class:"scenario-entries"}),node("div",{id:"entryForm",class:"entry-form"}));
  buildEntryForm();refreshEntries();byId("edit-congestionMode").onchange=()=>{modeChanged();updateMcsrControls();};modeChanged();
  const [recording,rf]=group("기록");container.append(recording);rf.append(control("경로 기록","edit-routeRecording",cfg.routeRecording,"select",{changes:"변경된 경로",full:"모든 계획 경로"}));
  const pt=node("label",{class:"check-field"});pt.append(node("input",{id:"edit-packetTrace",type:"checkbox",checked:cfg.packetTrace}),document.createTextNode("전체 패킷 기록 (대용량)"));rf.append(pt);
  const [advanced,ag]=group("고급 설정");advanced.id="settingsAdvanced";ag.classList.add("settings-sections");container.append(advanced);
  const [routing,rg]=group("경로 계산");routing.dataset.mcsr="1";ag.append(routing);
  const [protocol,pg]=group("제어 통신");ag.append(protocol);
  // Keep the common SRD editable for Dijkstra-targeted scenarios as well.
  ag.append(srd);
  const move=(keys,target)=>{for(const key of keys){const input=byId("edit-"+key);if(input)target.append(input.closest("label"));}};
  move(["labelCap","routingQueueCapacity","refreshInterval","flowTimeout","jitterWindow","jitterSource","snapshotOnDelayUpdate"],rg);
  move(["slsInterval","slsMissCount","controlRefresh","controlTimeout","controlHeaderBytes","controlRecordBytes","controlMtu","controlReassemblyTimeout","controlResyncInterval","csibPeriod","csibMonitorInterval","csibMessageBytes"],pg);
  move(["reserveDelay","repairDelay","spfDelay","floodHopDelay","failureKnowledge","failureScopeHops","csibComputeDelay","csibReportProcDelay","csibHopProcDelay"],mg);
  byId("edit-floodModel").closest("label").dataset.mcsr="1";
  ag.append(links,mcsr,csib,models,recording);
  container.insertBefore(node("p",{id:"settingsModelStatus",class:"model-status",role:"status",hidden:true}),basic);
  for(const key of ["algorithm","processingMode","controlMode","jitterModel","csibEnabled","failureKnowledge","queueCapacity","randomFailures"])byId("edit-"+key).addEventListener("change",updateMcsrControls);
  updateMcsrControls();attachSettingHelp(container);if(!byId("settingsDialog").open)byId("settingsDialog").showModal();
}
const cities={"서울":[37.5665,126.978],"도쿄":[35.6762,139.6503],"베이징":[39.9042,116.4074],"싱가포르":[1.3521,103.8198],"시드니":[-33.8688,151.2093],"뭄바이":[19.076,72.8777],"두바이":[25.2048,55.2708],"모스크바":[55.7558,37.6173],"런던":[51.5074,-.1278],"파리":[48.8566,2.3522],"프랑크푸르트":[50.1109,8.6821],"카이로":[30.0444,31.2357],"라고스":[6.5244,3.3792],"요하네스버그":[-26.2041,28.0473],"뉴욕":[40.7128,-74.006],"로스앤젤레스":[34.0522,-118.2437],"멕시코시티":[19.4326,-99.1332],"상파울루":[-23.5505,-46.6333],"부에노스아이레스":[-34.6037,-58.3816],"산티아고":[-33.4489,-70.6693]};
function buildEntryForm(entry=null){
  const form=byId("entryForm");form.replaceChildren();const target=entry?.target,params=target?.params||{};
  let kind=target?.kind||"link";if(kind==="zone")kind=params.zone_kind;if(kind==="region")kind=params.shape;
  form.append(control("대상","entry-kind",kind,"select",{link:"링크",satellite:"위성",plane_range:"궤도면·위성 범위",latlon_box:"위경도 구역",srd:"SRD 범위",path_hops:"기준 경로의 홉",rect:"지도 사각형",circle:"지도 원·도시 반경"}));
  const area=node("div",{id:"entry-target",class:"editor-grid"});form.append(area);
  function targetFields(){
    area.replaceChildren();const k=value("entry-kind"),n=nativeUI.config.numSatellites;
    const fields=k==="link"?[["위성 A","sat_a",0],["위성 B","sat_b",1]]:k==="satellite"?[["위성 번호","sat",0]]:k==="plane_range"?[["궤도면 시작","plane_from",0],["궤도면 끝","plane_to",0],["면 내 위성 시작","sat_from",0],["면 내 위성 끝","sat_to",0]]:k==="srd"?[["SRD 시작","srd_from",0],["SRD 끝","srd_to",0]]:k==="path_hops"?[["시작 홉","hop_from",1],["종료 홉","hop_to",1]]:k==="circle"?[["중심 위도","center_lat",37.5665],["중심 경도","center_lon",126.978],["반경 (km)","radius_km",1500]]:[["최소 위도","lat_min",30],["최대 위도","lat_max",45],["시작 경도","lon_min",120],["끝 경도","lon_max",140]];
    for(const [label,key,d]of fields)area.append(control(label,"target-"+key,params[key]??d));
    if(k==="circle"){
      area.append(control("도시","entry-city","","select",{"":"직접 입력",...Object.fromEntries(Object.keys(cities).map(s=>[s,s]))}));byId("entry-city").onchange=()=>{const p=cities[value("entry-city")];if(p){byId("target-center_lat").value=p[0];byId("target-center_lon").value=p[1];}};
    }
    if(["rect","circle","latlon_box"].includes(k)){
      const draw=node("button",{type:"button"},"지도에서 지정");draw.onclick=()=>{nativeUI.drawing={shape:k==="circle"?"circle":"rect",start:null};playing=false;byId("settingsDialog").close();setStatus("지도에서 범위를 드래그하세요. Esc로 취소합니다.");};area.append(draw);
      area.append(control("범위 내 세기","target-profile",params.profile||"uniform","select",{uniform:"균일",hotspot:"중심이 강한 핫스팟"}),control("경계 세기 (%)","target-edge_pct",params.edge_pct??20,"number",{min:0,max:100}));
    }
    if(k==="path_hops"){
      const chosen=selectedRouteId?findRouteById(routes,selectedRouteId):null;const options={"":"경로 선택",...Object.fromEntries(routes.slice(-100).map(r=>[r[1],`${r[0].toFixed(2)}s · ${r[2]}→${r[3]} · ${r[4]}홉`]))};
      area.append(control("기준 경로","entry-route",chosen?.[1]??"","select",options));
    }
    area.append(control("방향","target-direction",params.direction||"both","select",k==="link"?{both:"양방향",out:"A → B",in:"B → A"}:{both:"양방향",out:"나가는 방향",in:"들어오는 방향"}));
    area.append(control("링크 적용","target-link_rule",params.link_rule||"any","select",{any:"한쪽 끝 포함",both:"양쪽 끝 포함"}));
    attachSettingHelp(area);
  }
  byId("entry-kind").onchange=targetFields;targetFields();
  const time=node("div",{class:"editor-grid"});form.append(time);
  time.append(control("시작 (s)","entry-start",entry?.start_s??0,"number",{min:0}),control("종료 (s, 빈칸=끝까지)","entry-end",entry?.end_s??"","number",{min:0}),control("점진 증가 (s)","entry-ramp",entry?.ramp_s??0,"number",{min:0}),control("혼잡도 (%)","entry-rho",(entry?.rho??.6)*100,"number",{min:1,max:99}));
  for(const [key,label,defaultValue]of [["fail","링크 장애",false],["use_capacity","용량 감소",true],["use_buffer","가용 버퍼 감소",false],["use_queue","M/M/1 지연·지터",false]]){const wrap=node("label",{class:"check-field"});wrap.append(node("input",{id:"entry-"+key,type:"checkbox",checked:entry?!!entry[key]:defaultValue}),document.createTextNode(label));form.append(wrap);}
  const penalty=node("div",{class:"editor-grid"});for(const [key,label,max]of [["delay_ms","추가 지연 (ms)",100000],["jitter_ms","추가 지연 표준편차 (ms)",100000],["loss_pct","패킷 손실률 (%)",100]])penalty.append(control(label,"penalty-"+key,entry?.penalty?.[key]??0,"number",{min:0,max}));form.append(penalty);
  byId("entry-fail").onchange=()=>{const fail=byId("entry-fail").checked;byId("target-direction").disabled=fail;if(fail)byId("target-direction").value="both";for(const key of ["use_capacity","use_buffer","use_queue"]){byId("entry-"+key).disabled=fail;if(fail)byId("entry-"+key).checked=false;}for(const e of penalty.querySelectorAll("input")){e.disabled=fail;if(fail)e.value=0;}if(fail)byId("entry-ramp").value=0;};byId("entry-fail").onchange();
  const actions=node("div",{class:"entry-actions"});const add=node("button",{type:"button",class:"btn-primary"},nativeUI.entryIndex<0?"조건 추가":"조건 수정");
  add.onclick=()=>{try{const e=entryFromForm();if(nativeUI.entryIndex<0)nativeUI.scenario.entries.push(e);else nativeUI.scenario.entries[nativeUI.entryIndex]=e;nativeUI.entryIndex=-1;refreshEntries();buildEntryForm();byId("settingsError").textContent="";}catch(error){byId("settingsError").textContent=error.message;}};actions.append(add);
  const upload=node("label",{class:"file-btn"},"시나리오 가져오기"),file=node("input",{type:"file",accept:".json",hidden:true});upload.append(file);file.onchange=async()=>{try{const s=JSON.parse(await file.files[0].text());if(!Array.isArray(s.entries))throw Error("시나리오 형식을 확인하세요.");nativeUI.scenario=s;refreshEntries();}catch(e){byId("settingsError").textContent=e.message;}};
  const download=node("button",{type:"button"},"시나리오 내보내기");download.onclick=()=>{const a=node("a",{href:URL.createObjectURL(new Blob([JSON.stringify(nativeUI.scenario,null,2)],{type:"application/json"})),download:"congestion_scenario.json"});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};actions.append(upload,download);form.append(actions);attachSettingHelp(form);
}
function entryFromForm(){
  const k=value("entry-kind");const p={};for(const input of byId("entry-target").querySelectorAll("input[id^=target-],select[id^=target-]"))p[input.id.slice(7)]=input.type==="number"?Number(input.value):input.value;
  let kind=k;if(["plane_range","latlon_box","srd"].includes(k)){kind="zone";p.zone_kind=k;}if(["rect","circle"].includes(k)){kind="region";p.shape=k;}if(k==="link")p.bidirectional=p.direction==="both";
  if(k==="path_hops") {const r=findRouteById(routes,Number(value("entry-route")));if(nativeUI.baseline)nativeUI.scenario.baseline=structuredClone(nativeUI.baseline);else {if(!r)throw Error("기준 경로를 선택하세요.");nativeUI.scenario.baseline={route:r[6],runId:resultMeta?.runId,time:r[0]};}}
  const e={target:{kind,params:p},start_s:numeric("entry-start"),end_s:value("entry-end")===""?null:numeric("entry-end"),ramp_s:numeric("entry-ramp"),rho:numeric("entry-rho")/100};
  if(e.start_s<0||e.start_s>=numeric("edit-simTimeLimit")||(e.end_s!==null&&e.end_s<=e.start_s))throw Error("조건의 시작·종료 시각을 확인하세요.");
  for(const key of ["fail","use_capacity","use_buffer","use_queue"])e[key]=byId("entry-"+key).checked;
  const pen=Object.fromEntries(["delay_ms","jitter_ms","loss_pct"].map(key=>[key,numeric("penalty-"+key)]));if(Object.values(pen).some(v=>v>0))e.penalty=pen;
  if(!e.fail){byId("edit-congestionMode").value="environment";modeChanged();}
  return e;
}
function refreshEntries(){const list=byId("scenarioEntries");list.replaceChildren();nativeUI.scenario.entries.forEach((e,i)=>{const row=node("div",{class:"scenario-entry"});row.append(node("span",{},`${i+1}. ${e.target.kind} · ${e.start_s}s–${e.end_s??"끝"} · ${e.fail?"장애":`${Math.round(e.rho*100)}%`}`));const edit=node("button",{type:"button"},"편집"),remove=node("button",{type:"button"},"삭제");edit.onclick=()=>{nativeUI.entryIndex=i;buildEntryForm(e);};remove.onclick=()=>{nativeUI.scenario.entries.splice(i,1);nativeUI.entryIndex=-1;refreshEntries();};row.append(edit,remove);list.append(row);});}
byId("btnSettings").onclick=async()=>{try{const r=await fetch(`/api/config?config=${encodeURIComponent(cfgNameSel.value)}`,{cache:"no-store"});const cfg=await r.json();if(!r.ok)throw Error(cfg.error);openSettings(cfg);}catch(e){setStatus(e.message);}};
byId("settingsDefaults").onclick=async()=>{
  const original=nativeUI.config,button=byId("settingsDefaults");
  if(!original)return;
  button.disabled=true;
  const save=byId("settingsForm").querySelector("[type=submit]");save.disabled=true;
  try{
    const response=await fetch(`/api/config?config=${encodeURIComponent(original.activeConfig)}&defaults=1`,{cache:"no-store"});
    const cfg=await response.json();
    if(!response.ok)throw Error(cfg.error);
    if(byId("settingsDialog").open&&nativeUI.config===original)openSettings(cfg,true);
  }catch(e){if(nativeUI.config===original)byId("settingsError").textContent=e.message;}
  finally{button.disabled=false;save.disabled=false;}
};
for(const button of document.querySelectorAll("[data-close]"))button.onclick=()=>byId(button.dataset.close).close();
byId("settingsForm").onsubmit=async event=>{
  event.preventDefault();const save=event.submitter||byId("settingsForm").querySelector("[type=submit]");save.disabled=true;
  try {
    const cfg=nativeUI.config,first=cfg.stations.find(s=>s.enabled)||cfg.stations[0],changes={senders:[...document.querySelectorAll(".sender-check:checked")].map(e=>Number(e.value))};
    if(changes.senders.join(",")===cfg.stations.filter(s=>s.enabled).map(s=>s.id).join(","))delete changes.senders;
    if(value("edit-algorithm")!==cfg.algorithm)changes.algorithm=value("edit-algorithm");
    for(const [key,original]of Object.entries({destination:first.dstStation,packetSize:first.packetSize,sendInterval:first.sendInterval,endTime:first.endTime,startTime:first.startTime})){if(value("edit-"+key)!==""&&numeric("edit-"+key)!==original)changes[key]=numeric("edit-"+key);}
    for(const f of cfg.capabilities.fields){const input=byId("edit-"+f.key);if(input&&!input.disabled)changes[f.key]=numeric("edit-"+f.key);}
    for(const key of Object.keys(cfg.capabilities.booleans)){const input=byId("edit-"+key);if(input&&!input.disabled)changes[key]=input.checked;}
    if(value("edit-controlMode")==="time")changes.csibEnabled=false;
    for(const key of Object.keys(cfg.capabilities.choices)){const input=byId("edit-"+key);if(input&&!input.disabled)changes[key]=input.value;}
    for(const key of ["congestionMode","failureSchedule","failureKnowledge","congestionZones","routeRecording"]){const input=byId("edit-"+key);if(input&&!input.disabled)changes[key]=input.value;}
    for(const key of ["randomFailures","randomStart","randomEnd","randomDuration","failureSeed","congestionRefresh","congestionBuffer","congestionPacketBytes"]){const input=byId("edit-"+key);if(input&&!input.disabled)changes[key]=numeric("edit-"+key);}
    for(const key of ["processingMode","controlMode","jitterModel"]){const e=byId("edit-"+key);if(e&&!e.disabled)changes[key]=e.value;}
    for(const key of ["controlRefresh","controlTimeout","controlHeaderBytes","controlRecordBytes","controlMtu","controlReassemblyTimeout","controlResyncInterval"]){const input=byId("edit-"+key);if(input&&!input.disabled)changes[key]=numeric("edit-"+key);}
    changes.packetTrace=byId("edit-packetTrace").checked;
    for(const key of Object.keys(changes))if(changes[key]===cfg[key])delete changes[key];
    const response=await fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({configName:cfg.activeConfig,changes,resetDefaults:!!nativeUI.resetDefaults,
      scenario:JSON.stringify(nativeUI.scenario)===JSON.stringify(cfg.scenario||{schema:1,method:"environment",entries:[]})?null:nativeUI.scenario})});const result=await response.json();if(!response.ok)throw Error(result.error||"저장하지 못했습니다.");
    applyLoadedConfig(result,{announce:true});byId("settingsDialog").close();setStatus("INI에 저장했습니다. 실행하면 새 설정이 적용됩니다.");
  }catch(e){byId("settingsError").textContent=e.message;}finally{save.disabled=false;}
};
function mapCoordinates(e){const p=mapPoint(e);return {lat:Math.max(-90,Math.min(90,90-p.worldY/H*180)),lon:Math.max(-180,Math.min(180,p.worldX/W*360-180))};}
canvas.addEventListener("pointerdown",e=>{if(nativeUI.drawing&&e.button===0&&mapPoint(e)?.inside){nativeUI.drawing.start=mapCoordinates(e);canvas.setPointerCapture(e.pointerId);}});
canvas.addEventListener("pointerup",e=>{const d=nativeUI.drawing;if(!d?.start)return;const end=mapCoordinates(e);nativeUI.drawing=null;
  if(d.shape==="rect"){const lons=[d.start.lon,end.lon];byId("target-lat_min").value=Math.min(d.start.lat,end.lat);byId("target-lat_max").value=Math.max(d.start.lat,end.lat);byId("target-lon_min").value=Math.abs(lons[0]-lons[1])>180?Math.max(...lons):Math.min(...lons);byId("target-lon_max").value=Math.abs(lons[0]-lons[1])>180?Math.min(...lons):Math.max(...lons);}
  else {const rad=Math.PI/180,a=d.start.lat*rad,b=end.lat*rad,h=Math.sin((b-a)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin((end.lon-d.start.lon)*rad/2)**2;byId("target-center_lat").value=d.start.lat;byId("target-center_lon").value=d.start.lon;byId("target-radius_km").value=Math.max(1,6371.0088*2*Math.asin(Math.min(1,Math.sqrt(h))));}
  byId("settingsDialog").showModal();});
window.addEventListener("keydown",e=>{if(e.key==="Escape"&&nativeUI.drawing){nativeUI.drawing=null;byId("settingsDialog").showModal();}});

const metricLabels={attempted:"발생",sent:"송신",received:"수신",dropped:"폐기",inFlight:"전송 중",deliveryRate:"전달률 (%)",meanDelayMs:"평균 지연 (ms)",throughputMbps:"처리량 (Mbps)",replanned:"재계산",reservedSwitches:"예비 경로 전환",peakMemoryBytes:"최대 메모리 (B)",elapsedSeconds:"계산 시간 (s)"};
function metricText(v,d=2){return v===null||v===undefined||!Number.isFinite(Number(v))?"—":Number(v).toLocaleString("ko-KR",{maximumFractionDigits:d});}
function measured(s,key){return ["meanDelayMs","delayStdMs","maxDelayMs","jitterMs","meanHops"].includes(key)&&!s.received?null:s[key];}
function validationLabels(record){
  if(!record?.scope?.length&&!record?.workloads?.length)return ["검증 범위 기록 없음"];
  const scope=record.scope||[];
  const labels=[];
  if(scope.includes("fixed-graph-core")&&scope.includes("reference-core"))labels.push("코어 통과");
  if(scope.includes("analytic-packet-kernel"))labels.push("커널 통과");
  if(scope.includes("integration"))labels.push("통합 통과");
  for(const test of [["scale-data-load","대규모 부하"],["long-packet-control","장시간 제어"]]){
    const result=record.workloads?.find(w=>w.scope===test[0]);
    labels.push(result?`${test[1]} 통과 (${result.satellites}위성 · ${result.simSeconds}초)`:`${test[1]} 기록 없음`);
  }
  return labels;
}
function showMetrics(result){
  nativeUI.result=result;const raw=result?.summary,s=raw?offered(raw):null;byId("nativeMetrics").hidden=!s;if(!s){byId("metricDetails").close();return;}
  let status=byId("validationStatus");if(!status){status=node("p",{id:"validationStatus",class:"quiet"});byId("nativeMetrics").prepend(status);}
  status.textContent=[...validationLabels(s.validation),s.approximation?(s.approximation.limited?"라벨 제한 발생":"라벨 제한 미발생"):"라벨 제한 계측 없음",s.measurement?`측정 ${s.measurement.start}–${s.measurement.end}s · 관측 ${s.measurement.observedUntil}s`:null].filter(Boolean).join(" · ");
  const grid=byId("metricValues");grid.replaceChildren();
  for(const key of ["attempted","received","dropped","inFlight","deliveryRate","meanDelayMs","throughputMbps","maxQueuePackets"]){const e=node("div");e.append(node("small",{},metricLabels[key]||"최대 대기 (패킷)"),node("strong",{},metricText(measured(s,key))));grid.append(e);}
  const body=byId("flowMetrics").tBodies[0],flow=byId("metricFlow"),series=byId("metricSeries");
  const flows=s.flows||[],names=new Map((result.config?.stations||[]).map(station=>[station.id,station.name]));
  const name=id=>names.get(id)||("노드 "+id);
  body.replaceChildren();flow.replaceChildren(new Option("전체 통신","all"));
  byId("flowDetails").hidden=!flows.length;
  for(const original of flows){
    const f=offered(original),pair=name(f.source)+" → "+name(f.destination),row=body.insertRow();
    for(const text of [pair,`${metricText(f.received,0)} / ${metricText(f.attempted,0)}`,`${metricText(f.deliveryRate)}%`,`${metricText(measured(f,"meanDelayMs"))} ms`,`${metricText(measured(f,"jitterMs"))} ms`,metricText(measured(f,"meanHops"))])row.insertCell().textContent=text;
    flow.add(new Option(pair,`${f.source}:${f.destination}`));
  }
  for(const option of series.options)if(option.value.startsWith("control"))option.disabled=!(result.controlSeries||[]).length;
  if(series.selectedOptions[0].disabled)series.value="throughput";
  showResearchMetrics(s);if(byId("metricDetails").open)drawMetrics();
}
function drawMetrics(){
  const result=nativeUI.result;if(!result?.summary)return;
  const flowSelector=byId("metricFlow");
  flowSelector.disabled=value("metricSeries").startsWith("control");
  const chart=byId("qosChart"),c=chart.getContext("2d"),w=chart.width,h=chart.height,type=value("metricSeries"),flow=value("metricFlow"),groups=new Map();
  for(const r of result.series||[]){if(flow!=="all"&&flow!==`${r[1]}:${r[2]}`)continue;let g=groups.get(r[0]);if(!g){g={time:r[0],v:0,rx:0};groups.set(r[0],g);}if(type==="delay"){g.v+=r[7]*r[4];g.rx+=r[4];}else g.v+=r[type==="throughput"?6:type==="dropped"?5:8];}
  let points=[...groups.values()].map(g=>[g.time,type==="delay"?(g.rx?g.v/g.rx:null):g.v]);if(type.startsWith("control")){points=[];let previous=null;for(const row of result.controlSeries||[]){const elapsed=row[0]-(previous?.[0]||0),index=type==="controlBytes"?5:4,delta=row[index]-(previous?.[index]||0);points.push([row[0],type==="controlBytes"?delta*8/elapsed/1e6:delta]);previous=row;}}
  c.clearRect(0,0,w,h);c.font="20px sans-serif";c.fillStyle="#aebed2";
  const valid=points.filter(p=>Number.isFinite(p[1])),max=valid.reduce((peak,p)=>Math.max(peak,p[1]),0)||1,end=result.config.simTimeLimit,left=70,top=20,bottom=h-40;
  c.strokeStyle="#344458";c.beginPath();c.moveTo(left,top);c.lineTo(left,bottom);c.lineTo(w-15,bottom);c.stroke();c.fillText(metricText(max),4,top+16);c.fillText("0",left-22,bottom);c.fillText(`${metricText(end)} s`,w-100,h-6);
  c.strokeStyle="#57c9e8";c.lineWidth=2;c.beginPath();let pen=false;for(const [t,v]of points){if(!Number.isFinite(v)){pen=false;continue;}const x=left+t/end*(w-left-15),y=bottom-v/max*(bottom-top);if(pen)c.lineTo(x,y);else c.moveTo(x,y);pen=true;}c.stroke();
  const notice=byId("chartCaption");
  notice.textContent=!valid.length?"표시할 측정값이 없습니다.":flowSelector.disabled?"전체 네트워크의 제어 메시지를 집계합니다.":"";
  notice.hidden=!notice.textContent;
}
byId("btnMetricDetails").onclick=()=>{byId("metricDetails").showModal();drawMetrics();};
byId("metricSeries").onchange=drawMetrics;byId("metricFlow").onchange=drawMetrics;
window.addEventListener("sim-result",e=>showMetrics(e.detail));window.addEventListener("sim-clear",()=>showMetrics(null));
const comparisonInputs={};
function hostExecutionLabel(host) {
  if (!host) return "기록 없음";
  return host.mode === "auto" ? "자동 · 동시 " + host.workers + "개" : "순차";
}
function showComparison(a,b){
  byId("singleComparisonControls").hidden=false;
  const sa=offered(a.summary),sb=offered(b.summary);const ca=a.config,cb=b.config;
  const verified=a.manifest.format==="leo-native-replay-v4"&&b.manifest.format==="leo-native-replay-v4"&&sa.processingMode==="neutral"&&sb.processingMode==="neutral"&&sa.controlMode===sb.controlMode&&sa.jitterModel===sb.jitterModel&&a.manifest.physicalEventsHash===b.manifest.physicalEventsHash;
  const sameTraffic=sa.trafficHash===sb.trafficHash,ha=a.manifest.environmentHash,hb=b.manifest.environmentHash;
  byId("comparisonStatus").textContent=(verified&&ha&&ha===hb&&sameTraffic)?"동일한 환경·송신 조건입니다.":sameTraffic?"송신 조건은 동일합니다. 환경 설정 차이를 확인하세요.":"송신 조건이 다릅니다.";
  const content=byId("comparisonContent");content.replaceChildren();const table=node("table"),head=table.createTHead().insertRow();for(const t of ["지표",`${sa.algorithm} (기준)`,`${sb.algorithm} (비교)`,"차이"])head.append(node("th",{},t));
  const body=table.createTBody();
  if (sa.hostExecution || sb.hostExecution) {
    const row=body.insertRow();
    for(const text of ["실행 방식",hostExecutionLabel(sa.hostExecution),hostExecutionLabel(sb.hostExecution),"—"]) row.insertCell().textContent=text;
  }
  const serialTiming=[sa,sb].every(summary => !summary.hostExecution || summary.hostExecution.mode==="sequential");
  for(const key of Object.keys(metricLabels)){const av=measured(sa,key),bv=measured(sb,key),row=body.insertRow();for(const text of [metricLabels[key],metricText(av),metricText(bv),av==null||bv==null||(key==="elapsedSeconds"&&!serialTiming)?"—":metricText(bv-av)])row.insertCell().textContent=text;}
  content.append(table);
  if (!serialTiming) content.append(node("p",{class:"quiet"},"자동 실행의 경과 시간에는 다른 실행과의 자원 경합이 반영될 수 있습니다."));
  const settings=node("details");settings.append(node("summary",{},"알고리즘 설정 차이"));for(const key of new Set([...Object.keys(a.manifest.algorithmSettings||{}),...Object.keys(b.manifest.algorithmSettings||{})])){const av=a.manifest.algorithmSettings?.[key],bv=b.manifest.algorithmSettings?.[key];if(av!==bv)settings.append(node("p",{class:"quiet"},`${key}: ${av??"—"} → ${bv??"—"}`));}content.append(settings);
  const capture=node("button",{type:"button"},"기준 경로를 혼잡 설정에 사용");capture.onclick=()=>{const route=a.routes[0];if(!route){byId("comparisonStatus").textContent="기준 결과에 경로가 없습니다.";return;}nativeUI.baseline={runId:a.runId,route:route[6],time:route[0]};byId("comparisonStatus").textContent=`기준 경로 ${route[6].join(" → ")} 선택됨`;render();};content.append(capture);
}
async function readComparisonFolder(files){
  return prepareBundle(await bundleFromFiles([...files]),msg=>byId("comparisonStatus").textContent=msg);
}
for(const [id,key]of [["baselineFolder","a"],["comparisonFolder","b"]])byId(id).onchange=async e=>{try{const result=await readComparisonFolder(e.target.files);if(!result.summary)throw Error("수신 통계가 포함된 실행 결과를 선택하세요.");comparisonInputs[key]=result;byId("comparisonStatus").textContent=`${key==="a"?"기준":"비교"} 실행: ${result.runId}`;if(comparisonInputs.a&&comparisonInputs.b)showComparison(comparisonInputs.a,comparisonInputs.b);}catch(err){byId("comparisonStatus").textContent=err.message;}};
byId("btnCompare").onclick=async()=>{
  byId("singleComparisonControls").hidden=false;
  byId("compareDialog").showModal();byId("comparisonStatus").textContent="";
  const online=location.protocol!=="file:";for(const id of ["baselineRun","scenarioRun","loadComparison"])byId(id).disabled=!online;if(!online)return;
  try{const response=await fetch("/api/experiments"),rows=await response.json();if(response.ok&&Array.isArray(rows)){byId("experimentHistoryRow").hidden=!rows.length;byId("experimentHistory").replaceChildren();for(const row of rows)byId("experimentHistory").add(new Option(`${scenarioName(row.configName, row.displayName)} · 시드 ${row.seeds.length}개 · ${row.experimentId}`,row.experimentId));}}catch(e){byId("experimentHistoryRow").hidden=true;}
  try{const response=await fetch("/api/runs");const list=await response.json();for(const id of ["baselineRun","scenarioRun"]){const select=byId(id);select.replaceChildren();for(const r of list)select.add(new Option(`${scenarioName(r.configName, r.displayName)} · ${algorithmName({algorithm:r.summary.algorithm})} · ${r.runId}`,r.runId));}if(nativeUI.result)byId("scenarioRun").value=nativeUI.result.runId;if(list.length>1)byId("baselineRun").selectedIndex=1;}catch(e){byId("comparisonStatus").textContent=e.message;}
};
byId("loadExperiment").onclick=async()=>{try{const response=await fetch(`/api/experiments/${encodeURIComponent(value("experimentHistory"))}`),report=await response.json();if(!response.ok)throw Error(report.error);showExperimentStatistics(report);}catch(e){byId("comparisonStatus").textContent=e.message;}};
function showExperimentStatistics(report){
  byId("singleComparisonControls").hidden=true;
  if(!byId("compareDialog").open)byId("compareDialog").showModal();
  byId("comparisonStatus").textContent=`${report.stage==="final"?"최종 비교":report.stage==="pilot"?"예비 시험":"탐색 시험"} · 시드 ${report.seeds.length}개 · ${report.completedRuns}회 완료 · ${report.comparisonScope==="packet-system"?"패킷·제어 시험":report.comparisonScope==="routing-time-model"?"시간 모델 시험":"반복 시험"}`;
  const content=byId("comparisonContent");content.replaceChildren();
  if(report.inputVariability){
    const {trafficProfiles,physicalEventProfiles}=report.inputVariability;
    content.append(node("p",{class:"quiet"},`송신 입력 ${trafficProfiles}종 · 물리 사건 ${physicalEventProfiles}종`));
  }
  const names={deliveryRate:"전달률 (%p)",throughputMbps:"측정 처리량 (Mbps)",meanDelayMs:"수신 지연 (ms)",jitterMs:"수신 지터 (ms)",unrecoveredRate:"첫 수신 미관측 (%p)",stableUnrecoveredRate:"안정 복구 미관측 (%p)",controlWireBytes:"제어 전송량 (전체 B)",edgeChecks:"간선 검사 (전체)",labelExpand:"라벨 확장 (전체)"};
  for(const comparison of report.comparisons){
    content.append(node("p",{},`${algorithmName({algorithm:comparison.algorithm})} − ${algorithmName({algorithm:comparison.baseline})}`));
    const labels={"fixed-input":"고정 입력 반복","distinct-inputs":"시드별 입력 변동 확인","repeated-inputs":"중복 입력 포함","unknown":"시드별 입력 변동 미확인"};
    const variability=labels[comparison.inputClassification]||labels.unknown;
    const showInterval=report.schema>=2&&comparison.intervalAvailable;
    const observed=report.schema>=2?` · 서로 다른 입력 ${comparison.uniqueInputs}/${report.seeds.length} · 링크 난수 사용 시드 ${comparison.seedsUsingLinkRandomness}개`:"";
    content.append(node("p",{class:"quiet"},variability+observed));
    const table=node("table"),head=table.createTHead().insertRow();
    const headings=["지표","평균 차이",...(showInterval?["95% 신뢰구간"]:[]),"유효 / 전체"];
    for(const t of headings)head.append(node("th",{},t));
    const body=table.createTBody();for(const metric of comparison.metrics){const row=body.insertRow(),s=metric.statistics;for(const text of [names[metric.name]||metric.name,s?metricText(s.meanDifference):"관측 부족",...(showInterval?[s?.ci95?s.ci95.map(v=>metricText(v)).join(" ~ "):"—"]:[]),`${metric.observedPairs} / ${report.seeds.length}`])row.insertCell().textContent=text;}
    content.append(table);
  }
}
byId("loadComparison").onclick=async()=>{try{const results=await Promise.all([value("baselineRun"),value("scenarioRun")].map(async id=>{const response=await fetch(`/api/result?runId=${encodeURIComponent(id)}&metadata=1`),result=await response.json();if(!response.ok||!result?.bundle)throw Error(result?.error||"실행 결과가 없습니다.");return prepareBundle(result.bundle);}));comparisonInputs.a=results[0];comparisonInputs.b=results[1];showComparison(...results);}catch(e){byId("comparisonStatus").textContent=e.message;}};
function drawScenarioOverlay(snapshot,time){
  if(!snapshot)return;const entries=resultMeta?.config?.scenario?.entries||nativeUI.config?.scenario?.entries||[];ctx.save();ctx.strokeStyle="#ffb65c";ctx.fillStyle="rgba(255,166,65,.13)";ctx.lineWidth=3;
  for(const e of entries){if(time<(e.start_s||0)||(e.end_s!=null&&time>=e.end_s))continue;const p=e.target?.params||{},kind=e.target?.kind;if(kind!=="region"&&!(kind==="zone"&&p.zone_kind==="latlon_box"))continue;
    if(p.shape==="circle"){const rad=p.radius_km/6371.0088,lat=p.center_lat*Math.PI/180,lon=p.center_lon*Math.PI/180;let previous=null;for(let i=0;i<=72;i++){const b=i/72*2*Math.PI,la=Math.asin(Math.sin(lat)*Math.cos(rad)+Math.cos(lat)*Math.sin(rad)*Math.cos(b)),lo=lon+Math.atan2(Math.sin(b)*Math.sin(rad)*Math.cos(lat),Math.cos(rad)-Math.sin(lat)*Math.sin(la)),point=[(lo*180/Math.PI+540)%360-180,la*180/Math.PI];if(previous)drawWrappedLine(...previous,...point,"#ffb65c",3,.7);previous=point;}}
    else{const ranges=p.lon_min>p.lon_max?[[p.lon_min,180],[-180,p.lon_max]]:[[p.lon_min,p.lon_max]];for(const [a,b]of ranges){const x=lonToX(a),y=latToY(p.lat_max),w=lonToX(b)-x,h=latToY(p.lat_min)-y;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}}
  }
  const baseline=nativeUI.baseline||resultMeta?.config?.scenario?.baseline;if(baseline?.route)for(let i=1;i<baseline.route.length;i++){const a=snapshot.nodes[baseline.route[i-1]],b=snapshot.nodes[baseline.route[i]];if(a&&b)drawWrappedLine(a[1],a[0],b[1],b[0],"#6ef2bb",5,.9);}ctx.restore();
}
if(location.protocol==="file:")byId("btnSettings").hidden=true;
if(typeof resultMeta!=="undefined"&&resultMeta)showMetrics(resultMeta);

function offered(s){if((s.metricVersion||0)>=3||!Number.isFinite(s.attempted))return s;return{...s,deliveryRate:s.attempted?100*s.received/s.attempted:0,dropped:s.dropped+(s.noUplink??s.attempted-s.sent)};}
function diagnosticTable(columns){
  const table=node("table"),head=table.createTHead().insertRow();
  for(const text of columns)head.append(node("th",{scope:"col"},text));
  return [table,table.createTBody()];
}
function resultNodeName(id){
  const station=nativeUI.result?.config?.stations?.find(station=>station.id===id);
  return station?.name||"노드 "+id;
}
function showResearchMetrics(s){
  let detail=byId("researchMetrics");if(detail)detail.remove();if((s.metricVersion||0)<3)return;
  detail=node("section",{id:"researchMetrics",class:"result-detail-group","aria-label":"제어·계산·장애 복구"});
  detail.append(node("h3",{},"제어·계산·장애 복구"),
    node("p",{class:"quiet"},"경로를 유지하는 데 든 제어 메시지, 경로 계산 작업량, 장애 후 수신이 재개된 시점을 확인합니다."));
  const grid=node("div",{class:"metric-grid"});for(const [name,v]of Object.entries({"제어 프레임":s.control?.hopAccepted,"제어 전송 (MB)":s.control?.wireBytes/1e6,"제어 폐기":s.control?.dropped,"간선 검사":s.operations?.edgeChecks,"라벨 확장":s.operations?.labelExpand,"재계산":s.replanned,"라벨 제거":s.operations?.capEvict,"라벨 거절":s.operations?.capReject})){const e=node("div");e.append(node("small",{},name),node("strong",{},metricText(v)));grid.append(e);}detail.append(grid);
  if(s.control?.byKind){const table=node("table"),head=table.createTHead().insertRow();for(const text of ["메시지","생성","홉 전달","홉 실패","전송 프레임","손실 프레임","전송 MB"])head.append(node("th",{},text));const body=table.createTBody();for(const [kind,m]of Object.entries(s.control.byKind)){const row=body.insertRow();for(const v of [kind,m.generated||0,m.messageHopArrivals||0,(m.messageHopDrops||0)+(m.routeDrops||0),m.frameAttempts||0,m.frameDrops||0,(m.wireBytes||0)/1e6])row.insertCell().textContent=typeof v==="number"?metricText(v):v;}const scroll=node("div",{class:"table-scroll"});scroll.append(table);detail.append(scroll);}
  const times=s.computeMs||{};
  if(Object.keys(times).length){
    const section=node("section",{class:"diagnostic-section"});
    section.append(node("h4",{},"경로 계산 시간"),
      node("p",{class:"quiet"},"실제 PC에서 계산에 걸린 누적 시간입니다. 세부 작업 시간이 상위 계산에 포함될 수 있으므로 항목을 합산하지 않습니다."));
    const labels={access:"접속 위성 선택",plan:"경로 계산",repair:"장애 시 경로 재계산",
      "mcsr-access":"MCSR 접속 위성 선택 · 세부","mcsr-plan":"MCSR 경로 계산 · 세부",
      "mcsr-repair":"MCSR 경로 재계산 · 세부","mcsr-snapshot":"MCSR 링크 상태 갱신",
      "dijkstra-tree":"Dijkstra 경로 트리 계산 · 세부","ds-vote":"지역 대표 위성 선출"};
    const [table,body]=diagnosticTable(["계산 항목","누적 시간 (ms)"]);
    for(const key of new Set([...Object.keys(labels),...Object.keys(times)])){
      if(!Number.isFinite(times[key]))continue;
      const row=body.insertRow();
      row.insertCell().textContent=labels[key]||key;
      row.insertCell().textContent=metricText(times[key]);
    }
    const scroll=node("div",{class:"table-scroll"});scroll.append(table);section.append(scroll);detail.append(section);
  }

  const events=s.recovery||[];
  if(events.length){
    const section=node("section",{class:"diagnostic-section"});
    section.append(node("h4",{},"링크 장애 기록"),
      node("p",{class:"quiet"},"정보 수렴은 위성들이 링크 상태를 반영하기까지 걸린 시간입니다. 데이터가 다시 수신되기까지의 시간은 영향받은 통신에서 확인합니다."));
    const [table,body]=diagnosticTable(["시뮬레이션 시각 (초)","위성 링크","상태","감지까지 (초)","정보 수렴까지 (초)","영향받은 통신"]);
    const seconds=(value,missing)=>Number.isFinite(value)?metricText(value):missing;
    const flowSection=node("section",{class:"diagnostic-section",hidden:true});
    for(const event of events){
      const row=body.insertRow(),state=event.restore?"재연결":"단절";
      const nodes=Number.isFinite(event.expectedNodes)?` · ${event.appliedNodes}/${event.expectedNodes}기`:"";
      const time=seconds(event.time,"—"),link=`${event.a}–${event.b}`;
      row.insertCell().textContent=time;
      row.insertCell().textContent=link;
      row.insertCell().append(node("span",{class:event.restore?"link-event restored":"link-event cut"},state));
      row.insertCell().textContent=seconds(event.detectedSeconds,"미감지");
      row.insertCell().textContent=seconds(event.convergenceSeconds,"미수렴")+nodes;
      const cell=row.insertCell(),flows=(event.flows||[]).filter(flow=>flow.affected);
      if(!flows.length){cell.textContent="—";continue;}
      const button=node("button",{type:"button","aria-label":`${time}초 ${link} ${state} · 영향받은 통신 ${flows.length}개 보기`},`${flows.length}개 보기`);
      cell.append(button);
      button.onclick=()=>{
        const [flowTable,flowRows]=diagnosticTable(["출발지 → 목적지","첫 수신까지 (초)","안정 복구까지 (초)"]);
        const heading=node("h4",{tabIndex:-1},`${time}초 · 위성 ${link} ${state} · 영향받은 통신`);
        flowSection.replaceChildren(heading);
        for(const f of flows){
          const flow=flowRows.insertRow();
          for(const value of [`${resultNodeName(f.source)} → ${resultNodeName(f.destination)}`,
            seconds(f.firstPacketRecoverySeconds??f.recoverySeconds,"관측 내 미수신"),
            Object.hasOwn(f,"stableRecoverySeconds")?seconds(f.stableRecoverySeconds,"관측 내 미확인"):"기록 없음"]){
            flow.insertCell().textContent=value;
          }
        }
        const scroll=node("div",{class:"table-scroll"});scroll.append(flowTable);flowSection.append(scroll);
        if(s.recoveryPolicy){
          const p=s.recoveryPolicy;
          flowSection.append(node("p",{class:"quiet"},`안정 복구는 ${p.windowSeconds}초씩 연속 ${p.consecutiveWindows}개 구간에서, 각 구간의 패킷 발생 수가 ${p.minimumPacketsPerWindow}개 이상이고 전달률이 ${p.minimumDeliveryRatePct}% 이상일 때 확인됩니다.`));
        }
        flowSection.hidden=false;
        heading.focus();
      };
    }
    const scroll=node("div",{class:"table-scroll"});scroll.append(table);section.append(scroll,flowSection);detail.append(section);
  }
  byId("metricDetailContent").append(detail);
}
const experimentTotal = byId("experimentTotal");
function updateExperimentTotal() {
  const count = document.querySelectorAll(".experiment-algorithm:checked").length;
  experimentTotal.textContent = "총 " + (count * Number(value("experimentRepetitions"))) + "회 실행";
}
byId("experimentAlgorithms").onchange = byId("experimentRepetitions").onchange = updateExperimentTotal;
byId("btnExperiment").onclick=async()=>{try{const response=await fetch(`/api/config?config=${encodeURIComponent(cfgNameSel.value)}`),cfg=await response.json();if(!response.ok)throw Error(cfg.error);if(!cfg.capabilities?.comparisonExecutionModes?.includes("auto"))throw Error("현재 실행 중인 프로그램은 자동 비교를 지원하지 않습니다. 프로그램을 종료한 뒤 최신 배포 폴더의 sim-ui.exe를 실행하세요.");const area=byId("experimentAlgorithms");area.replaceChildren();for(const [id,label]of Object.entries(cfg.capabilities.algorithms)){const e=node("label",{class:"check-field"});e.append(node("input",{type:"checkbox",class:"experiment-algorithm",value:id,checked:true}),document.createTextNode(algorithmName({algorithm:id})));area.append(e);}byId("experimentForm").dataset.limit=cfg.simTimeLimit;byId("experimentForm").dataset.processing=cfg.processingMode;byId("experimentRepetitions").value="1";byId("experimentExecution").value="auto";updateExperimentTotal();byId("experimentSeed").value=cfg.seed;byId("experimentWarmup").value=cfg.warmupSeconds||0;byId("experimentDrain").value=cfg.drainSeconds||0;byId("experimentConditions").textContent=`${scenarioName(cfg.activeConfig, cfg.displayName)} · ${cfg.simTimeLimit}s · 시드 ${cfg.seed}`;byId("experimentError").textContent="";byId("experimentDialog").showModal();}catch(e){setStatus(e.message);}};
byId("experimentForm").onsubmit=e=>{e.preventDefault();const selected=[...document.querySelectorAll(".experiment-algorithm:checked")].map(e=>e.value);if(!selected.length){byId("experimentError").textContent="알고리즘을 선택하세요.";return;}const research={executionMode:value("experimentExecution"),repetitions:Number(value("experimentRepetitions")),seedStart:Number(value("experimentSeed")),warmupSeconds:Number(value("experimentWarmup")),drainSeconds:Number(value("experimentDrain"))};if(research.warmupSeconds+research.drainSeconds>=Number(byId("experimentForm").dataset.limit)){byId("experimentError").textContent="준비·종료 관측 구간의 합은 실행 시간보다 짧아야 합니다.";return;}if(research.repetitions>1&&byId("experimentForm").dataset.processing!=="neutral"){byId("experimentError").textContent="반복 비교는 고급 설정의 처리 지연을 ‘추가 지연 없음’으로 선택한 뒤 실행하세요.";return;}byId("experimentDialog").close();runNative(selected,research);};
if(location.protocol==="file:")byId("btnExperiment").hidden=true;
