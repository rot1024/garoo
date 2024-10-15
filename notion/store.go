package notion

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jomei/notionapi"
	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

const retryCount = 2

type Store struct {
	client   *notionapi.Client
	postDB   notionapi.DatabaseID
	postDB2  notionapi.DatabaseID
	authorDB notionapi.DatabaseID
}

type Options struct {
	Token           string
	PostDB          string
	SecondaryPostDB string
	AuthorDB        string
}

var _ garoo.Store = (*Store)(nil)

func New(options Options) *Store {
	return &Store{
		client:   notionapi.NewClient(notionapi.Token(options.Token)),
		postDB:   notionapi.DatabaseID(options.PostDB),
		postDB2:  notionapi.DatabaseID(options.SecondaryPostDB),
		authorDB: notionapi.DatabaseID(options.AuthorDB),
	}
}
func (s *Store) Name() string {
	return "notion"
}

func (s *Store) Save(post *garoo.Post) error {
	ctx := context.Background()
	var authorPageID *notionapi.PageID

	text := post.IsText()
	if !text {
		if len(post.Media) == 0 {
			return fmt.Errorf("no media")
		}

		slog.Info("notion: get author", "authorID", post.Author.ID)

		ap1, err := s.getAuthor(ctx, &post.Author)
		if err != nil {
			return fmt.Errorf("failed to get author: %v", err)
		}

		slog.Info("notion: save author", "authorID", post.Author.ID, "pageID", ap1)

		ap2, err := s.saveAuthor(ctx, &post.Author, ap1)
		if err != nil {
			return fmt.Errorf("failed to save author: %v", err)
		}

		authorPageID = &ap2
	}

	slog.Info("notion: get post", "postID", post.ID)

	postPageIDs, err := s.getPost(ctx, post)
	if err != nil {
		return fmt.Errorf("failed to get post: %v", err)
	}

	if len(postPageIDs) == 0 {
		if text {
			slog.Info("notion: create text post", "postID", post.ID)

			if err := s.savePost(ctx, post, 0, nil, authorPageID); err != nil {
				return fmt.Errorf("failed to save post: %v", err)
			}
		} else {
			for i := range post.Media {
				slog.Info("notion: create post", "postID", post.ID, "index", i+1, "total", len(post.Media))

				if err := s.savePost(ctx, post, i, nil, authorPageID); err != nil {
					return fmt.Errorf("failed to save post: %v", err)
				}
			}
		}
	} else {
		for i, postPageID := range postPageIDs {
			slog.Info("notion: update post", "postID", post.ID, "pageID", postPageID, "index", i+1, "total", len(postPageIDs))

			if err := s.savePost(ctx, post, i, &postPageID, authorPageID); err != nil {
				return fmt.Errorf("failed to save post: %v", err)
			}
		}
	}

	slog.Info("notion: done")

	return nil
}

func (s *Store) Login(code string) (string, error) {
	return "", nil
}

func (s *Store) saveAuthor(ctx context.Context, author *garoo.Author, pageID *notionapi.PageID) (_ notionapi.PageID, err error) {
	properties := authorProperties(author)

	var page *notionapi.Page
	if pageID == nil {
		page, err = s.client.Page.Create(ctx, &notionapi.PageCreateRequest{
			Parent: notionapi.Parent{
				DatabaseID: s.authorDB,
			},
			Properties: properties,
		})
	} else {
		page, err = s.client.Page.Update(ctx, *pageID, &notionapi.PageUpdateRequest{
			Properties: properties,
		})
	}

	if err != nil {
		return "", err
	}
	return notionapi.PageID(page.ID), nil
}

func (s *Store) getAuthor(ctx context.Context, a *garoo.Author) (*notionapi.PageID, error) {
	q, err := retry(retryCount, func() (*notionapi.DatabaseQueryResponse, error) {
		return s.client.Database.Query(
			ctx,
			s.authorDB,
			&notionapi.DatabaseQueryRequest{
				Filter: notionapi.PropertyFilter{
					Property: propertyAuthorID,
					RichText: &notionapi.TextFilterCondition{
						Equals: a.ID,
					},
				},
			})
	})

	if err != nil {
		return nil, err
	}

	if len(q.Results) == 0 {
		return nil, nil
	}

	return lo.ToPtr(notionapi.PageID(q.Results[0].ID)), nil
}

// if i == 0, post should be handled as text
func (s *Store) savePost(ctx context.Context, post *garoo.Post, i int, pageID, authorPageID *notionapi.PageID) (err error) {
	properties := postProperties(post, i, authorPageID)

	_, err = retry(retryCount, func() (_ any, err2 error) {
		if pageID == nil {
			db := s.postDBFor(post)
			_, err2 = s.client.Page.Create(ctx, &notionapi.PageCreateRequest{
				Parent: notionapi.Parent{
					DatabaseID: db,
				},
				Properties: properties,
				Children:   blocks(post, i),
			})
		} else {
			_, err2 = s.client.Page.Update(ctx, *pageID, &notionapi.PageUpdateRequest{
				Properties: properties,
			})
		}
		return
	})

	return
}

func (s *Store) getPost(ctx context.Context, post *garoo.Post) ([]notionapi.PageID, error) {
	db := s.postDBFor(post)
	q, err := retry(retryCount, func() (*notionapi.DatabaseQueryResponse, error) {
		return s.client.Database.Query(
			ctx,
			db,
			&notionapi.DatabaseQueryRequest{
				Filter: notionapi.PropertyFilter{
					Property: propertyPostID,
					RichText: &notionapi.TextFilterCondition{
						Equals: post.ID,
					},
				},
				// Sorts: []notionapi.SortObject{
				// 	{
				// 		Property:  propertyPostIndex,
				// 		Direction: notionapi.SortOrderASC,
				// 	},
				// },
			},
		)
	})

	if err != nil {
		return nil, err
	}

	return lo.Map(q.Results, func(r notionapi.Page, _ int) notionapi.PageID {
		return notionapi.PageID(r.ID)
	}), nil
}

func (s *Store) postDBFor(p *garoo.Post) notionapi.DatabaseID {
	if p.IsText() && s.postDB2 != "" {
		return s.postDB2
	}
	return s.postDB
}

func retry[T any](n int, f func() (T, error)) (res T, err error) {
	for i := 0; i < n; i++ {
		res, err = f()
		if err == nil {
			return
		}
	}
	return
}

func (s *Store) GetConfig() string {
	return ""
}

func (s *Store) Init(c string) error {
	return nil
}
