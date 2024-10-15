package notion

import (
	"fmt"
	"slices"
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
	propertyAuthorAvatar     = "Avatar"
)

func authorProperties(p *garoo.Author) notionapi.Properties {
	return notionapi.Properties{
		propertyAuthorTitle: notionapi.TitleProperty{
			Type:  notionapi.PropertyTypeTitle,
			Title: richTextFrom(p.Name),
		},
		propertyAuthorID: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.ID),
		},
		propertyAuthorName: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.Name),
		},
		propertyAuthorScreenname: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.ScreenName),
		},
		propertyAuthorProvider: notionapi.SelectProperty{
			Type: notionapi.PropertyTypeSelect,
			Select: notionapi.Option{
				Name: p.Provider,
			},
		},
		propertyAuthorAvatar: notionapi.FilesProperty{
			Type: notionapi.PropertyTypeFiles,
			Files: []notionapi.File{
				{
					Type: notionapi.FileTypeExternal,
					Name: p.ScreenName,
					External: &notionapi.FileObject{
						URL: p.Avator,
					},
				},
			},
		},
	}
}

// if i == 0, post should be handled as text
func postProperties(p *garoo.Post, i int, authorPageID *notionapi.PageID) notionapi.Properties {
	tags := p.Tags
	if i > 0 && len(p.Media) > 0 {
		m := p.Media[i]
		if m.Type == garoo.MediaTypeVideo && !slices.Contains(tags, "video") {
			tags = append(tags, "video")
		}
	}

	properties := notionapi.Properties{
		propertyPostTitle: notionapi.TitleProperty{
			Type:  notionapi.PropertyTypeTitle,
			Title: richTextFrom(title(p)),
		},
		propertyPostID: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.ID),
		},
		propertyPostAuthorName: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.Author.Name),
		},
		propertyPostAuthorID: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.Author.ID),
		},
		propertyPostDescription: notionapi.RichTextProperty{
			Type:     notionapi.PropertyTypeRichText,
			RichText: richTextFrom(p.Content),
		},
		propertyPostProviders: notionapi.SelectProperty{
			Type: notionapi.PropertyTypeSelect,
			Select: notionapi.Option{
				Name: p.Provider,
			},
		},
		propertyPostURL: notionapi.URLProperty{
			Type: notionapi.PropertyTypeURL,
			URL:  p.URL,
		},
		propertyPostDate: notionapi.DateProperty{
			Type: notionapi.PropertyTypeDate,
			Date: &notionapi.DateObject{
				Start: lo.ToPtr(notionapi.Date(p.Timestamp)),
			},
		},
	}

	if !p.IsSpecialCategory() {
		properties[propertyPostCategory] = notionapi.SelectProperty{
			Type: notionapi.PropertyTypeSelect,
			Select: notionapi.Option{
				Name: p.Category,
			},
		}
	}

	if authorPageID != nil {
		properties[propertyPostAuthor] = notionapi.RelationProperty{
			Type: notionapi.PropertyTypeRelation,
			Relation: []notionapi.Relation{
				{
					ID: *authorPageID,
				},
			},
		}
	}

	if len(tags) > 0 {
		properties[propertyPostLabels] = notionapi.MultiSelectProperty{
			Type: notionapi.PropertyTypeMultiSelect,
			MultiSelect: lo.Map(tags, func(tag string, _ int) notionapi.Option {
				return notionapi.Option{
					Name: tag,
				}
			}),
		}
	}

	if i > 0 && len(p.Media) > 0 {
		m := p.Media[i]
		mediaProperty := &notionapi.FilesProperty{
			Type: notionapi.PropertyTypeFiles,
			Files: []notionapi.File{
				{
					Type: notionapi.FileTypeExternal,
					Name: fileName(p, i),
					External: &notionapi.FileObject{
						URL: m.URL,
					},
				},
			},
		}

		properties[propertyPostMedia] = *mediaProperty
		properties[propertyPostMediaRaw] = *mediaProperty

		properties[propertyPostIndex] = notionapi.NumberProperty{
			Type:   notionapi.PropertyTypeNumber,
			Number: float64(i + 1),
		}
		properties[propertyPostCount] = notionapi.NumberProperty{
			Type:   notionapi.PropertyTypeNumber,
			Number: float64(len(p.Media)),
		}
	}

	return properties
}

func blocks(p *garoo.Post, i int) (res []notionapi.Block) {
	var b notionapi.Block
	if len(p.Media) > 0 {
		m := p.Media[i]

		if m.Type == garoo.MediaTypePhoto {
			b = notionapi.ImageBlock{
				BasicBlock: notionapi.BasicBlock{
					Type:   notionapi.BlockTypeImage,
					Object: notionapi.ObjectTypeBlock,
				},
				Image: notionapi.Image{
					Type: notionapi.FileTypeExternal,
					External: &notionapi.FileObject{
						URL: m.URL,
					},
				},
			}
		} else if m.Type == garoo.MediaTypeVideo {
			b = notionapi.VideoBlock{
				BasicBlock: notionapi.BasicBlock{
					Type:   notionapi.BlockTypeVideo,
					Object: notionapi.ObjectTypeBlock,
				},
				Video: notionapi.Video{
					Type: notionapi.FileTypeExternal,
					External: &notionapi.FileObject{
						URL: m.URL,
					},
				},
			}
		}
	} else {
		b = notionapi.ParagraphBlock{
			BasicBlock: notionapi.BasicBlock{
				Type:   notionapi.BlockTypeParagraph,
				Object: notionapi.ObjectTypeBlock,
			},
			Paragraph: notionapi.Paragraph{
				RichText: richTextFrom(p.Content),
			},
		}
	}

	if b != nil {
		res = append(res, b)
	}

	return append(
		res,
		notionapi.EmbedBlock{
			BasicBlock: notionapi.BasicBlock{
				Type:   notionapi.BlockTypeEmbed,
				Object: notionapi.ObjectTypeBlock,
			},
			Embed: notionapi.Embed{
				URL: p.URL,
			},
		},
	)
}

func title(p *garoo.Post) string {
	return fmt.Sprintf("@%s %s", p.Author.ScreenName, formatDate(p.Timestamp))
}

func fileName(p *garoo.Post, i int) string {
	index := ""
	if len(p.Media) > 1 {
		index = fmt.Sprintf("_%d", i)
	}
	return fmt.Sprintf("%s_%s%s", p.Author.ScreenName, p.ID, index)
}

func formatDate(t time.Time) string {
	return t.Format("2006-01-02 15:04:05")
}

func richTextFrom(s string) []notionapi.RichText {
	return []notionapi.RichText{
		{
			Type: notionapi.ObjectTypeText,
			Text: &notionapi.Text{
				Content: s,
			},
		},
	}
}
