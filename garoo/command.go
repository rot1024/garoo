package garoo

import (
	"fmt"
	"log/slog"
)

func (g *Garoo) processCommand(args []string, rec Receiver) error {
	switch args[0] {
	case "request-login":
		if len(args) < 2 {
			return fmt.Errorf("invalid arg count")
		}

		slog.Info("requesting login", "store", args[1])

		store := g.findStore(args[1])
		if store == nil {
			return fmt.Errorf("store not found")
		}

		url, err := store.RequestLogin()
		if err != nil {
			return fmt.Errorf("failed to request login: %v", err)
		}

		if err := rec.PostMessage(url, false); err != nil {
			return fmt.Errorf("failed to post message: %v", err)
		}
	case "login":
		if len(args) < 3 {
			return fmt.Errorf("invalid arg count")
		}

		slog.Info("logging in", "store", args[1])

		store := g.findStore(args[1])
		if store == nil {
			return fmt.Errorf("store not found")
		}

		if err := store.Login(args[2]); err != nil {
			return fmt.Errorf("failed to login: %v", err)
		}

		if err := g.SaveConfig(); err != nil {
			return fmt.Errorf("failed to save config: %v", err)
		}

		if err := rec.PostMessage("DONE!", false); err != nil {
			return fmt.Errorf("failed to post message: %v", err)
		}
	case "help":
		if err := rec.PostMessage(help, false); err != nil {
			return fmt.Errorf("failed to post message: %v", err)
		}
	default:
		if err := rec.PostMessage("unknown command", false); err != nil {
			return fmt.Errorf("failed to post message: %v", err)
		}
		return fmt.Errorf("unknown command")
	}
	return nil
}

const help = `
garo request-login <store>
garo login <store> <code>
`
