package notion

import (
	"fmt"
	"time"

	"github.com/jomei/notionapi"
	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

const (
	propertyPostTitle        = "Name"
	propertyPostID           = "ID"
	propertyPostAuthorName   = "Author Name"
	propertyPostAuthorID     = "Author ID"
	propertyPostAuthor       = "Author"
	propertyPostDescription  = "Description"
	propertyPostCategory     = "Category"
	propertyPostLabels       = "Tags"
	propertyPostProviders    = "Provider"
	propertyPostURL          = "URL"
	propertyPostDate         = "Date"
	propertyPostMedia        = "Media"
	propertyPostMediaRaw     = "Media Raw"
	propertyPostIndex        = "Index"
	propertyPostCount        = "Count"
	propertyAuthorTitle      = "Name"
	propertyAuthorID         = "ID"
	propertyAuthorName       = "User Name"
	propertyAuthorScreenname = "Screenname"
	propertyAuthorProvider   = "Provider"
	propertyAuthorAvator     = "Avatar"
)

func authorProperties(p *garoo.Author) notionapi.Properties {
	return notionapi.Properties{
		propertyAuthorTitle: notionapi.TitleProperty{
			Title: richTextFrom(p.Name),
		},
		propertyAuthorID: notionapi.TextProperty{
			Text: richTextFrom(p.ID),
		},
		propertyAuthorName: notionapi.TextProperty{
			Text: richTextFrom(p.Name),
		},
		propertyAuthorScreenname: notionapi.TextProperty{
			Text: richTextFrom(p.ScreenName),
		},
		propertyAuthorProvider: notionapi.SelectProperty{
			Select: notionapi.Option{
				Name: p.Provider,
			},
		},
		propertyAuthorAvator: notionapi.FilesProperty{
			Files: []notionapi.File{
				{
					Type: notionapi.FileTypeExternal,
					External: &notionapi.FileObject{
						URL: p.Avator,
					},
				},
			},
		},
	}
}

func postProperties(p *garoo.Post, i int, authorPageID notionapi.PageID) notionapi.Properties {
	var mediaProperty *notionapi.FilesProperty
	if len(p.Media) > 0 {
		mediaProperty = &notionapi.FilesProperty{
			Files: []notionapi.File{
				{
					Type: notionapi.FileTypeExternal,
					External: &notionapi.FileObject{
						URL: p.Media[i].URL,
					},
				},
			},
		}
	}

	properties := notionapi.Properties{
		propertyPostTitle: notionapi.TitleProperty{
			Title: richTextFrom(title(p)),
		},
		propertyPostID: notionapi.TextProperty{
			Text: richTextFrom(p.ID),
		},
		propertyPostAuthorName: notionapi.TextProperty{
			Text: richTextFrom(p.Author.Name),
		},
		propertyPostAuthorID: notionapi.TextProperty{
			Text: richTextFrom(p.Author.ID),
		},
		propertyPostAuthor: notionapi.RelationProperty{
			Relation: []notionapi.Relation{
				{
					ID: authorPageID,
				},
			},
		},
		propertyPostDescription: notionapi.TextProperty{
			Text: richTextFrom(p.Content),
		},
		propertyPostCategory: notionapi.SelectProperty{
			Select: notionapi.Option{
				Name: p.Category,
			},
		},
		propertyPostLabels: notionapi.MultiSelectProperty{
			MultiSelect: []notionapi.Option{
				{
					Name: "test",
				},
			},
		},
		propertyPostProviders: notionapi.MultiSelectProperty{
			MultiSelect: []notionapi.Option{
				{
					Name: p.Provider,
				},
			},
		},
		propertyPostURL: notionapi.URLProperty{
			URL: p.URL,
		},
		propertyPostDate: notionapi.DateProperty{
			Date: &notionapi.DateObject{
				Start: lo.ToPtr(notionapi.Date(p.Timestamp)),
			},
		},
		propertyPostIndex: notionapi.NumberProperty{
			Number: float64(i),
		},
		propertyPostCount: notionapi.NumberProperty{
			Number: float64(len(p.Media)),
		},
	}

	if mediaProperty != nil {
		properties[propertyPostMedia] = *mediaProperty
		properties[propertyPostMediaRaw] = *mediaProperty
	}

	return properties
}

func blocks(p *garoo.Post, i int) (res []notionapi.Block) {
	if len(p.Media) > 0 {
		imageBlock := notionapi.ImageBlock{
			Image: notionapi.Image{
				File: &notionapi.FileObject{
					URL: p.Media[i].URL,
				},
			},
		}
		res = append(res, imageBlock)
	}

	return append(
		res,
		notionapi.EmbedBlock{
			Embed: notionapi.Embed{
				URL: p.URL,
			},
		},
	)
}

func title(p *garoo.Post) string {
	return fmt.Sprintf("@%s %s", p.Author.ScreenName, formatDate(p.Timestamp))
}

func formatDate(t time.Time) string {
	return t.Format("2006-01-02 15:04:05")
}

func richTextFrom(s string) []notionapi.RichText {
	return []notionapi.RichText{
		{
			Text: &notionapi.Text{
				Content: s,
			},
		},
	}
}
