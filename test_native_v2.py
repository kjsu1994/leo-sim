# SPDX-License-Identifier: GPL-3.0-only
import copy,csv,hashlib,io,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import server
from native_engine import configuration,number
from config_editor import edit
from run_manager import load_external_inputs
from comparison import fingerprint

class IniV2Tests(unittest.TestCase):
    def test_units_arithmetic_and_rejected_execution(self):
        self.assertAlmostEqual(number('1380*8/(${rateMbps=10,20}*1e6)*1s'),.001104)
        self.assertAlmostEqual(number('10us'),.00001)
        self.assertEqual(number(' 3s'),3)
        for expr in ['__import__("os")','1/0','float("nan")','1unknown']:
            with self.assertRaises(ValueError):number(expr)
    def test_100_cities_and_mcsr_profiles(self):
        for name in ['PaperS1Mcsr','PaperS1McsrTS','PaperS1McsrHR']:
            cfg=server.read_ini_config(name)
            self.assertEqual(len(cfg['stations']),100)
            self.assertFalse(any(s['mobile'] or 'route' in s for s in cfg['stations']))
            self.assertEqual(cfg['numSatellites'],1584)
            self.assertEqual(cfg['queueCapacity'],500)
            self.assertEqual(cfg['refreshInterval'],5)
    def test_tick_and_unknown_routing_key_are_rejected(self):
        for key,value in [('*.station[0].traffic.sendInterval','1ps'),('*.satellite[*].net.routing.noSuchSetting','1')]:
            cfg=server.read_ini_config('Dijkstra132');cfg['effectiveEntries'].append({'k':key,'v':value,'sec':'probe'})
            with self.assertRaises(ValueError):configuration(cfg)
    def test_editor_preserves_comments_and_validates_before_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp,'omnetpp.ini');raw=b'[General]\r\n*.numSatellites = 12\r\n*.**.planeCount = 4\r\n**.nrOfGS = 2\r\n[Config A]\r\n# keep me\r\n*.station[0].traffic.enabled = true # sender\r\n*.station[0].traffic.dstStation = 1\r\n'
            path.write_bytes(raw)
            reader=lambda name:server.read_ini_config(name,entry_path=str(path))
            result=edit(path,'A',{'algorithm':'mcsr-ts','packetSize':1380,'bitrateMbps':60,'queueCapacity':20},reader)
            self.assertEqual(result['algorithm'],'mcsr-ts');self.assertAlmostEqual(result['stations'][0]['sendInterval'],.000184)
            self.assertIn(b'# keep me\r\n',path.read_bytes());self.assertIn(b'# sender',path.read_bytes())
            before=path.read_bytes()
            with self.assertRaises(ValueError):edit(path,'A',{'sendInterval':'1ps'},reader)
            self.assertEqual(path.read_bytes(),before)
    def test_time_mode_requires_csib_off(self):
        from run_manager import execute, start
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);ini=root/'omnetpp.ini'
            ini.write_text('[General]\n*.numSatellites=12\n*.**.planeCount=4\n**.nrOfGS=2\n[Config A]\n*.station[0].traffic.enabled=true\n*.station[0].traffic.dstStation=1\n')
            reader=lambda name,variables=None:server.read_ini_config(name,entry_path=str(ini),variables=variables)
            self.assertEqual(reader('A')['controlMode'],'packet')
            before=ini.read_bytes()
            invalid={'controlMode':'time','csibEnabled':True}
            with self.assertRaisesRegex(ValueError,'CSIB'):edit(ini,'A',invalid,reader)
            self.assertEqual(ini.read_bytes(),before)
            ini.write_bytes(before+b'*.native.controlMode="time"\n*.satellite[*].net.routing.csibEnabled=true\n')
            self.assertTrue(reader('A')['csibEnabled'])
            for launch in (start,execute):
                with self.assertRaisesRegex(ValueError,'CSIB'):launch(root,root,ini,'A',reader)
            self.assertFalse((root/'data').exists())
            result=edit(ini,'A',{'csibEnabled':False},reader)
            self.assertEqual(result['controlMode'],'time')
            self.assertFalse(result['csibEnabled'])
        for default in (Path(server.INI_PATH).name, Path(server.INI_PATH).with_suffix('.defaults').name):
            profile=server.read_ini_config('PaperS1McsrCsib',entry_path=str(Path(server.INI_PATH).with_name(default)))
            self.assertEqual(profile['controlMode'],'packet')
            self.assertTrue(profile['csibEnabled'])
    def test_edit_keeps_saved_link_schedules(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);ini=root/'omnetpp.ini'
            ini.write_text('[General]\n*.numSatellites=12\n*.**.planeCount=4\n**.nrOfGS=2\n'
                           '[Config A]\n*.station[0].traffic.enabled=true\n*.station[0].traffic.dstStation=1\n'
                           '*.native.islMode="scheduled"\n*.native.islScheduleFile="links.csv"\n'
                           '*.islFailures.replayFile="failures.csv"\n')
            (root/'links.csv').write_bytes('\ufefftime,event,satA,satB\r\n1,down,0,1\r\n2,up,0,1\r\n'.encode('utf-8'))
            (root/'failures.csv').write_text('time,event,satA,satB\n3,failure,1,2\n4,restore,1,2\n')
            reader=lambda name:server.read_ini_config(name,entry_path=str(ini))
            before=load_external_inputs(reader('A'),ini)
            edit(ini,'A',{'queueCapacity':20},reader)
            after=load_external_inputs(reader('A'),ini)
            self.assertEqual(after['islMode'],'scheduled')
            self.assertEqual([row['event'] for row in before['scheduledEvents']],['failure','restore'])
            self.assertEqual(after['scheduledEvents'],before['scheduledEvents'])
            self.assertEqual(after['failureReplayEvents'],before['failureReplayEvents'])
    def test_environment_fingerprint_excludes_algorithm_but_not_queue(self):
        a=server.read_ini_config('Dijkstra132');b=copy.deepcopy(a);b['algorithm']='mcsr-hr'
        self.assertEqual(fingerprint(a),fingerprint(b));b['queueCapacity']+=1
        self.assertNotEqual(fingerprint(a),fingerprint(b))
    def test_link_direction_normalization(self):
        c=server.read_ini_config('Dijkstra132');c['congestionMode']='environment';c['scenario']={'entries':[{'target':{'kind':'link','params':{'sat_a':0,'sat_b':1,'direction':'in'}},'rho':.6,'use_capacity':True}]}
        p=load_external_inputs(c,server.INI_PATH)['scenario']['entries'][0]['target']['params']
        self.assertEqual((p['sat_a'],p['sat_b']),(1,0));self.assertFalse(p['bidirectional'])
    def test_actual_mode_does_not_silently_accept_environment_effect(self):
        c=server.read_ini_config('Dijkstra132');c['scenario']={'entries':[{'target':{'kind':'satellite','params':{'sat':0}},'rho':.6,'use_capacity':True}]}
        with self.assertRaises(ValueError):load_external_inputs(c,server.INI_PATH)

class EngineV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.exe=str(Path(server.BASE_DIR,'engine/engine.exe'))
    def run_case(self,c):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp);(path/'input.json').write_text(json.dumps(c,allow_nan=False))
            result=subprocess.run([self.exe,str(path/'input.json'),str(path)],capture_output=True,text=True,encoding='utf-8',timeout=120)
            self.assertEqual(result.returncode,0,result.stderr)
            summary=json.loads((path/'summary.json').read_text())
            self.assertEqual(summary['attempted'],summary['received']+summary['dropped']+summary['inFlight'])
            self.assertEqual(summary['attempted'],summary['sent']+summary['noUplink'])
            return summary,{p.name:p.read_text(encoding='utf-8') for p in path.iterdir() if p.suffix in ('.csv','.jsonl')}
    def single(self):
        c=server.read_ini_config('Dijkstra132');c.update(simTimeLimit=.2,minimumElevation=-90,maxGroundLinks=500,queueCapacity=2,groundlinkDatarate=1e6,islDatarate=1e6)
        for s in c['stations']:s['enabled']=False
        c['stations'][0].update(enabled=True,dstStation=10,startTime=0,sendInterval=.00001,endTime=.2)
        return c
    def test_bounded_queue_overflow_and_short_interval(self):
        c=self.single();s,files=self.run_case(c)
        self.assertGreater(s['attempted'],10000);self.assertGreater(s['dropReasons']['queue-overflow'],1000)
        self.assertLessEqual(s['maxQueuePackets'],2)
        self.assertEqual(len(files['events.csv'].splitlines()),1)
        samples=list(csv.DictReader(io.StringIO(files['timeseries.csv'])));self.assertEqual(len(samples),1)
        self.assertAlmostEqual(float(samples[0]['throughputMbps']),s['throughputMbps'])
    def test_same_offered_traffic_for_all_five_algorithms(self):
        hashes=[]
        for algorithm in ['dijkstra-delay','dijkstra-hop','mcsr-ls','mcsr-ts','mcsr-hr']:
            c=server.read_ini_config('Dijkstra132');c.update(algorithm=algorithm,simTimeLimit=8)
            s,_=self.run_case(c);hashes.append(s['trafficHash'])
        self.assertEqual(len(set(hashes)),1)
    def test_original_geometry_matches_cached_visibility(self):
        c=server.read_ini_config('PaperS1Dijkstra');c.update(simTimeLimit=2,validateGeometry=True)
        c['stations'][18]['startTime']=0
        self.run_case(c)
    def test_engine_rejects_time_csib_before_writing_results(self):
        c=self.single();c.update(controlMode='time',csibEnabled=True)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp);source=path/'input.json';source.write_text(json.dumps(c))
            output=path/'results'
            result=subprocess.run([self.exe,str(source),str(output)],capture_output=True,text=True,timeout=10)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('CSIB requires packet control mode',result.stderr)
            self.assertFalse(output.exists())
        c['csibEnabled']=False
        summary,_=self.run_case(c)
        self.assertEqual(summary['controlMode'],'time')
    def test_fault_recovery_and_csib_use_original_core(self):
        c=server.read_ini_config('Mcsr132');c.update(simTimeLimit=4,minimumElevation=0,csibEnabled=True,csibPeriod=1,csibDetectDelay=.05,csibComputeDelay=.01,failureSchedule='route@1+1',failureKnowledge='propagate',slsInterval=.02,slsMissCount=2)
        for s in c['stations']:s['enabled']=False
        c['stations'][0].update(enabled=True,dstStation=1,startTime=0,sendInterval=.01,endTime=4)
        summary,files=self.run_case(c)
        events=[json.loads(line) for line in files['network-events.jsonl'].splitlines()]
        self.assertTrue(any(e['event']=='failure' for e in events))
        self.assertTrue(any(e['event']=='restore' for e in events))
        self.assertTrue(any(e['event']=='csib-generated' for e in events))
        for e in events:
            if e['event']=='csib-applied':self.assertLessEqual(e['dataTime'],e['time'])
    def test_injected_loss_does_not_stall_queue(self):
        c=self.single();c.update(congestionMode='environment',packetTrace=True)
        c['scenario']={'entries':[{'target':{'kind':'link','params':{'sat_a':0,'sat_b':1}},'start_s':0,'end_s':.05,'rho':.6,'penalty':{'loss_pct':100}}]}
        s,_=self.run_case(c);self.assertGreater(s['received'],0)


class JobV2Tests(unittest.TestCase):
    def test_frozen_inputs_result_integrity_and_fast_cancel(self):
        import run_manager,shutil,time
        from comparison import compare_bundles
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);settings=base/'settings';shutil.copytree(server.LEO_DIR,settings)
            ini=settings/'simulations/Network/scenarios.ini'
            (base/'engine').mkdir();shutil.copy2(Path(server.BASE_DIR)/'engine/engine.exe',base/'engine/engine.exe');shutil.copy2(Path(server.BASE_DIR)/'replay-model.json',base/'replay-model.json')
            reader=lambda name,variables=None:server.read_ini_config(name,entry_path=str(ini),variables=variables)
            edit(ini,'Dijkstra132',{'simTimeLimit':2,'startTime':0},reader)
            before=ini.read_bytes()
            job=run_manager.start(base,settings,ini,'Dijkstra132',reader);identifier=job['runId']
            ini.write_bytes(before+b'\n# edited after launch\n')
            deadline=time.monotonic()+30
            while run_manager.state(identifier)['status'] in ('queued','running'):
                self.assertLess(time.monotonic(),deadline);time.sleep(.05)
            state=run_manager.state(identifier);self.assertEqual(state['status'],'completed',state.get('error'))
            self.assertNotIn('result',state)
            bundle=json.loads((base/'data/runs'/identifier/'result.json').read_text(encoding='utf8'))['bundle'];self.assertEqual(bundle['manifest']['format'],'leo-native-replay-v4')
            self.assertEqual(bundle['files']['config/simulations/Network/scenarios.ini'].encode(),before)
            for name,digest in bundle['manifest']['files'].items():self.assertEqual(hashlib.sha256(bundle['files'][name].encode()).hexdigest(),digest)
            self.assertTrue(compare_bundles(bundle,bundle)['comparable'])
            other={**bundle,'manifest':{**bundle['manifest'],'environmentHash':'other'}}
            self.assertEqual(compare_bundles(bundle,other)['conditionStatus'],'different')
            from comparison import ENV_KEYS
            ui=(Path(server.BASE_DIR)/'editor.js').read_text(encoding='utf8')
            self.assertIn('const comparisonEnvironmentKeys = "'+' '.join(ENV_KEYS)+'"',ui)
            missing={**bundle,'manifest':{**bundle['manifest'],'physicalEventsHash':None}}
            report=compare_bundles(missing,missing)
            self.assertEqual(report['conditionStatus'],'unknown')
            self.assertTrue(all(m['difference'] is None for m in report['metrics']))
            changed={**bundle,'manifest':{**bundle['manifest'],'physicalEventsHash':'other'}}
            self.assertEqual(compare_bundles(bundle,changed)['conditionStatus'],'different')
            pointer=(base/'data/latest.json').read_bytes();edit(ini,'Dijkstra132',{'simTimeLimit':1000000,'sendInterval':.00001},reader)
            job=run_manager.start(base,settings,ini,'Dijkstra132',reader);time.sleep(.2);start=time.monotonic();run_manager.cancel(job['runId'])
            while run_manager.state(job['runId'])['status'] in ('queued','running','stopping'):
                self.assertLess(time.monotonic()-start,2);time.sleep(.02)
            self.assertEqual(run_manager.state(job['runId'])['status'],'cancelled');self.assertEqual((base/'data/latest.json').read_bytes(),pointer)
            self.assertFalse((base/'data/runs'/job['runId']/'manifest.json').exists())
    def test_comparison_uses_custom_result_folder(self):
        import time
        from comparison import compare, run_metadata
        from run_manager import start, state
        with tempfile.TemporaryDirectory() as tmp:
            selected=Path(tmp)
            def read(name, variables=None):
                cfg=server.read_ini_config(name,variables=variables)
                cfg['simTimeLimit']=3.
                for station in cfg['stations']:
                    if station['enabled']:station.update(startTime=0,endTime=3.)
                return cfg
            job=start(server.BASE_DIR,server.LEO_DIR,server.INI_PATH,'Dijkstra132',read,
                      algorithms=['dijkstra-delay','mcsr-hr'],research={'executionMode':'sequential'},
                      results=selected)
            deadline=time.monotonic()+30
            while True:
                status=state(job['runId'])
                if status['status']=='completed':break
                self.assertNotIn(status['status'],('failed','cancelled'),status)
                self.assertLess(time.monotonic(),deadline)
                time.sleep(.1)
            ids=[row['runId'] for row in run_metadata(server.BASE_DIR,results=selected)]
            self.assertEqual(len(ids),2)
            self.assertTrue(compare(server.BASE_DIR,*ids,results=selected)['trafficMatches'])
            self.assertTrue((selected/'experiments'/job['runId']/'manifest.json').is_file())
            self.assertFalse((selected/'settings').exists())

    @unittest.skipUnless(__import__('os').name=='nt','Windows Job Object')
    def test_job_kills_engine_when_host_is_terminated(self):
        import _winapi, sys, time
        engine=Path(server.BASE_DIR)/'engine/engine.exe'
        for phase in ('prepare','execute'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);source=root/'input.json';marker=root/'pid'
                c=server.read_ini_config('Dijkstra132');c['simTimeLimit']=100000
                source.write_text(json.dumps(c),encoding='utf-8')
                code="""import sys,time
from pathlib import Path
from windows_runtime import launch_engine
marker=Path(sys.argv[1])
with marker.with_suffix('.log').open('wb') as log, launch_engine(sys.argv[2:],log,0x08000000) as engine:
    marker.write_text(str(engine.pid))
    time.sleep(60)
"""
                args=[str(engine),str(source),str(root)]
                if phase=='prepare':args.append('--prepare')
                with subprocess.Popen([sys.executable,'-c',code,str(marker),*args],cwd=server.BASE_DIR,
                                      creationflags=subprocess.CREATE_NO_WINDOW) as owner:
                    handle=None
                    try:
                        deadline=time.monotonic()+12
                        while not marker.exists() or not marker.read_text():
                            self.assertIsNone(owner.poll())
                            self.assertLess(time.monotonic(),deadline)
                            time.sleep(.05)
                        handle=_winapi.OpenProcess(0x00100000,False,int(marker.read_text()))
                        self.assertEqual(_winapi.WaitForSingleObject(handle,0),_winapi.WAIT_TIMEOUT)
                        owner.kill();owner.wait(timeout=5)
                        self.assertEqual(_winapi.WaitForSingleObject(handle,5000),0)
                    finally:
                        if owner.poll() is None:owner.kill()
                        if handle is not None:_winapi.CloseHandle(handle)
    def test_reference_core_fingerprints(self):
        root=Path(server.BASE_DIR)/'engine/vendor';origin=json.loads((root/'routing-origin.json').read_text())
        for name,digest in origin.items():self.assertEqual(hashlib.sha256((root/'routing'/name).read_bytes()).hexdigest(),digest)
    def test_imported_failure_events_are_validated(self):
        c=server.read_ini_config('Dijkstra132');c['scenario']={'entries':[],'failure_events':[{'time':1,'event':'failure','a':0,'b':1},{'time':2,'event':'restore','a':0,'b':1}]}
        self.assertEqual(len(load_external_inputs(c,server.INI_PATH)['failureReplayEvents']),2)
        c['scenario']['failure_events'][0]['event']='typo'
        with self.assertRaises(ValueError):load_external_inputs(c,server.INI_PATH)

if __name__=='__main__':unittest.main()
