"""NO NETWORK CALLS OUT. The container has no route out (docker-compose: an internal network); this is the second lock, inside the process.

install() makes creating or using an internet socket an error: connect, sendto and name lookups raise. Local (AF_UNIX) sockets are left alone, because
a library may use one to talk to its own helper. A reader that tries to fetch a model, a font, an image in a document or a link in a page is told no,
and the job fails with the reason rather than reaching out. Models are baked into the image when it is built (the Dockerfile), where the network is open.
"""
from __future__ import annotations

import socket


class NetworkBlocked(OSError):
    pass


_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_sendto = socket.socket.sendto

    def deny(*_a, **_k):
        raise NetworkBlocked("this worker makes no network calls")

    def inet(sock: socket.socket) -> bool:
        return sock.family in (socket.AF_INET, socket.AF_INET6)

    def connect(self, address):
        if inet(self):
            deny()
        return real_connect(self, address)

    def connect_ex(self, address):
        if inet(self):
            deny()
        return real_connect_ex(self, address)

    def sendto(self, *args):
        if inet(self):
            deny()
        return real_sendto(self, *args)

    socket.socket.connect = connect  # type: ignore[method-assign]
    socket.socket.connect_ex = connect_ex  # type: ignore[method-assign]
    socket.socket.sendto = sendto  # type: ignore[method-assign]
    socket.getaddrinfo = deny  # type: ignore[assignment]
    socket.gethostbyname = deny  # type: ignore[assignment]
    socket.gethostbyname_ex = deny  # type: ignore[assignment]
    socket.create_connection = deny  # type: ignore[assignment]
