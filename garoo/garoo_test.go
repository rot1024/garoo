package garoo

import (
	"fmt"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGaroo(t *testing.T) {
	var handler Handler
	var messages []string
	var logs []string

	receiver := &MockReceiver{
		NameFunc:  func() string { return "receiver" },
		StartFunc: func() error { return nil },
		StopFunc:  func() error { return nil },
		AddHandlerFunc: func(h Handler) {
			handler = h
		},
		PostMessageFunc: func(msg string) error {
			messages = append(messages, msg)
			return nil
		},
	}

	provider := &MockProvider{
		NameFunc: func() string { return "provider" },
		ExtractPostIDFunc: func(u *url.URL) string {
			return "postID"
		},
		GetPostFunc: func(id string) (*Post, error) {
			return &Post{
				ID: "postID",
			}, nil
		},
	}

	store := &MockStore{
		NameFunc: func() string { return "store" },
		SaveFunc: func(p *Post) error {
			return nil
		},
	}

	logger := func(msg string, args ...any) {
		logs = append(logs, fmt.Sprintf(msg, args...))
	}

	g := New(Options{
		Receivers: []Receiver{receiver},
		Providers: []Provider{provider},
		Stores:    []Store{store},
		Logger:    logger,
	})

	assert.NoError(t, g.Start())
	assert.NoError(t, g.Stop())

	// test 1: success
	msg := &Message{
		Content: "https://example.com",
	}
	handler(msg, receiver)
	assert.Equal(t, []string{
		"received message from receiver: https://example.com",
		"found 1 seed(s)",
		"processing seed (1/1): postID (provider)",
		"getting post from provider: postID",
		"got post from provider: postID (0 media)",
		"saving post to store",
		"processed seed (1/1): postID (provider)",
		"done",
	}, logs)
	assert.Equal(t, []string{
		"DONE",
	}, messages)

	// test 2: fail to get post
	provider.GetPostFunc = func(id string) (*Post, error) {
		return nil, fmt.Errorf("failed to get post")
	}
	logs = nil
	messages = nil
	handler(msg, receiver)
	assert.Equal(t, []string{
		"received message from receiver: https://example.com",
		"found 1 seed(s)",
		"processing seed (1/1): postID (provider)",
		"getting post from provider: postID",
		"failed to process seed: ERROR (1/1): failed to get post from provider: failed to get post",
		"done",
	}, logs)
	assert.Equal(t, []string{
		"ERROR (1/1): failed to get post from provider: failed to get post",
	}, messages)

	// test 3: fail to save post
	store.SaveFunc = func(p *Post) error {
		return fmt.Errorf("failed to save post")
	}
	provider.GetPostFunc = func(id string) (*Post, error) {
		return &Post{
			ID: "postID",
		}, nil
	}
	logs = nil
	messages = nil
	handler(msg, receiver)
	assert.Equal(t, []string{
		"received message from receiver: https://example.com",
		"found 1 seed(s)",
		"processing seed (1/1): postID (provider)",
		"getting post from provider: postID",
		"got post from provider: postID (0 media)",
		"saving post to store",
		"failed to process seed: ERROR (1/1): failed to save post to store: failed to save post",
		"done",
	}, logs)
	assert.Equal(t, []string{
		"ERROR (1/1): failed to save post to store: failed to save post",
	}, messages)
}
