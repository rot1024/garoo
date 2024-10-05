package twitter_scraper

import (
	"context"

	"github.com/rot1024/garoo/garoo"
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
	return p.Into()
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
