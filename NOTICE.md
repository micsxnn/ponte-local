# Avisos de terceiros (third-party notices)

O `ponte-local` não empacota código de terceiros: o que você baixa deste
repositório é autoral (`agent.js`, `ponte-store.ts`, rotas do relay,
`ponte.py`, painel, docs). As licenças abaixo se aplicam às **dependências
externas opcionais** que cada componente usa em tempo de execução, quando
você escolhe usá-las.

## Relay (servidor Next.js)

O relay é construído sobre o esqueleto do `create-next-app` (Next.js +
React + TypeScript). Dependências típicas e suas licenças:

| Projeto | Uso | Licença |
| ------- | --- | ------- |
| [Next.js](https://github.com/vercel/next.js) | framework do relay e do painel | MIT |
| [React / React DOM](https://github.com/facebook/react) | painel de status | MIT |
| [lucide-react](https://github.com/lucide-icons/lucide) | ícones do painel (dependência npm declarada) | ISC |
| [TypeScript](https://github.com/microsoft/TypeScript) | tipagem em tempo de desenvolvimento | Apache-2.0 |

## Agente (`agente/agent.js`)

**Zero dependências.** O arquivo roda apenas com a API padrão do Node.js.

| Projeto | Uso | Licença |
| ------- | --- | ------- |
| [Node.js](https://github.com/nodejs/node) | runtime | MIT (com uso de libs de terceiros listadas em `LICENSE` do Node) |

## Operador (`operador/ponte.py`)

**Zero dependências além da biblioteca padrão.**

| Projeto | Uso | Licença |
| ------- | --- | ------- |
| [Python](https://github.com/python/cpython) | runtime da CLI | PSF License |

## Como gerar a lista completa do relay

Como o relay vive no *seu* servidor (você o cria com `create-next-app`),
a lista exata de dependências é a do seu `package.json`. Para auditoria:

```bash
cd ponte-relay
npx license-checker --summary
```

Este arquivo segue o espírito do aviso de terceiros da seção 4.4 da
licença MIT (retenção de aviso de copyright e permissão em
redistribuições): os avisos acima são retidos para cada projeto citado.
