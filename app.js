// SPDX-License-Identifier: GPL-3.0-only
// Modified/adapted 2026-11-16; see THIRD_PARTY_NOTICES.txt.
// Interactive 2D Map, Route Replay & Simulator Runner Controller
let workspaceChangePending=false;
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const W = 2160, H = 1080;
const ROUTE_COLORS = ["#ff6b6b", "#40c4ff", "#69f0ae", "#ffe066", "#b388ff", "#ff9e40", "#ea80fc", "#ff5c8a"];

const earthImg = new Image();
earthImg.src = "data/earth.png";
earthImg.onload = () => render();

let routes = []; // Legacy files have no matching configuration/state evidence.
let states = [], resultMeta = null, loadedConfigKey = "";
let resultLoadRequest = 0, previewConfig = null;
function stateAt(t) {
  if (resultMeta?.replay) {const state=replaySnapshot(t);return resultMeta.networkEvents?.length?applyNetworkTimeline(state,resultMeta.networkEvents,resultMeta.runId,t):state;}
  if(!resultMeta&&previewConfig)return replaySnapshot(t);
  let lo = 0, hi = states.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (states[mid].t <= t) lo = mid + 1; else hi = mid; }
  return lo ? states[lo - 1] : null;
}
function clearResult() {
  window.dispatchEvent(new Event("sim-clear"));
  routes = []; states = []; resultMeta = null; selectedRouteId = null; simTime = 0;
  playing = false; document.getElementById("btnPlay").textContent = "▶ 재생";
}
function installResult(result) {
  clearResult();
  previewConfig=null;routes = result.routes; states = result.states; resultMeta = result;
  applyLoadedConfig(result.config, { result: true });
  syncTimeBounds(result.replay ? result.config.simTimeLimit : states.at(-1)?.t);
  setStatus(`${scenarioName(result.config.activeConfig, result.config.displayName)} · ${algorithmName(result.config)} 실행 결과를 불러왔습니다.`);
  render();
  window.dispatchEvent(new CustomEvent("sim-result",{detail:result}));
}
let simTime = 0;
let maxSimTime = 0;
let playing = false, speed = 10, selectedRouteId = null, lastFrame = 0;
let hoverPoint = null, displayedSnapshot = null, displayedRoute = null;
let lastSatStates = [], lastStationStates = [];

const cfgNameSel = document.getElementById("cfgName");
const srcFilter = document.getElementById("srcFilter");
const dstFilter = document.getElementById("dstFilter");

function populateFilters() {
  const prevSrc = srcFilter.value || "-1";
  const prevDst = dstFilter.value || "-1";
  srcFilter.innerHTML = '<option value="-1">출발지 전체</option>';
  dstFilter.innerHTML = '<option value="-1">목적지 전체</option>';

  const fixed = STATIONS.filter(s => !s.mobile), mobile = STATIONS.filter(s => s.mobile);
  fixed.forEach(s => srcFilter.add(new Option(`GS${s.id}: ${s.name}`, `GS:${s.id}`)));
  mobile.forEach(s => srcFilter.add(new Option(`Mobile ${s.id}: ${s.name}`, `GS:${s.id}`)));
  TERMINALS.forEach(t => srcFilter.add(new Option(`T${t.id}: Terminal ${t.id}`, `T:${t.id}`)));

  mobile.forEach(s => dstFilter.add(new Option(`Mobile ${s.id}: ${s.name}`, `${s.id}`)));
  fixed.forEach(s => dstFilter.add(new Option(`GS${s.id}: ${s.name}`, `${s.id}`)));

  srcFilter.value = [...srcFilter.options].some(o => o.value === prevSrc) ? prevSrc : "-1";
  dstFilter.value = [...dstFilter.options].some(o => o.value === prevDst) ? prevDst : "-1";
}
populateFilters();

function syncTimeBounds(limitSec) {
  maxSimTime = Number.isFinite(limitSec) && limitSec >= 0 ? limitSec : (routes.length ? routes[routes.length - 1][0] : 0);
  document.getElementById("timeSlider").max = maxSimTime;
  document.getElementById("btnPlay").disabled = maxSimTime === 0;
  simTime = Math.min(simTime, maxSimTime);
}
syncTimeBounds(maxSimTime);

const lonToX = lon => (lon + 180) / 360 * W;
const latToY = lat => (90 - lat) / 180 * H;

function drawWrappedLine(lon1, lat1, lon2, lat2, color, width, alpha = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  if (Math.abs(lon1 - lon2) <= 180) {
    ctx.moveTo(lonToX(lon1), latToY(lat1));
    ctx.lineTo(lonToX(lon2), latToY(lat2));
  } else {
    const lon2Adj = lon2 < lon1 ? lon2 + 360 : lon2 - 360;
    const boundaryLon = lon2 < lon1 ? 180 : -180;
    const t = (boundaryLon - lon1) / (lon2Adj - lon1);
    const latMid = lat1 + t * (lat2 - lat1);
    ctx.moveTo(lonToX(lon1), latToY(lat1));
    ctx.lineTo(lonToX(boundaryLon), latToY(latMid));
    ctx.moveTo(lonToX(-boundaryLon), latToY(latMid));
    ctx.lineTo(lonToX(lon2), latToY(lat2));
  }
  ctx.stroke();
  ctx.restore();
}

function drawFootprint(latDeg, lonDeg, altKm) {
  const Re = 6371, el = ORBIT_CFG.minEl * DEG;
  const psi = Math.acos(Math.min(1, Re / (Re + altKm) * Math.cos(el))) - el;
  const lat0 = latDeg * DEG, lon0 = lonDeg * DEG;
  ctx.save();
  ctx.strokeStyle = "rgba(240,196,25,0.65)";
  ctx.fillStyle = "rgba(240,196,25,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  let prevLon = null, wrapped = false;
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const brg = (i / 48) * TWOPI;
    const sLat = Math.sin(lat0) * Math.cos(psi) + Math.cos(lat0) * Math.sin(psi) * Math.cos(brg);
    const lat = Math.asin(Math.max(-1, Math.min(1, sLat)));
    const y = Math.sin(brg) * Math.sin(psi) * Math.cos(lat0);
    const x = Math.cos(psi) - Math.sin(lat0) * sLat;
    let lon = (lon0 + Math.atan2(y, x)) * RAD;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) wrapped = true;
    prevLon = lon;
    pts.push([lonToX(lon), latToY(lat * RAD)]);
  }
  if (!wrapped) {
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function upperBoundTime(t, data = routes) {
  if(data.upperBound)return data.upperBound(t);
  let lo = 0, hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid][0] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function recentRoutes(data, time, limit) {
  const src = srcFilter.value, dst = parseInt(dstFilter.value, 10);
  if(data.recent)return data.recent(time,src,dst,limit,ORBIT_CFG.routeLifetime);
  const found = [];
  for (let i = upperBoundTime(time, data) - 1; i >= 0 && found.length < limit; i--) {
    const r = data[i];
    if (time - r[0] > ORBIT_CFG.routeLifetime) break;
    const key = (r[7] ? "T:" : "GS:") + r[2];
    if ((src === "-1" || key === src) && (dst === -1 || r[3] === dst)) found.push(r);
  }
  return found;
}

function playbackTime(time) {
  return time.toFixed(Math.min(5, Math.max(1, Math.ceil(-Math.log10(speed)))));
}

let mapZoom = 1, mapOffsetX = 0, mapOffsetY = 0, mapDrag = null;
function mapPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / W, rect.height / H);
  if (!scale) return null;
  const x = (event.clientX - rect.left - (rect.width - W * scale) / 2) / scale;
  const y = (event.clientY - rect.top - (rect.height - H * scale) / 2) / scale;
  return {x,y,scale,inside:x>=0 && x<=W && y>=0 && y<=H,
          worldX:(x-mapOffsetX)/mapZoom,worldY:(y-mapOffsetY)/mapZoom};
}
function moveMap(x,y) {
  mapOffsetX = Math.max(W * (1-mapZoom), Math.min(0,x));
  mapOffsetY = Math.max(H * (1-mapZoom), Math.min(0,y));
  canvas.classList.toggle("zoomed",mapZoom>1);
  tooltip.hidden = true;
  render();
}

function render() {
  ctx.save();
  ctx.setTransform(mapZoom,0,0,mapZoom,mapOffsetX,mapOffsetY);
  ctx.fillStyle = "#0d2240";
  ctx.fillRect(0, 0, W, H);
  if (earthImg.complete && earthImg.naturalWidth) ctx.drawImage(earthImg, 0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = lonToX(lon);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = latToY(lat);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const mapTime = simTime;
  const snapshot = stateAt(mapTime);
  const sats = snapshot ? snapshot.nodes.slice(0, snapshot.numSats).map((p, idx) => ({ idx, lat: p[0], lon: p[1], alt: p[2] })) : [];
  const stStates = snapshot ? snapshot.nodes.slice(snapshot.numSats, snapshot.numSats + snapshot.numStations).map((p, id) => {
    const st = STATIONS.find(s => s.id === id) || { id, name: `GS${id}`, mobile: false };
    return { ...st, lat: p[0], lon: p[1], alt: p[2] };
  }) : [];
  const terminalStates = snapshot ? snapshot.nodes.slice(snapshot.numSats + snapshot.numStations).map((p, id) => ({ id, lat: p[0], lon: p[1], alt: p[2] })) : [];
  displayedSnapshot = snapshot;
  lastSatStates = sats; lastStationStates = stStates;
  if(typeof drawScenarioOverlay === "function")drawScenarioOverlay(snapshot,mapTime);
  const gslLinks = [], gslSatSet = new Set();
  let islCount = 0;
  if (snapshot) for (const [a, b, kind] of snapshot.links) {
    const from = snapshot.nodes[a], to = snapshot.nodes[b];
    if (!from || !to) continue;
    if (kind < 2) {
      islCount++;
      if (document.getElementById("chkIsl").checked) drawWrappedLine(from[1], from[0], to[1], to[0], (snapshot.linkEffects?.get(`${a}:${b}`)?.rho>0||snapshot.linkEffects?.get(`${b}:${a}`)?.rho>0)?"#ff9d47":kind === 0 ? "#4f8fd6" : "#9aa4b1", 1, 0.7);
    } else {
      gslLinks.push([a, b]); gslSatSet.add(b);
      if (document.getElementById("chkGsl").checked) drawWrappedLine(from[1], from[0], to[1], to[0], kind === 3 ? "#00d0ff" : "#22b14c", 2, 0.9);
    }
  }
  if (document.getElementById("chkFoot").checked) for (const idx of gslSatSet) {
    const sat = sats[idx]; if (sat) drawFootprint(sat.lat, sat.lon, sat.alt);
  }

  const routeLifetime = ORBIT_CFG.routeLifetime;
  const maxRoutes = Math.max(0, ORBIT_CFG.maxRoutes);
  const endIdx = upperBoundTime(simTime);
  const windowRoutes = recentRoutes(routes, simTime, 40);
  displayedRoute = selectedRouteId == null ? null : windowRoutes.find(row => row[1] === selectedRouteId);
  const drawnRoutes = windowRoutes.slice(0, maxRoutes).reverse();
  const activeSatSet = new Set();

  if (snapshot && document.getElementById("chkRoutes").checked) {
    drawnRoutes.forEach((r, idx) => {
      const [t, rId, srcId, dstId, hops, ms, path, srcIsTerm] = r;
      const srcSt = srcIsTerm ? terminalStates.find(s => s.id === srcId) : stStates.find(s => s.id === srcId);
      const dstSt = stStates.find(s => s.id === dstId);
      if (!srcSt || !dstSt || path.some(id => !sats[id])) return;
      const age = Math.max(0, mapTime - t);
      const alpha = selectedRouteId === rId ? 1.0 : Math.max(0.15, 1.0 - age / routeLifetime);
      const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
      const width = selectedRouteId === rId ? 6 : 4;
      const pts = [[srcSt.lon, srcSt.lat]];
      path.forEach(satIdx => {
        if (sats[satIdx]) {
          activeSatSet.add(satIdx);
          pts.push([sats[satIdx].lon, sats[satIdx].lat]);
        }
      });
      pts.push([dstSt.lon, dstSt.lat]);
      for (let i = 1; i < pts.length; i++) {
        drawWrappedLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], color, width, alpha);
      }
      if (document.getElementById("chkLabels").checked) {
        ctx.save();
        ctx.font = "bold 20px sans-serif";
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fillText(`${srcSt.name} -> ${dstSt.name}  ${hops} ISL hops  ${ms.toFixed(1)} ms`, lonToX(pts[0][0]) + 12, latToY(pts[0][1]) - 14);
        ctx.restore();
      }
    });
  }

  for (const s of sats) {
    ctx.beginPath();
    ctx.arc(lonToX(s.lon), latToY(s.lat), 4, 0, TWOPI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    if (activeSatSet.has(s.idx)) {
      ctx.strokeStyle = "orange";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  for (const tm of terminalStates) {
    ctx.beginPath();
    ctx.arc(lonToX(tm.lon), latToY(tm.lat), 3.5, 0, TWOPI);
    ctx.fillStyle = "#ffe066";
    ctx.fill();
  }

  const showLabels = document.getElementById("chkLabels").checked;
  for (const st of stStates) {
    const x = lonToX(st.lon), y = latToY(st.lat);
    ctx.save();
    if (!st.mobile) {
      ctx.fillStyle = "#ff4040";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    } else {
      ctx.fillStyle = "#00d0ff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x - 7, y + 6);
      ctx.lineTo(x + 7, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (showLabels) {
      ctx.font = "bold 20px sans-serif";
      ctx.fillStyle = st.mobile ? "#7fe8ff" : "#ffffff";
      ctx.fillText(st.name, x + 16, y + 18);
    }
    ctx.restore();
  }

  ctx.restore();
  let sumMs = 0, sumHops = 0;
  if(routes.sumsAt)[sumHops,sumMs]=routes.sumsAt(endIdx);
  else for (let i = 0; i < endIdx; i++) { sumHops += routes[i][4]; sumMs += routes[i][5]; }
  const avgMs = endIdx ? (sumMs / endIdx).toFixed(1) : "0.0";
  const avgHops = endIdx ? (sumHops / endIdx).toFixed(1) : "0.0";

  document.getElementById("mapTime").textContent = `${playbackTime(mapTime)} s`;
  document.getElementById("mapSatellites").textContent = snapshot ? `${sats.length.toLocaleString("ko-KR")}기` : "—";
  document.getElementById("mapIsl").textContent = snapshot ? `${islCount.toLocaleString("ko-KR")}개` : "—";
  document.getElementById("mapGroundLinks").textContent = snapshot ? `${gslLinks.length.toLocaleString("ko-KR")}개` : "—";
  document.getElementById("mapRouting").textContent = `${scenarioName(resultMeta?.config.activeConfig || previewConfig?.activeConfig || "CSV", (resultMeta?.config || previewConfig)?.displayName)} · ${algorithmName(resultMeta?.config||previewConfig)}${resultMeta?.summary?.experimental?" · 환경/실험 설정":""}`;
  document.getElementById("mapSample").textContent = snapshot && !resultMeta ? "설정 미리보기 · 실행 결과와 별도" : snapshot ? (snapshot.reconstructed ? "설정 기반 재현 · 기록된 경로" : `Engine sample: ${snapshot.t.toFixed(3)} s | no interpolation`) : "No engine state for this data";

  document.getElementById("timeLabel").textContent = `t = ${playbackTime(simTime)} s`;
  document.getElementById("timeSlider").value = simTime;
  document.getElementById("kpiPkts").textContent = endIdx.toLocaleString("ko-KR");
  document.getElementById("kpiDelay").textContent = endIdx ? avgMs + " ms" : "—";
  document.getElementById("kpiHops").textContent = endIdx ? avgHops : "—";
  document.getElementById("activeCount").textContent = `최근 ${routeLifetime}초 · 최대 25개`;

  const tbody = document.querySelector("#routeTable tbody");
  tbody.innerHTML = windowRoutes.slice(0, 25).map(r => {
    const [t, rId, srcId, dstId, hops, ms, path, srcIsTerm] = r;
    const dstSt = stStates.find(s => s.id === dstId) || STATIONS.find(s => s.id === dstId);
    const srcTag = srcIsTerm ? `T${srcId}` : `GS${srcId}`;
    const dstTag = (dstSt && dstSt.mobile) ? `M${dstId}` : `GS${dstId}`;
    const sel = selectedRouteId === rId ? " class='selected'" : "";
    return `<tr data-id="${rId}" data-t="${t}"${sel}>
      <td>${playbackTime(t)}s</td>
      <td>${srcTag}→${dstTag}</td>
      <td>${hops}</td>
      <td title="First satellite: ${r[8]}; exit satellite: ${r[9]}; uplink: ${r[10]} ms; satellite-to-station: ${r[11]} ms; total: ${ms} ms">${ms.toFixed(1)}ms</td>
      <td class="path-cell" title="${path.join("-")}">${path.join("-")}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="5">이 시간대에 기록된 경로가 없습니다.</td></tr>';
  if (hoverPoint) updateNodeTooltip(hoverPoint);
}

function loop(ts) {
  if (playing) {
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
    simTime = Math.min(maxSimTime, simTime + dt * speed);
    if (simTime >= maxSimTime) { playing = false; document.getElementById("btnPlay").textContent = "▶ 재생"; }
    render();
  }
  lastFrame = ts;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.getElementById("btnPlay").onclick = e => {
  if (!playing && simTime >= maxSimTime) simTime = 0;
  playing = !playing;
  e.target.textContent = playing ? "⏸ 일시정지" : "▶ 재생";
};
document.getElementById("btnStepBack").onclick = () => { simTime = Math.max(0, simTime - 1); render(); };
document.getElementById("btnStepFwd").onclick = () => { simTime = Math.min(maxSimTime, simTime + 1); render(); };
document.getElementById("btnSnap").onclick = () => { simTime = 0; selectedRouteId = null; render(); };
document.getElementById("timeSlider").oninput = e => { simTime = parseFloat(e.target.value); render(); };
const speedSelect = document.getElementById("speedSel");
const speedCustom = document.getElementById("speedCustom");
const speedInput = document.getElementById("speedInput");
const speedError = document.getElementById("speedError");
speedSelect.onchange = () => {
  speedCustom.hidden = speedSelect.value !== "custom";
  speedError.hidden = true;
  speedInput.removeAttribute("aria-invalid");
  if (speedCustom.hidden) { speed = Number(speedSelect.value); render(); }
  else { speedInput.value = String(speed); speedInput.focus(); speedInput.select(); }
};
function applyCustomSpeed() {
  const text = speedInput.value.trim().replace(",", ".");
  const next = Number(text);
  const valid = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) && next >= 0.00001 && next <= 60;
  speedError.hidden = valid;
  if (!valid) { speedInput.setAttribute("aria-invalid", "true"); return; }
  speedInput.removeAttribute("aria-invalid");
  speed = next;
  speedInput.value = String(speed);
  render();
}
speedInput.onchange = applyCustomSpeed;
speedInput.onkeydown = event => {
  if (event.key === "Enter") applyCustomSpeed();
  if (event.key === "Escape") { speedInput.value = String(speed); applyCustomSpeed(); }
};

const mapFocusButton = document.getElementById("btnMapFocus");
const sidePanel = document.getElementById("sidePanel");
mapFocusButton.onclick = () => {
  sidePanel.hidden = !sidePanel.hidden;
  mapFocusButton.setAttribute("aria-expanded", String(!sidePanel.hidden));
  mapFocusButton.textContent = sidePanel.hidden ? "패널 열기" : "지도 크게 보기";
  tooltip.hidden = true;
  render();
};
const panelDivider = document.getElementById("panelDivider");
const mapLayout = panelDivider.parentElement;
function panelWidthLimits() {
  return [300, Math.min(850, Math.floor(mapLayout.clientWidth - 368))];
}
function describePanelWidth() {
  if (!panelDivider.checkVisibility()) return;
  const [min, max] = panelWidthLimits();
  panelDivider.setAttribute("aria-valuemin", min);
  panelDivider.setAttribute("aria-valuemax", max);
  panelDivider.setAttribute("aria-valuenow", Math.round(sidePanel.getBoundingClientRect().width));
}
function resizePanel(value) {
  const [min, max] = panelWidthLimits();
  mapLayout.style.setProperty("--panel-width", Math.min(max, Math.max(min, value)) + "px");
  tooltip.hidden = true;
  describePanelWidth();
}
panelDivider.onpointerdown = event => {
  if (event.button !== 0) return;
  panelDivider.focus();
  panelDivider.setPointerCapture(event.pointerId);
};
panelDivider.onpointermove = event => {
  if (panelDivider.hasPointerCapture(event.pointerId)) resizePanel(mapLayout.getBoundingClientRect().right - event.clientX);
};
panelDivider.onkeydown = event => {
  const [min, max] = panelWidthLimits();
  const width = sidePanel.getBoundingClientRect().width;
  const choices = {ArrowLeft: width + 24, ArrowRight: width - 24, Home: min, End: max};
  if (!Object.hasOwn(choices, event.key)) return;
  event.preventDefault();
  resizePanel(choices[event.key]);
};
new ResizeObserver(describePanelWidth).observe(sidePanel);

["chkIsl", "chkGsl", "chkFoot", "chkRoutes", "chkLabels", "srcFilter", "dstFilter"].forEach(id => {
  document.getElementById(id).onchange = () => render();
});

document.querySelector("#routeTable tbody").onclick = e => {
  const tr = e.target.closest("tr");
  if (!tr?.dataset.id) return;
  selectedRouteId = parseInt(tr.dataset.id, 10);
  simTime = parseFloat(tr.dataset.t);
  render();
};

// Hover Tooltip on Map (accounts for object-fit: contain letterboxing)
const tooltip = document.getElementById("tooltip");
function stationWindow(series, id, t, limit) {
  // The engine samples at whole seconds and closes the last partial window at the run limit.
  const end = t >= limit ? limit : Math.floor(t);
  if (!(end > 0)) return null;
  let lo = 0, hi = series.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (series[mid][0] < end) lo = mid + 1; else hi = mid;
  }
  let sent = 0, received = 0, delay = 0;
  const sources = [];
  for (let i = lo; i < series.length && series[i][0] === end; i++) {
    const [, src, dst, tx, rx, , , ms] = series[i];
    if (src === id) sent += tx;
    if (dst === id && rx) { received += rx; delay += rx * ms; sources.push(src); }
  }
  return {start:Math.ceil(end)-1,end,sent,received,delay:received ? delay/received : null,sources};
}
function updateNodeTooltip(e) {
  const point = mapPoint(e);
  if (!point?.inside || mapDrag) { tooltip.hidden = true; return; }
  const near = (node,radius) => Math.hypot(lonToX(node.lon)-point.worldX,latToY(node.lat)-point.worldY) < radius/mapZoom;
  const station = lastStationStates.find(st => near(st,14));
  const sat = station ? null : lastSatStates.find(s => near(s,10));
  if (!station && !sat) { tooltip.hidden = true; return; }
  const node = station || sat;
  const lines = [station ? (station.mobile ? "이동 노드 " : "지상국 ") + station.id + " · " + station.name : "위성 " + sat.idx];
  if (station) {
    const cfg = (resultMeta?.config || previewConfig)?.stations?.find(st => st.id === station.id);
    if (cfg?.enabled) {
      const dest = cfg.dstStation >= 0 ? "노드 "+cfg.dstStation : cfg.dstType === "mobile" ? "이동 노드 중 선택" : "대상 노드 중 선택";
      lines.push("송신 설정 · "+dest, cfg.packetSize+" B · "+cfg.sendInterval+"초 간격");
    }
    if (resultMeta?.summary && Array.isArray(resultMeta.series)) {
      const w = stationWindow(resultMeta.series,station.id,simTime,resultMeta.config.simTimeLimit);
      if (!w) lines.push("첫 집계 전");
      else {
        lines.push(w.start+"–"+w.end+"초 · 송신 "+w.sent+"개 / 수신 "+w.received+"개");
        if (w.sources.length) lines.push("출발지 "+(w.sources.length===1 ? "노드 "+w.sources[0] : w.sources.length+"곳"));
        lines.push("종단 간 평균 지연 "+(w.delay === null ? "—" : w.delay.toFixed(2)+" ms"));
      }
    }
  } else {
    let isl=0,ground=0;
    for (const [a,b,kind] of displayedSnapshot.links) {
      if (a!==sat.idx && b!==sat.idx) continue;
      if (kind<2) isl++; else ground++;
    }
    lines.push("위성 간 연결 "+isl+"개 · 지상 연결 "+ground+"개");
    const failed=[];
    for (const key of displayedSnapshot.downLinks || []) {
      const [a,b]=key.split(":").map(Number);
      if (a===sat.idx || b===sat.idx) failed.push(a===sat.idx ? b : a);
    }
    if (failed.length) lines.push("단절 상대 위성 "+failed.slice(0,4).join(", ")+(failed.length>4?" 외 "+(failed.length-4)+"기":""));
    const path=displayedRoute?.[6], index=path?.indexOf(sat.idx) ?? -1;
    if (index>=0) {
      const prev=index ? "위성 "+path[index-1] : "출발 "+displayedRoute[2];
      const next=index+1<path.length ? "위성 "+path[index+1] : "도착 "+displayedRoute[3];
      lines.push("선택 경로 · "+prev+" → 현재 → "+next);
    }
    const info=displayedSnapshot.knowledge?.get(sat.idx);
    if(info) lines.push("CSIB v"+info.version+" · "+info.dataTime.toFixed(3)+"초");
  }
  lines.push("위도 "+node.lat.toFixed(2)+"° · 경도 "+node.lon.toFixed(2)+"°"+(sat?" · "+sat.alt.toFixed(0)+" km":""));
  tooltip.textContent=lines.join("\n");
  tooltip.hidden=false;
  const wrap=tooltip.parentElement.getBoundingClientRect();
  const x=e.clientX-wrap.left,y=e.clientY-wrap.top;
  tooltip.style.left=Math.max(0,x+12+tooltip.offsetWidth<=wrap.width?x+12:x-tooltip.offsetWidth-12)+"px";
  tooltip.style.top=Math.max(0,y+12+tooltip.offsetHeight<=wrap.height?y+12:y-tooltip.offsetHeight-12)+"px";
}
canvas.onmousemove = e => { hoverPoint={clientX:e.clientX,clientY:e.clientY}; updateNodeTooltip(hoverPoint); };
canvas.onmouseleave = () => { hoverPoint=null; tooltip.hidden = true; };

canvas.addEventListener("wheel", event => {
  const point = mapPoint(event);
  if (!point?.inside || mapDrag || !event.deltaY) return;
  event.preventDefault();
  const next = Math.max(1, Math.min(8, mapZoom * (event.deltaY < 0 ? 1.25 : .8)));
  mapZoom = Math.abs(next-1)<1e-8 ? 1 : next;
  moveMap(point.x-point.worldX*mapZoom, point.y-point.worldY*mapZoom);
}, {passive:false});
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || mapZoom === 1 || nativeUI.drawing) return;
  const point = mapPoint(event);
  if (!point?.inside) return;
  mapDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, scale:point.scale,
             offsetX:mapOffsetX, offsetY:mapOffsetY};
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("panning");
  tooltip.hidden = true;
});
canvas.addEventListener("pointermove", event => {
  const drag = mapDrag;
  if (drag?.id !== event.pointerId) return;
  moveMap(drag.offsetX+(event.clientX-drag.x)/drag.scale, drag.offsetY+(event.clientY-drag.y)/drag.scale);
});
canvas.addEventListener("lostpointercapture", event => {
  if (mapDrag?.id !== event.pointerId) return;
  mapDrag = null;
  canvas.classList.remove("panning");
});

// ---- Local Backend API Integration (server.py) ----
const runStatus = document.getElementById("runStatus");
function setStatus(msg) {
  runStatus.hidden = !msg;
  runStatus.textContent = msg;
  if (!runActivity.classList.contains("running")) showRunActivity(msg);
}

const ALGORITHM_NAMES={"dijkstra-delay":"Dijkstra · 지연 최소","dijkstra-hop":"Dijkstra · 홉 최소","mcsr-ls":"MCSR · 지연 우선 (LS)","mcsr-ts":"MCSR · 처리량 우선 (TS)","mcsr-hr":"MCSR · 신뢰성 우선 (HR)"};
let configuredScenarios = [];
function scenarioName(name, displayName){
  return displayName || configuredScenarios.find(c => c.name === name)?.displayName || name || "결과를 선택하세요";
}
function algorithmName(cfg){return ALGORITHM_NAMES[cfg?.algorithm]||cfg?.algorithm||ALGORITHM_NAMES["dijkstra-"+(cfg?.metric||"delay")];}
let selectedConfig=null,configSaving=false,configLoading=false;
function populateConfigChoices(cfg){
  const all=document.getElementById("showAllConfigs").checked;
  cfgNameSel.replaceChildren();
  const choices = configuredScenarios.length ? configuredScenarios : cfg.configs || [];
  const active = choices.some(c => c.name === cfg.activeConfig) ? cfg.activeConfig : choices[0]?.name;
  for(const c of choices){
    if(!all && c.additional && c.name !== active)continue;
    const opt=new Option(scenarioName(c.name, c.displayName),c.name);opt.title=c.name;cfgNameSel.add(opt);
  }
  cfgNameSel.value=active || "";
}
document.getElementById("showAllConfigs").onchange=()=>{if(selectedConfig)populateConfigChoices(selectedConfig);};
// This changes only the algorithm in the selected INI section, never the recorded result.
document.getElementById("algorithmChoice").onchange=async event=>{
  if(configSaving||configLoading||!selectedConfig)return;
  const cfg=selectedConfig,algorithm=event.target.value;
  const controls=[cfgNameSel,event.target,...["btnRunSim","btnExperiment","btnSettings","btnRefreshIni","btnOpenIni","showAllConfigs"].map(id=>document.getElementById(id))];
  const states=controls.map(e=>e.disabled);configSaving=true;controls.forEach(e=>e.disabled=true);
  try{
    const response=await fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({configName:cfg.activeConfig,changes:{algorithm}})});
    const result=await response.json();if(!response.ok)throw Error(result.error||"알고리즘을 저장하지 못했습니다.");
    applyLoadedConfig(result,{announce:true});
  }catch(error){event.target.value=cfg.algorithm;setStatus(error.message);}
  finally{configSaving=false;controls.forEach((e,i)=>e.disabled=states[i]);}
};

function scenarioMeaning(cfg){
  const notes=[];
  const replay=cfg.failureReplayEvents?.length>0||!!cfg.failureReplay;
  if(cfg.failureSchedule&&!replay){
    const events=cfg.failureSchedule.split(/[;,\s]+/).map(item=>item.match(/^(route|\d+-\d+)@([0-9.eE+-]+?)(?:\+([0-9.eE-]+))?$/)).filter(Boolean);
    if(events.length){
      const targets=events.every(e=>e[1]==="route")?"기준 경로의 위성 간 링크를": "지정된 위성 간 링크를";
      const timing=events.map(([,target,start,duration])=>`${target==="route"?"":target+"번 · "}${start}초부터 ${Number(duration)>0?duration+"초간":"종료까지"}`);
      const commonDuration=events.every(e=>e[1]==="route"&&e[3]===events[0][3]);
      const schedule=commonDuration?`${events.map(e=>e[2]).join("·")}초에 각각 ${Number(events[0][3])>0?events[0][3]+"초간":"종료까지"}`:timing.join(", ");
      notes.push(`${targets} ${schedule} 끊어 우회 경로와 수신 재개를 확인합니다.`);
    }else notes.push("등록한 일정에 따라 위성 간 링크를 끊고 우회 경로와 수신 재개를 확인합니다.");
  }
  if(cfg.randomFailures>0&&!replay)notes.push(`${cfg.randomStart}~${cfg.randomEnd}초 사이에 링크 장애 ${cfg.randomFailures}건을 무작위로 발생시킵니다. ${cfg.randomDuration>0?`각 장애는 ${cfg.randomDuration}초 뒤 해제됩니다.`:"설정한 자동 복구 시각이 없습니다."} 같은 장애 시드는 같은 일정을 만듭니다.`);
  if(replay)notes.push("가져온 파일의 링크 장애 일정을 재현합니다.");
  if(cfg.scenario?.failure_events?.length)notes.push("시나리오 파일에 등록한 장애 일정도 적용합니다.");
  if(cfg.congestionMode==="environment")notes.push("설정한 외부 혼잡 효과를 적용해 전달률과 지연 변화를 확인합니다.");
  if(notes.length)return notes.join(" ");
  if(!cfg.activeConfig)return "";
  const senders=cfg.stations?.filter(s=>s.enabled)||[];
  if(senders.length===1&&senders[0].dstStation>=0){
    const sender=senders[0],destination=cfg.stations.find(s=>s.id===sender.dstStation);
    if(destination)return `${sender.name} → ${destination.name} 단일 흐름의 경로와 수신 결과를 확인합니다.`;
  }
  return senders.length?`${senders.length}개 송신 노드에서 발생하는 패킷의 경로·전달률·지연을 확인합니다.`:"";
}

function updateProfileBox(cfg) {
  const meaning=document.getElementById("scenarioMeaning");
  meaning.textContent=scenarioMeaning(cfg);
  meaning.hidden=!meaning.textContent;
  document.getElementById("savedConfigName").textContent = scenarioName(cfg.activeConfig, cfg.displayName);
  const entries = cfg.effectiveEntries || [];
  const value = key => entries.find(e => e.k === key)?.v;
  document.getElementById("scenarioConstellation").textContent = cfg.numSatellites == null ? "—" : `${cfg.numSatellites}기 · ${cfg.planes}개 궤도면`;
  document.getElementById("scenarioOrbit").textContent = cfg.altitude == null ? "—" : `${cfg.altitude} km · ${cfg.inclination}°`;
  document.getElementById("scenarioDuration").textContent = cfg.simTimeLimit == null ? "—" : `${cfg.simTimeLimit.toLocaleString("ko-KR")}초`;
  const routing = { delay: "지연 최소", hop: "홉 수 최소" };
  document.getElementById("scenarioRouting").textContent = ({"mcsr-ls":"MCSR · 지연 우선 (LS)","mcsr-ts":"MCSR · 처리량 우선 (TS)","mcsr-hr":"MCSR · 신뢰성 우선 (HR)"})[cfg.algorithm] || routing[cfg.metric] || cfg.metric || "—";
  const interval = value("*.station[*].traffic.sendInterval");
  const size = value("*.station[*].traffic.packetSize");
  document.getElementById("scenarioTraffic").textContent = interval && size ? `${interval} · ${size}` : (cfg.activeConfig ? "노드별 설정" : "—");
  const iniSrc = document.getElementById("cfgIniSrc");
  if (cfg.iniPath) {
    iniSrc.textContent = cfg.iniPath.startsWith("config/") ? `보관된 설정: ${cfg.iniPath}` : cfg.leoFound ? cfg.iniPath : `⚠️ 내장 백업: ${cfg.iniPath}`;
    iniSrc.title = cfg.iniPath;
  } else if (!location.protocol.startsWith("http")) {
    iniSrc.textContent = "ℹ️ 로컬 HTML 모드";
    iniSrc.style.color = "#8da2c0";
  }


}

function applyLoadedConfig(cfg, opts = {}) {
  if (!cfg) return;
  if(Object.hasOwn(cfg.capabilities||{},"userWorkspace")){
    document.getElementById("workspaceSettings").hidden=!cfg.capabilities.userWorkspace;
    document.getElementById("workspacePath").textContent=cfg.workspacePath||"";
    if(!workspaceChangePending)setWorkspaceNotice(cfg.workspaceNotice||"");
  }
  if (!opts.result) configuredScenarios = cfg.configs || [];
  selectedConfig=cfg;
  const algorithmChoice=document.getElementById("algorithmChoice");
  algorithmChoice.replaceChildren();
  for(const [id,label]of Object.entries(cfg.capabilities?.algorithms||ALGORITHM_NAMES))algorithmChoice.add(new Option(ALGORITHM_NAMES[id]||label,id));
  algorithmChoice.value=cfg.algorithm||"dijkstra-"+(cfg.metric||"delay");
  if (Array.isArray(cfg.configs) && cfg.configs.length) {
    populateConfigChoices(cfg);
    cfgNameSel.dataset.loaded = "1";
  }

  const configKey = JSON.stringify([cfg.activeConfig, cfg.effectiveEntries]);
  const resultKey = resultMeta ? JSON.stringify([resultMeta.config.activeConfig, resultMeta.config.effectiveEntries]) : "";
  const showingPreviousRun = !!resultMeta && !opts.result && resultKey !== configKey;
  if (showingPreviousRun) {
    setStatus(`지도에는 [${scenarioName(resultMeta.config.activeConfig, resultMeta.config.displayName)} · ${algorithmName(resultMeta.config)}]의 마지막 실행 결과가 표시됩니다. 선택한 [${scenarioName(cfg.activeConfig, cfg.displayName)} · ${algorithmName(cfg)}] 설정을 반영하려면 실행하세요.`);
  }
  loadedConfigKey = configKey;
  if (opts.result || !resultMeta) {
  if(!resultMeta)previewConfig=cfg;
  updateOrbitConfig({ ...cfg, minEl: cfg.minimumElevation });
  if (Array.isArray(cfg.stations) || Array.isArray(cfg.terminals)) populateFilters();
  if (cfg.simTimeLimit) syncTimeBounds(cfg.simTimeLimit);
  }

  const active = resultMeta?.config.activeConfig || cfg.activeConfig || cfgNameSel.value;
  document.title = `LEO Network Simulator (${scenarioName(active, (resultMeta?.config || cfg).displayName)})`;


  window.dispatchEvent(new CustomEvent("sim-config",{detail:cfg}));
  updateProfileBox(cfg);

  if (opts.announce && !showingPreviousRun) {
    setStatus(`${scenarioName(cfg.activeConfig, cfg.displayName)} · ${algorithmName(cfg)} 설정을 불러왔습니다.`);
  }
  render();
}

updateProfileBox({});

if (location.protocol.startsWith("http")) {
  let configRequest = 0;
  const fetchConfig = (cfg, announce = false) => {
    const request = ++configRequest;
    configLoading=true;document.getElementById("algorithmChoice").disabled=true;
    return fetch(cfg ? `/api/config?config=${encodeURIComponent(cfg)}` : "/api/config", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("설정을 불러오지 못했습니다."); return r.json(); })
      .then(d => { if (request === configRequest) applyLoadedConfig(d, { announce }); })
      .catch(err => { if (request === configRequest) setStatus(err.message); })
      .finally(()=>{if(request===configRequest){configLoading=false;document.getElementById("algorithmChoice").disabled=configSaving||document.getElementById("btnRunSim").disabled;}});
  };
  const startup=++resultLoadRequest;
  fetchConfig().then(()=>fetch("/api/result?metadata=1",{cache:"no-store"})).then(r=>{if(!r.ok)throw Error("저장 결과를 불러오지 못했습니다.");return r.json();})
    .then(async result=>{if(startup!==resultLoadRequest)return;if(result?.bundle)await openResultBundle(result.bundle,startup);else if(result)installResult(result);})
    .catch(err=>{if(startup===resultLoadRequest)setStatus(`${err.message} 설정 미리보기를 유지합니다.`);});
  cfgNameSel.onchange = () => {++resultLoadRequest;return fetchConfig(cfgNameSel.value, true);};
  document.getElementById("btnRefreshIni").onclick = () => fetchConfig(cfgNameSel.value, true);
  window.addEventListener("focus", () => !configSaving&&fetchConfig(cfgNameSel.dataset.loaded ? cfgNameSel.value : "", false));
}

function setWorkspaceNotice(message){
  const notice=document.getElementById("workspaceNotice");
  notice.textContent=message;
  notice.hidden=!message;
}
async function changeWorkspace(reset){
  const controls=["btnSelectWorkspace","btnResetWorkspace"].map(id=>document.getElementById(id));
  controls.forEach(button=>button.disabled=true);
  try {
    const path=reset?null:await window.pywebview.api.choose_folder();
    if(!reset&&!path)return;
    const response=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({path})});
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    workspaceChangePending=true;
    setWorkspaceNotice(reset?"다시 열면 기본 위치를 사용합니다.":`다시 열면 ${path}에 저장합니다.`);
  } catch(error){setWorkspaceNotice(error.message);}
  finally{controls.forEach(button=>button.disabled=false);}
}
document.getElementById("btnSelectWorkspace").onclick=()=>changeWorkspace(false);
document.getElementById("btnResetWorkspace").onclick=()=>changeWorkspace(true);
document.getElementById("btnUserData").onclick=async()=>{
  try {
    const response=await fetch("/api/open-user-data",{method:"POST"});
    if(!response.ok)throw Error((await response.json()).error);
  } catch(error){setStatus(error.message);}
};
document.getElementById("btnOpenIni").onclick = async () => {
  if (location.protocol === "file:") {
    setStatus("INI 편집은 sim-ui.exe 또는 start_ui.bat에서 사용할 수 있습니다. HTML에 표시된 INI는 저장된 실행의 사본입니다.");
    return;
  }
  try {
    const res = await fetch("/api/open-ini", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "설정 파일을 열지 못했습니다.");
    setStatus(`새 실행 설정 편집: ${data.path} · 저장 후 설정 새로고침을 누르세요. 보관된 실행 결과는 변경되지 않습니다.`);
  } catch (err) { setStatus(err.message); }
};

let activeJob=null;
const runActivity = document.getElementById("runActivity");
const runActivityText = document.getElementById("runActivityText");
const runActivityDetail = document.getElementById("runActivityDetail");
const runProgress = document.getElementById("runProgress");

function showRunActivity(text, detail="", progress=null) {
  runActivity.hidden = !text;
  if (runActivityText.textContent !== text) runActivityText.textContent = text;
  runActivityDetail.textContent = detail;
  runProgress.hidden = progress === null;
  if (progress !== null) runProgress.value = progress;
}
function resourceWaitText(job) {
  if (!job.resourceLimited) return "";
  const wait = job.resourceWait;
  if (wait?.reason === "memory") {
    const gib = bytes => (bytes / 1073741824).toFixed(2);
    return "메모리 여유 " + gib(wait.availableBytes) + " / 필요 " + gib(wait.requiredBytes) + " GiB";
  }
  if (wait?.reason === "cpu") return "논리 프로세서 4개 미만 · 한 개씩 실행";
  if (wait?.reason === "unknown") return "메모리 확인 불가 · 한 개씩 실행";
  return "자원 여유 확인 중";
}
const retryButton = document.getElementById("btnRetryStatus");
const retryResult = document.getElementById("btnRetryResult");
async function runNative(algorithms=null,research=null) {
  if(runActivity.classList.contains("running"))return;
  if(configSaving||configLoading)return setStatus("설정을 반영하고 있습니다. 잠시 후 실행하세요.");
  if(!location.protocol.startsWith("http"))return setStatus("새 계산은 sim-ui.exe에서 실행하세요.");
  const btn=document.getElementById("btnRunSim"),compare=document.getElementById("btnExperiment"),stop=document.getElementById("btnStopSim");btn.disabled=true;compare.disabled=true;stop.hidden=false;stop.disabled=true;
  retryResult.hidden = true;
  runActivity.classList.add("running");
  const operation = algorithms ? "비교 실행" : "실행";
  showRunActivity(operation + " 준비 중…");
  const settingsControls=["cfgName","algorithmChoice","btnSettings","btnOpenIni","btnRefreshIni","showAllConfigs"].map(id=>document.getElementById(id)),settingsStates=settingsControls.map(e=>e.disabled);settingsControls.forEach(e=>e.disabled=true);
  try {
    let response=await fetch(algorithms?"/api/experiments":"/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({configName:cfgNameSel.value,...(algorithms?{algorithms,research}:{})})});
    let data=await response.json();
    if (!response.ok) {
      if (algorithms && data.error === "Invalid research options") {
        throw Error("현재 실행 중인 프로그램이 이전 버전입니다. 최신 배포 폴더의 sim-ui.exe를 다시 실행하세요.");
      }
      throw Error(data.error || "실행하지 못했습니다.");
    }
    activeJob=data.runId;
    stop.disabled=false;
    let missed = 0;
    for(;;){
      await new Promise(resolve=>setTimeout(resolve,500));
      let job;
      try {
        const status = await fetch(`/api/run/${activeJob}`, {cache:"no-store"});
        if (status.status === 404) { setStatus("실행 기록을 찾을 수 없습니다. 실행 결과 목록을 확인하세요."); break; }
        if (!status.ok) throw Error();
        job = await status.json();
        if (!job.status) throw Error();
        missed = 0;
      } catch {
        showRunActivity("실행 상태 연결 중…");
        if (++missed >= 3) {
          showRunActivity("실행 상태를 확인할 수 없습니다.");
          await new Promise(resolve => {
            retryButton.hidden = false;
            retryButton.onclick = resolve;
          });
          retryButton.hidden = true;
          retryButton.onclick = null;
          missed = 0;
        }
        continue;
      }
      if(job.error&&job.status!=="cancelled")throw Error(job.error);
      if(job.status==="completed"){
        stop.disabled=true;
        const id = algorithms ? job.completedRuns.at(-1).runId : job.runId;
        const load = async () => {
          setStatus("결과 불러오는 중…");
          showRunActivity("결과 불러오는 중…");
          const response = await fetch("/api/result?runId=" + encodeURIComponent(id) + "&metadata=1", {cache:"no-store"});
          if (!response.ok) throw Error();
          await openResultBundle((await response.json()).bundle);
          if (algorithms) {
            if(job.statistics) showExperimentStatistics(job.statistics);
            else document.getElementById("btnCompare").click();
          }
          setStatus(algorithms ? `비교 실행 완료 · ${job.completedRuns.length}개` : "계산 완료");
        };
        const openCompleted = async () => {
          retryResult.hidden = true;
          try { await load(); }
          catch { setStatus("계산 완료 · 결과를 열 수 없습니다."); retryResult.hidden = false; }
        };
        retryResult.onclick = openCompleted;
        await openCompleted();
        break;
      }
      if(job.status==="cancelled"){setStatus("계산을 중지했습니다. 이전 결과를 유지합니다.");break;}
      if(job.status==="failed")throw Error(job.error||"계산 실패");
      if (job.status === "stopping") { showRunActivity("계산을 중지하는 중…"); continue; }
      const completed = job.completedRuns?.length || 0;
      const total = job.totalRuns || 1;
      const running = job.activeRuns || [];
      const samples = Array.isArray(job.activeRuns) ? running.map(run => run.progress).filter(Boolean) : [job.progress].filter(Boolean);
      const fraction = completed || samples.length ? (completed + samples.reduce((sum, p) => sum + p.progress, 0)) / total : null;
      const detail = [algorithms ? "완료 " + completed + " / " + total : "",
        algorithms && running.length ? "동시 실행 " + running.length + "개" : "",
        resourceWaitText(job),
        fraction !== null ? Math.round(fraction * 100) + "%" : ""].filter(Boolean).join(" · ");
      showRunActivity(operation + (samples.length || running.length ? " 계산 중…" : " 준비 중…"), detail, fraction);
      setStatus(operation + (detail ? " · " + detail : " 준비 중…"));
    }
  }catch(error){setStatus(`실행 오류: ${error.message}`);}
  finally {settingsControls.forEach((e,i)=>e.disabled=settingsStates[i]);activeJob=null;btn.disabled=false;compare.disabled=false;stop.hidden=true;runActivity.classList.remove("running");showRunActivity(runStatus.textContent);}
}
document.getElementById("btnRunSim").onclick=()=>runNative();
document.getElementById("btnStopSim").onclick = async event => {
  if (!activeJob) return;
  const id = activeJob, button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch("/api/run/" + id + "/cancel", {method:"POST"});
    if (!response.ok) throw Error("중지 요청을 처리하지 못했습니다.");
    if (activeJob === id && runActivityText.textContent !== "결과 불러오는 중…") showRunActivity("계산을 중지하는 중…");
  } catch (error) {
    if (activeJob === id) { setStatus(error.message); button.disabled = false; showRunActivity(error.message); }
  }
};

render();

if (location.protocol === "file:") {
  const saved=()=>{const result=window.SIM_RESULT;if(!result)return;
    if(result.bundle?.fileUrls){const text=result.bundle.files?.[result.bundle.manifest.normalizedPath];if(text)applyLoadedConfig(JSON.parse(text));setStatus("대용량 결과입니다. 실행 결과 폴더를 선택하면 전체 경로를 읽습니다.");}
    else if(result.bundle)openResultBundle(result.bundle).catch(err=>setStatus(err.message));else installResult(result);
  };
  if(window.SIM_RESULT)saved();else{const script=document.createElement("script");script.src="data/latest_result.js?v=map-load-1";script.onload=saved;script.onerror=()=>setStatus("저장된 결과를 자동으로 읽지 못했습니다. 실행 결과 폴더를 선택하세요.");document.head.append(script);}
  document.getElementById("algorithmChoice").disabled=true;
  document.getElementById("showAllConfigs").closest("label").hidden=true;
  cfgNameSel.disabled = true;
  cfgNameSel.hidden = true;
  document.getElementById("savedConfigName").hidden = false;
  document.getElementById("cfgNameLabel").textContent = "시험 조건";
  document.getElementById("scenarioHeading").textContent = "실행 결과";
  document.getElementById("btnRefreshIni").hidden = true;
  document.getElementById("runnerActions").hidden = true;
  document.getElementById("runModeHint").hidden = false;
}

async function openResultBundle(bundle, request = ++resultLoadRequest) {
  const prepared = await prepareBundle(bundle,msg=>{if(request!==resultLoadRequest)throw Error("결과 선택이 변경되었습니다.");setStatus(msg);});
  if (request !== resultLoadRequest) return;
  const previous = { ...ORBIT_CFG, stations: STATIONS, terminals: TERMINALS };
  try {
    updateOrbitConfig({ ...prepared.config, minEl: prepared.config.minimumElevation });
    const trial = replaySnapshot(0);
    if (trial.nodes.some(p => !p.every(Number.isFinite))) throw new Error("설정으로 위치를 계산할 수 없습니다.");
  } catch (err) { updateOrbitConfig(previous); throw err; }
  installResult(prepared);
  if (prepared.notice) setStatus(prepared.notice);
  else if (bundle.manifest.provenance === "manual-import-unverified") setStatus("수동 등록 자료이므로 실행 당시 설정인지 확인해 주세요.");
}
const resultPicker = document.getElementById("resultDialog");
const resultList = document.getElementById("savedRuns");
const resultSearch = document.getElementById("resultSearch");
const resultMessage = document.getElementById("resultMessage");
const replayResultButton = document.getElementById("btnReplayResult");
const resultFolderInput = document.getElementById("resultFolder");
let savedResults = [];
let listRequest = 0;

function updateSavedSelection() {
  document.getElementById("savedRunId").textContent = resultList.value;
  replayResultButton.disabled = !resultList.value;
}
resultList.onchange = updateSavedSelection;
resultSearch.oninput = () => {
  const terms = resultSearch.value.toLowerCase().trim().split(/\s+/);
  resultList.replaceChildren();
  for (const row of savedResults) {
    if (terms.every(term => row.search.includes(term))) resultList.add(new Option(row.label, row.runId));
  }
  resultList.selectedIndex = resultList.length ? 0 : -1;
  resultMessage.textContent = resultList.length ? "" : "표시할 실행 결과가 없습니다.";
  updateSavedSelection();
};
document.getElementById("btnOpenResult").onclick = async () => {
  if (location.protocol === "file:") { resultFolderInput.click(); return; }
  const request = ++listRequest;
  savedResults = [];
  resultSearch.value = "";
  resultSearch.oninput();
  resultSearch.disabled = true;
  resultMessage.textContent = "저장된 결과를 찾는 중…";
  resultPicker.showModal();
  try {
    const response = await fetch("/api/runs?metadata=1", {cache:"no-store"});
    if (!response.ok) throw Error("보관 목록을 불러오지 못했습니다. 외부 폴더 열기를 이용하세요.");
    const rows = await response.json();
    if (request !== listRequest) return;
    savedResults = rows.map(row => {
      const date = new Date(row.createdAt);
      const time = row.createdAt && Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR") : "시각 기록 없음";
      const algorithm = row.algorithm ? algorithmName({algorithm:row.algorithm}) : "알고리즘 기록 없음";
      const label = [scenarioName(row.configName, row.displayName), algorithm, time].join(" · ");
      return {...row,label:label + " · " + row.runId.slice(-8),search:[label,row.configName,row.runId,row.algorithm].join(" ").toLowerCase()};
    });
    resultSearch.disabled = false;
    resultSearch.oninput();
    if (resultPicker.open) resultSearch.focus();
  } catch (error) { if (request === listRequest) resultMessage.textContent = error.message; }
  finally { if (request === listRequest) resultSearch.disabled = false; }
};
document.getElementById("btnBrowseResult").onclick = () => { resultPicker.close(); resultFolderInput.click(); };
replayResultButton.onclick = async () => {
  const id = resultList.value;
  if (!id) return;
  resultPicker.close();
  const request = ++resultLoadRequest;
  try {
    setStatus("실행 결과를 불러오는 중…");
    const response = await fetch("/api/result?runId=" + encodeURIComponent(id) + "&metadata=1", {cache:"no-store"});
    const payload = await response.json();
    if (!response.ok || !payload?.bundle) throw Error(payload?.error || "실행 결과가 없습니다.");
    await openResultBundle(payload.bundle, request);
  } catch (error) {
    if (request === resultLoadRequest) setStatus("결과를 불러오지 못했습니다: " + error.message + " 기존 화면을 유지합니다.");
  }
};
resultList.ondblclick = () => replayResultButton.click();
resultFolderInput.onchange = async e => {
  const selection = [...e.target.files]; e.target.value = "";
  if (!selection.length) return;
  const request = ++resultLoadRequest;
  try {
    const bundle=await bundleFromFiles(selection);
    await openResultBundle(bundle,request);
  } catch (err) { if (request === resultLoadRequest) setStatus(`결과를 불러오지 못했습니다: ${err.message} 기존 화면을 유지합니다.`); }
};
