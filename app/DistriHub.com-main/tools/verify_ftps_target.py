"""Verify the intended website in the FTPS root before any deployment writes."""
import ftplib
import io
import json
import os
import ssl
import time
import urllib.request


def verify_target(ftp, public_build):
    if not isinstance(public_build, str) or not public_build:
        raise RuntimeError("Website version is missing; deployment stopped")
    content = io.BytesIO()

    def receive(data):
        if content.tell() + len(data) > 65536:
            raise RuntimeError("Unexpected remote version file; deployment stopped")
        content.write(data)

    ftp.retrbinary("RETR app-version.json", receive)
    version = json.loads(content.getvalue().decode("utf-8-sig"))
    if version.get("buildId") != public_build:
        raise RuntimeError("FTPS folder does not match the live website version; deployment stopped")
    return public_build


def main():
    url = "https://distrihub.com.br/app-version.json?deploy-check=" + str(time.time_ns())
    with urllib.request.urlopen(url, timeout=20) as response:
        public_build = json.loads(response.read(65536)).get("buildId")
    # AUTH TLS and certificate validation precede login. Data transfers also use TLS.
    with ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=20) as ftp:
        ftp.connect(os.environ["FTP_SERVER"], int(os.environ.get("FTP_PORT") or "21"))
        ftp.auth()
        ftp.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
        ftp.prot_p()
        ftp.cwd(".")
        verify_target(ftp, public_build)
    print("Verified FTPS destination matches the live website. No files changed by verification.")


if __name__ == "__main__":
    main()
