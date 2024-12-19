package twitter

import (
	"fmt"
	"time"

	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

type Post struct {
	URL    string
	ID     string
	Text   string
	Autor  Profile
	Time   string
	Photos []string
	Videos []string
}

type Profile struct {
	URL         string
	Screename   string
	Name        string
	ID          string
	Avator      string
	Description string
}

func (p *Post) Into() (*garoo.Post, error) {
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
