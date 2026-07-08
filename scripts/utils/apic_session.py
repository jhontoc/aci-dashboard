"""
apic_session.py
Cisco APIC REST API session manager.

"""

import json
import os
import sys
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Import proxy helpers from aci_auth_Proxy.py ──────────────
# Both files live in scripts/utils/ so we resolve the path
# explicitly to avoid import issues when called from parent dirs
_UTILS_DIR = os.path.dirname(os.path.abspath(__file__))
if _UTILS_DIR not in sys.path:
    sys.path.insert(0, _UTILS_DIR)

from aci_auth_Proxy import load_proxy_from_yaml, build_proxy   # noqa: E402


# ── SOCKS5 availability check ─────────────────────────────────
def _validate_socks5(protocol: str) -> None:
    """
    Validates PySocks is installed when a SOCKS5 proxy is configured.
    Raises ImportError with fix instructions if the library is missing.
    """
    if protocol.lower() in ("socks5", "socks5h"):
        try:
            import socks  # noqa: F401
        except ImportError:
            raise ImportError(
                "[ERROR] PySocks is not installed but a SOCKS5 proxy "
                "is configured.\n"
                "        Fix: pip install 'requests[socks]'"
            )


# ── ApicSession ───────────────────────────────────────────────
class ApicSession:

    def __init__(
        self,
        apic_ip:    str,
        username:   str,
        password:   str,
        api_port:   str  = "443",
        proxy_yaml: str  = None,
        verify_ssl: bool = False,
        timeout:    int  = 30
    ):

        self.base_url    = f"https://{apic_ip}:{api_port}"
        self.verify_ssl  = verify_ssl
        self.timeout     = timeout
        self.token       = None
        self.login_node  = None
        self._proxy_info = None

        # ── Resolve proxy settings ────────────────────────────
        # Delegates entirely to aci_auth_Proxy.py functions
        if proxy_yaml:
            # load_proxy_from_yaml() — from aci_auth_Proxy.py
            self._proxy_info = load_proxy_from_yaml(proxy_yaml)
            _validate_socks5(self._proxy_info['protocol'])
            self.proxies = build_proxy(...)

        else:
            # No proxy — empty strings match aci_auth_Proxy.py
            # direct-connection pattern
                self.proxies     = {"http": "", "https": ""}   # ← direct connection
                self._proxy_info = None

        # ── Create persistent requests session ────────────────
        # requests.Session() stores the APIC-cookie automatically
        # and re-sends it on every subsequent API call without
        # manual token header management
        self.session         = requests.Session()
        self.session.verify  = self.verify_ssl
        self.session.proxies = self.proxies

        # ── Authenticate immediately on instantiation ─────────
        self._login(username, password)


    # ─────────────────────────────────────────────────────────
    def _login(self, username: str, password: str) -> None:

        # Raw string payload — same format as aci_auth_Proxy.py
        login_data = (
            '{ "aaaUser": { "attributes": { '
            f'"name": "{username}", "pwd": "{password}" '
            '}}}'
        )

        url = f"{self.base_url}/api/aaaLogin.json"

        # ── Connection info ───────────────────────────────────
        print(f"[AUTH] Connecting  : {self.base_url}", flush=True)

        if self._proxy_info:
            print(
                f"[AUTH] Via proxy   : "
                f"{self._proxy_info['protocol']}://"
                f"{self._proxy_info['host']}:"
                f"{self._proxy_info['port']}",
                flush=True
            )
        else:
            print("[AUTH] Proxy       : None (direct)", flush=True)

        # ── Send login POST ───────────────────────────────────
        response = self.session.post(
            url,
            data=login_data,          # raw string — matches aci_auth_Proxy.py
            verify=self.verify_ssl,
            proxies=self.proxies,
            timeout=self.timeout
        )
        response.raise_for_status()

        # ── Extract token — same logic as aci_auth_Proxy.py ──
        json_response   = json.loads(response.text)
        aaa_login       = json_response['imdata'][0]
        self.token      = aaa_login['aaaLogin']['attributes']['token']
        self.login_node = aaa_login['aaaLogin']['attributes'].get('node', '')

        print(
            f"[AUTH] Login OK    : "
            f"Node {self.login_node} | "
            f"Token {self.token[:20]}…",
            flush=True
        )


    # ─────────────────────────────────────────────────────────
    def refresh(self) -> None:
        """
        GET /api/aaaRefresh.json
        Resets the session idle timer.
        Call if your script runs longer than 600 seconds
        (default APIC session timeout).
        """
        response = self.session.get(
            f"{self.base_url}/api/aaaRefresh.json",
            verify=self.verify_ssl,
            proxies=self.proxies,
            timeout=self.timeout
        )
        response.raise_for_status()
        print("[AUTH] Session refreshed.", flush=True)


    # ─────────────────────────────────────────────────────────
    def get(self, endpoint: str) -> dict:
        """
        Authenticated GET against the APIC REST API.
        The APIC-cookie is sent automatically by requests.Session.

        Parameters
        ----------
        endpoint : API path string, e.g.
                   /api/node/mo/topology/pod-1/node-101/sys.json
        """
        response = self.session.get(
            f"{self.base_url}{endpoint}",
            verify=self.verify_ssl,
            proxies=self.proxies,
            timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()


    # ─────────────────────────────────────────────────────────
    def post(self, endpoint: str, payload: str) -> dict:
        """
        Authenticated POST against the APIC REST API.
        Accepts a raw JSON string to match APIC expectations.

        Parameters
        ----------
        endpoint : API path string
        payload  : Raw JSON string body
        """
        response = self.session.post(
            f"{self.base_url}{endpoint}",
            data=payload,
            verify=self.verify_ssl,
            proxies=self.proxies,
            timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()


    # ─────────────────────────────────────────────────────────
    def logout(self) -> None:
        """
        POST /api/aaaLogout.json
        Explicitly releases the APIC session slot.
        Called automatically when used as a context manager.
        Best-effort — never raises so it is safe in finally blocks.
        """
        try:
            logout_data = (
                '{ "aaaUser": { "attributes": { "name": "" } } }'
            )
            self.session.post(
                f"{self.base_url}/api/aaaLogout.json",
                data=logout_data,
                verify=self.verify_ssl,
                proxies=self.proxies,
                timeout=self.timeout
            )
            print("[AUTH] Logout successful.", flush=True)
        except Exception as e:
            # Non-critical — log and continue
            print(f"[AUTH] Logout warning (non-critical): {e}", flush=True)
        finally:
            self.session.close()


    # ── Context manager ───────────────────────────────────────
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.logout()
        return False    # never suppress exceptions