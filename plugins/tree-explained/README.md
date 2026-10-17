# tree-explained

## English

A side pane for Claude Code: the files Claude touched in this session as a tree, and below it a scrollable summary of what each turn changed.

- Tree: only files the session touched (by Edit, Write, Read or Bash). Edited or written files in orange with `+N -N` line counters; files that were only read, dim purple. The file of the call running now shimmers. Folders first, paths relative to the session folder. Capped at 300 files (the oldest-touched go).
- Summary: after each turn that edited or wrote a file, one short summary (a headline and 2 to 5 bullets). If the model cannot answer, you get one `path +N -N` line per file instead. The last 20 are kept.
- Folders open and close: press the folder row (or use the keys below). They start closed; every Edit or Write opens the folders above its file again, even ones you closed; a Read opens nothing. A closed folder shows `(3 edits, 2 reads)` and the summed `+N -N`.
- Files outside the session folder (for example under `/tmp` or a plugin cache) are gathered in one closed row, `(outside project)`, with the file count; opened, it lists them as `parent/file`. An Edit outside the project reopens that row.
- The pane follows the latest edit: the edited row is scrolled into view. Scrolling by hand stops that (a `f` follow key appears); `f` or your next prompt resumes it.
- Header keys (while the pane has the keyboard): `c` fold all folders, `e` unfold all, `r` hide or show files that were only read, `t` collapse or expand the files section, `s` the summary section (a collapsed section shows its title and count). `f` follow, only after you scrolled. Esc still closes the pane. The section and read filters are remembered between sessions.
- Bash changes are followed too (a heredoc, `sed -i`, a redirect, a script, `git apply`): after each Bash call that is not read-only, the mod asks the local git which files differ from the last commit and lists those modified since the previous check as edits, with the Bash call itself never delayed. For these files `+N -N` is the total difference from the last commit, not a per-call count. A deleted file is an edit row with `-N`; a new untracked file counts its lines (text under 4 MiB). A turn with such changes is summarized like any edit turn. A Bash command running in the background is checked when the turn ends.
- The tree and the summaries start over on `/clear`.
- Off by default. The choice is remembered between sessions.

Install:

```
/plugin install tree-explained@malka-claude-mods
```

Use:

- `/tree-explained` turns the pane on or off. Esc closes it (and keeps it off); `↑↓` scroll it while it has the keyboard.
- Summary language: the language of your first non-slash prompt of the session; English if there was none yet. `/tree-explained lang Portuguese` sets one (free text, up to 40 characters, remembered between sessions); `/tree-explained lang auto` goes back to following your first prompt.
- With the optional `menu` mod, `/mods tree-explained` opens a page with the switch and the current language.

Where it shows: the pane docks on the right only in the fullscreen layout (`/tui fullscreen`) with a terminal of at least 110 columns. Otherwise it sits inline above the prompt. That is an engine limit. A pane the mod opens by itself at session start may stay hidden below 144 columns; `/tree-explained` always shows it.

Privacy: to write each summary the mod sends the diffs of the files changed in that turn (the `old` and `new` text of each Edit, the content of each Write, and for files changed by Bash the diff against the last commit, or the content of a new file), plus up to 300 characters of your first prompt, to the model through the session's own client (`haiku`, a small alias). The 6000-character cap applies to the file content in that request, not to its headers: the request also carries file paths, line counts and the names of secret-named files (never their content). The text of the Bash command is never sent. The mod reads no environment variables of its own and writes no files.

Secret names: a file whose name looks like a secret is listed by name only. The rule is name based and judged on the absolute path, so a repository inside `~/.aws`, `~/.ssh`, `~/.kube` or `~/.gnupg` sends no content. Examples: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `credentials*`, `*.tfstate`, `.npmrc`, anything under `.ssh/`. Such a file is never read and its path is never given to a git command that derives content (`diff`). Secrets with ordinary names are not recognised.

Bash changes: after a Bash call that is not read-only the mod runs read-only local git commands (`rev-parse`, `config`, `status`, `diff`; no shell, no writes to the repository). Git 2.45 or newer is required; with an older git the tracking is paused for the session, with a notice. What the commands turn off: the repository's fsmonitor, external-diff, text-conversion, pager and hook programs; submodule inspection; lazy fetching of missing objects; all git transports (`-c protocol.allow=never`). Attribute processing is not fully off (`$GIT_DIR/info/attributes` still applies): the protection against attribute-driven filters is that every filter driver the repository defines is replaced by `cat` (git runs `cat` for it), together with `--no-textconv` and `--no-ext-diff`. A repository with a filter driver whose name is unusual, or with more than 200 filter drivers, is not inspected: the tracking pauses instead of running git. Untracked symbolic links and other non-regular files are listed by name only; a file is checked again right before its content is read, but that check is not atomic, so a swap right after it is still possible. The git commands inherit your environment, so `GIT_*` variables you have set apply to them.

Accepted risks: Windows is not supported (use WSL). A repository you do not trust can still ship other git configuration that git honours, and a folder whose `.git` points to another location is followed: use the tracking only in repositories you would run git in anyway.

Known limits:

- `Read`, `Edit`, `Write` and what `Bash` changes are followed; `MultiEdit` and `NotebookEdit` are not.
- Bash changes are not tracked when: the folder is not a git repository, or the file is outside the repository; the file is ignored by git; the command ends with a clean tree (a commit, a checkout); the change is inside a submodule (submodules are not inspected); a subagent works in a separate git worktree. Detection compares file modification times with the previous check, so a file Bash rewrites with the same content still shows if git sees it as different from the last commit, and an Edit followed by a Bash change to the same file in one turn mixes the two counters. After three failed git calls in a row the tracking pauses for the session, with one notice. A sweep looks at most 2000 dirty files; the rest are ignored until they are fewer.
- A `Write` counts all its lines as `+N`, even over an existing file.
- The session folder is read again on every file call, so a `cd` is followed. Whether the engine honors every header key letter in a real terminal is unconfirmed outside the test kit.
- Repeated edits of one file count as one file. Per turn the summary gets the content of the first 100 files (within the 6000 character cap) and only the names of the rest; past 1000 files in one turn the extra ones are counted ("K more files not listed"), not named.
- A summary is asked once per turn, after it ends; it appears a few seconds later.
- If the `haiku` alias is not allowed in your setup, you get the file lines only.

Uninstall: `/plugin uninstall tree-explained@malka-claude-mods`.

## Português

Um painel lateral para o Claude Code: os arquivos que o Claude tocou na sessão em forma de árvore e, abaixo, um resumo rolável do que cada turno mudou.

- Árvore: só arquivos que a sessão tocou. Editados ou escritos em laranja, com contadores `+N -N`; os apenas lidos, em roxo esmaecido. O arquivo da chamada em andamento brilha. Pastas primeiro, caminhos relativos à pasta da sessão. Limite de 300 arquivos (saem os tocados há mais tempo).
- Resumo: após cada turno que editou ou escreveu arquivo, um resumo curto (título e 2 a 5 itens). Se o modelo não responder, aparece uma linha `caminho +N -N` por arquivo. Os últimos 20 ficam.
- Pastas abrem e fecham: aperte a linha da pasta (ou use as teclas abaixo). Nascem fechadas; todo Edit ou Write reabre as pastas acima do arquivo, mesmo as que você fechou; um Read não abre nada. Pasta fechada mostra `(3 edits, 2 reads)` e o `+N -N` somado.
- Arquivos fora da pasta da sessão (por exemplo em `/tmp` ou no cache de plugins) ficam juntos numa linha fechada, `(outside project)`, com a contagem; aberta, lista como `pasta/arquivo`. Um Edit fora do projeto reabre essa linha.
- O painel acompanha a última edição: a linha editada é rolada para a vista. Rolar à mão para o acompanhamento (aparece a tecla `f`); `f` ou o próximo prompt retoma.
- Teclas do cabeçalho (com o painel com o teclado): `c` recolhe todas as pastas, `e` expande todas, `r` oculta ou mostra arquivos só lidos, `t` recolhe ou expande a seção de arquivos, `s` a do resumo (seção recolhida mostra título e contagem). `f` acompanhar, só depois de rolar à mão. Esc continua fechando o painel. As seções e o filtro de leitura são lembrados entre sessões.
- Mudanças por Bash também são acompanhadas (heredoc, `sed -i`, redirecionamento, script, `git apply`): após cada chamada de Bash que não seja só leitura, o mod pergunta ao git local quais arquivos diferem do último commit e lista como edições os modificados desde a verificação anterior; a chamada de Bash nunca é atrasada. Nesses arquivos `+N -N` é a diferença total contra o último commit, não a contagem de uma chamada. Arquivo apagado vira linha de edição com `-N`; arquivo novo não rastreado conta suas linhas (texto até 4 MiB). Um turno com essas mudanças é resumido como qualquer turno de edição. Um Bash em segundo plano é verificado quando o turno termina.
- A árvore e os resumos recomeçam no `/clear`.
- Nasce desligado. A escolha é lembrada entre sessões.

Instalar:

```
/plugin install tree-explained@malka-claude-mods
```

Usar:

- `/tree-explained` liga ou desliga o painel. Esc fecha (e mantém desligado); `↑↓` rolam enquanto ele tem o teclado.
- Idioma do resumo: o do seu primeiro prompt da sessão que não seja comando; inglês se ainda não houve. `/tree-explained lang Português` fixa um (texto livre, até 40 caracteres, lembrado entre sessões); `/tree-explained lang auto` volta a seguir o primeiro prompt.
- Com o mod opcional `menu`, `/mods tree-explained` abre uma página com a chave liga/desliga e o idioma atual.

Onde aparece: o painel só docka à direita no layout fullscreen (`/tui fullscreen`) com terminal de pelo menos 110 colunas. Fora disso fica inline, acima do prompt. É um limite do engine. Um painel aberto pelo próprio mod ao iniciar a sessão pode ficar oculto abaixo de 144 colunas; `/tree-explained` sempre o mostra.

Privacidade: para escrever cada resumo o mod envia os diffs dos arquivos alterados naquele turno (o texto `old` e `new` de cada Edit, o conteúdo de cada Write e, para arquivos mudados por Bash, o diff contra o último commit ou o conteúdo de um arquivo novo), mais até 300 caracteres do seu primeiro prompt, ao modelo pelo cliente da própria sessão (`haiku`, um alias pequeno). O limite de 6000 caracteres vale para o conteúdo dos arquivos nessa requisição, não para os cabeçalhos: a requisição também leva caminhos, contagens de linhas e os nomes dos arquivos com nome de segredo (nunca o conteúdo). O texto do comando Bash nunca é enviado. O mod não lê variáveis de ambiente próprias e não grava arquivos.

Nomes de segredo: um arquivo cujo nome parece segredo aparece só pelo nome. A regra é por nome e vale para o caminho absoluto, então um repositório dentro de `~/.aws`, `~/.ssh`, `~/.kube` ou `~/.gnupg` não envia conteúdo. Exemplos: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `credentials*`, `*.tfstate`, `.npmrc`, qualquer coisa sob `.ssh/`. Esse arquivo nunca é lido e o caminho dele nunca é passado a um comando git que deriva conteúdo (`diff`). Segredos com nomes comuns não são reconhecidos.

Mudanças por Bash: depois de uma chamada de Bash que não seja só leitura o mod roda comandos git locais somente de leitura (`rev-parse`, `config`, `status`, `diff`; sem shell, sem gravar no repositório). Exige git 2.45 ou mais novo; com um git mais antigo o rastreamento fica pausado na sessão, com um aviso. O que os comandos desligam: os programas fsmonitor, diff externo, conversão de texto, pager e hooks do repositório; a inspeção de submódulos; a busca preguiçosa de objetos ausentes; todos os transportes do git (`-c protocol.allow=never`). O processamento de atributos não fica totalmente desligado (`$GIT_DIR/info/attributes` ainda vale): a proteção contra filtros ligados a atributos é que todo driver de filtro definido pelo repositório é trocado por `cat` (o git roda `cat` no lugar), junto com `--no-textconv` e `--no-ext-diff`. Um repositório com driver de filtro de nome incomum, ou com mais de 200 drivers de filtro, não é inspecionado: o rastreamento pausa em vez de rodar o git. Links simbólicos não rastreados e outros arquivos não regulares aparecem só pelo nome; o arquivo é verificado de novo logo antes de ler o conteúdo, mas essa verificação não é atômica, então uma troca logo depois ainda é possível. Os comandos git herdam o seu ambiente, então variáveis `GIT_*` que você definiu valem para eles.

Riscos aceitos: Windows não é suportado (use o WSL). Um repositório em que você não confia ainda pode trazer outra configuração do git que o git respeita, e uma pasta cujo `.git` aponta para outro lugar é seguida: use o rastreamento só em repositórios em que você rodaria o git de qualquer jeito.

Limites conhecidos:

- `Read`, `Edit`, `Write` e o que o `Bash` muda são acompanhados; `MultiEdit` e `NotebookEdit` não.
- Mudanças por Bash não são rastreadas quando: a pasta não é um repositório git, ou o arquivo está fora do repositório; o arquivo é ignorado pelo git; o comando termina com a árvore limpa (um commit, um checkout); a mudança está dentro de um submódulo (submódulos não são inspecionados); um subagente trabalha num git worktree separado. A detecção compara horários de modificação com a verificação anterior, e um Edit seguido de uma mudança por Bash no mesmo arquivo no mesmo turno mistura os dois contadores. Após três chamadas de git seguidas com falha o rastreamento pausa até o fim da sessão, com um aviso. Cada varredura olha no máximo 2000 arquivos sujos; os demais são ignorados até que sejam menos.
- Um `Write` conta todas as linhas como `+N`, mesmo sobre um arquivo existente.
- A pasta da sessão é relida a cada chamada de arquivo, então um `cd` é acompanhado. Se o engine aceita todas as letras do cabeçalho num terminal real não foi confirmado fora do kit de testes.
- Edições repetidas de um arquivo contam como um arquivo. Por turno o resumo recebe o conteúdo dos 100 primeiros arquivos (dentro do limite de 6000 caracteres) e só os nomes dos demais; acima de 1000 arquivos num turno os excedentes são contados ("K more files not listed"), não nomeados.
- O resumo é pedido uma vez por turno, depois que ele termina; aparece alguns segundos depois.
- Se o alias `haiku` não for permitido no seu ambiente, você recebe só as linhas por arquivo.

Desinstalar: `/plugin uninstall tree-explained@malka-claude-mods`.
