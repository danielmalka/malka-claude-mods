# malka-claude-mods — decisões vigentes

## tree-explained (decidido pelo dono em 2026-10-17)

- Mod de painel lateral: árvore de arquivos em que o Claude trabalha + resumo rolável das principais alterações. Referência visual: https://github.com/data-goblin/claude-code-filetree/raw/main/media/filetree-shimmer.gif (painel docado à direita, pastas expandidas, cor por operação — leitura roxa, escrita laranja —, contadores `+N`/`-N`, arquivo em uso "brilha"). Não copiar código do filetree; só o visual.
- Árvore: sessão inteira; arquivos editados/escritos em destaque, apenas lidos esmaecidos, o do turno atual marcado; zera no `/clear`. Fonte: `tool.call` (campos planos no evento: `e.file_path`, `e.old_string`, `e.new_string`, `e.content`).
- Resumo: híbrido. Árvore e contadores de linhas determinísticos e ao vivo; o texto do resumo vem de `$.model.complete` uma vez no fim de cada turno.
- Idioma do resumo: o do primeiro prompt da sessão; trocável com `/tree-explained lang <idioma>`.
- Liga/desliga: comando `/tree-explained`; nasce desligado; a escolha é lembrada entre sessões (`$.store`).
- O Pane só docka à direita em fullscreen com 110+ colunas; fora disso fica inline acima do prompt (limite do engine, documentar no README).
- Entra no mod `menu` já na primeira entrega (5º membro, hotkey 5, `/mods tree-explained`), seguindo o contrato `menuEntry` apiVersion 1.

## tree-explained v0.2 (decidido pelo dono em 2026-10-17, após o 1º uso real)

- Pastas da árvore abrem e fecham (clique no botão da pasta). Todas começam fechadas; a cada edição, as pastas ancestrais do arquivo editado reabrem (mesmo que a pessoa as tenha fechado); leitura não abre pasta. Pasta fechada mostra a contagem (`3 edits, 2 reads`) e o `+N -N` somado.
- Atalhos de uma letra nos botões do cabeçalho: `c` recolher tudo, `e` expandir tudo, `r` ocultar/mostrar arquivos só lidos, `t` recolher a seção da árvore, `s` recolher a seção do resumo. Sem navegação linha a linha (`j/k/h/l`) por enquanto.
- Arquivos fora do projeto: uma única linha recolhida `(outside project) N files`, nunca cadeias `/home/...`.
- O resumo continua SÓ para turnos com edição (Edit/Write); não resumir turnos de investigação. Subagentes só entram pelas edições que fizeram.
- O estado de seção recolhida persiste entre sessões (`$.store`).
- A árvore acompanha a atividade mais recente (`$.ui.scroll`), parando enquanto a pessoa rola à mão.
- Subir a versão do plugin a cada mudança: o cache de instalação é chaveado pela versão (lição do menu 0.1.0 → 0.1.1).

## statusline 0.2.0 (decidido pelo dono em 2026-10-17)

- A barra da statusline tem faixa própria `AbovePrompt`, isolada da linha do rótulo de modo do engine (`bypass permissions on` fica onde está); nenhuma informação é cortada em tela estreita: os segmentos (ctx, 5h, 7d, cache, modelo·pasta·branch) são atômicos e quebram para a linha de baixo. As barras de progresso só caem se duas linhas não bastarem; números, resets e cabeçalho nunca.
- O `[-]` do engine pode recolher a faixa (aceito). Nossa linha própria `⎿ pill · /tasks to manage` foi abandonada (o engine mantém a dele).
- Todo hook `AbovePrompt` deve chamar `next(e)` uma única vez e compor com o que está abaixo (padrão do decision-router/resume/cleanscreen).

## tree-explained: edições por Bash (decidido pelo dono em 2026-10-17)

- O mod deve rastrear também mudanças de arquivo feitas por Bash (sed -i, heredoc, redirecionamento, scripts, git apply, etc.), não só Edit/Write. Motivo: agentes (builders) costumam editar por Bash e o painel ficava vazio.
- O desenho (como detectar, contadores `+N -N`, o que entra no resumo, limites de custo e segredos) ainda será decidido em plano antes de implementar.
