package twitter_scraper

import (
	"context"
	"fmt"
	"time"

	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

type Provider struct{}

const provider = "twitter"

var _ garoo.Provider = (*Provider)(nil)

func New() (*Provider, error) {
	return &Provider{}, nil
}

func (x *Provider) Name() string {
	return "twitter_scraper"
}

func (x *Provider) Init(conf string) error {
	return nil
}

func (x *Provider) Login(string) (string, error) {
	return "", nil
}

func (*Provider) Check(url string) bool {
	id, screenname := getIDAndScreenNameFromURL(url)
	return id != "" && screenname != ""
}

func (x *Provider) GetPost(ctx context.Context, url string) (*garoo.Post, error) {
	p, err := GetPostFromURL(ctx, url)
	if err != nil {
		return nil, err
	}

	t, err := time.Parse(time.RFC3339, p.Time)
	if err != nil {
		return nil, fmt.Errorf("could not parse time: %w", err)
	}

	return &garoo.Post{
		ID:        p.ID,
		Timestamp: t,
		Content:   p.Text,
		Provider:  provider,
		URL:       fmt.Sprintf("https://twitter.com/%s/status/%s", p.Autor.Screename, p.ID),
		Author: garoo.Author{
			ID:          p.Autor.ID,
			ScreenName:  p.Autor.Screename,
			Name:        p.Autor.Name,
			Description: p.Autor.Description,
			Avator:      p.Autor.Avator,
			Provider:    provider,
		},
		Media: append(
			lo.Map(p.Photos, photoToMedia),
			lo.Map(p.Videos, photoToVideo)...,
		),
	}, nil
}

func (x *Provider) GetConfig() string {
	return ""
}

func (x *Provider) SetConfig(c string) {}

func photoToMedia(url string, _ int) garoo.Media {
	return garoo.Media{
		Type: garoo.MediaTypePhoto,
		URL:  url,
	}
}

func photoToVideo(url string, _ int) garoo.Media {
	return garoo.Media{
		Type: garoo.MediaTypeVideo,
		URL:  url,
	}
}
