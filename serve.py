from __future__ import annotations

import argparse

from lottobang.official_data import resolve_draws_csv
from lottobang.tls import DEFAULT_CERT_FILE, DEFAULT_KEY_FILE
from lottobang.webapp import serve


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local lottery research dashboard.")
    parser.add_argument("--host", default="localhost", help="Host interface to bind.")
    parser.add_argument("--port", type=int, default=8010, help="Port to bind.")
    parser.add_argument(
        "--csv",
        default=str(resolve_draws_csv()),
        help="Path to the draw history CSV file.",
    )
    parser.add_argument("--https", action="store_true", help="Serve over HTTPS using a local development certificate.")
    parser.add_argument(
        "--cert-file",
        default=str(DEFAULT_CERT_FILE),
        help="Path to the TLS certificate file used with --https.",
    )
    parser.add_argument(
        "--key-file",
        default=str(DEFAULT_KEY_FILE),
        help="Path to the TLS private key file used with --https.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    serve(
        host=args.host,
        port=args.port,
        csv_path=args.csv,
        use_https=args.https,
        cert_file=args.cert_file,
        key_file=args.key_file,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
