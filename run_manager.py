# SPDX-License-Identifier: GPL-3.0-only
"""Local, owned native jobs; no external runner or account service."""
from pathlib import Path
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime,timezone
import csv
import ctypes
import hashlib
import json
import math
import os
import re
import subprocess
import threading
import time
import uuid
import tempfile
import copy

JOBS={}
LOCK=threading.Lock()
CONFIG_LOCK=threading.RLock()
NO_WIN=getattr(subprocess,'CREATE_NO_WINDOW',0)

from contextlib import contextmanager
from windows_runtime import launch_engine
from comparison import result_directory
import logging

logger = logging.getLogger('leo')


GIB = 1024**3
CRITICAL_MEMORY = GIB//2
CRITICAL_SECONDS = 5
EXECUTION_MODES = ('auto', 'sequential')
LOW_PRIORITY = NO_WIN | getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)

def process_memory(process):
    if os.name != 'nt':
        return 0, 0
    class Counters(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)]+[(name,ctypes.c_size_t) for name in ('peak','working','peakPaged','paged','peakNonpaged','nonpaged','pagefile','peakPagefile','private')]
    data=Counters();data.cb=ctypes.sizeof(data)
    if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(int(process._handle)),ctypes.byref(data),data.cb):
        return data.peak, max(data.private, data.peakPagefile)
    return 0, 0

def memory_bytes(process):
    return process_memory(process)[0]

def host_memory():
    if os.name != 'nt':
        return None
    class Status(ctypes.Structure):
        _fields_ = [('length', ctypes.c_uint32), ('load', ctypes.c_uint32)]+[
            (field, ctypes.c_uint64) for field in ('total','available','commitTotal','commitAvailable','virtual','availableVirtual','extended')]
    status = Status()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    return status.total, min(status.available, status.commitAvailable)

def cpu_seconds(process):
    if os.name != 'nt':
        return None
    times = [ctypes.c_uint64() for _ in range(4)]
    ok = ctypes.windll.kernel32.GetProcessTimes(ctypes.c_void_p(int(process._handle)), *(ctypes.byref(t) for t in times))
    return (times[2].value + times[3].value) / 1e7 if ok else None

def engine_memory_estimates(base, common, algorithms, *, results=None):
    from comparison import completed_manifest, fingerprint
    signature = fingerprint(common)
    estimates = {}
    for manifest in (result_directory(base,results)/'runs').glob('*/manifest.json'):
        try:
            data = completed_manifest(manifest.parent)
            algorithm = (data.get('algorithmSettings') or {}).get('algorithm')
            if data.get('environmentHash') != signature or algorithm not in algorithms:
                continue
            summary = json.loads(manifest.with_name('summary.json').read_text(encoding='utf-8'))
            peak = max(summary.get('peakMemoryBytes', 0), summary.get('hostExecution', {}).get('peakCommitBytes', 0))
            if peak > 0:
                estimates[algorithm] = max(estimates.get(algorithm, 0), math.ceil(peak * 1.25))
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    return estimates


def load_external_inputs(cfg,ini_path):
    def path(value):
        file=Path(value)
        return file if file.is_absolute() else Path(ini_path).parent/file
    if cfg.get('scenarioFile'):
        cfg['scenario']=json.loads(path(cfg['scenarioFile']).read_text(encoding='utf-8-sig'))
    scenario=cfg.get('scenario') or {}
    def valid_json(value):
        if isinstance(value,float) and not math.isfinite(value):raise ValueError('Non-finite scenario value')
        if isinstance(value,dict):
            for v in value.values():valid_json(v)
        elif isinstance(value,list):
            for v in value:valid_json(v)
    valid_json(scenario)
    if not isinstance(scenario,dict):raise ValueError('Invalid scenario object')
    entries=scenario.get('entries',[])
    if not isinstance(entries,list):raise ValueError('Invalid congestion scenario')
    for entry in entries:
        if not isinstance(entry,dict) or not isinstance(entry.get('target'),dict) or not isinstance(entry['target'].get('params',{}),dict):raise ValueError('Invalid scenario target')
        start=float(entry.get('start_s',0));end=entry.get('end_s');ramp=float(entry.get('ramp_s',0))
        if start<0 or start>=cfg['simTimeLimit'] or (end is not None and float(end)<=start) or ramp<0 or (end is not None and ramp>float(end)-start):raise ValueError('Invalid congestion time window')
        target=entry.get('target') or {};kind=target.get('kind');p=target.get('params') or {}
        if kind not in ('link','satellite','zone','region','path_hops'):raise ValueError('Unknown congestion target')
        n=cfg['numSatellites']
        for key in ('sat_a','sat_b','sat'):
            if key in p and (not isinstance(p[key],int) or not 0<=p[key]<n):raise ValueError('Invalid satellite ID')
        if kind=='satellite' and 'sat' not in p:raise ValueError('Missing satellite ID')
        if p.get('profile','uniform') not in ('uniform','hotspot') or not 0<=float(p.get('edge_pct',20))<=100:raise ValueError('Invalid region profile')
        if kind=='link' and (p.get('sat_a')==p.get('sat_b') or 'sat_a' not in p or 'sat_b' not in p):raise ValueError('Invalid target link')
        if p.get('direction','both') not in ('both','out','in') or p.get('link_rule','any') not in ('any','both'):raise ValueError('Invalid direction/rule')
        if kind=='link' and 'direction' in p:
            p['bidirectional']=p['direction']=='both'
            if p['direction']=='in':p['sat_a'],p['sat_b']=p['sat_b'],p['sat_a'];p['direction']='out'
        if kind=='path_hops':
            route=(scenario.get('baseline') or {}).get('route',[])
            if not isinstance(route,list) or any(type(v)!=int or not 0<=v<n for v in route) or not route or not 1<=p.get('hop_from',1)<=p.get('hop_to',1)<len(route):raise ValueError('Select a saved baseline route before selecting hops')
        shape=p.get('shape','rect')
        if kind=='region' or (kind=='zone' and p.get('zone_kind')=='latlon_box'):
            if shape=='circle':
                if not (-90<=float(p.get('center_lat',999))<=90 and -180<=float(p.get('center_lon',999))<=180 and 1<=float(p.get('radius_km',0))<=20000):raise ValueError('Invalid circular region')
            elif shape=='rect':
                if not (-90<=float(p.get('lat_min',999))<float(p.get('lat_max',-999))<=90 and -180<=float(p.get('lon_min',999))<=180 and -180<=float(p.get('lon_max',999))<=180 and p.get('lon_min')!=p.get('lon_max')):raise ValueError('Invalid rectangular region')
            else:raise ValueError('Unknown region shape')
        if kind=='zone':
            z=p.get('zone_kind')
            if z=='plane_range':
                if not 0<=p.get('plane_from',-1)<=p.get('plane_to',-1)<cfg['planes'] or not 0<=p.get('sat_from',-1)<=p.get('sat_to',-1)<n//cfg['planes']:raise ValueError('Invalid constellation zone')
            elif z=='srd':
                if not 0<=p.get('srd_from',-1)<=p.get('srd_to',-1)<n:raise ValueError('Invalid SRD range')
            elif z!='latlon_box':raise ValueError('Unknown zone type')
        if entry.get('fail'):
            if ramp or any(entry.get(k) for k in ('use_capacity','use_buffer','use_queue','penalty')):raise ValueError('Failure cannot be combined with congestion effects')
        else:
            if cfg['congestionMode']!='environment':raise ValueError('Environment effects require environment mode')
            pen=entry.get('penalty') or {}
            if not isinstance(pen,dict):raise ValueError('Invalid penalty')
            if not any(entry.get(k) for k in ('use_capacity','use_buffer','use_queue','penalty')):raise ValueError('Select a congestion effect')
            if not 0<float(entry.get('rho',.6))<1 or not 0<=float(pen.get('loss_pct',0))<=100 or float(pen.get('delay_ms',0))<0 or float(pen.get('jitter_ms',0))<0:raise ValueError('Invalid congestion effect')
    imported=scenario.get('failure_events',[])
    if not isinstance(imported,list):raise ValueError('Invalid failure events')
    cfg['failureReplayEvents']=list(imported)
    if cfg.get('congestionZones') and cfg['congestionMode']!='environment':raise ValueError('zones require environment mode')
    if cfg.get('failureReplay'):
        with path(cfg['failureReplay']).open(encoding='utf-8-sig',newline='') as file:
            rows=list(csv.DictReader(file))
        cfg['failureReplayEvents'] += [{'time':float(r['time']),'event':r['event'],'a':int(r['satA']),'b':int(r['satB'])} for r in rows]
    for e in cfg['failureReplayEvents']:
        if isinstance(e,dict) and e.get('event')=='fail':e['event']='failure'
        if not isinstance(e,dict) or e.get('event') not in ('failure','restore') or not 0<=float(e.get('time',-1))<=cfg['simTimeLimit'] or any(not isinstance(e.get(k),int) or not 0<=e[k]<cfg['numSatellites'] for k in ('a','b')) or e['a']==e['b']:raise ValueError('Invalid failure replay')
    cfg['failureReplayEvents'].sort(key=lambda e:e['time'])
    cfg['scheduledEvents']=list(scenario.get('scheduled_events',[])) if cfg.get('islMode')=='scheduled' else []
    if cfg.get('islMode')=='scheduled' and cfg.get('islScheduleFile'):
        with path(cfg['islScheduleFile']).open(encoding='utf-8-sig',newline='') as file:
            for row in csv.DictReader(file):cfg['scheduledEvents'].append({'time':float(row['time']),'event':row['event'],'a':int(row['satA']),'b':int(row['satB']),'cause':'scheduled'})
    if cfg.get('islMode')=='scheduled' and not cfg['scheduledEvents']:raise ValueError('Select an ISL schedule')
    n=cfg['numSatellites'];planes=cfg['planes'];per=n//planes;edges=set()
    for u in range(n):
        q,j=divmod(u,per)
        for enabled,v in [(not cfg['intraDisabled'],q*per+(j+1)%per),(not cfg['interDisabled'],(j+cfg['phasing'])%per if q==planes-1 else (q+1)*per+j)]:
            if enabled:edges.add(tuple(sorted((u,v))))
    for e in cfg['scheduledEvents']+cfg['failureReplayEvents']:
        e['event']={'fail':'failure','down':'failure','up':'restore'}.get(e['event'],e['event'])
        if e in cfg['scheduledEvents']:e['cause']='scheduled'
        if not isinstance(e.get('time'),(float,int)) or not math.isfinite(e['time']) or not 0<=e['time']<=cfg['simTimeLimit'] or e['event'] not in ('failure','restore') or type(e.get('a'))!=int or type(e.get('b'))!=int or tuple(sorted((e['a'],e['b']))) not in edges:raise ValueError('Event is outside the fixed ISL grid')
    cfg['externalInputs']={}
    for key in ('scenarioFile','failureReplay','islScheduleFile'):
        if cfg.get(key):
            source=path(cfg[key]);cfg['externalInputs'][key]={'path':str(source),'text':source.read_text(encoding='utf-8-sig')}
    return cfg

def new_id():return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')+uuid.uuid4().hex

def prepare(base,cfg,cancel=None,*,low_priority=False,watch_host=False):
    """Resolve physical events once using the independent propagation-only reference."""
    kernel=hashlib.sha256((Path(base)/'engine/engine.exe').read_bytes()).hexdigest()
    if cfg.get('commonKernelHash') not in (None,kernel):raise ValueError('Engine changed during experiment')
    cfg=copy.deepcopy(cfg);cfg['commonKernelHash']=kernel
    if cfg.get('physicalPrepared'):
        cfg['physicalEventsHash']=hashlib.sha256(json.dumps(cfg['physicalEvents'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        if cfg.get('commonSrd'):cfg['commonSrdHash']=hashlib.sha256(json.dumps(cfg['commonSrd'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        return cfg
    cancel=cancel or threading.Event()
    with tempfile.TemporaryDirectory(prefix='leo-physical-') as tmp:
        folder=Path(tmp);file=folder/'input.json';file.write_text(json.dumps(cfg,ensure_ascii=False,allow_nan=False),encoding='utf-8')
        with (folder/'prepare.log').open('wb') as log, launch_engine(
                [str(Path(base)/'engine/engine.exe'),str(file),str(folder),'--prepare'],log,LOW_PRIORITY if low_priority else NO_WIN) as process:
            low_since=None
            try:
                while process.poll() is None:
                    if cancel.wait(.1):raise InterruptedError('실행을 중지했습니다.')
                    if watch_host:
                        memory=host_memory()
                        now=time.monotonic()
                        low_since=(now if low_since is None else low_since) if memory and memory[1]<CRITICAL_MEMORY else None
                        if low_since is not None and now-low_since>=CRITICAL_SECONDS:
                            raise RuntimeError('시스템 메모리 여유가 부족해 비교 준비를 중지했습니다.')
                    if max(process_memory(process))>4*GIB:raise ValueError('Preparation exceeded 4GiB')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=1)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=1)
        if process.returncode:raise ValueError((folder/'prepare.log').read_text(encoding='utf-8',errors='replace')[-4000:])
        events=json.loads((folder/'physical-events.json').read_text())
        cfg['commonSrd']=json.loads((folder/'common-srd.json').read_text())
        cfg['commonSrdHash']=hashlib.sha256(json.dumps(cfg['commonSrd'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if hashlib.sha256((Path(base)/'engine/engine.exe').read_bytes()).hexdigest()!=kernel:raise ValueError('Engine changed during preparation')
    cfg['physicalEvents']=events;cfg['physicalPrepared']=True
    cfg['physicalEventsHash']=hashlib.sha256(json.dumps(events,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return cfg

def publish_latest(base, result, *, offline_copy=True, results=None):
    """Publish the finished run to HTTP and offline readers."""
    data=result_directory(base,results)
    pointer=data/'latest.json'
    offline=data/'latest_result.js'
    pointer_tmp=pointer.with_suffix('.tmp')
    offline_tmp=offline.with_suffix('.tmp')
    if not offline_copy:
        try:
            pointer_tmp.write_text(json.dumps({'runId':result['runId']}),encoding='utf8')
            os.replace(pointer_tmp,pointer)
        finally:
            pointer_tmp.unlink(missing_ok=True)
        return
    previous=pointer.read_bytes() if pointer.exists() else None
    try:
        pointer_tmp.write_text(json.dumps({'runId':result['runId']}),encoding='utf8')
        offline_tmp.write_text('window.SIM_RESULT='+json.dumps(result,ensure_ascii=True,allow_nan=False)+';\n',encoding='utf8')
        os.replace(pointer_tmp,pointer)
        try:
            os.replace(offline_tmp,offline)
        except OSError:
            if previous is None:
                pointer.unlink()
            else:
                pointer_tmp.write_bytes(previous)
                os.replace(pointer_tmp,pointer)
            raise
    finally:
        pointer_tmp.unlink(missing_ok=True)
        offline_tmp.unlink(missing_ok=True)

def execute(base,settings,ini,config_name,read_config,run_id=None,cancel=None,variables=None,frozen=None,*,publish=True,execution=None,assets=None,results=None):
    from result_bundle import make_native_bundle,write_bundle
    from comparison import commit_result
    prepared_at=time.monotonic()
    run_id=run_id or new_id();base=Path(base);cancel=cancel or threading.Event()
    if frozen is None:
        with CONFIG_LOCK:
            cfg=load_external_inputs(read_config(config_name,variables=variables),ini)
            inputs={p.relative_to(settings).as_posix():p.read_bytes() for p in Path(settings).rglob('*.ini') if not p.name.startswith('.')}
    else:cfg,inputs=frozen
    from native_engine import validate_control_mode
    validate_control_mode(cfg)
    asset_root=Path(assets) if assets is not None else base
    cfg=prepare(asset_root,cfg,cancel)
    folder=result_directory(base,results)/'runs'/run_id;folder.mkdir(parents=True,exist_ok=False)
    (folder/'engine-input.json').write_text(json.dumps(cfg,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    start=time.monotonic();peak=commit_peak=0
    executable=asset_root/'engine/engine.exe'
    if not executable.is_file():raise ValueError('Local engine is missing')
    with (folder/'run.log').open('wb') as log, launch_engine(
            [str(executable),str(folder/'engine-input.json'),str(folder)],log,
            LOW_PRIORITY if execution and execution['mode']=='auto' else NO_WIN) as process:
        try:
            while process.poll() is None:
                if cancel.wait(.1):raise InterruptedError('실행을 중지했습니다.')
                working, commit = process_memory(process)
                peak=max(peak,working);commit_peak=max(commit_peak,commit)
                if max(peak,commit_peak)>4*GIB:raise RuntimeError('엔진 메모리가 4GiB 제한을 초과했습니다.')
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=1)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=1)
        engine_ended=time.monotonic()
        working, commit = process_memory(process)
        peak=max(peak,working);commit_peak=max(commit_peak,commit)
        cpu=cpu_seconds(process)
    if cancel.is_set():raise InterruptedError('실행을 중지했습니다.')
    if process.returncode:raise RuntimeError((folder/'run.log').read_text(encoding='utf-8',errors='replace')[-4000:])
    if max(peak,commit_peak)>4*GIB:raise RuntimeError('엔진 메모리가 4GiB 제한을 초과했습니다.')
    from research import evidence
    summary=json.loads((folder/'summary.json').read_text())
    if summary.get('modelVersion')!=cfg['modelVersion']:
        raise ValueError('Engine model version differs from normalized input')
    summary['validation']=evidence(asset_root)
    summary['elapsedSeconds']=time.monotonic()-start
    summary['peakMemoryBytes']=peak
    host={'mode':'sequential','workers':1,'sharedPreparationSeconds':0}
    if execution:
        host.update(mode=execution['mode'],workers=2 if execution['overlap'].is_set() else 1,
                    sharedPreparationSeconds=execution['preparationSeconds'])
    host.update(preparationSeconds=start-prepared_at,engineSeconds=engine_ended-start,
                cpuSeconds=cpu,peakCommitBytes=commit_peak)
    summary['hostExecution']=host
    (folder/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,allow_nan=False,indent=2),encoding='utf-8')
    profile=json.loads((asset_root/'replay-model.json').read_text(encoding='utf-8'))
    bundle,payload=make_native_bundle(inputs,folder,config_name,profile['modelHash'],cfg,run_id,entry=Path(ini).relative_to(settings).as_posix())
    build=asset_root/'engine/build-info.json'
    if build.exists():
        info=json.loads(build.read_text());
        if info['sha256']!=cfg['commonKernelHash'] or info['version']!=summary.get('version'):raise ValueError('Engine build metadata changed')
        bundle['manifest']['build']=info
    bundle['manifest']['engine']['sha256']=cfg['commonKernelHash']
    bundle['manifest']['completionRequired']=True
    write_bundle(folder,bundle,payload)
    result={'ok':True,'runId':run_id,'bundle':bundle}
    (folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    (folder/'performance.json').write_text(json.dumps({**host,'peakMemoryBytes':peak,
                                                       'saveSeconds':time.monotonic()-engine_ended},indent=2),encoding='utf-8')
    with LOCK:
        if cancel.is_set():raise InterruptedError('실행을 중지했습니다.')
        commit_result(folder)
        if publish:
            if results is None and assets is None:publish_latest(base,result)
            else:publish_latest(base,result,offline_copy=False,results=results)
    return result

def start(base,settings,ini,name,read_config,variables=None,algorithms=None,research=None,*,assets=None,results=None):
    from native_engine import ALGORITHMS, validate_control_mode
    # Validate before accepting the job; a rejected request creates no run folder.
    with CONFIG_LOCK:
        cfg=load_external_inputs(read_config(name,variables=variables),ini)
        validate_control_mode(cfg)
        inputs={p.relative_to(settings).as_posix():p.read_bytes() for p in Path(settings).rglob('*.ini') if not p.name.startswith('.')}
    if algorithms is not None and (not isinstance(algorithms,list) or not algorithms or len(set(algorithms))!=len(algorithms) or any(a not in ALGORITHMS for a in algorithms)):raise ValueError('Select valid algorithms')
    options={} if research is None else research
    if not isinstance(options,dict) or set(options)-{'repetitions','seedStart','warmupSeconds','drainSeconds','executionMode'}:raise ValueError('비교 실행 옵션을 확인하세요.')
    mode=options.get('executionMode','auto' if algorithms is not None else 'sequential')
    if mode not in EXECUTION_MODES or (algorithms is None and mode!='sequential'):
        raise ValueError('비교 실행 방식은 자동 또는 순차여야 합니다.')
    repetitions=options.get('repetitions',1);seed_start=options.get('seedStart',cfg['seed'])
    if type(repetitions)!=int or not 1<=repetitions<=100 or type(seed_start)!=int or not 0<=seed_start<=2147483647-repetitions+1:raise ValueError('반복 횟수와 시작 시드 범위를 확인하세요.')
    if repetitions>1 and (not algorithms or cfg['processingMode']!='neutral'):raise ValueError('Repeated comparisons require neutral processing and algorithms')
    for key in ('warmupSeconds','drainSeconds'):
        value=options.get(key,cfg.get(key,0))
        if type(value) not in (int,float) or not math.isfinite(value) or value<0:raise ValueError('Invalid '+key)
        cfg[key]=value
    if cfg['warmupSeconds']+cfg['drainSeconds']>=cfg['simTimeLimit']:raise ValueError('Measurement window is empty')
    seeds=[seed_start+i for i in range(repetitions)]
    with LOCK:
        if any(j['status'] in ('queued','running','stopping') for j in JOBS.values()):raise ValueError('다른 계산이 실행 중입니다.')
        while len(JOBS) >= 16:
            del JOBS[next(iter(JOBS))]
        run_id=new_id();event=threading.Event();job={'runId':run_id,'status':'queued','cancel':event,'base':str(base),'results':str(results) if results is not None else None,'executionMode':mode,'activeRuns':[]};JOBS[run_id]=job
    def work():
        job['status']='running';job['phase']='preparing';job['started']=time.monotonic();job['completedRuns']=[]
        folder=result_directory(base,results)/'experiments'/run_id
        selected=algorithms or [cfg['algorithm']];job['totalRuns']=len(selected)*len(seeds)
        manifest={'schema':2,'experimentId':run_id,'configName':name,'seeds':seeds,'algorithms':selected,'runs':job['completedRuns'],'status':'running'}
        if cfg.get('displayName'):
            manifest['displayName'] = cfg['displayName']
        records=[]
        manifest['executionMode']=mode
        manifest['peakWorkers']=0
        def save_manifest():
            temporary=folder/'manifest.tmp'
            temporary.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
            os.replace(temporary,folder/'manifest.json')
        try:
            folder.mkdir(parents=True,exist_ok=False)
            for index,seed in enumerate(seeds):
                if event.is_set():raise InterruptedError('실행을 중지했습니다.')
                seed_config=copy.deepcopy(cfg);seed_config['seed']=seed;seed_config['failureSeed']=(cfg['failureSeed']+index)%2147483648
                job['phase']='preparing';job['resourceLimited']=False;job.pop('resourceWait',None)
                job.pop('currentRunId',None)
                preparation_started=time.monotonic()
                common=prepare(assets or base,seed_config,event,low_priority=mode=='auto',watch_host=algorithms is not None);common['experimentId']=run_id
                preparation_seconds=time.monotonic()-preparation_started
                prefix='' if index==0 else f'seed-{seed}-'
                for filename,data in [('common.json',common),('physical-events.json',common['physicalEvents']),('common-srd.json',common.get('commonSrd'))]:
                    if data is not None:(folder/(prefix+filename)).write_text(json.dumps(data,ensure_ascii=False,allow_nan=False,indent=2),encoding='utf8')
                if index==0:manifest.update(physicalEventsHash=common['physicalEventsHash'],commonSrdHash=common.get('commonSrdHash'))
                job['phase']='running';save_manifest()
                order=selected[index%len(selected):]+selected[:index%len(selected)]
                estimates = engine_memory_estimates(base, common, order, **({'results':results} if results is not None else {})) if mode=='auto' else {}
                planned = [(algorithm,new_id() if algorithms is not None else run_id) for algorithm in order]
                finished = {}
                last_run_id = planned[-1][1]
                def child_run(algorithm, child_id, overlap):
                    child=copy.deepcopy(common);child['algorithm']=algorithm
                    child['routingType']='Sat_Net_McsrRouting' if algorithm.startswith('mcsr-') else 'Sat_Net_DijkstraRouting'
                    child['metric']='hop' if algorithm=='dijkstra-hop' else 'delay'
                    result=execute(base,settings,ini,name,read_config,child_id,event,variables,(child,inputs),
                                   publish=False,execution={'mode':mode,'overlap':overlap,'preparationSeconds':preparation_seconds},**({'assets':assets} if assets is not None else {}),**({'results':results} if results is not None else {}))
                    summary=json.loads((result_directory(base,results)/'runs'/child_id/'summary.json').read_text(encoding='utf-8'))
                    return child, summary, result if child_id==last_run_id else None

                prior_runs=list(manifest['runs'])
                pending={}
                next_run=0
                failure=None
                low_since=None
                with ThreadPoolExecutor(max_workers=2 if mode=='auto' else 1) as workers:
                    try:
                        while pending or (next_run<len(planned) and not event.is_set()):
                            # Collect completed work before admitting a new engine.
                            done,_=wait(pending,timeout=.1,return_when=FIRST_COMPLETED) if pending else (set(),set())
                            for future in done:
                                row, _=pending.pop(future)
                                try:
                                    child, summary, final_result=future.result()
                                    finished[row['runId']]=(row,{'seed':seed,'algorithm':row['algorithm'],'config':child,'summary':summary})
                                    if final_result is not None:result=final_result
                                except InterruptedError:
                                    event.set()
                                except Exception as error:
                                    if failure is None and not event.is_set():failure=error
                                    event.set()
                            if done:
                                ordered=[finished[child_id] for _,child_id in planned if child_id in finished]
                                manifest['runs']=prior_runs+[row for row,_ in ordered]
                                with LOCK:
                                    job['completedRuns']=manifest['runs']
                                    job['activeRuns']=[row for row,_ in pending.values()]
                                save_manifest()

                            resources=host_memory() if algorithms is not None and not event.is_set() else None
                            now=time.monotonic()
                            critical=resources is not None and resources[1]<CRITICAL_MEMORY
                            low_since=(now if low_since is None else low_since) if critical else None
                            if low_since is not None and now-low_since>=CRITICAL_SECONDS:
                                failure=RuntimeError('시스템 메모리 여유가 부족해 비교 실행을 중지했습니다.')
                                event.set()
                            if event.is_set() or next_run==len(planned) or len(pending)>=2:
                                continue
                            algorithm,child_id=planned[next_run]
                            reserve=max(2*GIB, math.ceil(resources[0]*.15)) if resources else 0
                            required=reserve+estimates.get(algorithm,3*GIB//2)
                            enough_cpu=(os.cpu_count() or 1)>=4
                            can_overlap=(mode=='auto' and enough_cpu and resources is not None
                                         and resources[1]>=required)
                            if critical:
                                wait_reason={'reason':'memory','availableBytes':resources[1],'requiredBytes':CRITICAL_MEMORY}
                            elif pending and mode=='auto' and not can_overlap:
                                if not enough_cpu:wait_reason={'reason':'cpu'}
                                elif resources is None:wait_reason={'reason':'unknown'}
                                else:wait_reason={'reason':'memory','availableBytes':resources[1],'requiredBytes':required}
                            else:
                                wait_reason=None
                            with LOCK:
                                job['resourceLimited']=wait_reason is not None
                                job['resourceWait']=wait_reason
                            if critical or (pending and not can_overlap):
                                if not pending:event.wait(.1)
                                continue
                            next_run+=1
                            overlap=threading.Event()
                            if pending:
                                overlap.set()
                                for _,flag in pending.values():flag.set()
                            row={'runId':child_id,'algorithm':algorithm,'seed':seed}
                            with LOCK:
                                job['activeRuns']=[existing for existing,_ in pending.values()]+[row]
                                job['currentRunId']=job['activeRuns'][0]['runId'];job['currentSeed']=seed
                            future=workers.submit(child_run,algorithm,child_id,overlap)
                            pending[future]=(row,overlap)
                            manifest['peakWorkers']=max(manifest['peakWorkers'],len(pending))
                            job['peakWorkers']=manifest['peakWorkers']
                    except BaseException:
                        event.set()
                        raise
                if failure is not None:raise failure
                if event.is_set():raise InterruptedError('실행을 중지했습니다.')
                records.extend(finished[child_id][1] for _,child_id in planned)
            if event.is_set():raise InterruptedError('실행을 중지했습니다.')
            if repetitions>1:
                from research import aggregate
                statistics=aggregate(records,selected,seeds);statistics['experimentId']=run_id
                statistics.update(executionMode=mode,peakWorkers=manifest['peakWorkers'])
                (folder/'statistics.json').write_text(json.dumps(statistics,ensure_ascii=False,allow_nan=False,indent=2),encoding='utf8')
                manifest['statistics']='statistics.json';job['statistics']=statistics
            with LOCK:
                if event.is_set():raise InterruptedError('실행을 중지했습니다.')
                manifest['status']='completed';save_manifest()
                if results is None and assets is None:publish_latest(base,result)
                else:publish_latest(base,result,offline_copy=False,results=results)
                job['status']='completed'
        except Exception as error:
            status='cancelled' if isinstance(error,InterruptedError) else 'failed'
            if status=='failed':logger.exception('Run %s failed',run_id)
            manifest.update(status=status,error=str(error))
            with LOCK:
                try:save_manifest()
                except OSError:logger.warning('Could not save run status %s',run_id,exc_info=True)
                job.update(status=status,error=str(error))
    thread=threading.Thread(target=work,daemon=True)
    with LOCK:
        job['thread']=thread;thread.start()
    return {'ok':True,'runId':run_id,'status':'queued'}

def state(run_id):
    with LOCK:
        job=JOBS.get(run_id)
        if not job:raise ValueError('알 수 없는 실행입니다.')
        out={k:v for k,v in job.items() if k not in ('cancel','thread','started','base','results')}
        started=job.get('started')
        base=job['base'];results=job.get('results')
    if started is not None:out['elapsedSeconds']=time.monotonic()-started
    active=[]
    for row in out['activeRuns']:
        row=dict(row)
        try:
            row['progress']=json.loads((result_directory(base,results)/'runs'/row['runId']/'progress.json').read_text())
        except (OSError,ValueError):pass
        active.append(row)
    out['activeRuns']=active
    if active and 'progress' in active[0]:out['progress']=active[0]['progress']
    return out

def cancel(run_id):
    with LOCK:
        job=JOBS.get(run_id)
        if not job:raise ValueError('알 수 없는 실행입니다.')
        if job['status'] in ('queued','running'):job['status']='stopping';job['cancel'].set()
    return {'ok':True,'runId':run_id,'status':job['status']}

@contextmanager
def idle_workspace():
    with CONFIG_LOCK:
        with LOCK:
            if any(job['status'] in ('queued','running','stopping') for job in JOBS.values()):
                raise RuntimeError('실행을 마친 뒤 결과 저장 폴더를 변경하세요.')
        yield


def shutdown():
    with CONFIG_LOCK, LOCK:jobs=list(JOBS.values())
    for job in jobs:job['cancel'].set()
    deadline=time.monotonic()+3
    for job in jobs:
        if 'thread' in job:job['thread'].join(timeout=max(0,deadline-time.monotonic()))
