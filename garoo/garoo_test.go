package garoo

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGaroo(t *testing.T) {
	var handler Handler
	var messages []string

	dlog := slog.Default()
	l := &simpleLogger{buf: new(bytes.Buffer)}
	slog.SetDefault(slog.New(l))
	t.Cleanup(func() {
		slog.SetDefault(dlog)
	})

	receiver := &MockReceiver{
		NameFunc:  func() string { return "receiver" },
		StartFunc: func() error { return nil },
		StopFunc:  func() error { return nil },
		AddHandlerFunc: func(h Handler) {
			handler = h
		},
		PostMessageFunc: func(msg string, mentionToUser bool) error {
			messages = append(messages, msg)
			return nil
		},
		SaveConfigFunc: func(config any) error { return nil },
		LoadConfigFunc: func(config any) error { return nil },
	}

	provider := &MockProvider{
		NameFunc: func() string { return "provider" },
		ExtractPostIDFunc: func(u *url.URL) string {
			return "postID"
		},
		GetPostFunc: func(id string) (*Post, error) {
			return &Post{
				ID:       "postID",
				Provider: "provider",
			}, nil
		},
		InitFunc:      func(string) error { return nil },
		GetConfigFunc: func() string { return "" },
	}

	store := &MockStore{
		NameFunc: func() string { return "store" },
		SaveFunc: func(p *Post) error {
			return nil
		},
	}

	g := New(Options{
		Receivers:    []Receiver{receiver},
		Providers:    []Provider{provider},
		Stores:       []Store{store},
		MainReceiver: receiver,
	})

	assert.NoError(t, g.Start())
	assert.NoError(t, g.Stop())

	// test 1: success
	msg := &Message{
		Content: "https://example.com aaa bbb",
	}
	handler(msg, receiver)
	assert.Equal(t, []string{
		"initializing provider provider=provider",
		"saved config",
		"received message receiver=receiver msg=https://example.com aaa bbb",
		"found seed(s) count=1",
		"processing seed index=1 total=1 id=postID provider=provider cat=aaa tags=[bbb]",
		"getting post provider=provider id=postID",
		"got post id=postID provider=provider",
		"saving post store=store",
		"processed seed index=1 total=1 provider=provider",
		"done",
		"saved config",
	}, l.Logs())
	assert.Equal(t, []string{
		"ACCEPTED 1 items",
		"DONE!",
	}, messages)

	// test 2: fail to get post
	provider.GetPostFunc = func(id string) (*Post, error) {
		return nil, fmt.Errorf("failed to get post")
	}
	l.Reset()
	messages = nil
	handler(msg, receiver)
	assert.Equal(t, []string{
		"received message receiver=receiver msg=https://example.com aaa bbb",
		"found seed(s) count=1",
		"processing seed index=1 total=1 id=postID provider=provider cat=aaa tags=[bbb]",
		"getting post provider=provider id=postID",
		"failed to process seed err=ERROR (1/1): failed to get post from provider: failed to get post",
		"done",
		"saved config",
	}, l.Logs())
	assert.Equal(t, []string{
		"ACCEPTED 1 items",
		"ERROR (1/1): failed to get post from provider: failed to get post",
	}, messages)

	// test 3: fail to save post
	store.SaveFunc = func(p *Post) error {
		return fmt.Errorf("failed to save post")
	}
	provider.GetPostFunc = func(id string) (*Post, error) {
		return &Post{
			ID:       "postID",
			Provider: "provider",
		}, nil
	}
	l.Reset()
	messages = nil
	handler(msg, receiver)
	assert.Equal(t, []string{
		"received message receiver=receiver msg=https://example.com aaa bbb",
		"found seed(s) count=1",
		"processing seed index=1 total=1 id=postID provider=provider cat=aaa tags=[bbb]",
		"getting post provider=provider id=postID",
		"got post id=postID provider=provider",
		"saving post store=store",
		"failed to process seed err=ERROR (1/1): failed to save post to store: failed to save post",
		"done",
		"saved config",
	}, l.Logs())
	assert.Equal(t, []string{
		"ACCEPTED 1 items",
		"ERROR (1/1): failed to save post to store: failed to save post",
	}, messages)
}

type simpleLogger struct {
	buf *bytes.Buffer
}

var _ slog.Handler = (*simpleLogger)(nil)

func (l *simpleLogger) Enabled(ctx context.Context, level slog.Level) bool {
	return true
}

func (l *simpleLogger) Handle(_ context.Context, r slog.Record) error {
	fmt.Fprintf(l.buf, "%s", r.Message)

	r.Attrs(func(a slog.Attr) bool {
		fmt.Fprintf(l.buf, " %s=%v", a.Key, a.Value.Any())
		return true
	})

	fmt.Fprintln(l.buf)
	return nil
}

func (l *simpleLogger) WithAttrs(attrs []slog.Attr) slog.Handler {
	return l
}

func (l *simpleLogger) WithGroup(name string) slog.Handler {
	return l
}

func (l *simpleLogger) Logs() []string {
	return strings.Split(strings.TrimSpace(l.buf.String()), "\n")
}

func (l *simpleLogger) Reset() {
	l.buf.Reset()
}
