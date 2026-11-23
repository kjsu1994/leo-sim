# SPDX-License-Identifier: GPL-3.0-only
# Modified/adapted 2026-11-16; see THIRD_PARTY_NOTICES.txt.
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server

HEADER = "time,route,source,station,firstSat,exitSat,satHops,uplinkMs,satToStationMs,totalMs,path\n"
ROW = "1.2,1,GS0,2,3,4,1,2.5,3.5,6,3-4\n"

class DataTests(unittest.TestCase):
    def test_result_catalog_uses_metadata_and_retains_legacy_results(self):
        from comparison import run_metadata
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)/'data/runs'
            for run_id, version, date in [('old-result', 'florasat-csv-ini-v1', '2026-11-18T00:00:00Z'),
                                          ('new-result', 'leo-native-replay-v4', '2026-11-19T00:00:00Z')]:
                folder = root/run_id
                folder.mkdir(parents=True)
                manifest = {'format': version, 'runId': run_id, 'configName': 'Dijkstra132', 'createdAt': date}
                manifest['files']={'routes.csv':'checksum'}
                (folder/'routes.csv').write_text('sample',encoding='utf8')
                if run_id == 'new-result':
                    manifest['algorithmSettings'] = {'algorithm': 'mcsr-hr'}
                (folder/'manifest.json').write_text(json.dumps(manifest), encoding='utf8')
            (root/'new-result'/'summary.json').write_text('never read', encoding='utf8')
            (root/'broken-result').mkdir()
            (root/'broken-result'/'manifest.json').write_text('{', encoding='utf8')
            rows = run_metadata(temp)
            self.assertEqual([row['runId'] for row in rows], ['new-result', 'old-result'])
            self.assertEqual([row['algorithm'] for row in rows], ['mcsr-hr', None])
            self.assertTrue(all('summary' not in row for row in rows))

    def test_new_bundle_waits_for_completion_and_matching_manifest(self):
        from comparison import commit_result, run_metadata
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            folder=base/'data/runs/current-run';folder.mkdir(parents=True)
            manifest={'format':'leo-native-replay-v4','runId':folder.name,'configName':'Dijkstra132',
                      'files':{'routes.csv':'checksum'},'completionRequired':True}
            path=folder/'manifest.json';path.write_text(json.dumps(manifest))
            for name in ('routes.csv','result.json','performance.json'):(folder/name).touch()
            self.assertEqual(run_metadata(base),[])
            with patch.object(Path,'replace',side_effect=PermissionError('read-only')):
                with self.assertRaises(PermissionError):commit_result(folder)
            self.assertFalse((folder/'completed.tmp').exists())
            self.assertEqual(run_metadata(base),[])
            commit_result(folder)
            self.assertEqual(run_metadata(base)[0]['runId'],folder.name)
            path.write_text(json.dumps({**manifest,'createdAt':'changed'}))
            self.assertEqual(run_metadata(base),[])

    @unittest.skipUnless(__import__("os").name=="nt","Windows workspace lock")
    def test_result_choice_leaves_settings_and_existing_results_in_place(self):
        from result_bundle import ENTRY
        from user_workspace import save_result_choice, select_results
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()
            assets=root/'release'; profile=root/'profile'; custom=root/'custom'
            for path in (assets,profile,custom):path.mkdir()
            ini=assets/'settings'/ENTRY;ini.parent.mkdir(parents=True);ini.write_text('edited')
            existing=assets/'data/runs/old-run';existing.mkdir(parents=True)
            self.assertEqual(select_results(assets,profile),(assets/'data',''))
            save_result_choice(profile,assets,assets/'data',custom)
            self.assertEqual(select_results(assets,profile),(custom,''))
            self.assertTrue(existing.is_dir())
            self.assertFalse((custom/'settings').exists())
            self.assertTrue((custom/'runs').is_dir())
            self.assertTrue((custom/'experiments').is_dir())
            self.assertEqual(ini.read_text(),'edited')
            save_result_choice(profile,assets,custom,None)
            self.assertEqual(select_results(assets,profile),(assets/'data',''))
    def test_workspace_logs_rotate(self):
        from user_workspace import setup_logging, logger
        with tempfile.TemporaryDirectory() as tmp:
            profile=Path(tmp)
            handler=setup_logging(profile)
            try:
                handler.maxBytes=120
                for i in range(12):logger.info('A diagnostic line for rotation: %s',i)
                self.assertEqual(len(list((profile/'logs').glob('app.log*'))),4)
            finally:
                logger.removeHandler(handler);handler.close()

    def test_all_existing_csv_fields_survive(self):
        raw = Path(server.BASE_DIR, "testdata/bundle/routes.csv").read_text()
        rows = list(csv.DictReader(io.StringIO(raw)))
        actual = server.parse_routes_csv(raw)
        self.assertEqual(len(actual), len(rows))
        for r, p in zip(rows, actual):
            self.assertEqual(p, [float(r["time"]), int(r["route"]), int(r["source"].lstrip("GST")), int(r["station"]), int(r["satHops"]), float(r["totalMs"]), list(map(int,r["path"].split("-"))), int(r["source"].startswith("T")), int(r["firstSat"]), int(r["exitSat"]), float(r["uplinkMs"]), float(r["satToStationMs"])])

    def test_bad_csv_is_rejected_instead_of_skipped(self):
        for raw in ["wrong\n", HEADER + ROW.replace("GS0", "bad"), HEADER + ROW.replace("1.2", "nan"), HEADER + ROW.replace("3-4", "3-5"), HEADER + ROW + ROW.replace("1.2", "0.1"), HEADER + ROW.replace(",1,2.5", ",2,2.5")]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                server.parse_routes_csv(raw)
        self.assertEqual(server.parse_routes_csv(HEADER), [])

    def test_terminal_and_zero_hop(self):
        p = server.parse_routes_csv(HEADER + "0,1,T7,2,3,3,0,0,1,1,3\n")[0]
        self.assertEqual(p[2], 7)
        self.assertEqual(p[7], 1)

    def test_unknown_config_cannot_reach_shell(self):
        with self.assertRaises(ValueError):
            server.read_ini_config("Dijkstra132; touch injected")
        self.assertEqual(server.read_ini_config("Dijkstra132Hop")["metric"], "hop")

    def test_ini_editor_opens_live_settings_without_modifying_files(self):
        import http.server
        import threading
        import urllib.request
        before = Path(server.INI_PATH).read_bytes()
        with patch.object(server.subprocess, "Popen") as launch:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), server.SimHandler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                request = urllib.request.Request(f"http://127.0.0.1:{httpd.server_port}/api/open-ini", method="POST")
                with urllib.request.urlopen(request) as response:
                    data = json.load(response)
                self.assertTrue(data["ok"])
                self.assertEqual(data["path"], server.INI_PATH)
                launch.assert_called_once_with(["notepad.exe", server.INI_PATH], creationflags=server.NO_WIN)
                self.assertEqual(Path(server.INI_PATH).read_bytes(), before)
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join()

    def test_large_result_api_reads_manifest_without_duplicate_json(self):
        import http.server,threading,urllib.request
        with tempfile.TemporaryDirectory() as tmp,patch.object(server,'BASE_DIR',tmp):
            base=Path(tmp);folder=base/'data/runs/large-result-run';folder.mkdir(parents=True)
            (base/'data/latest.json').write_text(json.dumps({'runId':'large-result-run'}))
            manifest={'runId':'large-result-run','files':{'routes.csv':'checksum'}}
            (folder/'manifest.json').write_text(json.dumps(manifest))
            (folder/'routes.csv').write_text('sample',encoding='utf8')
            with (folder/'result.json').open('wb') as f:f.seek(9*1024*1024);f.write(b'invalid duplicate JSON')
            httpd=http.server.ThreadingHTTPServer(('127.0.0.1',0),server.SimHandler);thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
            try:
                for query in ('','?metadata=1'):
                    with urllib.request.urlopen(f'http://127.0.0.1:{httpd.server_port}/api/result'+query) as response:result=json.load(response)
                    self.assertEqual(result['bundle']['manifest'],manifest)
                    self.assertEqual(result['bundle']['fileUrls']['routes.csv'],'/data/runs/large-result-run/routes.csv')
                (base/'data/latest.json').unlink()
                with urllib.request.urlopen(f'http://127.0.0.1:{httpd.server_port}/api/result') as response:
                    self.assertIsNone(json.load(response))
                with urllib.request.urlopen(f'http://127.0.0.1:{httpd.server_port}/api/result?runId=large-result-run&metadata=1') as response:
                    self.assertEqual(json.load(response)['bundle']['manifest'],manifest)

            finally:httpd.shutdown();httpd.server_close();thread.join()

    def test_missing_include_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "omnetpp.ini")
            path.write_text("include missing.ini\n")
            with self.assertRaises(ValueError):
                server._parse_ini_tree(str(path))

    def test_local_engine_is_reproducible_without_original(self):
        import subprocess
        from native_engine import configuration
        cfg=configuration(server.read_ini_config("Dijkstra132"))
        cfg["simTimeLimit"]=10
        outputs=[]
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(2):
                folder=Path(tmp,str(i));folder.mkdir()
                file=folder/"input.json";file.write_text(json.dumps(cfg))
                subprocess.run([str(Path(server.BASE_DIR,"engine/engine.exe")),str(file),str(folder)],check=True)
                outputs.append((folder/"routes.csv").read_bytes())
                summary=json.loads((folder/"summary.json").read_text())
                self.assertEqual(summary["attempted"],summary["received"]+summary["dropped"]+summary["inFlight"])
                server.parse_routes_csv(outputs[-1].decode())
        self.assertEqual(outputs[0],outputs[1])

    def test_native_queue_and_hop_limit(self):
        import subprocess
        from native_engine import configuration
        base=configuration(server.read_ini_config("Dijkstra132"))
        base["simTimeLimit"]=2
        base["minimumElevation"]=-90
        base["maxGroundLinks"]=500
        base["packetTrace"]=True
        base["groundlinkDatarate"]=1000000
        base["islDatarate"]=1000000
        for st in base["stations"]:
            st["enabled"]=False
        base["stations"][0].update(enabled=True,dstStation=10,startTime=0,sendInterval=.001)
        with tempfile.TemporaryDirectory() as tmp:
            for hops in (64,0):
                cfg=json.loads(json.dumps(base));cfg["maxHops"]=hops
                folder=Path(tmp,str(hops));folder.mkdir()
                file=folder/"input.json";file.write_text(json.dumps(cfg))
                subprocess.run([str(Path(server.BASE_DIR,"engine/engine.exe")),str(file),str(folder)],check=True)
                summary=json.loads((folder/"summary.json").read_text())
                self.assertEqual(summary["attempted"],summary["received"]+summary["dropped"]+summary["inFlight"])
                self.assertGreater(summary["sent"],100)
                if hops==0:
                    self.assertEqual(summary["received"],0)
                    self.assertGreater(summary["dropped"],0)
                else:
                    self.assertGreater(summary["received"],0)
                    self.assertGreater(summary["inFlight"],0)
                    deliveries=list(csv.DictReader((folder/"events.csv").read_text().splitlines()))
                    self.assertTrue(any(r["event"]=="receive" and float(r["detail"])>.1 for r in deliveries))

    def test_native_runs_from_isolated_product_folder(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            shutil.copytree(Path(server.BASE_DIR,"settings"),root/"settings")
            (root/"engine").mkdir()
            shutil.copy2(Path(server.BASE_DIR,"engine/engine.exe"),root/"engine/engine.exe")
            shutil.copy2(Path(server.BASE_DIR,"replay-model.json"),root/"replay-model.json")
            with patch.object(server,"BASE_DIR",tmp),patch.object(server,"LEO_DIR",str(root/"settings")),patch.object(server,"INI_PATH",str(root/"settings/simulations/Network/scenarios.ini")):
                result=server.run_simulation("Dijkstra132")
            self.assertEqual(result["bundle"]["manifest"]["engine"]["id"],"leo-native")
            self.assertTrue((root/"data/runs"/result["runId"]/"routes.csv").is_file())
            self.assertFalse((root/"leo-main").exists())

    def test_hop_preset_selects_hop_algorithm(self):
        from native_engine import configuration
        cfg=configuration(server.read_ini_config("Dijkstra132Hop"))
        self.assertEqual(cfg["metric"],"hop")
        self.assertEqual(cfg["algorithm"],"dijkstra-hop")

    def test_dijkstra_baselines_resolve_to_dijkstra_in_live_and_default_ini(self):
        ini = Path(server.INI_PATH)
        for path in (ini, ini.with_suffix(".defaults")):
            for name in ("Dijkstra132StationsOnly", "PaperS1DijkstraCutFlood",
                         "PaperS1DijkstraCutFloodLoad"):
                with self.subTest(ini=path.name, config=name):
                    cfg = server.read_ini_config(name, entry_path=str(path))
                    self.assertEqual((cfg["algorithm"], cfg["routingType"], cfg["metric"]),
                                     ("dijkstra-delay", "Sat_Net_DijkstraRouting", "delay"))

    def test_derived_routing_selector_overrides_ancestor_saved_algorithm(self):
        from config_editor import edit
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            settings=Path(tmp)/'settings';shutil.copytree(Path(server.LEO_DIR),settings)
            ini=settings/'simulations/Network/scenarios.ini'
            read=lambda name:server.read_ini_config(name,entry_path=str(ini))
            edit(ini,'Dijkstra132',{'algorithm':'dijkstra-delay'},read)
            self.assertEqual(read('Dijkstra132Hop')['algorithm'],'dijkstra-hop')
            self.assertEqual(read('Mcsr132')['algorithm'],'mcsr-ls')
            edit(ini,'Dijkstra132Hop',{'algorithm':'mcsr-ts'},read)
            self.assertEqual(read('Dijkstra132Hop')['algorithm'],'mcsr-ts')
            self.assertEqual(read('Dijkstra132')['algorithm'],'dijkstra-delay')

    def test_defaults_preview_and_save_only_replace_selected_section(self):
        import shutil
        from config_editor import edit,preview_defaults
        with tempfile.TemporaryDirectory() as tmp:
            settings=Path(tmp)/'settings';shutil.copytree(Path(server.LEO_DIR),settings)
            ini=settings/'simulations/Network/scenarios.ini'
            read=lambda name:server.read_ini_config(name,entry_path=str(ini))
            edit(ini,'Dijkstra132',{'altitude':605},read)
            edit(ini,'Dijkstra132PairFail',{'altitude':650,'senders':[0,1],'sendInterval':.08},read)
            before=ini.read_bytes()
            draft=preview_defaults(ini,'Dijkstra132PairFail')
            self.assertEqual(draft['altitude'],605)
            self.assertEqual([st['id'] for st in draft['stations'] if st['enabled']],[0])
            self.assertEqual(draft['stations'][0]['sendInterval'],.02)
            self.assertEqual(read('Dijkstra132PairFail')['altitude'],650)
            self.assertEqual(ini.read_bytes(),before)
            result=edit(ini,'Dijkstra132PairFail',{'simTimeLimit':320},read,reset=True)
            self.assertEqual(result['altitude'],605)
            self.assertEqual(result['simTimeLimit'],320)
            self.assertEqual(result['stations'][0]['sendInterval'],.02)
            self.assertEqual(read('Dijkstra132')['altitude'],605)
            self.assertFalse(list(ini.parent.glob('.validate-*.ini')))

    def test_native_rejects_invalid_settings(self):
        from native_engine import configuration
        cfg=server.read_ini_config("Dijkstra132")
        cfg["effectiveEntries"].append({"k":"*.**.planeCount","v":"0","sec":"probe"})
        with self.assertRaises(ValueError): configuration(cfg)

if __name__ == "__main__":
    unittest.main()
