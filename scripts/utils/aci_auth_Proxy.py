import requests
import json
import urllib3
import argparse
import yaml
import os

# Suppress SSL warnings (same approach as cisco_aci_api.py)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Exported symbols for use by apic_session.py ─────────────
__all__ = ['load_proxy_from_yaml', 'build_proxy']

def load_proxy_from_yaml(proxy_filename: str) -> dict:
    """
    Load proxy settings from YAML file.
    Mirrors the proxy loading logic from cisco_health_check.py and chc_app.py.
    Only expects: host, port, protocol (no credentials in YAML).
    """
    if not os.path.exists(proxy_filename):
        print(f"[ERROR] Proxy settings file not found: {proxy_filename}")
        exit(1)

    with open(proxy_filename, 'r') as proxy_file:
        proxy_settings = yaml.safe_load(proxy_file)

    # Extract only the three fields defined in the YAML
    protocol = proxy_settings['proxy']['protocol']
    host     = proxy_settings['proxy']['host']
    port     = proxy_settings['proxy']['port']

    return {"protocol": protocol, "host": host, "port": port}


def build_proxy(protocol: str, host: str, port: str) -> dict:
    """
    Build proxy dictionary from the three YAML fields.
    No credentials as they are not present in the proxy YAML file.
    Mirrors ProxyApi logic from cisco_aci_api.py.
    """
    host_port  = f"{host}:{port}"
    proxy_url  = f"{protocol}://{host_port}"

    return {"http": proxy_url, "https": proxy_url}


def test_apic_auth(
    host_ip: str,
    api_port: str,
    username: str,
    password: str,
    proxy_settings: dict = {}
) -> None:
    """
    Test authentication to Cisco APIC REST API with SOCKS5 proxy support.
    Mirrors the start_connection() logic from DeviceAciApi in cisco_aci_api.py.
    """

    # --- Build Proxy Settings ---
    if proxy_settings:
        proxies = build_proxy(
            proxy_settings['protocol'],
            proxy_settings['host'],
            proxy_settings['port']
        )
    else:
        proxies = {"http": "", "https": ""}

    # --- Build Login Payload (same structure as cisco_aci_api.py) ---
    login_data = '{ "aaaUser": { "attributes": { "name": "' + username + '", "pwd": "' + password + '" }}}'

    # --- Build Login URL ---
    url = f"https://{host_ip}:{api_port}/api/aaaLogin.json"

    print("\n" + "=" * 60)
    print("  Cisco APIC API - Authentication Test")
    print("=" * 60)
    print(f"  Host           : {host_ip}")
    print(f"  Port           : {api_port}")
    print(f"  Username       : {username}")
    print(f"  URL            : {url}")
    if proxy_settings:
        print(f"  Proxy Protocol : {proxy_settings['protocol']}")
        print(f"  Proxy Host     : {proxy_settings['host']}")
        print(f"  Proxy Port     : {proxy_settings['port']}")
    else:
        print(f"  Proxy          : None")
    print("=" * 60)

    try:
        # --- Validate SOCKS5 availability ---
        if proxy_settings and proxy_settings['protocol'].lower() in ["socks5", "socks5h"]:
            try:
                import socks  # noqa: F401 - validate PySocks is installed
                print("\n[INFO] SOCKS5 proxy support detected (PySocks installed).")
            except ImportError:
                print("\n[ERROR] PySocks is not installed.")
                print("        Run: pip install 'requests[socks]'")
                return

        # --- Send POST Login Request ---
        print("[INFO] Sending authentication request...")
        login = requests.post(
            url,
            data=login_data,
            verify=False,       # SSL verification disabled (matches cisco_aci_api.py)
            proxies=proxies,
            timeout=30
        )

        # --- Parse Response ---
        json_login = json.loads(login.text)

        # --- Extract Token (same logic as cisco_aci_api.py) ---
        aaa_login   = json_login['imdata'][0]
        login_token = aaa_login['aaaLogin']['attributes']['token']
        login_node  = aaa_login['aaaLogin']['attributes']['node']

        # --- Success ---
        print("\n[SUCCESS] Authentication successful!")
        print(f"  HTTP Status : {login.status_code}")
        print(f"  Login Node  : {login_node}")
        print(f"  APIC Token  : {login_token[:40]}...")  # Truncated for display
        print("=" * 60 + "\n")

    except KeyError as e:
        print(f"\n[FAILED] Unexpected response structure. Missing key: {e}")
        print(f"  Raw Response : {login.text[:300]}")
        print("=" * 60 + "\n")

    except requests.exceptions.ConnectionError as e:
        print(f"\n[FAILED] Connection error. Could not reach {host_ip}:{api_port}")
        print(f"  Detail       : {e}")
        print("  Verify host IP, API port, and SOCKS5 proxy settings.")
        print("=" * 60 + "\n")

    except requests.exceptions.Timeout:
        print(f"\n[FAILED] Connection timed out reaching {host_ip}:{api_port}")
        print("=" * 60 + "\n")

    except Exception as e:
        print(f"\n[FAILED] Authentication failed. Exception: {e}")
        print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Cisco APIC API Authentication Test with SOCKS5 Proxy")

    # APIC Arguments
    parser.add_argument('--host',  required=True,  help='APIC Host IP Address')
    parser.add_argument('--port',  required=True,  help='APIC API Port (e.g. 443)')
    parser.add_argument('--user',  required=True,  help='APIC Username')
    parser.add_argument('--pwd',   required=True,  help='APIC Password')

    # Proxy Argument — matches --proxy flag from cisco_health_check.py
    parser.add_argument('--proxy', default=None,   help='Path to proxy YAML settings file')

    args = parser.parse_args()

    # Load proxy settings from YAML if provided
    proxy_settings = {}
    if args.proxy is not None:
        proxy_settings = load_proxy_from_yaml(args.proxy)

    test_apic_auth(
        host_ip=args.host,
        api_port=args.port,
        username=args.user,
        password=args.pwd,
        proxy_settings=proxy_settings
    )


if __name__ == "__main__":
    main()