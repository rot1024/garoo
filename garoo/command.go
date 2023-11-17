package garoo

import (
	"fmt"
	"log/slog"
)

func (g *Garoo) processCommand(args []string, rec Receiver) (err error) {
	switch args[0] {
	case "login":
		msg := ""
		loggedIn := false
		name := args[1]
		var code string
		if len(args) > 2 {
			code = args[2]
		}

		slog.Info("logging in", "name", name)

		if provider := g.findProvider(name); provider != nil {
			if msg, err = provider.Login(code); err != nil {
				return fmt.Errorf("failed to login to %s: %v", name, err)
			}
			loggedIn = true
		}

		if store := g.findStore(name); store != nil {
			if msg, err = store.Login(code); err != nil {
				return fmt.Errorf("failed to login to %s: %v", name, err)
			}
			loggedIn = true
		}

		if !loggedIn {
			if err := rec.PostMessage("not found", false); err != nil {
				return fmt.Errorf("failed to post message: %v", err)
			}
			return fmt.Errorf("not found")
		}

		if msg != "" {
			if err := rec.PostMessage(msg, false); err != nil {
				return fmt.Errorf("failed to post message: %v", err)
			}
			return
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
garo login <service> <code?>
`
