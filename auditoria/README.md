# Auditoria da trava anticatástrofe

Sondas **somente leitura** que exercitam a função pura `dangerCheck` do agente
([agente/agent.js](../agente/agent.js)) com uma bateria de comandos perigosos.
Nada é executado no sistema: as sondas só chamam a análise e imprimem
`BLOQUEADO`/`PERMITIDO` por comando.

```bash
node auditoria/probe-trava.js        # vetores classicos + leitura de arquivos internos
node auditoria/probe-indirecao.js    # indirecao de comando, loops, escrita em arquivo de sistema
```

- [probe-trava.js](probe-trava.js) — vetores já cobertos pela trava, formas de
  ler a config/log do agente (token) e os casos que passam.
- [probe-indirecao.js](probe-indirecao.js) — alias/variável de comando
  (`busybox rm`, `r=rm; $r`), loops de shell (`for`/`while`), `awk system()`,
  escrita em arquivo de sistema (`> /etc/passwd`, `tee`, `truncate`, `install`)
  e escape do escopo via `cd`.

Cada linha `PERMITIDO` é um furo: em modo autônomo/modo deus o comando roda
**sem confirmação humana**. Ao corrigir a trava, acrescente o vetor ao
[agente/teste-trava.cjs](../agente/teste-trava.cjs) antes de mexer no
`dangerCheck`.
