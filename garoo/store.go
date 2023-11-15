package garoo

type Store interface {
	Name() string
	Save(*Post) error
}

type MockStore struct {
	NameFunc func() string
	SaveFunc func(*Post) error
}

var _ Store = (*MockStore)(nil)

func (s *MockStore) Name() string {
	return s.NameFunc()
}

func (s *MockStore) Save(p *Post) error {
	return s.SaveFunc(p)
}
