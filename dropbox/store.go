package dropbox

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"

	"github.com/dropbox/dropbox-sdk-go-unofficial/v6/dropbox"
	"github.com/dropbox/dropbox-sdk-go-unofficial/v6/dropbox/files"
	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

const maxRootFileCountPerAuthor = 5
const defaultCategory = "uncategorized"

type Store struct {
	client  files.Client
	http    *http.Client
	basedir string
}

var _ garoo.Store = (*Store)(nil)

func New(token, basedir string) *Store {
	config := dropbox.Config{
		Token:    token,
		LogLevel: dropbox.LogInfo,
	}
	client := files.New(config)

	return &Store{
		client:  client,
		http:    http.DefaultClient,
		basedir: basedir,
	}
}

func (s *Store) Name() string {
	return "dropbox"
}

func (s *Store) Save(post *garoo.Post) error {
	if len(post.Media) == 0 {
		log.Printf("dropbox: no media in %s", post.ID)
		return nil
	}

	// look up the author dir
	authorDir := s.dirpathWithAuthorName(post)
	log.Printf("dropbox: looking up the author dir: %s", authorDir)
	exists, err := s.folderExists(authorDir)
	if err != nil {
		return fmt.Errorf("failed to check author dir: %w", err)
	}

	// if exists, save files
	if exists {
		log.Printf("dropbox: found the author dir")
		if err := s.savePostTo(post, authorDir); err != nil {
			return fmt.Errorf("failed to save post to author dir: %w", err)
		}

		return nil
	}

	// list files in the dir and extract files by screen name
	log.Printf("dropbox: listing files in the root dir of %s", post.ID)
	rootDir := s.dirpath(post)
	files, err := s.readdir(rootDir)
	if err != nil {
		return fmt.Errorf("failed to list files in the root dir: %w", err)
	}
	files = extractFilesByScreenName(files, post.Author.ScreenName)

	// if extracted files are more than maxRootFileCountPerAuthor, create a new dir
	if len(files)+len(post.Media) > maxRootFileCountPerAuthor {
		log.Printf("dropbox: too many files in the root dir of %s", post.ID)

		// create a new dir
		newDir := path.Join(rootDir, post.Author.ScreenName)
		if err := s.createDir(newDir); err != nil {
			return fmt.Errorf("failed to create a new dir: %w", err)
		}

		log.Printf("dropbox: created a new dir: %s", newDir)

		// move files to the new dir
		if err := s.moveFiles(files, newDir); err != nil {
			return fmt.Errorf("failed to move files to the new dir: %w", err)
		}

		log.Printf("dropbox: moved %d files to the new dir: %s", len(files), newDir)

		// save files to the new dir
		if err := s.savePostTo(post, newDir); err != nil {
			return fmt.Errorf("failed to save post to the new dir: %w", err)
		}

		return nil
	}

	log.Printf("dropbox: saving files to the root dir: %s", rootDir)

	// save files to the root dir
	if err := s.savePostTo(post, rootDir); err != nil {
		return fmt.Errorf("failed to save post to the root dir: %w", err)
	}

	return nil
}

func (s *Store) savePostTo(p *garoo.Post, dir string) error {
	for i := range p.Media {
		filename := filename(p, i)
		path := path.Join(dir, filename)

		log.Printf("dropbox: saving %d/%d to %s", i+1, len(p.Media), path)

		err := (func() error {
			data, err := s.downloadMedia(p, i)
			if err != nil {
				return err
			}

			defer data.Close()

			if err := s.upload(path, data); err != nil {
				return err
			}

			return nil
		})()

		if err != nil {
			return fmt.Errorf("failed to save %d/%d: %w", i+1, len(p.Media), err)
		}

		log.Printf("dropbox: saved %d/%d", i+1, len(p.Media))
	}

	return nil
}

func (s *Store) downloadMedia(p *garoo.Post, i int) (io.ReadCloser, error) {
	u := p.Media[i].URL
	res, err := s.http.Get(u)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download media from %s: %s", u, res.Status)
	}
	return res.Body, nil
}

func (s *Store) upload(path string, data io.Reader) error {
	_, err := s.client.Upload(&files.UploadArg{
		CommitInfo: files.CommitInfo{
			Path: path,
		},
	}, data)

	if err != nil {
		return fmt.Errorf("failed to upload %s: %w", path, err)
	}
	return nil
}

func (s *Store) folderExists(p string) (bool, error) {
	res, err := s.client.GetMetadata(&files.GetMetadataArg{
		Path: p,
	})
	if err != nil {
		return false, err
	}

	_, ok := res.(*files.FolderMetadata)
	return ok, nil
}

func (s *Store) readdir(p string) (result []string, err error) {
	var res *files.ListFolderResult
	cursor := ""
	for {
		if cursor == "" {
			res, err = s.client.ListFolder(&files.ListFolderArg{
				Path: p,
			})
		} else {
			res, err = s.client.ListFolderContinue(&files.ListFolderContinueArg{
				Cursor: cursor,
			})
		}

		if err != nil {
			return nil, err
		}

		result = append(result, lo.FilterMap(res.Entries, func(e files.IsMetadata, _ int) (string, bool) {
			switch f := e.(type) {
			case *files.FileMetadata:
				return f.PathLower, true
			default:
				return "", false
			}
		})...)

		if !res.HasMore {
			break
		}

		cursor = res.Cursor
	}

	return
}

func (s *Store) createDir(p string) error {
	_, err := s.client.CreateFolderV2(&files.CreateFolderArg{
		Path: p,
	})
	return err
}

func (s *Store) moveFiles(p []string, dest string) error {
	for _, f := range p {
		to := path.Join(dest, path.Base(f))
		log.Printf("dropbox: moving %s to %s", f, to)

		_, err := s.client.MoveV2(&files.RelocationArg{
			RelocationPath: files.RelocationPath{
				FromPath: f,
				ToPath:   to,
			},
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) dirpath(p *garoo.Post) string {
	cat := p.Category
	if cat == "" {
		cat = defaultCategory
	}

	return path.Join(
		s.basedir,
		p.Provider,
		cat,
	)
}

func (s *Store) dirpathWithAuthorName(p *garoo.Post) string {
	return path.Join(
		s.dirpath(p),
		strings.ToLower(p.Author.ScreenName),
	)
}

func filename(p *garoo.Post, i int) string {
	screenname := strings.ToLower(p.Author.ScreenName)
	ext := path.Ext(p.Media[i].URL)
	if len(p.Media) == 1 {
		return fmt.Sprintf("%s_%s%s", screenname, p.ID, ext)
	}
	return fmt.Sprintf("%s_%s_%d%s", screenname, p.ID, i+1, ext)
}

func extractFilesByScreenName(files []string, screenname string) []string {
	screenname = strings.ToLower(screenname)
	var result []string
	for _, f := range files {
		if strings.HasPrefix(path.Base(f), screenname+"_") {
			result = append(result, f)
		}
	}
	return result
}
