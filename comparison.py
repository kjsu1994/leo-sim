# SPDX-License-Identifier: GPL-3.0-only
from pathlib import Path
import hashlib,json,re

ENV_KEYS=('warmupSeconds','drainSeconds','numSatellites','planes','phasing','altitude','inclination','raanSpread','baseYear','baseDay','epochYear','epochDay','bstar','eccentricity','simTimeLimit','seed','stations','islDatarate','groundlinkDatarate','islDelay','groundlinkDelay','minimumElevation','updateInterval','queueCapacity','intraDisabled','interDisabled','failureSchedule','randomFailures','randomStart','randomEnd','randomDuration','failureSeed','failureReplayEvents','congestionMode','congestionZones','congestionRefresh','congestionBuffer','congestionPacketBytes','scenario','maxHops','maxGroundLinks','failureKnowledge','slsInterval','slsMissCount','floodHopDelay','failureScopeHops','processingMode','controlMode','controlRefresh','controlTimeout','controlHeaderBytes','controlRecordBytes','jitterModel','islMode','scheduledEvents','physicalEvents','physicalEventsHash','modelVersion','metricVersion','commonKernelHash','commonSrd','commonSrdHash','controlMtu','controlReassemblyTimeout','controlResyncInterval','controlProtocolVersion')

def environment(config):
    env={key:config.get(key) for key in ENV_KEYS}
    if isinstance(env.get('scenario'),dict):
        env['scenario']=dict(env['scenario']);baseline=env['scenario'].get('baseline')
        if baseline:env['scenario']['baseline']={'route':baseline.get('route')}
    return env

def fingerprint(config):return hashlib.sha256(json.dumps(environment(config),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def result_directory(base, results=None):
    return Path(results) if results is not None else Path(base)/"data"


def folder(base,run_id,*,results=None):
    if not re.fullmatch(r'[A-Za-z0-9-]{8,80}',run_id):raise ValueError('Invalid run ID')
    return result_directory(base,results)/'runs'/run_id

def completed_manifest(directory):
    """New bundles commit last. Legacy bundles must contain their declared files."""
    raw=(directory/'manifest.json').read_bytes()
    manifest=json.loads(raw)
    if manifest.get('runId')!=directory.name or not re.fullmatch(r'[A-Za-z0-9-]{8,80}',directory.name):
        raise ValueError('Invalid result ID')
    files=manifest.get('files')
    if not isinstance(files,dict) or not files:
        raise ValueError('Missing result files')
    if manifest.get('completionRequired'):
        marker=json.loads((directory/'completed.json').read_bytes())
        if marker!={'runId':directory.name,'manifestSHA256':hashlib.sha256(raw).hexdigest()}:
            raise ValueError('Incomplete run')
        for name in ('result.json','performance.json'):
            if not (directory/name).is_file():raise ValueError('Incomplete run')
    for name in files:
        relative=Path(name)
        if relative.anchor or '..' in relative.parts or not (directory/relative).is_file():
            raise ValueError('Missing or invalid result file')
    return manifest


def commit_result(directory):
    marker=directory/'completed.json'
    temporary=marker.with_suffix('.tmp')
    try:
        temporary.write_text(json.dumps({'runId':directory.name,
            'manifestSHA256':hashlib.sha256((directory/'manifest.json').read_bytes()).hexdigest()}),encoding='utf-8')
        temporary.replace(marker)
    finally:
        temporary.unlink(missing_ok=True)


def runs(base,*,results=None):
    out=[]
    for p in sorted((result_directory(base,results)/'runs').glob('*/manifest.json'),key=lambda p:p.stat().st_mtime,reverse=True):
        try:
            m=completed_manifest(p.parent);s=p.parent/'summary.json'
            if m.get('format') in ('leo-native-replay-v2','leo-native-replay-v3','leo-native-replay-v4') and s.is_file():out.append({'runId':m['runId'],'configName':m['configName'],'displayName':m.get('displayName'),'createdAt':m['createdAt'],'summary':json.loads(s.read_text())})
        except (OSError,ValueError,KeyError):continue
    return out

def run_metadata(base,*,results=None):
    formats = {'florasat-csv-ini-v1', 'leo-native-replay-v2', 'leo-native-replay-v3', 'leo-native-replay-v4'}
    rows = []
    for path in (result_directory(base,results)/'runs').glob('*/manifest.json'):
        try:
            manifest = completed_manifest(path.parent)
            run_id = manifest['runId']
            if manifest['format'] not in formats or folder(base, run_id,results=results) != path.parent:
                continue
            algorithm = (manifest.get('algorithmSettings') or {}).get('algorithm')
            if not algorithm and manifest['format'].startswith('leo-native-'):
                summary = path.parent/'summary.json'
                if summary.is_file():
                    algorithm = json.loads(summary.read_text(encoding='utf-8')).get('algorithm')
            rows.append({'runId':run_id, 'configName':manifest['configName'], 'displayName':manifest.get('displayName'),
                            'createdAt':str(manifest.get('createdAt') or ''), 'algorithm':algorithm})
        except (OSError, ValueError, TypeError, AttributeError, KeyError):
            continue
    return sorted(rows, key=lambda row: (row['createdAt'], row['runId']), reverse=True)


def compare_bundles(a,b):
    def load(bundle):
        m=bundle['manifest'];f=bundle['files']
        if m.get('format') not in ('leo-native-replay-v2','leo-native-replay-v3','leo-native-replay-v4'):raise ValueError('계측이 포함된 버전 2 결과가 필요합니다.')
        return json.loads(f[m['normalizedPath']]),json.loads(f['summary.json'])
    ca,sa=load(a);cb,sb=load(b);ea,eb=environment(ca),environment(cb)
    differences=[k for k in ENV_KEYS if ea[k]!=eb[k]]
    physical=[k for k in differences if k not in ('scenario','congestionZones','congestionMode')]
    def window(config, summary):
        m=summary.get('measurement')
        return (m.get('start'),m.get('end'),m.get('observedUntil')) if m is not None else (0,config.get('simTimeLimit'),config.get('simTimeLimit'))
    physical_hash=(a['manifest'].get('physicalEventsHash'),b['manifest'].get('physicalEventsHash'))
    traffic=(sa.get('trafficHash'),sb.get('trafficHash'))
    same_traffic=bool(all(traffic) and traffic[0]==traffic[1])
    windows=(window(ca,sa),window(cb,sb))
    known=all(bundle['manifest'].get('environmentHash') for bundle in (a,b)) and all(physical_hash) and all(traffic) and all(None not in w for w in windows)
    verified=all(bundle['manifest'].get('format')=='leo-native-replay-v4' for bundle in (a,b)) and all(s.get('processingMode') for s in (sa,sb))
    mismatch=bool(differences or any(x and y and x!=y for x,y in [physical_hash,traffic]) or
                  (all(None not in w for w in windows) and windows[0]!=windows[1]) or
                  any(s.get('processingMode') not in (None,'neutral') for s in (sa,sb)))
    comparable=known and verified and not mismatch
    metrics=('attempted','sent','received','dropped','deliveryRate','meanDelayMs','throughputMbps','replanned','reservedSwitches','peakMemoryBytes','elapsedSeconds')
    return {'comparable':comparable,'conditionStatus':'different' if mismatch else 'same' if comparable else 'unknown','trafficMatches':same_traffic,'differences':differences,
            'physicalDifferences':physical,'baseline':sa,'scenario':sb,
            'metrics':[{'name':k,'baseline':sa.get(k),'scenario':sb.get(k),'difference':sb[k]-sa[k] if comparable and isinstance(sa.get(k),(int,float)) and isinstance(sb.get(k),(int,float)) else None} for k in metrics]}

def compare(base,a,b,*,results=None):
    paths=[folder(base,run_id,results=results) for run_id in (a,b)]
    for path in paths:completed_manifest(path)
    first,second=(json.loads((path/'result.json').read_text(encoding='utf-8')) for path in paths)
    return compare_bundles(first['bundle'],second['bundle'])
