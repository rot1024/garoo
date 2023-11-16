package main

import (
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

func main() {
	if err := main2(); err != nil {
		log.Fatal(err)
	}
}

func main2() error {
	slog.Info("garoo")

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

	slog.Info("starting garoo")

	g := garoo.New(garoo.Options{
		Receivers:    receivers,
		Providers:    providers,
		Stores:       stores,
		MainReceiver: receivers[0],
	})

	if err := g.Start(); err != nil {
		return fmt.Errorf("failed to start garoo: %v", err)
	}

	// wait for sigkill
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	slog.Info("stopping garoo")
	if err := g.Stop(); err != nil {
		return fmt.Errorf("failed to stop garoo: %v", err)
	}

	slog.Info("stopped garoo")
	return nil
}
