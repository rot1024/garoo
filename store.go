package main

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/rot1024/garoo/dropbox"
	"github.com/rot1024/garoo/garoo"
	"github.com/rot1024/garoo/notion"
	"github.com/rot1024/garoo/sqlite"
)

var stores = map[string]func(*Config) (garoo.Store, error){
	"sqlite":  initSQLite,
	"notion":  initNotion,
	"dropbox": initDropbox,
}

func initStores(conf *Config) (res []garoo.Store, _ error) {
	for name, init := range stores {
		store, err := init(conf)
		if err != nil {
			return nil, fmt.Errorf("failed to init store %s: %v", name, err)
		}
		if store != nil {
			res = append(res, store)
		}
	}

	return
}

func initSQLite(conf *Config) (garoo.Store, error) {
	if conf.SQLite.DSN == "" {
		return nil, nil
	}

	printPermission(conf.SQLite.DSN)
	return sqlite.New(conf.SQLite.DSN)
}

func printPermission(dsn string) {
	if !strings.HasPrefix(dsn, ":memory:") {
		u, err := url.Parse(dsn)
		if err == nil && (u.Scheme == "file" || u.Scheme == "") {
			p := u.Path
			if p == "" {
				p = u.Opaque
			}
			d := path.Dir(p)
			s, err := os.Stat(p)
			if err == nil {
				s2, err := os.Stat(d)
				if err == nil {
					slog.Info("sqlite", "path", p, "dir", d, "mode", s.Mode().String(), "dir mode", s2.Mode().String())
				}
			}
		}
	}
}

func initNotion(conf *Config) (garoo.Store, error) {
	if conf.Notion.Token == "" || conf.Notion.PostDB == "" || conf.Notion.AuthorDB == "" {
		return nil, nil
	}
	return notion.New(notion.Options{
		Token:           conf.Notion.Token,
		PostDB:          conf.Notion.PostDB,
		SecondaryPostDB: conf.Notion.SecondaryPostDB,
		AuthorDB:        conf.Notion.AuthorDB,
	}), nil
}

func initDropbox(conf *Config) (garoo.Store, error) {
	if conf.Dropbox.BaseDir == "" {
		return nil, nil
	}
	return dropbox.New(dropbox.Config{
		Token:        conf.Dropbox.Token,
		BaseDir:      conf.Dropbox.BaseDir,
		ClientID:     conf.Dropbox.Client_ID,
		ClientSecret: conf.Dropbox.Client_Secret,
		RedirectURL:  conf.Dropbox.Redirect_URL,
	}), nil
}
