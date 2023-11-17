package dropbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/dropbox/dropbox-sdk-go-unofficial/v6/dropbox"
	"github.com/dropbox/dropbox-sdk-go-unofficial/v6/dropbox/files"
	"golang.org/x/oauth2"
)

func (s *Store) Init(conf string) error {
	if conf != "" {
		var token oauth2.Token
		if err := json.Unmarshal([]byte(conf), &token); err != nil {
			return err
		}
		return s.login(&token)
	} else if s.tokenSource != nil {
		return s.updateToken()
	}
	return errors.New("no token")
}

func (s *Store) RequestLogin() (string, error) {
	return s.oauth2Conf.AuthCodeURL("state", oauth2.AccessTypeOffline), nil
}

func (s *Store) Login(code string) error {
	token, err := s.oauth2Conf.Exchange(context.Background(), code)
	if err != nil {
		return err
	}

	return s.login(token)
}

func (s *Store) login(tok *oauth2.Token) error {
	if tok == nil {
		return errors.New("no token")
	}
	s.tokenSource = s.oauth2Conf.TokenSource(context.Background(), tok)
	return s.updateToken()
}

func (s *Store) updateToken() error {
	if s.test {
		return nil
	}

	if s.tokenSource == nil {
		return errors.New("not logged in")
	}

	token, err := s.tokenSource.Token()
	if err != nil {
		return fmt.Errorf("failed to get token: %v", err)
	}

	s.client = files.New(dropbox.Config{
		Token:    token.AccessToken,
		LogLevel: dropbox.LogOff,
	})

	return nil
}

func (s *Store) GetConfig() string {
	if s.tokenSource == nil {
		return ""
	}

	token, err := s.tokenSource.Token()
	if err != nil {
		return ""
	}

	b, err := json.Marshal(token)
	if err != nil {
		return ""
	}
	return string(b)
}

func oauth2Config(config Config) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     config.ClientID,
		ClientSecret: config.ClientSecret,
		RedirectURL:  config.RedirectURL,
		Endpoint:     dropbox.OAuthEndpoint(""),
		Scopes:       []string{"files.content.write", "files.content.read"},
	}
}
