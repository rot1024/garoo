package sqlite

import (
	"database/sql"
	"testing"
	"time"

	"github.com/rot1024/garoo/garoo"
	"github.com/stretchr/testify/assert"
)

func TestStore(t *testing.T) {
	s := &Store{dataSource: ":memory:"}

	err := s.open(func(db *sql.DB) error {
		t.Run("initDB", func(t *testing.T) {
			assert.NoError(t, s.initDB(db))
		})

		post := &garoo.Post{
			ID:        "1234567890",
			Provider:  "twitter",
			URL:       "https://twitter.com/user/status/1234567890",
			Timestamp: time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC),
			Content:   "Hello, world!",
			Category:  "test",
			Tags:      []string{"test", "test2"},
			Media: []garoo.Media{
				{
					URL: "https://example.com/image.png",
				},
			},
			Author: garoo.Author{
				ID:          "1234567890",
				ScreenName:  "user",
				Name:        "User",
				Description: "Hello, world!",
				Avator:      "https://example.com/avatar.png",
			},
		}

		t.Run("Save", func(t *testing.T) {
			err := s.upsertPost(db, post)
			assert.NoError(t, err)

			// get record
			var (
				id, provider, url, content, category, label, mediaURL, avatarURL, timestamp string
				count                                                                       int
			)

			err = db.QueryRow("SELECT id, provider, url, created_at, description, category, label, count, media_url, user_avatar_url FROM pictures WHERE id = ?", post.ID).Scan(
				&id,
				&provider,
				&url,
				&timestamp,
				&content,
				&category,
				&label,
				&count,
				&mediaURL,
				&avatarURL,
			)

			assert.NoError(t, err)
			assert.Equal(t, "1234567890", id)
			assert.Equal(t, "twitter", provider)
			assert.Equal(t, "https://twitter.com/user/status/1234567890", url)
			assert.Equal(t, formatTime(time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC)), timestamp)
			assert.Equal(t, "Hello, world!", content)
			assert.Equal(t, "test", category)
			assert.Equal(t, "test test2", label)
			assert.Equal(t, 1, count)
			assert.Equal(t, "https://example.com/image.png", mediaURL)
			assert.Equal(t, "https://example.com/avatar.png", avatarURL)
		})

		t.Run("Save (update)", func(t *testing.T) {
			post.Content = "Hello, world! (updated)"
			err := s.upsertPost(db, post)
			assert.NoError(t, err)

			// get record
			var (
				content string
			)

			err = db.QueryRow("SELECT description FROM pictures WHERE id = ?", post.ID).Scan(&content)
			assert.NoError(t, err)
			assert.Equal(t, "Hello, world! (updated)", content)
		})

		return nil
	})
	assert.NoError(t, err)
}
