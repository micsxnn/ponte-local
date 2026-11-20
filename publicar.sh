#!/usr/bin/env bash
# Ponte Local — publica uma release completa: GitHub + npm, de uma vez só.
#
# Precisa de bash. Em ambientes sem /usr/bin/env (Android/Termux), rode
# assim:  bash publicar.sh <comando>
#
#   ./publicar.sh patch  "corrige o X"
#   ./publicar.sh minor  "adiciona a acao Y"
#   ./publicar.sh major  "muda tudo"
#   ./publicar.sh --version 1.20.2 "publica a versao que ja esta no package.json"
#   ./publicar.sh --dry-run
#
# FLAGS:
#   --version X.Y.Z   publica exatamente essa versao do agente (nao bumpea).
#                     O tag do repo continua seguindo a regra (minor -> minor).
#   --skip-npm        nao publica no npm (so GitHub).
#   --skip-github     nao cria a release no GitHub (so npm).
#   --notes ARQ       usa ARQ como corpo da release (em vez de RELEASE_NOTES.md).
#   --dry-run         mostra o que faria, sem escrever/publicar nada.
#   --yes             nao pergunta nada (modo nao-interativo).
#
# O QUE ELE FAZ, NA ORDEM (a ordem importa!):
#   1. checa repo limpo, branch main, node/npm/gh e credenciais
#   2. bumpeia a versao do AGENTE (package.json + agente/agent.js +
#      agente/teste-trava.cjs + README) e a versao da SKILL
#   3. GERA O MANIFESTO **POR ULTIMO** (v1.20.2) — o manifesto tem o hash
#      SHA-256 do agent.js e da skill: se for gerado antes do bump, o hash
#      fica velho e o auto-update dos usuarios passa a recusar a versao nova
#   4. roda a SUITE COMPLETA de testes (trava + legit + relay + manifesto)
#   5. commita, cria a tag e faz push
#   6. publica no npm (npm publish) — o npx passa a servir a versao nova
#   7. cria a release no GitHub com o corpo das release notes e anexa o
#      agente/agent.js
#
# REGRA DE VERSAO (a mesma do repo):
#   - versão do AGENTE = 1.x.y (é o que o ping() mostra e o que o npm
#                         distribui — o package.json version)
#   - versão do REPO   = v2.x.y (a tag e a release do GitHub)
#   - bump patch no agente -> patch no repo   (v2.10.0 -> v2.10.1)
#   - bump minor/major    -> minor do repo    (v2.9.0  -> v2.10.0)
#
# CORPO DA RELEASE: use RELEASE_NOTES.md da raiz (é local, fica no .gitignore)
# ou --notes ARQ. Sem nenhum dos dois, o script monta um corpo automático
# com os commits desde a última tag.
#
# CREDENCIAIS:
#   - npm:   ~/.npmrc (já configurado) OU a variavel NPM_TOKEN no ambiente.
#            Se a conta usa 2FA, exporte tambem NPM_OTP=123456.
#   - gh:    `gh auth login` uma vez, ou export GH_TOKEN=...
#
set -euo pipefail

cd "$(dirname "$0")"

NPM_PKG="${NPM_PKG:-ponte-local}"

# ------------------------------------------------------------------ helpers
erro() { echo ""; echo "[x] $*" >&2; echo ""; exit 1; }
ok()   { echo "  ✅ $*"; }
aviso(){ echo "  ⚠️  $*"; }
info() { echo ""; echo "  › $*"; }

# ------------------------------------------------------------------ args
TIPO=""
MSG=""
VER_EXPLICITA=""
SKIP_NPM=0
SKIP_GH=0
DRY=0
ASSUMIR_SIM=0
ARQ_NOTES_EXTERNO=""

while [ $# -gt 0 ]; do
  case "$1" in
    patch|minor|major) TIPO="$1"; shift ;;
    --version) VER_EXPLICITA="${2:-}"; shift 2 ;;
    --skip-npm) SKIP_NPM=1; shift ;;
    --skip-github) SKIP_GH=1; shift ;;
    --notes) ARQ_NOTES_EXTERNO="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --yes|-y) ASSUMIR_SIM=1; shift ;;
    -*) erro "Flag desconhecida: $1" ;;
    *)
      if [ -z "$MSG" ]; then MSG="$1"; else erro "Argumento extra: $1"; fi
      shift ;;
  esac
done

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  PONTE LOCAL — publicar release (GitHub + npm)       ║"
echo "╚═══════════════════════════════════════════════════════╝"

# ------------------------------------------------------------------ 0. checagens
if ! git diff --quiet || ! git diff --cached --quiet; then
  erro "O repo tem alterações não commitadas. Commit ou stash antes."
fi
[ -z "$(git status --porcelain)" ] || erro "Repo sujo (inclui arquivos nao rastreados — versione ou remova antes)."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || erro "Rode na branch main (você está em '$BRANCH')."

command -v node >/dev/null 2>&1 || erro "node não encontrado (Node 18+)."
command -v npm  >/dev/null 2>&1 || erro "npm não encontrado (instale: pacman -S npm)."
command -v gh   >/dev/null 2>&1 || erro "gh não encontrado (instale: pacman -S github-cli)."

GH_OK=0
if gh auth status >/dev/null 2>&1 || [ -n "${GH_TOKEN:-}" ]; then GH_OK=1; fi
[ "$GH_OK" = "1" ] || erro "Sem credencial do GitHub. Faça: gh auth login  (ou export GH_TOKEN=...)"

NPM_USER=""
if [ "$SKIP_NPM" = "0" ]; then
  NPM_USER="$(npm whoami 2>/dev/null || true)"
  if [ -z "$NPM_USER" ]; then
    erro "Sem credencial do npm.
     Opção 1 (recomendada): export NPM_TOKEN=seu_token   (token de automação do npmjs.com)
     Opção 2: npm login  (abre o navegador/pede o token)
     Ou rode com --skip-npm para publicar so no GitHub."
  fi
fi

ok "repo limpo, branch main"
[ "$SKIP_NPM" = "1" ] || ok "npm: $NPM_USER"
ok "gh: $(gh api user --jq .login 2>/dev/null || echo 'via GH_TOKEN')"

# ------------------------------------------------------------------ 1. perguntas
if [ -z "$VER_EXPLICITA" ] && [ -z "$TIPO" ]; then
  if [ -t 0 ] && [ "$ASSUMIR_SIM" = "0" ]; then
    echo ""
    echo "  Tipo de bump:"
    echo "    patch  = correção (1.20.2 -> 1.20.3) e tag v2.15.0 -> v2.15.1"
    echo "    minor  = funcionalidade nova (1.20.2 -> 1.21.0) e tag v2.15.0 -> v2.16.0"
    echo "    major  = quebra de compatibilidade"
    echo ""
    read -r -p "  tipo [minor]: " TIPO
    TIPO="${TIPO:-minor}"
  else
    erro "Fora de um terminal: diga o tipo. Ex.: ./publicar.sh minor \"mensagem\""
  fi
fi
if [ -n "$TIPO" ]; then
  case "$TIPO" in
    patch|minor|major) ;;
    *) erro "Tipo inválido: $TIPO (use patch, minor ou major)." ;;
  esac
fi

if [ -z "$MSG" ]; then
  if [ -t 0 ] && [ "$ASSUMIR_SIM" = "0" ]; then
    read -r -p "  Mensagem da release: " MSG
  else
    erro "Fora de um terminal: diga a mensagem. Ex.: ./publicar.sh $TIPO \"mensagem\""
  fi
fi
[ -n "$MSG" ] || erro "Mensagem vazia."

# ------------------------------------------------------------------ 2. versões
VER_AGENTE_ANT="$(node -p "require('./package.json').version")"
VER_REPO_ANT="$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "2.0.0")"

if [ -n "$VER_EXPLICITA" ]; then
  VER_AGENTE_NOV="$VER_EXPLICITA"
  # a regra do repo: patch no agente -> patch no repo; minor/major -> minor
  case "$TIPO" in
    patch) TIPO_EFF="patch" ;;
    major) TIPO_EFF="major" ;;
    *) TIPO_EFF="minor" ;;
  esac
  if [ -z "$TIPO" ]; then
    # sem tipo explicito: deduce do salto entre a versao atual e a pedida
    TIPO_EFF="$(node -e "
const a='$VER_AGENTE_ANT'.split('.').map(Number), b='$VER_AGENTE_NOV'.split('.').map(Number);
if(b[0]!==a[0]) console.log('major');
else if(b[1]!==a[1]) console.log('minor');
else if(b[2]!==a[2]) console.log('patch');
else console.log('patch');
")"
  fi
else
  TIPO_EFF="$TIPO"
  VER_AGENTE_NOV="$(node -e "
const [maj,min,pat]='$VER_AGENTE_ANT'.split('.').map(Number);
const tipo='$TIPO_EFF';
if(tipo==='major') console.log((maj+1)+'.0.0');
else if(tipo==='minor') console.log(maj+'.'+(min+1)+'.0');
else console.log(maj+'.'+min+'.'+(pat+1));
")"
fi

VER_REPO_NOV="$(node -e "
const [maj,min,pat]='$VER_REPO_ANT'.split('.').map(Number);
const tipo='$TIPO_EFF';
if(tipo==='major') console.log((maj+1)+'.0.0');
else if(tipo==='minor') console.log(maj+'.'+(min+1)+'.0');
else console.log(maj+'.'+min+'.'+(pat+1));
")"
TAG="v$VER_REPO_NOV"

# ---- versao da SKILL ------------------------------------------------------
# v1.18.0: a versao da SKILL so mudava se alguem editasse o marcador. O
# agente (e o npx update) so re-baixam quando a versao AUMENTA — entao uma
# correcao na SKILL.md nunca chegava aos usuarios.
# v1.20.2: a comparacao e feita com a ULTIMA TAG (nao com HEAD): o que
# importa e o que mudou DEPOIS da ultima release publicada.
VER_SKILL_ATUAL="$(grep -m1 -oE 'skill-version:[[:space:]]*[0-9]+\.[0-9]+\.[0-9]+' SKILL.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo '0.0.0')"
VER_SKILL_NOV="$VER_SKILL_ATUAL"
TAG_ANT="$(git describe --tags --abbrev=0 2>/dev/null || true)"
SKILL_MUDOU=1
if [ -n "$TAG_ANT" ]; then
  if git diff --quiet "$TAG_ANT" -- SKILL.md agente/SKILL.md agente/LEIA-ME.md 2>/dev/null; then
    SKILL_MUDOU=0
  fi
else
  SKILL_MUDOU=1
fi
if [ "$SKILL_MUDOU" = "1" ]; then
  VER_SKILL_NOV="$(node -e "const [a,b,c]='$VER_SKILL_ATUAL'.split('.').map(Number);console.log(a+'.'+b+'.'+(c+1))")"
fi

info "agente: $VER_AGENTE_ANT -> $VER_AGENTE_NOV"
info "repo:   $VER_REPO_ANT -> $TAG"
info "skill:  $VER_SKILL_ATUAL -> $VER_SKILL_NOV"

if [ "$DRY" = "1" ]; then
  echo ""
  aviso "DRY RUN — nada será escrito, commitado, publicado ou enviado."
  echo ""
  echo "  O que faria:"
  echo "    1. package.json          version -> $VER_AGENTE_NOV"
  echo "    2. agente/agent.js       VERSION  -> $VER_AGENTE_NOV"
  echo "    3. agente/teste-trava.cjs          -> $VER_AGENTE_NOV"
  echo "    4. README.md             badge    -> v$VER_AGENTE_NOV"
  echo "    5. SKILL.md              skill-version -> $VER_SKILL_NOV (se mudou desde a tag)"
  echo "    6. skill-manifest.json   GERADO POR ULTIMO (com os hashes sha256)"
  echo "    7. suite: trava + legit + relay + manifesto"
  echo "    8. git commit + tag $TAG + push (main e tag)"
  echo "    9. npm publish ($NPM_PKG@$VER_AGENTE_NOV)"
  echo "   10. gh release create $TAG (com agente/agent.js anexado)"
  echo ""
  exit 0
fi

# ------------------------------------------------------------------ 3. bump
ARQUIVOS_MEXIDOS="package.json agente/agent.js agente/teste-trava.cjs README.md SKILL.md skill-manifest.json"
restaurar() {
  git checkout -- $ARQUIVOS_MEXIDOS 2>/dev/null || true
  git reset -q 2>/dev/null || true
}

node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.version='$VER_AGENTE_NOV';
fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');
"
ok "package.json -> $VER_AGENTE_NOV"

node -e "
const fs=require('fs');
const f='agente/agent.js';
let s=fs.readFileSync(f,'utf8');
s=s.replace(/const VERSION = \"[^\"]+\";/, 'const VERSION = \"$VER_AGENTE_NOV\";');
s=s.replace(/Ponte Local — Agente v[0-9.]+ /, 'Ponte Local — Agente v$VER_AGENTE_NOV ');
fs.writeFileSync(f,s);
"
ok "agente/agent.js -> v$VER_AGENTE_NOV"

node -e "
const fs=require('fs');
const f='agente/teste-trava.cjs';
let s=fs.readFileSync(f,'utf8');
s=s.replace(/TDD, v[0-9.]+/, 'TDD, v$VER_AGENTE_NOV');
s=s.replace(/VERSION !== \"[^\"]+\"/, 'VERSION !== \"$VER_AGENTE_NOV\"');
s=s.replace(/VERSION deveria ser [0-9.]+/, 'VERSION deveria ser $VER_AGENTE_NOV');
fs.writeFileSync(f,s);
"
ok "agente/teste-trava.cjs -> v$VER_AGENTE_NOV"

node -e "
const fs=require('fs');
const f='README.md';
let s=fs.readFileSync(f,'utf8');
s=s.replace(/agente-v[0-9.]+-3fb950/, 'agente-v$VER_AGENTE_NOV-3fb950');
s=s.replace(/Nova versao do agente: v[0-9.]+/, 'Nova versao do agente: v$VER_AGENTE_NOV');
fs.writeFileSync(f,s);
"
ok "README.md -> v$VER_AGENTE_NOV"

if [ "$VER_SKILL_NOV" != "$VER_SKILL_ATUAL" ]; then
  sed -i "s/skill-version:[[:space:]]*[0-9]\.[0-9]\.[0-9]\+/skill-version: $VER_SKILL_NOV/" SKILL.md
  ok "SKILL.md -> skill-version $VER_SKILL_NOV"
fi

# ------------------------------------------------------------------ 4. manifesto (POR ULTIMO)
# v1.20.2: o manifesto carrega o sha256 do agent.js e da skill. Ele PRECISA
# ser gerado depois do bump — antes, o hash seria o da versao antiga e o
# auto-update dos usuarios recusaria a versao nova ("hash nao confere").
node scripts/gerar-manifesto.js
ok "skill-manifest.json gerado (com hashes sha256)"

# auto-check: o hash do agent.js no manifesto tem que bater com o arquivo
if ! node -e "
const fs=require('fs'),crypto=require('crypto');
const m=JSON.parse(fs.readFileSync('skill-manifest.json','utf8'));
const item=(m.arquivos||[]).find(i=>i.destino==='agent.js'||i.origem==='agente/agent.js');
if(!item||!item.sha256){console.error('manifesto sem o hash do agent.js');process.exit(1);}
const h=crypto.createHash('sha256').update(fs.readFileSync('agente/agent.js','utf8')).digest('hex');
if(h!==item.sha256){console.error('hash do agent.js no manifesto esta VELHO');process.exit(1);}
for(const i of (m.arquivos||[])){
  if(!i.sha256||!i.origem) continue;
  if(i.destino==='agent.js') continue;
  const p=i.origem;
  if(!fs.existsSync(p)){console.error('arquivo do manifesto sumiu: '+p);process.exit(1);}
  const hh=crypto.createHash('sha256').update(fs.readFileSync(p,'utf8')).digest('hex');
  if(hh!==i.sha256){console.error('hash velho no manifesto: '+p);process.exit(1);}
}
"; then
  restaurar
  erro "O manifesto nao bate com os arquivos do repo — nada foi publicado."
fi
ok "integridade do manifesto conferida (hashes batem)"

# ------------------------------------------------------------------ 5. suite de testes
echo ""
info "rodando a suite de testes..."
rodar_testes() {
  echo "  · trava + lixeira"
  node agente/teste-trava.cjs
  echo "  · comandos legitimos (regressao da trava)"
  node auditoria/probe-legit.js
  echo "  · relay (lanes, auth, permissoes)"
  node --experimental-strip-types auditoria/teste-relay.mjs
  echo "  · manifesto (hashes)"
  node auditoria/teste-manifesto.mjs >/dev/null && echo "  ✅ manifesto ok"
}
if ! rodar_testes; then
  restaurar
  erro "Os testes falharam — nada foi publicado (o bump foi desfeito)."
fi

# ------------------------------------------------------------------ 6. commit + tag + push
git add -A
git commit -m "$MSG"
ok "commit: $(git log --oneline -1)"

git tag -a "$TAG" -m "$TAG — $MSG"

if ! git push origin main; then
  erro "O push da branch falhou. O commit e a tag JÁ estão locais:
     commit : $(git log --oneline -1)
     tag    : $TAG
  Depois de resolver (conflito, rede, auth), mande:
     git push origin main && git push origin $TAG
  e siga na mão a partir dai."
fi
if ! git push origin "$TAG"; then
  erro "A tag $TAG não foi enviada. Mande: git push origin $TAG"
fi
ok "tag $TAG enviada"

# ------------------------------------------------------------------ 7. npm publish
if [ "$SKIP_NPM" = "0" ]; then
  echo ""
  info "publicando no npm..."
  NPM_ARGS="publish --access public"
  if [ -n "${NPM_OTP:-}" ]; then NPM_ARGS="$NPM_ARGS --otp=$NPM_OTP"; fi
  if npm $NPM_ARGS; then
    ok "npm: $NPM_PKG@$VER_AGENTE_NOV publicado"
    # confere se a versao apareceu (o registry demora alguns minutos)
    sleep 3
    if npm view "$NPM_PKG" versions --json 2>/dev/null | grep -q "$VER_AGENTE_NOV"; then
      ok "npm: versao $VER_AGENTE_NOV visivel no registry"
    else
      aviso "A versao ainda nao aparece no registry (propaga em ~5-20 min)."
      aviso "Confira depois: npm view $NPM_PKG versions dist-tags --json"
    fi
  else
    aviso "npm publish FALHOU — o commit e a tag já foram enviados (git está em dia)."
    aviso "Se foi 'Cannot publish over previously staged version', a versao $VER_AGENTE_NOV"
    aviso "ficou no staged area: ela se promove sozinha em ~20 min. Confira depois:"
    aviso "  npm view $NPM_PKG versions dist-tags --json"
    aviso "Para republicar, bump a versao de novo (patch) e rode o script outra vez."
    exit 1
  fi
else
  aviso "npm pulado (--skip-npm)"
fi

# ------------------------------------------------------------------ 8. release no GitHub
if [ "$SKIP_GH" = "0" ]; then
  echo ""
  info "criando a release no GitHub..."

  ARQ_NOTES="$(mktemp)"
  RESUMO="$MSG"
  RESUMO_E_COMPLETO=0

  ARQ_NOTES_FINAL=""
  if [ -n "$ARQ_NOTES_EXTERNO" ]; then
    [ -f "$ARQ_NOTES_EXTERNO" ] || erro "Arquivo de notas não encontrado: $ARQ_NOTES_EXTERNO"
    ARQ_NOTES_FINAL="$ARQ_NOTES_EXTERNO"
    info "corpo: $ARQ_NOTES_EXTERNO"
  elif [ -f RELEASE_NOTES.md ]; then
    ARQ_NOTES_FINAL="RELEASE_NOTES.md"
    info "corpo: RELEASE_NOTES.md (local, não vai pro repo)"
  fi

  if [ -n "$ARQ_NOTES_FINAL" ]; then
    cp "$ARQ_NOTES_FINAL" "$ARQ_NOTES"
    PRIMEIRA="$(head -n 1 "$ARQ_NOTES_FINAL" | sed 's/^#*[[:space:]]*//' | cut -c1-120)"
    [ -n "$PRIMEIRA" ] && RESUMO="$PRIMEIRA"
    case "$PRIMEIRA" in
      Agente\ *|agente\ *) RESUMO_E_COMPLETO=1 ;;
      *) RESUMO_E_COMPLETO=0 ;;
    esac
  else
    {
      echo "$RESUMO"
      echo ""
      echo "## Mudanças"
      echo ""
      if [ -n "$TAG_ANT" ]; then
        git log --pretty=format:'- %s' "$TAG_ANT..$TAG" | sed 's/^/- /'
      else
        git log --pretty=format:'- %s' -5 | sed 's/^/- /'
      fi
      echo ""
      echo ""
      echo "## Como atualizar"
      echo ""
      echo "1. **Com \`npx\`**: nada a fazer — o \`npx\` já resolve a versão mais nova."
      echo "   Para fixar: \`npx $NPM_PKG@$VER_AGENTE_NOV\`."
      echo "2. **Instalação manual**: baixe \`agente/agent.js\` desta release, substitua o"
      echo "   \`agent.js\` na pasta do agente (\`~/ponte-agent\` no Linux,"
      echo "   \`%USERPROFILE%\\ponte-agent\` no Windows) e religue no modo escolhido."
      echo ""
      echo "A SKILL.md se atualiza sozinha no agente (boot + a cada 60 s, com ETag/304)."
      echo "O manifesto traz o hash SHA-256 de cada arquivo — a atualização verifica"
      echo "a integridade antes de trocar qualquer coisa."
    } > "$ARQ_NOTES"
    info "corpo: automático (commits desde a última tag)"
  fi

  if [ -f RELEASE_NOTES.md ] && [ -z "$ARQ_NOTES_EXTERNO" ]; then
    aviso "RELEASE_NOTES.md é local (está no .gitignore) — some depois da release."
  fi

  # shellcheck disable=SC2064
  trap "rm -f '$ARQ_NOTES'" EXIT

  if [ "${RESUMO_E_COMPLETO:-0}" = "1" ]; then
    TITULO="$TAG — $RESUMO"
  else
    TITULO="$TAG — agente v$VER_AGENTE_NOV: $RESUMO"
  fi
  gh release create "$TAG" \
    --title "$TITULO" \
    --notes-file "$ARQ_NOTES" \
    agente/agent.js

  ok "release: $(gh release view "$TAG" --json url --jq .url)"
else
  aviso "GitHub pulado (--skip-github)"
fi

echo ""
echo "════════ PRONTO ════════"
echo ""
echo "  tag      : $TAG"
echo "  agente   : v$VER_AGENTE_NOV"
echo "  skill    : v$VER_SKILL_NOV"
[ "$SKIP_NPM" = "1" ] || echo "  npm      : $NPM_PKG@$VER_AGENTE_NOV (propaga em ~5-20 min)"
[ "$SKIP_GH" = "1" ] || echo "  release  : $(gh release view "$TAG" --json url --jq .url 2>/dev/null || echo '(pulada)')"
echo ""
echo "  O npx passa a servir a versao nova sozinho — ninguem precisa"
echo "  reinstalar nada."
echo ""
