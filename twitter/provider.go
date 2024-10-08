package twitter

import (
	"context"
	"fmt"
	"log/slog"
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

func (x *Provider) Init(conf string) (err error) {
	if conf != "" {
		x.setConfig(conf)
		if x.scraper.IsLoggedIn() {
			slog.Info("twitter: already logged in")
			return nil
		}
	}

	_, err = x.Login("")
	return err
}

func (x *Provider) Login(code string) (string, error) {
	if x.user == "" || x.password == "" {
		if err := x.scraper.LoginOpenAccount(); err != nil {
			return "", fmt.Errorf("failed to login: %v", err)
		}
		slog.Info("twitter: logged in with open account")
	} else if err := x.scraper.Login(x.user, x.password, x.email); err != nil {
		return "", fmt.Errorf("failed to login: %v", err)
	} else {
		slog.Info("twitter: logged in")
	}
	return "", nil
}

func (*Provider) Check(u string) bool {
	u2, err := url.Parse(u)
	if err != nil {
		return false
	}

	if !slices.Contains(hostnames, u2.Hostname()) {
		return false
	}

	p := strings.SplitN(u2.Path, "/", 4)
	if len(p) != 4 || p[2] != "status" {
		return false
	}

	return true
}

func (x *Provider) GetPost(ctx context.Context, id string) (*garoo.Post, error) {
	t, err := x.scraper.GetTweet(id)
	if err != nil {
		return nil, err
	}

	if t.RetweetedStatus != nil {
		t = t.RetweetedStatus
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

func (x *Provider) GetConfig() string {
	cookies := x.scraper.GetCookies()
	s := marshalCookies(cookies)
	return s
}

func (x *Provider) setConfig(c string) {
	cookies := unmarshalCookies(c)
	x.scraper.SetCookies(cookies)
}

func photoToMedia(p twitterscraper.Photo, _ int) garoo.Media {
	return garoo.Media{
		Type: garoo.MediaTypePhoto,
		URL:  p.URL,
	}
}

func photoToVideo(v twitterscraper.Video, _ int) garoo.Media {
	return garoo.Media{
		Type: garoo.MediaTypeVideo,
		URL:  v.URL,
	}
}
