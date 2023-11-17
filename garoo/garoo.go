package garoo

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/samber/lo"
)

type Garoo struct {
	receivers    []Receiver
	providers    []Provider
	stores       []Store
	mainReceiver Receiver
}

type Options struct {
	Receivers    []Receiver
	Providers    []Provider
	Stores       []Store
	MainReceiver Receiver
}

type config struct {
	Timestamp time.Time         `json:"timestamp,omitempty"`
	Providers map[string]string `json:"providers,omitempty"`
	Stores    map[string]string `json:"stores,omitempty"`
}

func New(options Options) *Garoo {
	g := &Garoo{
		receivers:    options.Receivers,
		providers:    options.Providers,
		stores:       options.Stores,
		mainReceiver: options.MainReceiver,
	}

	for _, receiver := range g.receivers {
		receiver.AddHandler(g.handler)
	}

	// load config
	conf := &config{}
	if err := g.mainReceiver.LoadConfig(conf); err != nil {
		slog.Error("failed to load config", "err", err)
	}

	// init providers
	for _, provider := range g.providers {
		slog.Info("initializing provider", "provider", provider.Name())
		if err := provider.Init(conf.Providers[provider.Name()]); err != nil {
			slog.Error("failed to init provider", "provider", provider.Name(), "err", err)
		}
	}

	// init stores
	for _, store := range g.stores {
		slog.Info("initializing store", "store", store.Name())
		if err := store.Init(conf.Stores[store.Name()]); err != nil {
			slog.Error("failed to init store", "store", store.Name(), "err", err)
		}
	}

	if err := g.SaveConfig(); err != nil {
		slog.Error("failed to save config", "err", err)
	}

	return g
}

func (g *Garoo) handler(msg *Message, rec Receiver) {
	slog.Info("received message", "receiver", rec.Name(), "msg", msg.Content)

	if isCommand(msg.Content) {
		args := strings.Split(msg.Content, " ")

		if err := g.processCommand(args[1:], rec); err != nil {
			slog.Error("failed to process command", "args", args[1:], "err", err)

			if err := rec.PostMessage(fmt.Sprintf("ERROR: %v", err), true); err != nil {
				slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
			}
		}
		return
	}

	msgs := formatMessage(msg.Content)
	seeds := g.getSeeds(msgs)
	le := len(seeds)
	if le == 0 {
		slog.Info("no seed found")
		return
	}

	slog.Info("found seed(s)", "count", le)
	if err := rec.PostMessage(fmt.Sprintf("ACCEPTED %d items", le), false); err != nil {
		slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
	}

	var errors int
	for i, seed := range seeds {
		slog.Info("processing seed", "index", i+1, "total", le, "id", seed.ID, "provider", seed.Provider, "cat", seed.Category, "tags", seed.Tags)
		if len(seeds) > 1 {
			if err := rec.PostMessage(fmt.Sprintf("PROCESSING %d/%d: %s (%s)", i+1, le, seed.ID, seed.Provider), false); err != nil {
				slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
			}
		}

		if err := g.processSeed(seed); err != nil {
			errors++
			errmsg := fmt.Sprintf("ERROR (%d/%d): %v", i+1, le, err)

			slog.Error("failed to process seed", "err", errmsg)
			if err := rec.PostMessage(errmsg, true); err != nil {
				slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
			}
		} else {
			slog.Info("processed seed", "index", i+1, "total", le, "provider", seed.Provider)
		}
	}

	slog.Info("done")
	if errors == 0 {
		if err := rec.PostMessage("DONE!", false); err != nil {
			slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
		}
	}

	if err := g.SaveConfig(); err != nil {
		slog.Error("failed to save config", "err", err)
	}
}

func (g *Garoo) SaveConfig() error {
	conf := &config{
		Timestamp: time.Now(),
		Providers: map[string]string{},
		Stores:    map[string]string{},
	}

	for _, provider := range g.providers {
		if c := provider.GetConfig(); c != "" {
			conf.Providers[provider.Name()] = c
		}
	}

	for _, store := range g.stores {
		if c := store.GetConfig(); c != "" {
			conf.Stores[store.Name()] = c
		}
	}

	if err := g.mainReceiver.SaveConfig(conf); err != nil {
		return fmt.Errorf("failed to save config: %v", err)
	}

	slog.Info("saved config")
	return nil
}

func (g *Garoo) Start() (err error) {
	for _, receiver := range g.receivers {
		if e := receiver.Start(); e != nil {
			if err == nil {
				err = fmt.Errorf("failed to start receivers")
			}
			err = errors.Join(err, e)
		}
	}
	return
}

func (g *Garoo) Stop() (err error) {
	for _, receiver := range g.receivers {
		if e := receiver.Stop(); e != nil {
			if err == nil {
				err = fmt.Errorf("failed to stop receivers")
			}
			err = errors.Join(err, e)
		}
	}
	return
}

func (g *Garoo) getSeeds(msgs []string) []Seed {
	return lo.FilterMap(msgs, func(msg string, _ int) (Seed, bool) {
		u, _, _ := strings.Cut(msg, " ")
		for _, provider := range g.providers {
			url, err := url.Parse(u)
			if err != nil {
				continue
			}

			id := provider.ExtractPostID(url)
			if id != "" {
				return SeedFrom(id, provider.Name(), msg), true
			}
		}

		return Seed{}, false
	})
}

func (g *Garoo) processSeed(seed Seed) error {
	for _, provider := range g.providers {
		if provider.Name() != seed.Provider {
			continue
		}

		slog.Info("getting post", "provider", seed.Provider, "id", seed.ID)

		post, err := provider.GetPost(seed.ID)
		if err != nil {
			return fmt.Errorf("failed to get post from %s: %v", provider.Name(), err)
		}

		post.Category = seed.Category
		post.Tags = seed.Tags
		slog.Info("got post", "id", post.ID, "provider", post.Provider)

		for _, store := range g.stores {
			slog.Info("saving post", "store", store.Name())
			if err := store.Save(post); err != nil {
				return fmt.Errorf("failed to save post to %s: %v", store.Name(), err)
			}
		}
	}

	return nil
}

func (g *Garoo) findProvider(name string) Provider {
	for _, provider := range g.providers {
		if provider.Name() == name {
			return provider
		}
	}
	return nil
}

func (g *Garoo) findStore(name string) Store {
	for _, store := range g.stores {
		if store.Name() == name {
			return store
		}
	}
	return nil
}

func formatMessage(msg string) []string {
	return lo.Filter(lo.Map(strings.Split(msg, "\n"), func(s string, _ int) string {
		return strings.TrimSpace(s)
	}), func(s string, _ int) bool {
		return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
	})
}
