// Auditoria (somente leitura): comandos LEGITIMOS que a trava nao pode
// bloquear. Roda com: node auditoria/probe-legit.js
// Cada linha "BLOQUEADO" aqui e um falso positivo da trava.
const mod = require("../agente/agent.js");

const CTX = { home: "/home/usuario", cwd: "/home/usuario" };

const LEGITIMOS = [
  "ls -la",
  "cat ~/Downloads/nota.txt",
  "echo oi > ~/notas.txt",
  "echo oi >> ~/notas.txt",
  "mkdir -p ~/projeto && cd ~/projeto && npm init -y",
  "cd ~/projeto",
  "cd",
  "cd ~",
  "git status",
  "git commit -m 'ajuste'",
  "npm install",
  "npm run build",
  "make -C ~/proj build",
  "python3 script.py",
  "python3 -m pip install requests",
  "node server.js",
  "tee ~/saida.txt",
  "truncate -s 0 ~/grande.log",
  "dd if=~/a.img of=~/b.img",
  "ln -s ~/bin/tool ~/bin/tool2",
  "tar -czf ~/backup.tar.gz ~/Documents",
  "for f in *.txt; do echo $f; done",
  "while read -r linha; do echo $linha; done < ~/lista.txt",
  "for f in ~/Documents/*; do cp $f ~/Backup/; done",
  "env FOO=bar node app.js",
  "sudo -n apt-get install -y jq",
  "grep -r TODO ~/projeto",
  "find ~/projeto -name '*.log' -exec grep -i erro {} ;",
  "du -sh ~/Downloads",
  "curl -s https://exemplo.com -o ~/pagina.html",
  "wget https://exemplo.com/file -P ~/Downloads",
  "rm ~/Downloads/velho.txt",
  "rm -rf ~/projeto/node_modules",
];

let bloqueados = 0;
for (const c of LEGITIMOS) {
  const r = mod.dangerCheck(c, CTX);
  if (r) {
    bloqueados++;
    console.log("BLOQUEADO (falso positivo) [" + r + "] " + c);
  }
}
console.log(
  bloqueados === 0
    ? "OK — nenhum comando legítimo bloqueado (" + LEGITIMOS.length + " casos)"
    : "ATENÇÃO — " + bloqueados + " falso(s) positivo(s) em " + LEGITIMOS.length + " casos"
);
process.exit(bloqueados === 0 ? 0 : 1);
