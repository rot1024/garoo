package garoo

type Store interface {
	Name() string
	Init(string) error
	Save(*Post) error
	Login(string) (string, error)
	GetConfig() string
}

type MockStore struct {
	NameFunc      func() string
	InitFunc      func(string) error
	SaveFunc      func(*Post) error
	LoginFunc     func(string) (string, error)
	GetConfigFunc func() string
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

func (s *MockStore) Login(code string) (string, error) {
	return s.LoginFunc(code)
}

func (s *MockStore) GetConfig() string {
	return s.GetConfigFunc()
}
