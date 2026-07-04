#!/usr/bin/env python3
"""
aci_show_interface_status.py
Fetches physical interface status for target nodes via APIC REST API.
Saves a timestamped JSON snapshot to data/snapshots/.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from utils.apic_session import ApicSession


def parse_args():
    parser = argparse.ArgumentParser(
        description="Collect interface status from Cisco APIC"
    )
    parser.add_argument("--apic",  required=True, help="APIC IP or hostname")
    parser.add_argument("--user",  required=True, help="APIC username")
    parser.add_argument("--pass",  dest="password", required=True, help="APIC password")
    parser.add_argument("--nodes", required=True, help="Comma-separated node IDs")
    return parser.parse_args()


def fetch_interfaces(session, node_id):
    """
    Query all physical interface endpoints for a given node.
    Returns a dict keyed by interface ID.
    """
    endpoint = (
        f"/api/node/mo/topology/pod-1/node-{node_id}/sys.json"
        f"?query-target=subtree"
        f"&target-subtree-class=l1PhysIf"
        f"&rsp-prop-include=all"
    )
    data = session.get(endpoint)
    interfaces = {}

    for item in data.get("imdata", []):
        attrs = item.get("l1PhysIf", {}).get("attributes", {})
        iface_id = attrs.get("id", "unknown")
        interfaces[iface_id] = {
            "id":           iface_id,
            "adminSt":      attrs.get("adminSt",      ""),
            "operSt":       attrs.get("operSt",       ""),
            "speed":        attrs.get("speed",        ""),
            "duplex":       attrs.get("duplex",       ""),
            "mtu":          attrs.get("mtu",          ""),
            "medium":       attrs.get("medium",       ""),
            "layer":        attrs.get("layer",        ""),
            "portT":        attrs.get("portT",        ""),
            "usage":        attrs.get("usage",        ""),
            "descr":        attrs.get("descr",        ""),
            "autoNeg":      attrs.get("autoNeg",      ""),
            "switchingSt":  attrs.get("switchingSt",  ""),
        }

    return interfaces


def main():
    args    = parse_args()
    node_ids = [n.strip() for n in args.nodes.split(",") if n.strip()]

    print(json.dumps({"status": "connecting", "apic": args.apic}), flush=True)

    try:
        session = ApicSession(args.apic, args.user, args.password)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Login failed: {e}"}), flush=True)
        sys.exit(1)

    snapshot = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "command":   "show_interface_status",
        "apic":      args.apic,
        "nodes":     {}
    }

    for node_id in node_ids:
        print(json.dumps({"status": "collecting", "node": node_id}), flush=True)
        try:
            interfaces = fetch_interfaces(session, node_id)
            snapshot["nodes"][node_id] = interfaces
            print(
                json.dumps({
                    "status":          "collected",
                    "node":            node_id,
                    "interface_count": len(interfaces)
                }),
                flush=True
            )
        except Exception as e:
            print(json.dumps({"status": "error", "node": node_id, "message": str(e)}), flush=True)
            snapshot["nodes"][node_id] = {"error": str(e)}

    # ── Save snapshot ─────────────────────────────────────────
    ts       = snapshot["timestamp"].replace(":", "_").replace("+", "_")
    filename = f"snapshot_{ts}__interface_status.json"
    out_dir  = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, filename)

    with open(out_path, "w") as f:
        json.dump(snapshot, f, indent=2)

    print(json.dumps({"snapshot_saved": filename}), flush=True)


if __name__ == "__main__":
    main()