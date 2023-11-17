package garoo

import "net/url"

type Provider interface {
	Init(string) error
	Login(string) (string, error)
	Name() string
	ExtractPostID(*url.URL) string
	GetPost(id string) (*Post, error)
	GetConfig() string
}

type MockProvider struct {
	NameFunc          func() string
	InitFunc          func(string) error
	LoginFunc         func(string) (string, error)
	ExtractPostIDFunc func(*url.URL) string
	GetPostFunc       func(string) (*Post, error)
	GetConfigFunc     func() string
}

var _ Provider = (*MockProvider)(nil)

func (p *MockProvider) Name() string {
	return p.NameFunc()
}

func (p *MockProvider) Init(conf string) error {
	return p.InitFunc(conf)
}

func (p *MockProvider) Login(code string) (string, error) {
	return p.LoginFunc(code)
}

func (p *MockProvider) ExtractPostID(u *url.URL) string {
	return p.ExtractPostIDFunc(u)
}

func (p *MockProvider) GetPost(id string) (*Post, error) {
	return p.GetPostFunc(id)
}

func (p *MockProvider) GetConfig() string {
	return p.GetConfigFunc()
}
