# malka-claude-mods — decisões vigentes

## tree-explained (decidido pelo dono em 2026-10-17)

- Mod de painel lateral: árvore de arquivos em que o Claude trabalha + resumo rolável das principais alterações. Referência visual: https://github.com/data-goblin/claude-code-filetree/raw/main/media/filetree-shimmer.gif (painel docado à direita, pastas expandidas, cor por operação — leitura roxa, escrita laranja —, contadores `+N`/`-N`, arquivo em uso "brilha"). Não copiar código do filetree; só o visual.
- Árvore: sessão inteira; arquivos editados/escritos em destaque, apenas lidos esmaecidos, o do turno atual marcado; zera no `/clear`. Fonte: `tool.call` (campos planos no evento: `e.file_path`, `e.old_string`, `e.new_string`, `e.content`).
- Resumo: híbrido. Árvore e contadores de linhas determinísticos e ao vivo; o texto do resumo vem de `$.model.complete` uma vez no fim de cada turno.
- Idioma do resumo: o do primeiro prompt da sessão; trocável com `/tree-explained lang <idioma>`.
- Liga/desliga: comando `/tree-explained`; nasce desligado; a escolha é lembrada entre sessões (`$.store`).
- O Pane só docka à direita em fullscreen com 110+ colunas; fora disso fica inline acima do prompt (limite do engine, documentar no README).
- Entra no mod `menu` já na primeira entrega (5º membro, hotkey 5, `/mods tree-explained`), seguindo o contrato `menuEntry` apiVersion 1.
