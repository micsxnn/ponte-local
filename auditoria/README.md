# Auditoria da trava anticatástrofe

Sondas **somente leitura** que exercitam a função pura `dangerCheck` do agente
([agente/agent.js](../agente/agent.js)) com uma bateria de comandos perigosos.
Nada é executado no sistema: as sondas só chamam a análise e imprimem
`BLOQUEADO`/`PERMITIDO` por comando.

```bash
node auditoria/probe-trava.js        # vetores classicos + leitura de arquivos internos
node auditoria/probe-indirecao.js    # indirecao de comando, loops, escrita em arquivo de sistema
node auditoria/probe-legit.js        # comandos legitimos que a trava NAO pode bloquear
```

- [probe-trava.js](probe-trava.js) — vetores já cobertos pela trava, formas de
  ler a config/log do agente (token) e os casos que passam.
- [probe-indirecao.js](probe-indirecao.js) — alias/variável de comando
  (`busybox rm`, `r=rm; $r`), loops de shell (`for`/`while`), `awk system()`,
  escrita em arquivo de sistema (`> /etc/passwd`, `tee`, `truncate`, `install`)
  e escape do escopo via `cd`.
- [probe-legit.js](probe-legit.js) — **regressão**: 33 comandos do dia a dia
  (`npm install`, `git commit`, `make`, `tee ~/saida.txt`, `for f in *.txt…`)
  que precisam continuar passando. Linha `BLOQUEADO` aqui = falso positivo.

Cada linha `PERMITIDO` na auditoria de vetores é um furo: em modo
autônomo/modo deus o comando roda **sem confirmação humana**. Ao corrigir a
trava, acrescente o vetor ao
[agente/teste-trava.cjs](../agente/teste-trava.cjs) antes de mexer no
`dangerCheck`.

Estado atual (v1.20.1): os vetores da auditoria estão todos `BLOQUEADO` e os
33 comandos legítimos do `probe-legit.js` passam.
