package garoo

import (
	"fmt"
	"log/slog"
)

func (g *Garoo) processCommand(args []string, rec Receiver) (err error) {
	switch args[0] {
	case "request-login":
		if len(args) < 2 {
			return fmt.Errorf("invalid arg count")
		}

		slog.Info("requesting login", "store", args[1])

		var url string
		name := args[1]

		if provider := g.findProvider(name); provider != nil {
			url, err = provider.RequestLogin()
			if err != nil {
				return fmt.Errorf("failed to request login from %s: %v", name, err)
			}
		}
		if store := g.findStore(name); store != nil {
			url, err = store.RequestLogin()
			if err != nil {
				return fmt.Errorf("failed to request login from %s: %v", name, err)
			}
		}

		if url != "" {
			if err := rec.PostMessage(url, false); err != nil {
				return fmt.Errorf("failed to post message: %v", err)
			}
			return nil
		}

		if err := rec.PostMessage("not found", false); err != nil {
			return fmt.Errorf("failed to post message: %v", err)
		}
		return fmt.Errorf("not found")
	case "login":
		loggedIn := false
		name := args[1]
		var code string
		if len(args) > 2 {
			code = args[2]
		}

		slog.Info("logging in", "name", name)

		if provider := g.findProvider(name); provider != nil {
			if err := provider.Login(code); err != nil {
				return fmt.Errorf("failed to login to %s: %v", name, err)
			}
			loggedIn = true
		}

		if store := g.findStore(name); store != nil {
			if err := store.Login(code); err != nil {
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
garo request-login <service>
garo login <service> <code>
`
