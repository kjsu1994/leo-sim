# SPDX-License-Identifier: GPL-3.0-only
"""Minimal selected-section INI edits; unknown keys never silently enter the engine."""
from pathlib import Path
import hashlib
import json
import os
import re
from native_engine import FIELDS,BOOL_FIELDS,ENUM_FIELDS,ALGORITHMS,number

def render(value):
    if isinstance(value,bool):return 'true' if value else 'false'
    if isinstance(value,str):
        if any(c in value for c in '\n\r"'):raise ValueError('Invalid INI string')
        return '"'+value+'"'
    return format(float(value),'.15g')

def section_bounds(lines,config):
    start=None
    for i,line in enumerate(lines):
        match=re.match(r'\s*\[Config\s+([^\]]+)\]',line)
        if not match:continue
        if start is not None:return start,i
        if match[1].strip()==config:start=i+1
    if start is None:raise ValueError('선택한 구성의 기본값을 찾을 수 없습니다.')
    return start,len(lines)

def default_text(path,text,config):
    defaults=path.with_suffix('.defaults')
    if not defaults.is_file():raise ValueError('기본값 파일을 찾을 수 없습니다.')
    lines=text.splitlines(keepends=True)
    source=defaults.read_text(encoding='utf-8-sig').splitlines(keepends=True)
    start,end=section_bounds(lines,config)
    first,last=section_bounds(source,config)
    newline='\r\n' if '\r\n' in text else '\n'
    metadata = [line for line in lines[start:end] if re.match(r'\s*(?:displayName|additional)\s*=', line)]
    restored = metadata + [line for line in source[first:last] if not re.match(r'\s*(?:displayName|additional)\s*=', line)]
    return ''.join(lines[:start] + [line.rstrip('\r\n') + newline for line in restored] + lines[end:])

def read_preview(path,config,text):
    from tempfile import NamedTemporaryFile
    from server import read_ini_config
    from run_manager import load_external_inputs
    with NamedTemporaryFile(dir=path.parent,prefix='.validate-defaults-',suffix='.ini',delete=False) as temporary:
        shadow=Path(temporary.name)
        temporary.write(text.encode('utf8'))
    try:
        cfg=load_external_inputs(read_ini_config(config,entry_path=str(shadow)),path)
        cfg['iniPath']=str(path)
        return cfg
    finally:
        shadow.unlink(missing_ok=True)

def preview_defaults(path,config):
    path=Path(path)
    return read_preview(path,config,default_text(path,path.read_bytes().decode('utf-8-sig'),config))

def edit(path,config,changes,read_config,scenario=None,*,reset=False):
    path=Path(path);before=path.read_bytes();text=before.decode('utf-8-sig');newline='\r\n' if '\r\n' in text else '\n'
    if reset:text=default_text(path,text,config)
    current=read_preview(path,config,text) if reset else read_config(config)
    fields={f[0]:f for f in FIELDS};values={}
    simple={'congestionMode':'*.native.congestionMode','routeRecording':'*.native.routeRecording','packetTrace':'*.native.packetTrace',
            'failureSchedule':'*.islFailures.schedule','failureReplay':'*.islFailures.replayFile','congestionZones':'*.congestion.zones',
            'randomFailures':'*.islFailures.randomFailures','randomStart':'*.islFailures.randomStart','randomEnd':'*.islFailures.randomEnd',
            'randomDuration':'*.islFailures.randomDuration','failureSeed':'seed-1-mt','failureKnowledge':'*.topologyControl.failureKnowledge',
            'congestionRefresh':'*.congestion.refreshInterval','congestionBuffer':'*.congestion.queueCapacity','congestionPacketBytes':'*.congestion.packetBytes'}
    simple.update({key:'*.native.'+key for key in ('processingMode','controlMode','jitterModel','islMode','islScheduleFile','controlRefresh','controlTimeout','controlHeaderBytes','controlRecordBytes','controlMtu','controlReassemblyTimeout','controlResyncInterval','warmupSeconds','drainSeconds')})
    for key,value in changes.items():
        if key in fields:
            f=fields[key];v=number(value)
            if not f[5]<=v<=f[6] or (f[3]=='int' and int(v)!=v):raise ValueError('Invalid '+key)
            values[f[2]]=render(v)
        elif key in BOOL_FIELDS:
            if not isinstance(value,bool):raise ValueError('Expected boolean: '+key)
            values['*.satellite[*].net.routing.'+key]=render(value)
        elif key in ENUM_FIELDS:
            if value not in ENUM_FIELDS[key]:raise ValueError('Invalid '+key)
            values['*.satellite[*].net.routing.'+key]=render(value)
        elif key in simple:values[simple[key]]=render(value)
        elif key not in ('algorithm','senders','destination','packetSize','sendInterval','bitrateMbps','startTime','endTime','scenarioFile'):raise ValueError('Unknown setting: '+key)
    if 'algorithm' in changes:
        algorithm=changes['algorithm']
        if algorithm not in ALGORITHMS:raise ValueError('Unknown algorithm')
        values['*.satellite[*].net.routing.algorithm']=render(algorithm)
        values['*.satellite[*].net.routingType']=render('Sat_Net_McsrRouting' if algorithm.startswith('mcsr-') else 'Sat_Net_DijkstraRouting')
        if algorithm.startswith('mcsr-'):values['*.satellite[*].net.routing.service']=render(algorithm[5:].upper())
        else:values['*.satellite[*].net.routing.metric']=render(algorithm[9:])
    senders=changes.get('senders',[s['id'] for s in current['stations'] if s['enabled']])
    if not isinstance(senders,list) or len(set(senders))!=len(senders) or not senders or any(type(v)!=int or not 0<=v<len(current['stations']) for v in senders):raise ValueError('Select valid sending nodes')
    if 'senders' in changes:
        for s in current['stations']:values[f"*.station[{s['id']}].traffic.enabled"]=render(s['id'] in senders)
    for sender in senders:
        st=current['stations'][sender];prefix=f'*.station[{sender}].traffic.'
        for key in ('destination','packetSize','sendInterval','startTime','endTime'):
            if key not in changes:continue
            value=changes[key]
            if key=='destination':
                value=int(value)
                if value==sender or not -1<=value<len(current['stations']):raise ValueError('Invalid destination')
                values[prefix+'dstStation']=render(value)
                if value>=0:values[prefix+'dstType']=render('mobile' if current['stations'][value]['mobile'] else 'station')
            else:values[prefix+key]=render(number(value))
        if 'bitrateMbps' in changes:
            size=number(changes.get('packetSize',st['packetSize']));rate=number(changes['bitrateMbps'])
            if rate<=0:raise ValueError('Bitrate must be positive')
            values[prefix+'sendInterval']=render(size*8/(rate*1e6))+'s'
    if scenario is not None:
        name='scenario-'+hashlib.sha256(config.encode()).hexdigest()[:12]+'.json'
        target=path.parent/'scenarios'/name
        values['*.congestion.scenarioFile']=render('scenarios/'+name)
    elif 'scenarioFile' in changes:values['*.congestion.scenarioFile']=render(changes['scenarioFile'])
    lines=text.splitlines(keepends=True)
    start,end=section_bounds(lines,config)
    remaining=dict(values);block=[]
    for line in lines[start:end]:
        m=re.match(r'(\s*)([^#=]+?)(\s*=\s*)(.*)',line)
        if m and m[2].strip() in values:
            key=m[2].strip()
            if key in remaining:
                old=m[4].rstrip('\r\n');comment=''
                quoted=False
                for j,ch in enumerate(old):
                    if ch=='"':quoted=not quoted
                    if ch=='#' and not quoted:comment=' '+old[j:];break
                block.append(m[1]+m[2]+m[3]+remaining.pop(key)+comment+newline)
            # Duplicate exact keys are removed to preserve first-match semantics.
        else:block.append(line)
    inserted=[key+' = '+value+newline for key,value in remaining.items()]
    updated=''.join(lines[:start]+inserted+block+lines[end:]).encode('utf-8')
    # Validate a shadow root beside the real INI; include paths still resolve unchanged.
    shadow=path.with_name('.validate-'+path.name)
    old_scenario=target.read_bytes() if scenario is not None and target.exists() else None
    try:
        if scenario is not None:
            target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(scenario,ensure_ascii=False,allow_nan=False),encoding='utf-8')
        shadow.write_bytes(updated)
        from server import read_ini_config
        from run_manager import load_external_inputs
        from native_engine import validate_control_mode
        candidate=read_ini_config(config,entry_path=str(shadow))
        validate_control_mode(candidate)
        load_external_inputs(candidate,path)
        if path.read_bytes()!=before:raise ValueError('INI changed during editing; refresh and retry')
        os.replace(shadow,path)
    except Exception:
        if scenario is not None:
            if old_scenario is None:target.unlink(missing_ok=True)
            else:target.write_bytes(old_scenario)
        raise
    finally:shadow.unlink(missing_ok=True)
    return read_config(config)
