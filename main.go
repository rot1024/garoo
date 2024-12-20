package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"os/user"
	"syscall"

	"github.com/rot1024/garoo/garoo"
	"github.com/rot1024/garoo/twitter"
	"github.com/samber/lo"
)

func main() {
	if err := main2(); err != nil {
		log.Fatal(err)
	}
}

func main2() error {
	slog.Info("garoo")

	u, err := user.Current()
	if err != nil {
		return fmt.Errorf("failed to get current user: %v", err)
	}
	slog.Info("user", "user", u.Username, "uid", u.Uid, "gid", u.Gid)

	conf, err := LoadConfig()
	if err != nil {
		return err
	}

	receivers, err := initReceivers(conf)
	if err != nil {
		return fmt.Errorf("failed to init receivers: %v", err)
	}
	if len(receivers) == 0 {
		return fmt.Errorf("no receivers found")
	}

	stores, err := initStores(conf)
	if err != nil {
		return fmt.Errorf("failed to init stores: %v", err)
	}

	providers, err := initProviders(conf)
	if err != nil {
		return fmt.Errorf("failed to init providers: %v", err)
	}

	slog.Info("receivers", "receivers", lo.Map(receivers, func(r garoo.Receiver, _ int) string {
		return r.Name()
	}))
	slog.Info("providers", "providers", lo.Map(providers, func(p garoo.Provider, _ int) string {
		return p.Name()
	}))
	slog.Info("stores", "stores", lo.Map(stores, func(s garoo.Store, _ int) string {
		return s.Name()
	}))

	// init context
	ctx, cancel := twitter.InitChromeDP(context.Background(), infof)
	defer cancel()

	g := garoo.New(garoo.Options{
		Receivers:    receivers,
		Providers:    providers,
		Stores:       stores,
		MainReceiver: receivers[0],
		Context:      ctx,
	})

	if err := g.Start(); err != nil {
		return fmt.Errorf("failed to start garoo: %v", err)
	}

	slog.Info("ready")

	// wait for sigkill
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	slog.Info("stopping garoo")

	if err := g.SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %v", err)
	}

	if err := g.Stop(); err != nil {
		return fmt.Errorf("failed to stop garoo: %v", err)
	}

	slog.Info("stopped garoo")
	return nil
}

func infof(format string, v ...interface{}) {
	slog.Info(fmt.Sprintf(format, v...))
}
