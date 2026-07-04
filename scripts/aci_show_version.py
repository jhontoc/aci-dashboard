import argparse, json, os, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(__file__))
from utils.apic_session import ApicSession

parser = argparse.ArgumentParser()
parser.add_argument('--apic')
parser.add_argument('--user')
parser.add_argument('--pass',  dest='password')
parser.add_argument('--nodes', help='Comma-separated node IDs')
args = parser.parse_args()

session = ApicSession(args.apic, args.user, args.password)
node_ids = args.nodes.split(',')
snapshot = {"timestamp": datetime.utcnow().isoformat(), "command": "show_version", "nodes": {}}

for node_id in node_ids:
    endpoint = f"/api/node/mo/topology/pod-1/node-{node_id}/sys.json?query-target=self"
    data = session.get(endpoint)
    snapshot["nodes"][node_id] = data
    print(json.dumps({"node": node_id, "status": "collected"}))

# Save snapshot
filename = f"snapshot_{snapshot['timestamp'].replace(':','_')}__version.json"
out_path = os.path.join(os.path.dirname(__file__), '../data/snapshots', filename)
with open(out_path, 'w') as f:
    json.dump(snapshot, f, indent=2)

print(json.dumps({"snapshot_saved": filename}))