#!/usr/bin/env python3
"""Empacota o projeto e envia por SFTP para /opt/notas-vps na VPS.

Uso:
    python scripts/deploy.py

Requer d:/servidor-vps/.env com ip=, user=, password= (credenciais SSH root da VPS).
Não faz o build remoto — isso é feito manualmente por SSH (ver DEPLOY.md), para
poder intercalar `docker stop hermes` entre os builds e evitar OOM.
"""
import os
import tarfile
import io
import sys

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = "d:/servidor-vps/.env"
REMOTE_DIR = "/opt/notas-vps"

EXCLUDE_DIRS = {"node_modules", "dist", ".angular", "bin", "obj", "backups"}
EXCLUDE_FILES = {".env"}
EXCLUDE_PREFIXES = ("data/db/",)


def read_env(path):
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            env[k.strip()] = v
    return env


def should_include(rel_path):
    parts = rel_path.replace("\\", "/").split("/")
    if any(p in EXCLUDE_DIRS for p in parts):
        return False
    if os.path.basename(rel_path) in EXCLUDE_FILES:
        return False
    norm = rel_path.replace("\\", "/")
    if any(norm.startswith(p) for p in EXCLUDE_PREFIXES):
        return False
    return True


def build_tarball():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            rel_dir = os.path.relpath(dirpath, ROOT)
            dirnames[:] = [d for d in dirnames if should_include(os.path.join(rel_dir, d))]
            for name in filenames:
                rel_path = os.path.join(rel_dir, name) if rel_dir != "." else name
                if should_include(rel_path):
                    tar.add(os.path.join(dirpath, name), arcname=rel_path)
    buf.seek(0)
    return buf


def main():
    env = read_env(ENV_FILE)
    host, user, password = env["ip"], env["user"], env["password"]

    print("Empacotando projeto...")
    tarball = build_tarball()
    size_mb = len(tarball.getvalue()) / (1024 * 1024)
    print(f"Tarball pronto: {size_mb:.1f} MB")

    print(f"Conectando em {host}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password)

    sftp = client.open_sftp()
    try:
        sftp.mkdir(REMOTE_DIR)
    except IOError:
        pass  # já existe

    remote_tarball = f"{REMOTE_DIR}/deploy.tar.gz"
    print(f"Enviando para {remote_tarball}...")
    sftp.putfo(tarball, remote_tarball)
    sftp.close()

    print("Extraindo na VPS...")
    stdin, stdout, stderr = client.exec_command(
        f"cd {REMOTE_DIR} && tar -xzf deploy.tar.gz && rm deploy.tar.gz && mkdir -p data/db"
    )
    exit_status = stdout.channel.recv_exit_status()
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print(err, file=sys.stderr)
    if exit_status != 0:
        print(f"Falha na extração (exit {exit_status})", file=sys.stderr)
        sys.exit(1)

    client.close()
    print("Deploy de arquivos concluído. Agora rode o build na VPS (ver DEPLOY.md).")


if __name__ == "__main__":
    main()
