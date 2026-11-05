#!/usr/bin/env python3
"""
teste-pegar-mock.py — prova o `pegar` do ponte.py contra um RELAY DE MENTIRA.

O relay falso (http.server, porta efêmera) simula o par relay+agente com o
formato REAL que o ponte.py consome:
  POST /api/ponte/cmd             → {"ok":true,"id":<sequencial>,"lane":"test"}
  GET  /api/ponte/results?since=X → {"ok":true,"results":[...],"lastId":N}
com resultado de read_binary no mesmo formato do agente (agent.js):
  {"id","ok","data":{"path","bytes"(TAMANHO TOTAL),"tipo","offset","lidos",
                     "temMais","proximoOffset"(null no fim),"base64"}}

Arquivo falso de 9 MB (conteúdo determinístico, md5 conhecido) servido em 2
pedaços: pedaço 1 (~4 MB, como o padrão do agente) com proximoOffset>0 e o
pedaço 2 (resto) SEM proximoOffset (fim). Só um `pegar` que SEGUE o
proximoOffset reconstrói o arquivo inteiro — o antigo salvava só o pedaço 1
e imprimia o tamanho TOTAL (truncamento mascarado).

Uso:
  python3 teste-pegar-mock.py [caminho-para-ponte.py]   # padrão: ./ponte.py
  MOCK_FALHA_PEDACO=1 python3 teste-pegar-mock.py       # pedaço 2 falha:
      o pegar deve ABORTAR com mensagem clara (código 2, arquivo parcial)

Verificação: saida.bin deve ter 9 MB e o md5 deve bater com o arquivo-fonte.
"""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TAM_ARQ = 9_000_000  # tamanho TOTAL do arquivo falso "no PC remoto"
PEDACO = 4_000_000   # pedaço 1 (~4 MB, padrão do agente p/ arquivos grandes)
LANE = "test"
TOKEN = "adm"
TETO_PEDACOS = 200   # igual ao teto de segurança do pegar corrigido


def dados_deterministicos(n, seed=b"ponte-mock-pegar"):
    """n bytes pseudoaleatórios REPRODUZÍVEIS (sha256 em cadeia) — md5 estável."""
    out = bytearray()
    bloco = 0
    while len(out) < n:
        out.extend(hashlib.sha256(seed + bloco.to_bytes(4, "big")).digest())
        bloco += 1
    return bytes(out[:n])


DADOS = dados_deterministicos(TAM_ARQ)
MD5_ESPERADO = hashlib.md5(DADOS).hexdigest()
MD5_PEDACO1 = hashlib.md5(DADOS[:PEDACO]).hexdigest()  # sintoma clássico do RED

_seq = 0            # id sequencial dos comandos (como o relay faz)
_lock = threading.Lock()
_comandos = {}      # id → corpo do comando {"lane","action","args"}
_resultados = []    # resultados "postados pelo agente", na ordem


def resultado_read_binary(cid, cmd):
    """Simula a execução de read_binary no agente — formato REAL do resultado."""
    args = cmd.get("args") or {}
    offset = max(0, int(args.get("offset") or 0))
    if offset > 0 and offset < TAM_ARQ and os.environ.get("MOCK_FALHA_PEDACO") == "1":
        return {"id": cid, "ok": False, "lane": LANE, "ts": 0, "durationMs": 4,
                "error": "Falha simulada no pedaço 2 (MOCK_FALHA_PEDACO=1)"}
    if offset <= 0:
        pedaco = DADOS[0:min(PEDACO, TAM_ARQ)]  # pedaço 1
    else:
        pedaco = DADOS[offset:TAM_ARQ]          # pedaço 2: resto, sem teto
    lidos = len(pedaco)
    tem_mais = offset + lidos < TAM_ARQ
    return {
        "id": cid, "ok": True, "lane": LANE, "ts": 0, "durationMs": 7,
        "data": {
            "path": args.get("path") or "/remoto/fake.bin",
            "bytes": TAM_ARQ,  # tamanho TOTAL — o campo que MASCARAVA o truncamento
            "tipo": "bin",
            "offset": offset,
            "lidos": lidos,
            "temMais": tem_mais,
            "proximoOffset": (offset + lidos) if tem_mais else None,
            "base64": base64.b64encode(pedaco).decode(),
        },
    }


class RelayDeMentira(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        corpo = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _autoriza(self):
        if self.headers.get("x-ponte-admin") != TOKEN:
            self._json(401, {"ok": False, "error": "Não autorizado"})
            return False
        return True

    def do_POST(self):
        if not self._autoriza():
            return
        if urlparse(self.path).path != "/api/ponte/cmd":
            self._json(404, {"ok": False, "error": "rota desconhecida"})
            return
        tam = int(self.headers.get("content-length") or 0)
        corpo = json.loads(self.rfile.read(tam) or b"{}")
        global _seq
        with _lock:
            _seq += 1
            cid = _seq
            _comandos[cid] = corpo
        self._json(200, {"ok": True, "id": cid, "lane": corpo.get("lane", LANE)})

    def do_GET(self):
        if not self._autoriza():
            return
        u = urlparse(self.path)
        if u.path != "/api/ponte/results":
            self._json(404, {"ok": False, "error": "rota desconhecida"})
            return
        since = int(parse_qs(u.query).get("since", ["0"])[0] or 0)
        # --- "agente" simulado: executa os comandos pendentes e posta os resultados
        with _lock:
            for cid, cmd in _comandos.items():
                if cmd.get("_respondido"):
                    continue
                cmd["_respondido"] = True
                _resultados.append(resultado_read_binary(cid, cmd))
            pend = [r for r in _resultados if r["id"] > since]
            last = pend[-1]["id"] if pend else since
        self._json(200, {"ok": True, "results": pend, "lastId": last, "lane": LANE})

    def log_message(self, *a):  # silencia o log padrão do http.server
        pass


def main():
    pasta = os.path.dirname(os.path.abspath(__file__))
    ponte_py = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(pasta, "ponte.py"))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), RelayDeMentira)
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    tmp = tempfile.mkdtemp(prefix="ponte-pegar-mock-")
    env = dict(os.environ)
    env.update({
        "PONTE_URL": f"http://127.0.0.1:{porta}",
        "PONTE_LANE": LANE,
        "PONTE_ADMIN_TOKEN": TOKEN,
        "PONTE_STATE_DIR": tmp,  # baseline .ponte_since_test dentro do tmp — não suja o repo
    })
    fonte = os.path.join(tmp, "fonte-remota-fake.bin")  # o "arquivo" que está no PC remoto
    with open(fonte, "wb") as f:
        f.write(DADOS)
    saida = os.path.join(tmp, "saida.bin")

    modo_falha = os.environ.get("MOCK_FALHA_PEDACO") == "1"
    print(f"== teste-pegar-mock: relay de mentira em http://127.0.0.1:{porta}")
    print(f"== arquivo remoto falso: {TAM_ARQ} bytes em 2 pedaços ({PEDACO} + resto)")
    print(f"== md5 esperado (arquivo inteiro): {MD5_ESPERADO}")
    print(f"== md5 do pedaço 1 (sintoma do truncamento): {MD5_PEDACO1}")
    print(f"== comando: PONTE_URL=http://127.0.0.1:{porta} PONTE_LANE={LANE} "
          f"PONTE_ADMIN_TOKEN={TOKEN} python3 {ponte_py} pegar /remoto/fake.bin {saida}")
    if modo_falha:
        print("== MOCK_FALHA_PEDACO=1 → pedaço 2 volta ok:false — o pegar deve abortar com mensagem clara")

    try:
        p = subprocess.run(
            [sys.executable, ponte_py, "pegar", "/remoto/fake.bin", saida],
            env=env, capture_output=True, text=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        print("FALHA: ponte.py travou (timeout de 300 s)")
        srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
        return 1

    print("-- saída do ponte.py (stdout):")
    print((p.stdout.rstrip() or "(vazio)"))
    if p.stderr.strip():
        print("-- stderr do ponte.py:")
        print(p.stderr.rstrip())

    falhas = []
    if modo_falha:
        # modo extra: o pegar deve ABORTAR (código 2) com mensagem clara de pedaço
        if p.returncode != 2:
            falhas.append(f"código de saída {p.returncode} (esperado 2 — erro do agente no pedaço)")
        txt = (p.stdout + p.stderr).lower()
        if "erro" not in txt or "pedaço" not in txt:
            falhas.append('mensagem de aborta clara ausente (esperado "ERRO ... pedaço ...")')
    else:
        if p.returncode != 0:
            falhas.append(f"ponte.py saiu com código {p.returncode} (esperado 0)")
        if not os.path.exists(saida):
            falhas.append("saida.bin não foi criado")
        else:
            with open(saida, "rb") as f:
                got = f.read()
            md5 = hashlib.md5(got).hexdigest()
            print(f"-- resultado local: {len(got)} bytes, md5 {md5}")
            if len(got) != TAM_ARQ:
                falhas.append(f"TAMANHO ERRADO: {len(got)} (esperado {TAM_ARQ}) — arquivo TRUNCADO?")
            if md5 != MD5_ESPERADO:
                falhas.append(f"MD5 ERRADO: {md5} (esperado {MD5_ESPERADO})")
                if md5 == MD5_PEDACO1:
                    falhas.append("→ o md5 é exatamente o do PEDACO 1: o pegar NÃO seguiu o proximoOffset (truncou no 1º pedaço)")

    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    if falhas:
        print("FALHOU:")
        for x in falhas:
            print("  - " + x)
        return 1
    print("PASSOU" + (" (abortou com erro claro, como esperado)" if modo_falha else f" — {TAM_ARQ} bytes, md5 bate"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
