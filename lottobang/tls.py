from __future__ import annotations

import ssl
import subprocess
from pathlib import Path

TLS_ROOT = Path(__file__).resolve().parent.parent / ".tls"
DEFAULT_CERT_FILE = TLS_ROOT / "localhost.pem"
DEFAULT_KEY_FILE = TLS_ROOT / "localhost-key.pem"


def ensure_localhost_certificate(
    cert_file: str | Path = DEFAULT_CERT_FILE,
    key_file: str | Path = DEFAULT_KEY_FILE,
) -> tuple[Path, Path]:
    cert_path = Path(cert_file)
    key_path = Path(key_file)
    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    if cert_path.exists() and key_path.exists():
        return cert_path, key_path

    command = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-days",
        "365",
        "-keyout",
        str(key_path),
        "-out",
        str(cert_path),
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    return cert_path, key_path


def build_ssl_context(
    cert_file: str | Path = DEFAULT_CERT_FILE,
    key_file: str | Path = DEFAULT_KEY_FILE,
) -> ssl.SSLContext:
    cert_path, key_path = ensure_localhost_certificate(cert_file=cert_file, key_file=key_file)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
    return context
