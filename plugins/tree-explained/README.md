# tree-explained

## English

A side pane for Claude Code: the files Claude touched in this session as a tree, and below it a scrollable summary of what each turn changed.

- Tree: only files the session touched. Edited or written files in orange with `+N -N` line counters; files that were only read, dim purple. The file of the call running now shimmers. Folders first, paths relative to the session folder. Capped at 300 files (the oldest-touched go).
- Summary: after each turn that edited or wrote a file, one short summary (a headline and 2 to 5 bullets). If the model cannot answer, you get one `path +N -N` line per file instead. The last 20 are kept.
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

Privacy: to write each summary the mod sends the diffs of the files changed in that turn (the `old` and `new` text of each Edit, the content of each Write), capped at 6000 characters per turn, plus up to 300 characters of your first prompt, to the model through the session's own client (`haiku`, a small alias). Nothing else leaves your machine; the mod reads no environment variables and writes no files. Files whose name looks like a secret (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`) are listed but their content is never sent. The text is sent as data with an instruction not to follow anything inside it.

Known limits:

- Only `Read`, `Edit` and `Write` are followed; changes made by `Bash`, `MultiEdit` or `NotebookEdit` do not show.
- A `Write` counts all its lines as `+N`, even over an existing file.
- A path outside the session folder is shown absolute.
- Repeated edits of one file count as one file. Per turn the summary gets the content of the first 100 files (within the 6000 character cap) and only the names of the rest; past 1000 files in one turn the extra ones are counted ("K more files not listed"), not named.
- A summary is asked once per turn, after it ends; it appears a few seconds later.
- If the `haiku` alias is not allowed in your setup, you get the file lines only.

Uninstall: `/plugin uninstall tree-explained@malka-claude-mods`.

## Português

Um painel lateral para o Claude Code: os arquivos que o Claude tocou na sessão em forma de árvore e, abaixo, um resumo rolável do que cada turno mudou.

- Árvore: só arquivos que a sessão tocou. Editados ou escritos em laranja, com contadores `+N -N`; os apenas lidos, em roxo esmaecido. O arquivo da chamada em andamento brilha. Pastas primeiro, caminhos relativos à pasta da sessão. Limite de 300 arquivos (saem os tocados há mais tempo).
- Resumo: após cada turno que editou ou escreveu arquivo, um resumo curto (título e 2 a 5 itens). Se o modelo não responder, aparece uma linha `caminho +N -N` por arquivo. Os últimos 20 ficam.
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

Privacidade: para escrever cada resumo o mod envia os diffs dos arquivos alterados naquele turno (o texto `old` e `new` de cada Edit, o conteúdo de cada Write), limitados a 6000 caracteres por turno, mais até 300 caracteres do seu primeiro prompt, ao modelo pelo cliente da própria sessão (`haiku`, um alias pequeno). Nada mais sai da sua máquina; o mod não lê variáveis de ambiente nem grava arquivos. Arquivos cujo nome parece segredo (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`) aparecem na lista, mas o conteúdo nunca é enviado. O texto vai como dado, com a instrução de não seguir nada que esteja dentro dele.

Limites conhecidos:

- Só `Read`, `Edit` e `Write` são acompanhados; mudanças feitas por `Bash`, `MultiEdit` ou `NotebookEdit` não aparecem.
- Um `Write` conta todas as linhas como `+N`, mesmo sobre um arquivo existente.
- Um caminho fora da pasta da sessão aparece absoluto.
- Edições repetidas de um arquivo contam como um arquivo. Por turno o resumo recebe o conteúdo dos 100 primeiros arquivos (dentro do limite de 6000 caracteres) e só os nomes dos demais; acima de 1000 arquivos num turno os excedentes são contados ("K more files not listed"), não nomeados.
- O resumo é pedido uma vez por turno, depois que ele termina; aparece alguns segundos depois.
- Se o alias `haiku` não for permitido no seu ambiente, você recebe só as linhas por arquivo.

Desinstalar: `/plugin uninstall tree-explained@malka-claude-mods`.
