<!-- referência da skill ponte-local. A spec de entrada é ../SKILL.md. -->

### 4.5 Sudo sem expor senha (Linux, só com autorização explícita)

*(No Windows não há sudo: `run_command` roda com os privilégios do usuário do
terminal.)*

1. `write_text` → `/home/u/Downloads/.tmp-senha` com `content: "SENHA\n"`
   (a senha viaja no corpo do comando, **nunca** dentro de um shell que vira log)
2. `run_command` → `sudo -S bash -c 'COMANDO_REAL' < /home/u/Downloads/.tmp-senha`
3. `run_command` → `rm -f /home/u/Downloads/.tmp-senha` (rm real via shell — a
   ação `delete` iria para a lixeira e a senha ficaria recuperável!)

NOPASSWD permanente só com pedido explícito do usuário, sempre validando:

```bash
sudo -S bash -c 'echo "usuario ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/90-nopasswd \
  && chmod 440 /etc/sudoers.d/90-nopasswd \
  && (visudo -c >/dev/null 2>&1 && echo OK || rm -f /etc/sudoers.d/90-nopasswd)' < .tmp-senha
```
