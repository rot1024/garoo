package garoo

import "context"

type Provider interface {
	Init(string) error
	Login(string) (string, error)
	Name() string
	Check(url string) bool
	GetPost(ctx context.Context, url string) (*Post, error)
	GetConfig() string
}

type MockProvider struct {
	NameFunc      func() string
	InitFunc      func(string) error
	LoginFunc     func(string) (string, error)
	CheckFunc     func(string) bool
	GetPostFunc   func(context.Context, string) (*Post, error)
	GetConfigFunc func() string
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

func (p *MockProvider) Check(u string) bool {
	return p.CheckFunc(u)
}

func (p *MockProvider) GetPost(ctx context.Context, url string) (*Post, error) {
	return p.GetPostFunc(ctx, url)
}

func (p *MockProvider) GetConfig() string {
	return p.GetConfigFunc()
}
