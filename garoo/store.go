package garoo

type Store interface {
	Name() string
	Init(string) error
	Save(*Post) error
	RequestLogin() (string, error)
	Login(token string) error
	GetConfig() string
}

type MockStore struct {
	NameFunc         func() string
	InitFunc         func(string) error
	SaveFunc         func(*Post) error
	RequestLoginFunc func() (string, error)
	LoginFunc        func(string) error
	GetConfigFunc    func() string
}

var _ Store = (*MockStore)(nil)

func (s *MockStore) Name() string {
	return s.NameFunc()
}

func (s *MockStore) Init(c string) error {
	return s.InitFunc(c)
}

func (s *MockStore) Save(p *Post) error {
	return s.SaveFunc(p)
}

func (s *MockStore) RequestLogin() (string, error) {
	return s.RequestLoginFunc()
}

func (s *MockStore) Login(token string) error {
	return s.LoginFunc(token)
}

func (s *MockStore) GetConfig() string {
	return s.GetConfigFunc()
}
