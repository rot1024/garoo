package twitter

import (
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	twitterscraper "github.com/n0madic/twitter-scraper"
	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

const provider = "twitter"

var hostnames = []string{
	"twitter.com",
	"x.com",
}

type Provider struct {
	user     string
	password string
	email    string
	scraper  *twitterscraper.Scraper
}

var _ garoo.Provider = (*Provider)(nil)

func New(user, password, email string) (*Provider, error) {
	scraper := twitterscraper.New()
	// err := scraper.Login(user, password, email)
	err := scraper.LoginOpenAccount()
	if err != nil {
		return nil, fmt.Errorf("failed to login: %v", err)
	}

	return &Provider{
		user:     user,
		password: password,
		email:    email,
		scraper:  scraper,
	}, nil
}

func (x *Provider) Name() string {
	return provider
}

func (*Provider) ExtractPostID(u *url.URL) string {
	if !slices.Contains(hostnames, u.Hostname()) {
		return ""
	}

	p := strings.SplitN(u.Path, "/", 4)
	if len(p) != 4 || p[2] != "status" {
		return ""
	}

	return p[3]
}

func (x *Provider) GetPost(id string) (*garoo.Post, error) {
	t, err := x.scraper.GetTweet(id)
	if err != nil {
		return nil, err
	}

	if t.QuotedStatus != nil {
		t = t.QuotedStatus
	}

	u, err := x.scraper.GetProfile(t.Username)
	if err != nil {
		return nil, err
	}

	return &garoo.Post{
		ID:        t.ID,
		Timestamp: time.Unix(t.Timestamp, 0),
		Content:   t.Text,
		Provider:  provider,
		URL:       fmt.Sprintf("https://twitter.com/%s/status/%s", t.Username, t.ID),
		Author: garoo.Author{
			ID:          t.UserID,
			ScreenName:  t.Username,
			Name:        u.Name,
			Description: u.Biography,
			Avator:      u.Avatar,
			Provider:    provider,
		},
		Media: append(
			lo.Map(t.Photos, photoToMedia),
			lo.Map(t.Videos, photoToVideo)...,
		),
	}, nil
}

func (x *Provider) GetConfig() (string, error) {
	cookies := x.scraper.GetCookies()
	s := marshalCookies(cookies)
	return s, nil
}

func (x *Provider) SetConfig(c string) error {
	cookies := unmarshalCookies(c)
	x.scraper.SetCookies(cookies)
	return nil
}

func photoToMedia(p twitterscraper.Photo, _ int) garoo.Media {
	return garoo.Media{
		ID:   p.ID,
		Type: garoo.MediaTypePhoto,
		URL:  p.URL,
	}
}

func photoToVideo(v twitterscraper.Video, _ int) garoo.Media {
	return garoo.Media{
		ID:   v.ID,
		Type: garoo.MediaTypeVideo,
		URL:  v.URL,
	}
}
