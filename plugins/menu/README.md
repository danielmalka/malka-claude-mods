# menu

## English

An optional `/mods` menu. It opens a small pane that lists the mods you have installed from this collection (status line, clean screen, mode, permissions), each with a one-line summary. Pick one to open its settings page; "back" returns to the list.

- Optional: the other mods work fine without it. It lists only what is installed; with none installed it says so.
- A `◆ mods` button sits in the footer under the prompt (the status line draws it when it is on).
- Hotkeys: `1` to `4` open the rows; `b` goes back; `esc` closes.

Install:

```
/plugin install menu@malka-claude-mods
```

Use: `/mods`, or `/mods statusline`, `/mods cleanscreen`, `/mods mode`, `/mods permissions` to open straight on a page.

Uninstall: `/plugin uninstall menu@malka-claude-mods`. The other mods keep working; they simply stop showing the `◆ mods` button.

Known limits: the open/closed state is kept in memory, so a hot reload can leave it out of step with the pane; if the menu is disabled mid-session, the other mods still think it is present until you restart.

## Português

Um menu `/mods` opcional. Abre um painel pequeno que lista os mods desta coleção que você instalou (status line, clean screen, mode, permissions), cada um com um resumo de uma linha. Escolha um para abrir a página de configurações; "back" volta à lista.

- Opcional: os outros mods funcionam sem ele. Lista só o que está instalado; sem nenhum, avisa.
- Um botão `◆ mods` fica no rodapé, sob o prompt (a status line o desenha quando está ligada).
- Atalhos: `1` a `4` abrem as linhas; `b` volta; `esc` fecha.

Instalar:

```
/plugin install menu@malka-claude-mods
```

Usar: `/mods`, ou `/mods statusline`, `/mods cleanscreen`, `/mods mode`, `/mods permissions` para abrir direto numa página.

Desinstalar: `/plugin uninstall menu@malka-claude-mods`. Os outros mods continuam funcionando; só deixam de mostrar o botão `◆ mods`.

Limites conhecidos: o estado aberto/fechado fica em memória, então um hot reload pode deixá-lo fora de sincronia com o painel; se o menu for desativado no meio da sessão, os outros mods ainda o veem como presente até reiniciar.
