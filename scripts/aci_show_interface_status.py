#!/usr/bin/env python3
"""
aci_show_interface_status.py
Emits one JSON line per node to stdout:
  {"node": "101", "data": { "eth1/1": {...}, "eth1/2": {...} }}
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from utils.apic_session import ApicSession


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apic',  required=True)
    parser.add_argument('--user',  required=True)
    parser.add_argument('--pass',  dest='password', required=True)
    parser.add_argument('--nodes', required=True)
    return parser.parse_args()


def fetch_interfaces(session, node_id):
    endpoint = (
        f"/api/node/mo/topology/pod-1/node-{node_id}/sys.json"
        f"?query-target=subtree"
        f"&target-subtree-class=l1PhysIf"
        f"&rsp-prop-include=all"
    )
    resp = session.get(endpoint)
    interfaces = {}
    for item in resp.get('imdata', []):
        attrs    = item.get('l1PhysIf', {}).get('attributes', {})
        iface_id = attrs.get('id', 'unknown')
        interfaces[iface_id] = {
            'id':          iface_id,
            'adminSt':     attrs.get('adminSt',     ''),
            'operSt':      attrs.get('operSt',      ''),
            'speed':       attrs.get('speed',       ''),
            'duplex':      attrs.get('duplex',      ''),
            'mtu':         attrs.get('mtu',         ''),
            'medium':      attrs.get('medium',      ''),
            'layer':       attrs.get('layer',       ''),
            'portT':       attrs.get('portT',       ''),
            'usage':       attrs.get('usage',       ''),
            'descr':       attrs.get('descr',       ''),
            'autoNeg':     attrs.get('autoNeg',     ''),
            'switchingSt': attrs.get('switchingSt', ''),
        }
    return interfaces


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
            data = fetch_interfaces(session, node_id)
            # ── Emit the structured line the route expects ──
            print(json.dumps({'node': node_id, 'data': data}), flush=True)
        except Exception as e:
            print(json.dumps(
                {'status': 'error', 'node': node_id, 'message': str(e)}
            ), flush=True)


if __name__ == '__main__':
    main()