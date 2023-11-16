package main

import (
	"fmt"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
)

const CONFIG_PREFIX = "GAROO"

type Config struct {
	Discord DiscordConfig `json:"discord"`
	Twitter TwitterConfig `json:"twitter"`
	SQLite  SQLiteConfig  `json:"sqlite"`
	Notion  NotionConfig  `json:"notion"`
	Dropbox DropboxConfig `json:"dropbox"`
}

type DiscordConfig struct {
	Token   string `json:"token"`
	Channel string `json:"channel"`
	User    string `json:"user"`
}

type TwitterConfig struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Email    string `json:"email"`
}

type SQLiteConfig struct {
	DSN string `json:"dsn"`
}

type NotionConfig struct {
	Token           string `json:"token"`
	PostDB          string `json:"post_db"`
	SecondaryPostDB string `json:"secondary_post_db"`
	AuthorDB        string `json:"author_db"`
}

type DropboxConfig struct {
	Token         string `json:"token"`
	BaseDir       string `json:"base_dir"`
	Client_ID     string `json:"client_id"`
	Client_Secret string `json:"client_secret"`
}

func LoadConfig() (*Config, error) {
	// load .env
	err := godotenv.Load()
	if err != nil {
		return nil, fmt.Errorf("failed to load .env: %v", err)
	}

	// load config
	config := &Config{}
	err = envconfig.Process(CONFIG_PREFIX, config)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %v", err)
	}

	return config, nil
}
