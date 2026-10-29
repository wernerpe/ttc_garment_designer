"""Serve the app with browser caching turned off, so edits show up on a normal reload.

    python3 tools/serve.py                 # http://localhost:8000, this machine only
    python3 tools/serve.py 8000 0.0.0.0    # also reachable from other machines on the network
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # browsers revalidate every file (cheap 304s when unchanged) instead of guessing
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer((bind, port), handler) as httpd:
        host = "localhost" if bind in ("127.0.0.1", "localhost") else bind
        print(f"Serving {ROOT} at http://{host}:{port}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
