package main

import (
	"fmt"

	"github.com/rot1024/garoo/garoo"
	"github.com/rot1024/garoo/notion"
	"github.com/rot1024/garoo/sqlite"
)

var stores = map[string]func(*Config) (garoo.Store, error){
	"sqlite": initSQLite,
	"notion": initNotion,
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
	return sqlite.New(conf.SQLite.DSN)
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
