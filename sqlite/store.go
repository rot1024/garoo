package sqlite

import (
	"database/sql"
	"strings"
	"time"

	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"

	_ "embed"

	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	dataSource string
}

var _ garoo.Store = (*Store)(nil)

//go:embed schemas.sql
var initSQL string

func New(dataSource string) (*Store, error) {
	s := &Store{dataSource: dataSource}
	if err := s.openAndInitDB(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Name() string {
	return "sqlite"
}

func (s *Store) Save(post *garoo.Post) error {
	return s.open(func(db *sql.DB) (err error) {
		return s.upsertPost(db, post)
	})
}

func (s *Store) RequestLogin() (string, error) {
	return "", nil
}

func (s *Store) Login(token string) error {
	return nil
}

func (s *Store) upsertPost(db *sql.DB, post *garoo.Post) error {
	_, err := db.Exec(
		"REPLACE INTO pictures (id, user_name, user_screenname, user_id, description, provider, url, created_at, category, label, count, media_url, user_avatar_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
		post.ID,
		post.Author.Name,
		post.Author.ScreenName,
		post.Author.ID,
		post.Content,
		post.Provider,
		post.URL,
		formatTime(post.Timestamp),
		post.Category,
		strings.Join(post.Tags, " "),
		len(post.Media),
		strings.Join(lo.Map(post.Media, func(m garoo.Media, _ int) string { return m.URL }), ","),
		post.Author.Avator,
	)
	return err
}

func (s *Store) initDB(db *sql.DB) error {
	_, err := db.Exec(initSQL)
	return err
}

func (s *Store) openAndInitDB() error {
	return s.open(func(db *sql.DB) error {
		return s.initDB(db)
	})
}

func (s *Store) open(f func(db *sql.DB) error) error {
	db, err := sql.Open("sqlite3", s.dataSource)
	if err != nil {
		return err
	}
	defer db.Close()

	return f(db)
}

func formatTime(t time.Time) string {
	return t.Format("2006-01-02 15:04:05")
}

func (s *Store) GetConfig() string {
	return ""
}

func (s *Store) Init(c string) error {
	return nil
}
