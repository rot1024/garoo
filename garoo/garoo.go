package garoo

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/samber/lo"
)

type Garoo struct {
	receivers []Receiver
	providers []Provider
	stores    []Store
}

type Options struct {
	Receivers []Receiver
	Providers []Provider
	Stores    []Store
}

func New(options Options) *Garoo {
	g := &Garoo{
		receivers: options.Receivers,
		providers: options.Providers,
		stores:    options.Stores,
	}

	for _, receiver := range g.receivers {
		receiver.AddHandler(g.handler)
	}

	return g
}

func (g *Garoo) handler(msg *Message, rec Receiver) {
	slog.Info("received message", "receiver", rec.Name(), "msg", msg.Content)

	msgs := formatMessage(msg.Content)
	seeds := g.getSeeds(msgs)
	le := len(seeds)
	slog.Info("found seed(s)", "count", le)

	var errors int
	for i, seed := range seeds {
		slog.Info("processing seed", "index", i+1, "total", le, "id", seed.ID, "provider", seed.Provider)

		if err := g.processSeed(seed); err != nil {
			errors++
			errmsg := fmt.Sprintf("ERROR (%d/%d): %v", i+1, le, err)

			slog.Info("failed to process seed", "err", errmsg)
			if err := rec.PostMessage(errmsg); err != nil {
				slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
			}
		} else {
			slog.Info("processed seed", "index", i+1, "total", le, "provider", seed.Provider)
		}
	}

	slog.Info("done")
	if errors == 0 {
		if err := rec.PostMessage("DONE"); err != nil {
			slog.Error("failed to post message", "receiver", rec.Name(), "err", err)
		}
	}
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
		slog.Info("get post", "index", 1, "total", len(post.Media), "id", post.ID, "provider", post.Provider)

		for _, store := range g.stores {
			slog.Info("saving post", "store", store.Name())
			if err := store.Save(post); err != nil {
				return fmt.Errorf("failed to save post to %s: %v", store.Name(), err)
			}
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
