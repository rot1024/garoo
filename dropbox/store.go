package dropbox

import "github.com/rot1024/garoo/garoo"

type Store struct{}

var _ garoo.Store = (*Store)(nil)

func (s *Store) Name() string {
	return "dropbox"
}

func (s *Store) Save(post *garoo.Post) error {
	return nil
}
