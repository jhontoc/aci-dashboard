import requests
import urllib3
urllib3.disable_warnings()

class ApicSession:
    def __init__(self, apic_ip, username, password):
        self.base_url = f"https://{apic_ip}"
        self.session = requests.Session()
        self.session.verify = False
        self._login(username, password)

    def _login(self, username, password):
        payload = {
            "aaaUser": {
                "attributes": {"name": username, "pwd": password}
            }
        }
        resp = self.session.post(
            f"{self.base_url}/api/aaaLogin.json",
            json=payload
        )
        resp.raise_for_status()
        print("[AUTH] Login successful")

    def get(self, endpoint):
        resp = self.session.get(f"{self.base_url}{endpoint}")
        resp.raise_for_status()
        return resp.json()