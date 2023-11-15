package garoo

import "net/url"

type Provider interface {
	Name() string
	ExtractPostID(*url.URL) string
	GetPost(id string) (*Post, error)
}

type MockProvider struct {
	NameFunc          func() string
	ExtractPostIDFunc func(*url.URL) string
	GetPostFunc       func(string) (*Post, error)
}

var _ Provider = (*MockProvider)(nil)

func (p *MockProvider) Name() string {
	return p.NameFunc()
}

func (p *MockProvider) ExtractPostID(u *url.URL) string {
	return p.ExtractPostIDFunc(u)
}

func (p *MockProvider) GetPost(id string) (*Post, error) {
	return p.GetPostFunc(id)
}
