Este arquivo é um MODELO. Copie para RELEASE_NOTES.md (na raiz do repo),
escreva as release notes como quiser, e rode:

    ./publicar.sh minor "sua mensagem"

O script usa o RELEASE_NOTES.md como o CORPO da release no GitHub e a
PRIMEIRA LINHA dele como o resumo do título. O RELEASE_NOTES.md é local
(está no .gitignore) — não vai para o repo.

Sem RELEASE_NOTES.md, o script monta um corpo automático com os commits
desde a última tag.

--------------------------------------------------------------------------------
MODELO (as release notes de verdade começam na primeira linha, sem título
markdown — a primeira linha vira o resumo do título da release)
--------------------------------------------------------------------------------

Agente 1.15.0 — uma frase que resume a release em linguagem de gente.

## O que mudou

- **Ação nova**: `mouse_click` clica em (x, y) com botão esquerdo, direito
  ou meio — simples ou duplo
- **Correção**: o scroll do Windows passava o botão no lugar do delta
- **Documentação**: a skill agora ensina o usuário a instalar a ferramenta
  de captura por distro

## Como fica na prática

```json
{"action":"mouse_click","args":{"x":1200,"y":800,"button":"left"}}
```

## Como atualizar

1. **Com `npx`**: nada a fazer — o `npx` já resolve a versão mais nova.
   Para fixar: `npx ponte-local@1.15.0`.
2. **Instalação manual**: baixe `agente/agent.js` desta release, substitua o
   `agent.js` na pasta do agente (`~/ponte-agent` no Linux,
   `%USERPROFILE%\ponte-agent` no Windows) e religue no modo escolhido.

A SKILL.md se atualiza sozinha no agente (boot + a cada 60 s, com ETag/304).
