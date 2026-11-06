# Política de segurança — ponte-local

## Versões suportadas

O projeto é um único ramo (`main`): use sempre a versão mais recente.
O agente (`agente/agent.js`) se auto-atualiza baixando a `SKILL.md` do repo;
o binário do agente em si é atualizado com `agente/atualizar.sh` ou
baixando o `agent.js` novo. Correções de segurança saem sempre na `main`.

| Versão | Suportada |
| ------ | --------- |
| `main` (última) | ✅ |
| Tags/commits antigos | ❌ |

## Como reportar

- **Vulnerabilidade de segurança**: abra um **GitHub Security Advisory**
  ("Report a vulnerability" na aba Security do repo) ou entre em contato
  pelo perfil do autor. **Não abra issue pública** com detalhes
  exploráveis.
- Resposta esperada: reconhecimento em até **7 dias**, correção ou plano
  de correção em até **30 dias** para problemas de alto impacto.

## Escopo

Valem relatos sobre os três componentes:

- `agente/agent.js` — o agente que roda no PC do usuário (travas, escopo,
  lixeira, manipulação de comandos do relay);
- `relay/` — fila, autenticação por token, painel;
- `operador/ponte.py` — CLI que injeta comandos.

Fora de escopo: ataques que exijam acesso físico à máquina do usuário,
roubo do token *já* em posse do atacante com acesso à home, e relatórios
gerados por varreduras automáticas sem evidência explorável.

## Notas de design (por que algumas coisas são assim)

- **Tokens nunca no código**: agente e operador usam tokens distintos
  fornecidos por variável de ambiente/flag; uma lane por máquina.
- **Somente conexões de saída**: o agente não escuta porta nenhuma; a
  superfície de ataque de rede é a do poll HTTPS do próprio relay.
- **Escopo travado na home** e pastas sensíveis bloqueadas no agente
  (`.ssh`, `.gnupg`, `.config`, `.password-store`, `.aws`, `.kube`,
  `ponte-agent`).
- **`run_command` nunca é o padrão**: exige flag digitado no terminal do
  dono (`--allow-run`/`--auto`) ou aceite explícito no chat para o modo de
  confirmação reduzida, com registro de recusa.
- **Trava anticatástrofe local**: o agente recusa destruição em massa
  (mkfs, dd para dispositivo, rm -r de sistema, format, diskpart etc.)
  antes de executar, independentemente do modo.
