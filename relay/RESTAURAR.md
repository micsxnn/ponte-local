# Restaurar o relay da ponte (depois de um reset da VM)

A VM reseta e perde o projeto Next.js inteiro. Este guia reconstrói **só a parte da ponte** em ~5 minutos.

## 1. Criar o projeto Next.js

```bash
npx create-next-app@latest ponte-relay --typescript --app --no-eslint --no-tailwind --no-src-dir --import-alias "@/*"
cd ponte-relay
```

> Se a plataforma de preview exigir Tailwind/shadcn (como o projeto original), pode criar com eles — a ponte não depende disso.

## 2. Copiar os arquivos deste repositório

Do clone deste repo (`git clone https://github.com/micsxnn/ponte-local`):

| Arquivo do repo                          | Destino no projeto Next.js                      |
|------------------------------------------|--------------------------------------------------|
| `relay/ponte-store.ts`                   | `src/lib/ponte-store.ts` (criar a pasta `lib`)   |
| `relay/api/poll/route.ts`                | `src/app/api/ponte/poll/route.ts`                |
| `relay/api/result/route.ts`              | `src/app/api/ponte/result/route.ts`              |
| `relay/api/cmd/route.ts`                 | `src/app/api/ponte/cmd/route.ts`                 |
| `relay/api/results/route.ts`             | `src/app/api/ponte/results/route.ts`             |
| `relay/api/status/route.ts`              | `src/app/api/ponte/status/route.ts`              |
| `relay/api/download/route.ts`            | `src/app/api/ponte/download/route.ts`            |
| `relay/painel/page.tsx`                  | `src/app/page.tsx` (painel mínimo de status)     |
| `agente/agent.js`                        | `download/ponte-agent/agent.js` (a rota `/api/ponte/download` serve esse caminho) |

Se o projeto usa `src/` desativado, ajuste os caminhos (`app/`, `lib/`) — o `ponte-store.ts` é importado pelas routes como `@/lib/ponte-store`.

## 3. Rodar

```bash
npm install
npm run dev        # porta 3000
```

A URL pública de preview muda a cada rebuild. Confira o link atual na
plataforma que hospeda o relay e valide com `curl http://127.0.0.1:3000/api/ponte/status`.

## 4. Reconectar o agente

Se o PC do usuário continua com `~/ponte-agent/ponte.config.json` do relay antigo, o agente vai tentar o link antigo e falhar. Opções:

```bash
# opção A: apontar para o novo link
node ~/ponte-agent/agent.js --server https://NOVO-LINK --token SEU_TOKEN --save

# opção B: reinstalar via curl do novo relay (ou do raw deste repo — ver README)
```

## 5. Tokens e lanes

Todos via variáveis de ambiente (nada versionado, nada hardcoded no código).
Uma **lane por máquina**: o token do agente determina a fila dele — comando
de uma máquina nunca atravessa para a outra.

```bash
# no .env do projeto (Next lê sozinho) ou exportado antes do npm run dev:
PONTE_TOKEN_NETBOOK=$(openssl rand -hex 12)   # agente da máquina 1 (entregue no chat privado)
PONTE_TOKEN_WINDOWS=$(openssl rand -hex 16)   # agente da máquina 2 (entregue no chat privado)
PONTE_TOKEN_TEST=$(openssl rand -hex 12)      # opcional — agentes de teste na VM
PONTE_ADMIN_TOKEN=$(openssl rand -hex 16)     # operador/IA (nunca sai da VM)
```

- Aliases aceitos: `PONTE_AGENT_TOKEN` (= netbook) e `PONTE_TEST_TOKEN` (= test).
- O operador lê `PONTE_ADMIN_TOKEN` (e `PONTE_URL` se não for `http://127.0.0.1:3000`).
- No PC, cada agente recebe o token DA SUA máquina na instalação
  (`--token ... --save`, fica em `~/ponte-agent/ponte.config.json`).
- `POST /cmd` recebe `"lane":"netbook"|"windows"|"test"`; sem lane o relay
  1.3.x usa "netbook" (transição do token único) e depois passa a exigir.
- `/status` mostra uma entrada por lane (conectado, specs, pendências).

Trocou um token? Atualize o relay e religue o agente com `--token NOVO --save`.

Estado da fila/resultados vive em `globalThis` (`__ponteState2`) e, desde o
relay **v1.2.0**, persiste em `.ponte-estado.json` na raiz do projeto:
pendentes (<24h), últimos 400 resultados, specs/lastSeen **por lane** (desde
v1.3.0; snapshots v1 antigos migram sozinhos na carga) — sobrevivem a restart
do Next (edição de arquivo, rebuild, queda do processo).
O arquivo é runtime — não versionar (já está no `.gitignore` do repo). O
histórico completo continua no PC (`~/ponte-agent/ponte-log.jsonl`). O
reconnect do agente (poll sem cursor) entrega os pendentes <24h da lane dele;
o que passa disso é descartado.
