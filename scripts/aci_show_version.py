#!/usr/bin/env python3
"""
aci_show_version.py
Emits one JSON line per node to stdout:
  {"node": "101", "data": { ...attrs... }}
The Node.js commands route merges these into the unified snapshot.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from utils.apic_session import ApicSession


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apic',  required=True)
    parser.add_argument('--user',  required=True)
    parser.add_argument('--pass',  dest='password', required=True)
    parser.add_argument('--nodes', required=True)
    return parser.parse_args()


def fetch_version(session, node_id):
    endpoint = (
        f"/api/node/mo/topology/pod-1/node-{node_id}/sys.json"
        f"?query-target=self"
    )
    resp = session.get(endpoint)
    attrs = {}
    for item in resp.get('imdata', []):
        attrs = item.get('topSystem', {}).get('attributes', {})
        break
    return {
        'nodeId':    node_id,
        'state':     attrs.get('state',     ''),
        'role':      attrs.get('role',      ''),
        'address':   attrs.get('address',   ''),
        'version':   attrs.get('version',   ''),
        'model':     attrs.get('model',     ''),
        'serial':    attrs.get('serial',    ''),
        'uptime':    attrs.get('systemUpTime', ''),
        'oobMgmtAddr': attrs.get('oobMgmtAddr', ''),
        'podId':     attrs.get('podId',     ''),
    }


def main():
    args     = parse_args()
    node_ids = [n.strip() for n in args.nodes.split(',') if n.strip()]

    print(json.dumps({'status': 'connecting', 'apic': args.apic}), flush=True)

    try:
        session = ApicSession(args.apic, args.user, args.password)
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': str(e)}), flush=True)
        sys.exit(1)

    for node_id in node_ids:
        print(json.dumps({'status': 'collecting', 'node': node_id}), flush=True)
        try:
            data = fetch_version(session, node_id)
            # ── Emit the structured line the route expects ──
            print(json.dumps({'node': node_id, 'data': data}), flush=True)
        except Exception as e:
            print(json.dumps(
                {'status': 'error', 'node': node_id, 'message': str(e)}
            ), flush=True)


if __name__ == '__main__':
    main()