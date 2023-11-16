package dropbox

import (
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/dropbox/dropbox-sdk-go-unofficial/v6/dropbox/files"
	"github.com/jarcoal/httpmock"
	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
)

func TestStore(t *testing.T) {
	httpmock.Activate()
	defer httpmock.DeactivateAndReset()

	httpmock.RegisterResponder("GET", "https://example.com/foo.jpg",
		httpmock.NewStringResponder(200, "foo"))

	c := &dropboxFilesClientMock{}
	d := &Store{
		client:  c,
		http:    http.DefaultClient,
		basedir: "/foo",
	}
	post := &garoo.Post{
		ID:       "bar",
		Provider: "twitter",
		Media: []garoo.Media{
			{
				URL: "https://example.com/foo.jpg",
			},
		},
		Author: garoo.Author{
			ScreenName: "author",
		},
		Category: "cat",
	}

	// test1: author dir exists
	c.files = []string{"/foo/twitter/cat/author/author_bar.jpg"}
	assert.NoError(t, d.Save(post))

	assert.Equal(t, []string{"/foo/twitter/cat/author/author_bar.jpg"}, c.uploadedFiles)
	assert.Equal(t, [][]byte{[]byte("foo")}, c.uploadedFileData)

	// test2: author dir does not exist
	c.files = nil
	c.uploadedFiles = nil
	c.uploadedFileData = nil
	assert.NoError(t, d.Save(post))

	assert.Equal(t, []string{"/foo/twitter/cat/author_bar.jpg"}, c.uploadedFiles)
	assert.Equal(t, [][]byte{[]byte("foo")}, c.uploadedFileData)

	// test3: create a new author dir
	c.files = []string{
		"/foo/twitter/cat/author_bar1.jpg",
		"/foo/twitter/cat/author_bar2.jpg",
		"/foo/twitter/cat/author_bar3.jpg",
		"/foo/twitter/cat/author_bar4.jpg",
		"/foo/twitter/cat/author_bar5.jpg",
	}
	c.createdFolders = nil
	c.uploadedFiles = nil
	c.uploadedFileData = nil
	assert.NoError(t, d.Save(post))

	assert.Equal(t, []string{"/foo/twitter/cat/author/author_bar.jpg"}, c.uploadedFiles)
	assert.Equal(t, [][]byte{[]byte("foo")}, c.uploadedFileData)
	assert.Equal(t, []string{
		"/foo/twitter/cat/author",
	}, c.createdFolders)
	assert.Equal(t, []string{
		"/foo/twitter/cat/author/author_bar1.jpg",
		"/foo/twitter/cat/author/author_bar2.jpg",
		"/foo/twitter/cat/author/author_bar3.jpg",
		"/foo/twitter/cat/author/author_bar4.jpg",
		"/foo/twitter/cat/author/author_bar5.jpg",
	}, c.movedFiles)

	// test4: no media
	c.files = nil
	c.createdFolders = nil
	c.movedFiles = nil
	c.uploadedFiles = nil
	c.uploadedFileData = nil
	post.Media = nil
	assert.NoError(t, d.Save(post))

	assert.Equal(t, []string(nil), c.uploadedFiles)
	assert.Equal(t, [][]byte(nil), c.uploadedFileData)
}

type dropboxFilesClientMock struct {
	files.Client
	files            []string
	uploadedFiles    []string
	uploadedFileData [][]byte
	createdFolders   []string
	movedFiles       []string
}

func (c *dropboxFilesClientMock) CreateFolderV2(arg *files.CreateFolderArg) (res *files.CreateFolderResult, err error) {
	c.createdFolders = append(c.createdFolders, arg.Path)
	return &files.CreateFolderResult{}, nil
}

func (c *dropboxFilesClientMock) GetMetadata(arg *files.GetMetadataArg) (res files.IsMetadata, err error) {
	if slices.Contains(c.files, arg.Path) {
		return &files.FileMetadata{}, nil
	}

	if lo.SomeBy(c.files, func(f string) bool {
		return strings.HasPrefix(f, arg.Path+"/")
	}) {
		return &files.FolderMetadata{}, nil
	}

	return nil, nil
}

func (c *dropboxFilesClientMock) ListFolder(arg *files.ListFolderArg) (res *files.ListFolderResult, err error) {
	if arg.Path != "/foo/twitter/cat" {
		return nil, errors.New("invalid path")
	}
	return &files.ListFolderResult{
		Entries: lo.Map(c.files, func(f string, _ int) files.IsMetadata {
			return &files.FileMetadata{
				Metadata: files.Metadata{
					PathLower: f,
				},
			}
		}),
		HasMore: true,
		Cursor:  "cursor",
	}, nil
}

func (c *dropboxFilesClientMock) ListFolderContinue(arg *files.ListFolderContinueArg) (res *files.ListFolderResult, err error) {
	return &files.ListFolderResult{
		Entries: []files.IsMetadata{
			&files.FileMetadata{
				Metadata: files.Metadata{
					PathLower: "/foo/baz",
				},
			},
		},
		HasMore: false,
	}, nil
}

func (c *dropboxFilesClientMock) MoveV2(arg *files.RelocationArg) (res *files.RelocationResult, err error) {
	c.movedFiles = append(c.movedFiles, arg.ToPath)
	return &files.RelocationResult{}, nil
}

func (c *dropboxFilesClientMock) Upload(arg *files.UploadArg, content io.Reader) (res *files.FileMetadata, err error) {
	c.uploadedFiles = append(c.uploadedFiles, arg.CommitInfo.Path)
	data, err := io.ReadAll(content)
	if err != nil {
		return nil, err
	}
	c.uploadedFileData = append(c.uploadedFileData, data)
	return &files.FileMetadata{}, nil
}
