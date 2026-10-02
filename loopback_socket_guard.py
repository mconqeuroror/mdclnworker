#!/usr/bin/env python3
"""Run a Python entry point while refusing non-loopback Python sockets."""

from __future__ import annotations

import ipaddress
from pathlib import Path
import runpy
import socket
import sys
from typing import Any


class NetworkDenied(OSError):
    pass


def _host_is_loopback(host: Any) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", "strict")
    if not isinstance(host, str):
        return False
    normalized = host.strip().strip("[]").rstrip(".").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def validate_address(family: int, address: Any) -> None:
    if family == socket.AF_UNIX:
        return
    if family not in {socket.AF_INET, socket.AF_INET6}:
        raise NetworkDenied("offline registration refused a non-local socket family")
    if not isinstance(address, tuple) or not address or not _host_is_loopback(address[0]):
        raise NetworkDenied("offline registration refused a non-loopback connection")


def install_guard() -> None:
    original_socket = socket.socket
    original_getaddrinfo = socket.getaddrinfo

    class LoopbackSocket(original_socket):
        def connect(self, address: Any) -> None:
            validate_address(self.family, address)
            return super().connect(address)

        def connect_ex(self, address: Any) -> int:
            validate_address(self.family, address)
            return super().connect_ex(address)

        def sendto(self, data: bytes, *args: Any) -> int:
            if len(args) == 1:
                address = args[0]
            elif len(args) == 2:
                address = args[1]
            else:
                raise TypeError("sendto expected address or flags and address")
            validate_address(self.family, address)
            return super().sendto(data, *args)

        def sendmsg(
            self,
            buffers: Any,
            ancdata: Any = (),
            flags: int = 0,
            address: Any = None,
        ) -> int:
            if address is None:
                return super().sendmsg(buffers, ancdata, flags)
            validate_address(self.family, address)
            return super().sendmsg(buffers, ancdata, flags, address)

    def guarded_getaddrinfo(host: Any, *args: Any, **kwargs: Any):
        if not _host_is_loopback(host):
            raise NetworkDenied("offline registration refused external name resolution")
        return original_getaddrinfo(host, *args, **kwargs)

    socket.socket = LoopbackSocket
    socket.getaddrinfo = guarded_getaddrinfo


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: loopback_socket_guard.py PYTHON_FILE [ARG ...]")
    target = sys.argv[1]
    sys.argv = sys.argv[1:]
    # Match `python path/to/script.py`: imports beside the guarded entry point
    # must resolve from that script's directory, not this wrapper's directory.
    sys.path[0] = str(Path(target).resolve().parent)
    install_guard()
    runpy.run_path(target, run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
