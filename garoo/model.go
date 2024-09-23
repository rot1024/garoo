package garoo

import (
	"strings"
	"time"
)

type Message struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Content   string    `json:"content"`
}

type Seed struct {
	URL      string   `json:"url"`
	Provider string   `json:"provider"`
	Category string   `json:"category,omitempty"`
	Tags     []string `json:"tags,omitempty"`
}

func SeedFrom(url, provider, message string) Seed {
	msgs := strings.Split(message, " ")
	var cat string
	var tags []string

	if len(msgs) > 1 {
		cat = msgs[1]
		if cat == "-" {
			cat = ""
		}
		if len(msgs) > 2 {
			tags = msgs[2:]
		}
	}

	return Seed{
		URL:      url,
		Provider: provider,
		Category: cat,
		Tags:     tags,
	}
}

type Post struct {
	ID        string    `json:"id"`
	Provider  string    `json:"provider"`
	URL       string    `json:"url"`
	Timestamp time.Time `json:"timestamp"`
	Content   string    `json:"content"`
	Author    Author    `json:"author"`
	Media     []Media   `json:"media,omitempty"`
	Category  string    `json:"category,omitempty"`
	Tags      []string  `json:"tags,omitempty"`
}

type Author struct {
	ID          string `json:"id"`
	ScreenName  string `json:"screen_name"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Avator      string `json:"avator,omitempty"`
	Provider    string `json:"provider"`
}

type MediaType string

const (
	MediaTypePhoto MediaType = "photo"
	MediaTypeVideo MediaType = "video"
)

type Media struct {
	ID   string    `json:"id"`
	Type MediaType `json:"type"`
	URL  string    `json:"url"`
}
