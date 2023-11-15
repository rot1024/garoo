package main

import (
	"fmt"
	"log"
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
	conf, err := LoadConfig()
	if err != nil {
		return err
	}

	receivers, err := initReceivers(conf)
	if err != nil {
		return fmt.Errorf("failed to init receivers: %v", err)
	}

	stores, err := initStores(conf)
	if err != nil {
		return fmt.Errorf("failed to init stores: %v", err)
	}

	providers, err := initProviders(conf)
	if err != nil {
		return fmt.Errorf("failed to init providers: %v", err)
	}

	logger := func(format string, args ...interface{}) {
		log.Printf(format, args...)
	}

	logger("receivers: %v", lo.Map(receivers, func(r garoo.Receiver, _ int) string {
		return r.Name()
	}))
	logger("providers: %v", lo.Map(providers, func(p garoo.Provider, _ int) string {
		return p.Name()
	}))
	logger("stores: %v", lo.Map(stores, func(s garoo.Store, _ int) string {
		return s.Name()
	}))

	logger("starting garoo")

	g := garoo.New(garoo.Options{
		Receivers: receivers,
		Providers: providers,
		Stores:    stores,
		Logger:    logger,
	})

	if err := g.Start(); err != nil {
		return fmt.Errorf("failed to start garoo: %v", err)
	}

	// wait for sigkill
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	if err := g.Stop(); err != nil {
		return fmt.Errorf("failed to stop garoo: %v", err)
	}

	logger("stopped garoo")
	return nil
}
