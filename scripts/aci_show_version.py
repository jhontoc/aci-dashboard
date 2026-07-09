#!/usr/bin/env python3
"""
aci_show_version.py

Collects firmware version data from Cisco APIC for target nodes.
Emits one JSON line per node to stdout:
  {"node": "101", "data": { ...fields... }}

Does NOT save any files — snapshot saving is handled
entirely by routes/commands.js on the Node.js side.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from utils.apic_session import ApicSession


def parse_args():
    parser = argparse.ArgumentParser(
        description='Collect show version from Cisco APIC'
    )
    parser.add_argument('--apic',  required=True,               help='APIC IP or hostname')
    parser.add_argument('--user',  required=True,               help='APIC username')
    parser.add_argument('--pass',  dest='password', required=True, help='APIC password')
    parser.add_argument('--nodes', required=True,               help='Comma-separated node IDs')
    parser.add_argument('--port',  default='443',               help='APIC API port')
    parser.add_argument('--proxy', default=None,                help='Path to proxy YAML file')
    return parser.parse_args()


def fetch_version(session, node_id):
    """
    Query topSystem for a single node.
    Returns a flat dict of version attributes.
    """
    endpoint = (
        '/api/node/mo/topology/pod-1/node-' + node_id + '/sys.json'
        '?query-target=self'
    )
    resp  = session.get(endpoint)
    attrs = {}
    for item in resp.get('imdata', []):
        attrs = item.get('topSystem', {}).get('attributes', {})
        break

    return {
        'nodeId':      node_id,
        'state':       attrs.get('state',        ''),
        'role':        attrs.get('role',         ''),
        'address':     attrs.get('address',      ''),
        'version':     attrs.get('version',      ''),
        'model':       attrs.get('model',        ''),
        'serial':      attrs.get('serial',       ''),
        'uptime':      attrs.get('systemUpTime', ''),
        'oobMgmtAddr': attrs.get('oobMgmtAddr',  ''),
        'podId':       attrs.get('podId',        ''),
    }


def main():
    args     = parse_args()
    node_ids = [n.strip() for n in args.nodes.split(',') if n.strip()]

    print(
        json.dumps({'status': 'connecting', 'apic': args.apic}),
        flush=True
    )

    try:
        with ApicSession(
            apic_ip    = args.apic,
            username   = args.user,
            password   = args.password,
            api_port   = args.port,
            proxy_yaml = args.proxy    # None → direct connection
        ) as session:

            for node_id in node_ids:
                print(
                    json.dumps({'status': 'collecting', 'node': node_id}),
                    flush=True
                )
                try:
                    data = fetch_version(session, node_id)

                    # ── Emit node data line — picked up by commands.js ──
                    # This is the ONLY output that matters for snapshot building
                    # NO file saving here — commands.js handles that
                    print(
                        json.dumps({'node': node_id, 'data': data}),
                        flush=True
                    )

                except Exception as e:
                    print(
                        json.dumps({
                            'status':  'error',
                            'node':    node_id,
                            'message': str(e)
                        }),
                        flush=True
                    )

    except Exception as e:
        print(
            json.dumps({'status': 'error', 'message': str(e)}),
            flush=True
        )
        sys.exit(1)


if __name__ == '__main__':
    main()