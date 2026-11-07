#!/usr/bin/env bash
#
# Ponte Local — publica uma release completa, de uma vez só.
#
#   ./publicar.sh patch  "corrige o X"
#   ./publicar.sh minor  "adiciona a acao Y"
#   ./publicar.sh major  "muda tudo"
#   ./publicar.sh                (pergunta o tipo e a mensagem)
#   ./publicar.sh --dry-run      (mostra o que faria, sem publicar nada)
#
# O que ele faz, na ordem:
#   1. checa se o repo está limpo, na branch main, e se node/npm/gh estão aqui
#   2. bumpeia a versão do AGENTE (package.json + agente/agent.js +
#      agente/teste-trava.cjs) e a versão do REPO (tag vX.Y.Z)
#   3. roda os testes (node agente/teste-trava.cjs)
#   4. commita, cria a tag e faz push
#   5. publica no npm (npm publish) — o npx passa a servir a versao nova
#   6. cria a release no GitHub com o corpo no modelo das anteriores e
#      anexa o agente/agent.js
#
# REGRA DE VERSAO (a mesma do repo):
#   - versão do AGENTE  = 1.x.y  (é o que o ping() mostra e o que o npm
#                          distribui — o package.json version)
#   - versão do REPO    = v2.x.y (a tag e a release do GitHub)
#   - bump patch no agente  -> patch no repo   (v2.10.0 -> v2.10.1)
#   - bump minor/major      -> minor  no repo   (v2.9.0  -> v2.10.0)
#
# CORPO DA RELEASE: use o RELEASE_NOTES.md da raiz se existir (você escreve
# as release notes como quiser). Se não existir, o script monta um corpo
# automático com os commits desde a última tag.
#
# CREDENCIAIS:
#   - npm:   o ~/.npmrc (já configurado) — sem token, o script avisa
#   - gh:    `gh auth login` uma vez, ou export GH_TOKEN=... no terminal
#
set -euo pipefail

cd "$(dirname "$0")"

# ------------------------------------------------------------------ helpers
erro() { echo ""; echo "[x] $*" >&2; echo ""; exit 1; }
ok()   { echo "  ✅ $*"; }
info() { echo "  → $*"; }
aviso(){ echo "  ⚠️  $*"; }

# ------------------------------------------------------------------ args
DRY=0
TIPO=""
MSG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|--dryrun|-n) DRY=1 ;;
    patch|minor|major) TIPO="$arg" ;;
    *) MSG="$arg" ;;
  esac
done

# ------------------------------------------------------------------ checagens
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  PONTE LOCAL — publicar release                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

if ! git diff --quiet || ! git diff --cached --quiet; then
  erro "O repo tem alterações não commitadas. Commit ou stash antes."
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || erro "Repo sujo."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || erro "Rode na branch main (você está em '$BRANCH')."

command -v node >/dev/null 2>&1 || erro "node não encontrado (Node 18+)."
command -v npm  >/dev/null 2>&1 || erro "npm não encontrado (instale: pacman -S npm)."
command -v gh   >/dev/null 2>&1 || erro "gh não encontrado (instale: pacman -S github-cli)."

NPM_USER="$(npm whoami 2>/dev/null || true)"
[ -n "$NPM_USER" ] || erro "Sem credencial do npm. Faça: npm login  (ou ponha o token no ~/.npmrc)"
GH_OK=0
if gh auth status >/dev/null 2>&1 || [ -n "${GH_TOKEN:-}" ]; then GH_OK=1; fi
[ "$GH_OK" = "1" ] || erro "Sem credencial do GitHub. Faça: gh auth login  (ou export GH_TOKEN=...)"

ok "repo limpo, branch main"
ok "npm: $NPM_USER"
ok "gh: $(gh api user --jq .login 2>/dev/null || echo 'via GH_TOKEN')"

# ------------------------------------------------------------------ pergunta
if [ -z "$TIPO" ]; then
  if [ -t 0 ]; then
    echo ""
    echo "  Tipo de bump:"
    echo "    patch  = correção (1.14.0 -> 1.14.1) e tag v2.10.0 -> v2.10.1"
    echo "    minor  = funcionalidade nova (1.14.0 -> 1.15.0) e tag v2.10.0 -> v2.10.1"
    echo "    major  = quebra de compatibilidade"
    echo ""
    read -r -p "  tipo [minor]: " TIPO
    TIPO="${TIPO:-minor}"
  else
    erro "Fora de um terminal: diga o tipo. Ex.: ./publicar.sh minor \"mensagem\""
  fi
fi
case "$TIPO" in
  patch|minor|major) ;;
  *) erro "Tipo inválido: $TIPO (use patch, minor ou major)." ;;
esac

if [ -z "$MSG" ]; then
  if [ -t 0 ]; then
    read -r -p "  Mensagem da release: " MSG
  else
    erro "Fora de um terminal: diga a mensagem. Ex.: ./publicar.sh $TIPO \"mensagem\""
  fi
fi
[ -n "$MSG" ] || erro "Mensagem vazia."

# ------------------------------------------------------------------ versões
VER_AGENTE_ANT="$(node -p "require('./package.json').version")"
VER_REPO_ANT="$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "2.0.0")"

# versão do agente: 1.x.y
VER_AGENTE_NOV="$(node -e "
const [maj,min,pat]='$VER_AGENTE_ANT'.split('.').map(Number);
const tipo='$TIPO';
if(tipo==='major') console.log((maj+1)+'.0.0');
else if(tipo==='minor') console.log(maj+'.'+(min+1)+'.0');
else console.log(maj+'.'+min+'.'+(pat+1));
")"

# versão do repo: patch do agente -> patch do repo; minor/major -> minor do repo
VER_REPO_NOV="$(node -e "
const [maj,min,pat]='$VER_REPO_ANT'.split('.').map(Number);
const tipo='$TIPO';
if(tipo==='major') console.log((maj+1)+'.0.0');
else if(tipo==='minor') console.log(maj+'.'+(min+1)+'.0');
else console.log(maj+'.'+min+'.'+(pat+1));
")"
TAG="v$VER_REPO_NOV"

info "agente: $VER_AGENTE_ANT -> $VER_AGENTE_NOV"
info "repo:   $VER_REPO_ANT -> $TAG"

if [ "$DRY" = "1" ]; then
  echo ""
  aviso "DRY RUN — nada será escrito, commitado, publicado ou enviado."
  echo ""
  echo "  O que faria:"
  echo "    1. package.json          version -> $VER_AGENTE_NOV"
  echo "    2. agente/agent.js       VERSION  -> $VER_AGENTE_NOV"
  echo "    3. agente/teste-trava.cjs          -> $VER_AGENTE_NOV"
  echo "    4. node agente/teste-trava.cjs"
  echo "    5. git commit -m \"$MSG\" + tag $TAG + push"
  echo "    6. npm publish"
  echo "    7. gh release create $TAG (com agente/agent.js anexado)"
  echo ""
  exit 0
fi

# ------------------------------------------------------------------ 1. bump
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.version='$VER_AGENTE_NOV';
fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');
"
ok "package.json -> $VER_AGENTE_NOV"

# agente/agent.js: a constante VERSION
node -e "
const fs=require('fs');
const f='agente/agent.js';
let s=fs.readFileSync(f,'utf8');
const antes=s;
s=s.replace(/const VERSION = \"[^\"]+\";/, 'const VERSION = \"$VER_AGENTE_NOV\";');
s=s.replace(/Ponte Local — Agente v[0-9.]+ /, 'Ponte Local — Agente v$VER_AGENTE_NOV ');
if(s===antes){ console.error('AVISO: nao achei a linha VERSION no agent.js'); process.exit(1); }
fs.writeFileSync(f,s);
"
ok "agente/agent.js -> v$VER_AGENTE_NOV"

# agente/teste-trava.cjs: a versao esperada no teste
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

# README: o badge da versao do agente
node -e "
const fs=require('fs');
const f='README.md';
let s=fs.readFileSync(f,'utf8');
s=s.replace(/agente-v[0-9.]+-3fb950/, 'agente-v$VER_AGENTE_NOV-3fb950');
fs.writeFileSync(f,s);
" 2>/dev/null || true

# ------------------------------------------------------------------ 2. testes
echo ""
info "rodando os testes..."
node agente/teste-trava.cjs || erro "Os testes falharam — nada foi publicado."

# ------------------------------------------------------------------ 3. commit + tag + push
git add -A
git commit -m "$MSG"
ok "commit: $(git log --oneline -1)"

git tag -a "$TAG" -m "$TAG — $MSG"
git push origin main
git push origin "$TAG"
ok "tag $TAG enviada"

# ------------------------------------------------------------------ 4. npm publish
echo ""
info "publicando no npm..."
if npm publish --access public; then
  ok "npm: ponte-local@$VER_AGENTE_NOV publicado"
else
  aviso "npm publish FALHOU — o commit e a tag já foram enviados (git está em dia)."
  aviso "Se foi 'Cannot publish over previously staged version', a versao $VER_AGENTE_NOV"
  aviso "ficou no staged area: ela se promove sozinha em ~20 min. Confira depois:"
  aviso "  npm view ponte-local versions dist-tags --json"
  aviso "Para republicar, bump a versao de novo (patch) e rode o script outra vez."
  exit 1
fi

# ------------------------------------------------------------------ 5. release
echo ""
info "criando a release no GitHub..."

TITULO="$TAG — agente v$VER_AGENTE_NOV: $MSG"
ARQ_NOTES="$(mktemp)"

if [ -f RELEASE_NOTES.md ]; then
  cp RELEASE_NOTES.md "$ARQ_NOTES"
  info "corpo: RELEASE_NOTES.md"
else
  {
    echo "$MSG"
    echo ""
    echo "## O que mudou"
    echo ""
    TAG_ANT="$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo "")"
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
    echo "   Para fixar: \`npx ponte-local@$VER_AGENTE_NOV\`."
    echo "2. **Instalação manual**: baixe \`agente/agent.js\` desta release, substitua o"
    echo "   \`agent.js\` na pasta do agente (\`~/ponte-agent\` no Linux,"
    echo "   \`%USERPROFILE%\\ponte-agent\` no Windows) e religue no modo escolhido."
    echo ""
    echo "A SKILL.md se atualiza sozinha no agente (boot + a cada 60 s, com ETag/304)."
  } > "$ARQ_NOTES"
  info "corpo: automático (commits desde a última tag)"
fi

# shellcheck disable=SC2064
trap "rm -f '$ARQ_NOTES'" EXIT

gh release create "$TAG" \
  --title "$TITULO" \
  --notes-file "$ARQ_NOTES" \
  agente/agent.js

ok "release: $(gh release view "$TAG" --json url --jq .url)"

echo ""
echo "════════ PRONTO ════════"
echo ""
echo "  tag      : $TAG"
echo "  agente   : v$VER_AGENTE_NOV"
echo "  npm      : ponte-local@$VER_AGENTE_NOV (propaga em ~5-20 min)"
echo "  release  : $(gh release view "$TAG" --json url --jq .url)"
echo ""
echo "  O npx passa a servir a versao nova sozinho — ninguem precisa"
echo "  reinstalar nada."
echo ""
